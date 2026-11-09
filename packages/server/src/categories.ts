import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Names } from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import type { ApiExtension } from './routes.ts';

/**
 * Item categories (every plan): a code and a name in Arabic, Kurdish and English, an order, and active or not. An
 * online shop shows its catalogue by them (the website API lists the active ones). A category in use is never
 * deleted: it is switched off instead.
 */

export interface CategoryView { id: string; code: string; name: Names; sort: number; active: boolean; items: number; createdAt: string; updatedAt: string }
export interface CategoryInput { code?: string | undefined; name: Names; sort?: number | undefined; active?: boolean | undefined }

interface Row { id: string; code: string; name_ar: string; name_en: string; name_ku: string; sort: number; active: number; created_at: string; updated_at: string; items: number | null }

const view = (r: Row): CategoryView => ({
  id: r.id, code: r.code, name: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, sort: Number(r.sort), active: Number(r.active) === 1,
  items: Number(r.items ?? 0), createdAt: r.created_at, updatedAt: r.updated_at
});

/** Names typed by people: no control characters, spaces collapsed, at most 200 characters. */
const clean = (text: string | undefined) => (text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

export function listCategories(db: Db, f: { active?: boolean | undefined } = {}): CategoryView[] {
  const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) AS items FROM item_categories c
                           ${f.active === undefined ? '' : 'WHERE c.active = ?'} ORDER BY c.sort, c.code`)
    .all(...(f.active === undefined ? [] : [f.active ? 1 : 0])) as unknown as Row[];
  return rows.map(view);
}

export function getCategory(db: Db, id: string): CategoryView {
  const r = db.prepare('SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) AS items FROM item_categories c WHERE c.id = ?').get(id) as unknown as Row | undefined;
  if (!r) throw notFound('category');
  return view(r);
}

function assertInput(db: Db, input: CategoryInput, id: string | null): { code: string | null; name: Names } {
  const name = { ar: clean(input.name?.ar), en: clean(input.name?.en), ku: clean(input.name?.ku) };
  const errors: { code: string }[] = [];
  if (!name.ar && !name.en && !name.ku) errors.push({ code: 'name_required' });
  const code = input.code?.trim().toUpperCase() || null;
  if (code && !/^[\p{L}\p{N}._-]{1,24}$/u.test(code)) errors.push({ code: 'code_invalid' });
  if (input.sort !== undefined && (!Number.isSafeInteger(input.sort) || input.sort < 0 || input.sort > 100_000)) errors.push({ code: 'value_invalid' });
  if (errors.length) throw invalid(errors);
  if (code && db.prepare("SELECT 1 FROM item_categories WHERE code = ? AND id <> COALESCE(?, '')").get(code, id)) throw conflict('code_exists');
  return { code, name };
}

export function createCategory(db: Db, input: CategoryInput, user: string): CategoryView {
  const { code: typed, name } = assertInput(db, input, null);
  const id = randomUUID();
  transaction(db, () => {
    let code = typed;
    // an empty code: the next free C001, C002 …
    while (!code || db.prepare('SELECT 1 FROM item_categories WHERE code = ?').get(code)) code = `C${String(nextSequence(db, 'item_category')).padStart(3, '0')}`;
    const now = new Date().toISOString();
    const sort = input.sort ?? Number((db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM item_categories').get() as { s: number }).s) + 10;
    db.prepare('INSERT INTO item_categories (id, code, name_ar, name_en, name_ku, sort, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, code, name.ar, name.en, name.ku, sort, input.active === false ? 0 : 1, now, now);
    audit(db, user, 'create', 'item_category', id, { code });
  });
  return getCategory(db, id);
}

export function updateCategory(db: Db, id: string, input: CategoryInput, user: string): CategoryView {
  const current = getCategory(db, id);
  const { code, name } = assertInput(db, input, id);
  transaction(db, () => {
    db.prepare('UPDATE item_categories SET code = ?, name_ar = ?, name_en = ?, name_ku = ?, sort = ?, active = ?, updated_at = ? WHERE id = ?')
      .run(code ?? current.code, name.ar, name.en, name.ku, input.sort ?? current.sort, input.active === undefined ? (current.active ? 1 : 0) : input.active ? 1 : 0,
        new Date().toISOString(), id);
    // a shop sees its items' category change
    db.prepare('UPDATE items SET updated_at = ? WHERE category_id = ?').run(new Date().toISOString(), id);
    audit(db, user, 'update', 'item_category', id, input);
  });
  return getCategory(db, id);
}

/** Deletes a category nothing uses; one with items is refused (switch it off instead). */
export function deleteCategory(db: Db, id: string, user: string): void {
  const c = getCategory(db, id);
  if (c.items > 0) throw conflict('in_use', { items: c.items });
  transaction(db, () => {
    db.prepare('DELETE FROM item_categories WHERE id = ?').run(id);
    audit(db, user, 'delete', 'item_category', id, { code: c.code });
  });
}

/** Puts many items in one category at once (null: none). */
export function setItemsCategory(db: Db, itemIds: readonly string[], categoryId: string | null, user: string): { updated: number } {
  if (categoryId !== null) {
    const c = db.prepare('SELECT active FROM item_categories WHERE id = ?').get(categoryId) as { active: number } | undefined;
    if (!c || Number(c.active) !== 1) throw invalid([{ code: 'category_invalid' }]);
  }
  const ids = [...new Set(itemIds)];
  let updated = 0;
  transaction(db, () => {
    const set = db.prepare('UPDATE items SET category_id = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    for (const itemId of ids) updated += Number(set.run(categoryId, now, itemId).changes);
    audit(db, user, 'set_category', 'item', null, { categoryId, items: ids.length });
  });
  return { updated };
}

/** A category for an item: active, or the one the item has already (an inactive one is kept, never newly given). */
export function assertItemCategory(db: Db, categoryId: string | null | undefined, itemId: string | null): void {
  if (!categoryId) return;
  const c = db.prepare('SELECT active FROM item_categories WHERE id = ?').get(categoryId) as { active: number } | undefined;
  const kept = itemId ? (db.prepare('SELECT 1 FROM items WHERE id = ? AND category_id = ?').get(itemId, categoryId)) : undefined;
  if (!c || (Number(c.active) !== 1 && !kept)) throw invalid([{ code: 'category_invalid' }]);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const names = z.object({ ar: z.string().max(200), en: z.string().max(200), ku: z.string().max(200) });
const body = z.object({ code: z.string().max(24).optional(), name: names, sort: z.number().int().min(0).max(100_000).optional(), active: z.boolean().optional() });

export const categoriesApi: ApiExtension = {
  rules: {
    'POST /api/item-categories': 'stock',
    'PUT /api/item-categories/:id': 'stock',
    'DELETE /api/item-categories/:id': 'stock',
    'POST /api/items/category': 'stock'
  },
  routes(db, { actorOf }) {
    return [
      {
        method: 'GET', path: '/api/item-categories',
        handler: async (req) => {
          const q = parse(z.object({ active: z.enum(['true', 'false']).optional() }), req.query);
          return listCategories(db, { active: q.active === undefined ? undefined : q.active === 'true' });
        }
      },
      {
        method: 'POST', path: '/api/item-categories',
        handler: async (req, reply) => {
          reply.status(201).send(createCategory(db, parse(body, req.body), actorOf(req).name));
          return undefined;
        }
      },
      { method: 'PUT', path: '/api/item-categories/:id', handler: async (req) => updateCategory(db, parse(z.object({ id }), req.params).id, parse(body, req.body), actorOf(req).name) },
      {
        method: 'DELETE', path: '/api/item-categories/:id',
        handler: async (req, reply) => {
          deleteCategory(db, parse(z.object({ id }), req.params).id, actorOf(req).name);
          reply.status(204).send();
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/items/category',
        handler: async (req) => {
          const b = parse(z.object({ itemIds: z.array(id).min(1).max(500), categoryId: id.nullable() }), req.body);
          return setItemsCategory(db, b.itemIds, b.categoryId, actorOf(req).name);
        }
      }
    ];
  }
};
