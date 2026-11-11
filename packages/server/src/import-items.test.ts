import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { resetLoginThrottle } from './auth.ts';
import { openDatabase, type Db } from './db.ts';

let db: Db;
let app: FastifyInstance;
const APP = { 'x-qasa-client': '1' };
const mer = { 'x-qasa-user': encodeURIComponent('Mer') };
const call = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, h: Record<string, string> = mer) =>
  app.inject({ method, url, headers: { ...APP, ...h }, ...(body !== undefined ? { payload: body as object } : {}) });

beforeEach(() => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
});
afterEach(async () => {
  await app.close();
  db.close();
});

const row = (code: string, extra: Record<string, string> = {}) => ({ code, nameEn: `Item ${code}`, unit: 'piece', price: '1000', currency: 'IQD', ...extra });
const count = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);

describe('importing items from Excel or CSV (1.1)', () => {
  it('makes unknown categories, subcategories and brands, and puts opening quantities on one draft opening-stock document', async () => {
    await call('POST', '/api/brands', { name: 'Mann-Filter' });
    const rows = [
      row('F-1', { category: 'Engine', subcategory: 'Filters', brand: 'MANN-FILTER', cost: '9000', qty: '24' }),
      row('F-2', { category: 'engine', subcategory: 'filters', brand: 'Bosch', cost: '7000', qty: '10' }),
      row('B-1', { category: 'Brakes', brand: 'bosch' }),
      row('S-1', { unit: 'service' })
    ];
    const preview = await call('POST', '/api/import/items', { rows, dryRun: true });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ created: 4, dryRun: true, documents: [{ type: 'stock_doc' }] });
    // a preview saves nothing
    expect(count('SELECT COUNT(*) AS n FROM items') + count('SELECT COUNT(*) AS n FROM item_categories') + count('SELECT COUNT(*) AS n FROM stock_docs')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM brands')).toBe(1);

    const done = (await call('POST', '/api/import/items', { rows, dryRun: false })).json();
    expect(done).toMatchObject({ created: 4, dryRun: false });
    const cats = db.prepare('SELECT c.name_en, p.name_en AS parent FROM item_categories c LEFT JOIN item_categories p ON p.id = c.parent_id ORDER BY c.sort').all();
    expect(cats).toEqual([{ name_en: 'Engine', parent: null }, { name_en: 'Filters', parent: 'Engine' }, { name_en: 'Brakes', parent: null }]);
    expect((db.prepare('SELECT name FROM brands ORDER BY sort').all() as { name: string }[]).map((b) => b.name)).toEqual(['Mann-Filter', 'Bosch']);
    const items = db.prepare('SELECT i.code, c.name_en AS cat, b.name AS brand FROM items i LEFT JOIN item_categories c ON c.id = i.category_id LEFT JOIN brands b ON b.id = i.brand_id ORDER BY i.code').all();
    expect(items).toEqual([
      { code: 'B-1', cat: 'Brakes', brand: 'Bosch' }, { code: 'F-1', cat: 'Filters', brand: 'Mann-Filter' }, { code: 'F-2', cat: 'Filters', brand: 'Bosch' }, { code: 'S-1', cat: null, brand: null }
    ]);
    const doc = (await call('GET', `/api/stock-docs/${done.documents[0].id}`)).json();
    expect(doc).toMatchObject({ kind: 'opening', status: 'draft' });
    expect(doc.lines.map((l: { qtyMilli: number; unitCost: number }) => [l.qtyMilli, l.unitCost])).toEqual([[24_000, 9_000], [10_000, 7_000]]);
    expect(count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'import'")).toBe(1);
  });

  it('shows every row\'s problem before anything is saved, and saves nothing when one row is wrong', async () => {
    const rows = [
      row('A-1', { category: 'Tools', qty: '5', cost: '100' }),
      row('A-2', { subcategory: 'Lost' }),
      row('A-3', { qty: 'lots' }),
      row('A-4', { unit: 'service', qty: '2' }),
      row('A-5', { brand: 'x'.repeat(101) }),
      row('A-1')
    ];
    const r = (await call('POST', '/api/import/items', { rows, dryRun: true })).json();
    expect(r.error).toBe('validation');
    expect(r.details.map((d: { code: string; line: number }) => [d.line, d.code])).toEqual([
      [3, 'md_subcategory_without_category'], [4, 'md_qty_invalid'], [5, 'md_item_not_stocked'], [6, 'brand_name_too_long'], [7, 'md_duplicate_in_file']
    ]);
    expect((await call('POST', '/api/import/items', { rows, dryRun: false })).statusCode).toBe(400);
    expect(count('SELECT COUNT(*) AS n FROM items') + count('SELECT COUNT(*) AS n FROM item_categories')).toBe(0);
  });

  it('gives an opening quantity to an item listed before only while it has never moved; a second import adds nothing twice', async () => {
    await call('POST', '/api/import/items', { rows: [row('K-1')], dryRun: false });
    const again = (await call('POST', '/api/import/items', { rows: [row('K-1', { qty: '3', cost: '50', category: 'Kits' })], dryRun: false })).json();
    expect(again).toMatchObject({ created: 0, skipped: [{ line: 2, reason: 'exists' }], documents: [{ type: 'stock_doc' }] });
    await call('POST', `/api/stock-docs/${again.documents[0].id}/post`);
    const moved = (await call('POST', '/api/import/items', { rows: [row('K-1', { qty: '3' })], dryRun: true })).json();
    expect(moved.details).toEqual([expect.objectContaining({ code: 'md_item_has_moves', line: 2 })]);
  });

  it('needs the stock permission (not only an admin), and the other imports still need an admin', async () => {
    const ownerId = (await call('GET', '/api/users')).json()[0].id;
    await call('POST', '/api/plan/trial');
    await call('POST', `/api/users/${ownerId}/password`, { password: 'owner-pass-1' });
    for (const [username, roles] of [['las', ['sales']], ['raz', ['storekeeper']]] as const) {
      expect((await call('POST', '/api/users', { username, name: username === 'las' ? 'Las' : 'Raz', roles, password: `${username}-pass-1` })).statusCode).toBe(201);
    }
    expect((await call('PUT', '/api/auth/signin', { on: true })).statusCode).toBe(200);
    const session = async (u: string) => ({ cookie: String((await call('POST', '/api/auth/login', { username: u, password: `${u}-pass-1` })).headers['set-cookie']).split(';')[0]! });
    const las = await session('las');
    const raz = await session('raz');
    expect((await call('POST', '/api/import/items', { rows: [row('X-1')], dryRun: true }, las)).json()).toMatchObject({ error: 'forbidden', details: { need: 'stock' } });
    expect((await call('POST', '/api/import/items', { rows: [row('X-1')], dryRun: true }, raz)).statusCode).toBe(200);
    expect((await call('POST', '/api/import', { kind: 'items', rows: [row('X-1')], dryRun: true }, raz)).statusCode).toBe(403);
    expect((await call('POST', '/api/import/items', { rows: Array.from({ length: 5001 }, (_, i) => row(`R-${i}`)), dryRun: true }, raz)).statusCode).toBe(400);
  });
});
