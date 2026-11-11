import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { brandKey, STARTER_LISTS, STARTER_TRADES, starterTradeFor } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { addStarterList } from './brands.ts';

let db: Db;
let app: FastifyInstance;

type Headers = Record<string, string>;
const APP = { 'x-qasa-client': '1' };
const mer: Headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, h: Headers = mer) =>
  app.inject({ method, url, headers: { ...APP, ...h }, ...(body !== undefined ? { payload: body as object } : {}) });
const names = (en: string) => ({ ar: `${en} ar`, en, ku: `${en} ku` });
const item = async (code: string, extra: object = {}) => {
  const r = await call('POST', '/api/items', { code, name: names(code), unit: 'piece', salePrice: 1_000, saleCurrency: 'IQD', ...extra });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string; categoryId: string | null; brandId: string | null };
};

beforeEach(() => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
});
afterEach(async () => {
  await app.close();
  db.close();
});

describe('subcategories', () => {
  it('are two levels only, list under their category, and a category\'s items include its subcategories\'', async () => {
    const phones = (await call('POST', '/api/item-categories', { name: names('Phones') })).json();
    const smart = await call('POST', '/api/item-categories', { name: names('Smartphones'), parentId: phones.id });
    expect(smart.statusCode, smart.body).toBe(201);
    expect(smart.json()).toMatchObject({ parentId: phones.id });
    const cases = (await call('POST', '/api/item-categories', { name: names('Cases'), parentId: phones.id })).json();
    const tools = (await call('POST', '/api/item-categories', { name: names('Tools') })).json();

    // no third level, no parent that isn't there, no category its own parent
    expect((await call('POST', '/api/item-categories', { name: names('Deep'), parentId: smart.json().id })).json())
      .toMatchObject({ error: 'validation', details: [{ code: 'category_parent_invalid' }] });
    expect((await call('POST', '/api/item-categories', { name: names('Lost'), parentId: 'nope' })).statusCode).toBe(400);
    expect((await call('PUT', `/api/item-categories/${tools.id}`, { name: tools.name, parentId: tools.id })).statusCode).toBe(400);
    // a category with subcategories can't become one
    expect((await call('PUT', `/api/item-categories/${phones.id}`, { name: phones.name, parentId: tools.id })).json()).toMatchObject({ error: 'category_has_subcategories' });

    // tree order: each category followed by its subcategories
    const list = (await call('GET', '/api/item-categories')).json() as { id: string; children: number }[];
    expect(list.map((c) => c.id)).toEqual([phones.id, smart.json().id, cases.id, tools.id]);
    expect(list[0]!.children).toBe(2);

    const a = await item('A', { categoryId: phones.id });
    const b = await item('B', { categoryId: smart.json().id });
    await item('C', { categoryId: tools.id });
    const ids = async (q: string) => ((await call('GET', `/api/items?${q}`)).json() as { id: string }[]).map((i) => i.id).sort();
    expect(await ids(`categoryId=${phones.id}`)).toEqual([a.id, b.id].sort());
    expect(await ids(`categoryId=${smart.json().id}`)).toEqual([b.id]);

    // in use (subcategories or items): switched off, never deleted
    expect((await call('DELETE', `/api/item-categories/${phones.id}`)).json()).toMatchObject({ error: 'in_use', details: { subcategories: 2 } });
    expect((await call('DELETE', `/api/item-categories/${cases.id}`)).statusCode).toBe(204);
    // a subcategory under a switched-off category is not given; one kept stays
    await call('PUT', `/api/item-categories/${tools.id}`, { name: tools.name, active: false });
    expect((await call('POST', '/api/item-categories', { name: names('Saws'), parentId: tools.id })).statusCode).toBe(400);
    expect(db.prepare("SELECT action FROM audit_log WHERE entity = 'item_category' ORDER BY id").all().map((r) => r.action))
      .toEqual(['create', 'create', 'create', 'create', 'delete', 'update']);
  });
});

describe('brands', () => {
  it('are made, renamed and switched off; one name per brand whatever its case or spaces; in use never deleted', async () => {
    const r = await call('POST', '/api/brands', { name: '  Mann   Filter ', country: 'de', nameAr: 'مان فلتر' });
    expect(r.statusCode, r.body).toBe(201);
    const mann = r.json();
    expect(mann).toMatchObject({ name: 'Mann Filter', country: 'DE', nameAr: 'مان فلتر', nameKu: '', active: true, items: 0 });
    expect((await call('POST', '/api/brands', { name: 'MANN filter' })).json()).toMatchObject({ error: 'brand_exists' });
    expect((await call('POST', '/api/brands', { name: 'X', country: 'ZZ' })).json()).toMatchObject({ error: 'validation', details: [{ code: 'country_invalid' }] });
    expect((await call('POST', '/api/brands', { name: '   ' })).json()).toMatchObject({ details: [{ code: 'name_required' }] });
    expect((await call('POST', '/api/brands', { name: 'x'.repeat(101) })).json()).toMatchObject({ details: [{ code: 'brand_name_too_long' }] });

    const it1 = await item('F-1', { brandId: mann.id });
    expect(it1.brandId).toBe(mann.id);
    // search finds an item by its brand; the brand filter too
    expect(((await call('GET', '/api/items?q=mann')).json() as { id: string }[]).map((i) => i.id)).toEqual([it1.id]);
    await item('F-2');
    expect(((await call('GET', `/api/items?brandId=${mann.id}`)).json() as { id: string }[]).map((i) => i.id)).toEqual([it1.id]);
    expect(((await call('GET', '/api/items?brandId=none')).json() as { code: string }[]).map((i) => i.code)).toEqual(['F-2']);

    const renamed = await call('PUT', `/api/brands/${mann.id}`, { name: 'Mann-Filter', active: false });
    expect(renamed.json()).toMatchObject({ name: 'Mann-Filter', country: 'DE', nameAr: 'مان فلتر', active: false, items: 1 });
    // switched off: not given to another item, kept on the one that has it
    expect((await call('POST', '/api/items', { code: 'F-3', name: names('F-3'), unit: 'piece', salePrice: 0, saleCurrency: 'IQD', brandId: mann.id })).json())
      .toMatchObject({ details: [{ code: 'brand_invalid' }] });
    expect((await call('PUT', `/api/items/${it1.id}`, { name: names('F-1'), unit: 'piece', salePrice: 5, saleCurrency: 'IQD' })).json()).toMatchObject({ brandId: mann.id });
    expect((await call('DELETE', `/api/brands/${mann.id}`)).json()).toMatchObject({ error: 'in_use' });
    const spare = (await call('POST', '/api/brands', { name: 'Spare' })).json();
    expect((await call('DELETE', `/api/brands/${spare.id}`)).statusCode).toBe(204);
    expect(db.prepare("SELECT action FROM audit_log WHERE entity = 'brand' ORDER BY id").all().map((x) => x.action)).toEqual(['create', 'update', 'create', 'delete']);
  });

  it('can be read by anyone signed in, and changed only with the stock permission', async () => {
    const ownerId = (await call('GET', '/api/users')).json()[0].id;
    await call('POST', '/api/plan/trial');
    await call('POST', `/api/users/${ownerId}/password`, { password: 'owner-pass-1' });
    expect((await call('POST', '/api/users', { username: 'las', name: 'Las', roles: ['sales'], password: 'las-pass-1' })).statusCode).toBe(201);
    expect((await call('PUT', '/api/auth/signin', { on: true })).statusCode).toBe(200);
    const login = await call('POST', '/api/auth/login', { username: 'las', password: 'las-pass-1' });
    const las = { cookie: String(login.headers['set-cookie']).split(';')[0]! };
    expect((await call('GET', '/api/brands', undefined, las)).statusCode).toBe(200);
    expect((await call('GET', '/api/item-categories', undefined, las)).statusCode).toBe(200);
    for (const [method, url, body] of [['POST', '/api/brands', { name: 'Bosch' }], ['POST', '/api/starter-lists', { trade: 'general' }], ['POST', '/api/item-categories', { name: names('X') }]] as const) {
      expect((await call(method, url, body, las)).json(), url).toMatchObject({ error: 'forbidden', details: { need: 'stock' } });
    }
    expect((await call('GET', '/api/brands')).statusCode).toBe(401);
  });
});

describe('starter lists', () => {
  it('add a trade\'s categories, subcategories and brands once: a second time adds nothing, and what is there by name is kept', async () => {
    // a category and a brand the company has already, in other spellings
    await call('POST', '/api/item-categories', { name: { ar: '', en: 'mobile  PHONES', ku: '' } });
    await call('POST', '/api/brands', { name: 'SAMSUNG' });
    const first = await call('POST', '/api/starter-lists', { trade: 'electronics' });
    expect(first.statusCode, first.body).toBe(200);
    const list = STARTER_LISTS.electronics;
    const subs = list.categories.reduce((s, c) => s + (c.sub?.length ?? 0), 0);
    expect(first.json()).toEqual({ trade: 'electronics', categories: list.categories.length - 1, subcategories: subs, brands: list.brands.length - 1 });
    const again = (await call('POST', '/api/starter-lists', { trade: 'electronics' })).json();
    expect(again).toEqual({ trade: 'electronics', categories: 0, subcategories: 0, brands: 0 });
    const cats = (await call('GET', '/api/item-categories')).json() as { name: { en: string }; parentId: string | null }[];
    expect(cats.filter((c) => c.name.en.toLowerCase().replace(/\s+/g, ' ') === 'mobile phones')).toHaveLength(1);
    // the existing category got the list's subcategories
    expect(cats.filter((c) => c.parentId === (cats.find((x) => x.name.en === 'mobile PHONES') as unknown as { id: string }).id)).toHaveLength(3);
    expect((await call('POST', '/api/starter-lists', { trade: 'nope' })).statusCode).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'starter_list'").get()).toEqual({ n: 2 });
  });

  it('every trade adds cleanly on its own and next to the others, with names in all three languages and 10 to 25 known brands', () => {
    for (const trade of STARTER_TRADES) {
      const list = STARTER_LISTS[trade];
      expect(list.brands.length, trade).toBeGreaterThanOrEqual(10);
      expect(list.brands.length, trade).toBeLessThanOrEqual(25);
      expect(new Set(list.brands.map((b) => brandKey(b.name))).size, trade).toBe(list.brands.length);
      for (const c of list.categories) for (const n of [c.name, ...(c.sub ?? [])]) expect(n.ar && n.en && n.ku, `${trade} ${n.en}`).toBeTruthy();
      const r = addStarterList(db, trade, 'Mer');
      expect(addStarterList(db, trade, 'Mer'), trade).toMatchObject({ categories: 0, subcategories: 0, brands: 0 });
      expect(r.categories + r.subcategories + r.brands, trade).toBeGreaterThanOrEqual(0);
    }
    expect(starterTradeFor(['trade', 'pharmacy'])).toBe('pharmacy');
    expect(starterTradeFor(['trade'])).toBe('general');
  });
});
