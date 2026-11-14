import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { setLicensePublicKeyForTests } from './license.ts';
import { resetLoginThrottle } from './auth.ts';
import { partyLoyalty } from './loyalty.ts';
import { dayClose } from './day-close.ts';

// Loyalty points (Pro): earned on what is paid, used at the till and on invoices within the limits, given back and
// taken back on returns, undone on cancelling, lapsing after the months set, and posted to the loyalty account.
let db: Db;
let app: FastifyInstance;
let proKey: string;
let warehouseId: string;
let lasId: string;
let razId: string;
let cutId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const put = (url: string, body: unknown = {}) => app.inject({ method: 'PUT', url, payload: body as object, headers });
const get = (url: string) => app.inject({ url, headers });
const TODAY = todayIso();

beforeAll(() => {
  const pair = generateKeyPairSync('ed25519');
  setLicensePublicKeyForTests(pair.publicKey.export({ format: 'jwk' }).x!);
  const body = `QASA1.${Buffer.from(JSON.stringify({ v: 1, id: 'QL-TEST-pro', plan: 'pro', to: 'Test Company', issued: '2026-01-01', expires: null })).toString('base64url')}`;
  proKey = `${body}.${sign(null, Buffer.from(body), pair.privateKey).toString('base64url')}`;
});

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  lasId = (await post('/api/parties', { type: 'customer', name: 'Las', phone: '0750 123 4567' })).json().id;
  razId = (await post('/api/parties', { type: 'customer', name: 'Raz' })).json().id;
  // a service (no stock), so sales can be dated any day
  cutId = (await post('/api/items', { code: 'CUT', name: { ar: 'قص', en: 'Haircut', ku: 'قژبڕین' }, unit: 'service', salePrice: 10_000, saleCurrency: 'IQD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function switchOn(rules: object = {}) {
  expect((await post('/api/plan/license', { key: proKey })).statusCode).toBe(200);
  const res = await put('/api/loyalty/settings', { rules: { on: true, earn: { points: 1, per: 1_000 }, pointValue: 10, minRedeem: 100, maxRedeemPercent: 50, expiryMonths: null, ...rules } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

const cuts = (n: number) => [{ itemId: cutId, qtyMilli: n * 1000, unitPrice: 10_000 }];

async function invoice(body: object, postBody: object = {}) {
  const draft = await post('/api/invoices', { kind: 'sale', date: TODAY, warehouseId, currency: 'IQD', rateX100: 100, discount: 0, ...body });
  expect(draft.statusCode, draft.body).toBe(201);
  return post(`/api/invoices/${draft.json().id}/post`, postBody);
}

const balance = (partyId: string, asOf = TODAY) => partyLoyalty(db, partyId, asOf).balance;
const entryLines = (invoiceId: string, field: 'entry_id' | 'cancel_entry_id' = 'entry_id') =>
  Object.fromEntries((db.prepare(`SELECT account_code, SUM(debit) - SUM(credit) AS net FROM entry_lines WHERE entry_id = (SELECT ${field} FROM invoices WHERE id = ?) GROUP BY account_code`)
    .all(invoiceId) as { account_code: string; net: number }[]).map((r) => [r.account_code, Number(r.net)]));

describe('loyalty points: settings', () => {
  it('are off, and switching them on needs the plan; switching off never does', async () => {
    expect((await get('/api/loyalty/settings')).json()).toMatchObject({ available: false, rules: { on: false, earn: { points: 1, per: 1000 } }, accountCode: '39' });
    expect((await put('/api/loyalty/settings', { rules: { on: true } })).json()).toMatchObject({ error: 'plan_limit', details: { limit: 'loyalty' } });
    const on = await switchOn();
    expect(on).toMatchObject({ available: true, rules: { on: true } });
    expect((await put('/api/loyalty/settings', { rules: { on: false } })).json().rules.on).toBe(false);
  });

  it('refuses rules that make no sense, an unknown branch and an account that is no expense or revenue', async () => {
    await switchOn();
    for (const rules of [{ earn: { points: 0, per: 1000 } }, { pointValue: -1 }, { maxRedeemPercent: 101 }, { minRedeem: 0 }, { expiryMonths: 0 }, { branches: { nope: 'off' } }]) {
      expect((await put('/api/loyalty/settings', { rules })).statusCode, JSON.stringify(rules)).toBe(400);
    }
    expect((await put('/api/loyalty/settings', { accountCode: '1811' })).statusCode).toBe(400);
    expect((await put('/api/loyalty/settings', { accountCode: '1' })).statusCode).toBe(400); // not postable
    expect((await put('/api/loyalty/settings', { accountCode: '42' })).json()).toMatchObject({ accountCode: '42' });
  });
});

describe('loyalty points at the till', () => {
  it('earns on what is paid now: cash, card or wallet, never what goes on account; a walk-in earns nothing', async () => {
    await switchOn();
    const shift = (await post('/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 0 })).json();
    const sell = (body: object) => post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, ...body });
    expect((await sell({ partyId: lasId, lines: cuts(2), discount: 500 })).json().invoice.loyalty).toMatchObject({ earned: 19, redeemed: 0, balance: 19 });
    // a sale is paid now or put on credit as a whole (1.4), and what goes on credit earns nothing
    const mixed = await sell({ partyId: lasId, lines: cuts(3), payments: [{ method: 'cash', amount: 20_000 }, { method: 'account', amount: 10_000 }] });
    expect(mixed.json().details).toEqual([{ code: 'pos_credit_not_mixed' }, { code: 'pos_payment_invalid', method: 'account' }]);
    const credit = await sell({ partyId: lasId, lines: cuts(3), payments: [{ method: 'account', amount: 30_000 }] });
    expect(credit.statusCode, credit.body).toBe(201);
    expect(credit.json().invoice.loyalty).toMatchObject({ earned: 0, balance: 19 });
    expect((await sell({ lines: cuts(5) })).json().invoice.loyalty).toBeNull();
    expect(balance(lasId)).toBe(19);
  });

  it('uses points as part of the price within the limits; their value goes to the loyalty account, never into the drawer', async () => {
    await switchOn();
    expect((await post(`/api/loyalty/parties/${lasId}/adjust`, { points: 500, note: 'Opening balance from the old card' })).json().balance).toBe(500);
    const shift = (await post('/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 50_000 })).json();
    const sell = (body: object) => post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, partyId: lasId, lines: cuts(2), ...body });

    const errorOf = async (body: object) => { const r = await sell(body); return [r.statusCode, r.json().error === 'validation' ? r.json().details[0].code : r.json().error]; };
    expect(await errorOf({ loyaltyPoints: 50 })).toEqual([400, 'loyalty_below_min']);
    expect(await errorOf({ loyaltyPoints: 600 })).toEqual([400, 'loyalty_balance_low']);
    // half of 20,000 is 10,000: 1,000 points at most
    expect(await errorOf({ loyaltyPoints: 400, partyId: undefined })).toEqual([400, 'party_required']);
    expect(await errorOf({ loyaltyPoints: 200, currency: 'USD', rateX100: 142_000 })).toEqual([400, 'loyalty_iqd_only']);
    expect(await errorOf({ loyaltyPoints: 200, payments: [{ method: 'cash', amount: 20_000 }] })).toEqual([400, 'payments_total_mismatch']);

    const sale = await sell({ loyaltyPoints: 200 });
    expect(sale.statusCode, sale.body).toBe(201);
    const { invoice, shift: after } = sale.json();
    // 200 points × 10 = 2,000 paid with points, 18,000 in cash, earning 18
    expect(entryLines(invoice.id)).toEqual({ 1811: 18_000, 39: 2_000, 42: -20_000 });
    expect(invoice).toMatchObject({ total: 20_000, baseTotal: 20_000, loyalty: { earned: 18, redeemed: 200, value: 2_000, balance: 318 } });
    expect(after.expected).toEqual({ IQD: 68_000, USD: 0 });
    expect(after.methods).toMatchObject({ cash: { IQD: 18_000 }, loyalty: { IQD: 2_000 } });
    // the till's parts pay the rest when it is split
    const card = await sell({ loyaltyPoints: 100, payments: [{ method: 'cash', amount: 19_000 }] });
    expect(card.statusCode, card.body).toBe(201);
    expect(balance(lasId)).toBe(318 - 100 + 19);
    // a stricter limit: 5% of 20,000 is 1,000, so 100 points at most
    await put('/api/loyalty/settings', { rules: { maxRedeemPercent: 5 } });
    expect(await errorOf({ loyaltyPoints: 150 })).toEqual([400, 'loyalty_above_max']);
    // switched off: no points used, none earned
    await put('/api/loyalty/settings', { rules: { on: false } });
    expect((await sell({ loyaltyPoints: 100 })).json().error).toBe('loyalty_off');
    expect((await sell({})).json().invoice.loyalty).toBeNull();
    expect(balance(lasId)).toBe(318 - 100 + 19);
  });

  it('gives points back and takes earned points back on returns, so the whole sale\'s returns undo it exactly', async () => {
    await switchOn();
    await post(`/api/loyalty/parties/${lasId}/adjust`, { points: 500, note: 'Welcome' });
    const shift = (await post('/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 0 })).json();
    const sale = (await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, partyId: lasId, lines: cuts(2), loyaltyPoints: 201 })).json().invoice;
    expect(balance(lasId)).toBe(500 - 201 + 17); // 20,000 − 2,010 = 17,990 paid: 17 points
    const back = async () => {
      const r = await post(`/api/invoices/${sale.id}/returns`, { date: TODAY, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
      expect(r.statusCode, r.body).toBe(201);
      return r.json();
    };
    const first = await back();
    // half the goods: half the points' value (1,005) back as points, the rest (8,995) in cash; 8 of the 17 earned taken
    expect(entryLines(first.id)).toEqual({ 42: 10_000, 1811: -8_995, 39: -1_005 });
    expect(first).toMatchObject({ total: 10_000, baseTotal: 10_000, loyalty: { earned: -8, redeemed: -100, value: 1_005 } });
    expect((await get(`/api/pos/shifts/${shift.id}`)).json().refunds).toEqual({ IQD: 8_995, USD: 0 });
    const second = await back();
    expect(entryLines(second.id)).toEqual({ 42: 10_000, 1811: -8_995, 39: -1_005 });
    // all of it back: exactly as before the sale
    expect(balance(lasId)).toBe(500);
    const net = db.prepare("SELECT SUM(points) AS p, SUM(CASE WHEN kind = 'redeem' THEN value ELSE 0 END) AS out, SUM(CASE WHEN kind = 'return_redeem' THEN value ELSE 0 END) AS back FROM loyalty_moves WHERE invoice_id IS NOT NULL").get() as { p: number; out: number; back: number };
    expect([Number(net.p), Number(net.out), Number(net.back)]).toEqual([0, 2_010, 2_010]);
  });

  it('undoes every movement of a cancelled sale, and the reversal gives the points\' value back in the books', async () => {
    await switchOn();
    await post(`/api/loyalty/parties/${razId}/adjust`, { points: 300, note: 'Welcome' });
    const res = await invoice({ payment: 'cash', cashAccountCode: '1811', partyId: razId, lines: cuts(3) }, { loyaltyPoints: 300 });
    expect(res.statusCode, res.body).toBe(200);
    const sale = res.json();
    expect(sale.loyalty).toMatchObject({ earned: 27, redeemed: 300, value: 3_000, balance: 27 });
    expect((await post(`/api/invoices/${sale.id}/cancel`)).statusCode).toBe(200);
    expect(balance(razId)).toBe(300);
    expect(entryLines(sale.id, 'cancel_entry_id')).toEqual({ 1811: -27_000, 39: -3_000, 42: 30_000 });
    // the ledger keeps every movement; the cancellation is two more
    const rows = partyLoyalty(db, razId).rows.map((r) => [r.kind, r.points]);
    expect(rows.slice(0, 2)).toEqual(expect.arrayContaining([['cancel', 300], ['cancel', -27]]));
    expect(rows.slice(2)).toEqual(expect.arrayContaining([['earn', 27], ['redeem', -300]]));
    expect(rows.at(-1)).toEqual(['adjust', 300]);
    // the ledger itself can never be changed or emptied
    expect(() => db.prepare('UPDATE loyalty_moves SET points = 1').run()).toThrow(/loyalty_moves_are_permanent/);
    expect(() => db.prepare('DELETE FROM loyalty_moves').run()).toThrow(/loyalty_moves_are_permanent/);
  });
});

describe('loyalty points on invoices', () => {
  it('pays part of a credit sale: the customer owes the rest, and a credit sale earns nothing', async () => {
    await switchOn();
    await post(`/api/loyalty/parties/${lasId}/adjust`, { points: 1_000, note: 'Welcome' });
    const res = await invoice({ payment: 'credit', partyId: lasId, lines: cuts(10) }, { loyaltyPoints: 1_000 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ total: 100_000, baseTotal: 100_000, loyalty: { earned: 0, redeemed: 1_000, value: 10_000, balance: 0 } });
    expect(entryLines(res.json().id)).toEqual({ 1611: 90_000, 39: 10_000, 42: -100_000 });
    expect((await get(`/api/parties/${lasId}`)).json().balance).toBe(90_000);
  });

  it('earns at a branch\'s own rate, or nothing in a branch that has points off', async () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO branches (id, code, name, active, created_at, updated_at) VALUES ('b1', 'B1', 'Erbil', 1, ?, ?)").run(now, now);
    db.prepare("INSERT INTO branches (id, code, name, active, created_at, updated_at) VALUES ('b2', 'B2', 'Duhok', 1, ?, ?)").run(now, now);
    db.prepare('INSERT INTO branch_warehouses (warehouse_id, branch_id) VALUES (?, ?)').run(warehouseId, 'b1');
    await switchOn({ branches: { b1: { points: 5, per: 1_000 }, b2: 'off' } });
    expect((await invoice({ payment: 'cash', cashAccountCode: '1811', partyId: lasId, lines: cuts(1) })).json().loyalty.earned).toBe(50);
    db.prepare('DELETE FROM branch_warehouses').run();
    db.prepare('INSERT INTO branch_warehouses (warehouse_id, branch_id) VALUES (?, ?)').run(warehouseId, 'b2');
    expect((await invoice({ payment: 'cash', cashAccountCode: '1811', partyId: lasId, lines: cuts(1) })).json().loyalty.earned).toBe(0);
  });

  it('lets points lapse the months set after they were earned, using the oldest first', async () => {
    await switchOn({ expiryMonths: 6 });
    const day = (n: number) => addDays(TODAY, n);
    // 100 points earned 300 days ago (lapsed), 120 earned 30 days ago, 50 used 20 days ago from the oldest
    expect((await invoice({ date: day(-300), payment: 'cash', cashAccountCode: '1811', partyId: lasId, lines: cuts(10) })).statusCode).toBe(200);
    expect((await invoice({ date: day(-30), payment: 'cash', cashAccountCode: '1811', partyId: lasId, lines: cuts(12) })).statusCode).toBe(200);
    const view = partyLoyalty(db, lasId);
    expect(view.balance).toBe(120);
    expect(view.rows.map((r) => [r.kind, r.points, r.balance])).toEqual([['earn', 120, 120], ['expire', -100, 0], ['earn', 100, 100]]);
    expect(view.expiring).toMatchObject({ points: 120 });
    expect(view.worth).toBe(1_200);
    expect((await get(`/api/loyalty/parties/${lasId}`)).json()).toMatchObject({ balance: 120, worth: 1_200, rules: { pointValue: 10 } });
  });
});

describe('loyalty points elsewhere', () => {
  it('needs a reason and a whole number to correct a balance, for customers only', async () => {
    await switchOn();
    const supplier = (await post('/api/parties', { type: 'supplier', name: 'RapidNet Ltd' })).json().id;
    expect((await post(`/api/loyalty/parties/${lasId}/adjust`, { points: 10, note: '   ' })).statusCode).toBe(400);
    expect((await post(`/api/loyalty/parties/${lasId}/adjust`, { points: 0, note: 'x' })).statusCode).toBe(400);
    expect((await post(`/api/loyalty/parties/${lasId}/adjust`, { points: 1.5, note: 'x' })).statusCode).toBe(400);
    expect((await post(`/api/loyalty/parties/${supplier}/adjust`, { points: 10, note: 'x' })).statusCode).toBe(400);
    expect((await post('/api/loyalty/parties/nope/adjust', { points: 10, note: 'x' })).statusCode).toBe(404);
    // a customer with points is kept (made inactive, never deleted)
    await post(`/api/loyalty/parties/${razId}/adjust`, { points: 10, note: 'Gift' });
    expect((await app.inject({ method: 'DELETE', url: `/api/parties/${razId}`, headers })).statusCode).toBe(409);
  });

  it('shows on the end-of-day close as its own way of paying', async () => {
    await switchOn();
    await post(`/api/loyalty/parties/${lasId}/adjust`, { points: 500, note: 'Welcome' });
    await invoice({ payment: 'cash', cashAccountCode: '1811', partyId: lasId, lines: cuts(3) }, { loyaltyPoints: 500 });
    const close = dayClose(db, TODAY);
    expect(Object.fromEntries(close.methods.map((m) => [m.method, m.amount]))).toEqual({ cash: 25_000, loyalty: 5_000 });
  });
});
