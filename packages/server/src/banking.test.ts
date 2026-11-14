import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { bankingApi } from './banking.ts';

let db: Db;
let app: FastifyInstance;
let customerId: string;
let supplierId: string;

const headers = { 'x-qasa-client': '1', 'x-qasa-user': encodeURIComponent('Mer') };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const put = (url: string, body: unknown = {}) => app.inject({ method: 'PUT', url, payload: body as object, headers });
const get = (url: string) => app.inject({ url, headers });
const del = (url: string) => app.inject({ method: 'DELETE', url, headers });

const day = (offset: number) => new Date(Date.parse(todayIso() + 'T00:00:00Z') + offset * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  customerId = (await post('/api/parties', { type: 'customer', name: 'Bazaar Trading Company' })).json().id;
  supplierId = (await post('/api/parties', { type: 'supplier', name: 'Zagros Steel' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function approve(id: string) {
  const c = await post(`/api/entries/${id}/check`);
  expect(c.statusCode, c.body).toBe(200);
  const a = await post(`/api/entries/${id}/approve`);
  expect(a.statusCode, a.body).toBe(200);
}

/** The approved balance of an account in a currency, from the lines. */
function balance(code: string, currency = 'IQD'): number {
  const r = db.prepare(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                        WHERE l.account_code = ? AND e.currency = ? AND e.status = 'approved'`).get(code, currency) as { b: number };
  return Number(r.b);
}

function partyBalance(partyId: string): number {
  const r = db.prepare(`SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS b FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                        WHERE l.party_id = ? AND e.status = 'approved'`).get(partyId) as { b: number };
  return Number(r.b);
}

async function fund(account: string, amount: number, currency: 'IQD' | 'USD' = 'IQD') {
  const r = await post('/api/vouchers', {
    kind: 'receipt', date: day(-20), cashAccountCode: account, description: 'Capital', currency, rateX100: currency === 'IQD' ? 100 : 150_000,
    items: [{ accountCode: '211', amount }]
  });
  if (r.statusCode !== 201) {
    // capital account differs between charts: fall back to any postable class-2 account
    const any = (db.prepare(`SELECT code FROM accounts WHERE code LIKE '21%' ORDER BY length(code) DESC LIMIT 1`).get() as { code: string }).code;
    const again = await post('/api/vouchers', {
      kind: 'receipt', date: day(-20), cashAccountCode: account, description: 'Capital', currency, rateX100: currency === 'IQD' ? 100 : 150_000,
      items: [{ accountCode: any, amount }]
    });
    expect(again.statusCode, again.body).toBe(201);
    await approve(again.json().id);
    return;
  }
  await approve(r.json().id);
}

async function addBank(name = 'Rafidain Bank', kind = 'bank', currency: 'IQD' | 'USD' | null = 'IQD'): Promise<string> {
  const r = await post('/api/banking/accounts', { name: { ar: name, en: name, ku: name }, kind, currency });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().code;
}

describe('safes, banks and wallets', () => {
  it('lists the cash accounts and adds banks and e-wallets under 183 with the next free code', async () => {
    const list = (await get('/api/banking/accounts')).json();
    expect(list.accounts.map((a: { code: string }) => a.code)).toEqual(expect.arrayContaining(['1811', '1831', '1832']));
    expect(list.accounts.find((a: { code: string }) => a.code === '1811').kind).toBe('safe');
    expect(list.accounts.find((a: { code: string }) => a.code === '1831').kind).toBe('bank');

    expect(await addBank('Trade Bank of Iraq')).toBe('1833');
    expect(await addBank('ZainCash', 'zaincash')).toBe('1834');
    const after = (await get('/api/banking/accounts')).json().accounts;
    expect(after.find((a: { code: string }) => a.code === '1834')).toMatchObject({ kind: 'zaincash', currency: 'IQD', balance: { IQD: 0, USD: 0 } });

    expect((await post('/api/banking/accounts', { name: { ar: '', en: ' ', ku: '' }, kind: 'bank' })).statusCode).toBe(400);
    expect((await put('/api/banking/accounts/1811', { kind: 'safe', currency: 'IQD' })).statusCode).toBe(200);
    expect((await put('/api/banking/accounts/1611', { kind: 'bank', currency: 'IQD' })).statusCode).toBe(404);
  });
});

describe('transfers', () => {
  it('makes a balanced draft entry with the bank charge, and changes balances only once approved', async () => {
    await fund('1811', 10_000_000);
    const t = await post('/api/banking/transfers', { date: day(-1), from: '1811', to: '1831', currency: 'IQD', amount: 5_000_000, charge: 2_500, description: 'Deposit' });
    expect(t.statusCode, t.body).toBe(201);
    const entry = t.json();
    expect(entry.status).toBe('draft');
    const debit = entry.lines.reduce((s: number, l: { debit: number }) => s + l.debit, 0);
    const credit = entry.lines.reduce((s: number, l: { credit: number }) => s + l.credit, 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(5_002_500);
    expect(balance('1831')).toBe(0);
    await approve(entry.id);
    expect(balance('1831')).toBe(5_000_000);
    expect(balance('1811')).toBe(10_000_000 - 5_002_500);
    expect(balance('39')).toBe(2_500);
  });

  it('moves dollars at the day rate with base amounts balanced, and refuses bad transfers', async () => {
    await fund('1811', 1_000_00, 'USD');
    const t = await post('/api/banking/transfers', { date: day(-1), from: '1811', to: '1832', currency: 'USD', rateX100: 148_000, amount: 300_00 });
    expect(t.statusCode, t.body).toBe(201);
    const e = t.json();
    expect(e.lines.reduce((s: number, l: { baseDebit: number }) => s + l.baseDebit, 0)).toBe(e.lines.reduce((s: number, l: { baseCredit: number }) => s + l.baseCredit, 0));
    await approve(e.id);
    expect(balance('1832', 'USD')).toBe(300_00);

    expect((await post('/api/banking/transfers', { date: day(0), from: '1811', to: '1811', currency: 'IQD', amount: 1 })).json().details).toEqual(expect.arrayContaining([{ code: 'bk_same_account' }]));
    expect((await post('/api/banking/transfers', { date: day(0), from: '1811', to: '1611', currency: 'IQD', amount: 1 })).statusCode).toBe(400);
    expect((await post('/api/banking/transfers', { date: day(0), from: '1811', to: '1831', currency: 'USD', amount: 1 })).json().details).toEqual(expect.arrayContaining([{ code: 'rate_invalid' }]));
    expect((await post('/api/banking/transfers', { date: day(0), from: '1811', to: '1831', currency: 'IQD', amount: -5 })).statusCode).toBe(400);
    expect((await post('/api/banking/transfers', { date: day(0), from: '1811', to: '1831', currency: 'IQD', amount: 5, charge: 1, chargeAccount: '1611' })).json().details).toEqual(expect.arrayContaining([{ code: 'bk_charge_account_invalid' }]));
  });
});

describe('cheques', () => {
  const received = (over: Record<string, unknown> = {}) => ({
    direction: 'received', number: '000123', bank: 'Rafidain', partyId: customerId, currency: 'IQD', amount: 2_000_000,
    issueDate: day(-3), dueDate: day(2), ...over
  });

  it('adds notes receivable 162 on first use and walks a received cheque to cleared', async () => {
    // new companies get 162 from the chart; older companies (made before it was added) get it on first use
    db.prepare("DELETE FROM accounts WHERE code = '162'").run();
    expect(db.prepare("SELECT 1 FROM accounts WHERE code = '162'").get()).toBeUndefined();
    const r = await post('/api/banking/cheques', received());
    expect(r.statusCode, r.body).toBe(201);
    const cheque = r.json();
    expect(cheque).toMatchObject({ status: 'in_hand', actions: ['cancel'], entry: { status: 'draft' } });
    expect(db.prepare("SELECT system FROM accounts WHERE code = '162'").get()).toEqual({ system: 1 });

    // nothing moves until the entry is approved
    expect((await post(`/api/banking/cheques/${cheque.id}/deposit`, { bankAccount: '1831' })).json().error).toBe('bk_cheque_entry_not_approved');
    await approve(cheque.entry.id);
    expect(balance('162')).toBe(2_000_000);
    expect(partyBalance(customerId)).toBe(-2_000_000);

    // a duplicate is refused
    expect((await post('/api/banking/cheques', received())).json().details).toEqual(expect.arrayContaining([{ code: 'bk_cheque_duplicate' }]));

    const dep = await post(`/api/banking/cheques/${cheque.id}/deposit`, { bankAccount: '1831' });
    expect(dep.json()).toMatchObject({ status: 'deposited', bankAccount: { code: '1831' }, actions: ['clear', 'bounce'] });
    const clr = await post(`/api/banking/cheques/${cheque.id}/clear`, { date: day(2) });
    expect(clr.statusCode, clr.body).toBe(200);
    // (the entry with its date: the page won't offer to undo it on an earlier day)
    expect(clr.json()).toMatchObject({ status: 'cleared', clearEntry: { status: 'draft', date: day(2) }, actions: ['undo'] });
    await approve(clr.json().clearEntry.id);
    expect(balance('162')).toBe(0);
    expect(balance('1831')).toBe(2_000_000);
    expect(partyBalance(customerId)).toBe(-2_000_000);
    expect((await post(`/api/banking/cheques/${cheque.id}/bounce`, { date: day(3) })).statusCode).toBe(409);
  });

  it('puts the customer back in debt with a fee when a cheque bounces', async () => {
    const c = (await post('/api/banking/cheques', received({ number: '777' }))).json();
    await approve(c.entry.id);
    await post(`/api/banking/cheques/${c.id}/deposit`, { bankAccount: '1831' });
    const b = await post(`/api/banking/cheques/${c.id}/bounce`, { date: day(1), fee: 25_000, reason: 'Insufficient funds' });
    expect(b.statusCode, b.body).toBe(200);
    expect(b.json().status).toBe('bounced');
    await approve(b.json().bounceEntry.id);
    expect(balance('162')).toBe(0);
    expect(partyBalance(customerId)).toBe(25_000);
    expect(balance('49')).toBe(-25_000);
    // the customer may hand the same cheque in again after it bounced
    expect((await post('/api/banking/cheques', received({ number: '777' }))).statusCode).toBe(201);
  });

  it('writes a cheque to a supplier through notes payable and clears it from the bank', async () => {
    await fund('1831', 5_000_000);
    expect((await post('/api/banking/cheques', received({ direction: 'issued', partyId: supplierId }))).json().details)
      .toEqual(expect.arrayContaining([{ code: 'bk_account_invalid', field: 'bankAccount' }]));
    const i = await post('/api/banking/cheques', received({ direction: 'issued', partyId: supplierId, bankAccount: '1831', number: 'A-1' }));
    expect(i.statusCode, i.body).toBe(201);
    expect(i.json().status).toBe('pending');
    await approve(i.json().entry.id);
    expect(balance('262')).toBe(-2_000_000);
    expect(partyBalance(supplierId)).toBe(2_000_000);
    const clr = await post(`/api/banking/cheques/${i.json().id}/clear`, { date: day(2) });
    expect(clr.statusCode, clr.body).toBe(200);
    await approve(clr.json().clearEntry.id);
    expect(balance('262')).toBe(0);
    expect(balance('1831')).toBe(3_000_000);
    // a customer cannot be the payee of an issued cheque, nor a supplier the drawer of a received one
    expect((await post('/api/banking/cheques', received({ partyId: supplierId, number: 'X' }))).json().details).toEqual([{ code: 'customer_required' }]);
  });

  it('cancels: a draft entry is deleted, an approved one is reversed by a draft', async () => {
    const a = (await post('/api/banking/cheques', received({ number: 'C1' }))).json();
    const ca = await post(`/api/banking/cheques/${a.id}/cancel`, {});
    expect(ca.json()).toMatchObject({ status: 'cancelled', entry: null, bounceEntry: null });
    // a cancelled number may be entered again
    expect((await post('/api/banking/cheques', received({ number: 'C1' }))).statusCode).toBe(201);

    const b = (await post('/api/banking/cheques', received({ number: 'C2' }))).json();
    await approve(b.entry.id);
    const cb = await post(`/api/banking/cheques/${b.id}/cancel`, { reason: 'returned to customer' });
    expect(cb.json()).toMatchObject({ status: 'cancelled', bounceEntry: { status: 'draft' } });
    await approve(cb.json().bounceEntry.id);
    // C1 (re-entered, still a draft) doesn't count; C2 was received and cancelled
    expect(balance('162')).toBe(0);
    expect(partyBalance(customerId)).toBe(0);
  });

  it('lists due cheques and totals what is in hand by currency', async () => {
    for (const [n, due, currency, amount] of [['1', day(0), 'IQD', 1_000_000], ['2', day(5), 'IQD', 500_000], ['3', day(-2), 'USD', 100_00], ['4', day(30), 'USD', 50_00]] as const) {
      expect((await post('/api/banking/cheques', received({ number: n, dueDate: due, issueDate: day(-10), currency, amount, ...(currency === 'USD' ? { rateX100: 150_000 } : {}) }))).statusCode).toBe(201);
    }
    expect((await post('/api/banking/cheques', received({ direction: 'issued', partyId: supplierId, bankAccount: '1831', number: 'P', dueDate: day(1), issueDate: day(-1) }))).statusCode).toBe(201);
    const s = (await get('/api/banking/cheques/summary')).json();
    expect(s).toMatchObject({ inHand: { IQD: 1_500_000, USD: 150_00 }, inHandCount: 4, issuedPending: { IQD: 2_000_000, USD: 0 }, issuedPendingCount: 1, dueToday: 1, dueThisWeek: 3, overdue: 1 });
    expect((await get('/api/banking/cheques?due=today')).json().map((c: { number: string }) => c.number)).toEqual(['1']);
    expect((await get('/api/banking/cheques?due=overdue')).json().map((c: { number: string }) => c.number)).toEqual(['3']);
    expect((await get('/api/banking/cheques?due=week&direction=received')).json().map((c: { number: string }) => c.number)).toEqual(['1', '2']);
    expect((await get('/api/banking/cheques?q=Bazaar')).json()).toHaveLength(4);
    expect((await get('/api/banking/cheques?direction=issued')).json()[0]).toMatchObject({ number: 'P', daysToDue: 1, party: { name: 'Zagros Steel' } });
    expect((await get('/api/banking/cheques?status=bogus')).statusCode).toBe(400);
  });
});

describe('bank reconciliation', () => {
  it('is a Pro feature', async () => {
    const r = await post('/api/banking/statements', { accountCode: '1831', currency: 'IQD', from: day(-30), to: day(0), opening: 0, closing: 1, lines: [{ date: day(0), description: 'x', amount: 1 }] });
    expect(r.json()).toMatchObject({ error: 'plan_limit', details: { limit: 'bankReconciliation' } });
    expect((await get('/api/banking/accounts')).json().reconciliation).toBe(false);
  });

  it('matches by amount, date ±3 days and reference, makes vouchers for the rest, and reconciles at zero difference', async () => {
    expect((await post('/api/plan/trial')).statusCode).toBe(200);
    expect((await get('/api/banking/accounts')).json().reconciliation).toBe(true);
    // the books: two deposits of the same amount (only the reference tells them apart) and a payment
    await fund('1811', 20_000_000);
    const t1 = (await post('/api/banking/transfers', { date: day(-10), from: '1811', to: '1831', currency: 'IQD', amount: 1_000_000, description: 'Deposit slip 5501' })).json();
    const t2 = (await post('/api/banking/transfers', { date: day(-9), from: '1811', to: '1831', currency: 'IQD', amount: 1_000_000, description: 'Deposit slip 5502' })).json();
    const t3 = (await post('/api/banking/transfers', { date: day(-5), from: '1831', to: '1811', currency: 'IQD', amount: 300_000, description: 'Cash withdrawal' })).json();
    for (const e of [t1, t2, t3]) await approve(e.id);
    // a draft is not on the books yet
    await post('/api/banking/transfers', { date: day(-4), from: '1811', to: '1831', currency: 'IQD', amount: 50_000 });

    const lines = [
      { date: day(-8), description: 'CASH DEP', reference: '5502', amount: 1_000_000 },
      { date: day(-10), description: 'CASH DEP', reference: '5501', amount: 1_000_000 },
      { date: day(-3), description: 'ATM', amount: -300_000 },
      { date: day(-1), description: 'Bank charges', amount: -5_000 }
    ];
    expect((await post('/api/banking/statements', { accountCode: '1831', currency: 'IQD', from: day(-15), to: day(0), opening: 0, closing: 1, lines })).json().details)
      .toEqual([{ code: 'bk_statement_unbalanced' }]);
    const created = await post('/api/banking/statements', { accountCode: '1831', currency: 'IQD', from: day(-15), to: day(0), opening: 0, closing: 1_695_000, lines });
    expect(created.statusCode, created.body).toBe(201);
    const st = created.json();
    expect(st).toMatchObject({ bookBalance: 1_700_000, difference: -5_000, unmatchedLines: 4, unmatchedBook: 3, canReconcile: false });

    const auto = (await post(`/api/banking/statements/${st.id}/auto-match`)).json();
    expect(auto.matched).toBe(3);
    const byRef = Object.fromEntries(auto.statement.lines.map((l: { reference: string; entry: { id: string } | null }) => [l.reference, l.entry?.id ?? null]));
    expect(byRef['5501']).toBe(t1.id);
    expect(byRef['5502']).toBe(t2.id);
    expect(auto.statement.lines[2].entry.id).toBe(t3.id);
    expect(auto.statement).toMatchObject({ unmatchedLines: 1, unmatchedLinesSum: -5_000, unmatchedBook: 0 });

    // manual unmatch / rematch, and a wrong amount is refused
    expect((await post(`/api/banking/statements/${st.id}/lines/3/match`, { entryId: null })).json().unmatchedLines).toBe(2);
    expect((await post(`/api/banking/statements/${st.id}/lines/4/match`, { entryId: t3.id })).json().details).toEqual([{ code: 'bk_match_amount' }]);
    expect((await post(`/api/banking/statements/${st.id}/lines/3/match`, { entryId: t3.id })).statusCode).toBe(200);
    expect((await post(`/api/banking/statements/${st.id}/lines/3/match`, { entryId: t3.id })).statusCode).toBe(409);

    expect((await post(`/api/banking/statements/${st.id}/reconcile`)).json().error).toBe('bk_statement_unmatched');
    // the bank charge the books don't have: a draft payment voucher, matched at once
    const v = await post(`/api/banking/statements/${st.id}/lines/4/voucher`, { accountCode: '39' });
    expect(v.statusCode, v.body).toBe(200);
    const charge = v.json().lines[3].entry;
    expect(charge.status).toBe('draft');
    expect(v.json()).toMatchObject({ unmatchedLines: 0, difference: -5_000 });
    expect((await post(`/api/banking/statements/${st.id}/reconcile`)).json().error).toBe('bk_statement_difference');
    await approve(charge.id);
    const ready = (await get(`/api/banking/statements/${st.id}`)).json();
    expect(ready).toMatchObject({ difference: 0, canReconcile: true });
    expect((await post(`/api/banking/statements/${st.id}/reconcile`)).json().status).toBe('reconciled');
    expect((await post(`/api/banking/statements/${st.id}/lines/1/match`, { entryId: null })).json().error).toBe('bk_statement_reconciled');
    expect((await del(`/api/banking/statements/${st.id}`)).statusCode).toBe(409);
    expect((await get('/api/banking/statements')).json()[0]).toMatchObject({ status: 'reconciled', lines: 4, matched: 4 });

    // a second statement can't reuse entries already matched
    const second = (await post('/api/banking/statements', { accountCode: '1831', currency: 'IQD', from: day(-15), to: day(0), opening: 0, closing: 1_000_000, lines: [{ date: day(-10), description: 'dup', reference: '5501', amount: 1_000_000 }] })).json();
    expect((await post(`/api/banking/statements/${second.id}/auto-match`)).json().matched).toBe(0);
    expect((await del(`/api/banking/statements/${second.id}`)).statusCode).toBe(204);
  });

  it('never auto-matches a reversed entry or its reversal, as matching by hand refuses them', async () => {
    await post('/api/plan/trial');
    await fund('1811', 5_000_000);
    const t = (await post('/api/banking/transfers', { date: day(-6), from: '1811', to: '1831', currency: 'IQD', amount: 400_000, description: 'Deposit slip 7701' })).json();
    await approve(t.id);
    const back = await post(`/api/entries/${t.id}/reverse`, { date: day(-5) });
    expect(back.statusCode, back.body).toBe(200);
    const lines = [{ date: day(-6), description: 'CASH DEP', reference: '7701', amount: 400_000 }, { date: day(-5), description: 'RETURNED', reference: '7701', amount: -400_000 }];
    const st = (await post('/api/banking/statements', { accountCode: '1831', currency: 'IQD', from: day(-10), to: day(0), opening: 0, closing: 0, lines })).json();
    const auto = (await post(`/api/banking/statements/${st.id}/auto-match`)).json();
    expect(auto.matched).toBe(0);
    expect(auto.statement.lines.map((l: { entry: unknown }) => l.entry)).toEqual([null, null]);
    expect((await post(`/api/banking/statements/${st.id}/lines/1/match`, { entryId: t.id })).json().details).toEqual([{ code: 'bk_match_invalid' }]);
  });

  it('leaves equal candidates for the person when nothing tells them apart', async () => {
    await post('/api/plan/trial');
    await fund('1811', 5_000_000);
    for (const d of [-6, -4]) await approve((await post('/api/banking/transfers', { date: day(d), from: '1811', to: '1831', currency: 'IQD', amount: 100_000 })).json().id);
    const st = (await post('/api/banking/statements', { accountCode: '1831', currency: 'IQD', from: day(-10), to: day(0), opening: 0, closing: 100_000, lines: [{ date: day(-5), description: 'DEP', amount: 100_000 }] })).json();
    expect((await post(`/api/banking/statements/${st.id}/auto-match`)).json().matched).toBe(0);
  });
});

describe('cheque entries stay with the cheque', () => {
  const received = (over: Record<string, unknown> = {}) => ({
    direction: 'received', number: '9001', bank: 'Rafidain', partyId: customerId, currency: 'IQD', amount: 1_000_000,
    issueDate: day(-3), dueDate: day(2), ...over
  });

  it('refuses to edit, delete or reverse a cheque’s entries from the journal', async () => {
    const c = (await post('/api/banking/cheques', received())).json();
    const draft = (await get(`/api/entries/${c.entry.id}`)).json();
    expect(draft.actions).toEqual(['check']);
    const edit = await put(`/api/entries/${c.entry.id}`, {
      date: day(-3), description: 'x', currency: 'IQD', rateX100: 100,
      lines: [{ accountCode: '162', debit: 100_000, credit: 0 }, { accountCode: draft.lines[1].accountCode, debit: 0, credit: 100_000, partyId: customerId }]
    });
    expect(edit.json().error).toBe('entry_belongs_to_cheque');
    expect((await del(`/api/entries/${c.entry.id}`)).json().error).toBe('entry_belongs_to_cheque');
    await approve(c.entry.id);
    expect((await get(`/api/entries/${c.entry.id}`)).json().actions).toEqual([]);
    expect((await post(`/api/entries/${c.entry.id}/reverse`, {})).json().error).toBe('entry_belongs_to_cheque');
    expect(balance('162')).toBe(1_000_000);
    // the clearing voucher is the cheque's too
    const clr = (await post(`/api/banking/cheques/${c.id}/clear`, { date: day(0), bankAccount: '1831' })).json();
    expect((await del(`/api/entries/${clr.clearEntry.id}`)).json().error).toBe('entry_belongs_to_cheque');
  });

  it('a cheque whose entry was reversed has no next step', async () => {
    const c = (await post('/api/banking/cheques', received())).json();
    await approve(c.entry.id);
    // a reversal made before this guard existed (or by an older version) must not let the cheque clear
    db.prepare("UPDATE entries SET reversed_by_id = id WHERE id = ?").run(c.entry.id);
    expect((await get(`/api/banking/cheques/${c.id}`)).json().actions).toEqual(['cancel']);
    expect((await post(`/api/banking/cheques/${c.id}/clear`, { date: day(0), bankAccount: '1831' })).json().error).toBe('bk_cheque_entry_not_approved');
  });

  it('takes back a wrong clearing: a draft is deleted, an approved one reversed', async () => {
    const c = (await post('/api/banking/cheques', received())).json();
    await approve(c.entry.id);
    await post(`/api/banking/cheques/${c.id}/deposit`, { bankAccount: '1831' });
    const clr = (await post(`/api/banking/cheques/${c.id}/clear`, { date: day(0) })).json();
    const undo = await post(`/api/banking/cheques/${c.id}/undo`, {});
    expect(undo.statusCode, undo.body).toBe(200);
    expect(undo.json()).toMatchObject({ status: 'deposited', clearEntry: null, bankAccount: { code: '1831' }, actions: ['clear', 'bounce'] });
    expect((await get(`/api/entries/${clr.clearEntry.id}`)).statusCode).toBe(404);

    const again = (await post(`/api/banking/cheques/${c.id}/clear`, { date: day(0) })).json();
    await approve(again.clearEntry.id);
    expect(balance('1831')).toBe(1_000_000);
    const back = (await post(`/api/banking/cheques/${c.id}/undo`, {})).json();
    expect(back).toMatchObject({ status: 'deposited', clearEntry: null });
    expect(balance('1831')).toBe(0);
    expect(balance('162')).toBe(1_000_000);
    // now it can bounce, and the bounce can be taken back too
    const b = (await post(`/api/banking/cheques/${c.id}/bounce`, { date: day(0) })).json();
    expect(b.actions).toEqual(['undo']);
    expect((await post(`/api/banking/cheques/${c.id}/undo`, {})).json().status).toBe('deposited');
    expect((await post(`/api/banking/cheques/${c.id}/undo`, {})).statusCode).toBe(409);
  });

  it('a cheque cleared from in hand goes back in hand', async () => {
    const c = (await post('/api/banking/cheques', received())).json();
    await approve(c.entry.id);
    await post(`/api/banking/cheques/${c.id}/clear`, { date: day(0), bankAccount: '1831' });
    expect((await post(`/api/banking/cheques/${c.id}/undo`, {})).json()).toMatchObject({ status: 'in_hand', bankAccount: null });
  });

  it('records a bounce for a customer set inactive since', async () => {
    const c = (await post('/api/banking/cheques', received())).json();
    await approve(c.entry.id);
    db.prepare('UPDATE parties SET active = 0 WHERE id = ?').run(customerId);
    const b = await post(`/api/banking/cheques/${c.id}/bounce`, { date: day(0) });
    expect(b.statusCode, b.body).toBe(200);
    await approve(b.json().bounceEntry.id);
    expect(partyBalance(customerId)).toBe(0);
  });
});

describe('matching statement lines', () => {
  it('checks the amount of any entry, refuses reversed ones, and reconciles only approved entries', async () => {
    await post('/api/plan/trial');
    await fund('1811', 5_000_000);
    const real = (await post('/api/banking/transfers', { date: day(-4), from: '1811', to: '1831', currency: 'IQD', amount: 200 })).json();
    await approve(real.id);
    const big = (await post('/api/banking/transfers', { date: day(-4), from: '1811', to: '1831', currency: 'IQD', amount: 999_999 })).json();
    const st = (await post('/api/banking/statements', { accountCode: '1831', currency: 'IQD', from: day(-10), to: day(0), opening: 0, closing: 200, lines: [{ date: day(-4), description: 'DEP', amount: 200 }] })).json();
    expect((await post(`/api/banking/statements/${st.id}/lines/1/match`, { entryId: big.id })).json().details).toEqual([{ code: 'bk_match_amount' }]);
    // a draft of the right amount can be matched, but the statement waits for its approval
    const small = (await post('/api/banking/transfers', { date: day(-4), from: '1811', to: '1831', currency: 'IQD', amount: 200 })).json();
    expect((await post(`/api/banking/statements/${st.id}/lines/1/match`, { entryId: small.id })).statusCode).toBe(200);
    // the matched draft can't be deleted from the journal while it is matched
    expect((await del(`/api/entries/${small.id}`)).json().error).toBe('entry_matched_to_statement');
    const view = (await get(`/api/banking/statements/${st.id}`)).json();
    expect(view.canReconcile).toBe(false);
    expect((await post(`/api/banking/statements/${st.id}/reconcile`)).json().error).toBe('bk_statement_unposted');
    // reversed entries are refused
    await post(`/api/banking/statements/${st.id}/lines/1/match`, { entryId: null });
    await post(`/api/entries/${real.id}/reverse`, {});
    expect((await post(`/api/banking/statements/${st.id}/lines/1/match`, { entryId: real.id })).json().details).toEqual([{ code: 'bk_match_invalid' }]);
    expect((await get('/api/banking/statements')).json()[0]).toMatchObject({ lines: 1, matched: 0 });
  });
});

describe('the words banking writes into entries', () => {
  it('follow the language of whoever makes the step', async () => {
    const t = (await post('/api/banking/transfers', { date: day(0), from: '1811', to: '1831', currency: 'IQD', amount: 1_000, charge: 100, lang: 'ku' })).json();
    expect(t.description).toBe('گواستنەوە لە نێوان هەژمارەکان');
    expect(t.lines.map((l: { description: string }) => l.description)).toContain('کۆمیسیۆنی بانک');
    const c = (await post('/api/banking/cheques', { direction: 'received', number: '55', bank: 'Rafidain', partyId: customerId, currency: 'IQD', amount: 1_000, issueDate: day(0), dueDate: day(1), lang: 'ar' })).json();
    expect((await get(`/api/entries/${c.entry.id}`)).json().description).toBe('صك رقم 55 — Rafidain');
    await approve(c.entry.id);
    const clr = (await post(`/api/banking/cheques/${c.id}/clear`, { date: day(0), bankAccount: '1831', lang: 'en' })).json();
    expect((await get(`/api/entries/${clr.clearEntry.id}`)).json().description).toBe('Cheque 55 — Rafidain — cleared');
  });
});
