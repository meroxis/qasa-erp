import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { writeSetting } from './settings.ts';

// The market extras: delivery orders (the board, the sale when delivered, the driver's cash handed over through
// approval), debt reminders, the price checker screens (a device token, nothing but the shelf), and the suppliers who
// deliver every day (one sheet: today's purchase and the returns of what did not sell).

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let stockAccount: string;
let customerId: string;
let supplierId: string;
let milkId: string;
let breadId: string;

type H = Record<string, string>;
const headers: H = { 'x-qasa-user': encodeURIComponent('Mer') };
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, h: H = headers) =>
  app.inject({ method, url, headers: h, ...(body === undefined ? {} : { payload: body as object }) });
async function ok(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, h: H = headers) {
  const r = await call(method, url, body, h);
  expect(r.statusCode, `${method} ${url}: ${r.body}`).toBeLessThan(300);
  return r.statusCode === 204 ? null : r.json();
}
const balanceOf = (code: string) => Number((db.prepare(`SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS b FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                                                         WHERE l.account_code = ? AND e.status = 'approved'`).get(code) as { b: number }).b);
const stockQty = (itemId: string) => Number((db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE item_id = ?').get(itemId) as { q: number }).q);

/** a cash account under 18 for a driver (1812, next to the main safe 1811) */
function driverSafe(code = '1812'): string {
  db.prepare('INSERT INTO accounts (code, name_ar, name_en, name_ku, "system", created_at) VALUES (?, ?, ?, ?, 0, ?)').run(code, 'صندوق السائق', 'Driver cash', 'قاسەی شۆفێر', new Date().toISOString());
  return code;
}

async function stockIn(itemId: string, qty: number, cost: number, date = '2026-11-01') {
  const draft = await ok('POST', '/api/invoices', {
    kind: 'purchase', date, partyId: supplierId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
    lines: [{ itemId, qtyMilli: qty * 1000, unitPrice: cost }]
  });
  await ok('POST', `/api/invoices/${draft.id}/post`, {});
}

async function signInAs(roles: string[]) {
  writeSetting(db, 'separate_duties', '0');
  const owner = (await ok('GET', '/api/users'))[0];
  await ok('POST', `/api/users/${owner.id}/password`, { password: 'admin-pass-123' });
  await ok('POST', '/api/users', { username: 'las', name: 'Las', password: 'las-pass-123', roles });
  await ok('PUT', '/api/auth/signin', { on: true });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'las', password: 'las-pass-123' }, headers: { 'x-qasa-client': '1' } });
  return { cookie: String(login.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T09:00:00Z'));
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await ok('GET', '/api/warehouses'))[0].id;
  stockAccount = (db.prepare('SELECT account_code FROM warehouses WHERE id = ?').get(warehouseId) as { account_code: string }).account_code;
  customerId = (await ok('POST', '/api/parties', { type: 'customer', name: 'Rizgar', phone: '07501234567' })).id;
  supplierId = (await ok('POST', '/api/parties', { type: 'supplier', name: 'Kurdistan Dairy' })).id;
  milkId = (await ok('POST', '/api/items', { code: 'MILK', barcode: '6260000000017', name: { ar: 'حليب', en: 'Milk', ku: 'شیر' }, unit: 'piece', salePrice: 1_500, saleCurrency: 'IQD' })).id;
  breadId = (await ok('POST', '/api/items', { code: 'SAMOON', name: { ar: 'صمون', en: 'Samoon', ku: 'سەموون' }, unit: 'piece', salePrice: 250, saleCurrency: 'IQD' })).id;
});

afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  db.close();
});

const order = (extra: object = {}) => ({
  customerName: 'Rizgar', phone: '07501234567', address: 'Erbil, 100m street, house 12', area: 'Ankawa', warehouseId, payment: 'cod', fee: 2_000,
  lines: [{ itemId: milkId, qtyMilli: 4_000, unitPrice: 1_500 }], ...extra
});

describe('delivery orders', () => {
  it('is behind the plan', async () => {
    const free = await call('POST', '/api/delivery/orders', order());
    expect(free.statusCode).toBe(409);
    expect(free.json()).toMatchObject({ error: 'plan_limit', details: { limit: 'delivery' } });
  });

  it('moves on the board, posts the sale when delivered into the driver’s cash, and the handover waits for approval', async () => {
    await ok('POST', '/api/plan/trial');
    await stockIn(milkId, 10, 1_000);
    const cash = driverSafe();
    const driver = await ok('POST', '/api/delivery/drivers', { name: 'Hemin', phone: '07701112233', cashAccount: cash });
    const keyed = { ...headers, 'x-qasa-idempotency': '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e41' };
    const created = (await call('POST', '/api/delivery/orders', order(), keyed)).json();
    // the same order sent again with its key: the first one back, not a second order (reliability review #6)
    const twice = await call('POST', '/api/delivery/orders', order(), keyed);
    expect(twice.headers['x-qasa-idempotent-replay']).toBe('1');
    expect(twice.json().id).toBe(created.id);
    expect(created).toMatchObject({ status: 'new', number: 'DLV-2026-0001', subtotal: 6_000, fee: 2_000, total: 8_000, next: ['preparing', 'out', 'cancelled'] });
    // nothing in the books or the stock yet
    expect(stockQty(milkId)).toBe(10_000);
    expect((await call('POST', `/api/delivery/orders/${created.id}/status`, { status: 'out' })).json()).toMatchObject({ error: 'validation' });
    await ok('POST', `/api/delivery/orders/${created.id}/status`, { status: 'preparing' });
    const out = await ok('POST', `/api/delivery/orders/${created.id}/status`, { status: 'out', driverId: driver.id });
    expect(out).toMatchObject({ status: 'out', driverName: 'Hemin' });
    expect(out.next).toContain('delivered');
    // the goods can't change once it is out
    expect((await call('PUT', `/api/delivery/orders/${created.id}`, order())).statusCode).toBe(409);
    const done = await ok('POST', `/api/delivery/orders/${created.id}/status`, { status: 'delivered' });
    expect(done).toMatchObject({ status: 'delivered', total: 8_000 });
    expect(done.invoiceNumber).toMatch(/^INV-/);
    expect(stockQty(milkId)).toBe(6_000);
    expect(balanceOf(cash)).toBe(8_000);
    const feeItem = db.prepare("SELECT unit FROM items WHERE code = 'DELIVERY-FEE'").get() as { unit: string };
    expect(feeItem.unit).toBe('service');
    // a delivered order is final on the board
    expect((await call('POST', `/api/delivery/orders/${created.id}/status`, { status: 'cancelled', reason: 'x' })).statusCode).toBe(409);
    const drivers = await ok('GET', '/api/delivery/drivers');
    expect(drivers[0].holding).toBe(8_000);
    // the driver brings the money: a draft entry, so what he holds drops at once but the safe only when it is approved
    expect((await call('POST', '/api/delivery/handovers', { driverId: driver.id, amount: 9_000, cashAccountCode: '1811' })).statusCode).toBe(400);
    const handover = await ok('POST', '/api/delivery/handovers', { driverId: driver.id, amount: 8_000, cashAccountCode: '1811' });
    expect(handover.entryStatus).toBe('draft');
    expect(balanceOf(cash)).toBe(8_000);
    expect((await ok('GET', '/api/delivery/drivers'))[0].holding).toBe(0);
    const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(handover.entryId) as { status: string };
    expect(entry.status).toBe('draft');
    // (accounting review #5) the handover's voucher is changed only from the handover: never edited or deleted here
    expect((await call('PUT', `/api/entries/${handover.entryId}`, { date: '2026-11-20', description: 'x', currency: 'IQD', rateX100: 100,
      lines: [{ accountCode: '1811', debit: 1_000, credit: 0 }, { accountCode: cash, debit: 0, credit: 1_000 }] })).json()).toMatchObject({ error: 'entry_belongs_to_delivery_handover' });
    expect((await call('DELETE', `/api/entries/${handover.entryId}`)).json()).toMatchObject({ error: 'entry_belongs_to_delivery_handover' });
    await ok('POST', `/api/entries/${handover.entryId}/check`, {});
    await ok('POST', `/api/entries/${handover.entryId}/approve`, {});
    expect(balanceOf(cash)).toBe(0);
    expect(balanceOf('1811')).toBe(8_000);
  });

  it('takes a handover back, a draft or one in the books, and the driver holds the cash again (2.0 books review #2)', async () => {
    await ok('POST', '/api/plan/trial');
    await stockIn(milkId, 10, 1_000);
    const cash = driverSafe();
    const driver = await ok('POST', '/api/delivery/drivers', { name: 'Hemin', cashAccount: cash });
    const o = await ok('POST', '/api/delivery/orders', order());
    await ok('POST', `/api/delivery/orders/${o.id}/status`, { status: 'out', driverId: driver.id });
    await ok('POST', `/api/delivery/orders/${o.id}/status`, { status: 'delivered' });
    // sent to the office for 8,000, but he brought 5,000: the draft is taken back, then made again
    const wrong = await ok('POST', '/api/delivery/handovers', { driverId: driver.id, amount: 8_000, cashAccountCode: '1811' });
    expect((await ok('GET', '/api/delivery/drivers'))[0].holding).toBe(0);
    await ok('POST', `/api/delivery/handovers/${wrong.id}/cancel`, {});
    expect(db.prepare('SELECT 1 FROM entries WHERE id = ?').get(wrong.entryId)).toBeUndefined();
    expect((await ok('GET', '/api/delivery/handovers')).length).toBe(0);
    expect((await ok('GET', '/api/delivery/drivers'))[0].holding).toBe(8_000);
    const right = await ok('POST', '/api/delivery/handovers', { driverId: driver.id, amount: 5_000, cashAccountCode: '1811' });
    await ok('POST', `/api/entries/${right.entryId}/check`, {});
    await ok('POST', `/api/entries/${right.entryId}/approve`, {});
    expect([balanceOf(cash), balanceOf('1811')]).toEqual([3_000, 5_000]);
    // in the books: reversed (never from the vouchers page), and not twice
    expect((await call('POST', `/api/entries/${right.entryId}/reverse`, {})).json()).toMatchObject({ error: 'entry_belongs_to_delivery_handover' });
    expect((await ok('POST', `/api/delivery/handovers/${right.id}/cancel`, {})).reversalId).toEqual(expect.any(String));
    expect([balanceOf(cash), balanceOf('1811')]).toEqual([8_000, 0]);
    expect((await ok('GET', '/api/delivery/handovers'))[0].entryStatus).toBe('reversed');
    expect((await ok('GET', '/api/delivery/drivers'))[0].holding).toBe(8_000);
    expect((await call('POST', `/api/delivery/handovers/${right.id}/cancel`, {})).json().error).toBe('dl_handover_cancelled');
  });

  it('keeps a refused handover out of what the driver holds back and out of the year’s close; reversing one in the books needs an approver (2.0 books review #2)', async () => {
    await ok('POST', '/api/plan/trial');
    await stockIn(milkId, 10, 1_000);
    const cash = driverSafe();
    const driver = await ok('POST', '/api/delivery/drivers', { name: 'Hemin', cashAccount: cash });
    const o = await ok('POST', '/api/delivery/orders', order());
    await ok('POST', `/api/delivery/orders/${o.id}/status`, { status: 'out', driverId: driver.id });
    await ok('POST', `/api/delivery/orders/${o.id}/status`, { status: 'delivered' });
    const owner = (await ok('GET', '/api/users'))[0] as { username: string };
    const las = await signInAs(['preparer']);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: owner.username, password: 'admin-pass-123' }, headers: { 'x-qasa-client': '1' } });
    const admin = { cookie: String(login.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    writeSetting(db, 'vouchers_need_approval', '1');
    const h = await ok('POST', '/api/delivery/handovers', { driverId: driver.id, amount: 8_000, cashAccountCode: '1811' }, las);
    const refused = await call('POST', `/api/entries/${h.entryId}/reject`, { reason: 'brought 5,000 only' }, admin);
    expect(refused.statusCode, refused.body).toBe(200);
    // the driver still holds it all, the right handover can be made, and the year is not held up by the refused one
    expect((await ok('GET', '/api/delivery/drivers', undefined, admin))[0].holding).toBe(8_000);
    const year = (await ok('GET', '/api/year-end', undefined, admin)).years.find((y: { year: number }) => y.year === 2026);
    expect(year.blockers ?? []).not.toContainEqual(expect.objectContaining({ code: 'unfinished_entries' }));
    const right = await ok('POST', '/api/delivery/handovers', { driverId: driver.id, amount: 5_000, cashAccountCode: '1811' }, admin);
    // the preparer takes the refused one away, but does not reverse one that is in the books
    await ok('POST', `/api/delivery/handovers/${h.id}/cancel`, {}, las);
    if (right.entryStatus !== 'approved') { await ok('POST', `/api/entries/${right.entryId}/check`, {}, admin); await ok('POST', `/api/entries/${right.entryId}/approve`, {}, admin); }
    expect((await call('POST', `/api/delivery/handovers/${right.id}/cancel`, {}, las)).statusCode).toBe(403);
  });

  it('gives each driver a cash account of his own: not another driver’s, nor the main safe (2.0 books review #14)', async () => {
    await ok('POST', '/api/plan/trial');
    const cash = driverSafe();
    const hemin = await ok('POST', '/api/delivery/drivers', { name: 'Hemin', cashAccount: cash });
    expect((await call('POST', '/api/delivery/drivers', { name: 'Dara', cashAccount: cash })).json().details).toEqual([{ code: 'dl_cash_account_taken' }]);
    expect((await call('POST', '/api/delivery/drivers', { name: 'Dara', cashAccount: '1811' })).json().details).toEqual([{ code: 'dl_cash_account_taken' }]);
    // his own stays his when the rest of him is changed
    expect((await ok('PUT', `/api/delivery/drivers/${hemin.id}`, { name: 'Hemin K.', cashAccount: cash })).cashAccount).toBe(cash);
  });

  it('gives an order delivered the next day the offers of the day it was taken (2.0 books review #8)', async () => {
    await ok('POST', '/api/plan/trial');
    await stockIn(milkId, 10, 1_000);
    const driver = await ok('POST', '/api/delivery/drivers', { name: 'Hemin', cashAccount: driverSafe() });
    await ok('POST', '/api/offers', {
      code: 'MILK20', names: { ar: 'حليب', en: 'Milk 20% off', ku: 'شیر' }, kind: 'price', priority: 0, exclusive: false, maxPerSale: null,
      startsOn: null, endsOn: '2026-11-20', weekdays: null, fromTime: null, toTime: null, branchIds: null, items: [milkId], categories: [], getItems: [], getCategories: [],
      buyMilli: null, getMilli: null, getPercent: null, bundleMilli: null, bundlePrice: null, price: null, percentOff: 20
    });
    const o = await ok('POST', '/api/delivery/orders', order());
    expect(o.total).toBe(6_800);
    vi.setSystemTime(new Date('2026-11-21T08:00:00Z'));
    await ok('POST', `/api/delivery/orders/${o.id}/status`, { status: 'out', driverId: driver.id });
    const done = await ok('POST', `/api/delivery/orders/${o.id}/status`, { status: 'delivered' });
    expect(done.total).toBe(6_800);
    // what the driver was told to collect is what went into his cash
    expect(balanceOf('1812')).toBe(6_800);
  });

  it('delivers on the customer’s account, cancels with a reason, and deletes only a new order', async () => {
    await ok('POST', '/api/plan/trial');
    await stockIn(milkId, 10, 1_000);
    const driver = await ok('POST', '/api/delivery/drivers', { name: 'Hemin' });
    expect((await call('POST', '/api/delivery/orders', order({ payment: 'account' }))).statusCode).toBe(400);
    const onAccount = await ok('POST', '/api/delivery/orders', order({ payment: 'account', partyId: customerId, fee: 0 }));
    await ok('POST', `/api/delivery/orders/${onAccount.id}/status`, { status: 'out', driverId: driver.id });
    await ok('POST', `/api/delivery/orders/${onAccount.id}/status`, { status: 'delivered' });
    const party = await ok('GET', `/api/parties/${customerId}`);
    expect(party.balance).toBe(6_000);
    // cash on delivery needs the driver's cash account
    const cod = await ok('POST', '/api/delivery/orders', order());
    await ok('POST', `/api/delivery/orders/${cod.id}/status`, { status: 'out', driverId: driver.id });
    const refused = await call('POST', `/api/delivery/orders/${cod.id}/status`, { status: 'delivered' });
    expect(refused.json()).toMatchObject({ error: 'dl_driver_cash_account' });
    expect((await call('POST', `/api/delivery/orders/${cod.id}/status`, { status: 'cancelled' })).statusCode).toBe(400);
    expect(await ok('POST', `/api/delivery/orders/${cod.id}/status`, { status: 'cancelled', reason: 'No answer' })).toMatchObject({ status: 'cancelled', cancelReason: 'No answer' });
    expect((await call('DELETE', `/api/delivery/orders/${cod.id}`)).statusCode).toBe(409);
    const fresh = await ok('POST', '/api/delivery/orders', order());
    expect((await call('DELETE', `/api/delivery/orders/${fresh.id}`)).statusCode).toBe(204);
    expect(stockQty(milkId)).toBe(6_000);
  });

  it('is for sales staff; a cashier without sales can’t take orders and nobody but an admin adds drivers', async () => {
    await ok('POST', '/api/plan/trial');
    const cashier = await signInAs(['pos']);
    // reading is open, as the app's other lists are; the drivers' handovers are the books'
    expect((await call('GET', '/api/delivery/orders', undefined, cashier)).statusCode).toBe(200);
    expect((await call('GET', '/api/delivery/handovers', undefined, cashier)).statusCode).toBe(403);
    expect((await call('POST', '/api/delivery/orders', order(), cashier)).statusCode).toBe(403);
    expect((await call('POST', '/api/delivery/drivers', { name: 'X' }, cashier)).statusCode).toBe(403);
    expect((await call('POST', '/api/delivery/handovers', { driverId: 'x', amount: 1, cashAccountCode: '1811' }, cashier)).statusCode).toBe(403);
  });

  it('hides the drivers’ cash from sales staff who don’t keep the books', async () => {
    await ok('POST', '/api/plan/trial');
    await ok('POST', '/api/delivery/drivers', { name: 'Hemin', cashAccount: driverSafe() });
    const seller = await signInAs(['sales']);
    const drivers = await ok('GET', '/api/delivery/drivers', undefined, seller);
    expect(drivers[0]).toMatchObject({ name: 'Hemin', holding: 0, cashAccount: null });
  });
});

describe('debt reminders', () => {
  it('lists those who owe, oldest first, and keeps each reminder on the customer', async () => {
    await stockIn(milkId, 10, 1_000, '2026-09-01');
    const draft = await ok('POST', '/api/invoices', {
      kind: 'sale', date: '2026-10-01', partyId: customerId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: [{ itemId: milkId, qtyMilli: 2_000, unitPrice: 1_500 }]
    });
    await ok('POST', `/api/invoices/${draft.id}/post`, {});
    const list = await ok('GET', '/api/debt-reminders?asOf=2026-11-20');
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ partyId: customerId, name: 'Rizgar', balance: 3_000, oldestDays: 50, lastRemindedAt: null, reminders: 0 });
    expect((await ok('GET', '/api/debt-reminders?asOf=2026-11-20&minDays=60')).rows).toHaveLength(0);
    await ok('POST', '/api/debt-reminders', { partyId: customerId, amount: 3_000, currency: 'IQD', days: 50, lang: 'ku' });
    const after = (await ok('GET', '/api/debt-reminders?asOf=2026-11-20')).rows[0];
    expect(after.reminders).toBe(1);
    expect(after.lastRemindedAt).toBeTruthy();
    expect(await ok('GET', `/api/parties/${customerId}/reminders`)).toMatchObject([{ amount: 3_000, lang: 'ku', createdBy: 'Mer' }]);
    expect((await call('POST', '/api/debt-reminders', { partyId: supplierId, amount: 1, currency: 'IQD', days: 1, lang: 'ar' })).statusCode).toBe(404);
  });
});

describe('price checkers', () => {
  it('needs the plan and an admin to add a device; its token shows the shelf price and nothing else', async () => {
    expect((await call('POST', '/api/price-checker/devices', { name: 'Aisle 3' })).json()).toMatchObject({ error: 'plan_limit' });
    await ok('POST', '/api/plan/trial');
    const added = await ok('POST', '/api/price-checker/devices', { name: 'Aisle 3', warehouseId });
    expect(added.token).toMatch(/^qpc_/);
    expect(JSON.stringify(await ok('GET', '/api/price-checker/devices'))).not.toContain(added.token);
    const device = { 'x-qasa-price-checker': added.token };
    const found = await call('GET', '/api/price-check?code=6260000000017', undefined, device);
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual({ found: true, name: { ar: 'حليب', en: 'Milk', ku: 'شیر' }, unit: 'piece', price: 1_500, currency: 'IQD', image: null, offers: [] });
    // by item code too; an unknown code is no item
    expect((await call('GET', '/api/price-check?code=SAMOON', undefined, device)).json()).toMatchObject({ found: true, price: 250 });
    expect((await call('GET', '/api/price-check?code=999', undefined, device)).json()).toEqual({ found: false });
    // without the token, a wrong one or a revoked one: nothing
    expect((await call('GET', '/api/price-check?code=MILK', undefined, {})).statusCode).toBe(401);
    expect((await call('GET', '/api/price-check?code=MILK', undefined, { 'x-qasa-price-checker': 'qpc_wrong' })).statusCode).toBe(401);
    await ok('POST', `/api/price-checker/devices/${added.device.id}/revoke`, {});
    expect((await call('GET', '/api/price-check?code=MILK', undefined, device)).statusCode).toBe(401);
  });

  it('shows the offer on the item now, and the offers while idle', async () => {
    await ok('POST', '/api/plan/trial');
    await ok('POST', '/api/offers', {
      code: 'MILK2', names: { ar: 'حليب ٢+١', en: 'Milk 2+1', ku: 'شیر ٢+١' }, kind: 'buyGet', priority: 0, exclusive: false, maxPerSale: null,
      startsOn: null, endsOn: null, weekdays: null, fromTime: null, toTime: null, branchIds: null, items: [milkId], categories: [], getItems: [], getCategories: [],
      buyMilli: 2_000, getMilli: 1_000, getPercent: 100, bundleMilli: null, bundlePrice: null, price: null, percentOff: null
    });
    const { token } = await ok('POST', '/api/price-checker/devices', { name: 'Door' });
    const device = { 'x-qasa-price-checker': token };
    const found = (await call('GET', '/api/price-check?code=MILK', undefined, device)).json();
    expect(found.offers).toMatchObject([{ kind: 'buyGet', names: { en: 'Milk 2+1' }, buyMilli: 2_000, getMilli: 1_000, getPercent: 100 }]);
    const slides = (await call('GET', '/api/price-check/offers', undefined, device)).json();
    expect(slides.offers[0]).toMatchObject({ names: { en: 'Milk 2+1' }, items: [{ name: { en: 'Milk' }, price: 1_500 }] });
  });

  it('keeps the devices to the admin', async () => {
    await ok('POST', '/api/plan/trial');
    const seller = await signInAs(['sales']);
    expect((await call('GET', '/api/price-checker/devices', undefined, seller)).statusCode).toBe(403);
    expect((await call('POST', '/api/price-checker/devices', { name: 'x' }, seller)).statusCode).toBe(403);
  });
});

describe('daily-delivery suppliers', () => {
  it('lists the usual items with yesterday’s quantities, and posts today’s purchase and the returns of what did not sell', async () => {
    await ok('PUT', `/api/daily-suppliers/${supplierId}/items`, { items: [{ itemId: milkId, unitCost: 1_000 }, { itemId: breadId, unitCost: 150 }] });
    vi.setSystemTime(new Date('2026-11-19T07:00:00Z'));
    const receipt = {
      partyId: supplierId, date: '2026-11-19', warehouseId,
      lines: [{ itemId: milkId, receivedMilli: 20_000, returnedMilli: 0, unitCost: 1_000 }, { itemId: breadId, receivedMilli: 100_000, returnedMilli: 0, unitCost: 150 }]
    };
    const keyed = { ...headers, 'x-qasa-idempotency': '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e42' };
    const first = await call('POST', '/api/daily-suppliers/receipts', receipt, keyed);
    expect(first.statusCode, first.body).toBe(201);
    // sent again with its key: the same receipt, the milk and bread taken in once (reliability review #6)
    const again = await call('POST', '/api/daily-suppliers/receipts', receipt, keyed);
    expect(again.headers['x-qasa-idempotent-replay']).toBe('1');
    expect(again.json().id).toBe(first.json().id);
    vi.setSystemTime(new Date('2026-11-20T07:00:00Z'));
    const sheet = await ok('GET', `/api/daily-suppliers/${supplierId}/sheet?date=2026-11-20`);
    expect(sheet.balance).toBe(35_000);
    expect(sheet.items.map((i: { code: string; lastReceivedMilli: number; returnableMilli: number; unitCost: number }) => [i.code, i.lastReceivedMilli, i.returnableMilli, i.unitCost]))
      .toEqual([['MILK', 20_000, 20_000, 1_000], ['SAMOON', 100_000, 100_000, 150]]);
    // more back than came is refused, with what can go back
    const tooMuch = await call('POST', '/api/daily-suppliers/receipts', {
      partyId: supplierId, date: '2026-11-20', warehouseId, lines: [{ itemId: breadId, receivedMilli: 0, returnedMilli: 120_000, unitCost: 150 }]
    });
    expect(tooMuch.json().details).toEqual([{ code: 'ds_return_too_much', line: 1, available: 100_000 }]);
    const today = await ok('POST', '/api/daily-suppliers/receipts', {
      partyId: supplierId, date: '2026-11-20', warehouseId,
      lines: [{ itemId: milkId, receivedMilli: 20_000, returnedMilli: 0, unitCost: 1_000 }, { itemId: breadId, receivedMilli: 100_000, returnedMilli: 30_000, unitCost: 150 }]
    });
    expect(today.purchaseNumber).toBeTruthy();
    expect(today.returns).toHaveLength(1);
    expect(today).toMatchObject({ received: 35_000, returned: 4_500 });
    expect(stockQty(breadId)).toBe(170_000);
    // the supplier is owed both days' goods, less what went back
    expect((await ok('GET', `/api/parties/${supplierId}`)).balance).toBe(65_500);
    expect(balanceOf(stockAccount)).toBe(65_500);
    expect((await ok('GET', '/api/daily-suppliers'))).toMatchObject([{ partyId: supplierId, items: 2, balance: 65_500, doneToday: true }]);
  });

  it('refuses a second sheet for the same supplier and day unless the person says the supplier came again (2.0 books review #16)', async () => {
    await ok('PUT', `/api/daily-suppliers/${supplierId}/items`, { items: [{ itemId: breadId, unitCost: 150 }] });
    const sheet = { partyId: supplierId, date: '2026-11-20', warehouseId, lines: [{ itemId: breadId, receivedMilli: 100_000, returnedMilli: 0, unitCost: 150 }] };
    await ok('POST', '/api/daily-suppliers/receipts', sheet);
    // typed again (no key: another tab, another person): refused, nothing bought twice
    const second = await call('POST', '/api/daily-suppliers/receipts', sheet);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: 'ds_sheet_exists' });
    expect(stockQty(breadId)).toBe(100_000);
    expect((await ok('GET', `/api/parties/${supplierId}`)).balance).toBe(15_000);
    // the supplier did come a second time
    await ok('POST', '/api/daily-suppliers/receipts', { ...sheet, again: true, lines: [{ itemId: breadId, receivedMilli: 40_000, returnedMilli: 0, unitCost: 150 }] });
    expect(stockQty(breadId)).toBe(140_000);
    expect(await ok('GET', `/api/daily-suppliers/${supplierId}/receipts`)).toHaveLength(2);
  });

  it('offers to return only what is still on the shelf: what sold is not there to hand back (2.0 books review #16)', async () => {
    await ok('PUT', `/api/daily-suppliers/${supplierId}/items`, { items: [{ itemId: breadId, unitCost: 150 }] });
    await ok('POST', '/api/daily-suppliers/receipts', { partyId: supplierId, date: '2026-11-19', warehouseId, lines: [{ itemId: breadId, receivedMilli: 100_000, returnedMilli: 0, unitCost: 150 }] });
    const buyer = (await ok('POST', '/api/parties', { type: 'customer', name: 'Corner cafe' })).id;
    const sale = await ok('POST', '/api/invoices', {
      kind: 'sale', date: '2026-11-19', partyId: buyer, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0, lines: [{ itemId: breadId, qtyMilli: 80_000, unitPrice: 250 }]
    });
    await ok('POST', `/api/invoices/${sale.id}/post`, {});
    const sheet = await ok('GET', `/api/daily-suppliers/${supplierId}/sheet?date=2026-11-20`);
    expect(sheet.items[0]).toMatchObject({ code: 'SAMOON', lastReceivedMilli: 100_000, returnableMilli: 20_000 });
    const tooMuch = await call('POST', '/api/daily-suppliers/receipts', { partyId: supplierId, date: '2026-11-20', warehouseId, lines: [{ itemId: breadId, receivedMilli: 0, returnedMilli: 30_000, unitCost: 150 }] });
    expect(tooMuch.json().details).toEqual([{ code: 'ds_return_too_much', line: 1, available: 20_000 }]);
    const back = await ok('POST', '/api/daily-suppliers/receipts', { partyId: supplierId, date: '2026-11-20', warehouseId, lines: [{ itemId: breadId, receivedMilli: 0, returnedMilli: 20_000, unitCost: 150 }] });
    expect(back).toMatchObject({ returned: 3_000 });
    expect(stockQty(breadId)).toBe(0);
  });

  it('is for purchasing staff', async () => {
    await ok('POST', '/api/plan/trial');
    await ok('PUT', `/api/daily-suppliers/${supplierId}/items`, { items: [{ itemId: milkId, unitCost: 1_000 }] });
    const cashier = await signInAs(['pos']);
    // the sheet reads without what the goods cost
    const sheet = await ok('GET', `/api/daily-suppliers/${supplierId}/sheet`, undefined, cashier);
    expect(sheet.items[0]).not.toHaveProperty('unitCost');
    expect((await call('PUT', `/api/daily-suppliers/${supplierId}/items`, { items: [] }, cashier)).statusCode).toBe(403);
    expect((await call('POST', '/api/daily-suppliers/receipts', { partyId: supplierId, date: '2026-11-20', warehouseId, lines: [] }, cashier)).statusCode).toBe(403);
  });
});
