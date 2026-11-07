import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, openDatabase, readSetting, writeSetting, type Db } from '@qasa/server';
import { companyApi } from './company-api.ts';
import { MAIN_COMPANY, readRegistry } from './companies.ts';

const headers = { 'x-qasa-client': '1', 'x-qasa-user': 'Mer' };
let dir: string;
let backups: string;
let db: Db;
let app: ReturnType<typeof buildApp>;
let limit: number | null;
let folder: string | null;
let switched: string[];

function start(currentId = MAIN_COMPANY): void {
  app = buildApp(db, {
    extensions: [companyApi({
      db, userDataDir: dir, currentId, log: () => {}, limit: () => limit,
      makeCompanyFile: (file, prepare) => { const made = openDatabase(file); try { prepare(made); } finally { made.close(); } },
      chooseFolder: async () => folder,
      switchTo: (id) => { switched.push(id); },
      random: () => new Uint8Array([1, 2, 3, 4])
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
  writeSetting(db, 'trial_started', '2026-11-01');
  limit = 3;
  folder = backups;
  switched = [];
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
    expect(r.json()).toMatchObject({ current: MAIN_COMPANY, limit: 3, canAdd: true, list: [{ id: MAIN_COMPANY, current: true }, { id: 'c01020304', name: 'شركة البناء', current: false, openable: true }] });
    const file = join(dir, 'companies', 'c01020304', 'data', 'qasa.sqlite');
    expect(existsSync(file)).toBe(true);
    const made = openDatabase(file);
    expect(readSetting(made, 'license_key')).toBe('QASA-KEY');
    expect(readSetting(made, 'activation_token')).toBe('QACT1.x.y');
    expect(readSetting(made, 'trial_started')).toBeUndefined();
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

  it('a company over the limit waits for a licence', async () => {
    await create('B');
    limit = 1;
    expect((await app.inject({ method: 'POST', url: '/api/companies/c01020304/open', headers })).statusCode).toBe(409);
    expect(switched).toEqual([]);
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
    folder = null;
    expect((await app.inject({ method: 'POST', url: '/api/companies/main/backup', headers })).json()).toEqual({ saved: null });
  });

  it('only an admin sees or changes the companies', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('signin_required', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
    expect((await app.inject({ url: '/api/companies', headers })).statusCode).toBe(401);
    expect((await create('B')).statusCode).toBe(401);
  });
});
