import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { resetLoginThrottle } from './auth.ts';
import { setLicensePublicKeyForTests } from './license.ts';
import { branchesApi } from './branches.ts';

let db: Db;
let app: FastifyInstance;
let businessKey: string;
let proKey: string;
let ownerId: string;
let hq: string; // the default warehouse (head office)
let erbil: string; // a branch's warehouse
let customerId: string;
let itemId: string;

type Headers = Record<string, string>;
const APP = { 'x-qasa-client': '1' };
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, headers: Headers = {}) =>
  app.inject({ method, url, headers: { ...APP, ...headers }, ...(body !== undefined ? { payload: body as object } : {}) });
const post = (url: string, body: unknown = {}, h?: Headers) => req('POST', url, body, h);
const put = (url: string, body: unknown = {}, h?: Headers) => req('PUT', url, body, h);
const get = (url: string, h?: Headers) => req('GET', url, undefined, h);

beforeAll(() => {
  const pair = generateKeyPairSync('ed25519');
  setLicensePublicKeyForTests(pair.publicKey.export({ format: 'jwk' }).x!);
  const key = (plan: string) => {
    const body = `QASA1.${Buffer.from(JSON.stringify({ v: 1, id: `QL-TEST-${plan}`, plan, to: 'Test Company', issued: '2026-01-01', expires: null })).toString('base64url')}`;
    return `${body}.${sign(null, Buffer.from(body), pair.privateKey).toString('base64url')}`;
  };
  businessKey = key('business');
  proKey = key('pro');
});

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  // until branchesApi is in BUILT_IN_FEATURES; then plain buildApp(db)
  app = buildApp(db);
  ownerId = (await get('/api/users')).json()[0].id;
  hq = (await get('/api/warehouses')).json()[0].id;
  // a second warehouse needs a paid plan
  { const lic = await post('/api/plan/license', { key: businessKey }); expect(lic.statusCode, lic.body).toBe(200); }
  erbil = (await post('/api/warehouses', { code: 'ERB', name: { ar: 'أربيل', en: 'Erbil', ku: 'هەولێر' } })).json().id;
  expect((await post('/api/accounts', { parentCode: '181', code: '1812', name: { ar: 'قاصة أربيل', en: 'Erbil safe', ku: 'قاسەی هەولێر' } })).statusCode).toBe(201);
  customerId = (await post('/api/parties', { type: 'customer', name: 'Aram', accountCode: '1612' })).json().id;
  itemId = (await post('/api/items', { code: 'AC', name: { ar: 'مكيف', en: 'AC', ku: 'سپلیت' }, unit: 'service', salePrice: 100_000, saleCurrency: 'IQD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

const sale = (warehouseId: string) => ({
  kind: 'sale', date: '2026-10-01', partyId: customerId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
  lines: [{ itemId, qtyMilli: 1000, unitPrice: 100_000 }]
});
const receipt = (cashAccountCode: string) => ({
  kind: 'receipt', date: '2026-10-01', cashAccountCode, description: 'Receipt', currency: 'IQD', rateX100: 100, items: [{ accountCode: '1612', amount: 50_000, partyId: customerId }]
});

/** A Business company with an Erbil branch (its warehouse and safe) and a salesman limited to it, signed in. */
async function erbilBranch(): Promise<{ branchId: string; sami: Headers; owner: Headers }> {
  { const lic = await post('/api/plan/license', { key: businessKey }); expect(lic.statusCode, lic.body).toBe(200); }
  const branch = await post('/api/branches', { code: 'ERB', name: 'Erbil', city: 'Erbil' });
  expect(branch.statusCode, branch.body).toBe(201);
  const branchId = branch.json().id;
  expect((await put(`/api/branches/${branchId}/warehouses`, { warehouseIds: [erbil] })).statusCode).toBe(200);
  expect((await put(`/api/branches/${branchId}/accounts`, { accounts: ['1812'] })).statusCode).toBe(200);
  await post(`/api/users/${ownerId}/password`, { password: 'owner-pass-1' });
  const samiId = (await post('/api/users', { username: 'sami', name: 'Sami', roles: ['sales', 'preparer', 'storekeeper'], password: 'sami-pass-1' })).json().id;
  expect((await put(`/api/users/${samiId}/branches`, { branchIds: [branchId] })).statusCode).toBe(200);
  expect((await put('/api/auth/signin', { on: true })).statusCode).toBe(200);
  const login = async (username: string, password: string) => {
    const res = await post('/api/auth/login', { username, password });
    expect(res.statusCode, res.body).toBe(200);
    return { cookie: String(res.headers['set-cookie']).split(';')[0]! };
  };
  return { branchId, sami: await login('sami', 'sami-pass-1'), owner: await login((db.prepare('SELECT username FROM users WHERE id = ?').get(ownerId) as { username: string }).username, 'owner-pass-1') };
}

describe('branches', () => {
  it('a warehouse or a safe belongs to one branch only; safes must be postable accounts under 18', async () => {
    { const lic = await post('/api/plan/license', { key: businessKey }); expect(lic.statusCode, lic.body).toBe(200); }
    const a = (await post('/api/branches', { code: 'A', name: 'A' })).json().id;
    const b = (await post('/api/branches', { code: 'B', name: 'B' })).json().id;
    expect((await post('/api/branches', { code: 'A', name: 'Again' })).json().details).toContainEqual({ code: 'bn_code_taken' });
    expect((await put(`/api/branches/${a}/warehouses`, { warehouseIds: [erbil] })).statusCode).toBe(200);
    expect((await put(`/api/branches/${b}/warehouses`, { warehouseIds: [erbil] })).json()).toMatchObject({ error: 'bn_warehouse_in_other_branch' });
    expect((await put(`/api/branches/${a}/accounts`, { accounts: ['181'] })).statusCode).toBe(400);
    expect((await put(`/api/branches/${a}/accounts`, { accounts: ['1612'] })).statusCode).toBe(400);
    expect((await put(`/api/branches/${a}/accounts`, { accounts: ['1812'] })).json().accounts).toEqual(['1812']);
    expect((await put(`/api/branches/${b}/accounts`, { accounts: ['1812'] })).json()).toMatchObject({ error: 'bn_account_in_other_branch' });
    // moving it: take it off A first
    expect((await put(`/api/branches/${a}/warehouses`, { warehouseIds: [] })).statusCode).toBe(200);
    expect((await put(`/api/branches/${b}/warehouses`, { warehouseIds: [erbil] })).json().warehouses).toEqual([{ id: erbil, code: 'ERB' }]);
  });

  it('needs the Business plan to make and change branches and to limit users; lifting a limit always works', async () => {
    expect((await post('/api/plan/license', { key: proKey })).statusCode).toBe(200);
    expect((await post('/api/branches', { code: 'A', name: 'A' })).json()).toMatchObject({ error: 'plan_limit', details: { limit: 'branches' } });
    expect((await get('/api/branches')).json()).toMatchObject({ available: false, branches: [] });
    expect((await put(`/api/users/${ownerId}/branches`, { branchIds: [] })).statusCode).toBe(200);
  });

  it('a user limited to a branch sees and uses only its warehouses and safes', async () => {
    const { sami, owner } = await erbilBranch();
    // pickers
    expect((await get('/api/warehouses', sami)).json().map((w: { id: string }) => w.id)).toEqual([erbil]);
    const safes = (await get('/api/accounts', sami)).json().filter((a: { code: string; postable: boolean }) => a.code.startsWith('18') && a.postable).map((a: { code: string }) => a.code);
    expect(safes).toEqual(['1812']);
    // documents outside the branch are refused
    expect((await post('/api/invoices', sale(hq), sami)).json()).toMatchObject({ error: 'branch_forbidden' });
    const mine = await post('/api/invoices', sale(erbil), sami);
    expect(mine.statusCode, mine.body).toBe(201);
    expect((await post('/api/vouchers', receipt('1811'), sami)).json()).toMatchObject({ error: 'branch_forbidden' });
    expect((await post('/api/vouchers', receipt('1812'), sami)).statusCode).toBe(201);
    // the head office's documents are neither listed nor opened
    const theirs = (await post('/api/invoices', sale(hq), owner)).json();
    const hqVoucher = (await post('/api/vouchers', receipt('1811'), owner)).json();
    expect((await get('/api/invoices', sami)).json().map((i: { id: string }) => i.id)).toEqual([mine.json().id]);
    expect((await get(`/api/invoices/${theirs.id}`, sami)).statusCode).toBe(403);
    expect((await post(`/api/invoices/${theirs.id}/post`, {}, sami)).statusCode).toBe(403);
    const entries = (await get('/api/entries', sami)).json().map((e: { id: string }) => e.id);
    expect(entries).not.toContain(hqVoucher.id);
    expect(entries).toHaveLength(1);
    expect((await get(`/api/entries/${hqVoucher.id}`, sami)).statusCode).toBe(403);
    // the owner (an admin) is not limited
    expect((await get('/api/invoices', owner)).json()).toHaveLength(2);
    expect((await get('/api/warehouses', owner)).json()).toHaveLength(2);
  });

  it('transfers go from the user’s branch to any branch; the receiving branch sees them', async () => {
    const { sami, owner } = await erbilBranch();
    const goods = (await post('/api/items', { code: 'PANEL', name: { ar: 'لوح', en: 'Panel', ku: 'پانێڵ' }, unit: 'piece', salePrice: 90_000, saleCurrency: 'IQD' }, owner)).json().id;
    const toHq = { kind: 'transfer', date: '2026-10-02', warehouseId: erbil, toWarehouseId: hq, lines: [{ itemId: goods, qtyMilli: 1000 }] };
    const out = await post('/api/stock-docs', toHq, sami);
    expect(out.statusCode, out.body).toBe(201);
    expect((await post('/api/stock-docs', { ...toHq, warehouseId: hq, toWarehouseId: erbil }, sami)).json()).toMatchObject({ error: 'branch_forbidden' });
    const incoming = (await post('/api/stock-docs', { ...toHq, warehouseId: hq, toWarehouseId: erbil }, owner)).json();
    const listed = (await get('/api/stock-docs', sami)).json().map((d: { id: string }) => d.id);
    expect(listed).toContain(incoming.id);
    expect((await get(`/api/stock-docs/${incoming.id}`, sami)).statusCode).toBe(200);
    expect((await post(`/api/stock-docs/${incoming.id}/post`, {}, sami)).statusCode).toBe(403);
  });

  it('reports follow the branch: picked by an admin, forced for a limited user', async () => {
    const { branchId, sami, owner } = await erbilBranch();
    for (const [w, h] of [[erbil, sami], [hq, owner]] as const) {
      const inv = (await post('/api/invoices', sale(w), h)).json();
      expect((await post(`/api/invoices/${inv.id}/post`, {}, owner)).statusCode).toBe(200);
    }
    const sales = async (h: Headers, q = '') => (await get(`/api/brief/reports/sales-by-customer?from=2026-10-01&to=2026-10-31${q}`, h)).json();
    expect((await sales(owner)).rows[0].sales).toBe(200_000);
    expect((await sales(owner, `&branchId=${branchId}`)).rows[0].sales).toBe(100_000);
    expect((await sales(sami)).rows[0].sales).toBe(100_000);
    // the header the app sends from the branch switcher works like the query
    expect((await get('/api/brief/reports/sales-by-customer?from=2026-10-01&to=2026-10-31', { ...owner, 'x-qasa-branch': branchId })).json().rows[0].sales).toBe(100_000);
    const other = (await post('/api/branches', { code: 'BGD', name: 'Baghdad' }, owner)).json().id;
    expect((await get(`/api/brief?date=2026-10-01&branchId=${other}`, sami)).statusCode).toBe(403);
    const brief = (await get('/api/brief?date=2026-10-01', sami)).json();
    expect(brief.sales.today).toBe(100_000);
    expect(brief.cash.accounts.every((a: { code: string }) => a.code === '1812')).toBe(true);
    const stock = (await get('/api/brief/reports/stock-value?date=2026-10-31', sami)).json();
    expect(stock.warehouses.map((w: { warehouseId: string }) => w.warehouseId)).toEqual([erbil]);
  });

  it('lists what the switcher offers', async () => {
    const { branchId, sami, owner } = await erbilBranch();
    expect((await get('/api/branches/mine', sami)).json()).toMatchObject({ limited: true, branches: [{ id: branchId, code: 'ERB' }] });
    expect((await get('/api/branches/mine', owner)).json()).toMatchObject({ limited: false, branches: [{ id: branchId }] });
  });
});
