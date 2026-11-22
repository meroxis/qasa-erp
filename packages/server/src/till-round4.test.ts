import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { resetDisplayTries, resetPinFailures } from './till-rules.ts';

// Round four of the review before 2.0 ("Verify round three fixes"): one regression test for each finding about the
// till's money. (The randomized check that a drawer's expected cash is the safe's ledger: till-cash-ledger.test.ts.)

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let teaId: string;

const TODAY = todayIso();
const owner = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
type H = Record<string, string>;
const post = (url: string, body: unknown, h: H = owner) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const put = (url: string, body: unknown, h: H = owner) => app.inject({ method: 'PUT', url, payload: body as object, headers: h });
const get = (url: string, h: H = owner) => app.inject({ url, headers: h });
const balanceOf = (code: string) => Number((db.prepare('SELECT COALESCE(SUM(base_debit) - SUM(base_credit), 0) AS v FROM entry_lines l JOIN entries e ON e.id = l.entry_id WHERE l.account_code = ?').get(code) as { v: number }).v);
const tea = (qty = 1, price = 2_750) => ({ itemId: teaId, qtyMilli: qty * 1000, unitPrice: price });
const PIN = '407193';
const RULES = { lineDelete: false, void: false, price: false, discountPct: 0, noSale: false, refund: false, creditOver: false };

beforeEach(async () => {
  resetLoginThrottle(); resetDisplayTries(); resetPinFailures();
  db = openDatabase(':memory:');
  app = buildApp(db);
  await post('/api/plan/trial', {});
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  teaId = (await post('/api/items', { code: 'TEA', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2_750, saleCurrency: 'IQD' })).json().id;
  const doc = await post('/api/stock-docs', { kind: 'opening', date: '2026-01-01', warehouseId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 1_000_000, unitCost: 1_500 }] });
  expect((await post(`/api/stock-docs/${doc.json().id}/post`, {})).statusCode).toBe(200);
  expect((await post('/api/accounts', { parentCode: '181', code: '1812', name: { ar: 'قاصة ثانية', en: 'Second safe', ku: 'قاسەی دووەم' } })).statusCode).toBe(201);
});

afterEach(async () => {
  await app.close();
  db.close();
});

/** Sign-in on, with these people (password `<username>-pass-123`); the owner is "admin". */
async function signIn(people: Record<string, string[]>): Promise<Record<string, H>> {
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

const openShift = async (h: H = owner, register = 'C1', cashAccountCode = '1811') => {
  const r = await post('/api/pos/shifts', { register, cashAccountCode, warehouseId, openingCash: 0 }, h);
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string };
};
const shiftOf = async (id: string, h: H = owner) => (await get(`/api/pos/shifts/${id}`, h)).json() as { expected: { IQD: number; USD: number }; refunds: { IQD: number }; otherCash: { IQD: number } };
const sell = (shiftId: string, body: object, h: H = owner) => post(`/api/pos/shifts/${shiftId}/sales`, { currency: 'IQD', discount: 0, ...body }, h);
const cashBack = (invoiceId: string, qty: number, safe = '1811', h: H = owner, extra: object = {}) =>
  post(`/api/invoices/${invoiceId}/returns`, { date: TODAY, payment: 'cash', cashAccountCode: safe, lines: [{ lineNo: 1, qtyMilli: qty * 1000 }], ...extra }, h);
const needsSupervisor = (action: string) => ({ details: [{ code: 'pos_needs_supervisor', action }] });

describe('2 · a cash sales return, cancelled', () => {
  it('is refused once the shift that paid it is closed: its money was counted out with that shift', async () => {
    const first = await openShift();
    const sale = (await sell(first.id, { lines: [tea(2)] })).json();
    const ret = await cashBack(sale.invoice.id, 1);
    expect(ret.statusCode, ret.body).toBe(201);
    expect((await shiftOf(first.id)).expected.IQD).toBe(2_750);
    expect((await post(`/api/pos/shifts/${first.id}/close`, { countedCash: 2_750 })).statusCode).toBe(200);
    // another shift is open on the same safe: the cancel would put 2,750 into a drawer nobody expects it in
    const second = await openShift(owner, 'C2');
    const refused = await post(`/api/invoices/${ret.json().id}/cancel`, {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'pos_return_shift_closed' });
    expect(balanceOf('1811')).toBe(2_750);
    expect((await shiftOf(second.id)).expected.IQD).toBe(0);
    expect((await get(`/api/invoices/${ret.json().id}`)).json().status).toBe('posted');
  });

  it('while its shift is open puts the money back in that shift\'s drawer, and the safe agrees', async () => {
    const first = await openShift();
    const second = await openShift(owner, 'C2');
    const sale = (await sell(first.id, { lines: [tea(2)] })).json();
    // paid back at the first till, though the second shift on the same safe is the newer one
    const ret = await post(`/api/pos/shifts/${first.id}/returns`, { invoiceId: sale.invoice.id, lines: [{ lineNo: 1, qtyMilli: 1_000 }] });
    expect(ret.statusCode, ret.body).toBe(201);
    expect(await shiftOf(first.id)).toMatchObject({ refunds: { IQD: 2_750 }, expected: { IQD: 2_750 } });
    expect((await post(`/api/invoices/${ret.json().id}/cancel`, {})).statusCode).toBe(200);
    expect(await shiftOf(first.id)).toMatchObject({ refunds: { IQD: 0 }, expected: { IQD: 5_500 } });
    expect((await shiftOf(second.id)).expected.IQD).toBe(0);
    expect(balanceOf('1811')).toBe(5_500);
  });

  it('that paid no cash (all back onto a gift voucher) is still cancelled after its shift closed', async () => {
    const shift = await openShift();
    const v = (await post(`/api/pos/shifts/${shift.id}/gift-vouchers`, { amount: 5_500 })).json();
    const sale = (await sell(shift.id, { lines: [tea(2)], vouchers: [{ code: v.code, amount: 5_500 }] })).json();
    const ret = await cashBack(sale.invoice.id, 2);
    expect(ret.statusCode, ret.body).toBe(201);
    expect((await post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 5_500 })).statusCode).toBe(200);
    expect((await post(`/api/invoices/${ret.json().id}/cancel`, {})).statusCode).toBe(200);
    expect(balanceOf('1811')).toBe(5_500);
  });

  it('that no shift paid, cancelled while a shift is open on its safe, is cash that shift expects', async () => {
    // sold and returned on the invoice screen before any shift was open on the safe
    const draft = await post('/api/invoices', { kind: 'sale', date: TODAY, warehouseId, currency: 'IQD', rateX100: 100, payment: 'cash', cashAccountCode: '1811', discount: 0, lines: [tea(2)] });
    expect((await post(`/api/invoices/${draft.json().id}/post`, {})).statusCode).toBe(200);
    const ret = await cashBack(draft.json().id, 1);
    expect(ret.statusCode, ret.body).toBe(201);
    const before = balanceOf('1811');
    await new Promise((r) => setTimeout(r, 5));
    const shift = await openShift();
    await new Promise((r) => setTimeout(r, 5));
    expect((await post(`/api/invoices/${ret.json().id}/cancel`, {})).statusCode).toBe(200);
    expect(balanceOf('1811') - before).toBe(2_750);
    expect(await shiftOf(shift.id)).toMatchObject({ otherCash: { IQD: 2_750 }, expected: { IQD: 2_750 } });
  });

  it('needs the supervisor the refund needed, for that very return, when the company asks one for refunds', async () => {
    const who = await signIn({ las: ['pos', 'sales'], raz: ['supervisor', 'sales'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    expect((await put('/api/pos/rules', { supervisor: { ...RULES, refund: true } }, who.admin!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    const sale = (await sell(shift.id, { lines: [tea(2)] }, who.las!)).json();
    const lines = [{ lineNo: 1, qtyMilli: 1_000 }];
    const first = (await post('/api/pos/approve', { pin: PIN, shiftId: shift.id, action: 'refund', invoiceId: sale.invoice.id, lines }, who.las!)).json() as { token: string };
    const ret = await cashBack(sale.invoice.id, 1, '1811', who.las!, { approvals: [first.token] });
    expect(ret.statusCode, ret.body).toBe(201);
    // the cashier alone can't undo the refund …
    expect((await post(`/api/invoices/${ret.json().id}/cancel`, {}, who.las!)).json()).toMatchObject(needsSupervisor('refund'));
    // … nor with an approval given for the sale
    const forSale = (await post('/api/pos/approve', { pin: PIN, shiftId: shift.id, action: 'refund', invoiceId: sale.invoice.id }, who.las!)).json() as { token: string };
    expect((await post(`/api/invoices/${ret.json().id}/cancel`, { approvals: [forSale.token] }, who.las!)).json()).toMatchObject(needsSupervisor('refund'));
    expect((await shiftOf(shift.id, who.admin!)).expected.IQD).toBe(2_750);
    // approved for that return (at the till, or on the invoice screen with the supervisor's PIN): done, once
    const ok = (await post('/api/refund-approvals', { pin: PIN, invoiceId: ret.json().id }, who.las!));
    expect(ok.statusCode, ok.body).toBeLessThan(300);
    expect((await post(`/api/invoices/${ret.json().id}/cancel`, { approvals: [ok.json().token] }, who.las!)).statusCode).toBe(200);
    expect((await shiftOf(shift.id, who.admin!)).expected.IQD).toBe(5_500);
    // a supervisor needs nobody
    const again = await cashBack(sale.invoice.id, 1, '1811', who.raz!);
    expect(again.statusCode, again.body).toBe(201);
    expect((await post(`/api/invoices/${again.json().id}/cancel`, {}, who.raz!)).statusCode).toBe(200);
  });
});

describe('6 · a gift voucher an admin cancels', () => {
  const lookup = async (code: string) => (await get(`/api/pos/gift-vouchers/lookup?code=${code}`)).json() as { id: string; fromRefund: boolean };
  /** a voucher a refund made: sold, spent on a sale, past its date, then the sale returned */
  async function refundVoucher(shiftId: string): Promise<{ id: string; fromRefund: boolean }> {
    const v = (await post(`/api/pos/shifts/${shiftId}/gift-vouchers`, { amount: 5_500 })).json();
    const sale = (await sell(shiftId, { lines: [tea(2)], vouchers: [{ code: v.code, amount: 5_500 }] })).json();
    db.prepare("UPDATE gift_vouchers SET expires_on = '2020-01-01' WHERE id = ?").run(v.id);
    const ret = await cashBack(sale.invoice.id, 2);
    expect(ret.statusCode, ret.body).toBe(201);
    const made = db.prepare("SELECT v.id, v.code FROM gift_voucher_moves m JOIN gift_vouchers v ON v.id = m.voucher_id WHERE m.invoice_id = ? AND m.kind = 'returned'").get(ret.json().id) as { id: string; code: string };
    expect(made.id).not.toBe(v.id);
    return lookup(made.code);
  }

  it('one a refund made: the safe that pays is named, never guessed; a shift open on it counts the payout', async () => {
    const shift = await openShift();
    const made = await refundVoucher(shift.id);
    expect(made.fromRefund).toBe(true);
    expect((await shiftOf(shift.id)).expected.IQD).toBe(5_500);
    // no safe, or something that is no safe: refused, nothing paid
    for (const body of [{}, { cashAccountCode: '21' }, { cashAccountCode: '18' }]) {
      const refused = await post(`/api/pos/gift-vouchers/${made.id}/cancel`, body);
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json()).toMatchObject({ details: [{ code: 'gv_cancel_safe_required' }] });
    }
    expect(balanceOf('1811')).toBe(5_500);
    await new Promise((r) => setTimeout(r, 5));
    // out of the till's safe: its open shift expects that much less
    expect((await post(`/api/pos/gift-vouchers/${made.id}/cancel`, { cashAccountCode: '1811' })).statusCode).toBe(200);
    expect(balanceOf('1811')).toBe(0);
    expect(await shiftOf(shift.id)).toMatchObject({ otherCash: { IQD: -5_500 }, expected: { IQD: 0 } });
  });

  it('one a refund made, paid from a safe no shift is open on, touches no drawer', async () => {
    const shift = await openShift();
    const made = await refundVoucher(shift.id);
    expect((await post(`/api/pos/gift-vouchers/${made.id}/cancel`, { cashAccountCode: '1812' })).statusCode).toBe(200);
    expect(balanceOf('1812')).toBe(-5_500);
    expect(await shiftOf(shift.id)).toMatchObject({ otherCash: { IQD: 0 }, expected: { IQD: 5_500 } });
  });

  it('one sold by a shift since closed: the shift open on that safe now counts the money going out', async () => {
    const first = await openShift();
    const v = (await post(`/api/pos/shifts/${first.id}/gift-vouchers`, { amount: 10_000 })).json();
    expect((await lookup(v.code)).fromRefund).toBe(false);
    expect((await post(`/api/pos/shifts/${first.id}/close`, { countedCash: 10_000 })).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    const second = await openShift(owner, 'C2');
    await new Promise((r) => setTimeout(r, 5));
    expect((await post(`/api/pos/gift-vouchers/${v.id}/cancel`, {})).statusCode).toBe(200);
    expect(balanceOf('1811')).toBe(0);
    expect(await shiftOf(second.id)).toMatchObject({ otherCash: { IQD: -10_000 }, expected: { IQD: -10_000 } });
    // the closed shift keeps what it was closed with
    expect((await shiftOf(first.id)).expected.IQD).toBe(10_000);
  });

  it('one sold by a shift still open leaves that shift\'s voucher cash, once (not the other shift on the safe as well)', async () => {
    const first = await openShift();
    const second = await openShift(owner, 'C2');
    const v = (await post(`/api/pos/shifts/${first.id}/gift-vouchers`, { amount: 10_000 })).json();
    expect((await shiftOf(first.id)).expected.IQD).toBe(10_000);
    expect((await post(`/api/pos/gift-vouchers/${v.id}/cancel`, {})).statusCode).toBe(200);
    expect(await shiftOf(first.id)).toMatchObject({ otherCash: { IQD: 0 }, expected: { IQD: 0 } });
    expect(await shiftOf(second.id)).toMatchObject({ otherCash: { IQD: 0 }, expected: { IQD: 0 } });
    expect(balanceOf('1811')).toBe(0);
  });
});
