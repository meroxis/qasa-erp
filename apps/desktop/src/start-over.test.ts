import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@qasa/server';
import { readSetting, updateSettings, writeSetting } from '../../../packages/server/src/settings.ts';
import { resetLoginThrottle, setPassword } from '../../../packages/server/src/auth.ts';
import { startOver, type StartOverDeps } from './start-over.ts';
import { putBackCompanyFile, swapInCompanyFile } from './server-process.ts';

const root = mkdtempSync(join(tmpdir(), 'qasa-start-over-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let dir: string;
let db: Db;
beforeEach(async () => {
  resetLoginThrottle();
  dir = join(root, Math.random().toString(16).slice(2));
  mkdirSync(dir, { recursive: true });
  db = openDatabase(join(dir, 'qasa.sqlite'));
  const owner = (db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string }).id;
  await setPassword(db, owner, 'owner-pass-1', 'Mer');
  updateSettings(db, { companyName: { ar: 'شركة ميروكسيس', en: 'Meroxis Company', ku: 'کۆمپانیای مێرۆکسیس' } }, 'Mer');
  writeSetting(db, 'license_key', 'QASA-TEST-KEY');
});
afterEach(() => { try { db.close(); } catch { /* closed by the test */ } });

function deps(over: Partial<StartOverDeps> = {}): StartOverDeps & { swapped: string[] } {
  const swapped: string[] = [];
  return {
    db, dataDir: dir, switcherName: 'Qasa ERP', stamp: '2026-11-11-10-00-00', log: () => {},
    backup: async () => 'Qasa-ERP-backup-2026-11-11-1000.qbak',
    swapAndRestart: async (fresh) => { swapped.push(fresh); },
    swapped, ...over
  };
}
const flush = () => new Promise((r) => setImmediate(r));
const ask = { username: 'admin', password: 'owner-pass-1', confirmation: 'Meroxis Company' };

describe('starting over with empty books', () => {
  it('backs up, records it, makes an empty company with the licence carried, and only then swaps the files', async () => {
    const d = deps();
    expect(await startOver(d, ask)).toEqual({ ok: true, backup: 'Qasa-ERP-backup-2026-11-11-1000.qbak' });
    await flush();
    expect(d.swapped).toEqual([join(dir, 'qasa-start-over-2026-11-11-10-00-00.sqlite')]);
    expect(db.prepare("SELECT user, details FROM audit_log WHERE action = 'start_over'").get())
      .toEqual({ user: 'Admin', details: JSON.stringify({ backup: 'Qasa-ERP-backup-2026-11-11-1000.qbak', keptAs: 'qasa-before-start-over-2026-11-11-10-00-00.sqlite' }) });
    const fresh = openDatabase(d.swapped[0]!);
    try {
      expect(readSetting(fresh, 'license_key')).toBe('QASA-TEST-KEY');
      expect(fresh.prepare('SELECT COUNT(*) AS n FROM items').get()).toEqual({ n: 0 });
      expect(fresh.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'start_over'").get()).toEqual({ n: 1 });
      expect(JSON.parse(readSetting(fresh, 'company_name') ?? '{}')).toEqual({ ar: '', en: '', ku: '' });
    } finally {
      fresh.close();
    }
  });

  it('changes nothing when the backup fails, the password is wrong, the name is not typed or the user is no admin', async () => {
    const failing = deps({ backup: async () => { throw new Error('disk full'); } });
    expect(await startOver(failing, ask)).toEqual({ ok: false, error: 'backup_failed' });
    expect(await startOver(deps(), { ...ask, password: 'wrong-password' })).toEqual({ ok: false, error: 'invalid_login' });
    expect(await startOver(deps(), { ...ask, confirmation: 'Meroxis' })).toEqual({ ok: false, error: 'confirmation' });
    expect(await startOver(deps(), { username: 'admin' })).toEqual({ ok: false, error: 'invalid' });
    expect(await startOver(deps({ db: null }), ask)).toEqual({ ok: false, error: 'not_ready' });
    await flush();
    expect(failing.swapped).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.startsWith('qasa-start-over'))).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'start_over_refused'").get()).toEqual({ n: 1 });
  });

  it('keeps the old company file aside under its own name (never deleted); a swap cut short is put back at the next start', () => {
    const d = join(root, 'swap');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'qasa.sqlite'), 'the old books');
    writeFileSync(join(d, 'fresh.sqlite'), 'empty books');
    swapInCompanyFile(d, join(d, 'fresh.sqlite'), '2026-11-11-10-00-00', undefined, 'start-over');
    expect(readdirSync(d).sort()).toEqual(['fresh.sqlite', 'qasa-before-start-over-2026-11-11-10-00-00.sqlite', 'qasa.sqlite']);
    // the note a failed swap leaves names a start-over file too, and it goes back
    rmSync(join(d, 'qasa.sqlite'));
    writeFileSync(join(d, 'restore-put-back.json'), JSON.stringify({ aside: 'qasa-before-start-over-2026-11-11-10-00-00.sqlite' }));
    expect(putBackCompanyFile(d)).toBe('qasa-before-start-over-2026-11-11-10-00-00.sqlite');
    expect(existsSync(join(d, 'qasa.sqlite'))).toBe(true);
  });
});
