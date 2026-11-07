import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { configureLicensing, keyHash, machineId, resetLicensingForTests, settleBackgroundCheck } from './activation.ts';
import { planStatus, setLicensePublicKeyForTests } from './license.ts';
import { deleteSetting, readSetting, writeSetting } from './settings.ts';

const DAY = 86_400_000;
let pair: { privateKey: KeyObject; publicKey: KeyObject };
let db: Db;
let app: FastifyInstance;
let dir: string;
let clock: number;
let guid: string;

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const signed = (prefix: string, payload: object) => {
  const body = `${prefix}.${b64(payload)}`;
  return `${body}.${sign(null, Buffer.from(body), pair.privateKey).toString('base64url')}`;
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const licenceKey = (id = 'QP-2026-0001', expires: string | null = null) =>
  signed('QASA1', { v: 1, id, plan: 'pro', to: 'Mer', issued: iso(clock), expires });

/** A stand-in for my.qasaerp.com: seats per licence, revocation, going offline, a renewed key. */
const portal = {
  online: true,
  max: 2,
  revoked: false,
  seats: new Set<string>(),
  newKey: null as string | null,
  calls: [] as string[]
};

function token(key: string, machine: string) {
  const p = JSON.parse(Buffer.from(key.split('.')[1]!, 'base64url').toString()) as { id: string; plan: string; expires: string | null };
  return signed('QACT1', { v: 1, lic: p.id, key: keyHash(key), machine, plan: p.plan, expires: p.expires, issued: iso(clock), checkBy: addDays(iso(clock), 30) });
}

const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const path = new URL(String(url)).pathname;
  portal.calls.push(path);
  if (!portal.online) throw new TypeError('fetch failed');
  const body = JSON.parse(String(init?.body)) as Record<string, string>;
  const json = (data: object, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (path === '/api/v1/activate') {
    if (portal.revoked) return json({ error: 'revoked' }, 403);
    if (!portal.seats.has(body.machine!) && portal.seats.size >= portal.max) return json({ error: 'seats_full', used: portal.seats.size, max: portal.max }, 409);
    portal.seats.add(body.machine!);
    return json({ token: token(body.key!, body.machine!), used: portal.seats.size, max: portal.max });
  }
  if (path === '/api/v1/check') {
    const p = JSON.parse(Buffer.from(body.token!.split('.')[1]!, 'base64url').toString()) as { machine: string };
    if (portal.revoked) return json({ revoked: true, reason: 'revoked' });
    if (!portal.seats.has(p.machine)) return json({ revoked: true, reason: 'released' });
    const key = portal.newKey ?? readSetting(db, 'license_key')!;
    return json({ token: token(key, p.machine), ...(portal.newKey ? { key: portal.newKey } : {}) });
  }
  if (path === '/api/v1/deactivate') {
    const p = JSON.parse(Buffer.from(body.token!.split('.')[1]!, 'base64url').toString()) as { machine: string };
    portal.seats.delete(p.machine);
    return json({ ok: true });
  }
  return json({ error: 'not_found' }, 404);
}) as typeof fetch;

const headers = { 'x-qasa-client': '1', 'x-qasa-user': 'Mer' };
const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers, payload });

beforeEach(() => {
  pair = generateKeyPairSync('ed25519');
  setLicensePublicKeyForTests(pair.publicKey.export({ format: 'jwk' }).x!);
  clock = Date.parse('2026-11-07T10:00:00Z');
  guid = '6f1c1b6e-3a59-4c1f-9d7e-0b2f4c9a1e11';
  dir = mkdtempSync(join(tmpdir(), 'qasa-activation-'));
  Object.assign(portal, { online: true, max: 2, revoked: false, seats: new Set(), newKey: null, calls: [] });
  configureLicensing({ strict: true, dataDir: dir, portalUrl: 'https://portal.test', machineGuid: () => guid, now: () => clock, fetch: fakeFetch });
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await settleBackgroundCheck();
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  resetLicensingForTests();
});

async function enterAndActivate(key = licenceKey()) {
  expect((await post('/api/plan/license', { key })).statusCode).toBe(200);
  const res = await post('/api/plan/activate');
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

describe('online activation (the official app)', () => {
  it('a key alone is not enough: Free until it is activated online on this PC, then Pro', async () => {
    const entered = (await post('/api/plan/license', { key: licenceKey() })).json();
    expect(entered).toMatchObject({ plan: 'free', activation: { required: true, state: 'needs_activation' } });
    expect(entered.license.id).toBe('QP-2026-0001');
    const done = await enterAndActivate();
    expect(done).toMatchObject({ plan: 'pro', source: 'license', activation: { state: 'active', checkBy: '2026-12-07', offlineUntil: '2026-12-21' } });
    expect(portal.seats.has(machineId(db))).toBe(true);
    expect(machineId(db)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('the company file copied to another PC goes back to Free there until activated again', async () => {
    await enterAndActivate();
    guid = '0a0a0a0a-1111-2222-3333-444444444444';
    configureLicensing({ machineGuid: () => guid });
    expect(planStatus(db)).toMatchObject({ plan: 'free', activation: { state: 'needs_activation' } });
  });

  it('a token for another key, or edited in the company file, does not count', async () => {
    await enterAndActivate();
    const tokenText = readSetting(db, 'activation_token')!;
    const [prefix, payload, sig] = tokenText.split('.');
    const edited = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    edited.checkBy = '2099-01-01';
    writeSetting(db, 'activation_token', `${prefix}.${b64(edited)}.${sig}`);
    expect(planStatus(db)).toMatchObject({ plan: 'free', activation: { state: 'needs_activation' } });
  });

  it('works offline until the check-by date plus the grace days, then asks for the internet', async () => {
    await enterAndActivate();
    portal.online = false;
    clock += 40 * DAY;
    expect(planStatus(db)).toMatchObject({ plan: 'pro', activation: { state: 'active' } });
    clock += 10 * DAY;
    expect(planStatus(db)).toMatchObject({ plan: 'free', activation: { state: 'stale' } });
    await settleBackgroundCheck();
    portal.online = true;
    const res = await post('/api/plan/check');
    expect(res.json()).toMatchObject({ plan: 'pro', activation: { state: 'active' } });
  });

  it('checks in by itself every few days while online, and takes a renewed key along', async () => {
    await enterAndActivate();
    const renewed = licenceKey('QP-2026-0001', '2027-12-31');
    portal.newKey = renewed;
    clock += 4 * DAY;
    planStatus(db);
    await settleBackgroundCheck();
    expect(portal.calls.filter((c) => c === '/api/v1/check')).toHaveLength(1);
    expect(readSetting(db, 'license_key')).toBe(renewed);
    expect(planStatus(db)).toMatchObject({ plan: 'pro', license: { expires: '2027-12-31' }, activation: { state: 'active' } });
  });

  it('a freed seat or a revoked licence goes back to Free with the reason', async () => {
    await enterAndActivate();
    portal.seats.clear();
    expect((await post('/api/plan/check')).json()).toMatchObject({ plan: 'free', activation: { state: 'revoked', revokedReason: 'released' } });
    portal.revoked = true;
    const again = await post('/api/plan/activate');
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toBe('activation_revoked');
  });

  it('refuses a third PC when the licence allows two', async () => {
    portal.seats = new Set(['a'.repeat(32), 'b'.repeat(32)]);
    await post('/api/plan/license', { key: licenceKey() });
    const res = await post('/api/plan/activate');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'activation_seats_full', details: { used: 2, max: 2 } });
  });

  it('says so plainly when the PC has no internet to activate', async () => {
    portal.online = false;
    await post('/api/plan/license', { key: licenceKey() });
    const res = await post('/api/plan/activate');
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('activation_offline');
  });

  it('moving to another PC gives the seat back', async () => {
    await enterAndActivate();
    const res = await post('/api/plan/deactivate');
    expect(res.json()).toMatchObject({ plan: 'free', license: null });
    expect(portal.seats.size).toBe(0);
  });

  it('a clock turned back stops the licence until the next check-in', async () => {
    await enterAndActivate();
    clock += 5 * DAY;
    planStatus(db);
    await settleBackgroundCheck();
    portal.online = false;
    clock -= 4 * DAY;
    expect(planStatus(db)).toMatchObject({ plan: 'free', activation: { state: 'clock' } });
  });
});

describe('the free trial in the official app', () => {
  it('cannot be started again on the same PC, even with the company file reset or a new company', async () => {
    expect((await post('/api/plan/trial')).statusCode).toBe(200);
    expect(planStatus(db)).toMatchObject({ plan: 'business', source: 'trial' });
    deleteSetting(db, 'trial_started');
    deleteSetting(db, 'trial_seal');
    expect(planStatus(db)).toMatchObject({ plan: 'business', source: 'trial', trialAvailable: false });
    expect((await post('/api/plan/trial')).statusCode).toBe(409);
    const other = openDatabase(':memory:');
    try {
      expect(planStatus(other).trialAvailable).toBe(false);
    } finally {
      other.close();
    }
  });

  it('a start date moved forward in the company file does not make the trial longer', async () => {
    await post('/api/plan/trial');
    writeSetting(db, 'trial_started', iso(clock + 20 * DAY));
    clock += 25 * DAY;
    expect(planStatus(db).plan).toBe('business');
    clock += 10 * DAY;
    expect(planStatus(db)).toMatchObject({ plan: 'free', trialActive: false });
  });

  it('turning the clock back does not bring an ended trial back', async () => {
    await post('/api/plan/trial');
    clock += 40 * DAY;
    expect(planStatus(db).plan).toBe('free');
    clock -= 20 * DAY;
    expect(planStatus(db).plan).toBe('free');
  });
});

describe('without strict mode (tests, the demo, development builds)', () => {
  it('a key counts as soon as it is entered, as before', async () => {
    configureLicensing({ strict: false });
    const res = await post('/api/plan/license', { key: licenceKey() });
    expect(res.json()).toMatchObject({ plan: 'pro', source: 'license', activation: { required: false, state: 'needs_activation' } });
  });
});

describe('official builds check every licence in the Rust module too', () => {
  it('a key signed with a key the Rust module does not hold counts for nothing, as does a build without the module', async () => {
    // the test key pair is known to license.ts (setLicensePublicKeyForTests) but not embedded in the native module
    configureLicensing({ strict: false, requireNative: true });
    const res = await post('/api/plan/license', { key: licenceKey() });
    expect(res.statusCode).toBe(400);
    configureLicensing({ requireNative: false });
  });
});
