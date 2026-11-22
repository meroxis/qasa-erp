import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { buildApp, changesRecords, configureLicensing, configureViewOnly, keyHash, machineId, openDatabase, planStatus, readSetting, SCHEMA_VERSION, writeSetting, type Db } from '@qasa/server';
import { resetLicensingForTests } from '../../../packages/server/src/activation.ts';
import { setLicensePublicKeyForTests } from '../../../packages/server/src/license.ts';
import { companyApi, isNewerLicence, takeNewerLicence, type StoredLicence } from './company-api.ts';
import { MAIN_COMPANY, readRegistry } from './companies.ts';

const headers = { 'x-qasa-client': '1', 'x-qasa-user': 'Mer' };
let dir: string;
let backups: string;
let db: Db;
let app: ReturnType<typeof buildApp>;
let limit: number | null;
let folder: string | null;
let switched: string[];
let seq = 0;

type MakeCompanyFile = (file: string, prepare: (db: Db) => void) => void;
const makeFile: MakeCompanyFile = (file, prepare) => { const made = openDatabase(file); try { prepare(made); } finally { made.close(); } };

function start(currentId = MAIN_COMPANY, log: (...parts: unknown[]) => void = () => {}, makeCompanyFile: MakeCompanyFile = makeFile): void {
  app = buildApp(db, {
    extensions: [companyApi({
      db, userDataDir: dir, currentId, log, limit: () => limit,
      makeCompanyFile,
      chooseFolder: async () => folder,
      switchTo: (id) => { switched.push(id); },
      random: () => new Uint8Array([1, 2, 3, 4 + seq++])
    })]
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qasa-company-api-'));
  backups = join(dir, 'backups');
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(backups);
  db = openDatabase(join(dir, 'data', 'qasa.sqlite'));
  writeSetting(db, 'license_key', 'QASA-KEY');
  writeSetting(db, 'activation_token', 'QACT1.x.y');
  writeSetting(db, 'activation_checked', '2026-11-01T08:00:00.000Z');
  writeSetting(db, 'trial_started', '2026-11-01');
  limit = 3;
  folder = backups;
  switched = [];
  seq = 0;
  start();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const create = (name: unknown) => app.inject({ method: 'POST', url: '/api/companies', headers, payload: { name } });

describe('companies on this PC', () => {
  it('makes a company file in its own folder, carrying the licence but not the trial or the books', async () => {
    const r = await create('شركة البناء');
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ current: MAIN_COMPANY, limit: 3, canAdd: true, list: [{ id: MAIN_COMPANY, current: true }, { id: 'c01020304', name: 'شركة البناء', current: false }] });
    const file = join(dir, 'companies', 'c01020304', 'data', 'qasa.sqlite');
    expect(existsSync(file)).toBe(true);
    const made = openDatabase(file);
    expect(readSetting(made, 'license_key')).toBe('QASA-KEY');
    expect(readSetting(made, 'activation_token')).toBe('QACT1.x.y');
    expect(readSetting(made, 'trial_started')).toBeUndefined();
    // it checks in itself at once, so its invoice signing key reaches the portal the same day
    expect(readSetting(made, 'activation_checked')).toBeUndefined();
    made.close();
  });

  it('stops at the plan limit and on a bad name', async () => {
    limit = 1;
    expect((await create('Second')).statusCode).toBe(409);
    limit = 3;
    expect((await create('   ')).statusCode).toBe(400);
    expect(readRegistry(dir).list).toHaveLength(1);
  });

  it('renames, then opens another company after the reply', async () => {
    await create('B');
    const renamed = await app.inject({ method: 'PUT', url: '/api/companies/c01020304', headers, payload: { name: 'Branch B' } });
    expect(renamed.json().list[1].name).toBe('Branch B');
    expect((await app.inject({ method: 'POST', url: '/api/companies/main/open', headers })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/companies/c99999999/open', headers })).statusCode).toBe(404);
    const opened = await app.inject({ method: 'POST', url: '/api/companies/c01020304/open', headers });
    expect(opened.statusCode, opened.body).toBe(200);
    expect(readRegistry(dir).current).toBe('c01020304');
    await new Promise((r) => setTimeout(r, 80));
    expect(switched).toEqual(['c01020304']);
  });

  it('refuses ids that are paths', async () => {
    for (const id of ['..%2F..%2Fx', '..', 'C01020304']) {
      expect((await app.inject({ method: 'POST', url: `/api/companies/${id}/open`, headers })).statusCode).toBe(404);
    }
  });

  it('a company past the plan limit opens to be viewed: listed as view only, never refused or hidden (security review #10)', async () => {
    await create('B');
    limit = 1;
    const listed = (await app.inject({ url: '/api/companies', headers })).json() as { canAdd: boolean; list: { id: string; waiting: boolean }[] };
    expect(listed.canAdd).toBe(false);
    expect(listed.list).toHaveLength(2);
    expect(listed.list.map((c) => c.waiting)).toEqual([false, true]);
    // 1.6 opened every company, and a free user who made two in the free month must still reach both
    const opened = await app.inject({ method: 'POST', url: '/api/companies/c01020304/open', headers });
    expect(opened.statusCode, opened.body).toBe(200);
    await new Promise((r) => setTimeout(r, 80));
    expect(switched).toEqual(['c01020304']);
  });

  it('a view-only company refuses changes on every server, keeps reading, signing in, the licence, companies and backups open, and says so to everyone', async () => {
    let past = true;
    await app.close();
    app = buildApp(db, {
      extensions: [companyApi({
        db, userDataDir: dir, currentId: 'c01020304', log: () => {}, limit: () => limit, viewOnly: () => past,
        makeCompanyFile: makeFile, chooseFolder: async () => folder, switchTo: (id) => { switched.push(id); }
      })]
    });
    configureViewOnly(() => past);
    try {
      expect((await app.inject({ url: '/api/companies/state', headers })).json()).toEqual({ viewOnly: true });
      // reading goes on: nothing is hidden
      expect((await app.inject({ url: '/api/items', headers })).statusCode).toBe(200);
      expect((await app.inject({ url: '/api/plan', headers })).statusCode).toBe(200);
      // a change is refused with its own code, before any handler
      const refused = await app.inject({ method: 'POST', url: '/api/items', headers, payload: { name: { ar: 'س', en: 'x', ku: 'x' }, unit: 'piece', salePrice: 1000, saleCurrency: 'IQD' } });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ error: 'company_view_only' });
      expect((db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n).toBe(0);
      // the way out stays open: the licence, the companies, a backup, signing in
      for (const [method, url] of [['POST', '/api/plan/check'], ['POST', '/api/plan/license'], ['PUT', '/api/companies/c01020304'], ['POST', '/api/auth/login'], ['POST', '/api/backup/run'], ['PUT', '/api/usage']] as const) {
        expect(changesRecords(method, url), url).toBe(false);
      }
      for (const [method, url] of [['POST', '/api/invoices'], ['PUT', '/api/settings'], ['POST', '/api/backup/restore'], ['DELETE', '/api/items/x'], ['POST', '/api/pos/shifts/1/sales?x=1']] as const) {
        expect(changesRecords(method, url), url).toBe(true);
      }
      expect(changesRecords('GET', '/api/invoices')).toBe(false);
      // the plan is back (a check-in, a licence): changes go through again without a restart
      past = false;
      expect((await app.inject({ url: '/api/companies/state', headers })).json()).toEqual({ viewOnly: false });
      const made = await app.inject({ method: 'POST', url: '/api/items', headers, payload: { name: { ar: 'س', en: 'x', ku: 'x' }, unit: 'piece', salePrice: 1000, saleCurrency: 'IQD' } });
      expect(made.statusCode, made.body).toBe(201);
    } finally {
      configureViewOnly(null);
    }
  });

  it('refuses to open a company file from a newer version, and keeps the current company next', async () => {
    await create('B');
    const file = join(dir, 'companies', 'c01020304', 'data', 'qasa.sqlite');
    const newer = new DatabaseSync(file);
    newer.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION + 1);
    newer.close();
    const r1 = await app.inject({ method: 'POST', url: '/api/companies/c01020304/open', headers });
    expect(r1.statusCode).toBe(409);
    expect(r1.json().error).toBe('database_newer');
    expect(readRegistry(dir).current).toBe(MAIN_COMPANY);
    await new Promise((r) => setTimeout(r, 80));
    expect(switched).toEqual([]);
  });

  it('opens a damaged company file, so the start offers Try again or Restore from a backup (never out of reach)', async () => {
    await create('B');
    const file = join(dir, 'companies', 'c01020304', 'data', 'qasa.sqlite');
    writeFileSync(file, 'this is not a database, only text that took its place'.repeat(100));
    const opened = await app.inject({ method: 'POST', url: '/api/companies/c01020304/open', headers });
    expect(opened.statusCode, opened.body).toBe(200);
    expect(readRegistry(dir).current).toBe('c01020304');
    await new Promise((r) => setTimeout(r, 80));
    expect(switched).toEqual(['c01020304']);
  });

  it('opens a company damaged past its start too: carrying the licence over is only a help, never a reason to refuse', async () => {
    const logs: string[] = [];
    await app.close();
    start(MAIN_COMPANY, (...parts) => { logs.push(parts.join(' ')); });
    await create('B');
    const file = join(dir, 'companies', 'c01020304', 'data', 'qasa.sqlite');
    // its start reads well (a Qasa ERP file of this version), but a table the licence goes into is gone
    const damaged = new DatabaseSync(file);
    damaged.exec('DROP TABLE settings');
    damaged.close();
    const opened = await app.inject({ method: 'POST', url: '/api/companies/c01020304/open', headers });
    expect(opened.statusCode, opened.body).toBe(200);
    expect(readRegistry(dir).current).toBe('c01020304');
    await new Promise((r) => setTimeout(r, 80));
    expect(switched).toEqual(['c01020304']);
    expect(logs.some((l) => l.includes('c01020304') && l.includes('licence was not carried'))).toBe(true);
    // what was logged holds no licence or activation
    for (const l of logs) expect(l).not.toMatch(/QASA-KEY|QACT1/);
  });

  it('opening a company that has no licence gives it this PC\'s licence; one with its own keeps it', async () => {
    await create('B');
    await create('C');
    const fileOf = (id: string) => join(dir, 'companies', id, 'data', 'qasa.sqlite');
    const ids = readRegistry(dir).list.map((c) => c.id).filter((id) => id !== MAIN_COMPANY);
    // B was made before the licence (no key); C has its own
    for (const [id, key] of [[ids[0]!, null], [ids[1]!, 'QASA-OTHER']] as const) {
      const other = openDatabase(fileOf(id));
      for (const k of ['license_key', 'activation_token']) other.prepare('DELETE FROM settings WHERE "key" = ?').run(k);
      if (key) writeSetting(other, 'license_key', key);
      other.close();
    }
    expect((await app.inject({ method: 'POST', url: `/api/companies/${ids[0]}/open`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/companies/${ids[1]}/open`, headers })).statusCode).toBe(200);
    const b = openDatabase(fileOf(ids[0]!));
    expect([readSetting(b, 'license_key'), readSetting(b, 'activation_token'), readSetting(b, 'activation_checked')]).toEqual(['QASA-KEY', 'QACT1.x.y', undefined]);
    b.close();
    const c = openDatabase(fileOf(ids[1]!));
    expect(readSetting(c, 'license_key')).toBe('QASA-OTHER');
    c.close();
  });

  it('carries the licence into a company being opened all or nothing: a failure part way leaves nothing, and the next open carries it', async () => {
    await create('B');
    const id = readRegistry(dir).list.find((c) => c.id !== MAIN_COMPANY)!.id;
    const file = join(dir, 'companies', id, 'data', 'qasa.sqlite');
    const other = openDatabase(file);
    for (const k of ['license_key', 'activation_token']) other.prepare('DELETE FROM settings WHERE "key" = ?').run(k);
    other.close();
    // writing the second setting (the activation token) fails, as a full disk would
    const failing: MakeCompanyFile = (f, prepare) => makeFile(f, (made) => {
      const wrapped: Db = {
        exec: (sql) => made.exec(sql),
        close: () => made.close(),
        prepare: (sql) => {
          const statement = made.prepare(sql);
          return new Proxy(statement, {
            get(target, name) {
              if (name === 'run') return (...args: unknown[]) => {
                if (args[0] === 'activation_token') throw new Error('disk full');
                return (target.run as (...a: unknown[]) => unknown)(...args);
              };
              const value = Reflect.get(target, name) as unknown;
              return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
            }
          });
        }
      };
      prepare(wrapped);
    });
    const logged: string[] = [];
    await app.close();
    start(MAIN_COMPANY, (...parts) => { logged.push(parts.map(String).join(' ')); }, failing);
    expect((await app.inject({ method: 'POST', url: `/api/companies/${id}/open`, headers })).statusCode).toBe(200);
    expect(logged.join('\n')).toContain('the licence was not carried over (disk full)');
    const half = openDatabase(file);
    expect([readSetting(half, 'license_key'), readSetting(half, 'activation_token')]).toEqual([undefined, undefined]);
    half.close();
    // the next open (nothing failing) carries both
    await app.close();
    start();
    expect((await app.inject({ method: 'POST', url: `/api/companies/${id}/open`, headers })).statusCode).toBe(200);
    const whole = openDatabase(file);
    expect([readSetting(whole, 'license_key'), readSetting(whole, 'activation_token')]).toEqual(['QASA-KEY', 'QACT1.x.y']);
    whole.close();
  });

  it('a carried key that was never activated starts no 0.1.8 grace in the new or the opened company (official app)', async () => {
    const pair = generateKeyPairSync('ed25519');
    setLicensePublicKeyForTests(pair.publicKey.export({ format: 'jwk' }).x!);
    configureLicensing({
      strict: true, dataDir: dir, portalUrl: 'https://portal.test', machineGuid: () => '6f1c1b6e-3a59-4c1f-9d7e-0b2f4c9a1e11',
      fetch: (async () => { throw new TypeError('offline'); }) as typeof fetch
    });
    try {
      for (const k of ['license_key', 'activation_token', 'activation_checked', 'trial_started']) db.prepare('DELETE FROM settings WHERE "key" = ?').run(k);
      // this version started before the key was entered (a key of 1.0, its seats full or leaked): no grace here
      expect(planStatus(db).activation.graceUntil).toBeNull();
      const body = `QASA1.${Buffer.from(JSON.stringify({ v: 1, id: 'QP-2026-0007', plan: 'pro', to: 'Mer', issued: '2026-11-01', expires: null })).toString('base64url')}`;
      writeSetting(db, 'license_key', `${body}.${sign(null, Buffer.from(body), pair.privateKey).toString('base64url')}`);
      expect(planStatus(db)).toMatchObject({ plan: 'free', activation: { state: 'needs_activation', graceUntil: null } });
      expect((await create('B')).statusCode).toBe(201);
      expect((await create('C')).statusCode).toBe(201);
      const fileOf = (id: string) => join(dir, 'companies', id, 'data', 'qasa.sqlite');
      const [b, c] = readRegistry(dir).list.map((x) => x.id).filter((id) => id !== MAIN_COMPANY);
      // C is opened without a key of its own: it gets this one when it opens
      const closed = openDatabase(fileOf(c!));
      closed.prepare('DELETE FROM settings WHERE "key" = ?').run('license_key');
      closed.prepare('DELETE FROM settings WHERE "key" = ?').run('activation_grace_from');
      closed.close();
      expect((await app.inject({ method: 'POST', url: `/api/companies/${c}/open`, headers })).statusCode).toBe(200);
      for (const id of [b!, c!]) {
        const other = openDatabase(fileOf(id));
        try {
          expect(readSetting(other, 'license_key')).toBe(readSetting(db, 'license_key'));
          expect(planStatus(other)).toMatchObject({ plan: 'free', activation: { state: 'needs_activation', graceUntil: null, inGrace: false } });
        } finally {
          other.close();
        }
      }
    } finally {
      resetLicensingForTests();
    }
  });

  describe('the licence is the PC\'s: a company takes over a newer one from the others', () => {
    const MACHINE_GUID = '6f1c1b6e-3a59-4c1f-9d7e-0b2f4c9a1e11';
    let pair: ReturnType<typeof generateKeyPairSync>;
    const signed = (prefix: string, payload: Record<string, unknown>) => {
      const body = `${prefix}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
      return `${body}.${sign(null, Buffer.from(body), pair.privateKey).toString('base64url')}`;
    };
    const today = () => new Date().toISOString().slice(0, 10);
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const key = (id: string, issued: string, expires: string | null = null) => signed('QASA1', { v: 1, id, plan: 'pro', to: 'Mer', issued, expires });
    const tokenOf = (k: string, issued: string, machine = machineId(db)) => {
      const p = JSON.parse(Buffer.from(k.split('.')[1]!, 'base64url').toString()) as { id: string; plan: string; expires: string | null };
      return signed('QACT1', { v: 1, lic: p.id, key: keyHash(k), machine, plan: p.plan, expires: p.expires, issued, checkBy: day(30) });
    };
    const lic = (k: string | null, t: string | null = null, revoked: string | null = null): StoredLicence => ({ key: k, token: t, revoked });

    beforeEach(() => {
      pair = generateKeyPairSync('ed25519');
      setLicensePublicKeyForTests(pair.publicKey.export({ format: 'jwk' }).x!);
      configureLicensing({
        strict: true, dataDir: dir, portalUrl: 'https://portal.test', machineGuid: () => MACHINE_GUID,
        fetch: (async () => { throw new TypeError('offline'); }) as typeof fetch
      });
    });
    afterEach(() => resetLicensingForTests());

    it('newer means: activated on this PC, not ended, not revoked; a fresher activation of the same key, or a renewal', () => {
      const m = machineId(db);
      const k1 = key('QP-2026-0001', day(-200), day(-40));   // ended (past its grace)
      const k2 = key('QP-2026-0002', day(-20));              // the renewal
      const fresh = lic(k2, tokenOf(k2, day(-1)));
      // no key, a key that doesn't read, an ended key, a key never activated: the PC's activated licence is newer
      expect(isNewerLicence(lic(null), fresh, m, today())).toBe(true);
      expect(isNewerLicence(lic('QASA-JUNK'), fresh, m, today())).toBe(true);
      expect(isNewerLicence(lic(k1, tokenOf(k1, day(-100))), fresh, m, today())).toBe(true);
      expect(isNewerLicence(lic(k2), fresh, m, today())).toBe(true);
      // the same key: only a later activation
      expect(isNewerLicence(lic(k2, tokenOf(k2, day(-60))), fresh, m, today())).toBe(true);
      expect(isNewerLicence(fresh, lic(k2, tokenOf(k2, day(-60))), m, today())).toBe(false);
      expect(isNewerLicence(fresh, fresh, m, today())).toBe(false);
      // never taken over: a key without an activation, one activated on another PC, an ended one, a revoked one
      expect(isNewerLicence(lic(null), lic(k2), m, today())).toBe(false);
      expect(isNewerLicence(lic(null), lic(k2, tokenOf(k2, day(-1), 'f'.repeat(32))), m, today())).toBe(false);
      expect(isNewerLicence(lic(null), lic(k1, tokenOf(k1, day(-100))), m, today())).toBe(false);
      expect(isNewerLicence(lic(null), lic(k2, tokenOf(k2, day(-1)), JSON.stringify({ key: keyHash(k2), reason: 'revoked' })), m, today())).toBe(false);
      // a revocation of this very key is not undone by another company's token
      expect(isNewerLicence(lic(k2, tokenOf(k2, day(-60)), JSON.stringify({ key: keyHash(k2), reason: 'revoked' })), fresh, m, today())).toBe(false);
      // an older licence never replaces a newer one that works
      const older = key('QP-2026-0003', day(-90));
      expect(isNewerLicence(fresh, lic(older, tokenOf(older, day(-1))), m, today())).toBe(false);
    });

    it('a company whose own activation went stale starts on the PC\'s plan, not on Free (the other files are only read)', async () => {
      // the first company holds this PC's licence, activated yesterday
      const k = key('QP-2026-0009', day(-30));
      writeSetting(db, 'license_key', k);
      writeSetting(db, 'activation_token', tokenOf(k, day(-1)));
      expect(planStatus(db)).toMatchObject({ plan: 'pro', activation: { state: 'active' } });
      await create('B');
      const id = readRegistry(dir).list.find((c) => c.id !== MAIN_COMPANY)!.id;
      const file = join(dir, 'companies', id, 'data', 'qasa.sqlite');
      // B was last opened long ago: its activation is past its check-by day and the days offline after it
      const b = openDatabase(file);
      try {
        const p = JSON.parse(Buffer.from(k.split('.')[1]!, 'base64url').toString()) as { id: string };
        writeSetting(b, 'activation_token', signed('QACT1', { v: 1, lic: p.id, key: keyHash(k), machine: machineId(b), plan: 'pro', expires: null, issued: day(-90), checkBy: day(-60) }));
        // (its licence no longer counts: alone it would run on Free, or on what is left of the free month)
        expect(planStatus(b)).toMatchObject({ activation: { state: 'stale' } });
        expect(planStatus(b).source).not.toBe('license');
        // at its start it takes the PC's licence over, before anything asks for the plan
        db.close();
        const before = new DatabaseSync(join(dir, 'data', 'qasa.sqlite'), { readOnly: true });
        const main0 = before.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
        before.close();
        expect(takeNewerLicence(b, dir, id)).toBe(MAIN_COMPANY);
        expect(planStatus(b)).toMatchObject({ plan: 'pro', source: 'license', activation: { state: 'active' } });
        // nothing newer left to take: a second start changes nothing
        expect(takeNewerLicence(b, dir, id)).toBeNull();
        const after = new DatabaseSync(join(dir, 'data', 'qasa.sqlite'), { readOnly: true });
        expect(after.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual(main0);
        after.close();
      } finally {
        b.close();
        db = openDatabase(join(dir, 'data', 'qasa.sqlite'));
      }
    });

    it('opening a company that still holds an ended key gives it the renewal entered here; one with a newer licence keeps its own', async () => {
      const ended = key('QP-2026-0001', day(-400), day(-40));
      const renewal = key('QP-2026-0002', day(-10));
      writeSetting(db, 'license_key', renewal);
      writeSetting(db, 'activation_token', tokenOf(renewal, day(-1)));
      await create('B');
      await create('C');
      const [bId, cId] = readRegistry(dir).list.map((c) => c.id).filter((x) => x !== MAIN_COMPANY) as [string, string];
      const fileOf = (x: string) => join(dir, 'companies', x, 'data', 'qasa.sqlite');
      const newest = key('QP-2026-0003', day(-2));
      for (const [x, k, issued] of [[bId, ended, day(-300)], [cId, newest, day(-1)]] as const) {
        const other = openDatabase(fileOf(x));
        writeSetting(other, 'license_key', k);
        writeSetting(other, 'activation_token', tokenOf(k, issued, machineId(other)));
        other.close();
      }
      expect((await app.inject({ method: 'POST', url: `/api/companies/${bId}/open`, headers })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: `/api/companies/${cId}/open`, headers })).statusCode).toBe(200);
      const b = openDatabase(fileOf(bId));
      expect(readSetting(b, 'license_key')).toBe(renewal);
      expect(planStatus(b)).toMatchObject({ plan: 'pro', activation: { state: 'active' } });
      b.close();
      const c = openDatabase(fileOf(cId));
      expect(readSetting(c, 'license_key')).toBe(newest);
      c.close();
    });
  });

  it('backs up the open company and a closed one to the chosen folder', async () => {
    await create('B');
    const own = await app.inject({ method: 'POST', url: '/api/companies/main/backup', headers });
    expect(own.statusCode, own.body).toBe(200);
    const other = await app.inject({ method: 'POST', url: '/api/companies/c01020304/backup', headers });
    expect(other.statusCode, other.body).toBe(200);
    for (const saved of [own.json().saved, other.json().saved] as string[]) {
      expect(saved.startsWith(backups)).toBe(true);
      const copy = new DatabaseSync(saved, { readOnly: true });
      expect(copy.prepare("SELECT value FROM settings WHERE key = 'license_key'").get()).toEqual({ value: 'QASA-KEY' });
      copy.close();
    }
    expect(readdirSync(backups).some((n) => n.endsWith('.part'))).toBe(false);
    folder = null;
    expect((await app.inject({ method: 'POST', url: '/api/companies/main/backup', headers })).json()).toEqual({ saved: null });
  });

  it('never writes a plain copy of a company that has a backup password (Settings → Backups encrypts it)', async () => {
    writeFileSync(join(dir, 'backup.json'), JSON.stringify({ on: true, secret: 'protected-password' }));
    const r = await app.inject({ method: 'POST', url: '/api/companies/main/backup', headers });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('company_backup_use_settings');
    // backup settings that can't be read may hold a password too
    writeFileSync(join(dir, 'backup.json'), '{"on": true, "secr');
    expect((await app.inject({ method: 'POST', url: '/api/companies/main/backup', headers })).statusCode).toBe(409);
    expect(readdirSync(backups)).toEqual([]);
  });

  it('only an admin sees or changes the companies', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('signin_required', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
    expect((await app.inject({ url: '/api/companies', headers })).statusCode).toBe(401);
    expect((await create('B')).statusCode).toBe(401);
  });
});
