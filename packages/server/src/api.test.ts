import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';

let db: Db;
let app: FastifyInstance;

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

const user = (name: string) => ({ 'x-qasa-user': encodeURIComponent(name) });

async function post(url: string, body: unknown = {}, headers = user('Mer Las')) {
  return app.inject({ method: 'POST', url, payload: body as object, headers });
}

const receipt = {
  kind: 'receipt',
  date: '2026-09-26',
  cashAccountCode: '1811',
  party: 'Raz',
  description: 'القسط 6 من 12 — عقد INS-0087',
  currency: 'IQD',
  rateX100: 142000,
  items: [{ accountCode: '1612', amount: 375000 }]
};

describe('chart of accounts', () => {
  it('seeds the Iraqi unified chart with names in 3 languages', async () => {
    const res = await app.inject('/api/accounts');
    const accounts = res.json() as { code: string; name: { ar: string; en: string; ku: string }; postable: boolean }[];
    expect(accounts.find((a) => a.code === '181')?.name.ar).toBe('نقدية لدى الصندوق');
    expect(accounts.find((a) => a.code === '181')?.postable).toBe(false);
    expect(accounts.find((a) => a.code === '1811')?.postable).toBe(true);
    expect(accounts.every((a) => a.name.ar && a.name.en && a.name.ku)).toBe(true);
  });

  it('adds sub-accounts and protects standard ones', async () => {
    const created = await post('/api/accounts', { parentCode: '181', code: '1812', name: { ar: 'قاصة فرع بغداد', en: 'Baghdad branch safe', ku: 'قاسەی لقی بەغدا' } });
    expect(created.statusCode).toBe(201);
    const duplicate = await post('/api/accounts', { parentCode: '181', code: '1812', name: { ar: 'x', en: 'x', ku: 'x' } });
    expect(duplicate.statusCode).toBe(409);
    const wrongParent = await post('/api/accounts', { parentCode: '181', code: '1912', name: { ar: 'x', en: 'x', ku: 'x' } });
    expect(wrongParent.statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/accounts/181' })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: '/api/accounts/1812' })).statusCode).toBe(204);
  });
});

describe('vouchers', () => {
  it('goes draft → checked → approved and gets a gap-free number on approval', async () => {
    const created = await post('/api/vouchers', receipt);
    expect(created.statusCode).toBe(201);
    const draft = created.json();
    expect(draft.status).toBe('draft');
    expect(draft.number).toBeNull();
    expect(draft.total).toBe(375000);
    expect(draft.lines[0]).toMatchObject({ accountCode: '1811', debit: 375000 });
    expect(draft.actions).toEqual(['edit', 'delete', 'check']);

    const checked = (await post(`/api/entries/${draft.id}/check`, {}, user('Raz'))).json();
    expect(checked.status).toBe('checked');
    expect(checked.checkedBy).toBe('Raz');

    const approved = (await post(`/api/entries/${draft.id}/approve`, {}, user('Mer Las'))).json();
    expect(approved.status).toBe('approved');
    expect(approved.number).toBe('RV-2026-0001');
    expect(approved.approvedBy).toBe('Mer Las');

    const second = (await post('/api/vouchers', receipt)).json();
    await post(`/api/entries/${second.id}/check`);
    expect((await post(`/api/entries/${second.id}/approve`)).json().number).toBe('RV-2026-0002');
  });

  it('rejects vouchers that would not balance or use a parent account', async () => {
    const bad = await post('/api/vouchers', { ...receipt, items: [{ accountCode: '161', amount: 1000 }] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'account_not_postable' })]));
    const notCash = await post('/api/vouchers', { ...receipt, cashAccountCode: '1612' });
    expect(notCash.statusCode).toBe(400);
  });

  it('handles USD vouchers with the day rate', async () => {
    const usd = (await post('/api/vouchers', { ...receipt, currency: 'USD', rateX100: 142000, items: [{ accountCode: '1612', amount: 1000_00 }] })).json();
    expect(usd.total).toBe(1000_00);
    expect(usd.baseTotal).toBe(1_420_000);
  });

  it('never lets a posted entry change — only reverse it', async () => {
    const draft = (await post('/api/vouchers', receipt)).json();
    await post(`/api/entries/${draft.id}/check`);
    await post(`/api/entries/${draft.id}/approve`);

    expect((await app.inject({ method: 'DELETE', url: `/api/entries/${draft.id}` })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PUT', url: `/api/vouchers/${draft.id}`, payload: receipt })).statusCode).toBe(409);
    // even raw SQL is blocked by the database triggers
    expect(() => db.prepare('UPDATE entry_lines SET debit = 1 WHERE entry_id = ?').run(draft.id)).toThrow(/posted_entry_is_permanent/);
    expect(() => db.prepare('DELETE FROM entries WHERE id = ?').run(draft.id)).toThrow(/posted_entry_is_permanent/);

    const reversal = (await post(`/api/entries/${draft.id}/reverse`, { date: '2026-09-27' })).json();
    expect(reversal.type).toBe('reversal');
    expect(reversal.number).toBe('RJ-2026-0001');
    expect(reversal.lines[0]).toMatchObject({ accountCode: '1811', debit: 0, credit: 375000 });
    const original = (await app.inject(`/api/entries/${draft.id}`)).json();
    expect(original.reversedById).toBe(reversal.id);
    expect(original.actions).toEqual([]);
  });

  it('respects locked periods', async () => {
    await post('/api/periods/2026-09/lock');
    const res = await post('/api/vouchers', receipt);
    expect(res.statusCode).toBe(400);
    expect(res.json().details[0].code).toBe('period_locked');
  });
});

describe('reports', () => {
  async function postVoucher(v: object) {
    const id = (await post('/api/vouchers', v)).json().id as string;
    await post(`/api/entries/${id}/check`);
    await post(`/api/entries/${id}/approve`);
  }

  it('builds a balanced trial balance and an account statement from approved entries only', async () => {
    const opening = (await post('/api/entries', {
      date: '2026-01-01', description: 'رصيد افتتاحي', currency: 'IQD', rateX100: 100,
      lines: [{ accountCode: '1811', debit: 10_000_000, credit: 0 }, { accountCode: '21', debit: 0, credit: 10_000_000 }]
    })).json();
    await post(`/api/entries/${opening.id}/check`);
    await post(`/api/entries/${opening.id}/approve`);
    await postVoucher({ ...receipt, kind: 'payment', items: [{ accountCode: '33', amount: 250_000 }], description: 'إيجار' });
    await post('/api/vouchers', receipt); // draft: must not count

    const tb = (await app.inject('/api/reports/trial-balance')).json();
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.rows.find((r: { code: string }) => r.code === '1811').balance).toBe(9_750_000);

    const st = (await app.inject('/api/reports/statement?account=18&from=2026-02-01')).json();
    expect(st.opening).toBe(10_000_000);
    expect(st.closing).toBe(9_750_000);
    expect(st.rows).toHaveLength(1);

    const accounts = (await app.inject('/api/accounts')).json() as { code: string; balance: number }[];
    expect(accounts.find((a) => a.code === '1')?.balance).toBe(9_750_000);
  });

  it('keeps an append-only audit log', async () => {
    await post('/api/vouchers', receipt);
    const log = (await app.inject('/api/audit')).json();
    expect(log[0]).toMatchObject({ action: 'create', entity: 'entry', user: 'Mer Las' });
    expect(() => db.prepare('DELETE FROM audit_log').run()).toThrow(/append_only/);
  });
});
