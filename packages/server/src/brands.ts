import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { brandKey, isCountry, MAX_BRANDS, MAX_CATEGORIES, STARTER_LISTS, STARTER_TRADES, type CountryCode, type StarterTrade } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { conflict, invalid, notFound } from './errors.ts';
import { clean, findCategoryByName, insertCategory, parse } from './categories.ts';
import type { ApiExtension } from './routes.ts';

/**
 * Brands (1.1, every plan): one list for every item, car parts included. A brand's name is a trade name, written the
 * same in every language, with an optional Arabic and Kurdish spelling; an optional code and country of origin, an
 * order, and active or not. Names are unique without regard to case, spaces or letter forms (brandKey). A brand in
 * use is never deleted: it is switched off instead.
 */

export interface BrandView {
  id: string; code: string | null; name: string; nameAr: string; nameKu: string; country: CountryCode | null;
  sort: number; active: boolean; items: number; createdAt: string; updatedAt: string;
}
export interface BrandInput {
  code?: string | null | undefined; name: string; nameAr?: string | undefined; nameKu?: string | undefined; country?: string | null | undefined;
  sort?: number | undefined; active?: boolean | undefined;
}

interface Row {
  id: string; code: string | null; name: string; name_ar: string; name_ku: string; country: string | null; sort: number; active: number;
  created_at: string; updated_at: string; items: number | null;
}

const view = (r: Row): BrandView => ({
  id: r.id, code: r.code ?? null, name: r.name, nameAr: r.name_ar ?? '', nameKu: r.name_ku ?? '', country: isCountry(r.country) ? r.country : null,
  sort: Number(r.sort), active: Number(r.active) === 1, items: Number(r.items ?? 0), createdAt: r.created_at, updatedAt: r.updated_at
});

const SELECT = 'SELECT b.*, (SELECT COUNT(*) FROM items i WHERE i.brand_id = b.id) AS items FROM brands b';

/** The longest brand name (as on a part card before 1.1, with room). */
export const MAX_BRAND_NAME = 100;

export function listBrands(db: Db, f: { active?: boolean | undefined } = {}): BrandView[] {
  return (db.prepare(`${SELECT} ${f.active === undefined ? '' : 'WHERE b.active = ?'} ORDER BY b.sort, b.name`)
    .all(...(f.active === undefined ? [] : [f.active ? 1 : 0])) as unknown as Row[]).map(view);
}

export function getBrand(db: Db, id: string): BrandView {
  const r = db.prepare(`${SELECT} WHERE b.id = ?`).get(id) as unknown as Row | undefined;
  if (!r) throw notFound('brand');
  return view(r);
}

interface Clean { code: string | null; name: string; key: string; nameAr: string; nameKu: string; country: CountryCode | null }

function assertInput(db: Db, input: BrandInput, id: string | null): Clean {
  const name = clean(input.name).slice(0, MAX_BRAND_NAME);
  const key = brandKey(name);
  const errors: { code: string }[] = [];
  if (!key) errors.push({ code: 'name_required' });
  if (clean(input.name).length > MAX_BRAND_NAME) errors.push({ code: 'brand_name_too_long' });
  const code = input.code?.trim().toUpperCase() || null;
  if (code && !/^[\p{L}\p{N}._-]{1,24}$/u.test(code)) errors.push({ code: 'code_invalid' });
  const country = input.country ? input.country.trim().toUpperCase() : null;
  if (country && !isCountry(country)) errors.push({ code: 'country_invalid' });
  if (input.sort !== undefined && (!Number.isSafeInteger(input.sort) || input.sort < 0 || input.sort > 100_000)) errors.push({ code: 'value_invalid' });
  if (errors.length) throw invalid(errors);
  if (code && db.prepare("SELECT 1 FROM brands WHERE code = ? AND id <> COALESCE(?, '')").get(code, id)) throw conflict('code_exists');
  if (db.prepare("SELECT 1 FROM brands WHERE name_key = ? AND id <> COALESCE(?, '')").get(key, id)) throw conflict('brand_exists');
  return { code, name, key, nameAr: clean(input.nameAr).slice(0, MAX_BRAND_NAME), nameKu: clean(input.nameKu).slice(0, MAX_BRAND_NAME), country: country as CountryCode | null };
}

/** Inserts a checked brand. Call inside a transaction. */
function insertBrand(db: Db, b: Clean, extra: { sort?: number | undefined; active?: boolean | undefined }, user: string): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const sort = extra.sort ?? Number((db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM brands').get() as { s: number }).s) + 10;
  db.prepare('INSERT INTO brands (id, code, name, name_key, name_ar, name_ku, country, sort, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, b.code, b.name, b.key, b.nameAr, b.nameKu, b.country, sort, extra.active === false ? 0 : 1, now, now);
  audit(db, user, 'create', 'brand', id, { name: b.name });
  return id;
}

function assertRoom(db: Db, adding: number): void {
  const n = Number((db.prepare('SELECT COUNT(*) AS n FROM brands').get() as { n: number }).n);
  if (n + adding > MAX_BRANDS) throw conflict('too_many', { limit: MAX_BRANDS });
}

export function createBrand(db: Db, input: BrandInput, user: string): BrandView {
  const b = assertInput(db, input, null);
  assertRoom(db, 1);
  return getBrand(db, transaction(db, () => insertBrand(db, b, input, user)));
}

export function updateBrand(db: Db, id: string, input: BrandInput, user: string): BrandView {
  const current = getBrand(db, id);
  const b = assertInput(db, input, id);
  transaction(db, () => {
    const now = new Date().toISOString();
    db.prepare('UPDATE brands SET code = ?, name = ?, name_key = ?, name_ar = ?, name_ku = ?, country = ?, sort = ?, active = ?, updated_at = ? WHERE id = ?')
      .run(input.code === undefined ? current.code : b.code, b.name, b.key, input.nameAr === undefined ? current.nameAr : b.nameAr,
        input.nameKu === undefined ? current.nameKu : b.nameKu, input.country === undefined ? current.country : b.country,
        input.sort ?? current.sort, input.active === undefined ? (current.active ? 1 : 0) : input.active ? 1 : 0, now, id);
    // a shop sees its items' brand change
    db.prepare('UPDATE items SET updated_at = ? WHERE brand_id = ?').run(now, id);
    audit(db, user, 'update', 'brand', id, input);
  });
  return getBrand(db, id);
}

/** Deletes a brand no item has; one in use is refused (switch it off instead). */
export function deleteBrand(db: Db, id: string, user: string): void {
  const b = getBrand(db, id);
  if (b.items > 0) throw conflict('in_use', { items: b.items });
  transaction(db, () => {
    db.prepare('DELETE FROM brands WHERE id = ?').run(id);
    audit(db, user, 'delete', 'brand', id, { name: b.name });
  });
}

/** A brand for an item: active, or the one the item has already (an inactive one is kept, never newly given). */
export function assertItemBrand(db: Db, brandId: string | null | undefined, itemId: string | null): void {
  if (!brandId) return;
  const b = db.prepare('SELECT active FROM brands WHERE id = ?').get(brandId) as { active: number } | undefined;
  const kept = itemId ? db.prepare('SELECT 1 FROM items WHERE id = ? AND brand_id = ?').get(itemId, brandId) : undefined;
  if (!b || (Number(b.active) !== 1 && !kept)) throw invalid([{ code: 'brand_invalid' }]);
}

/**
 * The brand named `name` (any case or spacing), made when there is none: car-part cards and imports that still send
 * a brand as text. Empty text: null. Call inside a transaction.
 */
export function brandIdForName(db: Db, name: string, user: string): string | null {
  const text = clean(name).slice(0, MAX_BRAND_NAME);
  const key = brandKey(text);
  if (!key) return null;
  const found = db.prepare('SELECT id FROM brands WHERE name_key = ?').get(key) as { id: string } | undefined;
  if (found) return found.id;
  assertRoom(db, 1);
  return insertBrand(db, { code: null, name: text, key, nameAr: '', nameKu: '', country: null }, {}, user);
}

export interface StarterResult { trade: StarterTrade; categories: number; subcategories: number; brands: number }

/**
 * Adds a trade's starter list: its categories with their subcategories, and its brands. What is there already by name
 * (a category in any of its languages, a brand whatever its case) is skipped, so adding it twice adds nothing twice.
 * A category switched off is found too and left off: the list never switches anything back on.
 */
export function addStarterList(db: Db, trade: StarterTrade, user: string): StarterResult {
  const list = STARTER_LISTS[trade];
  const result: StarterResult = { trade, categories: 0, subcategories: 0, brands: 0 };
  transaction(db, () => {
    for (const c of list.categories) {
      let parent = findCategoryByName(db, c.name, null);
      if (!parent) {
        parent = insertCategory(db, { code: null, name: c.name, parentId: null }, user);
        result.categories += 1;
      }
      for (const sub of c.sub ?? []) {
        if (findCategoryByName(db, sub, parent)) continue;
        insertCategory(db, { code: null, name: sub, parentId: parent }, user);
        result.subcategories += 1;
      }
    }
    for (const b of list.brands) {
      const key = brandKey(b.name);
      if (db.prepare('SELECT 1 FROM brands WHERE name_key = ?').get(key)) continue;
      insertBrand(db, { code: null, name: b.name, key, nameAr: b.ar ?? '', nameKu: b.ku ?? '', country: b.country ?? null }, {}, user);
      result.brands += 1;
    }
    const total = (t: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n);
    if (total('item_categories') > MAX_CATEGORIES || total('brands') > MAX_BRANDS) throw conflict('too_many');
    audit(db, user, 'starter_list', 'item_category', null, result);
  });
  return result;
}

const id = z.string().min(1).max(64);
const body = z.object({
  code: z.string().max(24).nullable().optional(), name: z.string().max(200), nameAr: z.string().max(200).optional(), nameKu: z.string().max(200).optional(),
  country: z.string().max(2).nullable().optional(), sort: z.number().int().min(0).max(100_000).optional(), active: z.boolean().optional()
});

export const brandsApi: ApiExtension = {
  rules: {
    'POST /api/brands': 'stock',
    'PUT /api/brands/:id': 'stock',
    'DELETE /api/brands/:id': 'stock',
    'POST /api/starter-lists': 'stock'
  },
  routes(db, { actorOf }) {
    return [
      {
        method: 'GET', path: '/api/brands',
        handler: async (req) => {
          const q = parse(z.object({ active: z.enum(['true', 'false']).optional() }), req.query);
          return listBrands(db, { active: q.active === undefined ? undefined : q.active === 'true' });
        }
      },
      {
        method: 'POST', path: '/api/brands',
        handler: async (req, reply) => {
          reply.status(201).send(createBrand(db, parse(body, req.body), actorOf(req).name));
          return undefined;
        }
      },
      { method: 'PUT', path: '/api/brands/:id', handler: async (req) => updateBrand(db, parse(z.object({ id }), req.params).id, parse(body, req.body), actorOf(req).name) },
      {
        method: 'DELETE', path: '/api/brands/:id',
        handler: async (req, reply) => {
          deleteBrand(db, parse(z.object({ id }), req.params).id, actorOf(req).name);
          reply.status(204).send();
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/starter-lists',
        handler: async (req) => addStarterList(db, parse(z.object({ trade: z.enum(STARTER_TRADES) }), req.body).trade, actorOf(req).name)
      }
    ];
  }
};
