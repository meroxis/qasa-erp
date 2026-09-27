import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { migrate, openDatabase, SCHEMA_VERSION, schemaVersion, type Db } from './db.ts';
import { buildApp } from './app.ts';

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let customerId: string;
let supplierId: string;
let acId: string;
let installId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer Las') };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const get = (url: string) => app.inject(url);

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  customerId = (await post('/api/parties', { type: 'customer', name: 'Sanos Company' })).json().id;
  supplierId = (await post('/api/parties', { type: 'supplier', name: 'RapidNet Ltd' })).json().id;
  acId = (await post('/api/items', { code: 'AC-18', name: { ar: 'مكيف', en: 'AC 18,000 BTU', ku: 'سپلیت' }, unit: 'piece', salePrice: 823_600, saleCurrency: 'IQD' })).json().id;
  installId = (await post('/api/items', { name: { ar: 'نصب', en: 'Installation', ku: 'دامەزراندن' }, unit: 'service', salePrice: 50_000, saleCurrency: 'IQD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function postNew(body: object) {
  const draft = await post('/api/invoices', body);
  expect(draft.statusCode, draft.body).toBe(201);
  const posted = await post(`/api/invoices/${draft.json().id}/post`);
  expect(posted.statusCode, posted.body).toBe(200);
  return posted.json();
}

const buy = (qty: number, price = 600_000, extra: object = {}) => postNew({
  kind: 'purchase', date: '2026-09-02', partyId: supplierId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
  lines: [{ itemId: acId, qtyMilli: qty * 1000, unitPrice: price }], ...extra
});

const sell = (extra: object = {}) => postNew({
  kind: 'sale', date: '2026-09-10', partyId: customerId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
  lines: [{ itemId: acId, qtyMilli: 3000, unitPrice: 823_600 }, { itemId: installId, qtyMilli: 1000, unitPrice: 50_000 }], ...extra
});

async function stockIn(warehouse = warehouseId) {
  const item = (await get(`/api/items/${acId}`)).json() as { stock: { warehouseId: string; qtyMilli: number; value: number }[] };
  const s = item.stock.find((x) => x.warehouseId === warehouse);
  return { qty: (s?.qtyMilli ?? 0) / 1000, value: s?.value ?? 0 };
}

async function trialBalance() {
  const tb = (await get('/api/reports/trial-balance')).json() as { rows: { code: string; balance: number }[]; totalDebit: number; totalCredit: number };
  expect(tb.totalDebit).toBe(tb.totalCredit);
  return new Map(tb.rows.map((r) => [r.code, r.balance]));
}

const balanceOf = async (partyId: string) => (await get(`/api/parties/${partyId}`)).json().balance as number;

describe('sales returns', () => {
  it('takes goods back at their original cost and reduces what the customer owes', async () => {
    await buy(10);
    const invoice = await sell();
    const res = await post(`/api/invoices/${invoice.id}/returns`, { date: '2026-09-12', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 2000 }] });
    expect(res.statusCode, res.body).toBe(201);
    const ret = res.json();
    expect(ret).toMatchObject({ kind: 'sale_return', status: 'posted', number: 'SR-2026-0001', returnOf: invoice.id, returnOfNumber: 'INV-2026-0001', total: 1_647_200, actions: ['cancel'] });
    expect(ret.lines[0]).toMatchObject({ sourceLine: 1, qtyMilli: 2000, cost: 1_200_000 });
    expect(await stockIn()).toEqual({ qty: 9, value: 5_400_000 });
    expect(await balanceOf(customerId)).toBe(2_520_800 - 1_647_200);
    const tb = await trialBalance();
    expect(tb.get('35')).toBe(1_800_000 - 1_200_000);

    const original = (await get(`/api/invoices/${invoice.id}`)).json();
    expect(original.lines[0].returnedQtyMilli).toBe(2000);
    expect(original.actions).toEqual(['return']); // no cancel while a return stands
    expect(original.returns).toMatchObject([{ id: ret.id, number: 'SR-2026-0001', status: 'posted' }]);

    const tooMany = await post(`/api/invoices/${invoice.id}/returns`, { date: '2026-09-12', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 2000 }] });
    expect(tooMany.json()).toMatchObject({ error: 'validation', details: [{ code: 'return_qty_exceeded', line: 1, available: 1000 }] });
    expect((await post(`/api/invoices/${invoice.id}/cancel`)).json().error).toBe('has_returns');

    // cancelling the return takes the goods out again and puts the balance back; then the invoice can be cancelled
    expect((await post(`/api/invoices/${ret.id}/cancel`, { date: '2026-09-13' })).json().status).toBe('cancelled');
    expect(await stockIn()).toEqual({ qty: 7, value: 4_200_000 });
    expect(await balanceOf(customerId)).toBe(2_520_800);
    expect((await get(`/api/invoices/${invoice.id}`)).json().actions).toEqual(['cancel', 'return']);
  });

  it('shares the invoice discount so partial returns add up to exactly what was charged', async () => {
    await buy(10);
    const invoice = await sell({ discount: 100_000 });
    const first = (await post(`/api/invoices/${invoice.id}/returns`, { date: '2026-09-12', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 1000 }] })).json();
    const rest = (await post(`/api/invoices/${invoice.id}/returns`, { date: '2026-09-14', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 2000 }, { lineNo: 2, qtyMilli: 1000 }] })).json();
    expect(first.total + rest.total).toBe(invoice.total);
    expect(await balanceOf(customerId)).toBe(0);
    expect(await stockIn()).toEqual({ qty: 10, value: 6_000_000 });
    const original = (await get(`/api/invoices/${invoice.id}`)).json();
    expect(original.actions).toEqual([]); // everything came back
  });

  it('refunds cash from a safe', async () => {
    await buy(10);
    const invoice = await sell({ payment: 'cash', cashAccountCode: '1811', partyId: undefined });
    const ret = (await post(`/api/invoices/${invoice.id}/returns`, { date: '2026-09-12', payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 2, qtyMilli: 1000 }] })).json();
    expect(ret).toMatchObject({ status: 'posted', total: 50_000, payment: 'cash' });
    expect((await trialBalance()).get('1811')).toBe(2_520_800 - 50_000);
    const credit = await post(`/api/invoices/${invoice.id}/returns`, { date: '2026-09-12', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    expect(credit.json().details).toContainEqual({ code: 'party_required' });
  });
});

describe('purchase returns', () => {
  it('sends goods back to the supplier at their purchase cost', async () => {
    const invoice = await buy(10);
    const ret = (await post(`/api/invoices/${invoice.id}/returns`, { date: '2026-09-05', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 4000 }] })).json();
    expect(ret).toMatchObject({ kind: 'purchase_return', number: 'PR-2026-0001', total: 2_400_000 });
    expect(await stockIn()).toEqual({ qty: 6, value: 3_600_000 });
    expect(await balanceOf(supplierId)).toBe(3_600_000);
    const tb = await trialBalance();
    expect(tb.get('1371')).toBe(3_600_000);
    expect(tb.has('35')).toBe(false);
  });

  it('cannot send back goods that were already sold', async () => {
    const invoice = await buy(4);
    await sell();
    const res = await post(`/api/invoices/${invoice.id}/returns`, { date: '2026-09-12', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 2000 }] });
    expect(res.json().details).toEqual([{ code: 'stock_insufficient', line: 1, available: 1000 }]);
  });

  it('is refused before the invoice date, and entries made by documents cannot be reversed by hand', async () => {
    const invoice = await buy(4);
    const early = await post(`/api/invoices/${invoice.id}/returns`, { date: '2026-09-01', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    expect(early.json().details).toContainEqual({ code: 'return_before_invoice' });
    const ret = (await post(`/api/invoices/${invoice.id}/returns`, { date: '2026-09-03', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 1000 }] })).json();
    expect((await post(`/api/entries/${ret.entryId}/reverse`)).statusCode).toBe(409);
    expect((await get(`/api/entries/${ret.entryId}`)).json()).toMatchObject({ type: 'purchase_return', number: 'PR-2026-0001', invoiceId: ret.id, actions: [] });
  });
});

describe('opening stock', () => {
  const opening = (lines: object[], extra: object = {}) => ({ kind: 'opening', date: '2026-01-01', warehouseId, counterAccountCode: '21', lines, ...extra });

  it('brings goods on hand into a warehouse against capital', async () => {
    const draft = await post('/api/stock-docs', opening([{ itemId: acId, qtyMilli: 5000, unitCost: 500_000 }]));
    expect(draft.statusCode, draft.body).toBe(201);
    expect(draft.json()).toMatchObject({ status: 'draft', totalValue: 2_500_000, actions: ['edit', 'delete', 'post'] });
    const posted = (await post(`/api/stock-docs/${draft.json().id}/post`)).json();
    expect(posted).toMatchObject({ status: 'posted', number: 'OS-2026-0001', totalValue: 2_500_000, entryNumber: 'OS-2026-0001', actions: ['cancel'] });
    expect(await stockIn()).toEqual({ qty: 5, value: 2_500_000 });
    const tb = await trialBalance();
    expect(tb.get('1371')).toBe(2_500_000);
    expect(tb.get('21')).toBe(2_500_000);
    expect((await get(`/api/entries/${posted.entryId}`)).json()).toMatchObject({ stockDocId: posted.id, actions: [] });
  });

  it('checks its lines and account', async () => {
    const res = await post('/api/stock-docs', opening([{ itemId: installId, qtyMilli: 1000, unitCost: 1 }, { itemId: acId, qtyMilli: 0, unitCost: 5 }, { itemId: acId, qtyMilli: 1000 }], { counterAccountCode: '1371' }));
    expect(res.json().details).toEqual(expect.arrayContaining([
      { code: 'account_invalid' }, { code: 'item_not_stock', line: 1 }, { code: 'line_qty_invalid', line: 2 }, { code: 'line_price_invalid', line: 3 }
    ]));
  });

  it('can be cancelled only while its goods are still there', async () => {
    const doc = (await post('/api/stock-docs', opening([{ itemId: acId, qtyMilli: 3000, unitCost: 500_000 }]))).json();
    await post(`/api/stock-docs/${doc.id}/post`);
    await sell();
    expect((await post(`/api/stock-docs/${doc.id}/cancel`, { date: '2026-09-11' })).json().details).toEqual([{ code: 'stock_insufficient', line: 1, available: 0 }]);
  });
});

describe('transfers between warehouses', () => {
  it('moves goods at average cost from one warehouse account to the other', async () => {
    await post('/api/plan/trial'); // a second warehouse needs Pro (or the trial)
    const erbil = (await post('/api/warehouses', { code: 'ERBIL', name: { ar: 'أربيل', en: 'Erbil', ku: 'هەولێر' } })).json();
    await buy(10);
    const body = { kind: 'transfer', date: '2026-09-04', warehouseId, toWarehouseId: erbil.id, lines: [{ itemId: acId, qtyMilli: 4000 }] };
    expect((await post('/api/stock-docs', { ...body, toWarehouseId: warehouseId })).json().details).toContainEqual({ code: 'same_warehouse' });
    const doc = (await post('/api/stock-docs', body)).json();
    const posted = (await post(`/api/stock-docs/${doc.id}/post`)).json();
    expect(posted).toMatchObject({ number: 'ST-2026-0001', totalValue: 2_400_000, lines: [{ value: 2_400_000 }] });
    expect(await stockIn()).toEqual({ qty: 6, value: 3_600_000 });
    expect(await stockIn(erbil.id)).toEqual({ qty: 4, value: 2_400_000 });
    const tb = await trialBalance();
    expect([tb.get('1371'), tb.get(erbil.accountCode)]).toEqual([3_600_000, 2_400_000]);

    const tooMuch = (await post('/api/stock-docs', { ...body, lines: [{ itemId: acId, qtyMilli: 7000 }] })).json();
    expect((await post(`/api/stock-docs/${tooMuch.id}/post`)).json().details).toEqual([{ code: 'stock_insufficient', line: 1, available: 6000 }]);
    expect((await app.inject({ method: 'DELETE', url: `/api/stock-docs/${tooMuch.id}`, headers })).statusCode).toBe(204);

    expect((await post(`/api/stock-docs/${doc.id}/cancel`, { date: '2026-09-05' })).json().status).toBe('cancelled');
    expect(await stockIn()).toEqual({ qty: 10, value: 6_000_000 });
    expect(await stockIn(erbil.id)).toEqual({ qty: 0, value: 0 });
    expect((await get('/api/stock-docs?kind=transfer')).json().map((d: { status: string }) => d.status)).toEqual(['cancelled']);
  });
});

describe('upgrading a version-2 company file', () => {
  it('keeps posted invoices and their protection', () => {
    const old = new DatabaseSync(':memory:');
    old.exec('PRAGMA foreign_keys = ON');
    migrate(old, 2);
    const now = new Date().toISOString();
    old.prepare("INSERT INTO accounts (code, name_ar, name_en, name_ku, system, created_at) VALUES ('1371', 'م', 'Stock', 'ک', 0, ?), ('2611', 'م', 'Suppliers', 'د', 0, ?)").run(now, now);
    old.prepare("INSERT INTO warehouses (id, code, name_ar, name_en, name_ku, account_code, active, created_at) VALUES ('w1', 'MAIN', 'م', 'Main', 'ک', '1371', 1, ?)").run(now);
    old.prepare("INSERT INTO parties (id, type, code, name, account_code, created_at) VALUES ('p1', 'supplier', 'S-0001', 'RapidNet Ltd', '2611', ?)").run(now);
    old.prepare("INSERT INTO items (id, code, name_ar, name_en, name_ku, unit, sale_price, sale_currency, created_at) VALUES ('i1', 'AC', 'م', 'AC', 'ک', 'piece', 0, 'IQD', ?)").run(now);
    old.prepare(`INSERT INTO invoices (id, kind, status, date, party_id, warehouse_id, currency, rate_x100, payment, subtotal, total, created_by, created_at, updated_at)
                 VALUES ('v1', 'purchase', 'draft', '2026-09-01', 'p1', 'w1', 'IQD', 100, 'credit', 500, 500, 'a', ?, ?)`).run(now, now);
    old.prepare("INSERT INTO invoice_lines (invoice_id, line_no, item_id, qty_milli, unit_price, amount) VALUES ('v1', 1, 'i1', 1000, 500, 500)").run();
    old.prepare("UPDATE invoices SET status = 'posted', number = 'PI-2026-0001' WHERE id = 'v1'").run();

    migrate(old);
    expect(schemaVersion(old)).toBe(SCHEMA_VERSION);
    expect(old.prepare("SELECT kind, number, return_of FROM invoices WHERE id = 'v1'").get()).toEqual({ kind: 'purchase', number: 'PI-2026-0001', return_of: null });
    expect(() => old.prepare("UPDATE invoices SET total = 1 WHERE id = 'v1'").run()).toThrow(/posted_invoice_is_permanent/);
    expect(() => old.prepare("DELETE FROM invoice_lines WHERE invoice_id = 'v1'").run()).toThrow(/posted_invoice_is_permanent/);
    expect(old.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    old.close();
  });
});
