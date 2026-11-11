import { normalizeForSearch, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { isMysql } from './db.ts';
import { AppError, conflict, invalid } from './errors.ts';
import { login, logout, type Actor } from './auth.ts';
import { readSetting } from './settings.ts';

/**
 * Settings → Start over with empty books (1.1), the checks on the server's side. Only the Windows app's own bridge
 * asks (server-process.ts in apps/desktop): no HTTP route leads here, on this PC or on the office network. The admin
 * types their user name and password (checked as a sign-in is, with its limit on tries, and in the audit log) and the
 * company's name. The rest — a backup that must succeed, keeping the old company file aside, an empty company in its
 * place, the restart — is the desktop app's.
 */

export interface StartOverRequest { username: string; password: string; confirmation: string }

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

/** A request from the main process, checked field by field (it is still treated as input). */
export function parseStartOverRequest(value: unknown): StartOverRequest | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const username = text(r.username, 64);
  const password = text(r.password, 200);
  const confirmation = text(r.confirmation, 200);
  return username && password && confirmation ? { username, password, confirmation } : null;
}

/** The names the confirmation may be: the company's name in any of its languages, else the name on the switcher. */
export function companyNames(db: Db, fallback: string | null): string[] {
  let names: Partial<Names> = {};
  try {
    names = JSON.parse(readSetting(db, 'company_name') ?? '{}') as Partial<Names>;
  } catch { /* none */ }
  const list = [names.ar, names.en, names.ku].filter((n): n is string => typeof n === 'string' && n.trim() !== '');
  return list.length ? list : fallback?.trim() ? [fallback.trim()] : [];
}

/** Does the typed confirmation name the company (any case, spacing or Arabic/Kurdish letter form)? */
export function confirmsCompany(typed: string, names: readonly string[]): boolean {
  const key = normalizeForSearch(typed.normalize('NFKC'));
  return !!key && names.some((n) => normalizeForSearch(n.normalize('NFKC')) === key);
}

/**
 * Checks a start-over request: an admin's user name and password (as a sign-in on this PC; its session is closed at
 * once) and the company's name typed. Returns the admin. Throws with a code the window words.
 */
export async function checkStartOver(db: Db, request: StartOverRequest, fallbackName: string | null): Promise<Actor> {
  // a company on a database server is moved back to a company file first (Settings → Database)
  if (isMysql(db)) throw conflict('start_over_on_server');
  let actor: Actor;
  try {
    const signed = await login(db, request.username, request.password, 'Start over', 'local:start-over');
    logout(db, signed.token);
    actor = signed.actor;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, 'invalid_login');
  }
  if (!actor.permissions.includes('admin')) throw new AppError(403, 'forbidden', { need: 'admin' });
  if (!confirmsCompany(request.confirmation, companyNames(db, fallbackName))) throw invalid([{ code: 'start_over_confirmation' }]);
  return actor;
}
