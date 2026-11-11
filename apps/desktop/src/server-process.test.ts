import { MessageChannel } from 'node:worker_threads';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Bridge, type Carrier } from './bridge.ts';
import { companyFileProblem, keptAsideOf, putBackCompanyFile, serve, stopServer, swapInCompanyFile, trialMarkerDirs } from './server-process.ts';
import { text } from './texts.ts';
import { openDatabase } from '@qasa/server';
import { companyVerifyKey } from '../../../packages/server/src/verify.ts';
import { readSetting } from '../../../packages/server/src/settings.ts';

const dir = mkdtempSync(join(tmpdir(), 'qasa-server-process-'));
const ch = new MessageChannel();
afterAll(async () => {
  await stopServer();
  ch.port1.close();
  ch.port2.close();
  rmSync(dir, { recursive: true, force: true });
});

const carrier = (port: MessageChannel['port1']): Carrier => ({ postMessage: (m) => port.postMessage(m), listen: (fn) => port.on('message', fn) });

describe('putting a backup in place of the company file', () => {
  const data = () => {
    const d = join(dir, 'swap-' + Math.random().toString(16).slice(2));
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'qasa.sqlite'), 'the books');
    writeFileSync(join(d, 'qasa.sqlite-wal'), 'the log');
    return d;
  };

  it('keeps the company file aside, never deleted, and puts the copy in its place', () => {
    const d = data();
    writeFileSync(join(dir, 'copy.sqlite'), 'the backup');
    swapInCompanyFile(d, join(dir, 'copy.sqlite'), '2026-11-08-10-00-00');
    expect(readFileSync(join(d, 'qasa.sqlite'), 'utf8')).toBe('the backup');
    expect(existsSync(join(d, 'qasa.sqlite-wal'))).toBe(false);
    expect(readFileSync(join(d, 'qasa-before-restore-2026-11-08-10-00-00.sqlite'), 'utf8')).toBe('the books');
    expect(readFileSync(join(d, 'qasa-before-restore-2026-11-08-10-00-00.sqlite-wal'), 'utf8')).toBe('the log');
  });

  it('moves the company file back, all of it, when its -wal file can\'t be moved aside (locked by another program)', () => {
    const d = data();
    writeFileSync(join(d, 'qasa.sqlite-shm'), 'the index');
    writeFileSync(join(dir, 'copy.sqlite'), 'the backup');
    const tried: string[] = [];
    const lockedWal = (from: string, to: string) => {
      tried.push(`${basename(from)} > ${basename(to)}`);
      if (from.endsWith('qasa.sqlite-wal')) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
      renameSync(from, to);
    };
    expect(() => swapInCompanyFile(d, join(dir, 'copy.sqlite'), '2026-11-08-10-00-00', lockedWal)).toThrow(/EBUSY/);
    // the company file moved aside first, then back once its -wal could not follow; the copy never went in
    expect(tried).toEqual(['qasa.sqlite > qasa-before-restore-2026-11-08-10-00-00.sqlite', 'qasa.sqlite-wal > qasa-before-restore-2026-11-08-10-00-00.sqlite-wal', 'qasa-before-restore-2026-11-08-10-00-00.sqlite > qasa.sqlite']);
    expect(readFileSync(join(d, 'qasa.sqlite'), 'utf8')).toBe('the books');
    expect(readFileSync(join(d, 'qasa.sqlite-wal'), 'utf8')).toBe('the log');
    expect(readFileSync(join(d, 'qasa.sqlite-shm'), 'utf8')).toBe('the index');
    expect(readdirSync(d).sort()).toEqual(['qasa.sqlite', 'qasa.sqlite-shm', 'qasa.sqlite-wal']);
  });

  it('when the copy can\'t go in and the company file can\'t come back either, says where it is kept and puts it back at the next start', () => {
    const d = data();
    writeFileSync(join(dir, 'copy.sqlite'), 'the backup');
    // the copy can't be renamed into place, and the company file then can't be moved back (still locked)
    let stuck = true;
    const flaky = (from: string, to: string) => {
      if (from.endsWith('.restoring') || (stuck && from.includes('qasa-before-restore-'))) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      renameSync(from, to);
    };
    let thrown: unknown = null;
    try { swapInCompanyFile(d, join(dir, 'copy.sqlite'), '2026-11-08-10-00-00', flaky); } catch (error) { thrown = error; }
    expect(keptAsideOf(thrown)).toBe('qasa-before-restore-2026-11-08-10-00-00.sqlite');
    expect(existsSync(join(d, 'qasa.sqlite'))).toBe(false);
    expect(readFileSync(join(d, 'qasa-before-restore-2026-11-08-10-00-00.sqlite'), 'utf8')).toBe('the books');
    expect(existsSync(join(d, 'qasa.sqlite.restoring'))).toBe(false);
    // the next start: still locked, nothing is opened in its place; once free, it goes back whole
    expect(() => putBackCompanyFile(d, flaky)).toThrow(/EPERM/);
    expect(existsSync(join(d, 'qasa.sqlite'))).toBe(false);
    stuck = false;
    expect(putBackCompanyFile(d, flaky)).toBe('qasa-before-restore-2026-11-08-10-00-00.sqlite');
    expect(readFileSync(join(d, 'qasa.sqlite'), 'utf8')).toBe('the books');
    expect(readFileSync(join(d, 'qasa.sqlite-wal'), 'utf8')).toBe('the log');
    expect(readdirSync(d).sort()).toEqual(['qasa.sqlite', 'qasa.sqlite-wal']);
    expect(putBackCompanyFile(d)).toBeNull();
  });

  it('leaves the company file exactly as it was when the copy fails (a USB disk pulled out)', () => {
    const d = data();
    expect(() => swapInCompanyFile(d, join(dir, 'gone', 'copy.sqlite'), '2026-11-08-10-00-00')).toThrow();
    expect(readFileSync(join(d, 'qasa.sqlite'), 'utf8')).toBe('the books');
    expect(readFileSync(join(d, 'qasa.sqlite-wal'), 'utf8')).toBe('the log');
    expect(readdirSync(d).sort()).toEqual(['qasa.sqlite', 'qasa.sqlite-wal']);
  });
});

describe('the server process', () => {
  it('starts the API server on 127.0.0.1 when the main process asks, only for the window holding the session key, and stops', async () => {
    process.env.QASA_NO_PING = '1';
    serve(carrier(ch.port2));
    const main = new Bridge(carrier(ch.port1));
    const url = await main.call<string>('init', [{
      userDataDir: dir, documentsDir: dir, appVersion: '1.0.0-test', sessionKey: 'k'.repeat(64), secretsKey: 'ab'.repeat(32), resourcesPath: dir, fromStore: false
    }], { timeoutMs: 20_000 });
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // the invoice QR signing key is kept protected with this process's secrets, never in the clear (desktop-sec-6)
    const books = openDatabase(':memory:');
    try {
      companyVerifyKey(books);
      expect(readSetting(books, 'verify_private_key')).toMatch(/^v1:q1:/);
    } finally {
      books.close();
    }
    const ok = await fetch(`${url}/api/health`, { headers: { cookie: `qasa_session=${'k'.repeat(64)}` } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-frame-options')).toBe('DENY');
    expect((await fetch(`${url}/api/health`)).status).toBe(403);
    await main.call('stop');
    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  }, 30_000);
});

describe('where this PC\'s trial record is kept', () => {
  it('in the app\'s own folder and in %LOCALAPPDATA%\\Qasa ERP, once each, and in the app\'s folder alone without LOCALAPPDATA', () => {
    const roaming = join('C:', 'Users', 'Mer', 'AppData', 'Roaming', 'Qasa ERP');
    const local = join('C:', 'Users', 'Mer', 'AppData', 'Local', 'Qasa ERP');
    expect(trialMarkerDirs({ userDataDir: roaming, localDataDir: local })).toEqual([roaming, local]);
    expect(trialMarkerDirs({ userDataDir: roaming })).toEqual([roaming]);
    expect(trialMarkerDirs({ userDataDir: roaming, localDataDir: roaming.toUpperCase() })).toEqual([roaming]);
  });
});

describe('a company file that had no room for its copy before an update', () => {
  it('is told apart from a damaged file, and the dialog says so without offering a backup', () => {
    const full = Object.assign(new Error('update_copy_failed'), { code: 'update_copy_failed', details: { reason: 'database or disk is full' } });
    expect(companyFileProblem(full, true)).toEqual({ main: true, reason: 'database or disk is full', cause: 'update_copy' });
    expect(companyFileProblem(new Error('file is not a database'), false)).toEqual({ main: false, reason: 'file is not a database', cause: 'damaged' });
    for (const lang of ['ar', 'en', 'ku'] as const) {
      expect(text(lang, 'dbUpdateCopyFailed')).not.toBe(text(lang, 'dbDamaged'));
      expect(text(lang, 'dbUpdateCopyFailedDetail', { reason: 'R' })).toContain('R');
    }
    expect(text('en', 'dbUpdateCopyFailed')).toContain('copy');
    expect(text('en', 'dbUpdateCopyFailedDetail')).toContain('disk space');
  });
});
