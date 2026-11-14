import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { accountNames, IRAQI_UNIFIED_CHART, STARTER_SUB_ACCOUNTS } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';

// A company file that holds no Kurdish name for a standard account (the column is empty) shows the built-in Kurdish
// name for it, as long as the company did not rename the account; nothing stored is rewritten.

let db: Db;
let app: FastifyInstance;
const headers = { 'x-qasa-client': '1', 'x-qasa-user': encodeURIComponent('Mer') };
const account = async (code: string) => ((await app.inject({ url: '/api/accounts', headers })).json() as { code: string; name: { ar: string; en: string; ku: string } }[]).find((a) => a.code === code)!;
const stored = (code: string) => ({ ...db.prepare('SELECT name_ar, name_en, name_ku FROM accounts WHERE code = ?').get(code) });

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});
afterEach(async () => { await app.close(); db.close(); });

describe('the names of a standard account in a language the company file has none in', () => {
  it('fills only what is missing, for a standard code that still carries the chart\'s own names', () => {
    const debtors = IRAQI_UNIFIED_CHART.find((a) => a.code === '16')!.name;
    expect(accountNames('16', { ar: debtors.ar, en: debtors.en, ku: '' })).toEqual(debtors);
    expect(accountNames('16', { ar: debtors.ar, en: '', ku: '' })).toEqual(debtors);
    // every language is there: as kept, whatever it says (an earlier Kurdish wording is the company's data)
    expect(accountNames('16', { ar: debtors.ar, en: debtors.en, ku: 'قەرزاران' })).toEqual({ ar: debtors.ar, en: debtors.en, ku: 'قەرزاران' });
    // renamed by the company: nothing is added beside its own name
    expect(accountNames('16', { ar: 'ذمم الزبائن', en: '', ku: '' })).toEqual({ ar: 'ذمم الزبائن', en: '', ku: '' });
    expect(accountNames('16', { ar: debtors.ar, en: 'Receivables', ku: '' })).toEqual({ ar: debtors.ar, en: 'Receivables', ku: '' });
    // a code that is not the chart's (the company's own sub-account): as kept
    expect(accountNames('18119', { ar: 'قاصة الفرع', en: '', ku: '' })).toEqual({ ar: 'قاصة الفرع', en: '', ku: '' });
    // every built-in account has a Kurdish name to fall back on
    for (const a of [...IRAQI_UNIFIED_CHART, ...STARTER_SUB_ACCOUNTS]) expect(a.name.ku.trim(), a.code).not.toBe('');
  });

  it('is what the chart of accounts, a voucher\'s lines and an invoice\'s safe read, with the stored rows left as they are', async () => {
    // a company file whose Kurdish column is empty for the standard accounts
    db.prepare("UPDATE accounts SET name_ku = ''").run();
    const safe = STARTER_SUB_ACCOUNTS.find((a) => a.code === '1811')!.name;
    expect((await account('1811')).name).toEqual(safe);
    expect((await account('16')).name.ku).toBe(IRAQI_UNIFIED_CHART.find((a) => a.code === '16')!.name.ku);
    expect(stored('1811')).toEqual({ name_ar: safe.ar, name_en: safe.en, name_ku: '' });

    // an account the company renamed keeps its own name alone
    const renamed = await app.inject({ method: 'PATCH', url: '/api/accounts/1612', headers, payload: { name: { ar: 'زبائن الجملة', en: '', ku: '' } } });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect((await account('1612')).name).toEqual({ ar: 'زبائن الجملة', en: '', ku: '' });

    // a voucher's lines name their accounts the same way
    const rent = ((await app.inject({ url: '/api/accounts', headers })).json() as { code: string; postable: boolean }[]).find((a) => a.postable && a.code.startsWith('3'))!.code;
    const voucher = await app.inject({
      method: 'POST', url: '/api/vouchers', headers,
      payload: { kind: 'payment', date: '2026-11-14', cashAccountCode: '1811', description: 'Rent', currency: 'IQD', rateX100: 100, items: [{ accountCode: rent, amount: 50_000 }] }
    });
    expect(voucher.statusCode, voucher.body).toBe(201);
    const line = (voucher.json().lines as { accountCode: string; accountName: { ku: string } }[]).find((l) => l.accountCode === '1811')!;
    expect(line.accountName.ku).toBe(safe.ku);
    expect(stored('1811').name_ku).toBe('');
  });
});
