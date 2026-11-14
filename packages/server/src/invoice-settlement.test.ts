import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { COMPANY_TABLES, migrate, openDatabase, schemaVersion, SCHEMA_VERSION, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { resetLoginThrottle } from './auth.ts';
import { MYSQL_TABLES, pendingMysqlSteps, V13_MYSQL_STEPS } from './schema-mysql.ts';

// 1.4: "Receive payment" and "Pay supplier" opened from a credit invoice keep the invoice they were made for, so the
// invoice says what was received for it and what is still open, whatever else the customer owes. A till's cash sale
// keeps the cash handed over, so a later copy of the receipt prints "Amount paid" and "Change" again.

let db: Db;
let app: FastifyInstance;
let ownerId: string;
let warehouse: string;
let item: string;
let customer: string;
let supplier: string;

type Headers = Record<string, string>;
const APP = { 'x-qasa-client': '1', 'x-qasa-user': encodeURIComponent('Mer') };
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, headers: Headers = {}) =>
  app.inject({ method, url, headers: { ...APP, ...headers }, ...(body !== undefined ? { payload: body as object } : {}) });

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  ownerId = (await req('GET', '/api/users')).json()[0].id;
  warehouse = (await req('GET', '/api/warehouses')).json()[0].id;
  item = (await req('POST', '/api/items', { name: { ar: 'خدمة', en: 'Service', ku: 'خزمەتگوزاری' }, unit: 'service', salePrice: 100_000, saleCurrency: 'IQD' })).json().id;
  customer = (await req('POST', '/api/parties', { type: 'customer', name: 'Raz' })).json().id;
  supplier = (await req('POST', '/api/parties', { type: 'supplier', name: 'Las' })).json().id;
});
afterEach(async () => { await app.close(); db.close(); });

const TODAY = '2026-11-14';
async function posted(extra: object, headers: Headers = {}) {
  const draft = await req('POST', '/api/invoices', {
    kind: 'sale', date: TODAY, warehouseId: warehouse, currency: 'IQD', rateX100: 100, discount: 0, partyId: customer, payment: 'credit',
    lines: [{ itemId: item, qtyMilli: 1000, unitPrice: 100_000 }], ...extra
  }, headers);
  expect(draft.statusCode, draft.body).toBe(201);
  const res = await req('POST', `/api/invoices/${draft.json().id}/post`, undefined, headers);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}
/** A purchase of goods on credit (a purchase takes stock items only). */
async function purchased(headers: Headers = {}) {
  const goods = (await req('POST', '/api/items', { name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2_500, saleCurrency: 'IQD' }, headers)).json().id as string;
  return posted({ kind: 'purchase', partyId: supplier, lines: [{ itemId: goods, qtyMilli: 1000, unitPrice: 100_000 }] }, headers);
}
const receipt = (extra: object = {}) => ({ kind: 'receipt', partyId: customer, amount: 40_000, currency: 'IQD', cashAccountCode: '1811', date: TODAY, ...extra });
const settlementOf = async (id: string, headers: Headers = {}) => (await req('GET', `/api/invoices/${id}`, undefined, headers)).json().settlement;
const links = () => (db.prepare('SELECT COUNT(*) AS n FROM invoice_vouchers').get() as { n: number }).n;

/** The owner with a password, the Pro trial (for more users), the users asked for, and sign-in switched on. */
async function office(users: { username: string; name: string; roles: string[] }[]): Promise<Record<string, Headers>> {
  await req('POST', '/api/plan/trial');
  await req('POST', `/api/users/${ownerId}/password`, { password: 'owner-pass-1' });
  for (const u of users) expect((await req('POST', '/api/users', { ...u, password: `${u.username}-pass-1` })).statusCode).toBe(201);
  expect((await req('PUT', '/api/auth/signin', { on: true })).statusCode).toBe(200);
  const sessions: Record<string, Headers> = {};
  for (const u of [{ username: 'admin', password: 'owner-pass-1' }, ...users.map((x) => ({ username: x.username, password: `${x.username}-pass-1` }))]) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-qasa-client': '1' }, payload: { username: u.username, password: u.password } });
    expect(res.statusCode, res.body).toBe(200);
    sessions[u.username] = { cookie: String(res.headers['set-cookie']).split(';')[0]! };
  }
  return sessions;
}

describe('what is still open on a credit invoice', () => {
  it('is the invoice\'s own, whatever else the customer owes', async () => {
    const first = await posted({});
    const second = await posted({});
    expect(first.settlement).toEqual({ currency: 'IQD', total: 100_000, returned: 0, received: 0, waiting: 0, open: 100_000, toCollect: 100_000 });
    const made = await req('POST', '/api/quick-vouchers', receipt({ invoiceId: first.id }));
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json()).toMatchObject({ status: 'approved', total: 40_000 });
    expect(db.prepare('SELECT entry_id, invoice_id FROM invoice_vouchers').all().map((r) => ({ ...r }))).toEqual([{ entry_id: made.json().id, invoice_id: first.id }]);
    // the customer still owes 160,000 in all; this invoice carries 60,000 of it and the other one all of its own
    expect((await req('GET', `/api/parties/${customer}`)).json().balance).toBe(160_000);
    expect(await settlementOf(first.id)).toMatchObject({ received: 40_000, waiting: 0, open: 60_000, toCollect: 60_000 });
    expect(await settlementOf(second.id)).toMatchObject({ received: 0, open: 100_000, toCollect: 100_000 });
    // paid in full, and then more than it carried: never below zero
    await req('POST', '/api/quick-vouchers', receipt({ invoiceId: first.id, amount: 60_000 }));
    expect(await settlementOf(first.id)).toMatchObject({ received: 100_000, open: 0, toCollect: 0 });
    await req('POST', '/api/quick-vouchers', receipt({ invoiceId: first.id, amount: 5_000 }));
    expect(await settlementOf(first.id)).toMatchObject({ received: 105_000, open: 0, toCollect: 0 });
    // (5,000 more than the first invoice carried: the customer owes 95,000 in all, and no invoice is more open than that)
    expect(await settlementOf(second.id)).toMatchObject({ received: 0, open: 95_000, toCollect: 95_000 });
    // a receipt from the customers list is for no invoice: nothing is "received for" one, and what is open on an
    // invoice is held to what the customer still owes in all
    await req('POST', '/api/quick-vouchers', receipt({ amount: 10_000 }));
    expect((await req('GET', `/api/parties/${customer}`)).json().balance).toBe(85_000);
    expect(await settlementOf(second.id)).toMatchObject({ received: 0, open: 85_000, toCollect: 85_000 });
    // all of it paid that way: nothing is open on any invoice
    await req('POST', '/api/quick-vouchers', receipt({ amount: 85_000 }));
    expect(await settlementOf(second.id)).toMatchObject({ received: 0, open: 0, toCollect: 0 });
  });

  it('a dollar invoice paid in dinars without naming it is open by what the customer still owes, at the invoice\'s rate', async () => {
    // $100.00 at 1,500 = 150,000 dinars; 90,000 dinars received from the customers list: 60,000 is owed = $40.00
    const invoice = await posted({ currency: 'USD', rateX100: 150_000, lines: [{ itemId: item, qtyMilli: 1000, unitPrice: 10_000 }] });
    await req('POST', '/api/quick-vouchers', receipt({ amount: 90_000 }));
    const party = (await req('GET', `/api/parties/${customer}`)).json();
    expect(party).toMatchObject({ balance: 60_000, balances: { IQD: -90_000, USD: 10_000 } });
    expect(await settlementOf(invoice.id)).toMatchObject({ currency: 'USD', total: 10_000, received: 0, open: 4_000, toCollect: 4_000 });
  });

  it('counts a reversed voucher no longer, and goods returned on credit lower it', async () => {
    const invoice = await posted({ lines: [{ itemId: item, qtyMilli: 2000, unitPrice: 50_000 }] });
    const voucher = (await req('POST', '/api/quick-vouchers', receipt({ invoiceId: invoice.id }))).json();
    expect(await settlementOf(invoice.id)).toMatchObject({ received: 40_000, open: 60_000 });
    expect((await req('POST', `/api/entries/${voucher.id}/reverse`, {})).statusCode).toBe(200);
    expect(await settlementOf(invoice.id)).toMatchObject({ received: 0, open: 100_000 });
    const back = await req('POST', `/api/invoices/${invoice.id}/returns`, { date: TODAY, payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    expect(back.statusCode, back.body).toBe(201);
    expect(await settlementOf(invoice.id)).toMatchObject({ returned: 50_000, received: 0, open: 50_000, toCollect: 50_000 });
    // a return is not a credit invoice to collect, and neither is a cash sale or a draft
    expect(back.json().settlement).toBeNull();
    expect((await posted({ payment: 'cash', cashAccountCode: '1811' })).settlement).toBeNull();
    expect((await req('POST', '/api/invoices', { kind: 'sale', date: TODAY, warehouseId: warehouse, currency: 'IQD', rateX100: 100, discount: 0, partyId: customer, payment: 'credit', lines: [{ itemId: item, qtyMilli: 1000, unitPrice: 1 }] })).json().settlement).toBeNull();
  });

  it('is in the invoice\'s currency: dinars received for a dollar invoice count at the invoice\'s rate', async () => {
    const invoice = await posted({ currency: 'USD', rateX100: 150_000, lines: [{ itemId: item, qtyMilli: 1000, unitPrice: 10_000 }] });
    expect(invoice.settlement).toMatchObject({ currency: 'USD', total: 10_000, open: 10_000 });
    await req('POST', '/api/quick-vouchers', receipt({ invoiceId: invoice.id, amount: 60_000 }));
    // 60,000 dinars at 1,500 = $40.00
    expect(await settlementOf(invoice.id)).toMatchObject({ received: 4_000, open: 6_000, toCollect: 6_000 });
    await req('POST', '/api/quick-vouchers', receipt({ invoiceId: invoice.id, amount: 2_500, currency: 'USD', rateX100: 148_000 }));
    expect(await settlementOf(invoice.id)).toMatchObject({ received: 6_500, open: 3_500 });
  });

  it('links a voucher only to a posted credit invoice of the same party and side', async () => {
    const invoice = await posted({});
    const other = (await req('POST', '/api/parties', { type: 'customer', name: 'Mer' })).json().id as string;
    const cash = await posted({ payment: 'cash', cashAccountCode: '1811' });
    const draft = (await req('POST', '/api/invoices', { kind: 'sale', date: TODAY, warehouseId: warehouse, currency: 'IQD', rateX100: 100, discount: 0, partyId: customer, payment: 'credit', lines: [{ itemId: item, qtyMilli: 1000, unitPrice: 1 }] })).json();
    const purchase = await purchased();
    for (const body of [
      receipt({ invoiceId: 'none' }), receipt({ invoiceId: cash.id }), receipt({ invoiceId: draft.id }), receipt({ invoiceId: invoice.id, partyId: other }),
      receipt({ invoiceId: purchase.id }), { ...receipt({ invoiceId: invoice.id }), kind: 'payment', partyId: supplier }
    ]) {
      const res = await req('POST', '/api/quick-vouchers', body);
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().details).toContainEqual({ code: 'invoice_invalid' });
    }
    // nothing was made: no voucher without its link
    expect(links()).toBe(0);
    expect((await req('GET', '/api/entries?type=receipt')).json()).toEqual([]);
    // a supplier is paid for a purchase invoice the same way
    const paid = await req('POST', '/api/quick-vouchers', { kind: 'payment', partyId: supplier, amount: 30_000, currency: 'IQD', cashAccountCode: '1811', date: TODAY, invoiceId: purchase.id });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(await settlementOf(purchase.id)).toMatchObject({ total: 100_000, received: 30_000, open: 70_000, toCollect: 70_000 });
  });
});

describe('a cashier receives for an invoice, and a voucher that waits for approval', () => {
  const users = [{ username: 'raz', name: 'Raz', roles: ['sales'] }, { username: 'las', name: 'Las', roles: ['approver'] }];

  it('waits: not in the books, but not asked for again; rejected or taken back it counts no longer; approved it is received', async () => {
    const s = await office(users);
    await req('PUT', '/api/voucher-approval', { on: true }, s.admin);
    const invoice = await posted({}, s.raz);
    const other = await posted({}, s.raz);
    // the cashier reads what is open on a sale
    expect(await settlementOf(invoice.id, s.raz)).toMatchObject({ open: 100_000, toCollect: 100_000 });

    const first = await req('POST', '/api/quick-vouchers', receipt({ invoiceId: invoice.id, amount: 30_000 }), s.raz);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().approval).toMatchObject({ state: 'waiting' });
    // the books still carry all of it; 30,000 waits, so 70,000 is left to ask for
    expect((await req('GET', `/api/parties/${customer}`, undefined, s.raz)).json().balance).toBe(200_000);
    expect(await settlementOf(invoice.id, s.raz)).toMatchObject({ received: 0, waiting: 30_000, open: 100_000, toCollect: 70_000 });
    expect(await settlementOf(other.id, s.raz)).toMatchObject({ waiting: 0, toCollect: 100_000 });

    // rejected: it counts no longer
    expect((await req('POST', `/api/entries/${first.json().id}/reject`, { reason: 'Wrong amount' }, s.las)).statusCode).toBe(200);
    expect(await settlementOf(invoice.id, s.raz)).toMatchObject({ waiting: 0, open: 100_000, toCollect: 100_000 });
    // corrected and sent again with the short form (which names only the voucher it replaces): it is for the same invoice
    const again = await req('POST', '/api/quick-vouchers', receipt({ amount: 35_000, replaces: first.json().id }), s.raz);
    expect(again.statusCode, again.body).toBe(201);
    expect(db.prepare('SELECT entry_id, invoice_id FROM invoice_vouchers').all().map((r) => ({ ...r }))).toEqual([{ entry_id: again.json().id, invoice_id: invoice.id }]);
    expect(await settlementOf(invoice.id, s.raz)).toMatchObject({ waiting: 35_000, toCollect: 65_000 });
    // approved: received, and in the customer's balance
    expect((await req('POST', `/api/entries/${again.json().id}/approve-waiting`, {}, s.las)).statusCode).toBe(200);
    expect(await settlementOf(invoice.id, s.raz)).toMatchObject({ received: 35_000, waiting: 0, open: 65_000, toCollect: 65_000 });
    expect((await req('GET', `/api/parties/${customer}`, undefined, s.raz)).json().balance).toBe(165_000);

    // one taken back by its preparer is gone, with its link
    const third = (await req('POST', '/api/quick-vouchers', receipt({ invoiceId: invoice.id, amount: 5_000 }), s.raz)).json();
    expect(await settlementOf(invoice.id, s.raz)).toMatchObject({ waiting: 5_000, toCollect: 60_000 });
    expect((await req('DELETE', `/api/quick-vouchers/${third.id}`, undefined, s.raz)).statusCode).toBe(204);
    expect(await settlementOf(invoice.id, s.raz)).toMatchObject({ waiting: 0, toCollect: 65_000 });
    expect(links()).toBe(1);
  });

  it('with approval off a cashier\'s receipt is a draft for the usual checking: it waits the same way', async () => {
    const s = await office(users);
    const invoice = await posted({}, s.raz);
    const made = await req('POST', '/api/quick-vouchers', receipt({ invoiceId: invoice.id, amount: 25_000 }), s.raz);
    expect(made.json()).toMatchObject({ status: 'draft' });
    expect(await settlementOf(invoice.id, s.raz)).toMatchObject({ received: 0, waiting: 25_000, open: 100_000, toCollect: 75_000 });
  });

  it('a cashier may not pay a supplier, and reads no money of a purchase invoice; one limited to a branch links only its invoices', async () => {
    const s = await office(users);
    const purchase = await purchased(s.admin);
    expect((await req('POST', '/api/quick-vouchers', { kind: 'payment', partyId: supplier, amount: 1_000, currency: 'IQD', cashAccountCode: '1811', date: TODAY, invoiceId: purchase.id }, s.raz)).statusCode).toBe(403);
    const seen = (await req('GET', `/api/invoices/${purchase.id}`, undefined, s.raz)).json();
    expect(seen).not.toHaveProperty('settlement');
    expect(seen).not.toHaveProperty('total');

    // another warehouse in another branch: its invoices are not this cashier's to read, nor to receive for
    const far = (await req('POST', '/api/warehouses', { code: 'W2', name: { ar: 'مخزن', en: 'Store', ku: 'کۆگا' } }, s.admin)).json().id as string;
    const near = (await req('POST', '/api/branches', { code: 'A', name: 'A' }, s.admin)).json().id as string;
    const away = (await req('POST', '/api/branches', { code: 'B', name: 'B' }, s.admin)).json().id as string;
    expect((await req('PUT', `/api/branches/${near}/warehouses`, { warehouseIds: [warehouse] }, s.admin)).statusCode).toBe(200);
    expect((await req('PUT', `/api/branches/${near}/accounts`, { accounts: ['1811'] }, s.admin)).statusCode).toBe(200);
    expect((await req('PUT', `/api/branches/${away}/warehouses`, { warehouseIds: [far] }, s.admin)).statusCode).toBe(200);
    const raz = ((await req('GET', '/api/users', undefined, s.admin)).json() as { id: string; username: string }[]).find((u) => u.username === 'raz')!.id;
    expect((await req('PUT', `/api/users/${raz}/branches`, { branchIds: [near] }, s.admin)).statusCode).toBe(200);
    const theirs = await posted({ warehouseId: far }, s.admin);
    const mine = await posted({}, s.raz);
    expect((await req('POST', '/api/quick-vouchers', receipt({ invoiceId: theirs.id }), s.raz)).statusCode).toBe(403);
    expect((await req('POST', '/api/quick-vouchers', receipt({ invoiceId: mine.id }), s.raz)).statusCode).toBe(201);
    expect(links()).toBe(1);
  });
});

describe('the cash handed over at the till', () => {
  const open = async () => (await req('POST', '/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId: warehouse, openingCash: 0 })).json().id as string;
  const sell = (shift: string, extra: object) => req('POST', `/api/pos/shifts/${shift}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: item, qtyMilli: 1000, unitPrice: 100_000 }], ...extra });

  it('is kept with a cash sale, so the invoice read later still says what was paid and the change', async () => {
    const shift = await open();
    const sold = await sell(shift, { tendered: 125_000 });
    expect(sold.statusCode, sold.body).toBe(201);
    expect(sold.json().invoice.tender).toEqual({ paid: 125_000, change: 25_000 });
    expect((await req('GET', `/api/invoices/${sold.json().invoice.id}`)).json().tender).toEqual({ paid: 125_000, change: 25_000 });
    expect(db.prepare('SELECT tendered FROM pos_sales WHERE invoice_id = ?').get(sold.json().invoice.id)).toMatchObject({ tendered: 125_000 });
    // the books take the sale, not the notes handed over
    expect(sold.json().shift).toMatchObject({ expected: { IQD: 100_000, USD: 0 } });
  });

  it('is not kept when nothing was typed, when it does not cover the sale, or on credit', async () => {
    const shift = await open();
    const plain = (await sell(shift, {})).json().invoice;
    const short = (await sell(shift, { tendered: 90_000 })).json().invoice;
    const credit = (await sell(shift, { partyId: customer, payments: [{ method: 'account', amount: 100_000 }], tendered: 150_000 })).json().invoice;
    for (const invoice of [plain, short, credit]) {
      expect(invoice).not.toHaveProperty('tender');
      expect(db.prepare('SELECT tendered FROM pos_sales WHERE invoice_id = ?').get(invoice.id)).toMatchObject({ tendered: null });
    }
    expect((await sell(shift, { tendered: -1 })).statusCode).toBe(400);
    expect((await sell(shift, { tendered: 1.5 })).statusCode).toBe(400);
  });
});

describe('schema 13 carries the link and the cash handed over', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qasa-v13-links-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('a company file of schema 12 gets them when it is opened', () => {
    const file = join(dir, 'books.sqlite');
    const old = new DatabaseSync(file);
    migrate(old as unknown as Db, 12);
    expect(old.prepare("SELECT name FROM sqlite_master WHERE name = 'invoice_vouchers'").get()).toBeUndefined();
    old.close();
    const opened = openDatabase(file);
    try {
      expect(schemaVersion(opened)).toBe(SCHEMA_VERSION);
      expect(opened.prepare('SELECT COUNT(*) AS n FROM invoice_vouchers').get()).toMatchObject({ n: 0 });
      expect(opened.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'invoice_vouchers_invoice'").get()).toBeTruthy();
      expect((opened.prepare('PRAGMA table_info(pos_sales)').all() as { name: string }[]).map((c) => c.name)).toEqual(['invoice_id', 'shift_id', 'tendered']);
      // a link needs its voucher and its invoice
      expect(() => opened.prepare("INSERT INTO invoice_vouchers (entry_id, invoice_id) VALUES ('none', 'none')").run()).toThrow();
    } finally {
      opened.close();
    }
  });

  it('a server database gets the same: the table, and the column once', () => {
    expect(COMPANY_TABLES).toContain('invoice_vouchers');
    const table = MYSQL_TABLES.find((t) => t.name === 'invoice_vouchers')!;
    expect(table.since).toBe(13);
    expect(table.sql).toContain('FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE');
    expect(table.sql).toContain('FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE');
    expect(table.sql).toContain('INDEX invoice_vouchers_invoice (invoice_id)');
    // after the tables it points at
    const order = MYSQL_TABLES.map((t) => t.name);
    expect(order.indexOf('invoice_vouchers')).toBeGreaterThan(Math.max(order.indexOf('entries'), order.indexOf('invoices')));
    expect(MYSQL_TABLES.find((t) => t.name === 'pos_sales')!.sql).toContain('tendered BIGINT');
    expect(pendingMysqlSteps(V13_MYSQL_STEPS, { columns: new Set(['items.purchase_price', 'items.purchase_currency']), foreignKeys: new Set() }))
      .toEqual(['ALTER TABLE pos_sales ADD COLUMN tendered BIGINT CHECK (tendered IS NULL OR tendered >= 0)']);
    expect(pendingMysqlSteps(V13_MYSQL_STEPS, { columns: new Set(['items.purchase_price', 'items.purchase_currency', 'pos_sales.tendered']), foreignKeys: new Set() })).toEqual([]);
  });
});
