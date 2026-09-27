import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { addDays, resolvePlan, todayIso, type LicenseInfo } from '@qasa/core';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { activateLicense, planStatus, readLicenseKey, setLicensePublicKeyForTests } from './license.ts';

let privateKey: KeyObject;
let db: Db;
let app: FastifyInstance;

beforeAll(() => {
  const pair = generateKeyPairSync('ed25519');
  privateKey = pair.privateKey;
  setLicensePublicKeyForTests(pair.publicKey.export({ format: 'jwk' }).x!);
});

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

/** Signs a key the way the Meroxis licensing tool does. */
function makeKey(payload: object, signer: KeyObject = privateKey): string {
  const body = `QASA1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${body}.${sign(null, Buffer.from(body), signer).toString('base64url')}`;
}

const pro = (extra: object = {}) => ({ v: 1, id: 'QL-2026-0001', plan: 'pro', to: 'Sanos Company', issued: '2026-09-27', expires: '2027-09-26', ...extra });
const headers = { 'x-qasa-user': encodeURIComponent('ديلان رستم') };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const addWarehouse = (code: string) => post('/api/warehouses', { code, name: { ar: code, en: code, ku: code } });

describe('plans', () => {
  it('starts on Free: one warehouse, invoices carry the attribution', async () => {
    const plan = (await app.inject('/api/plan')).json();
    expect(plan).toMatchObject({ plan: 'free', source: 'free', license: null, trialAvailable: true, limits: { companies: 1, users: 1, warehouses: 1 }, features: [] });
    const res = await addWarehouse('ERBIL');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'plan_limit', details: { limit: 'warehouses', max: 1, plan: 'free' } });
  });

  it('gives a 30-day Pro trial once, then falls back to Free without touching the data', async () => {
    const started = (await post('/api/plan/trial')).json();
    expect(started).toMatchObject({ plan: 'pro', source: 'trial', trialActive: true, trialAvailable: false, trialEnds: addDays(todayIso(), 29) });
    expect(started.features).toContain('noBranding');
    expect((await addWarehouse('ERBIL')).statusCode).toBe(201);
    expect((await post('/api/plan/trial')).json().error).toBe('trial_unavailable');

    const after = planStatus(db, addDays(todayIso(), 30));
    expect(after).toMatchObject({ plan: 'free', source: 'free', trialActive: false, usage: { warehouses: 2 } });
    // the warehouse made during the trial stays; only adding more is limited
    expect((await app.inject('/api/warehouses')).json()).toHaveLength(2);
  });

  it('activates a genuine key, with its own user count, and records it in the audit log', async () => {
    const res = await post('/api/plan/license', { key: makeKey(pro({ users: 12 })) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      plan: 'pro', source: 'license', trialAvailable: false,
      license: { id: 'QL-2026-0001', licensee: 'Sanos Company', state: 'active', users: 12 },
      limits: { users: 12, companies: 3, warehouses: null }
    });
    const audit = (await app.inject('/api/audit')).json();
    expect(audit[0]).toMatchObject({ action: 'activate', entity: 'license', entityId: 'QL-2026-0001' });
  });

  it('accepts a key broken over several lines by a chat app', () => {
    const key = makeKey(pro());
    const wrapped = key.match(/.{1,40}/g)!.join('\n  ');
    expect(readLicenseKey(wrapped)?.licensee).toBe('Sanos Company');
  });

  it('refuses forged, edited and made-up keys', async () => {
    const other = generateKeyPairSync('ed25519').privateKey;
    const genuine = makeKey(pro());
    const [prefix, , signature] = genuine.split('.');
    const edited = `${prefix}.${Buffer.from(JSON.stringify(pro({ plan: 'business', users: 999 }))).toString('base64url')}.${signature}`;
    for (const key of [makeKey(pro(), other), edited, 'QASA1.abc.def', 'hello', makeKey({ ...pro(), plan: 'enterprise' })]) {
      const res = await post('/api/plan/license', { key });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('license_invalid');
    }
    expect(planStatus(db).plan).toBe('free');
  });

  it('keeps a license working through the grace period, then returns to Free', () => {
    activateLicense(db, makeKey(pro({ expires: '2026-12-31' })), 'Admin', '2026-10-01');
    expect(planStatus(db, '2026-12-31')).toMatchObject({ plan: 'pro', licenseState: 'active' });
    expect(planStatus(db, '2027-01-14')).toMatchObject({ plan: 'pro', licenseState: 'grace', graceEnds: '2027-01-14' });
    expect(planStatus(db, '2027-01-15')).toMatchObject({ plan: 'free', licenseState: 'expired', license: { state: 'expired' } });
  });

  it('refuses a key that has already ended, and removes a license on request', async () => {
    expect(() => activateLicense(db, makeKey(pro({ expires: '2020-01-31' })), 'Admin')).toThrow('license_expired');
    await post('/api/plan/license', { key: makeKey(pro({ plan: 'business', expires: null })) });
    expect(planStatus(db)).toMatchObject({ plan: 'business', limits: { users: null, companies: null } });
    const removed = (await app.inject({ method: 'DELETE', url: '/api/plan/license', headers })).json();
    expect(removed).toMatchObject({ plan: 'free', license: null });
  });

  it('ignores a trial start date in the future (a changed clock or database)', () => {
    const license: LicenseInfo | null = null;
    expect(resolvePlan({ license, trialStarted: '2030-01-01', today: '2026-09-27' })).toMatchObject({ plan: 'free', trialActive: false, trialEnds: null });
  });
});
