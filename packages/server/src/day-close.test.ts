import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { dayClose } from './day-close.ts';

// The end-of-day close: the day's sales by how they were paid, the registers' drawers, expenses, debts and stock.
let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let customerId: string;
let teaId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const put = (url: string, body: unknown = {}) => app.inject({ method: 'PUT', url, payload: body as object, headers });
const get = (url: string) => app.inject({ url, headers });

// till sales are dated today, so the close is for today
const DAY = todayIso();

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  customerId = (await post('/api/parties', { type: 'customer', name: 'Las', phone: '0750 123 4567' })).json().id;
  teaId = (await post('/api/items', { code: 'TEA', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 10_000, saleCurrency: 'IQD', reorderMilli: 90_000 })).json().id;
  const doc = await post('/api/stock-docs', { kind: 'opening', date: addDays(DAY, -30), warehouseId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 100_000, unitCost: 4_000 }] });
  expect((await post(`/api/stock-docs/${doc.json().id}/post`)).statusCode).toBe(200);
  // a card terminal paying into the IQD bank account
  expect((await put('/api/pos/payment-accounts', { card: '1831' })).statusCode).toBe(200);
});

afterEach(async () => {
  await app.close();
  db.close();
});

const tea = (qty: number) => [{ itemId: teaId, qtyMilli: qty * 1000, unitPrice: 10_000 }];

async function invoice(body: object) {
  const draft = await post('/api/invoices', { kind: 'sale', date: DAY, warehouseId, currency: 'IQD', rateX100: 100, discount: 0, ...body });
  expect(draft.statusCode, draft.body).toBe(201);
  const posted = await post(`/api/invoices/${draft.json().id}/post`);
  expect(posted.statusCode, posted.body).toBe(200);
  return posted.json();
}

async function voucher(body: object) {
  const v = await post('/api/vouchers', { currency: 'IQD', rateX100: 100, date: DAY, cashAccountCode: '1811', ...body });
  expect(v.statusCode, v.body).toBe(201);
  expect((await post(`/api/entries/${v.json().id}/check`)).statusCode).toBe(200);
  expect((await post(`/api/entries/${v.json().id}/approve`)).statusCode).toBe(200);
}

describe('the end-of-day close', () => {
  it('splits the day\'s sales by how they were paid, takes returns off, and shows each register\'s drawer', async () => {
    // yesterday's sale is not today's
    await invoice({ date: addDays(DAY, -1), payment: 'cash', cashAccountCode: '1811', lines: tea(1) });
    const shift = (await post('/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 50_000 })).json();
    const sell = (body: object) => post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, ...body });
    expect((await sell({ lines: tea(2) })).statusCode).toBe(201); // 20,000 cash
    expect((await sell({ lines: tea(3), payments: [{ method: 'card', amount: 25_000 }, { method: 'cash', amount: 5_000 }] })).statusCode).toBe(201);
    expect((await sell({ lines: tea(1), partyId: customerId, payments: [{ method: 'account', amount: 10_000 }] })).statusCode).toBe(201);
    // the drawer is 2,000 short: 50,000 + 25,000 expected
    expect((await post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 73_000 })).statusCode).toBe(200);
    // a second register, still open
    const other = (await post('/api/pos/shifts', { register: 'Counter 2', cashAccountCode: '1811', warehouseId, openingCash: 0 })).json();
    expect((await post(`/api/pos/shifts/${other.id}/sales`, { currency: 'IQD', discount: 0, lines: tea(1) })).statusCode).toBe(201);

    await invoice({ payment: 'cash', cashAccountCode: '1811', lines: tea(4) }); // 40,000 cash
    await invoice({ payment: 'cash', cashAccountCode: '1831', lines: tea(5) }); // 50,000 into the bank
    const credit = await invoice({ payment: 'credit', partyId: customerId, lines: tea(6) }); // 60,000 on account
    // 2 teas of the credit sale come back to the customer's account
    const back = await post(`/api/invoices/${credit.id}/returns`, { date: DAY, payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 2000 }] });
    expect(back.statusCode, back.body).toBe(201);

    const res = await get(`/api/brief/day-close?date=${DAY}`);
    expect(res.statusCode, res.body).toBe(200);
    const c = res.json();
    expect(c.sales).toEqual({ gross: 20_000 + 30_000 + 10_000 + 10_000 + 40_000 + 50_000 + 60_000, invoices: 7, returns: 20_000, returnsCount: 1, net: 200_000 });
    const methods = Object.fromEntries(c.methods.map((m: { method: string; amount: number; invoices: number }) => [m.method, [m.amount, m.invoices]]));
    expect(methods).toEqual({ cash: [20_000 + 5_000 + 10_000 + 40_000, 4], card: [25_000, 1], credit: [10_000 + 60_000, 2], bank: [50_000, 1] });
    expect(c.methods[0].method).toBe('cash');
    expect(c.refunds).toEqual([{ method: 'credit', amount: 20_000 }]);

    expect(c.registers.map((r: { register: string; status: string }) => [r.register, r.status])).toEqual([['Counter 1', 'closed'], ['Counter 2', 'open']]);
    expect(c.registers[0]).toMatchObject({ expected: { IQD: 75_000, USD: 0 }, counted: { IQD: 73_000, USD: 0 }, difference: { IQD: -2_000, USD: 0 }, count: 3 });
    expect(c.registers[1]).toMatchObject({ counted: null, difference: null, expected: { IQD: 10_000, USD: 0 } });
    // only closed drawers add up to a count
    expect(c.drawers).toEqual({ expected: { IQD: 75_000, USD: 0 }, counted: { IQD: 73_000, USD: 0 }, difference: { IQD: -2_000, USD: 0 } });
    expect(c.topItems[0]).toMatchObject({ code: 'TEA', qtyMilli: 20_000 });
  });

  it('lists the day\'s expenses, the debts collected and the new ones, and counts what is running out', async () => {
    await invoice({ payment: 'credit', partyId: customerId, lines: tea(3) }); // owes 30,000 more
    await voucher({ kind: 'receipt', description: 'Paid on account', items: [{ accountCode: '1611', amount: 12_000, partyId: customerId }] });
    await voucher({ kind: 'payment', description: 'Generator fuel', items: [{ accountCode: '32', amount: 7_500 }] });
    // a receipt reversed later is no money collected
    await voucher({ kind: 'receipt', description: 'Mistake', items: [{ accountCode: '1611', amount: 1_000, partyId: customerId }] });
    const mistake = db.prepare("SELECT id FROM entries WHERE description = 'Mistake'").get() as { id: string };
    expect((await post(`/api/entries/${mistake.id}/reverse`, { date: DAY })).statusCode).toBe(200);

    const c = dayClose(db, DAY);
    expect(c.debts.collected).toBe(12_000);
    expect(c.debts.collectedRows).toEqual([{ partyId: customerId, code: expect.any(String), name: 'Las', amount: 12_000 }]);
    expect(c.debts.added).toBe(30_000);
    expect(c.expenses.total).toBe(7_500);
    expect(c.expenses.rows).toHaveLength(1);
    // 97 teas left, at or below the reorder level of 90? no: 97 > 90; sell 8 more and it is
    expect(c.lowStock.count).toBe(0);
    await invoice({ payment: 'cash', cashAccountCode: '1811', lines: tea(8) });
    expect(dayClose(db, DAY).lowStock).toMatchObject({ count: 1, top: [{ code: 'TEA', qtyMilli: 89_000 }] });
    expect(c.flow.in).toBe(12_000 + 1_000);
  });

  it('is empty on a quiet day, and refuses a date that is not one', async () => {
    const quiet = await get(`/api/brief/day-close?date=${addDays(DAY, -400)}`);
    expect(quiet.statusCode).toBe(200);
    expect(quiet.json()).toMatchObject({ sales: { gross: 0, net: 0, invoices: 0 }, methods: [], refunds: [], registers: [], drawers: null, expenses: { total: 0 } });
    expect((await get('/api/brief/day-close?date=2026-13-45')).statusCode).toBe(400);
    expect((await get("/api/brief/day-close?date=2026-11-01' OR 1=1")).statusCode).toBe(400);
  });
});
