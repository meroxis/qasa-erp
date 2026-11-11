import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { backupOnClose, noteCloseFailure, takeCloseFailure, type CloseBackupDeps } from './close-backup.ts';

const dir = mkdtempSync(join(tmpdir(), 'qasa-close-backup-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const never = () => new Promise<never>(() => {});
const deps = (over: Partial<CloseBackupDeps>): CloseBackupDeps => ({
  allowed: true, needed: async () => true, backup: async () => ({ ok: true, file: 'Qasa-ERP-backup.qbak' }), showBox: () => never(), limitMs: 200, ...over
});

describe('the backup when Qasa ERP closes', () => {
  it('makes none on an office client PC, while Windows shuts down, or when nothing changed', async () => {
    let asked = 0;
    expect(await backupOnClose(deps({ allowed: false, needed: async () => { asked++; return true; } }))).toEqual({ kind: 'none' });
    expect(asked).toBe(0);
    expect(await backupOnClose(deps({ needed: async () => false }))).toEqual({ kind: 'none' });
    expect(await backupOnClose(deps({ needed: async () => { throw new Error('no answer'); } }))).toEqual({ kind: 'none' });
  });

  it('waits for the backup with its box, closes the box after, and lets the person skip it', async () => {
    let closed = false;
    const done = await backupOnClose(deps({ showBox: (signal) => new Promise((resolve) => signal.addEventListener('abort', () => { closed = true; resolve(); })) }));
    expect(done).toEqual({ kind: 'done', file: 'Qasa-ERP-backup.qbak' });
    expect(closed).toBe(true);
    expect(await backupOnClose(deps({ backup: () => never(), showBox: async () => {} }))).toEqual({ kind: 'skipped' });
  });

  it('never holds the closing longer than its limit, and says why a backup failed', async () => {
    const started = Date.now();
    expect(await backupOnClose(deps({ backup: () => never() }))).toEqual({ kind: 'failed', error: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await backupOnClose(deps({ backup: async () => ({ ok: false, error: 'disk full' }) }))).toEqual({ kind: 'failed', error: 'disk full' });
    expect(await backupOnClose(deps({ backup: async () => { throw new Error('gone'); } }))).toEqual({ kind: 'failed', error: 'gone' });
  });

  it('tells a failure once at the next start', () => {
    expect(takeCloseFailure(dir)).toBeNull();
    noteCloseFailure(dir, 'timeout', new Date('2026-11-11T09:00:00Z'));
    expect(takeCloseFailure(dir)).toEqual({ at: '2026-11-11T09:00:00.000Z', error: 'timeout' });
    expect(existsSync(join(dir, 'close-backup-failed.json'))).toBe(false);
    expect(takeCloseFailure(dir)).toBeNull();
  });
});
