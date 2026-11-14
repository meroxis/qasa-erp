import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { closeAskNeeded, closeFlow, lastBookChangeAt, readCloseAsk, saveCloseAsk, type CloseFlowDeps } from './close-backup.ts';
import { dataPlaceOf, officeName } from './data-place.ts';

const dir = mkdtempSync(join(tmpdir(), 'qasa-close-ask-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const never = () => new Promise<never>(() => {});

const deps = (over: Partial<CloseFlowDeps> = {}): CloseFlowDeps => ({
  allowed: true,
  autoNeeded: async () => false,
  autoBackup: async () => ({ ok: true, file: 'auto.qbak' }),
  askOn: () => true,
  askNeeded: async () => true,
  prompt: async () => ({ choice: 'backup', never: false }),
  askOff: () => {},
  backupNow: async () => ({ ok: true, file: 'asked.qbak' }),
  showBox: () => never(),
  failed: async () => 'close',
  limitMs: 200,
  ...over
});

describe('should closing ask "Back up before closing?"', () => {
  const now = new Date(2026, 10, 14, 18, 0, 0);
  const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0, 0).toISOString();

  it('asks when the books changed and no backup was made since, nor today', () => {
    expect(closeAskNeeded({ lastChangeAt: at(14, 17), lastBackupAt: null, now })).toBe(true);
    expect(closeAskNeeded({ lastChangeAt: at(14, 17), lastBackupAt: at(13, 20), now })).toBe(true);
  });

  it('does not ask when nothing ever changed, after a backup made since the last change, or one made today', () => {
    expect(closeAskNeeded({ lastChangeAt: null, lastBackupAt: null, now })).toBe(false);
    expect(closeAskNeeded({ lastChangeAt: at(12, 9), lastBackupAt: at(12, 10), now })).toBe(false);
    expect(closeAskNeeded({ lastChangeAt: at(14, 17), lastBackupAt: at(14, 8), now })).toBe(false);
    expect(closeAskNeeded({ lastChangeAt: 'not a time', lastBackupAt: null, now })).toBe(false);
    // a backup time that can't be read counts as none
    expect(closeAskNeeded({ lastChangeAt: at(14, 17), lastBackupAt: 'yesterday', now })).toBe(true);
  });

  it('does not take a sign-in, or a refused one, for a change to the books', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL)');
    const row = (when: string, action: string) => db.prepare('INSERT INTO audit_log (at, user, action, entity) VALUES (?, ?, ?, ?)').run(when, 'Mer', action, 'user');
    expect(lastBookChangeAt(db)).toBeNull();
    row(at(13, 9), 'login');
    expect(lastBookChangeAt(db)).toBeNull(); // only sign-ins so far: nothing to back up
    row(at(13, 10), 'approve');
    // the next day: a sign-in, a wrong password from another PC, a refused recovery; someone reads a report and closes
    for (const action of ['login', 'login_failed', 'login_over_limit', 'recovery_failed', 'start_over_refused']) row(at(14, 9), action);
    expect(lastBookChangeAt(db)).toBe(at(13, 10));
    expect(closeAskNeeded({ lastChangeAt: lastBookChangeAt(db), lastBackupAt: at(13, 20), now })).toBe(false);
    // a changed password is a change worth a backup
    row(at(14, 11), 'password');
    expect(lastBookChangeAt(db)).toBe(at(14, 11));
    expect(closeAskNeeded({ lastChangeAt: lastBookChangeAt(db), lastBackupAt: at(13, 20), now })).toBe(true);
    db.close();
  });

  it('is on until the person turns it off, and a damaged file means on', () => {
    expect(readCloseAsk(dir)).toBe(true);
    saveCloseAsk(dir, false);
    expect(readCloseAsk(dir)).toBe(false);
    saveCloseAsk(dir, true);
    expect(readCloseAsk(dir)).toBe(true);
    writeFileSync(join(dir, 'close-ask.json'), '{ half');
    expect(readCloseAsk(dir)).toBe(true);
  });
});

describe('closing Qasa ERP', () => {
  it('asks nothing on a PC connected to an office PC, or while Windows shuts down', async () => {
    const prompt = vi.fn(async () => ({ choice: 'backup' as const, never: false }));
    const askNeeded = vi.fn(async () => true);
    expect(await closeFlow(deps({ allowed: false, prompt, askNeeded }))).toEqual({ proceed: true, outcome: { kind: 'none' }, asked: false });
    expect(prompt).not.toHaveBeenCalled();
    expect(askNeeded).not.toHaveBeenCalled();
  });

  it('makes the automatic backup without a question when that is on and due', async () => {
    const prompt = vi.fn(async () => ({ choice: 'cancel' as const, never: false }));
    expect(await closeFlow(deps({ autoNeeded: async () => true, prompt }))).toEqual({ proceed: true, outcome: { kind: 'done', file: 'auto.qbak' }, asked: false });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('does not ask when the setting is off, when nothing is due, or when that can’t be told', async () => {
    const prompt = vi.fn(async () => ({ choice: 'cancel' as const, never: false }));
    expect((await closeFlow(deps({ askOn: () => false, prompt }))).proceed).toBe(true);
    expect((await closeFlow(deps({ askNeeded: async () => false, prompt }))).proceed).toBe(true);
    expect((await closeFlow(deps({ askNeeded: async () => { throw new Error('no answer'); }, prompt }))).proceed).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('backs up and closes, closes without, or stays open on Cancel', async () => {
    expect(await closeFlow(deps())).toEqual({ proceed: true, outcome: { kind: 'done', file: 'asked.qbak' }, asked: true });
    const backupNow = vi.fn(async () => ({ ok: true }));
    expect(await closeFlow(deps({ prompt: async () => ({ choice: 'close', never: false }), backupNow }))).toEqual({ proceed: true, outcome: { kind: 'none' }, asked: true });
    expect(await closeFlow(deps({ prompt: async () => ({ choice: 'cancel', never: true }), backupNow }))).toEqual({ proceed: false, outcome: { kind: 'none' }, asked: true });
    expect(backupNow).not.toHaveBeenCalled();
  });

  it('"Don’t ask again" turns the question off, but not with Cancel', async () => {
    const askOff = vi.fn();
    await closeFlow(deps({ prompt: async () => ({ choice: 'cancel', never: true }), askOff }));
    expect(askOff).not.toHaveBeenCalled();
    await closeFlow(deps({ prompt: async () => ({ choice: 'close', never: true }), askOff }));
    expect(askOff).toHaveBeenCalledTimes(1);
    // a setting that can't be saved never keeps the app open
    expect((await closeFlow(deps({ prompt: async () => ({ choice: 'close', never: true }), askOff: () => { throw new Error('disk full'); } }))).proceed).toBe(true);
  });

  it('never blocks closing when the backup fails: it says why and lets the person close, or go back', async () => {
    const failed = vi.fn(async () => 'close' as const);
    const result = await closeFlow(deps({ backupNow: async () => ({ ok: false, error: 'disk full' }), failed }));
    expect(result).toEqual({ proceed: true, outcome: { kind: 'failed', error: 'disk full' }, asked: true });
    expect(failed).toHaveBeenCalledWith('disk full');
    expect((await closeFlow(deps({ backupNow: async () => { throw new Error('gone'); }, failed: async () => 'stay' }))).proceed).toBe(false);
    // a backup that never ends: the limit, then the same choice
    expect(await closeFlow(deps({ backupNow: () => never() }))).toEqual({ proceed: true, outcome: { kind: 'failed', error: 'timeout' }, asked: true });
    // the error box itself can't be shown: the app closes
    expect((await closeFlow(deps({ backupNow: async () => ({ ok: false, error: 'x' }), failed: async () => { throw new Error('no window'); } }))).proceed).toBe(true);
    // the question can't be shown: the app closes
    expect((await closeFlow(deps({ prompt: async () => { throw new Error('no window'); } }))).proceed).toBe(true);
  });

  it('lets the person skip a backup that is taking long', async () => {
    expect(await closeFlow(deps({ backupNow: () => never(), showBox: async () => {} }))).toEqual({ proceed: true, outcome: { kind: 'skipped' }, asked: true });
  });
});

describe('where the data is, as the page is told', () => {
  const fingerprint = 'a'.repeat(64);
  it('is this PC without an office server', () => {
    expect(dataPlaceOf(null)).toEqual({ role: 'local' });
  });

  it('names the office PC as the File menu does, and never its fingerprint or whole office ID', () => {
    expect(dataPlaceOf({ host: '192.168.1.20', port: 47420, fingerprint })).toEqual({ role: 'client', host: '192.168.1.20', relay: false });
    expect(officeName({ host: 'office-pc', port: 5000, fingerprint })).toBe('office-pc:5000');
    const relay = dataPlaceOf({ host: '127.0.0.1', port: 51234, fingerprint, relay: { url: 'https://relay.qasaerp.com', office: '1234567890' } });
    expect(relay).toEqual({ role: 'client', host: 'Qasa Relay · 12345-67890', relay: true });
    expect(JSON.stringify(relay)).not.toContain(fingerprint);
    expect(JSON.stringify(relay)).not.toContain('127.0.0.1');
  });
});
