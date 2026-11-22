import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { resetLoginThrottle } from './auth.ts';
import { setLicensePublicKeyForTests } from './license.ts';

// Branches and the 2.0 features (books review #6): someone limited to a branch reads, posts and cancels only the
// consignment, gold, wholesale, delivery and daily-supplier records of that branch — by id and in the lists.

let db: Db;
let app: FastifyInstance;
let businessKey: string;
let hq: string; // the head office's warehouse
let erbil: string; // the branch's warehouse
let supplierId: string;
let customerId: string;
let breadId: string;
let owner: Headers;
let sam: Headers; // limited to Erbil; sells, buys, keeps stock and prepares entries

type Headers = Record<string, string>;
const APP = { 'x-qasa-client': '1' };
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, headers: Headers = {}) =>
  app.inject({ method, url, headers: { ...APP, ...headers }, ...(body !== undefined ? { payload: body as object } : {}) });
const post = (url: string, body: unknown = {}, h?: Headers) => req('POST', url, body, h);
const put = (url: string, body: unknown = {}, h?: Headers) => req('PUT', url, body, h);
const get = (url: string, h?: Headers) => req('GET', url, undefined, h);
async function made(r: Awaited<ReturnType<typeof req>>) {
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.json();
}
/** Refused because it is another branch's (not for want of a permission). */
function elsewhere(r: Awaited<ReturnType<typeof req>>) {
  expect(r.statusCode, r.body).toBe(403);
  expect(r.json()).toMatchObject({ error: 'branch_forbidden' });
}

beforeAll(() => {
  const pair = generateKeyPairSync('ed25519');
  setLicensePublicKeyForTests(pair.publicKey.export({ format: 'jwk' }).x!);
  const body = `QASA1.${Buffer.from(JSON.stringify({ v: 1, id: 'QL-TEST-business', plan: 'business', to: 'Test Company', issued: '2026-01-01', expires: null })).toString('base64url')}`;
  businessKey = `${body}.${sign(null, Buffer.from(body), pair.privateKey).toString('base64url')}`;
});

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  const ownerId = (await get('/api/users')).json()[0].id;
  hq = (await get('/api/warehouses')).json()[0].id;
  await made(await post('/api/plan/license', { key: businessKey }));
  erbil = (await made(await post('/api/warehouses', { code: 'ERB', name: { ar: 'أربيل', en: 'Erbil', ku: 'هەولێر' } }))).id;
  for (const [code, en] of [['1812', 'Erbil safe'], ['1813', 'Rep cash'], ['1814', 'Erbil rep cash'], ['1815', 'Driver cash']]) {
    await made(await post('/api/accounts', { parentCode: '181', code, name: { ar: en, en, ku: en } }));
  }
  supplierId = (await made(await post('/api/parties', { type: 'supplier', name: 'Hawler Bakery' }))).id;
  customerId = (await made(await post('/api/parties', { type: 'customer', name: 'Shop A' }))).id;
  breadId = (await made(await post('/api/items', { code: 'SAMOON', name: { ar: 'صمون', en: 'Samoon', ku: 'سەموون' }, unit: 'piece', salePrice: 250, saleCurrency: 'IQD' }))).id;
  const branchId = (await made(await post('/api/branches', { code: 'ERB', name: 'Erbil', city: 'Erbil' }))).id;
  await made(await put(`/api/branches/${branchId}/warehouses`, { warehouseIds: [erbil] }));
  await made(await put(`/api/branches/${branchId}/accounts`, { accounts: ['1812', '1814'] }));
  await post(`/api/users/${ownerId}/password`, { password: 'owner-pass-1' });
  const samId = (await made(await post('/api/users', { username: 'sam', name: 'Sam', roles: ['sales', 'pos', 'preparer', 'storekeeper', 'purchasing'], password: 'sam-pass-1' }))).id;
  await made(await put(`/api/users/${samId}/branches`, { branchIds: [branchId] }));
  await made(await put('/api/auth/signin', { on: true }));
  const login = async (username: string, password: string) => {
    const res = await post('/api/auth/login', { username, password });
    expect(res.statusCode, res.body).toBe(200);
    return { cookie: String(res.headers['set-cookie']).split(';')[0]! };
  };
  owner = await login((db.prepare('SELECT username FROM users WHERE id = ?').get(ownerId) as { username: string }).username, 'owner-pass-1');
  sam = await login('sam', 'sam-pass-1');
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('branches and the 2.0 features', () => {
  it("consignment: another branch's documents, and a supplier whose goods are elsewhere, are not a limited user's", async () => {
    await made(await put(`/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 150 }, owner));
    const receipt = (warehouseId: string) => ({ kind: 'receipt', date: '2026-11-10', supplierId, warehouseId, lines: [{ itemId: breadId, qtyMilli: 10_000 }] });
    const atHq = await made(await post('/api/consignment/docs', receipt(hq), owner));
    const draftAtHq = await made(await post('/api/consignment/docs', receipt(hq), owner));
    await made(await post(`/api/consignment/docs/${atHq.id}/post`, { lang: 'en' }, owner));

    // by id: read, change, post, cancel, delete
    elsewhere(await get(`/api/consignment/docs/${atHq.id}`, sam));
    elsewhere(await put(`/api/consignment/docs/${draftAtHq.id}`, receipt(erbil), sam));
    elsewhere(await post(`/api/consignment/docs/${draftAtHq.id}/post`, { lang: 'en' }, sam));
    elsewhere(await post(`/api/consignment/docs/${atHq.id}/cancel`, {}, sam));
    elsewhere(await req('DELETE', `/api/consignment/docs/${draftAtHq.id}`, undefined, sam));
    // a new one into the head office's warehouse
    elsewhere(await post('/api/consignment/docs', receipt(hq), sam));
    // in the lists
    expect((await get('/api/consignment/docs', sam)).json()).toEqual([]);
    expect((await get('/api/consignment/docs', owner)).json()).toHaveLength(2);
    // the supplier's goods are in the head office: the statement and a settlement are the head office's
    expect((await get('/api/consignment', sam)).json().suppliers).toEqual([]);
    elsewhere(await get(`/api/consignment/statement/${supplierId}`, sam));
    elsewhere(await get(`/api/consignment/settlements/preview?supplierId=${supplierId}&currency=IQD&date=2026-11-20`, sam));
    elsewhere(await post('/api/consignment/settlements', { supplierId, currency: 'IQD', date: '2026-11-20', lang: 'en' }, sam));

    // their own branch's document is theirs
    const mine = await post('/api/consignment/docs', receipt(erbil), sam);
    expect(mine.statusCode, mine.body).toBe(201);
    expect((await get('/api/consignment/docs', sam)).json().map((d: { id: string }) => d.id)).toEqual([mine.json().id]);
    expect((await get(`/api/consignment/docs/${mine.json().id}`, sam)).statusCode).toBe(200);
  });

  it("gold: another branch's documents by id and in the list; the gold on hand and owed are the whole company's", async () => {
    const ring = (await made(await post('/api/items', { code: 'RING', name: { ar: 'خاتم', en: 'Ring', ku: 'ئەنگوستیلە' }, unit: 'piece', salePrice: 0, saleCurrency: 'IQD' }, owner))).id;
    await made(await put(`/api/gold/items/${ring}`, { weightMg: 5000, karat: 21, makingKind: 'gram', makingAmount: 5_000 }, owner));
    const receipt = (warehouseId: string) => ({ kind: 'receipt', date: '2026-11-10', partyId: supplierId, warehouseId, pricePerGram: 120_000, lines: [{ itemId: ring }] });
    const atHq = await made(await post('/api/gold/docs', receipt(hq), owner));
    // old gold bought with the head office's safe
    const bought = await made(await post('/api/gold/docs', { kind: 'buy', date: '2026-11-10', customerName: 'Walk-in', karat: 21, weightMg: 10_000, pricePerGram: 90_000, cashAccount: '1811' }, owner));

    for (const id of [atHq.id, bought.id]) {
      elsewhere(await get(`/api/gold/docs/${id}`, sam));
      elsewhere(await post(`/api/gold/docs/${id}/post`, { lang: 'en' }, sam));
      elsewhere(await req('DELETE', `/api/gold/docs/${id}`, undefined, sam));
    }
    elsewhere(await post('/api/gold/docs', receipt(hq), sam));
    elsewhere(await post('/api/gold/docs', { kind: 'buy', date: '2026-11-10', customerName: 'Walk-in', karat: 21, weightMg: 10_000, pricePerGram: 90_000, cashAccount: '1811' }, sam));
    expect((await get('/api/gold/docs', sam)).json()).toEqual([]);
    expect((await get('/api/gold/docs', owner)).json()).toHaveLength(2);
    elsewhere(await get('/api/gold/stock', sam));
    elsewhere(await get('/api/gold/suppliers', sam));
  });

  it("wholesale: another branch's rep, van, orders, collections and handovers; cash is handed over to the branch's own safe", async () => {
    const van = (await made(await post('/api/warehouses', { code: 'VAN1', name: { ar: 'سيارة', en: 'Van 1', ku: 'ئۆتۆمبێل' } }, owner))).id;
    const users = (await get('/api/users', owner)).json() as { id: string; username: string }[];
    const repUser = (await made(await post('/api/users', { username: 'las', name: 'Las', roles: ['sales'], password: 'las-pass-1' }, owner))).id;
    const hqRep = (await made(await post('/api/wholesale/reps', { userId: repUser, name: 'Las', warehouseId: van, loadWarehouseId: hq, cashAccount: '1813' }, owner))).id;
    await made(await put('/api/wholesale/settings', { officeCashAccount: '1811' }, owner));
    const order = await made(await post('/api/wholesale/orders', {
      repId: hqRep, partyId: customerId, date: '2026-11-10', currency: 'IQD', rateX100: 100, lines: [{ itemId: breadId, qtyMilli: 10_000, unitPrice: 250 }]
    }, owner));
    const collection = await made(await post('/api/wholesale/collections', { repId: hqRep, partyId: customerId, date: '2026-11-10', currency: 'IQD', rateX100: 100, amount: 1_000 }, owner));
    expect(users.length).toBeGreaterThan(0);

    // the rep and his van
    expect((await get('/api/wholesale/reps', sam)).json()).toEqual([]);
    elsewhere(await get(`/api/wholesale/reps/${hqRep}/day`, sam));
    elsewhere(await get(`/api/wholesale/reps/${hqRep}/van-moves`, sam));
    elsewhere(await post(`/api/wholesale/reps/${hqRep}/van`, { direction: 'load', date: '2026-11-10', lines: [{ itemId: breadId, qtyMilli: 1000 }] }, sam));
    // his orders
    elsewhere(await get(`/api/wholesale/orders/${order.id}`, sam));
    elsewhere(await post(`/api/wholesale/orders/${order.id}/cancel`, {}, sam));
    expect((await get('/api/wholesale/orders', sam)).json()).toEqual([]);
    // his collections and handovers
    expect((await get('/api/wholesale/collections', sam)).json()).toEqual([]);
    expect((await get('/api/wholesale/collections', owner)).json()).toHaveLength(1);
    elsewhere(await get(`/api/wholesale/collections?repId=${hqRep}`, sam));
    elsewhere(await post('/api/wholesale/collections', { repId: hqRep, partyId: customerId, date: '2026-11-10', currency: 'IQD', rateX100: 100, amount: 500 }, sam));
    elsewhere(await post(`/api/wholesale/collections/${collection.id}/cancel`, {}, sam));
    elsewhere(await post('/api/wholesale/handovers', { repId: hqRep, date: '2026-11-10', currency: 'IQD', rateX100: 100 }, sam));
    const sales = (await get('/api/wholesale/reports', sam)).json();
    expect([sales.sales, sales.collections, sales.visits]).toEqual([[], [], []]);

    // a rep of the branch (his van and cash are Erbil's): his cash goes into Erbil's safe, not the head office's
    const erbilVan = (await made(await post('/api/warehouses', { code: 'VAN2', name: { ar: 'سيارة ٢', en: 'Van 2', ku: 'ئۆتۆمبێل ٢' } }, owner))).id;
    const branchId = (await get('/api/branches', owner)).json().branches[0].id;
    await made(await put(`/api/branches/${branchId}/warehouses`, { warehouseIds: [erbil, erbilVan] }, owner));
    const erbilUser = (await made(await post('/api/users', { username: 'raz', name: 'Raz', roles: ['sales'], password: 'raz-pass-1' }, owner))).id;
    const erbilRep = (await made(await post('/api/wholesale/reps', { userId: erbilUser, name: 'Raz', warehouseId: erbilVan, loadWarehouseId: hq, cashAccount: '1814' }, owner))).id;
    expect((await get('/api/wholesale/reps', sam)).json().map((r: { id: string }) => r.id)).toEqual([erbilRep]);
    elsewhere(await post('/api/wholesale/handovers', { repId: erbilRep, date: '2026-11-10', currency: 'IQD', rateX100: 100, toAccount: '1811' }, sam));
    // (into Erbil's safe the branch check lets it through; what the handler then says is its own business)
    expect((await post('/api/wholesale/handovers', { repId: erbilRep, date: '2026-11-10', currency: 'IQD', rateX100: 100, toAccount: '1812' }, sam)).json().error).not.toBe('branch_forbidden');
    // loading his van takes stock out of the head office's warehouse: the head office's storekeeper does that
    elsewhere(await post(`/api/wholesale/reps/${erbilRep}/van`, { direction: 'load', date: '2026-11-10', lines: [{ itemId: breadId, qtyMilli: 1000 }] }, sam));
    expect((await get(`/api/wholesale/reps/${erbilRep}/van-moves`, sam)).json().error).not.toBe('branch_forbidden');
  });

  it("delivery and daily suppliers: another branch's driver, handovers, orders and sheets", async () => {
    const driver = (await made(await post('/api/delivery/drivers', { name: 'Karwan', cashAccount: '1815' }, owner))).id;
    const noCash = (await made(await post('/api/delivery/drivers', { name: 'Dana' }, owner))).id;
    const order = await made(await post('/api/delivery/orders', {
      customerName: 'Rizgar', phone: '07501234567', address: 'Ankawa', warehouseId: hq, payment: 'cod', fee: 1_000, lines: [{ itemId: breadId, qtyMilli: 4000, unitPrice: 250 }]
    }, owner));

    // the head office's driver; one with no cash account belongs to no branch
    expect((await get('/api/delivery/drivers?all=1', sam)).json().map((d: { id: string }) => d.id)).toEqual([noCash]);
    elsewhere(await post('/api/delivery/handovers', { driverId: driver, amount: 1_000, cashAccountCode: '1812' }, sam));
    elsewhere(await get(`/api/delivery/handovers?driverId=${driver}`, sam));
    elsewhere(await get(`/api/delivery/orders/${order.id}`, sam));
    elsewhere(await post(`/api/delivery/orders/${order.id}/status`, { status: 'preparing' }, sam));
    expect((await get('/api/delivery/orders', sam)).json().orders).toEqual([]);

    // a daily supplier's sheet taken in at the head office
    await made(await put(`/api/daily-suppliers/${supplierId}/items`, { items: [{ itemId: breadId, unitCost: 150 }] }, owner));
    const sheet = (warehouseId: string, date: string) => ({ partyId: supplierId, date, warehouseId, lines: [{ itemId: breadId, receivedMilli: 10_000, returnedMilli: 0, unitCost: 150 }] });
    await made(await post('/api/daily-suppliers/receipts', sheet(hq, '2026-11-10'), owner));
    expect((await get(`/api/daily-suppliers/${supplierId}/receipts`, sam)).json()).toEqual([]);
    elsewhere(await post('/api/daily-suppliers/receipts', sheet(hq, '2026-11-11'), sam));
    const mine = await post('/api/daily-suppliers/receipts', sheet(erbil, '2026-11-11'), sam);
    expect(mine.statusCode, mine.body).toBe(201);
    expect((await get(`/api/daily-suppliers/${supplierId}/receipts`, sam)).json().map((r: { id: string }) => r.id)).toEqual([mine.json().id]);
    expect((await get(`/api/daily-suppliers/${supplierId}/receipts`, owner)).json()).toHaveLength(2);
  });

  it("clothing: the sizes and colours of another branch's invoice", async () => {
    const sale = await made(await post('/api/invoices', {
      kind: 'sale', date: '2026-11-10', partyId: customerId, warehouseId: hq, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0, lines: [{ itemId: breadId, qtyMilli: 1000, unitPrice: 250 }]
    }, owner));
    elsewhere(await get(`/api/clothing/invoices/${sale.id}/variants`, sam));
    expect((await get(`/api/clothing/invoices/${sale.id}/variants`, owner)).statusCode).toBe(200);
  });
});
