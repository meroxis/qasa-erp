import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { firstStepsFacts } from './brief.ts';

// The home page's first steps asked for every item, party and posted sale to count them: in a big company that was
// megabytes at each visit (bench/big-company.ts). Now one small answer, yes or no for each.

let db: Db;
let app: FastifyInstance;
let warehouseId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const get = (url: string) => app.inject({ url, headers });

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

const has = (sql: string) => (db.prepare(sql).get() ? 1 : 0);

describe('first steps', () => {
  it('says what the company has, as 1 or 0', async () => {
    const fresh = await get('/api/brief/first-steps');
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect(fresh.json()).toEqual({
      items: has('SELECT 1 FROM items'), parties: has('SELECT 1 FROM parties'), customers: has("SELECT 1 FROM parties WHERE type = 'customer'"), sales: 0
    });

    const supplier = (await post('/api/parties', { type: 'supplier', name: 'RapidNet Ltd' })).json().id;
    const item = (await post('/api/items', { code: 'AC-18', name: { ar: 'مكيف', en: 'AC', ku: 'سپلیت' }, unit: 'piece', salePrice: 800_000, saleCurrency: 'IQD' })).json().id;
    expect((await get('/api/brief/first-steps')).json()).toMatchObject({ items: 1, parties: 1 });

    const customer = (await post('/api/parties', { type: 'customer', name: 'Bazaar' })).json().id;
    expect((await get('/api/brief/first-steps')).json()).toMatchObject({ customers: 1, sales: 0 });

    const lines = [{ itemId: item, qtyMilli: 1000, unitPrice: 900_000 }];
    const bought = await post('/api/invoices', { kind: 'purchase', date: '2026-10-01', warehouseId, currency: 'IQD', rateX100: 100, discount: 0, partyId: supplier, payment: 'credit', lines });
    expect((await post(`/api/invoices/${bought.json().id}/post`)).statusCode).toBe(200);
    // a draft sale is not a sale yet
    const draft = await post('/api/invoices', { kind: 'sale', date: '2026-10-02', warehouseId, currency: 'IQD', rateX100: 100, discount: 0, partyId: customer, payment: 'credit', lines });
    expect(draft.statusCode, draft.body).toBe(201);
    expect((await get('/api/brief/first-steps')).json().sales).toBe(0);
    expect((await post(`/api/invoices/${draft.json().id}/post`)).statusCode).toBe(200);
    expect((await get('/api/brief/first-steps')).json()).toEqual({ items: 1, parties: 1, customers: 1, sales: 1 });
  });

  it('counts the sales of the warehouses a user limited to branches works in only', async () => {
    const item = (await post('/api/items', { code: 'AC-18', name: { ar: 'مكيف', en: 'AC', ku: 'سپلیت' }, unit: 'piece', salePrice: 800_000, saleCurrency: 'IQD' })).json().id;
    const customer = (await post('/api/parties', { type: 'customer', name: 'Bazaar' })).json().id;
    const draft = await post('/api/invoices', {
      kind: 'sale', date: '2026-10-02', warehouseId, currency: 'IQD', rateX100: 100, discount: 0, partyId: customer, payment: 'credit',
      lines: [{ itemId: item, qtyMilli: 1000, unitPrice: 900_000 }]
    });
    expect(draft.statusCode, draft.body).toBe(201);
    // posted as far as this question goes (the stock it would need is beside the point here)
    db.prepare("UPDATE invoices SET status = 'posted' WHERE id = ?").run(draft.json().id);
    expect(firstStepsFacts(db).sales).toBe(1);
    expect(firstStepsFacts(db, [warehouseId]).sales).toBe(1);
    expect(firstStepsFacts(db, ['another-warehouse']).sales).toBe(0);
    // a user whose branches have no warehouse sees none
    expect(firstStepsFacts(db, []).sales).toBe(0);
  });

  it('the home page no longer loads every item, party and sale for its first steps', () => {
    const home = readFileSync(new URL('../../../apps/web/src/pages/Home.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const card = home.slice(home.indexOf('function FirstSteps('), home.indexOf('function FirstSteps(') + 1500);
    expect(card).toContain('briefApi.firstSteps()');
    expect(card).not.toContain('api.items()');
    expect(card).not.toContain('api.parties()');
    expect(card).not.toContain("api.invoices({ kind: 'sale'");
  });
});

describe('items by id', () => {
  it('answers some items by id, and refuses a list too long', async () => {
    const a = (await post('/api/items', { code: 'A-1', barcode: '6290000000200', name: { ar: 'أ', en: 'A', ku: 'ئ' }, unit: 'piece', salePrice: 1000, saleCurrency: 'IQD' })).json().id;
    await post('/api/items', { code: 'B-1', name: { ar: 'ب', en: 'B', ku: 'ب' }, unit: 'piece', salePrice: 1000, saleCurrency: 'IQD' });
    const some = await get(`/api/items?ids=${a},${a},nothing`);
    expect(some.statusCode, some.body).toBe(200);
    expect(some.json().map((i: { code: string; barcode: string }) => [i.code, i.barcode])).toEqual([['A-1', '6290000000200']]);
    const many = await get(`/api/items?ids=${Array.from({ length: 501 }, (_, i) => `x${i}`).join(',')}`);
    expect(many.statusCode).toBe(400);
  });
});
