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
  customerId = (await post('/api/parties', { type: 'customer', name: 'Sanos Company', phone: '0750 123 4567' })).json().id;
  supplierId = (await post('/api/parties', { type: 'supplier', name: 'RapidNet Ltd' })).json().id;
  acId = (await post('/api/items', { code: 'AC-18', name: { ar: 'مكيف 18 ألف وحدة', en: 'AC 18,000 BTU', ku: 'سپلیتی ١٨ هەزار' }, unit: 'piece', salePrice: 823_600, saleCurrency: 'IQD' })).json().id;
  installId = (await post('/api/items', { name: { ar: 'نصب وتشغيل', en: 'Installation', ku: 'دامەزراندن' }, unit: 'service', salePrice: 50_000, saleCurrency: 'IQD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

const purchase = (qty: number, price: number, extra: object = {}) => ({
  kind: 'purchase', date: '2026-09-20', partyId: supplierId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
  lines: [{ itemId: acId, qtyMilli: qty * 1000, unitPrice: price }], ...extra
});

const sale = (extra: object = {}) => ({
  kind: 'sale', date: '2026-09-26', partyId: customerId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
  lines: [{ itemId: acId, qtyMilli: 3000, unitPrice: 823_600 }, { itemId: installId, qtyMilli: 1000, unitPrice: 50_000 }], ...extra
});

async function postNew(body: object) {
  const draft = await post('/api/invoices', body);
  expect(draft.statusCode, draft.body).toBe(201);
  return post(`/api/invoices/${draft.json().id}/post`);
}

async function stock() {
  const item = (await get(`/api/items/${acId}`)).json();
  return { qty: item.qtyMilli / 1000, value: item.value };
}

async function trialBalance() {
  const tb = (await get('/api/reports/trial-balance')).json() as { rows: { code: string; balance: number }[]; totalDebit: number; totalCredit: number };
  expect(tb.totalDebit).toBe(tb.totalCredit);
  return new Map(tb.rows.map((r) => [r.code, r.balance]));
}

describe('customers, suppliers and items', () => {
  it('numbers parties and items and checks their accounts', async () => {
    const customer = (await get(`/api/parties/${customerId}`)).json();
    expect(customer).toMatchObject({ code: 'C-0001', accountCode: '1611', balance: 0 });
    expect((await get(`/api/parties/${supplierId}`)).json()).toMatchObject({ code: 'S-0001', accountCode: '2611' });
    const wrongAccount = await post('/api/parties', { type: 'customer', name: 'x', accountCode: '2611' });
    expect(wrongAccount.json().details[0].code).toBe('account_invalid');
    // Kurdish/Arabic letter variants find the same customer
    await post('/api/parties', { type: 'customer', name: 'کۆمپانیای مێرۆکسیس' });
    expect((await get(`/api/parties?q=${encodeURIComponent('ميروكسيس')}`)).json()).toHaveLength(1);
    expect((await get('/api/parties?q=sanos')).json()).toHaveLength(1);

    const install = (await get(`/api/items/${installId}`)).json();
    expect(install).toMatchObject({ code: 'I-0001', trackStock: false });
    expect((await post('/api/items', { code: 'AC-18', name: { ar: 'x', en: '', ku: '' }, unit: 'piece', salePrice: 1, saleCurrency: 'IQD' })).statusCode).toBe(409);
  });

  it('gives a new warehouse its own inventory account under 137', async () => {
    await post('/api/plan/trial'); // Free has one warehouse; the Pro trial allows more
    const erbil = (await post('/api/warehouses', { code: 'erbil', name: { ar: 'مخزن أربيل', en: 'Erbil store', ku: 'کۆگای هەولێر' } })).json();
    expect(erbil).toMatchObject({ code: 'ERBIL', accountCode: '1372' });
    const accounts = (await get('/api/accounts')).json() as { code: string }[];
    expect(accounts.some((a) => a.code === '1372')).toBe(true);
  });
});

describe('purchase and sale invoices', () => {
  it('posts a purchase into stock and the supplier account', async () => {
    const res = await postNew(purchase(10, 600_000, { discount: 100_000 }));
    const invoice = res.json();
    expect(invoice).toMatchObject({ status: 'posted', number: 'PI-2026-0001', total: 5_900_000, entryNumber: 'PI-2026-0001', actions: ['cancel', 'return'] });
    expect(invoice.lines[0].cost).toBe(5_900_000);
    expect(await stock()).toEqual({ qty: 10, value: 5_900_000 });
    expect((await get(`/api/parties/${supplierId}`)).json().balance).toBe(5_900_000);
    const tb = await trialBalance();
    expect(tb.get('1371')).toBe(5_900_000);
    expect(tb.get('2611')).toBe(5_900_000);
  });

  it('posts a sale with its cost of goods at weighted average and a gap-free number', async () => {
    await postNew(purchase(10, 600_000));
    await postNew(purchase(10, 640_000, { payment: 'cash', partyId: undefined, cashAccountCode: '1811' }));
    expect(await stock()).toEqual({ qty: 20, value: 12_400_000 });

    const draft = (await post('/api/invoices', sale())).json();
    expect(draft).toMatchObject({ status: 'draft', number: null, subtotal: 2_520_800, total: 2_520_800 });
    const invoice = (await post(`/api/invoices/${draft.id}/post`)).json();
    expect(invoice.number).toBe('INV-2026-0001');
    expect(invoice.lines.map((l: { cost: number | null }) => l.cost)).toEqual([1_860_000, null]);

    const entry = (await get(`/api/entries/${invoice.entryId}`)).json();
    expect(entry).toMatchObject({ type: 'sale', status: 'approved', invoiceId: invoice.id, actions: [] });
    expect(entry.lines.map((l: { accountCode: string; debit: number; credit: number }) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['1611', 2_520_800, 0], ['42', 0, 2_520_800], ['35', 1_860_000, 0], ['1371', 0, 1_860_000]
    ]);
    expect(entry.lines[0].partyName).toBe('Sanos Company');

    expect(await stock()).toEqual({ qty: 17, value: 10_540_000 });
    expect((await get(`/api/parties/${customerId}`)).json().balance).toBe(2_520_800);
    const tb = await trialBalance();
    expect(tb.get('1371')).toBe(10_540_000);
    expect(tb.get('42')).toBe(2_520_800);

    const statement = (await get(`/api/parties/${customerId}/statement`)).json();
    expect(statement.lines).toHaveLength(1);
    expect(statement.lines[0]).toMatchObject({ number: 'INV-2026-0001', invoiceId: invoice.id, debit: 2_520_800, balance: 2_520_800 });

    const second = await postNew(sale({ lines: [{ itemId: acId, qtyMilli: 1000, unitPrice: 823_600 }] }));
    expect(second.json().number).toBe('INV-2026-0002');
  });

  it('refuses to sell more than the warehouse holds, and over the credit limit', async () => {
    await postNew(purchase(2, 600_000));
    const res = await postNew(sale());
    expect(res.statusCode).toBe(400);
    expect(res.json().details[0]).toMatchObject({ code: 'stock_insufficient', line: 1, available: 2000 });
    expect(await stock()).toEqual({ qty: 2, value: 1_200_000 });

    await app.inject({ method: 'PUT', url: `/api/parties/${customerId}`, payload: { name: 'Sanos Company', creditLimit: 1_000_000 }, headers });
    const limited = await postNew(sale({ lines: [{ itemId: acId, qtyMilli: 2000, unitPrice: 823_600 }] }));
    expect(limited.statusCode).toBe(409);
    expect(limited.json().error).toBe('credit_limit_exceeded');
  });

  it('validates parties, items and payment', async () => {
    const wrongParty = await post('/api/invoices', sale({ partyId: supplierId }));
    expect(wrongParty.json().details).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'party_invalid' })]));
    const noParty = await post('/api/invoices', sale({ partyId: undefined }));
    expect(noParty.json().details[0].code).toBe('party_required');
    const serviceBought = await post('/api/invoices', purchase(1, 1000, { lines: [{ itemId: installId, qtyMilli: 1000, unitPrice: 1000 }] }));
    expect(serviceBought.json().details[0]).toMatchObject({ code: 'item_not_stock', line: 1 });
  });

  it('sells in USD at the day rate and keeps the books balanced in dinars', async () => {
    await postNew(purchase(10, 600_000));
    const invoice = (await postNew(sale({ currency: 'USD', rateX100: 142_000, lines: [{ itemId: acId, qtyMilli: 1000, unitPrice: 580_00 }] }))).json();
    expect(invoice.baseTotal).toBe(823_600);
    const entry = (await get(`/api/entries/${invoice.entryId}`)).json();
    expect(entry.lines[2]).toMatchObject({ accountCode: '35', baseDebit: 600_000 });
    expect(entry.lines[3]).toMatchObject({ accountCode: '1371', baseCredit: 600_000 });
    const tb = await trialBalance();
    expect(tb.get('1371')).toBe(5_400_000);
    expect(tb.get('1611')).toBe(823_600);
  });
});

describe('posted invoices are permanent', () => {
  it('blocks edits and only allows cancellation, which reverses the entry and the stock', async () => {
    await postNew(purchase(10, 600_000));
    const invoice = (await postNew(sale())).json();

    expect((await app.inject({ method: 'PUT', url: `/api/invoices/${invoice.id}`, payload: sale(), headers })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/api/invoices/${invoice.id}`, headers })).statusCode).toBe(409);
    expect((await post(`/api/entries/${invoice.entryId}/reverse`)).statusCode).toBe(409);
    expect(() => db.prepare('UPDATE invoice_lines SET qty_milli = 1 WHERE invoice_id = ?').run(invoice.id)).toThrow(/posted_invoice_is_permanent/);
    expect(() => db.prepare('UPDATE invoices SET total = 1 WHERE id = ?').run(invoice.id)).toThrow(/posted_invoice_is_permanent/);
    expect(() => db.prepare('DELETE FROM stock_moves').run()).toThrow(/stock_moves_are_permanent/);

    const cancelled = (await post(`/api/invoices/${invoice.id}/cancel`, { date: '2026-09-27' })).json();
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelEntryNumber: 'RJ-2026-0001', actions: [] });
    expect(await stock()).toEqual({ qty: 10, value: 6_000_000 });
    expect((await get(`/api/parties/${customerId}`)).json().balance).toBe(0);
    const tb = await trialBalance();
    expect(tb.get('1371')).toBe(6_000_000);
    expect(tb.get('42') ?? 0).toBe(0);
  });

  it('will not cancel a purchase whose goods were already sold', async () => {
    const bought = (await postNew(purchase(10, 600_000))).json();
    await postNew(sale({ lines: [{ itemId: acId, qtyMilli: 5000, unitPrice: 823_600 }] }));
    const res = await post(`/api/invoices/${bought.id}/cancel`, { date: '2026-09-27' });
    expect(res.statusCode).toBe(400);
    expect(res.json().details[0]).toMatchObject({ code: 'stock_insufficient', available: 5000 });
  });

  it('deletes drafts freely', async () => {
    const draft = (await post('/api/invoices', sale())).json();
    expect((await app.inject({ method: 'DELETE', url: `/api/invoices/${draft.id}`, headers })).statusCode).toBe(204);
  });
});

describe('upgrading an existing company file', () => {
  it('moves a version-1 database to the current version without losing posted entries', () => {
    const old = new DatabaseSync(':memory:');
    old.exec('PRAGMA foreign_keys = ON');
    migrate(old, 1);
    const now = new Date().toISOString();
    old.prepare("INSERT INTO accounts (code, name_ar, name_en, name_ku, system, created_at) VALUES ('1811', 'ق', 'Safe', 'ق', 0, ?), ('42', 'إ', 'Sales', 'د', 1, ?)").run(now, now);
    old.prepare(`INSERT INTO entries (id, type, number, date, description, currency, rate_x100, status, prepared_by, prepared_at, approved_by, approved_at, updated_at)
                 VALUES ('e1', 'receipt', 'RV-2026-0001', '2026-09-01', 'old', 'IQD', 100, 'draft', 'a', ?, 'a', ?, ?)`).run(now, now, now);
    old.prepare("INSERT INTO entry_lines (entry_id, line_no, account_code, debit, credit, base_debit, base_credit) VALUES ('e1', 1, '1811', 500, 0, 500, 0), ('e1', 2, '42', 0, 500, 0, 500)").run();
    old.prepare("UPDATE entries SET status = 'approved' WHERE id = 'e1'").run();

    migrate(old);
    expect(schemaVersion(old)).toBe(SCHEMA_VERSION);
    expect(old.prepare("SELECT number FROM entries WHERE id = 'e1'").get()).toEqual({ number: 'RV-2026-0001' });
    expect(old.prepare("SELECT COUNT(*) AS n FROM entry_lines WHERE entry_id = 'e1'").get()).toEqual({ n: 2 });
    expect(() => old.prepare("UPDATE entries SET description = 'x' WHERE id = 'e1'").run()).toThrow(/posted_entry_is_permanent/);
    expect(old.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    old.close();
  });
});
