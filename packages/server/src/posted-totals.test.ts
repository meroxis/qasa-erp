import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { accountStatement, finalAccounts, rollupBalances, todayIso, trialBalance } from '@qasa/core';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { writeSetting } from './settings.ts';
import { postedLines, postedTotals } from './journal.ts';
import { loadAccounts } from './accounts.ts';

/**
 * The trial balance, the final accounts and the chart's balances add posted lines up. 2.0.0 reads them summed per
 * account and part of the period (postedTotals) instead of one by one (bench/big-company.ts: seconds on a big
 * company): every report must come out exactly as from the lines one by one, closed and reopened years included.
 */
let db: Db;
let app: FastifyInstance;
const Y = Number(todayIso().slice(0, 4));
const LAST = Y - 1;
const BEFORE = Y - 2;
const headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  writeSetting(db, 'trial_started', todayIso());
});
afterEach(async () => {
  await app.close();
  db.close();
});

async function posted(date: string, lines: { accountCode: string; debit: number; credit: number }[], currency = 'IQD', rateX100 = 100): Promise<string> {
  const created = await post('/api/entries', { date, description: 'Mer books', currency, rateX100, lines });
  expect(created.statusCode, created.body).toBe(201);
  const id = (created.json() as { id: string }).id;
  expect((await post(`/api/entries/${id}/check`)).statusCode).toBe(200);
  expect((await post(`/api/entries/${id}/approve`)).statusCode).toBe(200);
  return id;
}

async function books(): Promise<void> {
  for (const [year, sale, cost] of [[BEFORE, 900_000, 500_000], [LAST, 1_000_000, 600_000], [Y, 400_000, 150_000]] as const) {
    await posted(`${year}-01-01`, [{ accountCode: '1811', debit: 3_000_000, credit: 0 }, { accountCode: '21', debit: 0, credit: 3_000_000 }]);
    await posted(`${year}-03-10`, [{ accountCode: '1811', debit: sale, credit: 0 }, { accountCode: '42', debit: 0, credit: sale }]);
    await posted(`${year}-03-11`, [{ accountCode: '35', debit: cost, credit: 0 }, { accountCode: '1811', debit: 0, credit: cost }]);
    await posted(`${year}-06-30`, [{ accountCode: '1811', debit: 250, credit: 0 }, { accountCode: '42', debit: 0, credit: 250 }]);
    // a dollar entry (its own currency kept beside the dinar amounts)
    await posted(`${year}-07-15`, [{ accountCode: '1811', debit: 10_000, credit: 0 }, { accountCode: '21', debit: 0, credit: 10_000 }], 'USD', 142_000);
  }
  // a closed year, a closed year that was reopened and closed again (closing, its reversal, closing again)
  expect((await post(`/api/year-end/${BEFORE}/close`)).statusCode).toBe(200);
  expect((await post(`/api/year-end/${LAST}/close`)).statusCode).toBe(200);
  expect((await post(`/api/year-end/${LAST}/reopen`)).statusCode).toBe(200);
  expect((await post(`/api/year-end/${LAST}/close`)).statusCode).toBe(200);
}

const RANGES: { from?: string; to?: string }[] = [
  {}, { to: `${LAST}-12-31` }, { from: `${LAST}-01-01` }, { from: `${LAST}-01-01`, to: `${LAST}-12-31` }, { from: `${LAST}-03-11`, to: `${LAST}-03-11` },
  { from: `${LAST}-06-30`, to: `${Y}-03-10` }, { from: `${Y}-01-01`, to: `${Y}-12-31` }, { from: `${BEFORE}-12-31`, to: `${BEFORE}-12-31` }, { to: `${BEFORE}-01-01` }
];

describe('the summed posted lines', () => {
  it('give the trial balance and the final accounts of every period exactly as the lines one by one', async () => {
    await books();
    expect(postedLines(db).some((l) => l.closing)).toBe(true);
    for (const range of RANGES) {
      const lines = postedLines(db, range.to ? { to: range.to } : {});
      const totals = postedTotals(db, range);
      expect(totals.length, JSON.stringify(range)).toBeLessThanOrEqual(lines.length);
      expect(trialBalance(totals, range), JSON.stringify(range)).toEqual(trialBalance(lines, range));
      if (range.from && range.to) {
        expect(finalAccounts(totals, { from: range.from, to: range.to }), JSON.stringify(range)).toEqual(finalAccounts(lines, { from: range.from, to: range.to }));
      }
    }
  });

  it('give the chart of accounts its balances exactly as the lines one by one', async () => {
    await books();
    const accounts = loadAccounts(db);
    expect(rollupBalances(accounts, postedTotals(db))).toEqual(rollupBalances(accounts, postedLines(db)));
    const res = await app.inject({ method: 'GET', url: '/api/accounts', headers });
    const balance = (code: string) => (res.json() as { code: string; balance: number }[]).find((a) => a.code === code)!.balance;
    expect(balance('1811')).toBe(rollupBalances(accounts, postedLines(db)).get('1811'));
  });

  it('a statement reads its account and sub-accounts (and its currency) only, with the same rows as from every line', async () => {
    await books();
    for (const code of ['1811', '18', '1', '42', '21', '35']) {
      for (const range of RANGES) {
        expect(accountStatement(code, postedLines(db, { account: code }), range), `${code} ${JSON.stringify(range)}`).toEqual(accountStatement(code, postedLines(db), range));
      }
      const dollars = postedLines(db).filter((l) => l.currency === 'USD');
      expect(postedLines(db, { account: code, currency: 'USD' })).toEqual(dollars.filter((l) => l.accountCode.startsWith(code)));
    }
    // "1" must not take an account starting "1" that is not under it as text: every code under 1 starts with 1
    expect(postedLines(db, { account: '18' }).every((l) => l.accountCode.startsWith('18'))).toBe(true);
  });
});
