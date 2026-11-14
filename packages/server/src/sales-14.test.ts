import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, SCHEMA_VERSION, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { resetLoginThrottle } from './auth.ts';

// 1.4: cash or credit only (invoice and till), "Receive payment" / "Pay supplier", and vouchers that wait for approval.

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

const balanceOf = async (id: string, headers: Headers = {}) => (await req('GET', `/api/parties/${id}`, undefined, headers)).json().balance as number;
const safe = () => Number((db.prepare(`SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS v FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                                        WHERE l.account_code = '1811' AND e.status = 'approved'`).get() as { v: number }).v);

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

const sale = (extra: object) => ({
  kind: 'sale', date: '2026-11-14', warehouseId: warehouse, currency: 'IQD', rateX100: 100, discount: 0,
  lines: [{ itemId: item, qtyMilli: 1000, unitPrice: 100_000 }], ...extra
});

async function postedSale(extra: object) {
  const draft = await req('POST', '/api/invoices', sale(extra));
  expect(draft.statusCode, draft.body).toBe(201);
  const posted = await req('POST', `/api/invoices/${draft.json().id}/post`);
  expect(posted.statusCode, posted.body).toBe(200);
  return posted.json();
}

const receipt = (extra: object = {}) => ({ kind: 'receipt', partyId: customer, amount: 40_000, currency: 'IQD', cashAccountCode: '1811', date: '2026-11-14', ...extra });

/** The owner with a password, the Pro trial (for more users), the users asked for, and sign-in switched on. */
async function office(users: { username: string; name: string; roles: string[] }[]): Promise<Record<string, Headers>> {
  await req('POST', '/api/plan/trial');
  await req('POST', `/api/users/${ownerId}/password`, { password: 'owner-pass-1' });
  for (const u of users) {
    const made = await req('POST', '/api/users', { ...u, password: `${u.username}-pass-1` });
    expect(made.statusCode, made.body).toBe(201);
  }
  expect((await req('PUT', '/api/auth/signin', { on: true })).statusCode).toBe(200);
  const sessions: Record<string, Headers> = {};
  for (const u of [{ username: 'admin', password: 'owner-pass-1' }, ...users.map((x) => ({ username: x.username, password: `${x.username}-pass-1` }))]) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-qasa-client': '1' }, payload: { username: u.username, password: u.password } });
    expect(res.statusCode, res.body).toBe(200);
    sessions[u.username] = { cookie: String(res.headers['set-cookie']).split(';')[0]! };
  }
  return sessions;
}

describe('a sales invoice is paid in cash or put on credit', () => {
  it('cash goes into the safe; credit goes on the customer\'s account', async () => {
    const cash = await postedSale({ payment: 'cash', cashAccountCode: '1811' });
    expect(cash).toMatchObject({ payment: 'cash', status: 'posted', total: 100_000 });
    expect(safe()).toBe(100_000);
    expect(await balanceOf(customer)).toBe(0);
    const credit = await postedSale({ payment: 'credit', partyId: customer });
    expect(credit).toMatchObject({ payment: 'credit', status: 'posted' });
    expect(safe()).toBe(100_000);
    expect(await balanceOf(customer)).toBe(100_000);
  });

  it('refuses credit without a customer, and any other way of paying', async () => {
    const none = await req('POST', '/api/invoices', sale({ payment: 'credit' }));
    expect(none.statusCode).toBe(400);
    expect(none.json().details).toEqual(expect.arrayContaining([{ code: 'party_required' }]));
    for (const payment of ['fib', 'bank', 'installments', '']) expect((await req('POST', '/api/invoices', sale({ payment, partyId: customer }))).statusCode).toBe(400);
  });
});

describe('the till takes cash or credit, never a mix', () => {
  const sell = (shift: string, extra: object) => req('POST', `/api/pos/shifts/${shift}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: item, qtyMilli: 1000, unitPrice: 100_000 }], ...extra });
  const open = async () => (await req('POST', '/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId: warehouse, openingCash: 0 })).json().id as string;

  it('a credit sale is a credit invoice on the customer\'s account and puts nothing in the drawer', async () => {
    const shift = await open();
    const res = await sell(shift, { partyId: customer, payments: [{ method: 'account', amount: 100_000 }] });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().invoice).toMatchObject({ payment: 'credit', partyId: customer, cashAccountCode: null, baseTotal: 100_000 });
    expect(res.json().shift).toMatchObject({ expected: { IQD: 0, USD: 0 }, sales: { IQD: 100_000, USD: 0 }, methods: { account: { IQD: 100_000, USD: 0 } } });
    expect(await balanceOf(customer)).toBe(100_000);
    expect(safe()).toBe(0);
  });

  it('refuses credit without a customer, and credit mixed with money paid now', async () => {
    const shift = await open();
    expect((await sell(shift, { payments: [{ method: 'account', amount: 100_000 }] })).json().details).toEqual([{ code: 'party_required' }]);
    const mixed = await sell(shift, { partyId: customer, payments: [{ method: 'account', amount: 60_000 }, { method: 'cash', amount: 40_000 }] });
    expect(mixed.statusCode).toBe(400);
    expect(mixed.json().details).toEqual([{ code: 'pos_credit_not_mixed' }, { code: 'pos_payment_invalid', method: 'account' }]);
    expect(await balanceOf(customer)).toBe(0);
    // cash, as always
    const cash = await sell(shift, {});
    expect(cash.statusCode, cash.body).toBe(201);
    expect(cash.json().invoice).toMatchObject({ payment: 'cash', cashAccountCode: '1811' });
    expect(cash.json().shift.expected).toEqual({ IQD: 100_000, USD: 0 });
  });

  it('checks the customer\'s credit limit on a credit sale', async () => {
    await req('PUT', `/api/parties/${customer}`, { name: 'Raz', creditLimit: 50_000 });
    const res = await sell(await open(), { partyId: customer, payments: [{ method: 'account', amount: 100_000 }] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('credit_limit_exceeded');
    expect((db.prepare('SELECT COUNT(*) AS n FROM invoices').get() as { n: number }).n).toBe(0);
  });
});

describe('receive payment and pay supplier', () => {
  it('posts a normal receipt voucher on the customer\'s account at once for the owner', async () => {
    await postedSale({ payment: 'credit', partyId: customer });
    const res = await req('POST', '/api/quick-vouchers', receipt({ note: 'Part payment' }));
    expect(res.statusCode, res.body).toBe(201);
    const v = res.json();
    expect(v).toMatchObject({ type: 'receipt', status: 'approved', number: expect.stringMatching(/^RV-2026-\d{4}$/), party: 'Raz', description: 'Part payment', total: 40_000, approval: null });
    expect(v.lines).toEqual([
      expect.objectContaining({ accountCode: '1811', debit: 40_000, credit: 0 }),
      expect.objectContaining({ debit: 0, credit: 40_000, partyId: customer })
    ]);
    expect(await balanceOf(customer)).toBe(60_000);
    expect(safe()).toBe(40_000);
  });

  it('pays a supplier with a payment voucher', async () => {
    const res = await req('POST', '/api/quick-vouchers', { ...receipt(), kind: 'payment', partyId: supplier });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ type: 'payment', status: 'approved', party: 'Las' });
    expect(await balanceOf(supplier)).toBe(-40_000);
    expect(safe()).toBe(-40_000);
  });

  it('checks what it is sent', async () => {
    const bad = async (extra: object) => (await req('POST', '/api/quick-vouchers', receipt(extra))).statusCode;
    expect(await bad({ amount: 0 })).toBe(400);
    expect(await bad({ amount: -5 })).toBe(400);
    expect(await bad({ amount: 1.5 })).toBe(400);
    expect(await bad({ date: '14/11/2026' })).toBe(400);
    expect(await bad({ currency: 'EUR' })).toBe(400);
    expect(await bad({ currency: 'USD' })).toBe(400); // no rate
    expect(await bad({ cashAccountCode: '4211' })).toBe(400);
    expect(await bad({ partyId: supplier })).toBe(400); // a receipt is from a customer
    expect(await bad({ partyId: "x' OR '1'='1" })).toBe(400);
    expect(await bad({ kind: 'journal' })).toBe(400);
    expect((db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number }).n).toBe(0);
  });

  it('makes the voucher once when the form is sent twice with the same key', async () => {
    const key = { 'x-qasa-idempotency': '3f0c9f0e-6a55-4c1e-9b47-0f6f3b8e2a11' };
    const first = await req('POST', '/api/quick-vouchers', receipt(), key);
    const again = await req('POST', '/api/quick-vouchers', receipt(), key);
    expect(first.statusCode, first.body).toBe(201);
    expect(again.json().id).toBe(first.json().id);
    expect((db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number }).n).toBe(1);
  });
});

describe('vouchers need approval', () => {
  const users = [
    { username: 'las', name: 'Las', roles: ['sales'] },
    { username: 'raz', name: 'Raz', roles: ['approver'] },
    { username: 'mer', name: 'Mer', roles: ['preparer'] }
  ];
  const voucher = { kind: 'receipt', date: '2026-11-14', cashAccountCode: '1811', description: 'Receipt', currency: 'IQD', rateX100: 100, items: [{ accountCode: '1612', amount: 25_000 }] };

  it('is off for a company until an admin switches it on, and only an admin may', async () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(13);
    const s = await office(users);
    expect((await req('GET', '/api/voucher-approval', undefined, s.las)).json()).toEqual({ on: false, waiting: 0, mayApprove: false, ownAtOnce: false, postsAtOnce: false });
    for (const who of ['las', 'raz', 'mer']) expect((await req('PUT', '/api/voucher-approval', { on: true }, s[who])).statusCode).toBe(403);
    expect((await req('PUT', '/api/voucher-approval', { on: 'yes' }, s.admin)).statusCode).toBe(400);
    expect((await req('PUT', '/api/voucher-approval', { on: true }, s.admin)).json()).toEqual({ on: true, waiting: 0, mayApprove: true, ownAtOnce: true, postsAtOnce: true });
  });

  it('off: a sales person\'s receipt is a draft for the usual checking and approval, and changes no balance', async () => {
    const s = await office(users);
    const res = await req('POST', '/api/quick-vouchers', receipt(), s.las);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ status: 'draft', number: null, approval: null, preparedBy: 'Las' });
    expect(await balanceOf(customer, s.admin)).toBe(0);
    // a purchasing matter is not a sales person's
    expect((await req('POST', '/api/quick-vouchers', { ...receipt(), kind: 'payment', partyId: supplier }, s.las)).statusCode).toBe(403);
  });

  it('on: a voucher of someone without the permission waits, in no balance, until someone with it approves', async () => {
    const s = await office(users);
    await req('PUT', '/api/voucher-approval', { on: true }, s.admin);
    const made = await req('POST', '/api/quick-vouchers', receipt(), s.las);
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json().id as string;
    expect(made.json()).toMatchObject({ status: 'draft', number: null, approval: { state: 'waiting', requestedBy: 'Las', decidedBy: null } });
    expect(await balanceOf(customer, s.admin)).toBe(0);
    expect(safe()).toBe(0);
    expect((await req('GET', '/api/voucher-approval', undefined, s.raz)).json()).toEqual({ on: true, waiting: 1, mayApprove: true, ownAtOnce: true, postsAtOnce: true });
    // the list shows it, and the filter finds it
    const waiting = (await req('GET', '/api/entries?approval=waiting', undefined, s.admin)).json();
    expect(waiting.map((e: { id: string }) => e.id)).toEqual([id]);
    expect((await req('GET', '/api/entries?approval=rejected', undefined, s.admin)).json()).toEqual([]);
    expect((await req('GET', "/api/entries?approval=waiting' OR 1=1", undefined, s.admin)).statusCode).toBe(400);
    // only its approval is offered, and only to those who may approve
    expect((await req('GET', `/api/entries/${id}`, undefined, s.raz)).json().actions).toEqual(['approve_waiting', 'reject']);
    // (the person who made it keeps no books: they read this voucher of theirs, and no other entry)
    const own = await req('GET', `/api/entries/${id}`, undefined, s.las);
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json()).toMatchObject({ actions: [], preparedBy: 'Las', approval: { state: 'waiting' } });
    const other = (await req('POST', '/api/vouchers', voucher, s.mer)).json().id as string;
    expect((await req('GET', `/api/entries/${other}`, undefined, s.las)).statusCode).toBe(403);
    expect((await req('GET', '/api/entries', undefined, s.las)).json().map((e: { id: string }) => e.id)).toEqual([id]);
    expect((await req('GET', '/api/entries?approval=waiting', undefined, s.las)).json().map((e: { id: string }) => e.id)).toEqual([id]);
    expect((await req('DELETE', `/api/entries/${other}`, undefined, s.mer)).statusCode).toBe(204);
    expect((await req('GET', `/api/entries/${id}`, undefined, s.mer)).json().actions).toEqual(['edit', 'delete']);
    // not the person who made it, nor a preparer, by any route
    for (const who of ['las', 'mer']) {
      expect((await req('POST', `/api/entries/${id}/approve-waiting`, {}, s[who])).statusCode).toBe(403);
      expect((await req('POST', `/api/entries/${id}/reject`, { reason: 'no' }, s[who])).statusCode).toBe(403);
      expect((await req('POST', `/api/entries/${id}/approve`, {}, s[who])).statusCode).toBe(403);
    }
    // nor the usual check and approve, which would go around the waiting
    expect((await req('POST', `/api/entries/${id}/check`, {}, s.admin)).statusCode).toBe(409);
    expect((await req('POST', `/api/entries/${id}/approve`, {}, s.raz)).statusCode).toBe(409);
    expect(await balanceOf(customer, s.admin)).toBe(0);

    const approved = await req('POST', `/api/entries/${id}/approve-waiting`, {}, s.raz);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({
      status: 'approved', number: expect.stringMatching(/^RV-2026-\d{4}$/), preparedBy: 'Las', approvedBy: 'Raz',
      approval: { state: 'approved', requestedBy: 'Las', decidedBy: 'Raz', reason: null }
    });
    expect(approved.json().approval.decidedAt).toBe(approved.json().approvedAt);
    expect(await balanceOf(customer, s.admin)).toBe(-40_000);
    expect(safe()).toBe(40_000);
    // once
    expect((await req('POST', `/api/entries/${id}/approve-waiting`, {}, s.raz)).statusCode).toBe(409);
    expect((await req('POST', `/api/entries/${id}/reject`, { reason: 'late' }, s.raz)).statusCode).toBe(409);
    // who approved it and when is in the audit log
    const log = (await req('GET', '/api/audit', undefined, s.admin)).json() as { action: string; entityId: string; user: string; details: Record<string, unknown> | null }[];
    const row = log.find((a) => a.action === 'approve' && a.entityId === id)!;
    expect(row).toMatchObject({ user: 'Raz' });
    expect(JSON.stringify(row)).toContain('"preparedBy":"Las"');
    expect(log.some((a) => a.action === 'request_approval' && a.entityId === id && a.user === 'Las')).toBe(true);
  });

  it('on: a rejected voucher keeps the reason, stays out of the books, and waits again once it is corrected', async () => {
    const s = await office(users);
    await req('PUT', '/api/voucher-approval', { on: true }, s.admin);
    const id = (await req('POST', '/api/vouchers', voucher, s.mer)).json().id as string;
    expect((await req('POST', `/api/entries/${id}/reject`, {}, s.raz)).statusCode).toBe(400);
    expect((await req('POST', `/api/entries/${id}/reject`, { reason: '   ' }, s.raz)).statusCode).toBe(400);
    expect((await req('POST', `/api/entries/${id}/reject`, { reason: 'x'.repeat(301) }, s.raz)).statusCode).toBe(400);
    const rejected = await req('POST', `/api/entries/${id}/reject`, { reason: 'Wrong amount' }, s.raz);
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json()).toMatchObject({ status: 'draft', number: null, approval: { state: 'rejected', decidedBy: 'Raz', reason: 'Wrong amount' } });
    expect((await req('GET', '/api/entries?approval=rejected', undefined, s.admin)).json().map((e: { id: string }) => e.id)).toEqual([id]);
    expect((await req('POST', `/api/entries/${id}/approve-waiting`, {}, s.raz)).statusCode).toBe(409);
    expect(safe()).toBe(0);
    const log = (await req('GET', '/api/audit', undefined, s.admin)).json() as { action: string; entityId: string; user: string }[];
    expect(log.some((a) => a.action === 'reject' && a.entityId === id && a.user === 'Raz')).toBe(true);
    // corrected by its preparer: it waits again
    const fixed = await req('PUT', `/api/vouchers/${id}`, { ...voucher, items: [{ accountCode: '1612', amount: 20_000 }] }, s.mer);
    expect(fixed.json()).toMatchObject({ status: 'draft', approval: { state: 'waiting', requestedBy: 'Mer', reason: null } });
    expect((await req('POST', `/api/entries/${id}/approve-waiting`, {}, s.admin)).json()).toMatchObject({ status: 'approved', total: 20_000, approvedBy: 'Admin' });
    expect(safe()).toBe(20_000);
  });

  it('on: a voucher of someone who may approve vouchers is approved at once', async () => {
    const s = await office(users);
    await req('PUT', '/api/voucher-approval', { on: true }, s.admin);
    const own = await req('POST', '/api/vouchers', voucher, s.admin);
    expect(own.statusCode, own.body).toBe(201);
    expect(own.json()).toMatchObject({ status: 'approved', number: expect.stringMatching(/^RV-/), approvedBy: 'Admin', approval: null });
    const quick = await req('POST', '/api/quick-vouchers', receipt(), s.admin);
    expect(quick.json()).toMatchObject({ status: 'approved', approval: null });
    expect(safe()).toBe(65_000);
    // but under separate duties nobody approves what they prepared
    await req('PUT', '/api/auth/separate-duties', { on: true }, s.admin);
    expect((await req('POST', '/api/vouchers', voucher, s.admin)).json()).toMatchObject({ status: 'draft', number: null });
    expect(safe()).toBe(65_000);
  });

  it('switched off again, what was waiting is a plain draft', async () => {
    const s = await office(users);
    await req('PUT', '/api/voucher-approval', { on: true }, s.admin);
    const id = (await req('POST', '/api/vouchers', voucher, s.mer)).json().id as string;
    await req('PUT', '/api/voucher-approval', { on: false }, s.admin);
    expect((await req('GET', `/api/entries/${id}`, undefined, s.admin)).json()).toMatchObject({ status: 'draft', approval: null, actions: ['edit', 'delete', 'check'] });
    // and a draft that is deleted takes its approval record with it
    await req('PUT', '/api/voucher-approval', { on: true }, s.admin);
    const other = (await req('POST', '/api/vouchers', voucher, s.mer)).json().id as string;
    expect((await req('DELETE', `/api/entries/${other}`, undefined, s.mer)).statusCode).toBe(204);
    expect((db.prepare('SELECT COUNT(*) AS n FROM voucher_approvals').get() as { n: number }).n).toBe(0);
  });

  it('switched off again, what was rejected is a plain draft too: checked and approved the usual way', async () => {
    const s = await office(users);
    await req('PUT', '/api/voucher-approval', { on: true }, s.admin);
    const id = (await req('POST', '/api/vouchers', voucher, s.mer)).json().id as string;
    expect((await req('POST', `/api/entries/${id}/reject`, { reason: 'Wrong safe' }, s.raz)).statusCode).toBe(200);
    expect((await req('GET', `/api/entries/${id}`, undefined, s.admin)).json().actions).toEqual(['edit', 'delete']);
    await req('PUT', '/api/voucher-approval', { on: false }, s.admin);
    expect((await req('GET', `/api/entries/${id}`, undefined, s.admin)).json()).toMatchObject({ status: 'draft', approval: null, actions: ['edit', 'delete', 'check'] });
    expect((await req('POST', `/api/entries/${id}/check`, {}, s.admin)).statusCode).toBe(200);
    // why it was rejected is still in the audit log
    const log = (await req('GET', '/api/audit', undefined, s.admin)).json() as { action: string; entityId: string }[];
    expect(log.some((a) => a.action === 'reject' && a.entityId === id)).toBe(true);
  });

  it('says whether a quick voucher of this user is posted at once, so the form can say when the balance will not change yet', async () => {
    const s = await office(users);
    const state = async (who: string) => (await req('GET', '/api/voucher-approval', undefined, s[who])).json().postsAtOnce as boolean;
    // off: only someone who may check and approve alone; and the voucher really comes back that way
    expect(await state('las')).toBe(false);
    expect(await state('raz')).toBe(false);
    expect(await state('admin')).toBe(true);
    expect((await req('POST', '/api/quick-vouchers', receipt(), s.las)).json().status).toBe('draft');
    expect((await req('POST', '/api/quick-vouchers', receipt(), s.admin)).json().status).toBe('approved');
    // on: whoever may approve vouchers
    await req('PUT', '/api/voucher-approval', { on: true }, s.admin);
    expect(await state('las')).toBe(false);
    expect(await state('raz')).toBe(true);
    // separate duties: nobody approves what they prepared, so never at once (though they may approve what others made)
    await req('PUT', '/api/auth/separate-duties', { on: true }, s.admin);
    expect((await req('GET', '/api/voucher-approval', undefined, s.admin)).json()).toMatchObject({ mayApprove: true, postsAtOnce: false });
    expect((await req('POST', '/api/quick-vouchers', receipt(), s.admin)).json().status).toBe('draft');
  });
});

describe('whoever prepared a quick voucher takes it back, or corrects it and sends it again', () => {
  const users = [
    { username: 'las', name: 'Las', roles: ['sales'] },
    { username: 'raz', name: 'Raz', roles: ['approver'] },
    { username: 'mer', name: 'Mer', roles: ['sales'] }
  ];
  const ids = async (headers: Headers | undefined) => ((await req('GET', '/api/entries', undefined, headers)).json() as { id: string }[]).map((e) => e.id);

  it('a sales person withdraws their own receipt while it waits; not somebody else, and not through the journal', async () => {
    const s = await office(users);
    await req('PUT', '/api/voucher-approval', { on: true }, s.admin);
    const made = await req('POST', '/api/quick-vouchers', receipt(), s.las);
    const id = made.json().id as string;
    // the screens know it is theirs
    expect(made.json().preparedById).toBe((await req('GET', '/api/auth/me', undefined, s.las)).json().user.id);
    // the delete of the journal stays with those who prepare vouchers there
    expect((await req('DELETE', `/api/entries/${id}`, undefined, s.las)).statusCode).toBe(403);
    // another sales person: not theirs (the same answer as for a voucher that does not exist)
    expect((await req('DELETE', `/api/quick-vouchers/${id}`, undefined, s.mer)).statusCode).toBe(403);
    expect((await req('DELETE', '/api/quick-vouchers/nothing', undefined, s.mer)).statusCode).toBe(403);
    // an approver who did not prepare it rejects it; they do not withdraw it
    expect((await req('DELETE', `/api/quick-vouchers/${id}`, undefined, s.raz)).statusCode).toBe(403);
    // from another site (no app header): refused like every change
    expect((await app.inject({ method: 'DELETE', url: `/api/quick-vouchers/${id}`, headers: s.las! })).statusCode).toBe(403);
    expect(await ids(s.las)).toEqual([id]);

    expect((await req('DELETE', `/api/quick-vouchers/${id}`, undefined, s.las)).statusCode).toBe(204);
    expect(await ids(s.las)).toEqual([]);
    expect((await req('GET', '/api/voucher-approval', undefined, s.admin)).json().waiting).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM voucher_approvals').get() as { n: number }).n).toBe(0);
    const log = (await req('GET', '/api/audit', undefined, s.admin)).json() as { action: string; entityId: string; user: string }[];
    expect(log.some((a) => a.action === 'delete' && a.entityId === id && a.user === 'Las')).toBe(true);
  });

  it('never an approved one, nor one that was checked already', async () => {
    const s = await office(users);
    await req('PUT', '/api/voucher-approval', { on: true }, s.admin);
    const id = (await req('POST', '/api/quick-vouchers', receipt(), s.las)).json().id as string;
    expect((await req('POST', `/api/entries/${id}/approve-waiting`, {}, s.raz)).statusCode).toBe(200);
    const refused = await req('DELETE', `/api/quick-vouchers/${id}`, undefined, s.las);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('action_not_allowed');
    // nor by naming it as the one a new voucher replaces: nothing is made either
    const again = await req('POST', '/api/quick-vouchers', receipt({ amount: 10_000, replaces: id }), s.las);
    expect(again.statusCode).toBe(409);
    expect(await ids(s.las)).toEqual([id]);
    expect(await balanceOf(customer, s.admin)).toBe(-40_000);
    expect(safe()).toBe(40_000);
    // a plain draft (the setting off) that someone checked is in the hands of the checker
    await req('PUT', '/api/voucher-approval', { on: false }, s.admin);
    const draft = (await req('POST', '/api/quick-vouchers', receipt(), s.las)).json().id as string;
    expect((await req('POST', `/api/entries/${draft}/check`, {}, s.admin)).statusCode).toBe(200);
    expect((await req('DELETE', `/api/quick-vouchers/${draft}`, undefined, s.las)).statusCode).toBe(409);
    // and one nobody checked yet is theirs to take back
    const fresh = (await req('POST', '/api/quick-vouchers', receipt(), s.las)).json().id as string;
    expect((await req('DELETE', `/api/quick-vouchers/${fresh}`, undefined, s.las)).statusCode).toBe(204);
  });

  it('a rejected receipt is corrected and sent again with the short form: the old one goes as the new one is made', async () => {
    const s = await office(users);
    await req('PUT', '/api/voucher-approval', { on: true }, s.admin);
    const id = (await req('POST', '/api/quick-vouchers', receipt(), s.las)).json().id as string;
    expect((await req('POST', `/api/entries/${id}/reject`, { reason: 'Wrong amount' }, s.raz)).statusCode).toBe(200);
    expect((await req('GET', `/api/entries/${id}`, undefined, s.las)).json()).toMatchObject({ actions: [], approval: { state: 'rejected', reason: 'Wrong amount' } });
    // somebody else may not use it as the one their voucher replaces
    expect((await req('POST', '/api/quick-vouchers', receipt({ replaces: id }), s.mer)).statusCode).toBe(403);
    // a corrected one that is itself refused leaves the rejected one where it was
    expect((await req('POST', '/api/quick-vouchers', receipt({ replaces: id, cashAccountCode: '9999' }), s.las)).statusCode).toBe(400);
    expect(await ids(s.las)).toEqual([id]);

    const sent = await req('POST', '/api/quick-vouchers', receipt({ amount: 35_000, replaces: id }), s.las);
    expect(sent.statusCode, sent.body).toBe(201);
    const next = sent.json().id as string;
    expect(sent.json()).toMatchObject({ status: 'draft', total: 35_000, preparedBy: 'Las', approval: { state: 'waiting', requestedBy: 'Las', reason: null } });
    expect(await ids(s.las)).toEqual([next]);
    expect((await req('GET', `/api/entries/${id}`, undefined, s.admin)).statusCode).toBe(404);
    expect((await req('GET', '/api/voucher-approval', undefined, s.admin)).json().waiting).toBe(1);
    expect((await req('POST', `/api/entries/${next}/approve-waiting`, {}, s.raz)).json()).toMatchObject({ status: 'approved', total: 35_000 });
    expect(await balanceOf(customer, s.admin)).toBe(-35_000);
    expect(safe()).toBe(35_000);
  });
});
