import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { resetPinFailures } from './till-rules.ts';

// 2.0 (accounting review): what gift vouchers and the dinar rounding do to a till sale's money — the drawer, the day
// close, and what a return gives back (vouchers onto a voucher, never cash; the rounded cash, never more)
let db: Db; let app: FastifyInstance; let warehouseId: string; let teaId: string;
const h = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) => app.inject({ method, url, headers: h, ...(body === undefined ? {} : { payload: body as object }) });
async function ok(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) { const r = await call(method, url, body); expect(r.statusCode, `${method} ${url}: ${r.body}`).toBeLessThan(300); return r.json(); }
const bal = (code: string) => Number((db.prepare(`SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS b FROM entry_lines l JOIN entries e ON e.id = l.entry_id WHERE l.account_code = ? AND e.status = 'approved'`).get(code) as { b: number }).b);
const tea = (qty = 1, price = 2_750) => ({ itemId: teaId, qtyMilli: qty * 1000, unitPrice: price });
const today = todayIso();

beforeEach(async () => {
  resetLoginThrottle(); resetPinFailures();
  db = openDatabase(':memory:'); app = buildApp(db);
  await ok('POST', '/api/plan/trial', {});
  warehouseId = (await ok('GET', '/api/warehouses'))[0].id;
  teaId = (await ok('POST', '/api/items', { code: 'TEA', name: { ar: 'ش', en: 'Tea', ku: 'چ' }, unit: 'piece', salePrice: 2_750, saleCurrency: 'IQD' })).id;
  const doc = await ok('POST', '/api/stock-docs', { kind: 'opening', date: '2026-01-01', warehouseId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 100_000, unitCost: 1_500 }] });
  await ok('POST', `/api/stock-docs/${doc.id}/post`, {});
});
afterEach(async () => { await app.close(); db.close(); });
const openShift = async () => ok('POST', '/api/pos/shifts', { register: 'C1', cashAccountCode: '1811', warehouseId, openingCash: 0 });
const back = (invoiceId: string, qty: number, payment: 'cash' | 'credit' = 'cash') =>
  call('POST', `/api/invoices/${invoiceId}/returns`, { date: today, payment, ...(payment === 'cash' ? { cashAccountCode: '1811' } : {}), lines: [{ lineNo: 1, qtyMilli: qty * 1000 }] });

describe('a sale a gift voucher paid', () => {
  it('expects no cash for it, shows it as a voucher, and a return puts it back on the voucher, never in cash', async () => {
    const shift = await openShift();
    const v = await ok('POST', `/api/pos/shifts/${shift.id}/gift-vouchers`, { amount: 10_000 });
    const sale = await ok('POST', `/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(2)], vouchers: [{ code: v.code, amount: 5_500 }] });
    // the drawer holds the voucher's 10,000 only: the sale brought no cash
    expect(sale.shift.expected.IQD).toBe(10_000);
    expect(sale.shift.methods.voucher.IQD).toBe(5_500);
    const day = await ok('GET', `/api/brief/day-close?date=${today}`);
    expect(day.methods.find((m: { method: string }) => m.method === 'voucher')).toMatchObject({ amount: 5_500 });
    expect(day.methods.find((m: { method: string }) => m.method === 'cash')).toBeUndefined();
    // returned in "cash": no money leaves the safe, the voucher gets its 5,500 back
    expect((await back(sale.invoice.id, 2)).statusCode).toBe(201);
    expect(bal('1811')).toBe(10_000);
    expect(bal('263')).toBe(-10_000);
    expect((await ok('GET', `/api/pos/gift-vouchers/lookup?code=${v.code}`)).balance).toBe(10_000);
  });

  it('shares a part-voucher sale out on a partial return: the voucher share onto the voucher, the cash share in cash', async () => {
    const shift = await openShift();
    const v = await ok('POST', `/api/pos/shifts/${shift.id}/gift-vouchers`, { amount: 5_500 });
    // 4 teas = 11,000: half by voucher, half cash
    const sale = await ok('POST', `/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(4)], vouchers: [{ code: v.code, amount: 5_500 }] });
    expect(bal('1811')).toBe(11_000);
    expect((await back(sale.invoice.id, 1)).statusCode).toBe(201);
    // 2,750 back: 1,375 cash, 1,375 onto the voucher
    expect(bal('1811')).toBe(11_000 - 1_375);
    expect((await ok('GET', `/api/pos/gift-vouchers/lookup?code=${v.code}`)).balance).toBe(1_375);
    // the rest comes back to the dinar, and never more cash than came in
    expect((await back(sale.invoice.id, 3)).statusCode).toBe(201);
    expect(bal('1811')).toBe(5_500);
    expect((await ok('GET', `/api/pos/gift-vouchers/lookup?code=${v.code}`)).balance).toBe(5_500);
  });
});

describe('a sale with its cash rounded', () => {
  it('gives back the rounded cash on a full return, and the rounding account comes back to nothing', async () => {
    expect((await call('PUT', '/api/pos/rules', { rounding: { step: 500, mode: 'down' } })).statusCode).toBe(200);
    const shift = await openShift();
    const sale = await ok('POST', `/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(1)] });
    expect(sale.rounding).toBe(-250);
    expect(bal('1811')).toBe(2_500);
    const r = await back(sale.invoice.id, 1);
    expect(r.statusCode, r.body).toBe(201);
    expect(bal('1811')).toBe(0);
    expect(bal('39')).toBe(0);
    expect((await ok('GET', '/api/pos/current')).shift.expected.IQD).toBe(0);
  });

  it('never rounds a small sale down to no cash', async () => {
    expect((await call('PUT', '/api/pos/rules', { rounding: { step: 500, mode: 'down' } })).statusCode).toBe(200);
    const shift = await openShift();
    const cheap = await ok('POST', `/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(1, 250)] });
    expect(cheap.rounding).toBe(0);
    expect(bal('1811')).toBe(250);
  });
});

describe('a till sale on the customer\'s account', () => {
  it('is never paid back in cash from the drawer', async () => {
    const ali = await ok('POST', '/api/parties', { type: 'customer', name: 'Ali' });
    const shift = await openShift();
    const sale = await ok('POST', `/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, partyId: ali.id, payments: [{ method: 'account', amount: 2_750 }], lines: [tea(1)] });
    await ok('POST', `/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(4)] });
    expect((await back(sale.invoice.id, 1)).json()).toMatchObject({ details: [{ code: 'refund_more_than_paid', available: 0 }] });
    expect((await back(sale.invoice.id, 1, 'credit')).statusCode).toBe(201);
  });
});

describe("a gift voucher's own entries", () => {
  it("can't be reversed or deleted from the journal; expired balances go to income through a draft entry", async () => {
    const shift = await openShift();
    const v = await ok('POST', `/api/pos/shifts/${shift.id}/gift-vouchers`, { amount: 10_000 });
    db.prepare("UPDATE gift_vouchers SET expires_on = '2020-01-31' WHERE id = ?").run(v.id);
    const entryId = (db.prepare('SELECT entry_id FROM gift_vouchers WHERE id = ?').get(v.id) as { entry_id: string }).entry_id;
    // (accounting review #5) reversing the sale of the voucher from the journal would leave it spendable
    expect((await call('POST', `/api/entries/${entryId}/reverse`, {})).json()).toMatchObject({ error: 'entry_belongs_to_gift_voucher' });
    // expired with 10,000 on it: still owed until an admin writes it off
    expect((await ok('GET', `/api/brief/day-close?date=${today}`)).giftExpired).toEqual({ count: 1, amount: 10_000 });
    const off = await ok('POST', '/api/pos/gift-vouchers/expire', {});
    expect(off).toMatchObject({ count: 1, amount: 10_000 });
    const entry = await ok('GET', `/api/entries/${off.entryId}`);
    expect(entry).toMatchObject({ status: 'draft' });
    expect((await call('DELETE', `/api/entries/${off.entryId}`)).json()).toMatchObject({ error: 'entry_belongs_to_gift_voucher' });
    expect((await ok('GET', `/api/pos/gift-vouchers/lookup?code=${v.code}`)).balance).toBe(0);
    expect((await ok('GET', `/api/brief/day-close?date=${today}`)).giftExpired).toEqual({ count: 0, amount: 0 });
  });
});
