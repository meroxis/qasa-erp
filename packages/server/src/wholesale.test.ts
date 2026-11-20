import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { getEntry } from './journal.ts';
import { writeSetting } from './settings.ts';

// Wholesale and distribution: reps and their routes, van loads and the day's count, sales orders with credit control,
// delivery as a posted sale invoice, collections into the rep's cash and handovers to the office; who sees what.

let db: Db;
let app: FastifyInstance;
let mainId: string;
let vanId: string;
let van2Id: string;
let teaId: string;
let shopA: string;
let shopB: string;
let shopC: string;
let admin: Record<string, string>;
let razH: Record<string, string>;
let lasH: Record<string, string>;
let office: Record<string, string>;
let keeper: Record<string, string>;
let razId: string;
let lasId: string;

type H = Record<string, string>;
const call = (h: H, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) =>
  app.inject({ method, url, headers: h, ...(body === undefined ? {} : { payload: body as object }) });
async function ok(h: H, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const r = await call(h, method, url, body);
  expect(r.statusCode, `${method} ${url}: ${r.body}`).toBeLessThan(300);
  return r.json();
}
async function signIn(username: string, password: string): Promise<H> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: { 'x-qasa-client': '1' } });
  expect(res.statusCode, res.body).toBe(200);
  return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
}
const balanceOf = (code: string) => Number((db.prepare(`SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS b FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                                                         WHERE l.account_code = ? AND e.status = 'approved'`).get(code) as { b: number }).b);
const stockIn = (warehouseId: string) => Number((db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE item_id = ? AND warehouse_id = ?').get(teaId, warehouseId) as { q: number }).q);
const one = (n: string) => ({ ar: n, en: n, ku: n });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T09:00:00Z')); // a Friday (weekday 5)
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  const owner: H = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
  // the plan is checked first, before anything is set up
  const early = await call(owner, 'PUT', '/api/wholesale/settings', { overdueDays: 30 });
  expect(early.statusCode).toBe(409);
  expect(early.json()).toMatchObject({ error: 'plan_limit', details: { limit: 'wholesale' } });
  await ok(owner, 'POST', '/api/plan/trial');

  mainId = (await ok(owner, 'GET', '/api/warehouses'))[0].id;
  vanId = (await ok(owner, 'POST', '/api/warehouses', { code: 'VAN1', name: one('Van 1') })).id;
  van2Id = (await ok(owner, 'POST', '/api/warehouses', { code: 'VAN2', name: one('Van 2') })).id;
  await ok(owner, 'POST', '/api/accounts', { parentCode: '181', code: '1812', name: one('Raz cash') });
  await ok(owner, 'POST', '/api/accounts', { parentCode: '181', code: '1813', name: one('Las cash') });
  teaId = (await ok(owner, 'POST', '/api/items', { code: 'TEA', name: one('Tea'), unit: 'piece', salePrice: 2_000, saleCurrency: 'IQD', units: [{ unit: 'carton', factorMilli: 24_000, salePrice: 45_000 }] })).id;
  shopA = (await ok(owner, 'POST', '/api/parties', { type: 'customer', name: 'Shop A', creditLimit: 100_000 })).id;
  shopB = (await ok(owner, 'POST', '/api/parties', { type: 'customer', name: 'Shop B' })).id;
  shopC = (await ok(owner, 'POST', '/api/parties', { type: 'customer', name: 'Shop C' })).id;
  const opening = await ok(owner, 'POST', '/api/stock-docs', { kind: 'opening', date: '2026-09-01', warehouseId: mainId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 500_000, unitCost: 1_200 }] });
  await ok(owner, 'POST', `/api/stock-docs/${opening.id}/post`);

  // users: the admin, two reps, someone in the office who prepares entries, and the storekeeper
  const first = (await ok(owner, 'GET', '/api/users'))[0] as { id: string; username: string };
  await ok(owner, 'POST', `/api/users/${first.id}/password`, { password: 'admin-pass-123' });
  for (const [username, roles] of [['raz', ['sales']], ['las', ['sales']], ['nina', ['sales', 'preparer']], ['kawa', ['storekeeper']]] as const) {
    await ok(owner, 'POST', '/api/users', { username, name: username, password: `${username}-pass-123`, roles });
  }
  await ok(owner, 'PUT', '/api/auth/signin', { on: true });
  admin = await signIn(first.username, 'admin-pass-123');
  razH = await signIn('raz', 'raz-pass-123');
  lasH = await signIn('las', 'las-pass-123');
  office = await signIn('nina', 'nina-pass-123');
  keeper = await signIn('kawa', 'kawa-pass-123');
  const users = await ok(admin, 'GET', '/api/users') as { id: string; username: string }[];
  const userId = (u: string) => users.find((x) => x.username === u)!.id;
  razId = (await ok(admin, 'POST', '/api/wholesale/reps', { userId: userId('raz'), name: 'Raz', warehouseId: vanId, loadWarehouseId: mainId, cashAccount: '1812' })).id;
  lasId = (await ok(admin, 'POST', '/api/wholesale/reps', { userId: userId('las'), name: 'Las', warehouseId: van2Id, loadWarehouseId: mainId, cashAccount: '1813' })).id;
  // Raz drives shops A and B on Fridays, Las shop C
  await ok(admin, 'PUT', `/api/wholesale/reps/${razId}/route`, { weekday: 5, partyIds: [shopB, shopA] });
  await ok(admin, 'PUT', `/api/wholesale/reps/${lasId}/route`, { weekday: 5, partyIds: [shopC] });
  await ok(admin, 'PUT', '/api/wholesale/settings', { officeCashAccount: '1811' });
});

afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  db.close();
});

const order = (partyId: string, cartons: number, extra: object = {}) =>
  ({ partyId, date: '2026-11-20', currency: 'IQD', rateX100: 100, lines: [{ itemId: teaId, unit: 'carton', unitQtyMilli: cartons * 1000, unitPrice: 45_000 }], ...extra });

describe('wholesale and distribution', () => {
  it('sets reps up with a van and a cash account of their own, and their routes in visiting order', async () => {
    const dup = await call(admin, 'POST', '/api/wholesale/reps', { userId: (await ok(admin, 'GET', '/api/wholesale/reps'))[0].userId, name: 'X', warehouseId: mainId, loadWarehouseId: vanId, cashAccount: '1811' });
    expect(dup.statusCode, dup.body).toBe(409);
    expect((await call(razH, 'POST', '/api/wholesale/reps', {})).statusCode).toBe(403);
    const day = await ok(razH, 'GET', `/api/wholesale/reps/${razId}/day`);
    expect(day.stops.map((s: { partyName: string }) => s.partyName)).toEqual(['Shop B', 'Shop A']);
    // a rep sees only themselves
    expect((await ok(razH, 'GET', '/api/wholesale/reps')).map((r: { name: string }) => r.name)).toEqual(['Raz']);
    expect((await call(razH, 'GET', `/api/wholesale/reps/${lasId}/route`)).statusCode).toBe(404);
    expect((await ok(admin, 'GET', '/api/wholesale/reps')).length).toBe(2);
  });

  it('loads the van, takes an order on the route, approves it in the office, delivers it from the van and counts the van', async () => {
    // the storekeeper loads 5 cartons (120 pieces) into Raz's van; a rep can't load their own van
    expect((await call(razH, 'POST', `/api/wholesale/reps/${razId}/van`, { direction: 'load', date: '2026-11-20', lines: [{ itemId: teaId, unit: 'carton', unitQtyMilli: 5000 }] })).statusCode).toBe(403);
    await ok(keeper, 'POST', `/api/wholesale/reps/${razId}/van`, { direction: 'load', date: '2026-11-20', lines: [{ itemId: teaId, unit: 'carton', unitQtyMilli: 5000 }] });
    expect(stockIn(vanId)).toBe(120_000);

    // Raz takes an order for shop B (on his route); not for shop C (Las's)
    expect((await call(razH, 'POST', '/api/wholesale/orders', order(shopC, 1))).statusCode).toBe(403);
    const o = await ok(razH, 'POST', '/api/wholesale/orders', order(shopB, 2));
    expect(o).toMatchObject({ number: 'SO-2026-00001', status: 'draft', total: 90_000, warehouseId: vanId, repId: razId });
    expect(o.lines[0]).toMatchObject({ qtyMilli: 48_000, unit: 'carton', unitQtyMilli: 2000 });
    // Raz can't approve; Las doesn't see it
    expect((await call(razH, 'POST', `/api/wholesale/orders/${o.id}/approve`, {})).statusCode).toBe(403);
    expect((await call(lasH, 'GET', `/api/wholesale/orders/${o.id}`)).statusCode).toBe(404);
    expect((await ok(lasH, 'GET', '/api/wholesale/orders')).length).toBe(0);
    const approved = await ok(office, 'POST', `/api/wholesale/orders/${o.id}/approve`, {});
    expect(approved).toMatchObject({ status: 'approved', limitCheck: 'ok', approvedBy: 'nina' });

    // Raz delivers it from his van: a posted sale invoice on credit, 48 pieces out of the van
    const delivered = await ok(razH, 'POST', `/api/wholesale/orders/${o.id}/deliver`, {});
    expect(delivered.status).toBe('delivered');
    const invoice = await ok(admin, 'GET', `/api/invoices/${delivered.invoiceId}`);
    expect(invoice).toMatchObject({ kind: 'sale', status: 'posted', payment: 'credit', partyId: shopB, warehouseId: vanId, total: 90_000 });
    expect(stockIn(vanId)).toBe(72_000);
    expect((await ok(admin, 'GET', `/api/parties/${shopB}`)).balance).toBe(90_000);

    // the day's van: 0 before, 120 loaded, 48 sold, 72 expected; Raz counts 70, the storekeeper closes the count
    let van = await ok(razH, 'GET', `/api/wholesale/reps/${razId}/van-count?date=2026-11-20`);
    expect(van.rows[0]).toMatchObject({ opening: 0, loaded: 120_000, sold: 48_000, expected: 72_000, counted: null });
    van = await ok(razH, 'PUT', `/api/wholesale/reps/${razId}/van-count`, { date: '2026-11-20', lines: [{ itemId: teaId, countedMilli: 70_000 }] });
    expect(van.rows[0].counted).toBe(70_000);
    expect((await call(razH, 'POST', `/api/wholesale/reps/${razId}/van-count/close`, { date: '2026-11-20' })).statusCode).toBe(403);
    van = await ok(keeper, 'POST', `/api/wholesale/reps/${razId}/van-count/close`, { date: '2026-11-20' });
    expect(van.status).toBe('closed');
    const adj = await ok(keeper, 'GET', `/api/adjustments/${van.adjustmentId}`);
    expect(adj).toMatchObject({ status: 'draft', reason: 'count', warehouseId: vanId });
    expect(adj.lines.map((l: { qtyMilli: number }) => l.qtyMilli)).toEqual([-2_000]);
    expect((await call(razH, 'PUT', `/api/wholesale/reps/${razId}/van-count`, { date: '2026-11-20', lines: [] })).statusCode).toBe(409);

    // unloading what is left back to the main warehouse
    await ok(keeper, 'POST', `/api/wholesale/reps/${razId}/van`, { direction: 'unload', date: '2026-11-20', lines: [{ itemId: teaId, qtyMilli: 72_000 }] });
    expect(stockIn(vanId)).toBe(0);
    const moves = await ok(admin, 'GET', `/api/wholesale/reps/${razId}/van-moves`);
    expect(moves.map((m: { direction: string }) => m.direction).sort()).toEqual(['load', 'unload']);
  });

  it('blocks an order over the credit limit unless an admin overrides it with a reason, and lets a warning through', async () => {
    // shop A may owe 100,000: 3 cartons (135,000) is over it
    const o = await ok(office, 'POST', '/api/wholesale/orders', order(shopA, 3, { repId: razId, warehouseId: mainId }));
    const blocked = await call(office, 'POST', `/api/wholesale/orders/${o.id}/approve`, {});
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: 'ws_credit_blocked', details: { reasons: ['over_limit'], limit: 100_000 } });
    expect((await call(office, 'POST', `/api/wholesale/orders/${o.id}/approve`, { override: { reason: 'Owner said yes' } })).statusCode).toBe(403);
    const over = await ok(admin, 'POST', `/api/wholesale/orders/${o.id}/approve`, { override: { reason: 'Owner said yes' } });
    expect(over).toMatchObject({ status: 'approved', limitCheck: 'override', overrideReason: 'Owner said yes' });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ws_credit_override'").get()).toMatchObject({ n: 1 });
    // delivered from the main warehouse by the office: the invoice's own limit check lets the approved override through
    const delivered = await ok(office, 'POST', `/api/wholesale/orders/${o.id}/deliver`, {});
    expect((await ok(admin, 'GET', `/api/invoices/${delivered.invoiceId}`)).status).toBe('posted');
    expect((await ok(admin, 'GET', `/api/parties/${shopA}`)).balance).toBe(135_000);

    // with the policy at "warn", the next order goes through marked
    await ok(admin, 'PUT', '/api/wholesale/settings', { creditPolicy: 'warn' });
    const o2 = await ok(office, 'POST', '/api/wholesale/orders', order(shopA, 1, { warehouseId: mainId }));
    expect(await ok(office, 'POST', `/api/wholesale/orders/${o2.id}/approve`, {})).toMatchObject({ limitCheck: 'warn' });
    expect((await ok(office, 'POST', `/api/wholesale/orders/${o2.id}/deliver`, {})).status).toBe('delivered');
    const report = await ok(admin, 'GET', '/api/wholesale/reports');
    expect(report.credit.map((c: { name: string }) => c.name)).toEqual(['Shop A']);
    expect(report.sales.find((s: { repId: string | null }) => s.repId === razId)).toMatchObject({ orders: 1, total: 135_000 });
  });

  it('blocks a customer overdue past the days set', async () => {
    await ok(admin, 'PUT', '/api/wholesale/settings', { overdueDays: 30, overduePolicy: 'block' });
    // an old sale to shop B, 50 days ago, still unpaid
    const old = await ok(admin, 'POST', '/api/invoices', {
      kind: 'sale', date: '2026-10-01', partyId: shopB, warehouseId: mainId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0, lines: [{ itemId: teaId, qtyMilli: 1000, unitPrice: 2_000 }]
    });
    await ok(admin, 'POST', `/api/invoices/${old.id}/post`, {});
    const credit = await ok(razH, 'GET', `/api/wholesale/credit/${shopB}`);
    expect(credit).toMatchObject({ overdue: true, verdict: 'block', reasons: ['overdue'] });
    const o = await ok(razH, 'POST', '/api/wholesale/orders', order(shopB, 1));
    expect((await call(office, 'POST', `/api/wholesale/orders/${o.id}/approve`, {})).json().error).toBe('ws_credit_blocked');
    // a rep can't read the credit of a shop off their route
    expect((await call(razH, 'GET', `/api/wholesale/credit/${shopC}`)).statusCode).toBe(403);
  });

  it('collects into the rep’s cash and hands it over to the office safe, both as receipts in the approval flow', async () => {
    const sale = await ok(admin, 'POST', '/api/invoices', {
      kind: 'sale', date: '2026-11-19', partyId: shopA, warehouseId: mainId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0, lines: [{ itemId: teaId, qtyMilli: 20_000, unitPrice: 2_000 }]
    });
    await ok(admin, 'POST', `/api/invoices/${sale.id}/post`, {});
    const c = await ok(razH, 'POST', '/api/wholesale/collections', { partyId: shopA, date: '2026-11-20', currency: 'IQD', rateX100: 100, amount: 25_000 });
    expect(c).toMatchObject({ number: 'CL-2026-00001', state: 'approved', repId: razId, amount: 25_000 });
    expect(getEntry(db, c.entryId).lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([['1812', 25_000, 0], [expect.any(String), 0, 25_000]]);
    expect(balanceOf('1812')).toBe(25_000);
    expect((await ok(admin, 'GET', `/api/parties/${shopA}`)).balance).toBe(15_000);
    // not for a shop off the route; a rep can't hand over their own cash
    expect((await call(razH, 'POST', '/api/wholesale/collections', { partyId: shopC, date: '2026-11-20', currency: 'IQD', rateX100: 100, amount: 1_000 })).statusCode).toBe(403);
    expect((await call(razH, 'POST', '/api/wholesale/handovers', { repId: razId, date: '2026-11-20', currency: 'IQD', rateX100: 100 })).statusCode).toBe(403);
    // the collection's entry belongs to the collection: not deleted from the vouchers page
    expect((await call(admin, 'DELETE', `/api/entries/${c.entryId}`)).statusCode).toBeGreaterThanOrEqual(400);

    const h = await ok(office, 'POST', '/api/wholesale/handovers', { repId: razId, date: '2026-11-20', currency: 'IQD', rateX100: 100 });
    expect(h).toMatchObject({ number: 'HO-2026-00001', amount: 25_000, collections: 1, toAccount: '1811' });
    // nina prepares entries but does not approve her own (separation is off here, so it posts at once)
    expect(balanceOf('1812')).toBe(h.state === 'approved' ? 0 : 25_000);
    expect((await call(office, 'POST', '/api/wholesale/handovers', { repId: razId, date: '2026-11-20', currency: 'IQD', rateX100: 100 })).json().error).toBe('ws_nothing_to_hand_over');
    expect((await ok(razH, 'GET', '/api/wholesale/collections?open=1')).length).toBe(0);
    const report = await ok(admin, 'GET', '/api/wholesale/reports?from=2026-11-01&to=2026-11-30');
    expect(report.collections).toEqual([expect.objectContaining({ repId: razId, IQD: 25_000, handedIQD: 25_000, count: 1 })]);
  });

  it('waits for approval when the company asks for it: a waiting collection is not counted or handed over', async () => {
    writeSetting(db, 'vouchers_need_approval', '1');
    const c = await ok(razH, 'POST', '/api/wholesale/collections', { partyId: shopA, date: '2026-11-20', currency: 'IQD', rateX100: 100, amount: 5_000 });
    expect(c.state).toBe('waiting');
    expect(balanceOf('1812')).toBe(0);
    expect((await call(office, 'POST', '/api/wholesale/handovers', { repId: razId, date: '2026-11-20', currency: 'IQD', rateX100: 100 })).json().error).toBe('ws_nothing_to_hand_over');
  });

  it('records visits and sets them against the route', async () => {
    await ok(razH, 'POST', '/api/wholesale/visits', { partyId: shopA, date: '2026-11-20', outcome: 'no_order' });
    expect((await call(razH, 'POST', '/api/wholesale/visits', { partyId: shopC, date: '2026-11-20', outcome: 'closed' })).statusCode).toBe(403);
    const day = await ok(razH, 'GET', `/api/wholesale/reps/${razId}/day?date=2026-11-20`);
    expect(day.stops.find((s: { partyId: string }) => s.partyId === shopA).visits).toEqual(['no_order']);
    const report = await ok(admin, 'GET', '/api/wholesale/reports?from=2026-11-20&to=2026-11-20');
    expect(report.visits.find((v: { repId: string }) => v.repId === razId)).toMatchObject({ planned: 2, done: 1, unplanned: 0 });
    // Raz sees only his own figures
    expect((await ok(razH, 'GET', '/api/wholesale/reports?from=2026-11-20&to=2026-11-20')).visits.length).toBe(1);
  });

  it('is not for a cashier without sales, and a rep cancels only their own drafts', async () => {
    const users = await ok(admin, 'GET', '/api/users') as { id: string }[];
    expect(users.length).toBeGreaterThan(1);
    await ok(admin, 'POST', '/api/users', { username: 'till', name: 'till', password: 'till-pass-123', roles: ['pos'] });
    const till = await signIn('till', 'till-pass-123');
    expect((await call(till, 'GET', '/api/wholesale/orders')).statusCode).toBe(403);
    const o = await ok(razH, 'POST', '/api/wholesale/orders', order(shopB, 1));
    await ok(office, 'POST', `/api/wholesale/orders/${o.id}/approve`, {});
    expect((await call(razH, 'POST', `/api/wholesale/orders/${o.id}/cancel`, {})).statusCode).toBe(403);
    expect((await ok(office, 'POST', `/api/wholesale/orders/${o.id}/cancel`, { reason: 'shop closed' })).status).toBe('cancelled');
  });
});
