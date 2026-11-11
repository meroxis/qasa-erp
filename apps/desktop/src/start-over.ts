import { join } from 'node:path';
import { audit, checkStartOver, noteFirstStartBeforeCarry, openDatabase, parseStartOverRequest, readSetting, writeSetting, type Db } from '@qasa/server';
import { CARRIED_SETTINGS } from './company-api.ts';

/**
 * Settings → Start over with empty books (1.1), in the server process. The main process asks over the bridge only
 * (never an HTTP route), and only from the app's own window on the PC that keeps the books (not a PC connected to an
 * office server). In order, and stopping at the first problem:
 *  1. the admin's user name and password and the company's name typed (checkStartOver: tries limited, audited);
 *  2. a backup — the app's normal one (Pro: encrypted when a backup password is set); none made, nothing else happens;
 *  3. the audit log of the old books says who started over, and when;
 *  4. an empty company file is made beside it, with the licence and this PC's activation carried (they belong to the
 *     PC), and an audit entry naming the file kept aside;
 *  5. the old company file is kept aside in the data folder (qasa-before-start-over-<time>.sqlite), never deleted, and
 *     the empty one put in its place (swapInCompanyFile, all or nothing); the app restarts into the first-time setup.
 */

export type StartOverAnswer = { ok: true; backup: string } | { ok: false; error: string; retryAfterSeconds?: number };

export interface StartOverDeps {
  db: Db | null;
  dataDir: string;
  /** the name on the company switcher, for a company with no name of its own */
  switcherName: string | null;
  /** the app's normal backup; resolves with the file's name, throws when no copy was made */
  backup(): Promise<string>;
  /** closes the books, swaps the files and restarts (the answer is sent before the restart) */
  swapAndRestart(freshFile: string, by: string): Promise<void>;
  stamp: string;
  log(...args: unknown[]): void;
}

const errorOf = (error: unknown): StartOverAnswer => {
  const e = error as { code?: unknown; details?: unknown };
  const code = typeof e.code === 'string' ? e.code : 'error';
  if (code === 'too_many_attempts') {
    const seconds = (e.details as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
    return { ok: false, error: code, ...(typeof seconds === 'number' ? { retryAfterSeconds: seconds } : {}) };
  }
  if (code === 'validation') return { ok: false, error: (e.details as { code?: string }[] | null)?.[0]?.code === 'start_over_confirmation' ? 'confirmation' : 'invalid' };
  if (code === 'forbidden') return { ok: false, error: 'not_admin' };
  if (code === 'invalid_login' || code === 'start_over_on_server') return { ok: false, error: code };
  return { ok: false, error: 'error' };
};

export async function startOver(deps: StartOverDeps, value: unknown): Promise<StartOverAnswer> {
  const db = deps.db;
  if (!db) return { ok: false, error: 'not_ready' };
  const request = parseStartOverRequest(value);
  if (!request) return { ok: false, error: 'invalid' };
  let by: string;
  try {
    by = (await checkStartOver(db, request, deps.switcherName)).name;
  } catch (error) {
    return errorOf(error);
  }
  let backup: string;
  try {
    backup = await deps.backup();
  } catch (error) {
    deps.log('start over: the backup could not be made, so nothing was changed:', error);
    audit(db, by, 'start_over_refused', 'company', null, { reason: 'backup_failed' });
    return { ok: false, error: 'backup_failed' };
  }
  const aside = `qasa-before-start-over-${deps.stamp}.sqlite`;
  audit(db, by, 'start_over', 'company', null, { backup, keptAs: aside });
  // the empty company, made beside the old one before anything is moved
  const fresh = join(deps.dataDir, `qasa-start-over-${deps.stamp}.sqlite`);
  try {
    const made = openDatabase(fresh);
    try {
      noteFirstStartBeforeCarry(db, made);
      for (const key of CARRIED_SETTINGS) {
        const kept = readSetting(db, key);
        if (kept != null) writeSetting(made, key, kept);
      }
      audit(made, by, 'start_over', 'company', null, { previous: aside, backup });
    } finally {
      made.close();
    }
  } catch (error) {
    deps.log('start over: the empty company could not be made, so nothing was changed:', error);
    return { ok: false, error: 'error' };
  }
  deps.log(`start over by ${by}: backup ${backup}, the old company file is kept as ${aside}`);
  // the answer goes back first; the swap and the restart follow
  setImmediate(() => void deps.swapAndRestart(fresh, by).catch((error: unknown) => deps.log('start over: the swap failed:', error)));
  return { ok: true, backup };
}
