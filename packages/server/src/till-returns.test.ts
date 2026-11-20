import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';

// 2.0.0: a return at the till (till-returns.ts): a till sale found by its receipt number, paid back from the open shift's
// safe, by the Point of sale role, with a supervisor's approval checked on the server when the till rules ask for one.

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

describe('a return at the till', () => {
  it('finds a till sale by its receipt number and pays it back from the shift, for the Point of sale role, with the approval the rules ask for', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    const shift = await openShift(who.las!);
    const sold = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(2)] }, who.las!);
    expect(sold.statusCode, sold.body).toBe(201);
    const number = sold.json().invoice.number as string;
    // found by its number (any case), with what each line has had back
    const found = await get(`/api/pos/shifts/${shift.id}/sale?q=${encodeURIComponent(number.toLowerCase())}`, who.las!);
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json().lines[0]).toMatchObject({ lineNo: 1, qtyMilli: 2_000, returnedQtyMilli: 0 });
    expect((await get(`/api/pos/shifts/${shift.id}/sale?q=INV-NONE`, who.las!)).statusCode).toBe(404);

    // the rules ask for a supervisor on refunds: without an approval the server refuses
    expect((await put('/api/pos/pin', { pin: '407163' }, who.raz!)).statusCode).toBe(200);
    expect((await put('/api/pos/rules', { supervisor: { lineDelete: false, void: false, price: false, discountPct: 0, noSale: false, refund: true, creditOver: false } }, who.admin!)).statusCode).toBe(200);
    const body = { invoiceId: found.json().id, lines: [{ lineNo: 1, qtyMilli: 1_000 }] };
    expect((await post(`/api/pos/shifts/${shift.id}/returns`, body, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_needs_supervisor', action: 'refund' }] });
    // the Point of sale role alone may not use the ordinary returns route
    expect((await post(`/api/invoices/${found.json().id}/returns`, { date: '2026-11-20', payment: 'cash', cashAccountCode: '1811', lines: body.lines }, who.las!)).statusCode).toBe(403);
    const ok = (await post('/api/pos/approve', { shiftId: shift.id, action: 'refund', pin: '407163' }, who.las!)).json();
    expect(ok).toMatchObject({ action: 'refund', used: false });
    const back = await post(`/api/pos/shifts/${shift.id}/returns`, { ...body, approvals: [ok.token] }, who.las!);
    expect(back.statusCode, back.body).toBe(201);
    expect(back.json()).toMatchObject({ kind: 'sale_return', total: 2_750, status: 'posted' });
    // the approval is used once
    expect((await post(`/api/pos/shifts/${shift.id}/returns`, { ...body, approvals: [ok.token] }, who.las!)).statusCode).toBe(400);
  });

  it('refuses a sale not made at a till, and another cashier\u2019s shift', async () => {
    const who = await signIn({ las: ['pos'], kay: ['pos'] });
    const shift = await openShift(who.las!);
    const other = await openShift(who.kay!, 'C2');
    const sold = (await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(1)] }, who.las!)).json();
    const body = { invoiceId: sold.invoice.id, lines: [{ lineNo: 1, qtyMilli: 1_000 }] };
    expect((await post(`/api/pos/shifts/${other.id}/returns`, body, who.las!)).statusCode).toBe(403);
    const inv = await post('/api/invoices', { kind: 'sale', date: '2026-11-20', warehouseId, currency: 'IQD', rateX100: 100, payment: 'cash', cashAccountCode: '1811', discount: 0, lines: [tea(1)] }, who.admin!);
    expect(inv.statusCode, inv.body).toBe(201);
    expect((await post(`/api/invoices/${inv.json().id}/post`, {}, who.admin!)).statusCode).toBe(200);
    expect((await post(`/api/pos/shifts/${shift.id}/returns`, { invoiceId: inv.json().id, lines: body.lines }, who.las!)).json()).toMatchObject({ error: 'pos_return_not_till_sale' });
  });
});

describe('the shift report and gift vouchers', () => {
  it('counts the vouchers sold at the till and used on its sales', async () => {
    const shift = await openShift();
    const sold = await post(`/api/pos/shifts/${shift.id}/gift-vouchers`, { amount: 10_000 });
    expect(sold.statusCode, sold.body).toBe(201);
    const code = sold.json().code as string;
    const sale = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(1)], vouchers: [{ code, amount: 2_750 }] });
    expect(sale.statusCode, sale.body).toBe(201);
    const report = (await get(`/api/pos/shifts/${shift.id}`)).json();
    expect(report.gift).toEqual({ soldCount: 1, sold: 10_000, used: 2_750 });
  });
});

describe('the scale label layout setting', () => {
  it('keeps 4 or 5 digits for the item, and nothing else', async () => {
    expect((await get('/api/pos/scale')).json()).toEqual({ pricePrefixes: [], itemDigits: 5 });
    expect((await put('/api/pos/scale', { pricePrefixes: ['22'], itemDigits: 4 })).json()).toEqual({ pricePrefixes: ['22'], itemDigits: 4 });
    expect((await get('/api/pos/scale')).json()).toEqual({ pricePrefixes: ['22'], itemDigits: 4 });
    expect((await put('/api/pos/scale', { pricePrefixes: [], itemDigits: 6 })).statusCode).toBe(400);
  });
});
