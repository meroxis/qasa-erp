import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { posShown } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { getSettings, updateSettings } from './settings.ts';

// 1.5.2: whether a company uses the point of sale is a company setting (every PC of it agrees); a company that has
// opened a till shift keeps the till while it follows the business type
let db: Db;
let app: FastifyInstance;
const headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const put = (body: unknown) => app.inject({ method: 'PUT', url: '/api/settings', payload: body as object, headers });
const get = (url: string) => app.inject({ url, headers });

beforeEach(() => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('Use the point of sale', () => {
  it('follows the business type until someone chooses, and no till was used yet', async () => {
    const s = (await get('/api/settings')).json();
    expect(s).toMatchObject({ posUse: 'auto', posUsed: false, businessTypes: null });
    // a company that has not said what it does keeps the till, as every company had it before
    expect(posShown(s)).toBe(true);
    expect(posShown((await put({ businessTypes: ['engineeringWorks'] })).json())).toBe(false);
    expect(posShown((await put({ businessTypes: ['market'] })).json())).toBe(true);
    expect(posShown((await put({ businessTypes: ['realEstate', 'generators'] })).json())).toBe(false);
    expect(posShown((await put({ businessTypes: ['realEstate', 'pharmacy'] })).json())).toBe(true);
  });

  it('keeps the till for a company that has opened a till shift, whatever it does', async () => {
    updateSettings(db, { businessTypes: ['engineeringWorks'] }, 'Mer');
    expect(posShown(getSettings(db))).toBe(false);
    const warehouseId = (await get('/api/warehouses')).json()[0].id;
    const shift = await app.inject({ method: 'POST', url: '/api/pos/shifts', headers, payload: { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 0 } });
    expect(shift.statusCode, shift.body).toBe(201);
    const s = (await get('/api/settings')).json();
    expect(s).toMatchObject({ posUse: 'auto', posUsed: true });
    expect(posShown(s)).toBe(true);
    // the company's own choice still wins: off is off
    expect(posShown((await put({ posUse: 'off' })).json())).toBe(false);
  });

  it('saves on and off for the whole company, and refuses anything else', async () => {
    await put({ businessTypes: ['engineeringWorks'] });
    const on = await put({ posUse: 'on' });
    expect(on.statusCode).toBe(200);
    expect(on.json().posUse).toBe('on');
    expect(posShown(on.json())).toBe(true);
    expect(getSettings(db).posUse).toBe('on');
    await put({ businessTypes: ['market'] });
    expect(posShown((await put({ posUse: 'off' })).json())).toBe(false);
    expect(posShown((await put({ posUse: 'auto' })).json())).toBe(true);
    for (const bad of ['yes', 1, null, '']) expect((await put({ posUse: bad })).statusCode).toBe(400);
    expect(getSettings(db).posUse).toBe('auto');
    // what the company did is not a choice: a patch can't say a till was used
    await put({ posUsed: true });
    expect(getSettings(db).posUsed).toBe(false);
    expect(() => updateSettings(db, { posUse: 'maybe' as never }, 'Mer')).toThrowError(expect.objectContaining({ code: 'validation' }));
  });

  it('reads an unknown stored value (from a newer version) as following the business type', () => {
    db.prepare('INSERT INTO settings ("key", value) VALUES (?, ?)').run('pos_use', 'counter-only');
    expect(getSettings(db).posUse).toBe('auto');
  });
});
