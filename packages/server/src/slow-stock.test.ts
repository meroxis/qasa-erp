import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { slowStock } from './slow-stock.ts';

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let supplierId: string;
let tea: string;
let rice: string;
let soap: string;
let oil: string;
let service: string;

type Headers = Record<string, string>;
const owner: Headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const post = (url: string, body: unknown = {}, h: Headers = owner) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const put = (url: string, body: unknown = {}, h: Headers = owner) => app.inject({ method: 'PUT', url, payload: body as object, headers: h });
const get = (url: string, h: Headers = owner) => app.inject({ url, headers: h });
const one = (t: string) => ({ ar: t, en: t, ku: t });

const DAY = '2026-11-20';

async function item(code: string, price: number, extra: object = {}) {
  const r = await post('/api/items', { code, name: one(code), unit: 'piece', salePrice: price, saleCurrency: 'IQD', ...extra });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as string;
}

async function invoice(body: object) {
  const draft = await post('/api/invoices', { warehouseId, currency: 'IQD', rateX100: 100, discount: 0, ...body });
  expect(draft.statusCode, draft.body).toBe(201);
  const posted = await post(`/api/invoices/${draft.json().id}/post`);
  expect(posted.statusCode, posted.body).toBe(200);
  return posted.json();
}

const line = (itemId: string, qty: number, price: number) => ({ itemId, qtyMilli: qty * 1000, unitPrice: price });

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  supplierId = (await post('/api/parties', { type: 'supplier', name: 'Wholesaler' })).json().id;
  tea = await item('TEA', 3_000);
  rice = await item('RICE', 12_000);
  soap = await item('SOAP', 1_000);
  oil = await item('OIL', 5_000);
  service = await item('DELIVERY', 2_000, { unit: 'service' });
  // bought in June: 100 tea, 50 rice, 40 soap; the oil only arrives on 1 November
  await invoice({ kind: 'purchase', date: '2026-06-01', partyId: supplierId, payment: 'credit', lines: [line(tea, 100, 2_000), line(rice, 50, 10_000), line(soap, 40, 600)] });
  await invoice({ kind: 'purchase', date: '2026-11-01', partyId: supplierId, payment: 'credit', lines: [line(oil, 10, 4_000)] });
  // tea sells well; rice sold once in July (before the window); soap a little in the window; delivery is a service
  await invoice({ kind: 'sale', date: '2026-07-05', payment: 'cash', cashAccountCode: '1811', lines: [line(rice, 2, 12_000)] });
  await invoice({ kind: 'sale', date: '2026-10-01', payment: 'cash', cashAccountCode: '1811', lines: [line(tea, 40, 3_000), line(soap, 1, 1_000), line(service, 1, 2_000)] });
  await invoice({ kind: 'sale', date: '2026-11-10', payment: 'cash', cashAccountCode: '1811', lines: [line(tea, 30, 3_000)] });
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('dead stock', () => {
  it('lists what is in stock with nothing sold in the window, with its value and last sale; a new item waits a whole window', async () => {
    const res = await get(`/api/brief/reports/slow-stock?date=${DAY}&days=90&mode=dead`);
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json();
    expect(r.rows.map((x: { code: string }) => x.code)).toEqual(['RICE']);
    expect(r.rows[0]).toMatchObject({ qtyMilli: 48_000, value: 480_000, soldMilli: 0, lastSale: '2026-07-05', idleDays: 138, coverDays: null, firstIn: '2026-06-01' });
    expect(r.total).toEqual({ items: 1, qtyMilli: 48_000, value: 480_000 });
    // the oil came in on 1 November: it has not had 90 days to sell, unless asked
    const all = (await get(`/api/brief/reports/slow-stock?date=${DAY}&days=90&mode=dead&includeNew=true`)).json();
    expect(all.rows.map((x: { code: string }) => x.code)).toEqual(['RICE', 'OIL']);
    expect(all.rows[1]).toMatchObject({ lastSale: null, idleDays: 19 });
  });

  it('a return in the window takes the sale off; a shorter window counts what sold in it only', async () => {
    // 30 days back from DAY: tea sold on 10 November, soap only on 1 October
    const r = (await get(`/api/brief/reports/slow-stock?date=${DAY}&days=30&mode=dead`)).json();
    expect(r.rows.map((x: { code: string }) => x.code).sort()).toEqual(['RICE', 'SOAP']);
    // the November tea sale comes back whole: in the window the tea sold nothing, net
    const sold = (await get('/api/invoices?kind=sale')).json();
    const nov = (Array.isArray(sold) ? sold : sold.rows).find((i: { date: string }) => i.date === '2026-11-10');
    const ret = await post(`/api/invoices/${nov.id}/returns`, { date: '2026-11-12', payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 30_000 }] });
    expect(ret.statusCode, ret.body).toBe(201);
    if (ret.json().status !== 'posted') expect((await post(`/api/invoices/${ret.json().id}/post`)).statusCode).toBe(200);
    const after = slowStock(db, { asOf: DAY, days: 30, mode: 'dead', coverDays: 180 });
    expect(after.rows.map((x) => x.code).sort()).toEqual(['RICE', 'SOAP', 'TEA']);
  });
});

describe('slow sellers', () => {
  it('lists items that sell, but whose stock lasts longer than the cover asked for at the window\'s pace', async () => {
    // 90 days: tea sold 70 and holds 30 (39 days of cover); soap sold 1 and holds 39 (3510 days)
    const r = (await get(`/api/brief/reports/slow-stock?date=${DAY}&days=90&mode=slow&coverDays=180`)).json();
    expect(r.rows.map((x: { code: string }) => x.code)).toEqual(['SOAP']);
    expect(r.rows[0]).toMatchObject({ qtyMilli: 39_000, soldMilli: 1_000, coverDays: 3_510, lastSale: '2026-10-01' });
    const tight = (await get(`/api/brief/reports/slow-stock?date=${DAY}&days=90&mode=slow&coverDays=30`)).json();
    expect(tight.rows.map((x: { code: string }) => x.code)).toEqual(['TEA', 'SOAP']);
  });
});

describe('filters and who may read it', () => {
  it('filters by category (subcategories included) and by warehouse, and refuses one that does not exist', async () => {
    const food = (await post('/api/item-categories', { name: one('Food') })).json();
    const grains = (await post('/api/item-categories', { name: one('Grains'), parentId: food.id })).json();
    const item = (await get(`/api/items/${rice}`)).json();
    expect((await put(`/api/items/${rice}`, { ...item, categoryId: grains.id })).statusCode).toBe(200);
    const r = (await get(`/api/brief/reports/slow-stock?date=${DAY}&days=90&mode=dead&includeNew=true&categoryId=${food.id}`)).json();
    expect(r.rows.map((x: { code: string }) => x.code)).toEqual(['RICE']);
    expect(r.rows[0].categoryName).toEqual(one('Grains'));
    expect((await get(`/api/brief/reports/slow-stock?warehouseId=${warehouseId}&date=${DAY}`)).json().rows.length).toBe(1);
    expect((await get('/api/brief/reports/slow-stock?warehouseId=nope')).statusCode).toBe(400);
    expect((await get('/api/brief/reports/slow-stock?categoryId=nope')).statusCode).toBe(400);
    expect((await get('/api/brief/reports/slow-stock?days=3')).statusCode).toBe(400);
  });

  it('a cashier reads what sits on the shelf, without what it cost', async () => {
    await post('/api/plan/trial');
    const first = (await get('/api/users')).json()[0] as { id: string; username: string };
    expect((await post(`/api/users/${first.id}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
    expect((await post('/api/users', { username: 'raz', name: 'Raz', password: 'raz-pass-123', roles: ['sales', 'pos'] })).statusCode).toBe(201);
    expect((await put('/api/auth/signin', { on: true })).statusCode).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'raz', password: 'raz-pass-123' }, headers: { 'x-qasa-client': '1' } });
    const cashier = { cookie: String(login.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    const r = await get(`/api/brief/reports/slow-stock?date=${DAY}&days=90&mode=dead`, cashier);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().rows[0]).toMatchObject({ code: 'RICE', qtyMilli: 48_000 });
    expect(r.json().rows[0].value).toBeUndefined();
    expect(r.json().total.value).toBeUndefined();
  });
});
