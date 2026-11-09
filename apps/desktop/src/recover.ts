import { adminUsernames, auditUnconfirmedReset, recoverAdminWithCode, resetAdminOnThisPc, type Db } from '@qasa/server';

/**
 * File → Reset admin password, on the server process's side. The main process asks over the bridge (bridge.ts) only:
 * nothing here is reachable over HTTP, from a browser or from the office network. Two ways in, both audited:
 * - the admin recovery code shown when sign-in was switched on (auth.ts), which works anywhere on this PC;
 * - the Windows user signed in on this PC, after Windows Hello confirmed them (windows-confirm.ts in the main process).
 *   Where Windows Hello isn't set up, there is no second way: only the recovery code resets an admin.
 * A try that Windows did not confirm still comes here, so the audit log keeps it too.
 */

/** How a try that Windows did not confirm ended. */
export const UNCONFIRMED_OUTCOMES = ['hello_unavailable', 'cancelled', 'windows_failed'] as const;
export type UnconfirmedOutcome = (typeof UNCONFIRMED_OUTCOMES)[number];

export type RecoverRequest =
  | { mode: 'code'; username: string; code: string; password: string; windowsUser: string }
  | { mode: 'windows'; username: string; password: string; windowsUser: string; computer: string; method: 'windows_hello' }
  | { mode: 'windows_unconfirmed'; username: string; windowsUser: string; computer: string; outcome: UnconfirmedOutcome };

export type RecoverAnswer = { ok: true; recoveryCode?: string } | { ok: false; error: string; retryAfterSeconds?: number };

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

/** A request from the main process, checked field by field (it is still treated as input). */
export function parseRecoverRequest(value: unknown): RecoverRequest | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const username = text(r.username, 64);
  const windowsUser = text(r.windowsUser, 200);
  if (!username || !windowsUser) return null;
  if (r.mode === 'windows_unconfirmed') {
    const computer = text(r.computer, 100);
    const outcome = UNCONFIRMED_OUTCOMES.find((o) => o === r.outcome);
    return computer && outcome ? { mode: 'windows_unconfirmed', username, windowsUser, computer, outcome } : null;
  }
  const password = text(r.password, 200);
  if (!password) return null;
  if (r.mode === 'code') {
    const code = text(r.code, 80);
    return code ? { mode: 'code', username, code, password, windowsUser } : null;
  }
  if (r.mode === 'windows') {
    const computer = text(r.computer, 100);
    // Windows Hello only: a reset confirmed any other way is never taken
    return computer && r.method === 'windows_hello' ? { mode: 'windows', username, password, windowsUser, computer, method: 'windows_hello' } : null;
  }
  return null;
}

/** Does what the request asks, and answers with an error code instead of throwing (the window shows it). */
export async function handleRecoverRequest(db: Db | null, value: unknown): Promise<RecoverAnswer> {
  if (!db) return { ok: false, error: 'not_ready' };
  const request = parseRecoverRequest(value);
  if (!request) return { ok: false, error: 'invalid' };
  try {
    if (request.mode === 'windows_unconfirmed') {
      auditUnconfirmedReset(db, request);
      return { ok: false, error: request.outcome };
    }
    if (request.mode === 'code') {
      const { recoveryCode } = await recoverAdminWithCode(db, request, `Windows: ${request.windowsUser}`.slice(0, 100));
      return { ok: true, recoveryCode };
    }
    await resetAdminOnThisPc(db, request);
    return { ok: true };
  } catch (error) {
    const e = error as { code?: unknown; details?: unknown };
    const code = typeof e.code === 'string' ? e.code : 'error';
    if (code === 'too_many_attempts') {
      const seconds = (e.details as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
      return { ok: false, error: code, ...(typeof seconds === 'number' ? { retryAfterSeconds: seconds } : {}) };
    }
    if (code === 'validation') {
      const first = (e.details as { code?: string }[] | null)?.[0]?.code;
      return { ok: false, error: first === 'recovery_not_admin' ? 'not_admin' : first === 'password_too_short' ? 'password_short' : first === 'password_too_long' ? 'password_long' : 'invalid' };
    }
    return { ok: false, error: code === 'recovery_failed' ? 'recovery_failed' : 'error' };
  }
}

/** The active admins, for the window's list. */
export function recoverableAdmins(db: Db | null): string[] {
  return db ? adminUsernames(db) : [];
}
