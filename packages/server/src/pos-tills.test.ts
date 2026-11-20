import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { setLicensePublicKeyForTests } from './license.ts';
import { resetLoginThrottle } from './auth.ts';
import { dayClose } from './day-close.ts';

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let teaId: string;
let starterKey: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const put = (url: string, body: unknown = {}) => app.inject({ method: 'PUT', url, payload: body as object, headers });
const get = (url: string) => app.inject({ url, headers });

beforeAll(() => {
  const pair = generateKeyPairSync('ed25519');
  setLicensePublicKeyForTests(pair.publicKey.export({ format: 'jwk' }).x!);
  const body = `QASA1.${Buffer.from(JSON.stringify({ v: 1, id: 'QL-TEST-starter', plan: 'starter', to: 'Test Company', issued: '2026-01-01', expires: null })).toString('base64url')}`;
  starterKey = `${body}.${sign(null, Buffer.from(body), pair.privateKey).toString('base64url')}`;
});

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  teaId = (await post('/api/items', { code: 'TEA', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'service', salePrice: 25_000, saleCurrency: 'IQD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

const till = (name: string, extra: object = {}) => post('/api/pos/tills', { name, cashAccountCode: '1811', warehouseId, ...extra });

describe('tills', () => {
  it('has one till on every plan; a second needs the plan', async () => {
    const first = await till('Till 1', { drawer: 'cash', customerDisplay: true });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({ name: 'Till 1', drawer: 'cash', customerDisplay: true, active: true, openShiftId: null });
    expect((await till('till 1')).json()).toMatchObject({ error: 'till_name_taken' });
    const second = await till('Till 2');
    expect(second.json()).toMatchObject({ error: 'plan_limit', details: { limit: 'multiTill' } });
    // an inactive one is kept without the plan
    expect((await till('Spare', { active: false })).statusCode).toBe(201);
    expect((await post('/api/plan/license', { key: starterKey })).statusCode).toBe(200);
    expect((await till('Till 2')).statusCode).toBe(201);
    const list = (await get('/api/pos/tills')).json();
    expect(list.multiTill).toBe(true);
    expect(list.tills.map((t: { name: string }) => t.name)).toEqual(['Till 1', 'Till 2', 'Spare']);
    expect((await till('Bad', { cashAccountCode: '1611' })).statusCode).toBe(400);
  });

  it('opens a shift on a till with its name, safe and warehouse, one at a time, and finds it by till', async () => {
    const t = (await till('Front')).json();
    const shift = await post('/api/pos/shifts', { tillId: t.id, register: 'ignored', cashAccountCode: '18', warehouseId, openingCash: 10_000 });
    expect(shift.statusCode, shift.body).toBe(201);
    expect(shift.json()).toMatchObject({ register: 'Front', cashAccountCode: '1811', tillId: t.id });
    expect((await post('/api/pos/shifts', { tillId: t.id, register: 'x', cashAccountCode: '1811', warehouseId, openingCash: 0 })).json()).toMatchObject({ error: 'pos_register_open' });
    expect((await get(`/api/pos/current?tillId=${t.id}`)).json().shift.id).toBe(shift.json().id);
    expect((await get('/api/pos/current?tillId=other')).json().shift).toBeNull();
    // the till's name, safe and warehouse can't change while its shift is open; the drawer setting can
    expect((await put(`/api/pos/tills/${t.id}`, { name: 'Front door', cashAccountCode: '1811', warehouseId })).json()).toMatchObject({ error: 'till_has_open_shift' });
    expect((await put(`/api/pos/tills/${t.id}`, { name: 'Front', cashAccountCode: '1811', warehouseId, drawer: 'cash' })).json()).toMatchObject({ drawer: 'cash', openShiftId: shift.json().id });
    expect((await post('/api/pos/shifts', { tillId: 'nope', register: 'x', cashAccountCode: '1811', warehouseId, openingCash: 0 })).json()).toMatchObject({ error: 'validation' });
  });

  it('takes dollar notes on a dinar sale: the books in dinars, the drawer expects the dollars instead', async () => {
    const shift = (await post('/api/pos/shifts', { register: 'C1', cashAccountCode: '1811', warehouseId, openingCash: 50_000 })).json();
    const sale = await post(`/api/pos/shifts/${shift.id}/sales`, {
      currency: 'IQD', discount: 0, lines: [{ itemId: teaId, qtyMilli: 1000, unitPrice: 25_000 }],
      // $20 at 1,420 = 28,400 dinars for 25,000: 3,400 change in dinars
      usdCash: { amount: 2000, rateX100: 142_000 }
    });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json().invoice).toMatchObject({ total: 25_000, currency: 'IQD' });
    expect(sale.json().shift).toMatchObject({ usdTaken: { usd: 2000, iqd: 28_400 }, expected: { IQD: 50_000 + 25_000 - 28_400, USD: 2000 } });
    const safe = db.prepare("SELECT SUM(base_debit) - SUM(base_credit) AS v FROM entry_lines WHERE account_code = '1811'").get() as { v: number };
    expect(Number(safe.v)).toBe(25_000);
    // a rate far from the company's, a dollar sale, or far more dollars than due are refused
    const bad = (usdCash: object, extra: object = {}) => post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: teaId, qtyMilli: 1000, unitPrice: 25_000 }], usdCash, ...extra });
    expect((await bad({ amount: 2000, rateX100: 14_200 })).json().details[0].code).toBe('pos_usd_rate_far');
    expect((await bad({ amount: 20000, rateX100: 142_000 })).json().details[0].code).toBe('pos_usd_cash_too_much');
    expect((await bad({ amount: 2000, rateX100: 142_000 }, { currency: 'USD', rateX100: 142_000, lines: [{ itemId: teaId, qtyMilli: 1000, unitPrice: 1_760 }] })).json().details[0].code).toBe('pos_usd_cash_not_here');
    // closing: the dollars are counted as dollars
    const closed = await post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 46_600, countedUsd: 2000 });
    expect(closed.json()).toMatchObject({ difference: { IQD: 0, USD: 0 } });
    // the day close reads the same drawer
    expect(dayClose(db, todayIso()).registers[0]).toMatchObject({ expected: { IQD: 46_600, USD: 2000 } });
  });

  it('records the drawer opened with no sale, by whoever runs the shift, and sums tills', async () => {
    const t = (await till('Front')).json();
    const shift = (await post('/api/pos/shifts', { tillId: t.id, register: '', cashAccountCode: '1811', warehouseId, openingCash: 0 })).json();
    expect((await post(`/api/pos/shifts/${shift.id}/drawer`, { reason: 'change for a customer' })).json()).toEqual({ opened: 1 });
    expect((await post(`/api/pos/shifts/${shift.id}/drawer`, {})).json()).toEqual({ opened: 2 });
    await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: teaId, qtyMilli: 1000, unitPrice: 25_000 }] });
    await post('/api/pos/shifts', { register: 'Back', cashAccountCode: '1811', warehouseId, openingCash: 0 });
    const summary = (await get('/api/pos/tills/summary')).json();
    expect(summary.rows).toEqual([
      expect.objectContaining({ register: 'Back', tillId: null, shifts: 1, count: 0 }),
      expect.objectContaining({ register: 'Front', tillId: t.id, shifts: 1, count: 1, sales: { IQD: 25_000, USD: 0 }, noSale: 2, methods: { cash: 25_000 } })
    ]);
    await post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 25_000 });
    expect((await post(`/api/pos/shifts/${shift.id}/drawer`, {})).json()).toMatchObject({ error: 'pos_shift_closed' });
  });

  it('keeps the scale prefixes whose labels carry a price', async () => {
    expect((await get('/api/pos/scale')).json()).toEqual({ pricePrefixes: [] });
    expect((await put('/api/pos/scale', { pricePrefixes: ['22', '29'] })).json()).toEqual({ pricePrefixes: ['22', '29'] });
    expect((await put('/api/pos/scale', { pricePrefixes: ['2x'] })).statusCode).toBe(400);
    expect((await get('/api/pos/scale')).json()).toEqual({ pricePrefixes: ['22', '29'] });
  });
});
