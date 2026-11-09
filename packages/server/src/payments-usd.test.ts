import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { migrate, openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { copyCompany } from './db-copy.ts';
import { aging } from './brief.ts';
import { batchBalance } from './batches.ts';

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let merId: string;
let lasId: string;
let itemId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Raz') };
const call = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) =>
  app.inject({ method, url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
const ok = async (method: 'POST' | 'PUT', url: string, body: unknown = {}) => {
  const r = await call(method, url, body);
  expect(r.statusCode, `${url} ${r.body}`).toBeLessThan(300);
  return r.json();
};

async function sale(partyId: string, currency: 'IQD' | 'USD', unitPrice: number, payment: 'credit' | 'cash' = 'credit', date = '2026-10-02') {
  const d = await ok('POST', '/api/invoices', {
    kind: 'sale', date, partyId, warehouseId, currency, rateX100: currency === 'USD' ? 150_000 : 100, payment, discount: 0,
    ...(payment === 'cash' ? { cashAccountCode: currency === 'USD' ? '1832' : '1811' } : {}),
    lines: [{ itemId, qtyMilli: 1000, unitPrice }]
  });
  return ok('POST', `/api/invoices/${d.id}/post`);
}

async function receipt(partyId: string, currency: 'IQD' | 'USD', amount: number, date = '2026-10-05') {
  const party = (await call('GET', `/api/parties/${partyId}`)).json();
  const v = await ok('POST', '/api/vouchers', {
    kind: 'receipt', date, cashAccountCode: currency === 'USD' ? '1832' : '1811', description: 'Receipt', currency, rateX100: currency === 'USD' ? 150_000 : 100,
    items: [{ accountCode: party.accountCode, amount, partyId }]
  });
  await ok('POST', `/api/entries/${v.id}/check`);
  await ok('POST', `/api/entries/${v.id}/approve`);
}

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await call('GET', '/api/warehouses')).json()[0].id;
  merId = (await ok('POST', '/api/parties', { type: 'customer', name: 'Mer', creditLimit: 100_000 })).id;
  lasId = (await ok('POST', '/api/parties', { type: 'customer', name: 'Las' })).id;
  itemId = (await ok('POST', '/api/items', { code: 'SVC', name: { ar: 'خدمة', en: 'Service', ku: 'خزمەت' }, unit: 'service', salePrice: 10_000, saleCurrency: 'IQD' })).id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('dollar balances for customers and suppliers', () => {
  it('keeps each currency in its own: balances, a running dollar balance on the statement, and the aging', async () => {
    await sale(lasId, 'IQD', 50_000);
    await sale(lasId, 'USD', 20_000, 'credit', '2026-10-03'); // $200.00 at 1,500
    await receipt(lasId, 'USD', 5_000); // $50.00
    await receipt(lasId, 'IQD', 10_000);
    const mer = (await call('GET', `/api/parties/${lasId}`)).json();
    expect(mer.balances).toEqual({ IQD: 40_000, USD: 15_000 });
    expect(mer.balance).toBe(40_000 + 225_000); // IQD at the book rates stays the official total
    expect((await call('GET', '/api/parties?type=customer')).json().find((p: { id: string }) => p.id === merId).balances).toEqual({ IQD: 0, USD: 0 });

    const usd = (await call('GET', `/api/parties/${lasId}/statement?currency=USD`)).json();
    expect(usd.currency).toBe('USD');
    expect(usd.lines.map((l: { debit: number; credit: number; balance: number; currency: string }) => [l.debit, l.credit, l.balance, l.currency]))
      .toEqual([[20_000, 0, 20_000, 'USD'], [0, 5_000, 15_000, 'USD']]);
    expect(usd.closing).toBe(15_000);
    const all = (await call('GET', `/api/parties/${lasId}/statement`)).json();
    expect(all.currency).toBeNull();
    expect(all.lines.map((l: { currency: string; amount: number }) => [l.currency, l.amount])).toEqual([['IQD', 50_000], ['USD', 20_000], ['USD', -5_000], ['IQD', -10_000]]);
    expect(all.closing).toBe(265_000);
    const iqdOpening = (await call('GET', `/api/parties/${lasId}/statement?currency=IQD&from=2026-10-04`)).json();
    expect(iqdOpening).toMatchObject({ opening: 50_000, closing: 40_000 });

    // the aging adds what each owes in dollars
    expect(aging(db, 'customer', '2026-10-10').find((r) => r.partyId === lasId)).toMatchObject({ balance: 265_000, usd: 15_000 });

    // a dollar bank's statement runs in dollars
    const bank = (await call('GET', '/api/reports/statement?account=1832&currency=USD')).json();
    expect(bank.currency).toBe('USD');
    expect(bank.rows.map((r: { debit: number; credit: number }) => [r.debit, r.credit])).toEqual([[5_000, 0]]);
  });

  it('gives a user limited to a branch only their branches\' lines (the same filter as the IQD balance)', async () => {
    await sale(lasId, 'USD', 20_000);
    const { getParty } = await import('./parties.ts');
    expect(getParty(db, lasId, { warehouses: [], accounts: [] }).balances).toEqual({ IQD: 0, USD: 0 });
    expect(getParty(db, lasId, { warehouses: [warehouseId], accounts: [] }).balances).toEqual({ IQD: 0, USD: 20_000 });
  });
});

describe('POS payment methods and split payments', () => {
  let shiftId: string;
  beforeEach(async () => {
    shiftId = (await ok('POST', '/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 10_000 })).id;
  });
  const sell = (body: object) => call('POST', `/api/pos/shifts/${shiftId}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId, qtyMilli: 3000, unitPrice: 10_000 }], ...body });
  const safe = () => (db.prepare("SELECT COALESCE(SUM(base_debit) - SUM(base_credit), 0) AS v FROM entry_lines l JOIN entries e ON e.id = l.entry_id WHERE e.status = 'approved' AND account_code = ?").get('1811') as { v: number }).v;
  const card = () => (db.prepare("SELECT COALESCE(SUM(base_debit) - SUM(base_credit), 0) AS v FROM entry_lines WHERE account_code = '1831'").get() as { v: number }).v;

  it('all cash is as before: the whole sale into the safe and the drawer', async () => {
    const r = await sell({});
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().invoice.payments).toEqual([]);
    expect(r.json().shift).toMatchObject({ expected: { IQD: 40_000, USD: 0 }, methods: { cash: { IQD: 30_000, USD: 0 } } });
    expect(safe()).toBe(30_000);
  });

  it('a card + cash split posts to two accounts; only the cash counts toward the drawer; a hidden method is refused', async () => {
    expect((await sell({ payments: [{ method: 'card', amount: 20_000 }, { method: 'cash', amount: 10_000 }] })).json().details).toEqual([{ code: 'pos_method_unavailable', method: 'card' }]);
    // the payment accounts are an admin's setting
    const methods = (await ok('PUT', '/api/pos/payment-accounts', { card: '1831' })).methods;
    expect(methods).toEqual(['cash', 'card', 'account']);
    expect((await call('PUT', '/api/pos/payment-accounts', { fib: '211' })).statusCode).toBe(400);

    const r = await sell({ payments: [{ method: 'card', amount: 20_000 }, { method: 'cash', amount: 10_000 }] });
    expect(r.statusCode, r.body).toBe(201);
    const inv = r.json().invoice;
    expect(inv.payments.map((p: { kind: string; method: string; accountCode: string; amount: number }) => [p.kind, p.method, p.accountCode, p.amount]).sort()).toEqual([['pos', 'card', '1831', 20_000], ['pos', 'cash', '1811', 10_000]]);
    expect(inv.baseTotal).toBe(30_000);
    expect(safe()).toBe(10_000);
    expect(card()).toBe(20_000);
    const shift = (await call('GET', `/api/pos/shifts/${shiftId}`)).json();
    expect(shift).toMatchObject({ sales: { IQD: 30_000 }, expected: { IQD: 20_000 }, methods: { card: { IQD: 20_000 }, cash: { IQD: 10_000 } } });

    // a total that doesn't add up
    expect((await sell({ payments: [{ method: 'card', amount: 20_000 }] })).json().details[0].code).toBe('payments_total_mismatch');

    // a return of the split sale and the cancel of the sale undo it
    const ret = await call('POST', `/api/invoices/${inv.id}/returns`, { date: inv.date, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    expect(ret.statusCode, ret.body).toBe(201);
    expect((await call('POST', `/api/invoices/${ret.json().id}/cancel`, { date: inv.date })).statusCode).toBe(200);
    expect((await call('POST', `/api/invoices/${inv.id}/cancel`, { date: inv.date })).statusCode).toBe(200);
    expect(safe()).toBe(0);
    expect(card()).toBe(0);
    expect((await call('GET', `/api/pos/shifts/${shiftId}`)).json().expected).toEqual({ IQD: 10_000, USD: 0 });
  });

  it('on account puts that part on the chosen customer, checked against the credit limit', async () => {
    expect((await sell({ payments: [{ method: 'account', amount: 30_000 }] })).json().details).toEqual([{ code: 'party_required' }]);
    const r = await sell({ partyId: merId, payments: [{ method: 'account', amount: 25_000 }, { method: 'cash', amount: 5_000 }] });
    expect(r.statusCode, r.body).toBe(201);
    expect((await call('GET', `/api/parties/${merId}`)).json().balance).toBe(25_000);
    // the limit is 100,000: 25,000 owed + 90,000 more is over it, though the sale itself is not all on account
    const over = await call('POST', `/api/pos/shifts/${shiftId}/sales`, {
      currency: 'IQD', discount: 0, partyId: merId, lines: [{ itemId, qtyMilli: 10_000, unitPrice: 10_000 }], payments: [{ method: 'account', amount: 90_000 }, { method: 'cash', amount: 10_000 }]
    });
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toBe('credit_limit_exceeded');
    expect((await call('GET', `/api/pos/shifts/${shiftId}`)).json().expected.IQD).toBe(15_000);
  });

  it('pays a split sale back the way it was paid: never more cash from the drawer than came into it', async () => {
    await ok('PUT', '/api/pos/payment-accounts', { card: '1831' });
    const inv = (await ok('POST', `/api/pos/shifts/${shiftId}/sales`, {
      currency: 'IQD', discount: 0, lines: [{ itemId, qtyMilli: 3000, unitPrice: 10_000 }], payments: [{ method: 'card', amount: 20_000 }, { method: 'cash', amount: 10_000 }]
    })).invoice;
    const refund = (qtyMilli: number, cashAccountCode: string) =>
      call('POST', `/api/invoices/${inv.id}/returns`, { date: inv.date, payment: 'cash', cashAccountCode, lines: [{ lineNo: 1, qtyMilli }] });
    // the card part (20,000) never came into the drawer: it can't be taken out of it
    const fromDrawer = await refund(2000, '1811');
    expect(fromDrawer.statusCode).toBe(400);
    expect(fromDrawer.json().details).toEqual([{ code: 'refund_more_than_paid', available: 10_000 }]);
    expect((await call('GET', `/api/pos/shifts/${shiftId}`)).json().expected.IQD).toBe(20_000);
    // the cash part from the drawer, the card part back to the card's account
    expect((await refund(1000, '1811')).statusCode).toBe(201);
    expect((await refund(1000, '1811')).json().details).toEqual([{ code: 'refund_more_than_paid', available: 0 }]);
    expect((await refund(2000, '1831')).statusCode).toBe(201);
    expect((await call('GET', `/api/pos/shifts/${shiftId}`)).json().expected.IQD).toBe(10_000);
  });
});

describe('a copy of the books with units, batches and payments', () => {
  it('copies every new table and its totals', async () => {
    const med = (await ok('POST', '/api/items', {
      code: 'MED', name: { ar: 'دواء', en: 'Medicine', ku: 'دەرمان' }, unit: 'tablet', salePrice: 100, saleCurrency: 'IQD', trackExpiry: true,
      units: [{ unit: 'box', factorMilli: 20_000, barcode: '999' }]
    })).id;
    const sup = (await ok('POST', '/api/parties', { type: 'supplier', name: 'Raz' })).id;
    const d = await ok('POST', '/api/invoices', {
      kind: 'purchase', date: '2026-10-01', partyId: sup, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: [{ itemId: med, unit: 'box', unitQtyMilli: 3_000, unitPrice: 1_500, batchNo: 'B1', expiry: '2099-12-31' }]
    });
    await ok('POST', `/api/invoices/${d.id}/post`);
    await ok('PUT', '/api/pos/payment-accounts', { qi: '1831' });
    const shift = await ok('POST', '/api/pos/shifts', { register: 'Counter 2', cashAccountCode: '1811', warehouseId, openingCash: 0 });
    await ok('POST', `/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: med, unit: 'box', unitQtyMilli: 1000, unitPrice: 2_000 }], payments: [{ method: 'qi', amount: 2_000 }] });
    expect(batchBalance(db, med, warehouseId)).toEqual({ batches: 40_000, stock: 40_000 });

    const to = new DatabaseSync(':memory:') as unknown as Db;
    to.exec('PRAGMA foreign_keys = ON');
    migrate(to);
    const summary = copyCompany(db, to);
    for (const table of ['item_units', 'item_batches', 'stock_batch_moves', 'invoice_payments']) expect(summary.tables[table], table).toBeGreaterThan(0);
    expect(to.prepare('SELECT SUM(qty_milli) AS q FROM stock_batch_moves').get()).toEqual({ q: 40_000 });
    expect(to.prepare('SELECT SUM(amount) AS a FROM invoice_payments').get()).toEqual({ a: 2_000 });
  });
});
