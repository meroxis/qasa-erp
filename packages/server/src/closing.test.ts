import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { writeSetting } from './settings.ts';

/** Year-end closing, with years counted back from today so the tests keep their meaning in any year. */

let db: Db;
let app: FastifyInstance;
const Y = Number(todayIso().slice(0, 4));
const LAST = Y - 1;
const BEFORE = Y - 2;

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

const headers = { 'x-qasa-user': encodeURIComponent('Mer Las') };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const get = (url: string) => app.inject({ method: 'GET', url, headers });
const pro = () => writeSetting(db, 'trial_started', todayIso());

/** A journal entry taken through check and approval. */
async function posted(date: string, lines: { accountCode: string; debit: number; credit: number }[]): Promise<string> {
  const created = await post('/api/entries', { date, description: 'Mer Las books', currency: 'IQD', rateX100: 100, lines });
  expect(created.statusCode).toBe(201);
  const id = (created.json() as { id: string }).id;
  expect((await post(`/api/entries/${id}/check`)).statusCode).toBe(200);
  expect((await post(`/api/entries/${id}/approve`)).statusCode).toBe(200);
  return id;
}

/** Sales of 1,000,000 against a cost of `cost`, in `year`. */
async function trade(year: number, cost = 600_000): Promise<void> {
  await posted(`${year}-03-10`, [{ accountCode: '1811', debit: 1_000_000, credit: 0 }, { accountCode: '42', debit: 0, credit: 1_000_000 }]);
  await posted(`${year}-03-11`, [{ accountCode: '35', debit: cost, credit: 0 }, { accountCode: '1811', debit: 0, credit: cost }]);
}

type Year = { year: number; closing: { number: string } | null; result: number; blockers: { code: string; year?: number; count?: number }[] };
const years = async () => (await get('/api/year-end')).json().years as Year[];
const yearOf = async (y: number) => (await years()).find((r) => r.year === y)!;
const balance = async (code: string, to = `${Y}-12-31`) => {
  const rows = (await get(`/api/reports/trial-balance?to=${to}`)).json() as { rows?: { code: string; debit: number; credit: number }[] } | { code: string; debit: number; credit: number }[];
  const list = Array.isArray(rows) ? rows : rows.rows ?? [];
  const r = list.find((x) => x.code === code);
  return r ? r.debit - r.credit : 0;
};

describe('year-end closing', () => {
  it('is part of Pro', async () => {
    await trade(LAST);
    expect((await yearOf(LAST)).blockers.map((b) => b.code)).toContain('plan_limit');
    const refused = await post(`/api/year-end/${LAST}/close`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'plan_limit', details: { limit: 'yearEnd' } });
  });

  it('empties revenue and expenses into the accumulated result, locks the year, and keeps its final accounts', async () => {
    pro();
    await trade(LAST);
    expect(await yearOf(LAST)).toMatchObject({ result: 400_000, closing: null, blockers: [] });
    expect((await yearOf(Y)).blockers.map((b) => b.code)).toContain('year_not_ended');

    const closed = await post(`/api/year-end/${LAST}/close`);
    expect(closed.statusCode).toBe(200);
    const entry = closed.json() as { type: string; number: string; date: string; status: string; actions: string[]; lines: { accountCode: string; debit: number; credit: number }[] };
    expect(entry).toMatchObject({ type: 'closing', number: `CL-${LAST}-0001`, date: `${LAST}-12-31`, status: 'approved', actions: [] });
    expect(entry.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([['35', 0, 600_000], ['42', 1_000_000, 0], ['229', 0, 400_000]]);

    expect(await balance('42')).toBe(0);
    expect(await balance('35')).toBe(0);
    expect(await balance('229')).toBe(-400_000);

    const periods = (await get('/api/periods')).json() as { period: string }[];
    expect(periods.map((p) => p.period)).toEqual(Array.from({ length: 12 }, (_, i) => `${LAST}-${String(i + 1).padStart(2, '0')}`));
    const late = await post('/api/entries', { date: `${LAST}-06-01`, description: 'late', currency: 'IQD', rateX100: 100, lines: [{ accountCode: '1811', debit: 5, credit: 0 }, { accountCode: '42', debit: 0, credit: 5 }] });
    expect(late.statusCode).toBe(400);

    // the closed year still shows its own result; its balance sheet has it in the reserves
    const fa = (await get(`/api/reports/final-accounts?from=${LAST}-01-01&to=${LAST}-12-31`)).json();
    expect(fa.netResult).toBe(400_000);
    expect(fa.balanceSheet.currentResult).toBe(0);
    expect(fa.balanceSheet.liabilities.find((g: { code: string }) => g.code === '22').amount).toBe(400_000);
    expect(fa.balanceSheet.totalAssets).toBe(fa.balanceSheet.totalLiabilities);
    const next = (await get(`/api/reports/final-accounts?from=${Y}-01-01&to=${Y}-12-31`)).json();
    expect(next.balanceSheet.priorResult).toBe(0);
    expect(next.balanceSheet.totalAssets).toBe(next.balanceSheet.totalLiabilities);

    expect((await post(`/api/year-end/${LAST}/close`)).json().error).toBe('year_closed');
    expect((await yearOf(LAST)).closing?.number).toBe(`CL-${LAST}-0001`);
  });

  it('can only be undone by reopening: a reversal, the months unlocked, and it can close again', async () => {
    pro();
    await trade(LAST);
    const entry = (await post(`/api/year-end/${LAST}/close`)).json() as { id: string };
    expect((await post(`/api/entries/${entry.id}/reverse`, { date: `${LAST}-12-31` })).statusCode).toBe(409);

    const reopened = await post(`/api/year-end/${LAST}/reopen`);
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({ type: 'reversal', status: 'approved' });
    expect(await balance('42')).toBe(-1_000_000);
    expect(await balance('229')).toBe(0);
    expect((await get('/api/periods')).json()).toEqual([]);
    expect((await yearOf(LAST)).closing).toBeNull();
    // and the year's result is still the same
    expect((await get(`/api/reports/final-accounts?from=${LAST}-01-01&to=${LAST}-12-31`)).json().netResult).toBe(400_000);

    expect((await post(`/api/year-end/${LAST}/close`)).json().number).toBe(`CL-${LAST}-0002`);
    expect(await balance('229')).toBe(-400_000);
  });

  it('closes years in order and reopens the latest first', async () => {
    pro();
    await trade(BEFORE);
    await trade(LAST);
    const early = await post(`/api/year-end/${LAST}/close`);
    expect(early.json()).toMatchObject({ error: 'close_previous_year_first', details: { year: BEFORE } });
    expect((await post(`/api/year-end/${BEFORE}/close`)).statusCode).toBe(200);
    expect((await post(`/api/year-end/${LAST}/close`)).statusCode).toBe(200);
    expect(await balance('229')).toBe(-800_000);
    expect((await post(`/api/year-end/${BEFORE}/reopen`)).json()).toMatchObject({ error: 'reopen_later_year_first', details: { year: LAST } });
  });

  it('waits for unfinished vouchers and documents, and has nothing to close in an empty year', async () => {
    pro();
    await trade(LAST);
    await post('/api/entries', { date: `${LAST}-05-01`, description: 'draft', currency: 'IQD', rateX100: 100, lines: [{ accountCode: '1811', debit: 7, credit: 0 }, { accountCode: '42', debit: 0, credit: 7 }] });
    expect((await yearOf(LAST)).blockers).toContainEqual({ code: 'unfinished_entries', count: 1 });
    expect((await post(`/api/year-end/${LAST}/close`)).json().error).toBe('unfinished_entries');

    db.exec("DELETE FROM entries WHERE status = 'draft'");
    // a year with only balance-sheet movements has nothing to close
    await posted(`${BEFORE}-01-15`, [{ accountCode: '1811', debit: 50, credit: 0 }, { accountCode: '229', debit: 0, credit: 50 }]);
    expect((await yearOf(BEFORE)).blockers.map((b) => b.code)).toContain('nothing_to_close');
    expect((await post(`/api/year-end/${LAST}/close`)).statusCode).toBe(200);
  });

  it('puts a loss on the debit side of the accumulated result', async () => {
    pro();
    await trade(LAST, 1_300_000);
    const lines = (await post(`/api/year-end/${LAST}/close`)).json().lines as { accountCode: string; debit: number; credit: number }[];
    expect(lines.find((l) => l.accountCode === '229')).toMatchObject({ debit: 300_000, credit: 0 });
    expect(await balance('229')).toBe(300_000);
  });

  it('keeps the posting account in the settings, and old requests without it still save', async () => {
    const settings = (await get('/api/settings')).json();
    expect(settings.postingAccounts.yearResult).toBe('229');
    const { yearResult: _y, ...old } = settings.postingAccounts;
    const saved = await app.inject({ method: 'PUT', url: '/api/settings', payload: { postingAccounts: old }, headers });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().postingAccounts.yearResult).toBe('229');
    const wrong = await app.inject({ method: 'PUT', url: '/api/settings', payload: { postingAccounts: { ...old, yearResult: '42' } }, headers });
    expect(wrong.statusCode).toBe(400);
  });
});
