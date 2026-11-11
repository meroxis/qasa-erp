import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { addDays, PLANS, resolvePlan, todayIso, type LicenseInfo } from '@qasa/core';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { listUsers, login } from './auth.ts';
import { activateLicense, planStatus, readLicenseKey, setLicensePublicKeyForTests } from './license.ts';

let privateKey: KeyObject;
let publicX: string;
let db: Db;
let app: FastifyInstance;

beforeAll(() => {
  const pair = generateKeyPairSync('ed25519');
  privateKey = pair.privateKey;
  publicX = pair.publicKey.export({ format: 'jwk' }).x!;
  setLicensePublicKeyForTests(publicX);
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

const pro = (extra: object = {}) => ({ v: 1, id: 'QL-2026-0001', plan: 'pro', to: 'Bazaar Trading Company', issued: '2026-09-27', expires: '2027-09-26', ...extra });
const headers = { 'x-qasa-user': encodeURIComponent('Mer') };
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
    expect(started).toMatchObject({ plan: 'business', source: 'trial', trialActive: true, trialAvailable: false, trialEnds: addDays(todayIso(), 29) });
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
      license: { id: 'QL-2026-0001', licensee: 'Bazaar Trading Company', state: 'active', users: 12 },
      limits: { users: 12, companies: 3, warehouses: null }
    });
    const audit = (await app.inject('/api/audit')).json();
    expect(audit[0]).toMatchObject({ action: 'activate', entity: 'license', entityId: 'QL-2026-0001' });
  });

  it('accepts a key broken over several lines by a chat app', () => {
    const key = makeKey(pro());
    const wrapped = key.match(/.{1,40}/g)!.join('\n  ');
    expect(readLicenseKey(wrapped)?.licensee).toBe('Bazaar Trading Company');
  });

  it('accepts keys from each trusted signer (the offline tool and the customer portal)', () => {
    const offline = generateKeyPairSync('ed25519');
    const portal = generateKeyPairSync('ed25519');
    const x = (pair: typeof offline) => pair.publicKey.export({ format: 'jwk' }).x!;
    setLicensePublicKeyForTests(x(offline), x(portal));
    try {
      expect(readLicenseKey(makeKey(pro(), offline.privateKey))?.id).toBe('QL-2026-0001');
      expect(readLicenseKey(makeKey(pro({ id: 'QP-2026-0001' }), portal.privateKey))?.id).toBe('QP-2026-0001');
      expect(readLicenseKey(makeKey(pro({ id: 'QP-2026-0002' }), privateKey))).toBeNull();
    } finally {
      setLicensePublicKeyForTests(publicX);
    }
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

describe('the Starter plan', () => {
  const starter = (extra: object = {}) => pro({ id: 'QL-2026-0002', plan: 'starter', ...extra });
  const addUser = (username: string, name: string) => post('/api/users', { username, name, roles: ['checker'] });

  it('runs a Starter key on Starter: 2 users, 1 company, every Pro feature except Qasa Relay and the cloud backup', async () => {
    const res = await post('/api/plan/license', { key: makeKey(starter()) });
    expect(res.statusCode).toBe(200);
    const status = res.json();
    expect(status).toMatchObject({
      plan: 'starter', source: 'license', license: { id: 'QL-2026-0002', plan: 'starter', state: 'active' },
      limits: { users: 2, companies: 1, warehouses: null }
    });
    expect([...status.features].sort()).toEqual([...PLANS.starter.features].sort());
    for (const f of ['relay', 'cloudBackup', 'branches', 'databaseServer', 'realEstate', 'onlineEdition']) expect(status.features).not.toContain(f);
    for (const f of ['officeNetwork', 'autoBackup', 'roles', 'installments', 'payroll', 'noBranding']) expect(status.features).toContain(f);
    // more than one warehouse, as on Pro
    expect((await addWarehouse('W2')).statusCode).toBe(201);
  });

  it('allows a second user and refuses a third, naming the plan', async () => {
    await post('/api/plan/license', { key: makeKey(starter()) });
    expect((await addUser('las', 'Las')).statusCode).toBe(201);
    const third = await addUser('raz', 'Raz');
    expect(third.statusCode).toBe(409);
    expect(third.json()).toMatchObject({ error: 'plan_limit', details: { limit: 'users', max: 2, plan: 'starter' } });
  });

  it('never becomes Pro by editing the key: the signature covers the plan and the user count', async () => {
    const genuine = makeKey(starter());
    const [prefix, , signature] = genuine.split('.');
    for (const change of [{ plan: 'pro' }, { plan: 'business' }, { users: 50 }, { companies: 9 }]) {
      const edited = `${prefix}.${Buffer.from(JSON.stringify(starter(change))).toString('base64url')}.${signature}`;
      expect((await post('/api/plan/license', { key: edited })).json().error).toBe('license_invalid');
    }
    // plan names are exact: no other spelling is a plan
    for (const plan of ['Starter', 'STARTER', 'starter ', 'starter-pro', 'free', '']) {
      expect(readLicenseKey(makeKey(starter({ plan }))), plan).toBeNull();
    }
    expect(planStatus(db).plan).toBe('free');
  });

  it('after a free month with more users, lets only two sign in on Starter: the admin and the earliest made', async () => {
    await post('/api/plan/trial');
    const ownerId = (await app.inject({ url: '/api/users', headers })).json()[0].id as string;
    await post(`/api/users/${ownerId}/password`, { password: 'owner-pass-1' });
    for (const [username, name] of [['las', 'Las'], ['raz', 'Raz'], ['mer', 'Mer']] as const) {
      expect((await post('/api/users', { username, name, roles: ['checker'], password: `${username}-pass-1` })).statusCode).toBe(201);
    }
    await app.inject({ method: 'PUT', url: '/api/auth/signin', payload: { on: true }, headers });
    activateLicense(db, makeKey(starter()), 'Mer');
    expect(planStatus(db)).toMatchObject({ plan: 'starter', limits: { users: 2 } });
    expect((await login(db, 'las', 'las-pass-1')).actor.username).toBe('las');
    for (const name of ['raz', 'mer']) {
      await expect(login(db, name, `${name}-pass-1`), name).rejects.toMatchObject({ status: 403, code: 'plan_user_limit', details: { limit: 'users', max: 2, plan: 'starter' } });
    }
    expect(listUsers(db).filter((u) => u.overLimit).map((u) => u.username).sort()).toEqual(['mer', 'raz']);
    // Pro's five have room for all four
    activateLicense(db, makeKey(pro()), 'Mer');
    expect((await login(db, 'raz', 'raz-pass-1')).actor.username).toBe('raz');
    expect(listUsers(db).some((u) => u.overLimit)).toBe(false);
  });

  it('keeps Starter through the grace days, then returns to Free', () => {
    activateLicense(db, makeKey(starter({ expires: '2026-12-31' })), 'Mer', '2026-10-01');
    expect(planStatus(db, '2027-01-14')).toMatchObject({ plan: 'starter', licenseState: 'grace' });
    expect(planStatus(db, '2027-01-15')).toMatchObject({ plan: 'free', licenseState: 'expired', features: [] });
  });
});
