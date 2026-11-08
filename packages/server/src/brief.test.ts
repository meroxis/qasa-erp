import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayIso } from '@qasa/core';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { briefApi, dashboard } from './brief.ts';

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let customerId: string;
let lateId: string;
let supplierId: string;
let acId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const put = (url: string, body: unknown = {}) => app.inject({ method: 'PUT', url, payload: body as object, headers });
const get = (url: string) => app.inject({ url, headers });

const DAY = '2026-10-15';

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  customerId = (await post('/api/parties', { type: 'customer', name: 'Bazaar Trading Company', phone: '0750 123 4567' })).json().id;
  lateId = (await post('/api/parties', { type: 'customer', name: 'Late Ltd', phone: '0770 000 0001' })).json().id;
  supplierId = (await post('/api/parties', { type: 'supplier', name: 'RapidNet Ltd' })).json().id;
  acId = (await post('/api/items', { code: 'AC-18', name: { ar: 'مكيف', en: 'AC 18,000 BTU', ku: 'سپلیت' }, unit: 'piece', salePrice: 800_000, saleCurrency: 'IQD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function invoice(body: object) {
  const draft = await post('/api/invoices', { warehouseId, currency: 'IQD', rateX100: 100, discount: 0, ...body });
  expect(draft.statusCode, draft.body).toBe(201);
  const posted = await post(`/api/invoices/${draft.json().id}/post`);
  expect(posted.statusCode, posted.body).toBe(200);
  return posted.json();
}

const ac = (qty: number, price: number) => [{ itemId: acId, qtyMilli: qty * 1000, unitPrice: price }];

async function approvedVoucher(body: object) {
  const v = await post('/api/vouchers', { currency: 'IQD', rateX100: 100, ...body });
  expect(v.statusCode, v.body).toBe(201);
  expect((await post(`/api/entries/${v.json().id}/check`)).statusCode).toBe(200);
  const a = await post(`/api/entries/${v.json().id}/approve`);
  expect(a.statusCode, a.body).toBe(200);
  return a.json();
}

/** Stock bought, a cash sale and a credit sale on DAY, an old credit sale to a late customer, a receipt on DAY. */
async function seed() {
  await invoice({ kind: 'purchase', date: '2026-07-01', partyId: supplierId, payment: 'credit', lines: ac(10, 500_000) });
  await invoice({ kind: 'sale', date: '2026-07-10', partyId: lateId, payment: 'credit', lines: ac(1, 900_000) });
  await invoice({ kind: 'sale', date: '2026-10-08', payment: 'cash', cashAccountCode: '1811', lines: ac(1, 800_000) });
  await invoice({ kind: 'sale', date: DAY, payment: 'cash', cashAccountCode: '1811', lines: ac(2, 800_000) });
  await invoice({ kind: 'sale', date: DAY, partyId: customerId, payment: 'credit', lines: ac(1, 850_000) });
  await approvedVoucher({ kind: 'receipt', date: DAY, cashAccountCode: '1811', description: 'On account', items: [{ accountCode: '1611', amount: 350_000, partyId: customerId }] });
}

describe('the Daily Brief', () => {
  it('adds up the day: sales against the same day last week, cash, money in and out, top items, who is late', async () => {
    await seed();
    const res = await get(`/api/brief?date=${DAY}`);
    expect(res.statusCode, res.body).toBe(200);
    const b = res.json();
    expect(b.sales).toMatchObject({ today: 2_450_000, invoices: 2, sameDayLastWeek: 800_000, month: 3_250_000 });
    // the safe: two cash sales and the receipt
    expect(b.cash.total).toEqual({ IQD: 800_000 + 1_600_000 + 350_000, USD: 0 });
    expect(b.cash.accounts.map((a: { code: string }) => a.code)).toEqual(['1811']);
    expect(b.flow).toEqual({ in: 1_600_000 + 350_000, out: 0 });
    expect(b.topItems[0]).toMatchObject({ code: 'AC-18', qtyMilli: 3000, sales: 2_450_000, cost: 1_500_000, profit: 950_000 });
    // Late Ltd owes since July (97 days), Bazaar Trading only since today
    expect(b.lateCustomers).toHaveLength(1);
    expect(b.lateCustomers[0]).toMatchObject({ name: 'Late Ltd', balance: 900_000, oldestDays: 97, buckets: [0, 0, 0, 900_000] });
    expect(b.receivables).toBe(900_000 + 500_000);
    expect(b.approvals).toEqual({ waitingCheck: 0, waitingApproval: 0 });
  });

  it('lists items that ran out after selling, and counts vouchers waiting for approval', async () => {
    await invoice({ kind: 'purchase', date: '2026-10-01', partyId: supplierId, payment: 'credit', lines: ac(2, 500_000) });
    await invoice({ kind: 'sale', date: DAY, payment: 'cash', cashAccountCode: '1811', lines: ac(2, 800_000) });
    await post('/api/vouchers', { kind: 'payment', date: DAY, cashAccountCode: '1811', description: 'Rent', currency: 'IQD', rateX100: 100, items: [{ accountCode: '39', amount: 100_000 }] });
    const b = (await get(`/api/brief?date=${DAY}`)).json();
    expect(b.lowStock).toEqual([expect.objectContaining({ code: 'AC-18', qtyMilli: 0, soldMilli: 2000 })]);
    expect(b.approvals).toEqual({ waitingCheck: 1, waitingApproval: 0 });
  });

  it('shows overdue installments and those due tomorrow, oldest paid first', async () => {
    // an installment contract written straight into the public tables (the Pro module makes them in the app)
    db.prepare(`INSERT INTO installment_contracts (id, number, status, date, party_id, description, currency, total, down_payment, months, created_by, created_at, updated_at)
                VALUES ('c1', 'INS-2026-0001', 'active', '2026-07-01', ?, 'AC', 'IQD', 300000, 0, 3, 'Mer', '2026-07-01', '2026-07-01')`).run(customerId);
    for (const [seq, due] of [[1, '2026-08-15'], [2, '2026-09-15'], [3, '2026-10-16']] as const) {
      db.prepare('INSERT INTO installment_schedule (contract_id, seq, due_date, amount) VALUES (?, ?, ?, 100000)').run('c1', seq, due);
    }
    const receipt = await approvedVoucher({ kind: 'receipt', date: '2026-08-15', cashAccountCode: '1811', description: 'Installment', items: [{ accountCode: '1611', amount: 150_000, partyId: customerId }] });
    db.prepare("INSERT INTO installment_receipts (contract_id, entry_id, amount, created_at) VALUES ('c1', ?, 150000, '2026-08-15')").run(receipt.id);
    const b = (await get(`/api/brief?date=${DAY}`)).json();
    expect(b.installments.overdue).toEqual([expect.objectContaining({ number: 'INS-2026-0001', amount: 50_000, dueDate: '2026-09-15', daysLate: 30, currency: 'IQD' })]);
    expect(b.installments.dueTomorrow).toEqual([expect.objectContaining({ amount: 100_000, dueDate: '2026-10-16' })]);
    expect(b.installments.overdueTotal).toEqual({ IQD: 50_000, USD: 0 });
  });

  it('counts only the installment collections made by the day of the brief', async () => {
    db.prepare(`INSERT INTO installment_contracts (id, number, status, date, party_id, description, currency, total, down_payment, months, created_by, created_at, updated_at)
                VALUES ('c1', 'INS-2026-0001', 'active', '2026-07-01', ?, 'AC', 'IQD', 300000, 0, 3, 'Mer', '2026-07-01', '2026-07-01')`).run(customerId);
    for (const [seq, due] of [[1, '2026-08-15'], [2, '2026-09-15'], [3, '2026-10-16']] as const) {
      db.prepare('INSERT INTO installment_schedule (contract_id, seq, due_date, amount) VALUES (?, ?, ?, 100000)').run('c1', seq, due);
    }
    const collect = async (date: string, amount: number) => {
      const r = await approvedVoucher({ kind: 'receipt', date, cashAccountCode: '1811', description: 'Installment', items: [{ accountCode: '1611', amount, partyId: customerId }] });
      db.prepare("INSERT INTO installment_receipts (contract_id, entry_id, amount, created_at) VALUES ('c1', ?, ?, ?)").run(r.id, amount, date);
      return r;
    };
    const first = await collect('2026-08-15', 150_000);
    await collect('2026-10-20', 100_000); // after the day: it had not come in yet
    // taken back after the day: on the day it still counted
    expect((await post(`/api/entries/${first.id}/reverse`, { date: '2026-10-21' })).statusCode).toBe(200);
    const b = (await get(`/api/brief?date=${DAY}`)).json();
    expect(b.installments.overdue).toEqual([expect.objectContaining({ amount: 50_000, dueDate: '2026-09-15', daysLate: 30 })]);
    expect(b.installments.dueTomorrow).toEqual([expect.objectContaining({ amount: 100_000, dueDate: '2026-10-16' })]);
    // after the reversal only the second collection counts
    expect((await get('/api/brief?date=2026-10-25')).json().installments.overdue).toEqual([expect.objectContaining({ amount: 200_000, dueDate: '2026-09-15' })]);
  });

  it('refuses a bad date and keeps the owner’s number', async () => {
    expect((await get('/api/brief?date=2026-13-40')).statusCode).toBe(400);
    expect((await put('/api/brief/settings', { ownerPhone: '<script>' })).statusCode).toBe(400);
    const saved = await put('/api/brief/settings', { ownerPhone: '+964 750 123 4567' });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await get(`/api/brief?date=${DAY}`)).json().ownerPhone).toBe('+964 750 123 4567');
  });
});

describe('aging', () => {
  it('ages customer balances first in, first out, into 0–30, 31–60, 61–90 and over 90 days', async () => {
    await invoice({ kind: 'purchase', date: '2026-06-01', partyId: supplierId, payment: 'credit', lines: ac(10, 500_000) });
    for (const [date, price] of [['2026-06-20', 100_000], ['2026-08-01', 200_000], ['2026-09-01', 300_000], ['2026-10-10', 400_000]] as const) {
      await invoice({ kind: 'sale', date, partyId: customerId, payment: 'credit', lines: ac(1, price) });
    }
    // a payment of 250,000 settles the June charge and part of August's
    await approvedVoucher({ kind: 'receipt', date: '2026-10-12', cashAccountCode: '1811', description: 'Payment', items: [{ accountCode: '1611', amount: 250_000, partyId: customerId }] });
    const res = (await get(`/api/brief/reports/aging?type=customer&date=${DAY}`)).json();
    expect(res.rows).toEqual([expect.objectContaining({ name: 'Bazaar Trading Company', balance: 750_000, buckets: [400_000, 300_000, 50_000, 0], oldestDays: 75 })]);
    const suppliers = (await get(`/api/brief/reports/aging?type=supplier&date=${DAY}`)).json();
    expect(suppliers.rows[0]).toMatchObject({ name: 'RapidNet Ltd', balance: 5_000_000, buckets: [0, 0, 0, 5_000_000] });
  });

  it('leaves a cancelled invoice out, so an old debt stays old and the customer stays on the late list', async () => {
    await invoice({ kind: 'purchase', date: '2026-06-01', partyId: supplierId, payment: 'credit', lines: ac(10, 500_000) });
    // the cancellation is dated today, so the report is too
    const today = todayIso();
    await invoice({ kind: 'sale', date: addDays(today, -60), partyId: customerId, payment: 'credit', lines: ac(1, 100_000) });
    const newer = await invoice({ kind: 'sale', date: addDays(today, -1), partyId: customerId, payment: 'credit', lines: ac(1, 200_000) });
    expect((await post(`/api/invoices/${newer.id}/cancel`, { reason: 'wrong customer' })).statusCode).toBe(200);
    const res = (await get(`/api/brief/reports/aging?type=customer&date=${today}`)).json();
    expect(res.rows).toEqual([expect.objectContaining({ name: 'Bazaar Trading Company', balance: 100_000, oldestDays: 60, buckets: [0, 100_000, 0, 0] })]);
    expect((await get(`/api/brief?date=${today}`)).json().lateCustomers).toEqual([expect.objectContaining({ name: 'Bazaar Trading Company' })]);
  });
});

describe('cash and the exchange-rate revaluation', () => {
  it('keeps a revaluation out of the notes in the safe and out of money in, but in the dinar value', async () => {
    await approvedVoucher({ kind: 'receipt', date: DAY, currency: 'USD', rateX100: 130_000, cashAccountCode: '1811', description: 'Dollars in', items: [{ accountCode: '1611', amount: 100_000, partyId: customerId }] });
    const before = (await get(`/api/brief?date=${DAY}`)).json();
    expect(before.cash.total).toEqual({ IQD: 0, USD: 100_000 });
    expect(before.flow.in).toBe(1_300_000);
    const reval = await post('/api/fx/revaluation', { date: DAY, rateX100: 150_000, lang: 'en' });
    expect(reval.statusCode, reval.body).toBe(201);
    expect((await post(`/api/entries/${reval.json().id}/check`)).statusCode).toBe(200);
    expect((await post(`/api/entries/${reval.json().id}/approve`)).statusCode).toBe(200);
    const after = (await get(`/api/brief?date=${DAY}`)).json();
    expect(after.cash.total).toEqual({ IQD: 0, USD: 100_000 });
    expect(after.cash.accounts[0].base).toBe(1_500_000);
    expect(after.flow.in).toBe(1_300_000);
  });
});

describe('generator bills', () => {
  it('count as sales in the Brief and the dashboard once approved, and not once cancelled', async () => {
    // a month's run is one journal entry crediting generator revenue (43); made here without the Pro module
    const entry = await approvedVoucher({ kind: 'receipt', date: DAY, cashAccountCode: '1811', description: 'October amps', items: [{ accountCode: '43', amount: 35_000 }] });
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO gen_runs (id, period, date, price_normal, price_golden, status, entry_id, created_by, created_at, updated_at)
                VALUES ('run-1', '2026-10', ?, 5000, 7000, 'posted', ?, 'Mer', ?, ?)`).run(DAY, entry.id, now, now);
    const b = (await get(`/api/brief?date=${DAY}`)).json();
    expect(b.sales).toMatchObject({ today: 35_000, invoices: 0, month: 35_000 });
    expect((await get(`/api/brief/dashboard?date=${DAY}`)).json().salesMonth).toBe(35_000);
    // a branch has no generator runs
    expect(dashboard(db, DAY, { warehouses: [], accounts: [] }).salesMonth).toBe(0);
    // the generators module cancels a run (and reverses its entry); the entry itself is guarded
    expect((await post(`/api/entries/${entry.id}/reverse`, { date: DAY })).json().error).toBe('entry_belongs_to_generator_run');
    db.prepare("UPDATE gen_runs SET status = 'cancelled' WHERE id = 'run-1'").run();
    expect((await get(`/api/brief?date=${DAY}`)).json().sales.today).toBe(0);
  });
});

describe('reports', () => {
  it('sales and profit by item and by customer, stock value by warehouse, the dashboard', async () => {
    await seed();
    const byItem = (await get('/api/brief/reports/sales-by-item?from=2026-10-01&to=2026-10-31')).json();
    expect(byItem.rows).toEqual([expect.objectContaining({ code: 'AC-18', qtyMilli: 4000, sales: 3_250_000, cost: 2_000_000, profit: 1_250_000 })]);
    const byCustomer = (await get('/api/brief/reports/sales-by-customer?from=2026-10-01&to=2026-10-31')).json();
    expect(byCustomer.rows).toEqual([
      expect.objectContaining({ partyId: null, invoices: 2, sales: 2_400_000 }),
      expect.objectContaining({ name: 'Bazaar Trading Company', invoices: 1, sales: 850_000 })
    ]);
    const value = (await get(`/api/brief/reports/stock-value?date=${DAY}`)).json();
    expect(value.warehouses[0]).toMatchObject({ items: 1, qtyMilli: 5000, value: 2_500_000 });
    expect((await get('/api/brief/reports/sales-by-item?from=2026-10-31&to=2026-10-01')).statusCode).toBe(400);

    const d = (await get(`/api/brief/dashboard?date=${DAY}`)).json();
    expect(d.salesMonth).toBe(3_250_000);
    expect(d.profitMonth).toEqual({ revenue: 3_250_000, expenses: 2_000_000, profit: 1_250_000 });
    expect(d.months).toHaveLength(6);
    expect(d.months.at(-1)).toMatchObject({ month: '2026-10', sales: 3_250_000 });
    expect(d.months.at(-4)).toMatchObject({ month: '2026-07', sales: 900_000 });
    expect(d.receivables).toBe(1_400_000);
    expect(d.payables).toBe(5_000_000);

    // one branch: its sales, but no profit (the books have no branch, so it would be the whole company's)
    const branch = dashboard(db, DAY, { warehouses: ['none'], accounts: [] });
    expect(branch.salesMonth).toBe(0);
    expect(branch.profitMonth).toBeNull();
    expect(branch.months.every((m) => m.profit === null)).toBe(true);
  });

  it('takes sale returns off the sales', async () => {
    await invoice({ kind: 'purchase', date: '2026-10-01', partyId: supplierId, payment: 'credit', lines: ac(5, 500_000) });
    const sale = await invoice({ kind: 'sale', date: DAY, partyId: customerId, payment: 'credit', lines: ac(2, 800_000) });
    const ret = await post(`/api/invoices/${sale.id}/returns`, { date: DAY, payment: 'credit', lines: [{ lineNo: sale.lines[0].lineNo, qtyMilli: 1000 }] });
    expect(ret.statusCode, ret.body).toBeLessThan(300);
    const posted = ret.json().status === 'posted' ? ret.json() : (await post(`/api/invoices/${ret.json().id}/post`)).json();
    expect(posted.status).toBe('posted');
    const b = (await get(`/api/brief?date=${DAY}`)).json();
    expect(b.sales.today).toBe(800_000);
    expect(b.topItems[0]).toMatchObject({ qtyMilli: 1000, sales: 800_000, cost: 500_000 });
  });
});

describe('quick expenses', () => {
  it('maps each kind of expense to a postable expense account, and lists the month by kind', async () => {
    const s = (await get('/api/brief/settings')).json();
    expect(s.expenseAccounts).toMatchObject({ rent: '33', power: '32', fuel: '32', salaries: '31', other: '39' });
    // a company that split 33 into sub-accounts gets its first one; it can also choose
    expect((await post('/api/accounts', { parentCode: '33', code: '331', name: { ar: 'الإيجارات', en: 'Rent', ku: 'کرێ' } })).statusCode).toBe(201);
    expect((await get('/api/brief/settings')).json().expenseAccounts.rent).toBe('331');
    expect((await put('/api/brief/settings', { expenseAccounts: { fuel: '1811' } })).statusCode).toBe(400);
    expect((await put('/api/brief/settings', { expenseAccounts: { fuel: '39' } })).json().expenseAccounts.fuel).toBe('39');

    // an expense is an ordinary payment voucher: a draft until checked and approved
    const month = todayIso().slice(0, 7);
    const date = todayIso();
    const rent = await post('/api/vouchers', { kind: 'payment', date, cashAccountCode: '1811', description: 'Shop rent', currency: 'IQD', rateX100: 100, items: [{ accountCode: '331', amount: 500_000 }] });
    expect(rent.json().status).toBe('draft');
    await approvedVoucher({ kind: 'payment', date, cashAccountCode: '1811', description: 'Generator', items: [{ accountCode: '39', amount: 120_000 }] });
    const list = (await get(`/api/brief/expenses?month=${month}`)).json();
    expect(list.total).toBe(620_000);
    // rent, internet, maintenance and transport all go to 331, fuel and "other" to 39: neither line can be named by
    // its kind, so the month is shown by account (never an internet bill as "rent")
    expect(list.byCategory).toEqual({});
    expect(list.byAccount).toEqual([
      { accountCode: '331', name: expect.objectContaining({ en: 'Rent' }), category: null, amount: 500_000 },
      { accountCode: '39', name: expect.any(Object), category: null, amount: 120_000 }
    ]);
    expect(list.rows.every((r: { category: string | null }) => r.category === null)).toBe(true);
    // fuel back with power on 32 (both unnamed there): "other" now has 39 to itself, so that line is named
    expect((await put('/api/brief/settings', { expenseAccounts: { fuel: '32' } })).statusCode).toBe(200);
    await approvedVoucher({ kind: 'payment', date, cashAccountCode: '1811', description: 'Diesel', items: [{ accountCode: '32', amount: 30_000 }] });
    const named = (await get(`/api/brief/expenses?month=${month}`)).json();
    expect(named.byCategory).toEqual({ other: 120_000 });
    expect(named.byAccount.find((a: { accountCode: string }) => a.accountCode === '32')).toMatchObject({ category: null, amount: 30_000 });
    expect(list.rows.map((r: { status: string }) => r.status).sort()).toEqual(['approved', 'draft']);
  });

  it('lets anyone signed in read the brief, and only an admin change its settings', async () => {
    const ownerId = (await get('/api/users')).json()[0].id;
    await post('/api/plan/trial');
    await post(`/api/users/${ownerId}/password`, { password: 'owner-pass-1' });
    expect((await post('/api/users', { username: 'raz', name: 'Raz', roles: ['sales'], password: 'raz-pass-1' })).statusCode).toBe(201);
    expect((await put('/api/auth/signin', { on: true })).statusCode).toBe(200);
    const login = await post('/api/auth/login', { username: 'raz', password: 'raz-pass-1' });
    expect(login.statusCode, login.body).toBe(200);
    const raz = { 'x-qasa-client': '1', cookie: String(login.headers['set-cookie']).split(';')[0]! };
    expect((await app.inject({ url: `/api/brief?date=${DAY}`, headers: raz })).statusCode).toBe(200);
    const refused = await app.inject({ method: 'PUT', url: '/api/brief/settings', payload: { ownerPhone: '0750' }, headers: raz });
    expect(refused.statusCode).toBe(403);
    expect((await app.inject({ url: `/api/brief?date=${DAY}` })).statusCode).toBe(401);
  });
});
