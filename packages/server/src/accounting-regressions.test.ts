import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import type { InvoiceView } from './invoices.ts';

let db: Db;
let app: FastifyInstance;
let warehouse: string;
let item: string;
let service: string;
const name = { ar: 'meroxis', en: 'meroxis', ku: 'meroxis' };
const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload });
const get = (url: string) => app.inject({ method: 'GET', url });

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouse = (await get('/api/warehouses')).json()[0].id;
  item = (await post('/api/items', { name, unit: 'kg', salePrice: 100, saleCurrency: 'IQD' })).json().id;
  service = (await post('/api/items', { name, unit: 'service', salePrice: 100, saleCurrency: 'IQD' })).json().id;
});
afterEach(async () => { await app.close(); db.close(); });

async function draft(kind: 'sale' | 'purchase', date: string, itemId: string, unitPrice: number, extra: object = {}) {
  const result = await post('/api/invoices', {
    kind, date, warehouseId: warehouse, currency: 'IQD', rateX100: 100, payment: 'cash', cashAccountCode: '1811', discount: 0,
    lines: [{ itemId, qtyMilli: 1000, unitPrice }], ...extra
  });
  expect(result.statusCode, result.body).toBe(201);
  return result.json() as InvoiceView;
}
async function posted(kind: 'sale' | 'purchase', date: string, itemId: string, unitPrice: number, extra: object = {}) {
  const invoice = await draft(kind, date, itemId, unitPrice, extra);
  const result = await post(`/api/invoices/${invoice.id}/post`);
  expect(result.statusCode, result.body).toBe(200);
  return result.json() as InvoiceView;
}
async function refund(id: string, qtyMilli: number, date = '2025-06-22') {
  const result = await post(`/api/invoices/${id}/returns`, {
    date, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli }]
  });
  expect(result.statusCode, result.body).toBe(201);
  return result.json() as InvoiceView;
}
const cash = () => db.prepare(`SELECT SUM(l.debit-l.credit) AS amount, SUM(l.base_debit-l.base_credit) AS base
  FROM entry_lines l JOIN entries e ON e.id=l.entry_id WHERE e.status='approved' AND l.account_code='1811'`).get();

describe('partial-return reconciliation', () => {
  it('never refunds more than a two-cent sale across four quarter-unit returns', async () => {
    const invoice = await posted('sale', '2025-06-20', service, 2, { currency: 'USD', rateX100: 142000 });
    const totals: number[] = [];
    for (let i = 0; i < 4; i++) {
      totals.push((await refund(invoice.id, 250)).total);
      expect(totals.reduce((s, v) => s + v, 0)).toBeLessThanOrEqual(2);
    }
    expect(totals).toEqual([1, 0, 1, 0]);
    expect(cash()).toMatchObject({ amount: 0, base: 0 });
  });

  it('reconciles IQD rounding even after cancelling a middle return and returning again', async () => {
    const invoice = await posted('sale', '2025-06-20', service, 3, { currency: 'USD', rateX100: 142000 });
    const returns: InvoiceView[] = [];
    for (const qty of [333, 333, 334]) returns.push(await refund(invoice.id, qty));
    expect(returns.map((r) => r.total)).toEqual([1, 1, 1]);
    expect(returns.map((r) => r.baseTotal)).toEqual([14, 15, 14]);
    expect(cash()).toMatchObject({ amount: 0, base: 0 });
    expect((await post(`/api/invoices/${returns[1]!.id}/cancel`, { date: '2025-06-23' })).statusCode).toBe(200);
    const again = await refund(invoice.id, 333, '2025-06-24');
    expect(again).toMatchObject({ total: 1, baseTotal: 15 });
    expect(cash()).toMatchObject({ amount: 0, base: 0 });
  });

  it.each([0, 1, 2])('reconciles gross, discount, cash and inventory for a three-cent sale discounted by %i cents', async (discount) => {
    await posted('purchase', '2025-06-19', item, 3, { currency: 'USD', rateX100: 142000 });
    const invoice = await posted('sale', '2025-06-20', item, 3, { currency: 'USD', rateX100: 142000, discount });
    const returns: InvoiceView[] = [];
    for (let i = 0; i < 4; i++) returns.push(await refund(invoice.id, 250));
    expect(returns.every((r) => r.total >= 0 && r.discount >= 0 && r.lines[0]!.cost! >= 0)).toBe(true);
    expect(returns.reduce((s, r) => s + r.total, 0)).toBe(invoice.total);
    expect(returns.reduce((s, r) => s + r.discount, 0)).toBe(discount);
    expect(returns.reduce((s, r) => s + r.baseTotal, 0)).toBe(invoice.baseTotal);
    expect(returns.reduce((s, r) => s + r.lines[0]!.cost!, 0)).toBe(43);
    expect((await get(`/api/items/${item}`)).json()).toMatchObject({ qtyMilli: 1000, value: 43 });
    expect(cash()).toMatchObject({ amount: -3, base: -43 }); // only the original purchase remains
  });

  it('posts fractional purchase returns with sub-cent IQD rounding lines', async () => {
    const invoice = await posted('purchase', '2025-06-20', item, 2, { currency: 'USD', rateX100: 142000 });
    for (let i = 0; i < 4; i++) expect((await refund(invoice.id, 250)).total).toBeGreaterThanOrEqual(0);
    expect((await get(`/api/items/${item}`)).json()).toMatchObject({ qtyMilli: 0, value: 0 });
    expect(cash()).toMatchObject({ amount: 0, base: 0 });
    const balance = (await get('/api/reports/trial-balance')).json();
    expect(balance.totalDebit).toBe(balance.totalCredit);
    expect(balance.rows.every((r: { balance: number }) => r.balance === 0)).toBe(true);
  });
});

describe('warehouse accounts', () => {
  it('keeps existing warehouses postable after more than ten have been created', async () => {
    await post('/api/plan/trial');
    await posted('purchase', '2025-06-20', item, 100);
    const created: { id: string; accountCode: string }[] = [];
    for (let i = 2; i <= 15; i++) {
      const response = await post('/api/warehouses', { code: `W${i}`, name });
      expect(response.statusCode, response.body).toBe(201);
      created.push(response.json());
    }
    const accounts = (await get('/api/accounts')).json() as { code: string; parentCode: string; postable: boolean }[];
    expect(accounts.find((a) => a.code === '1371')?.postable).toBe(true);
    for (const w of created) expect(accounts.find((a) => a.code === w.accountCode)).toMatchObject({ postable: true, parentCode: '137' });
    await posted('purchase', '2025-06-21', item, 100);
    await posted('purchase', '2025-06-21', item, 100, { warehouseId: created.at(-1)!.id });
  });

  it('skips occupied parent prefixes and never creates a parent of an existing account', async () => {
    await post('/api/plan/trial');
    for (const code of ['13700', '1370100001']) {
      expect((await post('/api/accounts', { parentCode: '137', code, name })).statusCode).toBe(201);
    }
    const response = await post('/api/warehouses', { code: 'NEW', name });
    expect(response.statusCode, response.body).toBe(201);
    const accounts = (await get('/api/accounts')).json() as { code: string; parentCode: string; postable: boolean }[];
    expect(accounts.find((a) => a.code === response.json().accountCode)).toMatchObject({ parentCode: '137', postable: true });
    expect(accounts.find((a) => a.code === '13700')?.postable).toBe(true);
    expect(accounts.find((a) => a.code === '1370100001')?.postable).toBe(true);
  });
});

describe('dated stock and locked periods', () => {
  it.each(['sale', 'purchase'] as const)('rejects a backdated %s and rolls back its posting', async (kind) => {
    await posted('purchase', '2025-06-20', item, 100);
    const invoice = await draft(kind, '2025-06-10', item, 200);
    const before = db.prepare('SELECT COUNT(*) AS n FROM entries').get();
    const response = await post(`/api/invoices/${invoice.id}/post`);
    expect(response.statusCode).toBe(400);
    expect(response.json().details).toContainEqual({ code: 'stock_date_before_latest', date: '2025-06-20' });
    expect((await get(`/api/invoices/${invoice.id}`)).json()).toMatchObject({ status: 'draft', entryId: null, number: null });
    expect(db.prepare('SELECT COUNT(*) AS n FROM entries').get()).toEqual(before);
    expect((await get(`/api/items/${item}`)).json()).toMatchObject({ qtyMilli: 1000, value: 100 });
    const valid = await posted(kind, '2025-06-20', item, 200);
    expect(valid.number).toBe(kind === 'sale' ? 'INV-2025-0001' : 'PI-2025-0002');
  });

  it('rolls back both halves of a transfer when the destination has a later stock movement', async () => {
    await post('/api/plan/trial');
    const other = (await post('/api/warehouses', { code: 'OTHER', name })).json().id;
    await posted('purchase', '2025-06-10', item, 100);
    await posted('purchase', '2025-06-20', item, 200, { warehouseId: other });
    const doc = (await post('/api/stock-docs', { kind: 'transfer', date: '2025-06-15', warehouseId: warehouse, toWarehouseId: other, lines: [{ itemId: item, qtyMilli: 1000 }] })).json();
    const response = await post(`/api/stock-docs/${doc.id}/post`);
    expect(response.statusCode).toBe(400);
    expect(response.json().details[0].code).toBe('stock_date_before_latest');
    expect((await get(`/api/items/${item}`)).json()).toMatchObject({ qtyMilli: 2000, value: 300 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM stock_moves').get()).toMatchObject({ n: 2 });
    expect((await get(`/api/stock-docs/${doc.id}`)).json()).toMatchObject({ status: 'draft', entryId: null });
  });

  it('rejects backdated purchase returns and cancellations', async () => {
    const original = await posted('purchase', '2025-06-10', item, 100);
    await posted('purchase', '2025-06-20', item, 100);
    const ret = await post(`/api/invoices/${original.id}/returns`, { date: '2025-06-15', payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    expect(ret.statusCode).toBe(400);
    expect(ret.json().details[0].code).toBe('stock_date_before_latest');
    const cancelled = await post(`/api/invoices/${original.id}/cancel`, { date: '2025-06-15' });
    expect(cancelled.statusCode).toBe(400);
    expect(cancelled.json().details[0].code).toBe('stock_date_before_latest');
    expect((await get(`/api/items/${item}`)).json()).toMatchObject({ qtyMilli: 2000, value: 200 });
    expect((await get(`/api/invoices/${original.id}`)).json()).toMatchObject({ status: 'posted', cancelEntryId: null, returns: [] });
  });

  it('keeps a zero-value return unchanged when cancelling into a locked month', async () => {
    const opening = (await post('/api/stock-docs', { kind: 'opening', date: '2025-06-01', warehouseId: warehouse, counterAccountCode: '1811', lines: [{ itemId: item, qtyMilli: 1000, unitCost: 0 }] })).json();
    expect((await post(`/api/stock-docs/${opening.id}/post`)).statusCode).toBe(200);
    const invoice = await posted('sale', '2025-06-02', item, 0, {
      lines: [{ itemId: item, qtyMilli: 1000, unitPrice: 0 }, { itemId: service, qtyMilli: 1000, unitPrice: 100 }]
    });
    const ret = await refund(invoice.id, 1000, '2025-06-03');
    expect(ret).toMatchObject({ total: 0, entryId: null });
    await post('/api/periods/2025-06/lock');
    const response = await post(`/api/invoices/${ret.id}/cancel`, { date: '2025-06-04' });
    expect(response.statusCode).toBe(400);
    expect(response.json().details).toContainEqual({ code: 'period_locked', period: '2025-06' });
    expect((await get(`/api/invoices/${ret.id}`)).json().status).toBe('posted');
    expect((await get(`/api/items/${item}`)).json().qtyMilli).toBe(1000);
    expect((await post(`/api/invoices/${ret.id}/cancel`, { date: '2025-07-01' })).statusCode).toBe(200);
    expect((await get(`/api/items/${item}`)).json().qtyMilli).toBe(0);
  });
});
