import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { categoryKey, MAX_CATEGORIES, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import type { ApiExtension } from './routes.ts';

/**
 * Item categories (every plan): a code and a name in Arabic, Kurdish and English, an order, and active or not. 1.1:
 * two levels — a category may have subcategories (a subcategory's parent is always a top-level category, so there is
 * no third level and no cycle). An item is in a category or a subcategory; looking for a category's items finds its
 * subcategories' items too. An online shop shows its catalogue by them (the website API lists the active ones). A
 * category in use (items or subcategories) is never deleted: it is switched off instead.
 */

export interface CategoryView {
  id: string; code: string; name: Names; sort: number; active: boolean;
  /** 1.1: the category this one is a subcategory of (null: a top-level category) */
  parentId: string | null;
  /** 1.1: the minimum quantity for its items that have none of their own (thousandths; null: none) */
  reorderMilli: number | null;
  /** items in this category itself, and its subcategories */
  items: number; children: number;
  createdAt: string; updatedAt: string;
}
export interface CategoryInput {
  code?: string | undefined; name: Names; sort?: number | undefined; active?: boolean | undefined; parentId?: string | null | undefined;
  reorderMilli?: number | null | undefined;
}

interface Row {
  id: string; code: string; name_ar: string; name_en: string; name_ku: string; sort: number; active: number; parent_id: string | null;
  reorder_milli: number | null; created_at: string; updated_at: string; items: number | null; children: number | null;
}

const view = (r: Row): CategoryView => ({
  id: r.id, code: r.code, name: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, sort: Number(r.sort), active: Number(r.active) === 1,
  parentId: r.parent_id ?? null, reorderMilli: r.reorder_milli === null || r.reorder_milli === undefined ? null : Number(r.reorder_milli), items: Number(r.items ?? 0), children: Number(r.children ?? 0), createdAt: r.created_at, updatedAt: r.updated_at
});

/** Names typed by people: no control characters, spaces collapsed, at most 200 characters. */
export const clean = (text: string | undefined) => (text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

const SELECT = `SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) AS items,
                (SELECT COUNT(*) FROM item_categories s WHERE s.parent_id = c.id) AS children FROM item_categories c`;

/**
 * The categories in tree order: each top-level category (by its order, then code) followed by its subcategories (by
 * theirs). A subcategory always follows its parent, also when only active ones are asked for and the parent is off.
 */
export function listCategories(db: Db, f: { active?: boolean | undefined } = {}): CategoryView[] {
  const rows = (db.prepare(`${SELECT} ${f.active === undefined ? '' : 'WHERE c.active = ?'} ORDER BY c.sort, c.code`)
    .all(...(f.active === undefined ? [] : [f.active ? 1 : 0])) as unknown as Row[]).map(view);
  const listed = new Set(rows.map((c) => c.id));
  const out: CategoryView[] = [];
  for (const top of rows.filter((c) => !c.parentId || !listed.has(c.parentId))) {
    out.push(top);
    if (!top.parentId) out.push(...rows.filter((c) => c.parentId === top.id));
  }
  return out;
}

export function getCategory(db: Db, id: string): CategoryView {
  const r = db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as unknown as Row | undefined;
  if (!r) throw notFound('category');
  return view(r);
}

/** A category's id with its subcategories' ids (what "items in this category" means). */
export function categoryWithChildren(db: Db, id: string): string[] {
  return [id, ...(db.prepare('SELECT id FROM item_categories WHERE parent_id = ?').all(id) as { id: string }[]).map((r) => r.id)];
}

/** SQL for "the item's category is `?` or one of its subcategories" (two parameters: the id twice). */
export const IN_CATEGORY_SQL = (column: string) => `(${column} = ? OR ${column} IN (SELECT id FROM item_categories WHERE parent_id = ?))`;

function assertInput(db: Db, input: CategoryInput, id: string | null): { code: string | null; name: Names; parentId: string | null | undefined } {
  const name = { ar: clean(input.name?.ar), en: clean(input.name?.en), ku: clean(input.name?.ku) };
  const errors: { code: string }[] = [];
  if (!name.ar && !name.en && !name.ku) errors.push({ code: 'name_required' });
  const code = input.code?.trim().toUpperCase() || null;
  if (code && !/^[\p{L}\p{N}._-]{1,24}$/u.test(code)) errors.push({ code: 'code_invalid' });
  if (input.sort !== undefined && (!Number.isSafeInteger(input.sort) || input.sort < 0 || input.sort > 100_000)) errors.push({ code: 'value_invalid' });
  if (input.reorderMilli !== undefined && input.reorderMilli !== null && !(Number.isSafeInteger(input.reorderMilli) && input.reorderMilli >= 0)) errors.push({ code: 'reorder_invalid' });
  if (errors.length) throw invalid(errors);
  if (code && db.prepare("SELECT 1 FROM item_categories WHERE code = ? AND id <> COALESCE(?, '')").get(code, id)) throw conflict('code_exists');
  const parentId = input.parentId === undefined ? undefined : input.parentId || null;
  if (parentId) {
    const parent = db.prepare('SELECT parent_id, active FROM item_categories WHERE id = ?').get(parentId) as { parent_id: string | null; active: number } | undefined;
    const kept = id ? db.prepare('SELECT 1 FROM item_categories WHERE id = ? AND parent_id = ?').get(id, parentId) : undefined;
    // a parent is a top-level category (two levels only, so no cycle), active unless it is the one kept
    if (!parent || parentId === id || parent.parent_id || (Number(parent.active) !== 1 && !kept)) throw invalid([{ code: 'category_parent_invalid' }]);
    // a category with subcategories stays at the top
    if (id && db.prepare('SELECT 1 FROM item_categories WHERE parent_id = ? LIMIT 1').get(id)) throw conflict('category_has_subcategories');
  }
  return { code, name, parentId };
}

function assertRoom(db: Db, adding: number): void {
  const n = Number((db.prepare('SELECT COUNT(*) AS n FROM item_categories').get() as { n: number }).n);
  if (n + adding > MAX_CATEGORIES) throw conflict('too_many', { limit: MAX_CATEGORIES });
}

/** Inserts a category (codes C001, C002 … when none is given). Call inside a transaction. */
export function insertCategory(db: Db, values: { code: string | null; name: Names; parentId: string | null; sort?: number | undefined; active?: boolean | undefined; reorderMilli?: number | null | undefined }, user: string): string {
  const id = randomUUID();
  let code = values.code;
  // an empty code: the next free C001, C002 …
  while (!code || db.prepare('SELECT 1 FROM item_categories WHERE code = ?').get(code)) code = `C${String(nextSequence(db, 'item_category')).padStart(3, '0')}`;
  const now = new Date().toISOString();
  const sort = values.sort ?? Number((db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM item_categories').get() as { s: number }).s) + 10;
  db.prepare('INSERT INTO item_categories (id, code, name_ar, name_en, name_ku, sort, active, created_at, updated_at, parent_id, reorder_milli) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, code, values.name.ar, values.name.en, values.name.ku, sort, values.active === false ? 0 : 1, now, now, values.parentId, values.reorderMilli ?? null);
  audit(db, user, 'create', 'item_category', id, { code, parentId: values.parentId });
  return id;
}

export function createCategory(db: Db, input: CategoryInput, user: string): CategoryView {
  const { code, name, parentId } = assertInput(db, input, null);
  assertRoom(db, 1);
  const id = transaction(db, () => insertCategory(db, { code, name, parentId: parentId ?? null, sort: input.sort, active: input.active, reorderMilli: input.reorderMilli }, user));
  return getCategory(db, id);
}

export function updateCategory(db: Db, id: string, input: CategoryInput, user: string): CategoryView {
  const current = getCategory(db, id);
  const { code, name, parentId } = assertInput(db, input, id);
  transaction(db, () => {
    const now = new Date().toISOString();
    db.prepare('UPDATE item_categories SET code = ?, name_ar = ?, name_en = ?, name_ku = ?, sort = ?, active = ?, parent_id = ?, reorder_milli = ?, updated_at = ? WHERE id = ?')
      .run(code ?? current.code, name.ar, name.en, name.ku, input.sort ?? current.sort, input.active === undefined ? (current.active ? 1 : 0) : input.active ? 1 : 0,
        parentId === undefined ? current.parentId : parentId, input.reorderMilli === undefined ? current.reorderMilli : input.reorderMilli, now, id);
    // a shop sees its items' category change (a subcategory's items too: its path changed)
    db.prepare(`UPDATE items SET updated_at = ? WHERE ${IN_CATEGORY_SQL('category_id')}`).run(now, id, id);
    audit(db, user, 'update', 'item_category', id, input);
  });
  return getCategory(db, id);
}

/** Deletes a category nothing uses; one with items or subcategories is refused (switch it off instead). */
export function deleteCategory(db: Db, id: string, user: string): void {
  const c = getCategory(db, id);
  if (c.items > 0 || c.children > 0) throw conflict('in_use', { items: c.items, subcategories: c.children });
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

/** A top-level category (or, with `parentId`, a subcategory of it) whose name in any language is `name`'s. */
export function findCategoryByName(db: Db, name: Names, parentId: string | null): string | null {
  const keys = [name.ar, name.en, name.ku].map((t) => categoryKey(t)).filter(Boolean);
  if (!keys.length) return null;
  const rows = (parentId
    ? db.prepare('SELECT id, name_ar, name_en, name_ku FROM item_categories WHERE parent_id = ? ORDER BY sort, code').all(parentId)
    : db.prepare('SELECT id, name_ar, name_en, name_ku FROM item_categories WHERE parent_id IS NULL ORDER BY sort, code').all()) as { id: string; name_ar: string; name_en: string; name_ku: string }[];
  const hit = rows.find((r) => [r.name_ar, r.name_en, r.name_ku].some((t) => t && keys.includes(categoryKey(t))));
  return hit?.id ?? null;
}

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const names = z.object({ ar: z.string().max(200), en: z.string().max(200), ku: z.string().max(200) });
const body = z.object({
  code: z.string().max(24).optional(), name: names, sort: z.number().int().min(0).max(100_000).optional(), active: z.boolean().optional(),
  parentId: id.nullable().optional(),
  reorderMilli: z.number().int().min(0).max(1e15).nullable().optional()
});

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
