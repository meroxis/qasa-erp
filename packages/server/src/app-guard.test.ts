import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp, hostNameOf, requestRefusal } from './app.ts';
import { readSetting } from './settings.ts';

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

const voucher = {
  kind: 'receipt', date: '2026-10-01', cashAccountCode: '1811', description: 'Receipt', currency: 'IQD', rateX100: 100,
  items: [{ accountCode: '1612', amount: 1_000 }]
};

describe('a page of another site, with sign-in off (the server run from the source code)', () => {
  it('can\'t change anything: a cross-site post with no body (no preflight) is refused before any route runs', async () => {
    const closeYear = await app.inject({ method: 'POST', url: '/api/year-end/2025/close', headers: { origin: 'https://evil.example', host: '127.0.0.1:4417' } });
    expect(closeYear.statusCode).toBe(403);
    expect(closeYear.json()).toEqual({ error: 'forbidden', details: { reason: 'origin' } });
    const trial = await app.inject({ method: 'POST', url: '/api/plan/trial', headers: { origin: 'null', host: '127.0.0.1:4417' } });
    expect(trial.statusCode).toBe(403);
    expect(readSetting(db, 'trial_started')).toBeUndefined();
  });

  it('can\'t read or change the books through a name pointed at 127.0.0.1 (DNS rebinding)', async () => {
    const rebound = { host: 'rebind.evil.example:4417', origin: 'http://rebind.evil.example:4417' };
    expect((await app.inject({ url: '/api/accounts', headers: rebound })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/vouchers', payload: voucher, headers: rebound })).json()).toMatchObject({ details: { reason: 'host' } });
    expect(db.prepare('SELECT COUNT(*) AS n FROM entries').get()).toEqual({ n: 0 });
  });

  it('still answers the app itself, on this PC\'s own names, and programs that send no Origin', async () => {
    for (const host of ['127.0.0.1:4417', 'localhost:5173', '[::1]:4417']) {
      const res = await app.inject({ method: 'POST', url: '/api/vouchers', payload: voucher, headers: { host, origin: `http://${host}` } });
      expect(res.statusCode, `${host} ${res.body}`).toBe(201);
    }
    expect((await app.inject({ method: 'POST', url: '/api/vouchers', payload: voucher })).statusCode).toBe(201);
  });
});

describe('the rule itself', () => {
  it('reads host names with and without ports, IPv6 too', () => {
    expect(hostNameOf('LocalHost:80')).toBe('localhost');
    expect(hostNameOf('[::1]:4417')).toBe('[::1]');
    expect(hostNameOf('127.0.0.1')).toBe('127.0.0.1');
  });

  it('on the office network (https) any name is answered, but another site still changes nothing', () => {
    const lan = { host: '192.168.1.20:47420' };
    expect(requestRefusal({ method: 'GET', headers: lan }, true)).toBeNull();
    expect(requestRefusal({ method: 'POST', headers: { ...lan, origin: 'https://192.168.1.20:47420' } }, true)).toBeNull();
    expect(requestRefusal({ method: 'POST', headers: { ...lan, origin: 'https://evil.example' } }, true)).toBe('origin');
    expect(requestRefusal({ method: 'GET', headers: lan }, false)).toBe('host');
    expect(requestRefusal({ method: 'GET', headers: lan }, false, new Set(['192.168.1.20']))).toBeNull();
  });
});
