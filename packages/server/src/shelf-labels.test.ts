import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';

let db: Db;
let app: FastifyInstance;
type Headers = Record<string, string>;
const owner: Headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const post = (url: string, body: unknown = {}, h: Headers = owner) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const put = (url: string, body: unknown = {}, h: Headers = owner) => app.inject({ method: 'PUT', url, payload: body as object, headers: h });
const get = (url: string, h: Headers = owner) => app.inject({ url, headers: h });
const one = (t: string) => ({ ar: t, en: t, ku: t });

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

type Flag = { itemId: string; unit: string | null; oldPrice: number | null; newPrice: number; currency: string; changedAt: string; barcode: string };
const flags = async (): Promise<Flag[]> => (await get('/api/shelf-labels')).json().rows;

async function newItem(body: object = {}) {
  const r = await post('/api/items', { code: 'MILK', barcode: '6260000000017', name: one('Milk'), unit: 'piece', salePrice: 1_500, saleCurrency: 'IQD', ...body });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string } & Record<string, unknown>;
}

const edit = async (id: string, change: object) => {
  const current = (await get(`/api/items/${id}`)).json();
  const r = await put(`/api/items/${id}`, { ...current, ...change });
  expect(r.statusCode, r.body).toBe(200);
};

describe('shelf labels to reprint', () => {
  it('lists a new item, then the change of price with the price the shelf shows, until printed', async () => {
    const milk = await newItem();
    expect(await flags()).toMatchObject([{ itemId: milk.id, unit: null, oldPrice: null, newPrice: 1_500, currency: 'IQD', barcode: '6260000000017' }]);
    const first = await flags();
    expect((await post('/api/shelf-labels/printed', { rows: first.map((f) => ({ itemId: f.itemId, unit: f.unit, changedAt: f.changedAt })) })).json()).toEqual({ cleared: 1 });
    expect(await flags()).toEqual([]);

    // a name change is no new price
    await edit(milk.id, { name: one('Fresh milk') });
    expect(await flags()).toEqual([]);
    // two changes before printing: the shelf still shows 1,500
    await edit(milk.id, { salePrice: 1_750 });
    await edit(milk.id, { salePrice: 2_000 });
    expect(await flags()).toMatchObject([{ oldPrice: 1_500, newPrice: 2_000 }]);
    // back to what the shelf shows: nothing to reprint
    await edit(milk.id, { salePrice: 1_500 });
    expect(await flags()).toEqual([]);
  });

  it('lists each unit whose price changes (its own price, or the base price × its factor) and drops a unit taken away', async () => {
    const milk = await newItem({ units: [{ unit: 'box', factorMilli: 12_000, barcode: '6260000000024', salePrice: null }] });
    const firstRows = await flags();
    expect(firstRows.map((f) => [f.unit, f.newPrice]).sort()).toEqual([['box', 18_000], [null, 1_500]].sort());
    await post('/api/shelf-labels/printed', { rows: firstRows.map((f) => ({ itemId: f.itemId, unit: f.unit, changedAt: f.changedAt })) });
    // the base price changes: the box follows it (it has no price of its own)
    await edit(milk.id, { salePrice: 2_000 });
    const after = await flags();
    expect(after.map((f) => [f.unit, f.oldPrice, f.newPrice, f.barcode]).sort()).toEqual([['box', 18_000, 24_000, '6260000000024'], [null, 1_500, 2_000, '6260000000017']].sort());
    // the box gets its own price, then is taken away: its row goes
    await edit(milk.id, { units: [] });
    expect((await flags()).map((f) => f.unit)).toEqual([null]);
  });

  it('a change made after the list was read waits for its own label; services are never listed; deleting the item drops its row', async () => {
    const milk = await newItem();
    const read = await flags();
    await edit(milk.id, { salePrice: 1_600 });
    expect((await post('/api/shelf-labels/printed', { rows: read.map((f) => ({ itemId: f.itemId, unit: f.unit, changedAt: f.changedAt })) })).json()).toEqual({ cleared: 0 });
    expect(await flags()).toMatchObject([{ newPrice: 1_600 }]);

    const svc = await post('/api/items', { code: 'DELIVERY', name: one('Delivery'), unit: 'service', salePrice: 2_000, saleCurrency: 'IQD' });
    expect(svc.statusCode).toBe(201);
    expect((await flags()).some((f) => f.itemId === svc.json().id)).toBe(false);

    expect((await app.inject({ method: 'DELETE', url: `/api/items/${milk.id}`, headers: owner })).statusCode).toBe(204);
    expect(await flags()).toEqual([]);
  });

  it('marking labels printed needs the stock permission; reading is open', async () => {
    await newItem();
    expect((await post('/api/shelf-labels/printed', { rows: [] })).statusCode).toBe(400);
    await post('/api/plan/trial');
    const first = (await get('/api/users')).json()[0] as { id: string; username: string };
    expect((await post(`/api/users/${first.id}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
    expect((await post('/api/users', { username: 'raz', name: 'Raz', password: 'raz-pass-123', roles: ['sales', 'pos'] })).statusCode).toBe(201);
    expect((await put('/api/auth/signin', { on: true })).statusCode).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'raz', password: 'raz-pass-123' }, headers: { 'x-qasa-client': '1' } });
    const cashier = { cookie: String(login.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    const rows = (await get('/api/shelf-labels', cashier)).json().rows as Flag[];
    expect(rows).toHaveLength(1);
    expect((await post('/api/shelf-labels/printed', { rows: rows.map((f) => ({ itemId: f.itemId, unit: f.unit, changedAt: f.changedAt })) }, cashier)).statusCode).toBe(403);
  });
});
