import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { isForeignKeyFailure } from './parties.ts';

let db: Db;
let app: FastifyInstance;

const headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const del = (url: string) => app.inject({ method: 'DELETE', url, headers });

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

const customer = async (name: string) => (await post('/api/parties', { type: 'customer', name })).json().id as string;

describe('deleting a customer', () => {
  it('refuses one that a quotation keeps, with a clear answer instead of a server error', async () => {
    const id = await customer('Mer');
    const q = await post('/api/quotes', {
      date: '2026-11-01', validUntil: '2026-11-15', partyId: id, currency: 'IQD', discount: 0,
      lines: [{ description: 'Installation', qtyMilli: 1000, unitPrice: 75_000 }]
    });
    expect(q.statusCode, q.body).toBe(201);
    const res = await del(`/api/parties/${id}`);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error).toBe('party_has_entries');
    expect((await app.inject({ url: `/api/parties/${id}`, headers })).json().hasEntries).toBe(true);
  });

  it('deletes one with only a price list, and the price list with it', async () => {
    const id = await customer('Las');
    db.prepare("INSERT INTO party_price_lists (party_id, list) VALUES (?, 'wholesale')").run(id);
    expect((await del(`/api/parties/${id}`)).statusCode).toBe(204);
    expect(db.prepare('SELECT COUNT(*) AS n FROM party_price_lists').get()).toMatchObject({ n: 0 });
  });

  it('turns a foreign key refusal from either database into a conflict', () => {
    expect(isForeignKeyFailure(new Error('FOREIGN KEY constraint failed'))).toBe(true);
    expect(isForeignKeyFailure(Object.assign(new Error('Cannot delete or update a parent row'), { code: 'ER_ROW_IS_REFERENCED_2', errno: 1451 }))).toBe(true);
    expect(isForeignKeyFailure(new Error('database is locked'))).toBe(false);
  });
});

describe('a customer\'s credit limit', () => {
  it('stays as it is when an edit leaves it out; it goes only when the edit says null', async () => {
    const put = (id: string, body: object) => app.inject({ method: 'PUT', url: `/api/parties/${id}`, payload: body, headers });
    const id = (await post('/api/parties', { type: 'customer', name: 'Raz', creditLimit: 100_000 })).json().id as string;
    expect((await put(id, { type: 'customer', name: 'Raz Trading' })).json()).toMatchObject({ name: 'Raz Trading', creditLimit: 100_000 });
    expect((await put(id, { type: 'customer', name: 'Raz Trading', creditLimit: 150_000 })).json().creditLimit).toBe(150_000);
    const audit = db.prepare("SELECT details FROM audit_log WHERE action = 'update' AND entity = 'party' ORDER BY id DESC LIMIT 1").get() as { details: string };
    expect(JSON.parse(audit.details)).toMatchObject({ creditLimitBefore: 100_000, creditLimit: 150_000 });
    expect((await put(id, { type: 'customer', name: 'Raz Trading', creditLimit: null })).json().creditLimit).toBeNull();
  });
});

describe('1.4: what customers owe, at a glance', () => {
  const get = (url: string) => app.inject({ url, headers });
  const okPost = async (url: string, body: unknown = {}) => {
    const r = await post(url, body);
    expect(r.statusCode, `${url} ${r.body}`).toBeLessThan(300);
    return r.json();
  };
  /** an approved voucher on the party's account: a payment makes a customer owe, a receipt pays it (or is an advance) */
  async function voucher(kind: 'receipt' | 'payment', partyId: string, currency: 'IQD' | 'USD', amount: number) {
    const party = (await get(`/api/parties/${partyId}`)).json();
    const v = await okPost('/api/vouchers', {
      kind, date: '2026-11-02', cashAccountCode: currency === 'USD' ? '1832' : '1811', description: 'Voucher', currency, rateX100: currency === 'USD' ? 150_000 : 100,
      items: [{ accountCode: party.accountCode, amount, partyId }]
    });
    await okPost(`/api/entries/${v.id}/check`);
    await okPost(`/api/entries/${v.id}/approve`);
  }

  it('lists a day of the statement in the order it happened, whatever the kinds of paper', async () => {
    const mer = await customer('Mer');
    const later = () => new Promise((done) => setTimeout(done, 5)); // each approval at its own moment
    await voucher('payment', mer, 'IQD', 500_000); // Mer owes 500,000
    await later();
    await voucher('receipt', mer, 'IQD', 200_000); // in the morning he pays 200,000 (RV)
    await later();
    await voucher('payment', mer, 'IQD', 250_000); // in the afternoon he owes 250,000 more (PV sorts before RV by number)
    const st = (await get(`/api/parties/${mer}/statement?to=2026-11-02`)).json() as { closing: number; lines: { number: string; debit: number; credit: number; balance: number }[] };
    expect(st.lines.map((l) => [l.debit - l.credit, l.balance])).toEqual([[500_000, 500_000], [-200_000, 300_000], [250_000, 550_000]]);
    expect(st.lines.map((l) => l.number.slice(0, 2))).toEqual(['PV', 'RV', 'PV']);
    // the last paper prints 300,000 before it and 550,000 after it (the row's balance less its own change, and the row's balance)
    const last = st.lines[2]!;
    expect([last.balance - (last.debit - last.credit), last.balance, st.closing]).toEqual([300_000, 550_000, 550_000]);
  });

  it('counts a customer by the whole position: a dollar debt paid in dinars is settled', async () => {
    const mer = await customer('Mer');
    const las = await customer('Las');
    const supplier = (await okPost('/api/parties', { type: 'supplier', name: 'Raz Supplies' })).id as string;
    await voucher('payment', mer, 'USD', 10_000); // Mer owes $100.00, booked at 1,500
    await voucher('receipt', mer, 'IQD', 150_000); // ... and pays it in dinars
    await voucher('payment', las, 'USD', 10_000); // Las owes $100.00
    await voucher('receipt', las, 'IQD', 149_000); // ... and still owes 1,000 IQD of it
    await voucher('receipt', supplier, 'USD', 10_000); // we owe the supplier $100.00
    await voucher('payment', supplier, 'IQD', 150_000); // ... and paid it in dinars

    // the books keep each currency as it was entered
    expect((await get(`/api/parties/${mer}`)).json()).toMatchObject({ balance: 0, balances: { IQD: -150_000, USD: 10_000 } });
    expect((await get(`/api/parties/${las}`)).json()).toMatchObject({ balance: 1_000, balances: { IQD: -149_000, USD: 10_000 } });

    const owing = (await get('/api/parties?type=customer&owing=true')).json() as { id: string }[];
    expect(owing.map((p) => p.id)).toEqual([las]);
    // the two currencies of Las stand on opposite sides: what he owes is the position at the book rate, not $100.00
    expect((await get('/api/parties/totals?type=customer')).json()).toEqual({ type: 'customer', owed: { IQD: 1_000, USD: 0 }, advance: { IQD: 0, USD: 0 }, owing: 1, advanced: 0 });
    expect((await get('/api/parties?type=supplier&owing=true')).json()).toEqual([]);
    expect((await get('/api/parties/totals?type=supplier')).json()).toEqual({ type: 'supplier', owed: { IQD: 0, USD: 0 }, advance: { IQD: 0, USD: 0 }, owing: 0, advanced: 0 });
  });

  it('totals each currency on its own, filters to those who owe and sorts by the biggest debt', async () => {
    const mer = await customer('Mer');
    const las = await customer('Las');
    const raz = await customer('Raz');
    const supplier = (await okPost('/api/parties', { type: 'supplier', name: 'Mer Supplies' })).id as string;
    await voucher('payment', mer, 'IQD', 50_000); // Mer owes 50,000 IQD
    await voucher('payment', las, 'USD', 20_000); // Las owes $200.00 (300,000 IQD at the book rate)
    await voucher('payment', las, 'IQD', 10_000); // ... and 10,000 IQD
    await voucher('receipt', raz, 'IQD', 25_000); // Raz paid ahead: we owe him
    await voucher('receipt', supplier, 'IQD', 70_000); // we owe the supplier 70,000 IQD

    const totals = (await get('/api/parties/totals?type=customer')).json();
    expect(totals).toEqual({ type: 'customer', owed: { IQD: 60_000, USD: 20_000 }, advance: { IQD: 25_000, USD: 0 }, owing: 2, advanced: 1 });
    expect((await get('/api/parties/totals?type=supplier')).json()).toMatchObject({ owed: { IQD: 70_000, USD: 0 }, advance: { IQD: 0, USD: 0 }, owing: 1, advanced: 0 });

    const owing = (await get('/api/parties?type=customer&owing=true&sort=debt')).json() as { id: string; balance: number }[];
    expect(owing.map((p) => p.id)).toEqual([las, mer]); // 310,000 then 50,000 at the book rates; Raz owes nothing
    const all = (await get('/api/parties?type=customer&sort=debt')).json() as { id: string }[];
    expect(all.map((p) => p.id)).toEqual([las, mer, raz]);
    expect(((await get('/api/parties?type=customer')).json() as { id: string }[]).map((p) => p.id)).toEqual([mer, las, raz]); // by code, as before
  });

  it('asks for a type, refuses an unknown sort, and gives someone limited to no branch nothing', async () => {
    const mer = await customer('Mer');
    await voucher('payment', mer, 'IQD', 50_000);
    expect((await get('/api/parties/totals')).statusCode).toBe(400);
    expect((await get('/api/parties?sort=name')).statusCode).toBe(400);
    const { partyTotals } = await import('./parties.ts');
    expect(partyTotals(db, 'customer', { warehouses: [], accounts: [] })).toMatchObject({ owed: { IQD: 0, USD: 0 }, owing: 0 });
  });
});
