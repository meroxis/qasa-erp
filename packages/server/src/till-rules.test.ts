import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { roundCash } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { resetDisplayTries, resetPinFailures } from './till-rules.ts';
import { allowCardPaymentsForTests } from './pos.ts';

// 2.0, Iraqi markets: dinar rounding, a supervisor's PIN, a blind close, the open-price item, credit at the till,
// gift vouchers and the customer screen on another device (till-rules.ts, till-settings.ts, gift-vouchers.ts).

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let teaId: string;
let miscId: string;

const owner = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
type H = Record<string, string>;
const post = (url: string, body: unknown, h: H = owner) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const put = (url: string, body: unknown, h: H = owner) => app.inject({ method: 'PUT', url, payload: body as object, headers: h });
const get = (url: string, h: H = owner) => app.inject({ url, headers: h });
const balanceOf = (code: string) => Number((db.prepare('SELECT COALESCE(SUM(base_debit) - SUM(base_credit), 0) AS v FROM entry_lines l JOIN entries e ON e.id = l.entry_id WHERE l.account_code = ?').get(code) as { v: number }).v);
const tea = (qty = 1, price = 2_750) => ({ itemId: teaId, qtyMilli: qty * 1000, unitPrice: price });

beforeEach(async () => {
  resetLoginThrottle();
  resetPinFailures();
  resetDisplayTries();
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  teaId = (await post('/api/items', { code: 'TEA', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2_750, saleCurrency: 'IQD' })).json().id;
  miscId = (await post('/api/items', { code: 'MISC', name: { ar: 'متفرقات', en: 'Miscellaneous', ku: 'جۆراوجۆر' }, unit: 'service', salePrice: 0, saleCurrency: 'IQD' })).json().id;
  const doc = await post('/api/stock-docs', { kind: 'opening', date: '2026-01-01', warehouseId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 100_000, unitCost: 1_500 }] });
  expect((await post(`/api/stock-docs/${doc.json().id}/post`, {})).statusCode).toBe(200);
});

afterEach(async () => {
  await app.close();
  db.close();
});

/** Sign-in on, with these people (password `<username>-pass-123`); the owner is "admin". */
async function signIn(people: Record<string, string[]>): Promise<Record<string, H>> {
  await post('/api/plan/trial', {});
  const ownerId = (await get('/api/users')).json()[0].id;
  expect((await post(`/api/users/${ownerId}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
  for (const [username, roles] of Object.entries(people)) {
    const made = await post('/api/users', { username, name: username[0]!.toUpperCase() + username.slice(1), password: `${username}-pass-123`, roles });
    expect(made.statusCode, made.body).toBe(201);
  }
  expect((await put('/api/auth/signin', { on: true })).statusCode).toBe(200);
  const out: Record<string, H> = {};
  for (const username of ['admin', ...Object.keys(people)]) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: `${username}-pass-123` }, headers: { 'x-qasa-client': '1' } });
    expect(res.statusCode, res.body).toBe(200);
    out[username] = { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
  }
  return out;
}

const openShift = async (h: H = owner, register = 'C1') => {
  const r = await post('/api/pos/shifts', { register, cashAccountCode: '1811', warehouseId, openingCash: 0 }, h);
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string };
};

describe('dinar rounding', () => {
  it('rounds to 250 or 500 dinars, up, down or to the nearest', () => {
    expect(roundCash(2_750, { step: 250, mode: 'nearest' })).toBe(2_750);
    expect(roundCash(2_760, { step: 250, mode: 'nearest' })).toBe(2_750);
    expect(roundCash(2_875, { step: 250, mode: 'nearest' })).toBe(3_000);
    expect(roundCash(2_760, { step: 500, mode: 'up' })).toBe(3_000);
    expect(roundCash(2_760, { step: 500, mode: 'down' })).toBe(2_500);
    expect(roundCash(2_760, { step: 0, mode: 'down' })).toBe(2_760);
  });

  it('books the rounding to its account with the sale, the drawer expects the rounded cash, and a card part is never rounded', async () => {
    expect((await put('/api/pos/rules', { rounding: { step: 500, mode: 'up' } })).statusCode).toBe(200);
    const shift = await openShift();
    // a tea at 2,750, up to 3,000: 250 more into the drawer, to other revenue
    const sale = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(1)] });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json().rounding).toBe(250);
    expect(sale.json().invoice.total).toBe(2_750);
    expect(sale.json().shift.expected.IQD).toBe(3_000);
    expect(balanceOf('1811')).toBe(3_000);
    const revenue = db.prepare("SELECT l.credit FROM entry_lines l WHERE l.account_code LIKE '49%' AND l.credit > 0").all() as { credit: number }[];
    expect(revenue.map((r) => Number(r.credit))).toEqual([250]);
    // rounding down: to other expenses
    expect((await put('/api/pos/rules', { rounding: { step: 500, mode: 'down' } })).statusCode).toBe(200);
    const down = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(1)] });
    expect(down.json().rounding).toBe(-250);
    expect(down.json().shift.expected.IQD).toBe(5_500);
    // a card part is never rounded: only the cash part is
    expect((await put('/api/pos/payment-accounts', { card: '1831' })).statusCode).toBe(200);
    // (card is switched off for now: refused by the server too, until it is switched on again)
    const cardSale = { currency: 'IQD', discount: 0, lines: [tea(1)], payments: [{ method: 'card', amount: 2_750 }] };
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, cardSale)).json()).toMatchObject({ details: [{ code: 'pos_method_unavailable', method: 'card' }] });
    allowCardPaymentsForTests(true);
    try {
      const card = await post(`/api/pos/shifts/${shift.id}/sales`, cardSale);
      expect(card.json().rounding).toBe(0);
    } finally { allowCardPaymentsForTests(false); }
    // cancelled: the whole sale's entry is reversed, the rounding with it
    expect((await post(`/api/invoices/${down.json().invoice.id}/cancel`, {})).statusCode).toBe(200)
    expect(balanceOf('1811')).toBe(3_000);
  });
});

describe("a supervisor's PIN", () => {
  it('sets a strong PIN only, approves once for one action, and locks after five wrong PINs', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: '123456' }, who.raz!)).json()).toMatchObject({ details: [{ code: 'pin_weak' }] });
    expect((await put('/api/pos/pin', { pin: '407193' }, who.las!)).statusCode).toBe(403);
    expect((await put('/api/pos/pin', { pin: '407193' }, who.raz!)).statusCode).toBe(200);
    expect((await put('/api/pos/rules', { supervisor: { lineDelete: true, void: true, price: true, discountPct: 10, noSale: true, refund: true, creditOver: true } }, who.admin!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    // a discount over 10%: refused without the approval, taken with it, and the approval is used once
    const sale = { currency: 'IQD', discount: 1_000, lines: [tea(2)] };
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, sale, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_needs_supervisor', action: 'discount' }] });
    const ok = await post('/api/pos/approve', { shiftId: shift.id, action: 'discount', pin: '407193', amount: 1_000 }, who.las!);
    expect(ok.json()).toMatchObject({ approver: 'Raz', action: 'discount', used: false });
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { ...sale, approvals: [ok.json().token] }, who.las!)).statusCode).toBe(201);
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { ...sale, approvals: [ok.json().token] }, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_needs_supervisor' }] });
    // a price below the item's own
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(1, 2_000)] }, who.las!)).json()).toMatchObject({ details: [{ action: 'price' }] });
    // … in whatever unit the line names: the base unit by name, or a box at its own price (security review #2)
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: teaId, unit: 'piece', unitQtyMilli: 50_000, unitPrice: 1 }] }, who.las!)).json())
      .toMatchObject({ details: [{ action: 'price' }] });
    expect((await put(`/api/items/${teaId}`, { code: 'TEA', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2_750, saleCurrency: 'IQD', units: [{ unit: 'box', factorMilli: 10_000, barcode: '', salePrice: 25_000 }] }, who.admin!)).statusCode).toBe(200);
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: teaId, unit: 'box', unitQtyMilli: 1_000, unitPrice: 20_000 }] }, who.las!)).json())
      .toMatchObject({ details: [{ action: 'price' }] });
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: teaId, unit: 'box', unitQtyMilli: 1_000, unitPrice: 25_000 }] }, who.las!)).statusCode).toBe(201);
    // the drawer with no sale
    expect((await post(`/api/pos/shifts/${shift.id}/drawer`, {}, who.las!)).json()).toMatchObject({ details: [{ action: 'no_sale' }] });
    const drawer = (await post('/api/pos/approve', { shiftId: shift.id, action: 'no_sale', pin: '407193' }, who.las!)).json();
    expect((await post(`/api/pos/shifts/${shift.id}/drawer`, { approvals: [drawer.token] }, who.las!)).statusCode).toBe(200);
    // an action done at the till alone is used as it is given, and is in the audit log with who approved
    expect((await post('/api/pos/approve', { shiftId: shift.id, action: 'void', pin: '407193', detail: '3 lines' }, who.las!)).json()).toMatchObject({ used: true });
    const log = db.prepare("SELECT details FROM audit_log WHERE action = 'supervisor_ok'").all() as { details: string }[];
    expect(log.map((l) => JSON.parse(l.details).approver)).toEqual(['Raz', 'Raz', 'Raz']);
    // five wrong PINs lock the shift's approvals
    for (let i = 0; i < 5; i++) expect((await post('/api/pos/approve', { shiftId: shift.id, action: 'void', pin: '987613' }, who.las!)).json()).toMatchObject({ details: [{ code: 'pin_wrong' }] });
    expect((await post('/api/pos/approve', { shiftId: shift.id, action: 'void', pin: '407193' }, who.las!)).json()).toMatchObject({ error: 'pin_locked' });
  });

  it('counts wrong PINs per cashier, not per shift: a second shift is refused and the lock follows the cashier (security review #1)', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    // a PIN set now is 6 to 8 digits
    expect((await put('/api/pos/pin', { pin: '4071' }, who.raz!)).json()).toMatchObject({ details: [{ code: 'pin_invalid' }] });
    expect((await put('/api/pos/pin', { pin: '407193' }, who.raz!)).statusCode).toBe(200);
    const first = await openShift(who.las!, 'X0');
    // a cashier holds one open shift: opening another to start the count again is refused
    expect((await post('/api/pos/shifts', { register: 'X1', cashAccountCode: '1811', warehouseId, openingCash: 0 }, who.las!)).json()).toMatchObject({ error: 'pos_shift_already_open' });
    for (let i = 0; i < 5; i++) expect((await post('/api/pos/approve', { shiftId: first.id, action: 'void', pin: `90000${i}` }, who.las!)).json()).toMatchObject({ details: [{ code: 'pin_wrong' }] });
    // closing the shift and opening a new one does not unlock: the right PIN is refused too
    expect((await post(`/api/pos/shifts/${first.id}/close`, { countedCash: 0 }, who.las!)).statusCode).toBeLessThan(300);
    const second = await openShift(who.las!, 'X2');
    expect((await post('/api/pos/approve', { shiftId: second.id, action: 'void', pin: '407193' }, who.las!)).json()).toMatchObject({ error: 'pin_locked' });
    // the admin sees it in Settings, in the audit log, and can clear it
    const rules = (await get('/api/pos/rules', who.admin!)).json();
    expect(rules.pinAlert).toMatchObject({ scope: 'cashier', cashier: 'Las', tries: 5 });
    expect((await get('/api/pos/rules', who.las!)).json().pinAlert).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'pin_lockout'").get()).toMatchObject({ n: 1 });
    expect((await app.inject({ method: 'DELETE', url: '/api/pos/pin-alert', headers: who.las! })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/pos/pin-alert', headers: who.admin! })).statusCode).toBe(200);
    expect((await get('/api/pos/rules', who.admin!)).json().pinAlert).toBeNull();
  });

  it('counts PINs sent all at once before checking them: a burst is locked after five (reliability review #1)', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: '407193' }, who.raz!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    const guesses = Array.from({ length: 40 }, (_, i) => String(500000 + i)).concat('407193');
    const answers = await Promise.all(guesses.map((pin) => post('/api/pos/approve', { shiftId: shift.id, action: 'discount', pin, amount: 1_000 }, who.las!)));
    expect(answers.filter((r) => r.json().details?.[0]?.code === 'pin_wrong').length).toBeLessThanOrEqual(5);
    expect(answers.at(-1)!.json().error).toBe('pin_locked');
  });

  it('keeps a sale a cut-off till sold at a list price the item had since the shift opened, for review; refuses anything lower, or sold outside the shift (review 2.0)', async () => {
    expect((await put('/api/pos/rules', { supervisor: { lineDelete: false, void: false, price: true, discountPct: 0, noSale: false, refund: false, creditOver: false } })).statusCode).toBe(200);
    const shift = await openShift();
    // the shift has been open for ten minutes; the till was cut off, and the price went up to 3,000 a minute ago
    db.prepare('UPDATE pos_shifts SET opened_at = ? WHERE id = ?').run(new Date(Date.now() - 600_000).toISOString(), shift.id);
    const beforeShift = new Date(Date.now() - 900_000).toISOString();
    const before = new Date(Date.now() - 120_000).toISOString();
    const item = (await get(`/api/items/${teaId}`)).json();
    expect((await put(`/api/items/${teaId}`, { ...item, salePrice: 3_000 })).statusCode).toBe(200);
    db.prepare("UPDATE item_price_history SET changed_at = ? WHERE item_id = ? AND price = 3000").run(new Date(Date.now() - 60_000).toISOString(), teaId);
    const after = new Date(Date.now() - 30_000).toISOString();
    let n = 0;
    const kept = (price: number, soldAt: string) => post(`/api/pos/shifts/${shift.id}/sales`,
      { currency: 'IQD', discount: 0, lines: [tea(1, price)], offline: { reference: `OFF-C1-000${++n}`, soldAt, soldOn: soldAt.slice(0, 10) } },
      { ...owner, 'x-qasa-idempotency': `7d0c2f9a-1b2c-4d3e-8f40-5a6b7c8d9e1${n}` });
    // sold before the raise at the price of then: kept, and written for review
    const first = await kept(2_750, before);
    expect(first.statusCode, first.body).toBe(201);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'offline_price_review'").get()).toMatchObject({ n: 1 });
    // sold after the raise by a till that still had the old price (it loaded its prices when the shift opened): kept too
    expect((await kept(2_750, after)).statusCode).toBe(201);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'offline_price_review'").get()).toMatchObject({ n: 2 });
    // below every price the item had during the shift: an "offline" stamp does not switch the rule off
    expect((await kept(2_000, before)).json()).toMatchObject({ details: [{ code: 'pos_offline_supervisor' }] });
    expect((await kept(1, after)).json()).toMatchObject({ details: [{ code: 'pos_offline_supervisor' }] });
    // a moment before the shift opened, or one still to come, gets no allowance at all
    expect((await kept(2_750, beforeShift)).json()).toMatchObject({ details: [{ code: 'pos_offline_supervisor' }] });
    expect((await kept(2_750, new Date(Date.now() + 3_600_000).toISOString())).json()).toMatchObject({ details: [{ code: 'pos_offline_supervisor' }] });
    // an item whose price never changed has one list price: nothing lower is kept
    const sugar = (await post('/api/items', { code: 'SUG', name: { ar: 'سكر', en: 'Sugar', ku: 'شەکر' }, unit: 'piece', salePrice: 1_500, saleCurrency: 'IQD', trackStock: false })).json();
    const low = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: sugar.id, qtyMilli: 1000, unitPrice: 1_000 }], offline: { reference: 'OFF-C1-0099', soldAt: before, soldOn: before.slice(0, 10) } },
      { ...owner, 'x-qasa-idempotency': '7d0c2f9a-1b2c-4d3e-8f40-5a6b7c8d9e99' });
    expect(low.json()).toMatchObject({ details: [{ code: 'pos_offline_supervisor' }] });
  });
});

describe('a refund at the till (security review #6)', () => {
  it('needs a supervisor on the server for a return or a cancel of a till sale, and an exchange only on the cashier\'s own shift', async () => {
    const who = await signIn({ las: ['pos', 'sales'], kay: ['pos', 'sales'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: '407193' }, who.raz!)).statusCode).toBe(200);
    expect((await put('/api/pos/rules', { supervisor: { lineDelete: false, void: false, price: false, discountPct: 0, noSale: false, refund: true, creditOver: false } }, who.admin!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    const sale = (await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(2)] }, who.las!)).json();
    const ret = { date: sale.invoice.date, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1000 }] };
    expect((await post(`/api/invoices/${sale.invoice.id}/returns`, ret, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_needs_supervisor', action: 'refund' }] });
    expect((await post(`/api/invoices/${sale.invoice.id}/cancel`, {}, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_needs_supervisor', action: 'refund' }] });
    const ok = (await post('/api/pos/approve', { shiftId: shift.id, action: 'refund', pin: '407193', invoiceId: sale.invoice.id, lines: ret.lines }, who.las!)).json();
    const done = await post(`/api/invoices/${sale.invoice.id}/returns`, { ...ret, approvals: [ok.token] }, who.las!);
    expect(done.statusCode, done.body).toBe(201);
    // used once
    expect((await post(`/api/invoices/${sale.invoice.id}/returns`, { ...ret, approvals: [ok.token] }, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_needs_supervisor' }] });
    // another cashier can't take money out of this drawer by an exchange
    const kayShift = await openShift(who.kay!, 'K1');
    void kayShift;
    expect((await post(`/api/clothing/shifts/${shift.id}/exchange`, { invoiceId: sale.invoice.id, back: [{ lineNo: 1, qtyMilli: 1000 }] }, who.kay!)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await post(`/api/clothing/shifts/${shift.id}/exchange`, { invoiceId: sale.invoice.id, back: [{ lineNo: 1, qtyMilli: 1000 }] }, who.kay!)).json().error).not.toBe(undefined);
  });
});

describe('a blind close', () => {
  it('hides the cash expected from a cashier; a supervisor and the books still read it', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/rules', { blindClose: true }, who.admin!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    const sold = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(1)] }, who.las!);
    expect(sold.json().shift).toMatchObject({ blind: true, expected: { IQD: 0, USD: 0 } });
    expect((await get('/api/pos/current', who.las!)).json().shift.blind).toBe(true);
    // the day close tells them nothing more while the shift is open (security review #3)
    const day = (await get(`/api/brief/day-close?date=${(shift as unknown as { openedAt: string }).openedAt.slice(0, 10)}`, who.las!)).json();
    expect(day.registers[0]).toMatchObject({ blind: true, expected: { IQD: 0 }, sales: { IQD: 0 }, difference: null });
    expect(day.sales.gross).toBe(0);
    expect(day.methods).toEqual([]);
    const closed = await post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 2_500 }, who.las!);
    expect(closed.json()).toMatchObject({ blind: true, difference: null });
    expect((await get(`/api/pos/shifts/${shift.id}`, who.raz!)).json()).toMatchObject({ expected: { IQD: 2_750 }, difference: { IQD: -250 } });
    expect((await get(`/api/pos/shifts/${shift.id}`, who.admin!)).json().blind).toBeUndefined();
  });
});

describe('the open-price item', () => {
  it('sells to the cashiers named, up to the most, with a note', async () => {
    const who = await signIn({ las: ['pos'], raz: ['pos'] });
    const lasId = (await get('/api/users', who.admin!)).json().find((u: { username: string }) => u.username === 'las').id;
    expect((await put('/api/pos/rules', { misc: { itemId: miscId, max: 10_000, users: [lasId] } }, who.admin!)).statusCode).toBe(200);
    expect((await put('/api/pos/rules', { misc: { itemId: teaId, max: 10_000, users: null } }, who.admin!)).json()).toMatchObject({ details: [{ code: 'pos_misc_item_invalid' }] });
    expect((await get('/api/pos/rules', who.las!)).json().misc).toEqual({ itemId: miscId, max: 10_000, allowed: true });
    expect((await get('/api/pos/rules', who.raz!)).json().misc.allowed).toBe(false);
    const line = (price: number) => ({ itemId: miscId, qtyMilli: 1000, unitPrice: price });
    const las = await openShift(who.las!, 'L');
    expect((await post(`/api/pos/shifts/${las.id}/sales`, { currency: 'IQD', discount: 0, lines: [line(5_000)] }, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_misc_note_required' }] });
    expect((await post(`/api/pos/shifts/${las.id}/sales`, { currency: 'IQD', discount: 0, notes: 'bag', lines: [line(15_000)] }, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_misc_over_max' }] });
    expect((await post(`/api/pos/shifts/${las.id}/sales`, { currency: 'IQD', discount: 0, notes: 'bag', lines: [line(5_000)] }, who.las!)).statusCode).toBe(201);
    const raz = await openShift(who.raz!, 'R');
    expect((await post(`/api/pos/shifts/${raz.id}/sales`, { currency: 'IQD', discount: 0, notes: 'bag', lines: [line(5_000)] }, who.raz!)).json()).toMatchObject({ details: [{ code: 'pos_misc_not_allowed' }] });
  });
});

describe('credit at the till', () => {
  it("shows the customer's debt and puts a sale over the limit through only with a supervisor's approval", async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: '407193' }, who.raz!)).statusCode).toBe(200);
    expect((await put('/api/pos/rules', { supervisor: { lineDelete: false, void: false, price: false, discountPct: 0, noSale: false, refund: false, creditOver: true } }, who.admin!)).statusCode).toBe(200);
    const ali = (await post('/api/parties', { type: 'customer', name: 'Ali', creditLimit: 3_000 }, who.admin!)).json();
    const shift = await openShift(who.las!);
    const credit = { currency: 'IQD', discount: 0, partyId: ali.id, payments: [{ method: 'account', amount: 2_750 }], lines: [tea(1)] };
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, credit, who.las!)).statusCode).toBe(201);
    expect((await get(`/api/pos/customer/${ali.id}`, who.las!)).json()).toMatchObject({ balance: 2_750, creditLimit: 3_000, overLimit: false });
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, credit, who.las!)).json()).toMatchObject({ error: 'credit_limit_exceeded' });
    const ok = (await post('/api/pos/approve', { shiftId: shift.id, action: 'credit_over', pin: '407193', partyId: ali.id, amount: 2_750 }, who.las!)).json();
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { ...credit, approvals: [ok.token] }, who.las!)).statusCode).toBe(201);
    expect((await get(`/api/pos/customer/${ali.id}`, who.las!)).json()).toMatchObject({ balance: 5_500, overLimit: true });
  });
});

describe('gift vouchers', () => {
  it('sells a voucher into the drawer as a liability, pays with it in parts, gives it back on a cancel, and cancels an unused one', async () => {
    const shift = await openShift();
    const sold = await post(`/api/pos/shifts/${shift.id}/gift-vouchers`, { amount: 10_000 });
    expect(sold.statusCode, sold.body).toBe(201);
    const v = sold.json();
    expect(v).toMatchObject({ amount: 10_000, balance: 10_000, usable: true });
    expect(v.code).toMatch(/^GV[2-9A-HJ-NP-Z]{10}$/);
    expect(balanceOf('263')).toBe(-10_000);
    expect((await get('/api/pos/current')).json().shift.expected.IQD).toBe(10_000);
    // a sale of 5,500 paid 5,000 by the voucher, 500 in cash
    const sale = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(2)], vouchers: [{ code: v.code.toLowerCase(), amount: 5_000 }] });
    expect(sale.statusCode, sale.body).toBe(201);
    expect((await get(`/api/pos/gift-vouchers/lookup?code=${v.code}`)).json().balance).toBe(5_000);
    expect(balanceOf('263')).toBe(-5_000);
    expect(sale.json().shift.expected.IQD).toBe(10_500);
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(3)], vouchers: [{ code: v.code, amount: 6_000 }] })).json()).toMatchObject({ details: [{ code: 'gv_balance', balance: 5_000 }] });
    // the sale cancelled: the voucher has its 10,000 again; it was used, so it can't be cancelled meanwhile
    expect((await post(`/api/pos/gift-vouchers/${v.id}/cancel`, {})).json()).toMatchObject({ error: 'gv_used' });
    expect((await post(`/api/invoices/${sale.json().invoice.id}/cancel`, {})).statusCode).toBe(200);
    expect((await get(`/api/pos/gift-vouchers/lookup?code=${v.code}`)).json().balance).toBe(10_000);
    const cancelled = await post(`/api/pos/gift-vouchers/${v.id}/cancel`, {});
    expect(cancelled.json()).toMatchObject({ status: 'cancelled', balance: 0, usable: false });
    expect(balanceOf('263')).toBe(0);
    expect((await get('/api/pos/gift-vouchers')).json()).toMatchObject({ outstanding: 0 });
  });

  it('keeps the voucher list for an admin, and refuses a voucher from a till that was offline', async () => {
    const who = await signIn({ las: ['pos'] });
    expect((await get('/api/pos/gift-vouchers', who.las!)).statusCode).toBe(403);
    const shift = await openShift(who.las!);
    const v = (await post(`/api/pos/shifts/${shift.id}/gift-vouchers`, { amount: 5_000 }, who.las!)).json();
    const offline = { reference: 'OFF-C1-0001', soldAt: new Date().toISOString(), soldOn: new Date().toISOString().slice(0, 10) };
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(1)], offline, vouchers: [{ code: v.code, amount: 1_000 }] }, who.las!)).json())
      .toMatchObject({ details: [{ code: 'pos_offline_voucher' }] });
  });
});

describe('the customer screen on another device', () => {
  it('pairs with a code, reads only that till, and shuts out guessing', async () => {
    const tillRes = await post('/api/pos/tills', { name: 'Front', cashAccountCode: '1811', warehouseId, customerDisplay: true });
    const tillId = tillRes.json().id;
    const { code } = (await post('/api/pos/display/code', { tillId })).json();
    expect(code).toMatch(/^\d{6}$/);
    await post('/api/pos/shifts', { tillId, register: 'x', cashAccountCode: '1811', warehouseId, openingCash: 0 });
    const state = { dir: 'ltr', lang: 'en', company: 'Mer', welcome: 'Welcome', totalLabel: 'Total', lines: [{ name: 'Tea', qty: '1', amount: '2,750' }], total: '2,750' };
    expect((await post('/api/pos/display/state', { tillId, state })).statusCode).toBe(200);
    expect((await post('/api/pos/display/state', { tillId, state: { ...state, secret: 'x' } })).statusCode).toBe(400);
    // no session: the code pairs once (security review #7) and the screen goes on with its own key
    const paired = await app.inject({ method: 'POST', url: '/api/pos/display/pair', payload: { code } });
    expect(paired.statusCode, paired.body).toBe(200);
    const key = paired.json().key as string;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect((await app.inject({ method: 'POST', url: '/api/pos/display/pair', payload: { code } })).statusCode).toBe(404);
    const feed = await app.inject({ url: `/api/pos/display/feed?key=${key}` });
    expect(feed.statusCode, feed.body).toBe(200);
    expect(feed.json().state).toEqual(state);
    expect((await app.inject({ url: `/api/pos/display/feed?key=${'0'.repeat(64)}` })).statusCode).toBe(404);
    // guessing from one place shuts that place out, never the screen with its key
    for (let i = 0; i < 25; i++) await app.inject({ method: 'POST', url: '/api/pos/display/pair', payload: { code: String(i).padStart(6, '1') } });
    expect((await app.inject({ method: 'POST', url: '/api/pos/display/pair', payload: { code: '123123' } })).statusCode).toBe(429);
    expect((await app.inject({ url: `/api/pos/display/feed?key=${key}` })).statusCode).toBe(200);
    // a right code still pairs while that place is locked out, but only for ten minutes after it was made
    const second = (await post('/api/pos/display/code', { tillId })).json().code;
    expect((await app.inject({ method: 'POST', url: '/api/pos/display/pair', payload: { code: second } })).statusCode).toBe(200);
    const third = (await post('/api/pos/display/code', { tillId })).json().code;
    db.prepare("UPDATE pos_display_codes SET created_at = '2020-01-01T00:00:00.000Z'").run();
    resetDisplayTries();
    expect((await app.inject({ method: 'POST', url: '/api/pos/display/pair', payload: { code: third } })).statusCode).toBe(404);
  });

  it("makes a code only for a till in the asker's branches", async () => {
    const tillRes = await post('/api/pos/tills', { name: 'Front', cashAccountCode: '1811', warehouseId, customerDisplay: true });
    expect(tillRes.statusCode).toBe(201);
    expect((await post('/api/pos/display/code', { tillId: 'nope' })).statusCode).toBe(404);
  });
});
