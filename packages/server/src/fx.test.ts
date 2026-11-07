import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { fxApi } from './fx.ts';

let db: Db;
let app: FastifyInstance;
let customerId: string;
let warehouseId: string;
let serviceId: string;

const headers = { 'x-qasa-client': '1', 'x-qasa-user': encodeURIComponent('Mer') };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const get = (url: string) => app.inject({ url, headers });
const del = (url: string) => app.inject({ method: 'DELETE', url, headers });

const day = (offset: number) => new Date(Date.parse(todayIso() + 'T00:00:00Z') + offset * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  customerId = (await post('/api/parties', { type: 'customer', name: 'Sanos Company' })).json().id;
  serviceId = (await post('/api/items', { code: 'SRV', name: { ar: 'خدمة', en: 'Service', ku: 'خزمەتگوزاری' }, unit: 'service', salePrice: 100_00, saleCurrency: 'USD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function approve(id: string) {
  expect((await post(`/api/entries/${id}/check`)).statusCode).toBe(200);
  expect((await post(`/api/entries/${id}/approve`)).statusCode).toBe(200);
}

/** A USD credit sale of $1,000 at 1,420, and $400 of it collected in dollars at 1,450 into the main safe. */
async function seedDollars() {
  const draft = await post('/api/invoices', {
    kind: 'sale', date: day(-10), partyId: customerId, warehouseId, currency: 'USD', rateX100: 142_000, payment: 'credit', discount: 0,
    lines: [{ itemId: serviceId, qtyMilli: 1000, unitPrice: 1000_00 }]
  });
  expect(draft.statusCode, draft.body).toBe(201);
  expect((await post(`/api/invoices/${draft.json().id}/post`)).statusCode).toBe(200);
  const receipt = await post('/api/vouchers', {
    kind: 'receipt', date: day(-5), cashAccountCode: '1811', description: 'دفعة', currency: 'USD', rateX100: 145_000,
    items: [{ accountCode: '1611', amount: 400_00, partyId: customerId }]
  });
  expect(receipt.statusCode, receipt.body).toBe(201);
  await approve(receipt.json().id);
}

describe('the rate board', () => {
  it('keeps a history, finds the rate for any day, and makes the newest rate the default for new documents', async () => {
    expect((await post('/api/fx/rates', { date: day(-2), rateX100: 146_000, source: 'Kurdistan market' })).statusCode).toBe(201);
    expect((await post('/api/fx/rates', { rateX100: 147_500 })).json()).toMatchObject({ date: todayIso(), rateX100: 147_500 });
    expect((await get('/api/settings')).json().defaultRateX100).toBe(147_500);

    // correcting an older day doesn't move the default
    expect((await post('/api/fx/rates', { date: day(-2), rateX100: 146_250 })).json().rateX100).toBe(146_250);
    expect((await get('/api/settings')).json().defaultRateX100).toBe(147_500);

    expect((await get(`/api/fx/rate?date=${day(-1)}`)).json()).toEqual({ date: day(-2), rateX100: 146_250, source: 'board' });
    expect((await get(`/api/fx/rate?date=${day(-30)}`)).json()).toMatchObject({ date: null, source: 'default' });
    const list = (await get('/api/fx/rates?days=30')).json();
    expect(list.map((r: { date: string }) => r.date)).toEqual([todayIso(), day(-2)]);
    expect(list[1]).toMatchObject({ source: 'Kurdistan market', createdBy: 'Mer' });

    expect((await del(`/api/fx/rates/${day(-2)}`)).statusCode).toBe(204);
    expect((await get('/api/fx/rates')).json()).toHaveLength(1);
  });

  it('refuses a future day or a rate that makes no sense', async () => {
    expect((await post('/api/fx/rates', { date: day(2), rateX100: 146_000 })).json().details).toEqual([{ code: 'fx_date_future', field: 'date' }]);
    expect((await post('/api/fx/rates', { rateX100: 99 })).json().details).toEqual([{ code: 'rate_invalid', field: 'rateX100' }]);
  });
});

describe('revaluing dollar balances', () => {
  it('shows each dollar balance at the rates it was booked at and at the new rate', async () => {
    await seedDollars();
    await post('/api/fx/rates', { rateX100: 150_000 });
    const r = (await get('/api/fx/revaluation')).json();
    expect(r).toMatchObject({ rateX100: 150_000, rateSource: 'board' });
    // customer: $1,000 at 1,420 less $400 at 1,450 = $600 carried at 1,420,000 − 580,000 = 840,000; worth 900,000 now
    const customer = r.rows.find((x: { accountCode: string; partyId: string }) => x.accountCode === '1611' && x.partyId === customerId);
    expect(customer).toMatchObject({ usd: 600_00, carried: 840_000, revalued: 900_000, difference: 60_000, mixed: false, partyName: 'Sanos Company' });
    // the safe: $400 received at 1,450 = 580,000; worth 600,000 now
    const safe = r.rows.find((x: { accountCode: string }) => x.accountCode === '1811');
    expect(safe).toMatchObject({ usd: 400_00, carried: 580_000, revalued: 600_000, difference: 20_000 });
    // sales (42) are not money: never revalued
    expect(r.rows.some((x: { accountCode: string }) => x.accountCode.startsWith('4'))).toBe(false);
    expect(r).toMatchObject({ gains: 80_000, losses: 0, net: 80_000 });
  });

  it('posts a balanced draft entry that follows approval, and the next revaluation starts from it', async () => {
    await seedDollars();
    const posted = await post('/api/fx/revaluation', { date: todayIso(), rateX100: 150_000, lang: 'en' });
    expect(posted.statusCode, posted.body).toBe(201);
    const entry = posted.json();
    expect(entry).toMatchObject({ type: 'journal', status: 'draft', currency: 'IQD' });
    expect(entry.description).toContain('1,500');
    const debit = entry.lines.reduce((s: number, l: { debit: number }) => s + l.debit, 0);
    const credit = entry.lines.reduce((s: number, l: { credit: number }) => s + l.credit, 0);
    expect(debit).toBe(credit);
    expect(entry.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: '1611', debit: 60_000, partyId: customerId }),
      expect.objectContaining({ accountCode: '1811', debit: 20_000 }),
      expect.objectContaining({ accountCode: '49', credit: 80_000 })
    ]));

    // a draft changes nothing yet; once approved, the books carry the new value and nothing is left to revalue
    expect((await get('/api/fx/revaluation?rateX100=150000')).json().net).toBe(80_000);
    await approve(entry.id);
    const after = (await get('/api/fx/revaluation?rateX100=150000')).json();
    expect(after.rows.every((x: { difference: number }) => x.difference === 0)).toBe(true);
    expect((await post('/api/fx/revaluation', { date: todayIso(), rateX100: 150_000 })).json().error).toBe('fx_nothing_to_post');

    // the dollar falls back to 1,400: a loss against the revalued amounts
    const fall = (await get('/api/fx/revaluation?rateX100=140000')).json();
    expect(fall).toMatchObject({ gains: 0, losses: 60_000 + 40_000 });
  });

  it('leaves balances that mix dinars and dollars out of posting, and checks the gain and loss accounts', async () => {
    await seedDollars();
    // a dinar receipt from the same customer: the customer's dollar balance can no longer be revalued on its own
    const dinars = await post('/api/vouchers', {
      kind: 'receipt', date: day(-1), cashAccountCode: '1811', description: 'نقداً', currency: 'IQD', rateX100: 100,
      items: [{ accountCode: '1611', amount: 100_000, partyId: customerId }]
    });
    await approve(dinars.json().id);
    const r = (await get('/api/fx/revaluation?rateX100=150000')).json();
    expect(r.rows.find((x: { accountCode: string }) => x.accountCode === '1611')).toMatchObject({ mixed: true });
    expect(r.gains).toBe(20_000);

    const bad = await post('/api/fx/revaluation', { date: todayIso(), rateX100: 150_000, gainAccount: '39', lossAccount: '4' });
    expect(bad.json().details).toEqual([{ code: 'fx_account_invalid', field: 'gainAccount' }, { code: 'fx_account_invalid', field: 'lossAccount' }]);
  });
});
