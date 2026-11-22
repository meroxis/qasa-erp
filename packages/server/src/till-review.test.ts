import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { resetDisplayTries } from './till-rules.ts';

// The review of the till's server code before 2.0 ("Review till server code"): one regression test for each finding.

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
  resetLoginThrottle();
  resetDisplayTries();
  db = openDatabase(':memory:');
  app = buildApp(db);
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

const openShift = async (h: H = owner, register = 'C1', cashAccountCode = '1811') => {
  const r = await post('/api/pos/shifts', { register, cashAccountCode, warehouseId, openingCash: 0 }, h);
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string };
};
const sell = (shiftId: string, body: object, h: H = owner) => post(`/api/pos/shifts/${shiftId}/sales`, { currency: 'IQD', discount: 0, ...body }, h);
const voucher = async (shiftId: string, amount: number, extra: object = {}) => {
  const r = await post(`/api/pos/shifts/${shiftId}/gift-vouchers`, { amount, ...extra });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string; code: string };
};
const voucherRow = (id: string) => db.prepare('SELECT amount, balance, expires_on FROM gift_vouchers WHERE id = ?').get(id) as { amount: number; balance: number; expires_on: string | null };
const approve = async (h: H, body: object) => (await post('/api/pos/approve', { pin: PIN, ...body }, h)).json() as { token: string };
const needsSupervisor = (action: string) => ({ details: [{ code: 'pos_needs_supervisor', action }] });

describe('1 · a sale on account partly paid by a gift voucher', () => {
  it('puts only what the voucher left on the customer, and holds the credit limit to that part', async () => {
    const shift = await openShift();
    const v = await voucher(shift.id, 4_000);
    const ali = (await post('/api/parties', { type: 'customer', name: 'Ali', creditLimit: 2_000 })).json();
    // two teas, 5,500: 4,000 by voucher, 1,500 on Ali's account (within his limit of 2,000)
    const sale = await sell(shift.id, { partyId: ali.id, lines: [tea(2)], vouchers: [{ code: v.code, amount: 4_000 }], payments: [{ method: 'account', amount: 1_500 }] });
    expect(sale.statusCode, sale.body).toBe(201);
    expect((await get(`/api/pos/customer/${ali.id}`)).json()).toMatchObject({ balance: 1_500 });
    // the voucher's liability is used up, and no cash came into the drawer for the sale
    expect(balanceOf('263')).toBe(0);
    expect(balanceOf('1811')).toBe(4_000);
    expect(voucherRow(v.id).balance).toBe(0);
    // the invoice reads as paid by the voucher's part
    expect((await get(`/api/invoices/${sale.json().invoice.id}`)).json().settlement).toMatchObject({ total: 5_500, received: 4_000, open: 1_500 });
    // the whole amount as "on account" beside a voucher is refused: the parts must add up to what the voucher left
    const v2 = await voucher(shift.id, 1_000);
    expect((await sell(shift.id, { partyId: ali.id, lines: [tea(1)], vouchers: [{ code: v2.code, amount: 1_000 }], payments: [{ method: 'account', amount: 2_750 }] })).json())
      .toMatchObject({ details: [{ code: 'payments_total_mismatch', total: 1_750 }] });
    // returned on account: the voucher gets its share back, the customer's debt goes down by theirs only
    const back = await post(`/api/invoices/${sale.json().invoice.id}/returns`, { date: TODAY, payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 2_000 }] });
    expect(back.statusCode, back.body).toBe(201);
    expect((await get(`/api/pos/customer/${ali.id}`)).json()).toMatchObject({ balance: 0 });
    expect(voucherRow(v.id)).toMatchObject({ amount: 4_000, balance: 4_000 });
  });
});

describe('2 · the price rule across currencies', () => {
  it('compares a line with the list price turned at the company\'s rate, and holds a dollar sale\'s rate to the company\'s', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    expect((await put('/api/pos/rules', { supervisor: { ...RULES, price: true } }, who.admin!)).statusCode).toBe(200);
    const rate = Number((db.prepare("SELECT value FROM settings WHERE key = 'default_rate_x100'").get() as { value: string } | undefined)?.value ?? '142000');
    // a phone listed at 100 dollars
    const phone = (await post('/api/items', { code: 'PH', name: { ar: 'هاتف', en: 'Phone', ku: 'مۆبایل' }, unit: 'piece', salePrice: 10_000, saleCurrency: 'USD', trackStock: false }, who.admin!)).json();
    const shift = await openShift(who.las!);
    const inDinars = Math.round((10_000 * rate) / 10000);
    // sold in dinars for a tenth of its price: the rule holds, whatever the currency
    expect((await sell(shift.id, { lines: [{ itemId: phone.id, qtyMilli: 1000, unitPrice: Math.round(inDinars / 10) }] }, who.las!)).json()).toMatchObject(needsSupervisor('price'));
    expect((await sell(shift.id, { lines: [{ itemId: phone.id, qtyMilli: 1000, unitPrice: inDinars }] }, who.las!)).statusCode).toBe(201);
    // a dinar item sold in dollars: one cent for a tea is below its price
    expect((await sell(shift.id, { currency: 'USD', rateX100: rate, lines: [tea(1, 1)] }, who.las!)).json()).toMatchObject(needsSupervisor('price'));
    expect((await sell(shift.id, { currency: 'USD', rateX100: rate, lines: [tea(1, Math.round((2_750 * 10000) / rate))] }, who.las!)).statusCode).toBe(201);
    // a dollar sale at a rate far from the company's is refused (a rate of 100 times would make every price "enough")
    const far = await sell(shift.id, { currency: 'USD', rateX100: rate * 100, lines: [tea(1, 1)] }, who.las!);
    expect(far.json()).toMatchObject({ details: [{ code: 'pos_rate_far', rateX100: rate }] });
  });
});

describe('4 · cash that is not a till sale, in a safe a shift is open on', () => {
  it('asks a supervisor before cash goes back out of the drawer, and expects an invoice-screen cash sale in it', async () => {
    const who = await signIn({ las: ['pos', 'sales'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    expect((await put('/api/pos/rules', { supervisor: { ...RULES, refund: true } }, who.admin!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    // a cash sale made on the invoice screen into the shift's safe
    const draft = await post('/api/invoices', { kind: 'sale', date: TODAY, warehouseId, currency: 'IQD', rateX100: 100, payment: 'cash', cashAccountCode: '1811', discount: 0, lines: [tea(2)] }, who.las!);
    expect(draft.statusCode, draft.body).toBe(201);
    expect((await post(`/api/invoices/${draft.json().id}/post`, {}, who.las!)).statusCode).toBe(200);
    // its money is in the drawer: the shift expects it
    expect((await get(`/api/pos/shifts/${shift.id}`, who.admin!)).json()).toMatchObject({ otherCash: { IQD: 5_500 }, expected: { IQD: 5_500 } });
    // paying it back out of that drawer needs the supervisor, as a till sale's refund does
    const ret = { date: TODAY, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1_000 }] };
    expect((await post(`/api/invoices/${draft.json().id}/returns`, ret, who.las!)).json()).toMatchObject(needsSupervisor('refund'));
    expect((await post(`/api/invoices/${draft.json().id}/cancel`, {}, who.las!)).json()).toMatchObject(needsSupervisor('refund'));
    const ok = await approve(who.las!, { shiftId: shift.id, action: 'refund', invoiceId: draft.json().id, lines: ret.lines });
    expect((await post(`/api/invoices/${draft.json().id}/returns`, { ...ret, approvals: [ok.token] }, who.las!)).statusCode).toBe(201);
    expect((await get(`/api/pos/shifts/${shift.id}`, who.admin!)).json()).toMatchObject({ otherCash: { IQD: 5_500 }, refunds: { IQD: 2_750 }, expected: { IQD: 2_750 } });
    // from a safe no shift is open on, the invoice screen's own rules are enough
    const other = await post('/api/invoices', { kind: 'sale', date: TODAY, warehouseId, currency: 'IQD', rateX100: 100, payment: 'cash', cashAccountCode: '1812', discount: 0, lines: [tea(1)] }, who.las!);
    expect((await post(`/api/invoices/${other.json().id}/post`, {}, who.las!)).statusCode).toBe(200);
    expect((await post(`/api/invoices/${other.json().id}/returns`, { ...ret, cashAccountCode: '1812' }, who.las!)).statusCode).toBe(201);
    // one cancelled while the shift is open takes its money out again
    const third = await post('/api/invoices', { kind: 'sale', date: TODAY, warehouseId, currency: 'IQD', rateX100: 100, payment: 'cash', cashAccountCode: '1811', discount: 0, lines: [tea(1)] }, who.admin!);
    expect((await post(`/api/invoices/${third.json().id}/post`, {}, who.admin!)).statusCode).toBe(200);
    expect((await get(`/api/pos/shifts/${shift.id}`, who.admin!)).json().otherCash.IQD).toBe(8_250);
    expect((await post(`/api/invoices/${third.json().id}/cancel`, {}, who.admin!)).statusCode).toBe(200);
    expect((await get(`/api/pos/shifts/${shift.id}`, who.admin!)).json().otherCash.IQD).toBe(5_500);
  });
});

describe('5 · two shifts on one safe', () => {
  it('counts a till return in the shift that paid it, not in the newest one on the safe', async () => {
    const who = await signIn({ las: ['pos'], kay: ['pos'] });
    const first = await openShift(who.las!, 'C1');
    const sale = (await sell(first.id, { lines: [tea(2)] }, who.las!)).json();
    const second = await openShift(who.kay!, 'C2');
    // Las pays one tea back from her own drawer, though Kay's shift on the same safe is the newer one
    const back = await post(`/api/pos/shifts/${first.id}/returns`, { invoiceId: sale.invoice.id, lines: [{ lineNo: 1, qtyMilli: 1_000 }] }, who.las!);
    expect(back.statusCode, back.body).toBe(201);
    expect(db.prepare('SELECT shift_id FROM pos_shift_refunds WHERE invoice_id = ?').get(back.json().id)).toMatchObject({ shift_id: first.id });
    expect((await get(`/api/pos/shifts/${first.id}`, who.admin!)).json()).toMatchObject({ refunds: { IQD: 2_750 }, expected: { IQD: 2_750 } });
    expect((await get(`/api/pos/shifts/${second.id}`, who.admin!)).json()).toMatchObject({ refunds: { IQD: 0 }, expected: { IQD: 0 } });
  });
});

describe('6 · a blind close', () => {
  it('keeps the day\'s takings from a blind cashier in the shift report, the tills summary, the brief and the list of invoices', async () => {
    const who = await signIn({ las: ['pos', 'sales'], raz: ['supervisor'] });
    expect((await put('/api/pos/rules', { blindClose: true }, who.admin!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    expect((await sell(shift.id, { lines: [tea(2)] }, who.las!)).statusCode).toBe(201);
    const report = (await get(`/api/pos/shifts/${shift.id}`, who.las!)).json();
    expect(report).toMatchObject({ blind: true, expected: { IQD: 0 }, otherCash: { IQD: 0 }, gift: { sold: 0, used: 0 } });
    expect(report.invoices.map((i: { total: number }) => i.total)).toEqual([0]);
    expect(report.items.map((i: { amount: { IQD: number } }) => i.amount.IQD)).toEqual([0]);
    const summary = (await get('/api/pos/tills/summary', who.las!)).json();
    expect(summary.rows[0]).toMatchObject({ sales: { IQD: 0 }, methods: {} });
    const brief = (await get('/api/brief', who.las!)).json();
    expect(brief).toMatchObject({ blind: true, sales: { today: 0, month: 0 }, topItems: [] });
    expect((await get('/api/brief/dashboard', who.las!)).json()).toMatchObject({ blind: true, salesMonth: 0 });
    expect((await get('/api/brief/reports/sales-by-item', who.las!)).json()).toMatchObject({ blind: true, rows: [] });
    const list = (await get('/api/invoices?kind=sale', who.las!)).json();
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ blind: true, total: 0 });
    // the supervisor and the admin read all of it
    expect((await get(`/api/pos/shifts/${shift.id}`, who.raz!)).json()).toMatchObject({ expected: { IQD: 5_500 } });
    expect((await get('/api/brief', who.admin!)).json().sales.today).toBe(5_500);
    expect((await get('/api/invoices?kind=sale', who.admin!)).json()[0].total).toBe(5_500);
  });
});

describe('7 · what an approval is for', () => {
  it('holds an approval to its cashier, its invoice and lines, its item and price, its discount, its customer and amount', async () => {
    const who = await signIn({ las: ['pos', 'sales'], kay: ['pos', 'sales'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    expect((await put('/api/pos/rules', { supervisor: { ...RULES, price: true, discountPct: 10, refund: true, creditOver: true } }, who.admin!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    const kayShift = await openShift(who.kay!, 'K1', '1812');
    // an approval says what it is for: one with nothing named is not given
    for (const action of ['price', 'discount', 'credit_over', 'refund']) {
      expect((await post('/api/pos/approve', { shiftId: shift.id, action, pin: PIN }, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_approval_incomplete' }] });
    }
    // a refund: for one invoice and its lines
    const a = (await sell(shift.id, { lines: [tea(3)] }, who.las!)).json();
    const b = (await sell(shift.id, { lines: [tea(3)] }, who.las!)).json();
    const one = [{ lineNo: 1, qtyMilli: 1_000 }];
    const ret = (lines: object) => ({ date: TODAY, payment: 'cash', cashAccountCode: '1811', lines });
    const refund = await approve(who.las!, { shiftId: shift.id, action: 'refund', invoiceId: a.invoice.id, lines: one });
    // … not for another invoice, not for more than was approved, not for a cancel, not by another cashier
    expect((await post(`/api/invoices/${b.invoice.id}/returns`, { ...ret(one), approvals: [refund.token] }, who.las!)).json()).toMatchObject(needsSupervisor('refund'));
    expect((await post(`/api/invoices/${a.invoice.id}/returns`, { ...ret([{ lineNo: 1, qtyMilli: 3_000 }]), approvals: [refund.token] }, who.las!)).json()).toMatchObject(needsSupervisor('refund'));
    expect((await post(`/api/invoices/${a.invoice.id}/cancel`, { approvals: [refund.token] }, who.las!)).json()).toMatchObject(needsSupervisor('refund'));
    expect((await post(`/api/invoices/${a.invoice.id}/returns`, { ...ret(one), approvals: [refund.token] }, who.kay!)).json()).toMatchObject(needsSupervisor('refund'));
    // a return that fails for another reason leaves the approval unused (it is taken inside the return's transaction)
    expect((await post(`/api/invoices/${a.invoice.id}/returns`, { ...ret(one), date: '2020-01-01', approvals: [refund.token] }, who.las!)).statusCode).toBe(400);
    expect((await post(`/api/invoices/${a.invoice.id}/returns`, { ...ret(one), approvals: [refund.token] }, who.las!)).statusCode).toBe(201);
    expect((await post(`/api/invoices/${a.invoice.id}/returns`, { ...ret(one), approvals: [refund.token] }, who.las!)).json()).toMatchObject(needsSupervisor('refund'));
    // a lower price: for that item, at that price or above
    const sugar = (await post('/api/items', { code: 'SUG', name: { ar: 'سكر', en: 'Sugar', ku: 'شەکر' }, unit: 'piece', salePrice: 1_500, saleCurrency: 'IQD', trackStock: false }, who.admin!)).json();
    const price = await approve(who.las!, { shiftId: shift.id, action: 'price', itemId: teaId, amount: 2_500 });
    expect((await sell(shift.id, { lines: [{ itemId: sugar.id, qtyMilli: 1000, unitPrice: 1 }], approvals: [price.token] }, who.las!)).json()).toMatchObject(needsSupervisor('price'));
    expect((await sell(shift.id, { lines: [tea(1, 1)], approvals: [price.token] }, who.las!)).json()).toMatchObject(needsSupervisor('price'));
    expect((await sell(shift.id, { lines: [tea(1, 2_500), { itemId: sugar.id, qtyMilli: 1000, unitPrice: 1 }], approvals: [price.token] }, who.las!)).json()).toMatchObject(needsSupervisor('price'));
    expect((await sell(kayShift.id, { lines: [tea(1, 2_500)], approvals: [price.token] }, who.kay!)).json()).toMatchObject(needsSupervisor('price'));
    expect((await sell(shift.id, { lines: [tea(1, 2_500)], approvals: [price.token] }, who.las!)).statusCode).toBe(201);
    // a discount: no larger than the one approved
    const discount = await approve(who.las!, { shiftId: shift.id, action: 'discount', amount: 1_000 });
    expect((await sell(shift.id, { discount: 5_000, lines: [tea(2)], approvals: [discount.token] }, who.las!)).json()).toMatchObject(needsSupervisor('discount'));
    expect((await sell(shift.id, { discount: 1_000, lines: [tea(2)], approvals: [discount.token] }, who.las!)).statusCode).toBe(201);
    // credit over the limit: that customer, no more than that amount
    const ali = (await post('/api/parties', { type: 'customer', name: 'Ali', creditLimit: 1_000 }, who.admin!)).json();
    const sam = (await post('/api/parties', { type: 'customer', name: 'Sam', creditLimit: 1_000 }, who.admin!)).json();
    const over = await approve(who.las!, { shiftId: shift.id, action: 'credit_over', partyId: ali.id, amount: 2_750 });
    const credit = (partyId: string, qty: number) => ({ partyId, lines: [tea(qty)], payments: [{ method: 'account', amount: 2_750 * qty }], approvals: [over.token] });
    expect((await sell(shift.id, credit(sam.id, 1), who.las!)).json()).toMatchObject({ error: 'credit_limit_exceeded' });
    expect((await sell(shift.id, credit(ali.id, 2), who.las!)).json()).toMatchObject({ error: 'credit_limit_exceeded' });
    expect((await sell(shift.id, credit(ali.id, 1), who.las!)).statusCode).toBe(201);
  });
});

describe('8 · dollar notes on a dinar sale', () => {
  it('never values them above the company\'s rate, and says what that rate is', async () => {
    const shift = await openShift();
    const rate = 142_000;
    const usd = (rateX100: number) => sell(shift.id, { lines: [{ itemId: teaId, qtyMilli: 1000, unitPrice: 25_000 }], usdCash: { amount: 2000, rateX100 } });
    // 20 dollars at 1,600 would stand for 32,000 dinars: 3,600 more change than the notes are worth
    expect((await usd(160_000)).json()).toMatchObject({ details: [{ code: 'pos_usd_rate_far', rateX100: rate }] });
    expect((await usd(rate + 100)).json()).toMatchObject({ details: [{ code: 'pos_usd_rate_far', rateX100: rate }] });
    // the company's rate, or the shop's own lower buying rate
    expect((await usd(rate)).statusCode).toBe(201);
    expect((await usd(140_000)).statusCode).toBe(201);
    expect((await usd(14_200)).json()).toMatchObject({ details: [{ code: 'pos_usd_rate_far' }] });
  });
});

describe('9 · goods paid by gift vouchers, returned', () => {
  it('gives each voucher its own share back, never changes what a voucher was sold for, and keeps refunds out of the drawer\'s expected cash', async () => {
    const shift = await openShift();
    const a = await voucher(shift.id, 2_000);
    const b = await voucher(shift.id, 6_000);
    expect((await get(`/api/pos/shifts/${shift.id}`)).json()).toMatchObject({ expected: { IQD: 8_000 }, gift: { soldCount: 2, sold: 8_000 } });
    // four teas, 11,000: 2,000 from A, 6,000 from B, 3,000 in cash
    const sale = await sell(shift.id, { lines: [tea(4)], vouchers: [{ code: a.code, amount: 2_000 }, { code: b.code, amount: 6_000 }] });
    expect(sale.statusCode, sale.body).toBe(201);
    expect((await get(`/api/pos/shifts/${shift.id}`)).json().expected.IQD).toBe(11_000);
    // two teas back: half of each voucher's part goes back on that voucher, half of the cash from the drawer
    const back = await post(`/api/pos/shifts/${shift.id}/returns`, { invoiceId: sale.json().invoice.id, lines: [{ lineNo: 1, qtyMilli: 2_000 }] });
    expect(back.statusCode, back.body).toBe(201);
    expect([...back.json().voucherBack].sort((x: { amount: number }, y: { amount: number }) => x.amount - y.amount)).toEqual([{ code: a.code, amount: 1_000, made: false }, { code: b.code, amount: 3_000, made: false }]);
    expect(voucherRow(a.id)).toMatchObject({ amount: 2_000, balance: 1_000 });
    expect(voucherRow(b.id)).toMatchObject({ amount: 6_000, balance: 3_000 });
    // the drawer: 8,000 for the vouchers, 3,000 cash in, 1,500 cash back (nothing for what went back on vouchers)
    const view = (await get(`/api/pos/shifts/${shift.id}`)).json();
    expect(view).toMatchObject({ expected: { IQD: 9_500 }, refunds: { IQD: 1_500 }, gift: { soldCount: 2, sold: 8_000 } });
    expect(balanceOf('1811')).toBe(9_500);
    // the rest back: each voucher ends with exactly what it had, never more
    expect((await post(`/api/pos/shifts/${shift.id}/returns`, { invoiceId: sale.json().invoice.id, lines: [{ lineNo: 1, qtyMilli: 2_000 }] })).statusCode).toBe(201);
    expect(voucherRow(a.id)).toMatchObject({ amount: 2_000, balance: 2_000 });
    expect(voucherRow(b.id)).toMatchObject({ amount: 6_000, balance: 6_000 });
    expect((await get(`/api/pos/shifts/${shift.id}`)).json().expected.IQD).toBe(8_000);
    expect((await get('/api/pos/gift-vouchers')).json()).toMatchObject({ sold: 8_000, used: 0, outstanding: 8_000 });
    expect(balanceOf('263')).toBe(-8_000);
  });
});

describe('10 · a till sale whose shift is closed', () => {
  it('is not cancelled (its cash was counted with the shift) but can be returned', async () => {
    const shift = await openShift();
    const sale = (await sell(shift.id, { lines: [tea(1)] })).json();
    expect((await post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 2_750 })).statusCode).toBe(200);
    expect((await post(`/api/invoices/${sale.invoice.id}/cancel`, {})).json()).toMatchObject({ error: 'pos_sale_shift_closed' });
    expect((await post(`/api/invoices/${sale.invoice.id}/returns`, { date: TODAY, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1_000 }] })).statusCode).toBe(201);
    // while its shift is open a sale is cancelled as before
    const open = await openShift();
    const again = (await sell(open.id, { lines: [tea(1)] })).json();
    expect((await post(`/api/invoices/${again.invoice.id}/cancel`, {})).statusCode).toBe(200);
  });
});

describe('11 · a refund onto a voucher past its date', () => {
  it('makes a new voucher the customer can use, instead of money they could never spend', async () => {
    const shift = await openShift();
    const v = await voucher(shift.id, 5_500, { expiresOn: addDays(TODAY, 10) });
    const sale = (await sell(shift.id, { lines: [tea(2)], vouchers: [{ code: v.code, amount: 5_500 }] })).json();
    // sold forty days ago for fifty days; it ran out yesterday
    db.prepare('UPDATE gift_vouchers SET created_at = ?, expires_on = ? WHERE id = ?').run(`${addDays(TODAY, -51)}T08:00:00.000Z`, addDays(TODAY, -1), v.id);
    const back = await post(`/api/pos/shifts/${shift.id}/returns`, { invoiceId: sale.invoice.id, lines: [{ lineNo: 1, qtyMilli: 1_000 }] });
    expect(back.statusCode, back.body).toBe(201);
    const [made] = back.json().voucherBack as { code: string; amount: number; made: boolean }[];
    expect(made).toMatchObject({ amount: 2_750, made: true });
    expect(made!.code).not.toBe(v.code);
    expect(voucherRow(v.id)).toMatchObject({ amount: 5_500, balance: 0 });
    const fresh = (await get(`/api/pos/gift-vouchers/lookup?code=${made!.code}`)).json();
    // good for as long as the first one was
    expect(fresh).toMatchObject({ amount: 2_750, balance: 2_750, usable: true, expiresOn: addDays(TODAY, 50) });
    // it was not sold: the drawer expects nothing for it
    expect((await get(`/api/pos/shifts/${shift.id}`)).json()).toMatchObject({ expected: { IQD: 5_500 }, gift: { soldCount: 1, sold: 5_500 } });
    // the second tea: its share never goes past what the first voucher paid
    const rest = await post(`/api/pos/shifts/${shift.id}/returns`, { invoiceId: sale.invoice.id, lines: [{ lineNo: 1, qtyMilli: 1_000 }] });
    expect(rest.json().voucherBack[0]).toMatchObject({ amount: 2_750, made: true });
    expect(balanceOf('263')).toBe(-5_500);
  });
});

describe('12 · the smaller ones', () => {
  it('keeps the count of wrong PINs in the database: a restart of the server does not start it again', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    for (let i = 0; i < 5; i++) expect((await post('/api/pos/approve', { shiftId: shift.id, action: 'void', pin: `90000${i}` }, who.las!)).json()).toMatchObject({ details: [{ code: 'pin_wrong' }] });
    expect(db.prepare("SELECT n FROM pos_pin_tries WHERE k <> 'all'").get()).toMatchObject({ n: 5 });
    // the server starts again on the same database
    await app.close();
    app = buildApp(db);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'las', password: 'las-pass-123' }, headers: { 'x-qasa-client': '1' } });
    const las = { cookie: String(login.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    expect((await post('/api/pos/approve', { shiftId: shift.id, action: 'void', pin: PIN }, las)).json()).toMatchObject({ error: 'pin_locked' });
  });

  it('locks a cashier for the day after fifteen wrong PINs, however slowly they come, and tells an admin', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    const wrong = (i: number) => post('/api/pos/approve', { shiftId: shift.id, action: 'void', pin: `9000${10 + i}` }, who.las!);
    // four tries, then a wait past the short lock, again and again: the short lock never comes
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) expect((await wrong(round * 4 + i)).json()).toMatchObject({ details: [{ code: 'pin_wrong' }] });
      db.prepare("UPDATE pos_pin_tries SET locked_until = ? WHERE k <> 'all'").run(new Date(Date.now() - 1000).toISOString());
      db.prepare("UPDATE pos_pin_tries SET n = 0, since = ? WHERE k = 'all'").run(new Date().toISOString());
    }
    for (let i = 12; i < 15; i++) expect((await wrong(i)).json()).toMatchObject({ details: [{ code: 'pin_wrong' }] });
    db.prepare("UPDATE pos_pin_tries SET locked_until = ? WHERE k <> 'all'").run(new Date(Date.now() - 1000).toISOString());
    // the fifteenth told the admin; from now on even the right PIN waits for tomorrow
    expect((await get('/api/pos/rules', who.admin!)).json().pinAlert).toMatchObject({ scope: 'cashier', cashier: 'Las', tries: 15 });
    expect((await post('/api/pos/approve', { shiftId: shift.id, action: 'void', pin: PIN }, who.las!)).json()).toMatchObject({ error: 'pin_locked' });
  });

  it('refuses a card part while cards are switched off, a line the books could not hold, and a date that is no date', async () => {
    const shift = await openShift();
    expect((await put('/api/pos/payment-accounts', { card: '1831' })).statusCode).toBe(200);
    expect((await sell(shift.id, { lines: [tea(1)], payments: [{ method: 'card', amount: 2_750 }] })).json()).toMatchObject({ details: [{ code: 'pos_method_unavailable', method: 'card' }] });
    expect((await sell(shift.id, { lines: [tea(1, 9_000_000_000_000_000)] })).json()).toMatchObject({ details: [{ code: 'pos_line_too_large' }] });
    expect((await sell(shift.id, { lines: [{ itemId: teaId, qtyMilli: 1_000_000_000_000, unitPrice: 1_000_000_000_000 }] })).json()).toMatchObject({ details: [{ code: 'pos_line_too_large' }] });
    expect((await post(`/api/pos/shifts/${shift.id}/gift-vouchers`, { amount: 1_000, expiresOn: '2099-13-45' })).json()).toMatchObject({ details: [{ code: 'gv_expiry_invalid' }] });
    expect((await post(`/api/pos/shifts/${shift.id}/gift-vouchers`, { amount: 1_000, expiresOn: '2099-02-30' })).json()).toMatchObject({ details: [{ code: 'gv_expiry_invalid' }] });
  });
});

describe('the till\'s current shift (third review)', () => {
  it('finds a cashier\'s own open shift from a PC set to another till, and never another cashier\'s', async () => {
    const who = await signIn({ las: ['pos'], kay: ['pos'] });
    const front = (await post('/api/pos/tills', { name: 'Front', cashAccountCode: '1811', warehouseId }, who.admin!)).json();
    // Las opened by name before the PC chose a till; Kay has none
    const shift = await openShift(who.las!, 'Old name');
    expect((await get(`/api/pos/current?tillId=${front.id}`, who.las!)).json().shift).toMatchObject({ id: shift.id });
    expect((await get(`/api/pos/current?tillId=${front.id}`, who.kay!)).json().shift).toBeNull();
    // Kay opens the till's own shift on the same PC: each finds theirs as they take turns
    const kays = await post('/api/pos/shifts', { tillId: front.id, register: 'x', cashAccountCode: '1811', warehouseId, openingCash: 0 }, who.kay!);
    expect(kays.statusCode, kays.body).toBe(201);
    expect((await get(`/api/pos/current?tillId=${front.id}`, who.kay!)).json().shift).toMatchObject({ id: kays.json().id });
    expect((await get(`/api/pos/current?tillId=${front.id}`, who.las!)).json().shift).toMatchObject({ id: shift.id });
  });
});

describe('a kept sale the server refuses for want of a supervisor (third review)', () => {
  it('is taken once a supervisor approves that very receipt, with both names in the audit log; never a smaller sale under the same reference', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    expect((await put('/api/pos/rules', { supervisor: { ...RULES, price: true } }, who.admin!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    const soldAt = new Date().toISOString();
    const kept = (price: number, key: string) => post(`/api/pos/shifts/${shift.id}/sales`,
      { currency: 'IQD', discount: 0, lines: [tea(2, price)], offline: { reference: 'OFF-C1-0007', soldAt, soldOn: soldAt.slice(0, 10) } },
      { ...who.las!, 'x-qasa-idempotency': key });
    const KEY = '7d0c2f9a-1b2c-4d3e-8f40-5a6b7c8d9e21';
    expect((await kept(2_000, KEY)).json()).toMatchObject({ details: [{ code: 'pos_offline_supervisor' }] });
    // the approval names the receipt and what the sale is worth
    expect((await post('/api/pos/approve', { shiftId: shift.id, action: 'offline_sale', pin: PIN }, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_approval_incomplete' }] });
    const ok = await post('/api/pos/approve', { shiftId: shift.id, action: 'offline_sale', pin: PIN, reference: 'OFF-C1-0007', amount: 4_000 }, who.las!);
    expect(ok.json()).toMatchObject({ approver: 'Raz', used: false });
    // a smaller sale sent under the same reference is still refused
    expect((await kept(1, '7d0c2f9a-1b2c-4d3e-8f40-5a6b7c8d9e22')).json()).toMatchObject({ details: [{ code: 'pos_offline_supervisor' }] });
    const taken = await kept(2_000, KEY);
    expect(taken.statusCode, taken.body).toBe(201);
    const log = db.prepare("SELECT details FROM audit_log WHERE action = 'offline_sale_accepted'").all() as { details: string }[];
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0]!.details)).toMatchObject({ approver: 'Raz', reference: 'OFF-C1-0007', needs: ['price'] });
    // used once
    const again = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(2, 2_000)], offline: { reference: 'OFF-C1-0008', soldAt, soldOn: soldAt.slice(0, 10) } },
      { ...who.las!, 'x-qasa-idempotency': '7d0c2f9a-1b2c-4d3e-8f40-5a6b7c8d9e23' });
    expect(again.json()).toMatchObject({ details: [{ code: 'pos_offline_supervisor' }] });
  });
});

describe('dinar rounding, the till and the server alike (third review)', () => {
  it('books a sale for exactly the cash the shared rule gives, also when rounding down would leave nothing', async () => {
    const { cashToTake } = await import('@qasa/core');
    const shift = await openShift();
    for (const [rule, price] of [[{ step: 250, mode: 'nearest' }, 2_300], [{ step: 500, mode: 'down' }, 300], [{ step: 1000, mode: 'nearest' }, 400], [{ step: 250, mode: 'up' }, 2_300]] as const) {
      expect((await put('/api/pos/rules', { rounding: rule })).statusCode).toBe(200);
      const before = balanceOf('1811');
      const sale = await sell(shift.id, { lines: [tea(1, price)] });
      expect(sale.statusCode, sale.body).toBe(201);
      expect(balanceOf('1811') - before).toBe(cashToTake(price, rule));
      expect(sale.json().rounding).toBe(cashToTake(price, rule) - price);
    }
    // 2,300 to the nearest 250 is 2,250; 300 rounded down to 500s stays 300
    expect(cashToTake(2_300, { step: 250, mode: 'nearest' })).toBe(2_250);
    expect(cashToTake(300, { step: 500, mode: 'down' })).toBe(300);
  });
});

describe('a gift voucher sale or a till return sent twice (third review)', () => {
  it('makes one voucher and one return for one key', async () => {
    const shift = await openShift();
    const key = { ...owner, 'x-qasa-idempotency': '7d0c2f9a-1b2c-4d3e-8f40-5a6b7c8d9e31' };
    const first = await post(`/api/pos/shifts/${shift.id}/gift-vouchers`, { amount: 25_000 }, key);
    const again = await post(`/api/pos/shifts/${shift.id}/gift-vouchers`, { amount: 25_000 }, key);
    expect(first.statusCode, first.body).toBe(201);
    expect(again.json().code).toBe(first.json().code);
    expect(db.prepare('SELECT COUNT(*) AS n FROM gift_vouchers').get()).toMatchObject({ n: 1 });
    expect(balanceOf('1811')).toBe(25_000);
    const sale = (await sell(shift.id, { lines: [tea(3)] })).json();
    const back = { invoiceId: sale.invoice.id, lines: [{ lineNo: 1, qtyMilli: 1_000 }] };
    const rkey = { ...owner, 'x-qasa-idempotency': '7d0c2f9a-1b2c-4d3e-8f40-5a6b7c8d9e32' };
    const r1 = await post(`/api/pos/shifts/${shift.id}/returns`, back, rkey);
    const r2 = await post(`/api/pos/shifts/${shift.id}/returns`, back, rkey);
    expect(r1.statusCode, r1.body).toBe(201);
    expect(r2.json().id).toBe(r1.json().id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE kind = 'sale_return'").get()).toMatchObject({ n: 1 });
  });
});
