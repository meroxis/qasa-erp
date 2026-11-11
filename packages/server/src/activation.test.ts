import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import {
  ACTIVATION_GRACE_DAYS, configureLicensing, keyHash, machineId, newTimeNonce, noteFirstStartBeforeCarry, resetLicensingForTests,
  settleBackgroundCheck, signedPortalTime, trustPortalDate
} from './activation.ts';
import { planStatus, setLicensePublicKeyForTests } from './license.ts';
import { deleteSetting, readSetting, writeSetting } from './settings.ts';
import { configureVerifyKeyVault } from './verify.ts';

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
/**
 * What the portal puts in X-Qasa-Time: "<ISO time>.<signature over 'time|<ISO time>|<nonce>'>" with its licence key,
 * the nonce being the one the ping sent.
 */
const signedTime = (ms: number, nonce: string) => {
  const time = new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `${time}.${sign(null, Buffer.from(`time|${time}|${nonce}`), pair.privateKey).toString('base64url')}`;
};
const licenceKey = (id = 'QP-2026-0001', expires: string | null = null) =>
  signed('QASA1', { v: 1, id, plan: 'pro', to: 'Mer', issued: iso(clock), expires });

/** A stand-in for my.qasaerp.com: seats per licence, revocation, going offline, a renewed key. */
const portal = {
  online: true,
  max: 2,
  revoked: false,
  seats: new Set<string>(),
  newKey: null as string | null,
  /** a portal that lost its signing key answers every token with token_invalid */
  noSigningKey: false,
  calls: [] as string[],
  bodies: [] as Record<string, unknown>[]
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
  portal.bodies.push(body);
  const json =(data: object, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (path === '/api/v1/activate') {
    if (portal.revoked) return json({ error: 'revoked' }, 403);
    if (!portal.seats.has(body.machine!) && portal.seats.size >= portal.max) return json({ error: 'seats_full', used: portal.seats.size, max: portal.max }, 409);
    portal.seats.add(body.machine!);
    return json({ token: token(body.key!, body.machine!), used: portal.seats.size, max: portal.max });
  }
  if (path === '/api/v1/check') {
    if (portal.noSigningKey) return json({ error: 'token_invalid' }, 400);
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
  Object.assign(portal, { online: true, max: 2, revoked: false, seats: new Set(), newKey: null, noSigningKey: false, calls: [], bodies: [] });
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

  it('removing the licence gives the seat back too, so the key can move to the new PC', async () => {
    await enterAndActivate();
    expect(portal.seats.size).toBe(1);
    const res = await app.inject({ method: 'DELETE', url: '/api/plan/license', headers });
    expect(res.json()).toMatchObject({ plan: 'free', license: null });
    expect(portal.seats.size).toBe(0);
    expect(readSetting(db, 'activation_token')).toBeUndefined();
  });

  it('removing the licence offline still removes it here (the seat is freed in the portal)', async () => {
    await enterAndActivate();
    portal.online = false;
    const res = await app.inject({ method: 'DELETE', url: '/api/plan/license', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ plan: 'free', license: null });
    expect(readSetting(db, 'activation_token')).toBeUndefined();
  });

  it('a portal that refuses every token for a while does not drop a paying PC to Free', async () => {
    await enterAndActivate();
    portal.noSigningKey = true;
    clock += 4 * DAY;
    expect((await post('/api/plan/check')).json()).toMatchObject({ plan: 'pro', activation: { state: 'active' } });
    expect(readSetting(db, 'activation_token')).toBeTruthy();
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

  it('the invoice QR key never stops an activation or a check-in: without it they go ahead and the next one sends it', async () => {
    // Windows can't protect a new key just now: the QR key can't be made
    configureVerifyKeyVault({ protect: () => { throw new Error('DPAPI failed'); }, reveal: (s) => s });
    try {
      const done = await enterAndActivate();
      expect(done).toMatchObject({ plan: 'pro', activation: { state: 'active' } });
      expect(portal.bodies.at(-1)).not.toHaveProperty('verifyKey');
      clock += 4 * DAY;
      const checked = await post('/api/plan/check');
      expect(checked.statusCode, checked.body).toBe(200);
      expect(portal.calls.at(-1)).toBe('/api/v1/check');
      expect(portal.bodies.at(-1)).not.toHaveProperty('verifyKey');
    } finally {
      configureVerifyKeyVault(null);
    }
    clock += 4 * DAY;
    expect((await post('/api/plan/check')).statusCode).toBe(200);
    expect(portal.bodies.at(-1)!.verifyKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
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

  it('nor in a company without a trial of its own, which counts this PC\'s (Companies → Add)', async () => {
    await post('/api/plan/trial');
    const other = openDatabase(':memory:');
    try {
      expect(planStatus(other)).toMatchObject({ plan: 'business', source: 'trial', trialStarted: '2026-11-07' });
      clock += 40 * DAY;
      expect(planStatus(other).plan).toBe('free');
      clock -= 20 * DAY;
      expect(planStatus(other)).toMatchObject({ plan: 'free', trialStarted: '2000-01-01' });
    } finally {
      other.close();
    }
  });

  it('nor does deleting the latest time seen from the company file after turning the clock back', async () => {
    await post('/api/plan/trial');
    clock += 40 * DAY;
    expect(planStatus(db).plan).toBe('free');
    clock -= 30 * DAY;
    deleteSetting(db, 'clock_high');
    expect(planStatus(db)).toMatchObject({ plan: 'free', trialStarted: '2000-01-01' });
  });

  it('an edited or damaged marker of this PC counts as a trial used, not as a new one', async () => {
    await post('/api/plan/trial');
    const file = join(dir, 'trial-used.json');
    const list = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
    expect(list[machineId(db)]).toMatch(/^2026-11-07\./);
    // a later start date with the old seal
    list[machineId(db)] = list[machineId(db)]!.replace('2026-11-07', '2026-12-20');
    writeFileSync(file, JSON.stringify(list));
    const fresh = openDatabase(':memory:');
    try {
      expect(planStatus(fresh)).toMatchObject({ trialAvailable: false });
      writeFileSync(file, '{not json');
      expect(planStatus(fresh)).toMatchObject({ trialAvailable: false });
    } finally {
      fresh.close();
    }
  });

  it('is kept in a second place too (%LOCALAPPDATA%): deleting one copy, or the app\'s whole folder, gives no new month', async () => {
    const local = mkdtempSync(join(tmpdir(), 'qasa-activation-local-'));
    try {
      configureLicensing({ markerDirs: [local] });
      expect((await post('/api/plan/trial')).statusCode).toBe(200);
      const own = join(dir, 'trial-used.json');
      const copy = join(local, 'trial-used.json');
      const entry = (JSON.parse(readFileSync(own, 'utf8')) as Record<string, string>)[machineId(db)];
      expect(entry).toMatch(/^2026-11-07\./);
      expect((JSON.parse(readFileSync(copy, 'utf8')) as Record<string, string>)[machineId(db)]).toBe(entry);

      // the app's folder deleted (marker and all), and a new company: no new trial, and the marker is back
      rmSync(own);
      const fresh = openDatabase(':memory:');
      try {
        expect(planStatus(fresh)).toMatchObject({ plan: 'business', source: 'trial', trialStarted: '2026-11-07', trialAvailable: false });
        expect((JSON.parse(readFileSync(own, 'utf8')) as Record<string, string>)[machineId(db)]).toBe(entry);
        // the other copy deleted: written again from the first
        rmSync(copy);
        expect(planStatus(fresh).trialAvailable).toBe(false);
        expect((JSON.parse(readFileSync(copy, 'utf8')) as Record<string, string>)[machineId(db)]).toBe(entry);
        // an entry emptied in one copy comes back too
        writeFileSync(copy, '{}');
        expect(planStatus(fresh).trialAvailable).toBe(false);
        expect((JSON.parse(readFileSync(copy, 'utf8')) as Record<string, string>)[machineId(db)]).toBe(entry);
        // a later start in the second copy (with the old seal) or a damaged copy counts as used, never as new
        writeFileSync(copy, JSON.stringify({ [machineId(db)]: entry!.replace('2026-11-07', '2026-12-20') }));
        rmSync(own);
        expect(planStatus(fresh)).toMatchObject({ trialAvailable: false, trialStarted: '2000-01-01', plan: 'free' });
        writeFileSync(copy, '{not json');
        expect(planStatus(fresh)).toMatchObject({ trialAvailable: false, plan: 'free' });
        expect((await app.inject({ method: 'POST', url: '/api/plan/trial', headers, payload: {} })).statusCode).toBe(409);
      } finally {
        fresh.close();
      }
    } finally {
      rmSync(local, { recursive: true, force: true });
    }
  });

  it('a second copy that can\'t be written never stops the trial: the app\'s own folder still records it', async () => {
    const blocked = join(dir, 'not-a-folder');
    writeFileSync(blocked, 'a file where the folder would be');
    configureLicensing({ markerDirs: [blocked] });
    expect((await post('/api/plan/trial')).statusCode).toBe(200);
    expect(planStatus(db)).toMatchObject({ plan: 'business', source: 'trial', trialAvailable: false });
    expect((JSON.parse(readFileSync(join(dir, 'trial-used.json'), 'utf8')) as Record<string, string>)[machineId(db)]).toMatch(/^2026-11-07\./);
  });

  it('an unsealed trial is taken over only when it is from before sealing (0.1.x), not one written by hand', async () => {
    writeSetting(db, 'trial_started', iso(clock - 5 * DAY));
    expect(planStatus(db)).toMatchObject({ plan: 'business', source: 'trial', trialStarted: iso(clock - 5 * DAY) });
    const other = openDatabase(':memory:');
    try {
      rmSync(join(dir, 'trial-used.json'));
      // this company already ran this version (its first start is noted); a start written into it later is by hand
      planStatus(other);
      clock += 2 * DAY;
      writeSetting(other, 'trial_started', iso(clock - DAY));
      expect(planStatus(other)).toMatchObject({ plan: 'free', trialStarted: '2000-01-01' });
    } finally {
      other.close();
    }
  });

  it('a 0.1.x trial still carries over when the update comes late (no fixed calendar date that can pass)', async () => {
    clock = Date.parse('2027-03-01T10:00:00Z');
    writeSetting(db, 'trial_started', '2027-02-20');
    expect(planStatus(db)).toMatchObject({ plan: 'business', source: 'trial', trialStarted: '2027-02-20' });
    // and it stays sealed: the next start reads the same
    expect(planStatus(db)).toMatchObject({ plan: 'business', trialStarted: '2027-02-20' });
  });

  it('a clock set a year ahead for a moment: the portal\'s signed time at the next ping gives the trial back', async () => {
    await post('/api/plan/trial');
    clock += 3 * DAY;
    const real = clock;
    clock += 365 * DAY;
    planStatus(db);
    clock = real;
    expect(planStatus(db)).toMatchObject({ plan: 'free', trialStarted: '2000-01-01' });
    const nonce = newTimeNonce();
    // an unsigned date (the plain Date header a fake local portal could send) changes nothing
    expect(trustPortalDate(db, new Date(real).toUTCString(), nonce)).toBe(false);
    expect(trustPortalDate(db, new Date(real).toISOString(), nonce)).toBe(false);
    // nor a time signed with another key, nor a signed time that disagrees with this PC's clock
    const stranger = generateKeyPairSync('ed25519').privateKey;
    const isoNow = new Date(real).toISOString();
    expect(trustPortalDate(db, `${isoNow}.${sign(null, Buffer.from(`time|${isoNow}|${nonce}`), stranger).toString('base64url')}`, nonce)).toBe(false);
    expect(trustPortalDate(db, signedTime(real + 2 * DAY, nonce), nonce)).toBe(false);
    // nor a genuine answer recorded for an earlier ping (another nonce), played back
    expect(trustPortalDate(db, signedTime(real, newTimeNonce()), nonce)).toBe(false);
    expect(planStatus(db)).toMatchObject({ plan: 'free' });
    expect(trustPortalDate(db, signedTime(real, nonce), nonce)).toBe(true);
    expect(planStatus(db)).toMatchObject({ plan: 'business', source: 'trial', trialStarted: '2026-11-07' });
    writeSetting(db, 'clock_high', `${real + 365 * DAY}.forged`);
    expect(trustPortalDate(db, signedTime(real, nonce), nonce)).toBe(false);
  });

  it('reads the portal\'s signed time in one header or with the signature apart, only for the nonce this PC sent', () => {
    const ms = Date.parse('2026-11-08T09:30:00Z');
    const nonce = newTimeNonce();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(newTimeNonce()).not.toBe(nonce);
    const header = signedTime(ms, nonce);
    expect(signedPortalTime(header, nonce)).toBe(ms);
    const dot = header.lastIndexOf('.');
    expect(signedPortalTime(header.slice(0, dot), nonce, header.slice(dot + 1))).toBe(ms);
    expect(signedPortalTime(header.replace('09:30', '09:31'), nonce)).toBeNull();
    expect(signedPortalTime('2026-11-08T09:30:00Z', nonce)).toBeNull();
    expect(signedPortalTime(null, nonce)).toBeNull();
    // replayed: signed for another request's nonce
    expect(signedPortalTime(header, newTimeNonce())).toBeNull();
    // the old form without a nonce ("time|<iso>") is not taken
    const bare = '2026-11-08T09:30:00Z';
    expect(signedPortalTime(`${bare}.${sign(null, Buffer.from(`time|${bare}`), pair.privateKey).toString('base64url')}`, nonce)).toBeNull();
    // a nonce that is not 16 random bytes in hex is never used (nor an empty one)
    const odd = 'x'.repeat(32);
    expect(signedPortalTime(`${bare}.${sign(null, Buffer.from(`time|${bare}|${odd}`), pair.privateKey).toString('base64url')}`, odd)).toBeNull();
    expect(signedPortalTime(`${bare}.${sign(null, Buffer.from(`time|${bare}|`), pair.privateKey).toString('base64url')}`, '')).toBeNull();
  });
});

describe('a licence from 0.1.8 (entered before activation existed) after the update', () => {
  /** What 0.1.8 left in the company file: the key, no activation token. */
  const fromOldVersion = (key = licenceKey()) => writeSetting(db, 'license_key', key);

  it('keeps counting for 30 days while the PC is offline, then asks for activation (the data stays)', async () => {
    fromOldVersion();
    portal.online = false;
    const first = planStatus(db);
    expect(first).toMatchObject({
      plan: 'pro', source: 'license',
      activation: { state: 'needs_activation', graceUntil: addDays(iso(clock), ACTIVATION_GRACE_DAYS - 1), inGrace: true }
    });
    expect(first.activation.graceUntil).toBe('2026-12-06');
    await settleBackgroundCheck();
    // it tried to activate by itself
    expect(portal.calls).toContain('/api/v1/activate');
    clock += 29 * DAY;
    expect(planStatus(db)).toMatchObject({ plan: 'pro', activation: { inGrace: true } });
    await settleBackgroundCheck();
    clock += DAY;
    expect(planStatus(db)).toMatchObject({ plan: 'free', license: { id: 'QP-2026-0001' }, activation: { state: 'needs_activation', inGrace: false } });
    await settleBackgroundCheck();
    // back online: it activates by itself (also after the grace) and the licence counts again
    portal.online = true;
    clock += 2 * 3_600_000;
    planStatus(db);
    await settleBackgroundCheck();
    expect(planStatus(db)).toMatchObject({ plan: 'pro', activation: { state: 'active', inGrace: false } });
    expect(portal.seats.has(machineId(db))).toBe(true);
  });

  it('online at the first start: activated on this PC by itself, with no step from the customer', async () => {
    fromOldVersion();
    expect(planStatus(db)).toMatchObject({ plan: 'pro', activation: { state: 'needs_activation', inGrace: true } });
    await settleBackgroundCheck();
    expect(readSetting(db, 'activation_token')).toMatch(/^QACT1\./);
    expect(planStatus(db)).toMatchObject({ plan: 'pro', activation: { state: 'active', graceUntil: null } });
    const audit = db.prepare("SELECT user AS who FROM audit_log WHERE action = 'activate'").all() as { who: string }[];
    expect(audit.map((a) => a.who)).toContain('Qasa ERP');
  });

  it('a full licence (seats used elsewhere) still counts during the grace, and tries again at most once an hour', async () => {
    portal.seats = new Set(['a'.repeat(32), 'b'.repeat(32)]);
    fromOldVersion();
    expect(planStatus(db)).toMatchObject({ plan: 'pro', activation: { inGrace: true } });
    await settleBackgroundCheck();
    planStatus(db);
    await settleBackgroundCheck();
    expect(portal.calls.filter((c) => c === '/api/v1/activate')).toHaveLength(1);
  });

  it('a company made later on this PC (it takes the key over) shares the first one\'s days, it does not start new ones', async () => {
    const key = licenceKey();
    fromOldVersion(key);
    portal.online = false;
    planStatus(db);
    await settleBackgroundCheck();
    clock += 20 * DAY;
    const later = openDatabase(':memory:');
    try {
      writeSetting(later, 'license_key', key);
      expect(planStatus(later)).toMatchObject({ plan: 'pro', activation: { graceUntil: '2026-12-06', inGrace: true } });
      await settleBackgroundCheck();
      clock += 10 * DAY;
      expect(planStatus(later)).toMatchObject({ plan: 'free', activation: { inGrace: false } });
      await settleBackgroundCheck();
      // an edited record of this PC gives no grace at all
      const file = join(dir, 'trial-used.json');
      const list = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
      const id = `grace|${machineId(db)}`;
      list[id] = list[id]!.replace('2026-11-07', '2026-12-30');
      writeFileSync(file, JSON.stringify(list));
      expect(planStatus(db)).toMatchObject({ plan: 'free', activation: { graceUntil: null } });
    } finally {
      later.close();
    }
  });

  it('a key entered in this version gets no grace: it counts once activated', async () => {
    portal.online = false;
    const res = await post('/api/plan/license', { key: licenceKey() });
    expect(res.json()).toMatchObject({ plan: 'free', activation: { state: 'needs_activation', graceUntil: null, inGrace: false } });
    // not even when this version had already started before the key was entered
    const other = openDatabase(':memory:');
    try {
      planStatus(other);
      writeSetting(other, 'license_key', licenceKey('QP-2026-0002'));
      expect(planStatus(other)).toMatchObject({ plan: 'free', activation: { graceUntil: null } });
    } finally {
      other.close();
    }
  });

  it('an edited grace start, a clock turned back or a token for another PC gives no grace', async () => {
    fromOldVersion();
    portal.online = false;
    planStatus(db);
    await settleBackgroundCheck();
    const stored = readSetting(db, 'activation_grace_from')!;
    expect(stored).toMatch(/^2026-11-07\|[0-9a-f]{32}\./);
    // the start moved forward with the old seal
    writeSetting(db, 'activation_grace_from', stored.replace('2026-11-07', '2027-06-01'));
    clock += 40 * DAY;
    expect(planStatus(db)).toMatchObject({ plan: 'free', activation: { graceUntil: null, inGrace: false } });
    await settleBackgroundCheck();
    writeSetting(db, 'activation_grace_from', stored);
    expect(planStatus(db)).toMatchObject({ plan: 'free', activation: { graceUntil: '2026-12-06', inGrace: false } });
    await settleBackgroundCheck();
    // turned back into the grace after it ended
    clock -= 20 * DAY;
    expect(planStatus(db)).toMatchObject({ plan: 'free', activation: { graceUntil: '2026-12-06', inGrace: false } });
    await settleBackgroundCheck();
    // a company file activated on another PC (it holds that PC's token) is not a 0.1.8 one
    const copied = openDatabase(':memory:');
    try {
      writeSetting(copied, 'license_key', licenceKey());
      writeSetting(copied, 'activation_token', token(licenceKey(), 'c'.repeat(32)));
      expect(planStatus(copied)).toMatchObject({ plan: 'free', activation: { state: 'needs_activation', graceUntil: null } });
    } finally {
      copied.close();
    }
  });

  it('removing the records starts no new grace: one per PC whatever the key, keys from before 1.0 only, none after its last day', async () => {
    const oldKey = licenceKey(); // issued 2026-11-07, before 1.0
    const otherOldKey = licenceKey('QP-2026-0009');
    fromOldVersion(oldKey);
    portal.online = false;
    expect(planStatus(db)).toMatchObject({ plan: 'pro', activation: { graceUntil: '2026-12-06', inGrace: true } });
    await settleBackgroundCheck();
    clock += 40 * DAY;
    const forget = () => { for (const key of ['activation_grace_from', 'activation_token', 'activation_checked', 'activation_revoked', 'clock_high']) deleteSetting(db, key); };
    // the company's record removed: the PC's own record still holds the first grace's days, for this key or another
    for (const key of [oldKey, otherOldKey]) {
      forget();
      writeSetting(db, 'license_key', key);
      expect(planStatus(db)).toMatchObject({ plan: 'free', activation: { graceUntil: '2026-12-06', inGrace: false } });
      await settleBackgroundCheck();
    }
    // both records removed: a key issued since 1.0 gets none (it is activated online, like every new key)
    rmSync(join(dir, 'trial-used.json'), { force: true });
    forget();
    writeSetting(db, 'license_key', licenceKey('QP-2026-0010'));
    expect(planStatus(db)).toMatchObject({ plan: 'free', activation: { graceUntil: null, inGrace: false } });
    await settleBackgroundCheck();
    // and after the last day a grace could start, not even a key from before 1.0
    clock = Date.parse('2027-02-01T10:00:00Z');
    rmSync(join(dir, 'trial-used.json'), { force: true });
    forget();
    writeSetting(db, 'license_key', oldKey);
    expect(planStatus(db)).toMatchObject({ plan: 'free', activation: { graceUntil: null, inGrace: false } });
  });

  it('a latest time seen that was removed counts as a clock turned back, for an activated licence and in the grace', async () => {
    await enterAndActivate();
    deleteSetting(db, 'clock_high');
    expect(planStatus(db)).toMatchObject({ plan: 'free', activation: { state: 'clock' } });
    await settleBackgroundCheck();
    // the next check-in with the portal sets it right
    expect((await post('/api/plan/check')).json()).toMatchObject({ plan: 'pro', activation: { state: 'active' } });

    const old = openDatabase(':memory:');
    try {
      writeSetting(old, 'license_key', licenceKey('QP-2026-0003'));
      portal.online = false;
      expect(planStatus(old)).toMatchObject({ plan: 'pro', activation: { inGrace: true } });
      await settleBackgroundCheck();
      deleteSetting(old, 'clock_high');
      expect(planStatus(old)).toMatchObject({ plan: 'free', activation: { inGrace: false } });
      await settleBackgroundCheck();
    } finally {
      old.close();
    }
  });
});

describe('a licence key handed to another company on this PC (Companies → Add, or opening one without a key)', () => {
  /** What company-api.ts does: note the other company's first start (unless the key has its grace), then copy the key. */
  const carry = (to: Db) => {
    noteFirstStartBeforeCarry(db, to);
    for (const key of ['license_key', 'activation_token', 'activation_revoked']) {
      const value = readSetting(db, key);
      if (value != null) writeSetting(to, key, value);
    }
  };

  it('a key entered in this version and never activated (seats full, or leaked) gets no grace in the other company', async () => {
    portal.seats = new Set(['a'.repeat(32), 'b'.repeat(32)]);
    const key = licenceKey();
    expect((await post('/api/plan/license', { key })).json()).toMatchObject({ plan: 'free', activation: { graceUntil: null } });
    expect((await post('/api/plan/activate')).statusCode).toBe(409);
    for (const made of [openDatabase(':memory:'), openDatabase(':memory:')]) {
      try {
        carry(made);
        expect(readSetting(made, 'license_key')).toBe(key);
        expect(planStatus(made)).toMatchObject({ plan: 'free', activation: { state: 'needs_activation', graceUntil: null, inGrace: false } });
      } finally {
        made.close();
      }
    }
  });

  it('a 0.1.8 key shares the PC\'s grace days in the other company (no new ones) and is activated there by itself', async () => {
    fromOldKey(licenceKey());
    portal.online = false;
    expect(planStatus(db)).toMatchObject({ plan: 'pro', activation: { graceUntil: '2026-12-06', inGrace: true } });
    await settleBackgroundCheck();
    clock += 10 * DAY;
    const made = openDatabase(':memory:');
    try {
      carry(made);
      expect(planStatus(made)).toMatchObject({ plan: 'pro', activation: { graceUntil: '2026-12-06', inGrace: true } });
      await settleBackgroundCheck();
      portal.online = true;
      clock += 2 * 3_600_000;
      planStatus(made);
      await settleBackgroundCheck();
      expect(planStatus(made)).toMatchObject({ plan: 'pro', activation: { state: 'active' } });
    } finally {
      made.close();
    }
  });

  it('an activated key goes along with its activation, as before', async () => {
    await enterAndActivate();
    const made = openDatabase(':memory:');
    try {
      carry(made);
      expect(planStatus(made)).toMatchObject({ plan: 'pro', activation: { state: 'active', graceUntil: null } });
    } finally {
      made.close();
    }
  });
});

/** What 0.1.8 left in the company file: the key, no activation token. */
function fromOldKey(key: string) {
  writeSetting(db, 'license_key', key);
}

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
