import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { writeSetting } from './settings.ts';

// Choosing the account a feature posts to (books review #13): not while the one in use holds a balance (what is paid
// or settled after would come out of an account it never went into), and never a stock account.

let db: Db;
let app: FastifyInstance;
const headers = { 'x-qasa-client': '1', 'x-qasa-user': encodeURIComponent('Mer') };
const call = (method: 'POST' | 'PUT' | 'GET', url: string, body: unknown = {}) => app.inject({ method, url, headers, ...(method === 'GET' ? {} : { payload: body as object }) });
const day = (offset: number) => new Date(Date.parse(todayIso() + 'T00:00:00Z') + offset * 86_400_000).toISOString().slice(0, 10);
const choose = (key: string, accountCode: string) => call('PUT', `/api/feature-accounts/${key}`, { accountCode });

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('choosing a feature account', () => {
  it('is refused while the account in use holds a balance, and allowed once it holds nothing', async () => {
    expect((await call('POST', '/api/accounts', { parentCode: '16', code: '169', name: { ar: 'شيكات', en: 'Cheques in hand', ku: 'چەک' } })).statusCode).toBe(201);
    const customerId = (await call('POST', '/api/parties', { type: 'customer', name: 'Bazaar Trading Company' })).json().id;
    const made = await call('POST', '/api/banking/cheques', { direction: 'received', partyId: customerId, number: 'C-1', bank: 'Rafidain', amount: 2_000_000, currency: 'IQD', rateX100: 100, issueDate: day(-1), dueDate: day(5) });
    expect(made.statusCode, made.body).toBe(201);

    // the cheque is in hand on 162 (its entry waiting counts: it will be approved into 162)
    const refused = await choose('notesReceivable', '169');
    expect(refused.statusCode).toBe(400);
    expect(refused.json().details).toEqual([{ code: 'feature_account_in_use', accountCode: '162' }]);
    // choosing the account already in use changes nothing and is fine
    expect((await choose('notesReceivable', '162')).statusCode).toBe(200);

    const cancelled = await call('POST', `/api/banking/cheques/${made.json().id}/cancel`);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    const done = await choose('notesReceivable', '169');
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().find((v: { key: string }) => v.key === 'notesReceivable')).toMatchObject({ code: '169' });
  });

  it("never takes a warehouse's stock account or the fuel stock (old gold is the feature among the stock accounts)", async () => {
    const warehouse = (db.prepare('SELECT account_code AS code FROM warehouses LIMIT 1').get() as { code: string }).code;
    expect(warehouse.startsWith('13')).toBe(true);
    expect((await choose('oldGold', warehouse)).json().details).toEqual([{ code: 'feature_account_stock', accountCode: warehouse }]);

    expect((await call('POST', '/api/accounts', { parentCode: '137', code: '1377', name: { ar: 'وقود', en: 'Fuel', ku: 'سووتەمەنی' } })).statusCode).toBe(201);
    writeSetting(db, 'fuel_settings', JSON.stringify({ stockAccount: '1377' }));
    expect((await choose('oldGold', '1377')).json().details).toEqual([{ code: 'feature_account_stock', accountCode: '1377' }]);

    expect((await call('POST', '/api/accounts', { parentCode: '137', code: '1376', name: { ar: 'ذهب كسر', en: 'Scrap gold', ku: 'زێڕی کۆن' } })).statusCode).toBe(201);
    expect((await choose('oldGold', '1376')).statusCode).toBe(200);
  });
});
