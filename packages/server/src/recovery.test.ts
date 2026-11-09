import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import {
  adminUsernames, auditUnconfirmedReset, hasRecoveryCode, login, makeRecoveryCode, normalizeRecoveryCode, recoverAdminWithCode, resetAdminOnThisPc,
  resetLoginThrottle
} from './auth.ts';
import { readSetting } from './settings.ts';

let db: Db;
let app: FastifyInstance;
let ownerId: string;

const APP = { 'x-qasa-client': '1' };
type Headers = Record<string, string>;
const req = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, headers: Headers = {}) =>
  app.inject({ method, url, headers: { ...APP, ...headers }, ...(body !== undefined ? { payload: body as object } : {}) });

async function signIn(username: string, password: string): Promise<Headers> {
  const res = await req('POST', '/api/auth/login', { username, password });
  expect(res.statusCode, res.body).toBe(200);
  return { cookie: String(res.headers['set-cookie']).split(';')[0]! };
}

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  ownerId = (await req('GET', '/api/users')).json()[0].id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

/** Owner (admin) with a password, a sales user Mer, and sign-in switched on; gives the recovery code shown. */
async function signInOn(): Promise<string> {
  await req('POST', '/api/plan/trial');
  await req('POST', `/api/users/${ownerId}/password`, { password: 'owner-pass-1' });
  expect((await req('POST', '/api/users', { username: 'mer', name: 'Mer', roles: ['sales'], password: 'mer-pass-1' })).statusCode).toBe(201);
  const on = await req('PUT', '/api/auth/signin', { on: true });
  expect(on.statusCode).toBe(200);
  return on.json().recoveryCode as string;
}

const audits = (action: string) => db.prepare('SELECT user AS user_name, details FROM audit_log WHERE action = ? ORDER BY id').all(action) as { user_name: string; details: string | null }[];

describe('admin recovery code', () => {
  it('is shown once when sign-in is switched on, and only its slow hash is kept', async () => {
    const code = await signInOn();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
    const stored = readSetting(db, 'admin_recovery_hash')!;
    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain(code.replace(/-/g, ''));
    expect(hasRecoveryCode(db)).toBe(true);
    // it is never shown again: not in "me", not in the settings, and only an admin can ask whether one is set
    const admin = await signIn('admin', 'owner-pass-1');
    expect(JSON.stringify((await req('GET', '/api/auth/me', undefined, admin)).json())).not.toContain(code);
    expect(JSON.stringify((await req('GET', '/api/settings', undefined, admin)).json())).not.toContain('scrypt');
    expect((await req('GET', '/api/auth/recovery-code', undefined, admin)).json()).toEqual({ set: true });
    const mer = await signIn('mer', 'mer-pass-1');
    expect((await req('GET', '/api/auth/recovery-code', undefined, mer)).statusCode).toBe(403);
    expect((await req('POST', '/api/auth/recovery-code', {}, mer)).statusCode).toBe(403);
  });

  it('an admin can make a new one; the one before stops working', async () => {
    const first = await signInOn();
    const admin = await signIn('admin', 'owner-pass-1');
    const second = (await req('POST', '/api/auth/recovery-code', {}, admin)).json().recoveryCode as string;
    expect(second).not.toBe(first);
    await expect(recoverAdminWithCode(db, { username: 'admin', code: first, password: 'new-owner-pass' }, 'Windows: PC\\Mer')).rejects.toMatchObject({ code: 'recovery_failed' });
    await expect(recoverAdminWithCode(db, { username: 'admin', code: second, password: 'new-owner-pass' }, 'Windows: PC\\Mer')).resolves.toBeTruthy();
  });

  it('resets an admin password once: sessions end, the code is replaced, and it is audited', async () => {
    const code = await signInOn();
    const admin = await signIn('admin', 'owner-pass-1');
    // typed from paper: small letters, spaces, O for 0 and I for 1 are all read right
    const typed = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'i');
    const { recoveryCode } = await recoverAdminWithCode(db, { username: 'admin', code: typed, password: 'new-owner-pass' }, 'Windows: PC\\Las');
    expect(recoveryCode).not.toBe(code);
    expect((await req('GET', '/api/auth/me', undefined, admin)).json().user).toBeNull();
    expect((await req('POST', '/api/auth/login', { username: 'admin', password: 'owner-pass-1' })).statusCode).toBe(401);
    await signIn('admin', 'new-owner-pass');
    // used up: the same code again fails, the new one works
    await expect(recoverAdminWithCode(db, { username: 'admin', code, password: 'other-pass-2' }, 'x')).rejects.toMatchObject({ code: 'recovery_failed' });
    await expect(recoverAdminWithCode(db, { username: 'admin', code: recoveryCode, password: 'other-pass-2' }, 'x')).resolves.toBeTruthy();
    const done = audits('password_recovered');
    expect(done).toHaveLength(2);
    expect(done[0]!.user_name).toBe('Windows: PC\\Las');
    expect(JSON.parse(done[0]!.details!)).toMatchObject({ username: 'admin', method: 'recovery_code' });
    expect(audits('recovery_failed')).toHaveLength(1);
  });

  it('never resets someone who is not an active admin, and waits after five wrong tries', async () => {
    const code = await signInOn();
    await expect(recoverAdminWithCode(db, { username: 'mer', code, password: 'taken-over-1' }, 'x')).rejects.toMatchObject({ code: 'recovery_failed' });
    await signIn('mer', 'mer-pass-1');
    for (let i = 0; i < 4; i += 1) {
      await expect(recoverAdminWithCode(db, { username: 'admin', code: makeRecoveryCode(), password: 'guessing-1' }, 'x')).rejects.toMatchObject({ code: 'recovery_failed' });
    }
    // the sixth try waits, even with the right code
    await expect(recoverAdminWithCode(db, { username: 'admin', code, password: 'right-code-1' }, 'x')).rejects.toMatchObject({ status: 429, code: 'too_many_attempts' });
    await signIn('admin', 'owner-pass-1');
    // a short new password is refused before anything changes
    resetLoginThrottle();
    await expect(recoverAdminWithCode(db, { username: 'admin', code, password: 'short' }, 'x')).rejects.toMatchObject({ code: 'validation' });
  });

  it('ends a lock others caused on the admin: the new password works at once, by the code or by Windows Hello', async () => {
    const code = await signInOn();
    const lockOut = async () => {
      for (let i = 0; i < 30; i++) await expect(login(db, 'admin', 'wrong-password', undefined, `net:10.9.0.${i}`)).rejects.toMatchObject({ code: 'invalid_login' });
      for (let i = 0; i < 5; i++) await login(db, 'admin', 'wrong-password', undefined, 'net:10.0.0.7').catch(() => undefined);
      await expect(login(db, 'admin', 'owner-pass-1', undefined, 'net:10.0.0.7')).rejects.toMatchObject({ code: 'too_many_attempts' });
    };
    await lockOut();
    await recoverAdminWithCode(db, { username: 'admin', code, password: 'new-owner-pass' }, 'Windows: PC\\Mer');
    await expect(login(db, 'admin', 'new-owner-pass', undefined, 'net:10.0.0.7')).resolves.toBeTruthy();
    await lockOut().catch(() => undefined);
    for (let i = 0; i < 5; i++) await login(db, 'admin', 'wrong-password', undefined, 'net:10.0.0.8').catch(() => undefined);
    await resetAdminOnThisPc(db, { username: 'admin', password: 'newer-owner-pass', windowsUser: 'PC\\Mer', computer: 'PC', method: 'windows_hello' });
    await expect(login(db, 'admin', 'newer-owner-pass', undefined, 'net:10.0.0.8')).resolves.toBeTruthy();
  });

  it('can only be used in the Windows app: no web or network route takes a code or resets a password without one', async () => {
    const code = await signInOn();
    for (const url of ['/api/auth/recover', '/api/auth/recovery', '/api/auth/reset-admin', '/api/auth/recovery-code/use']) {
      const res = await req('POST', url, { username: 'admin', code, password: 'taken-over-1' });
      expect(res.statusCode, url).not.toBe(200);
    }
    // not even an admin's own session can use it to reset another password without the usual route
    expect((await req('POST', '/api/auth/recovery-code', { username: 'admin', code, password: 'taken-over-1' })).statusCode).toBe(401);
    await signIn('admin', 'owner-pass-1');
  });

  it('reads codes typed by hand, and refuses what cannot be one', () => {
    const code = makeRecoveryCode();
    expect(normalizeRecoveryCode(code)).toBe(code.replace(/-/g, ''));
    expect(normalizeRecoveryCode(` ${code.toLowerCase()} `)).toBe(code.replace(/-/g, ''));
    expect(normalizeRecoveryCode('ABCDE')).toBeNull();
    expect(normalizeRecoveryCode('U'.repeat(25))).toBeNull();
    expect(normalizeRecoveryCode('A'.repeat(500))).toBeNull();
    const many = new Set(Array.from({ length: 200 }, makeRecoveryCode));
    expect(many.size).toBe(200);
  });
});

describe('reset on this PC (Windows app only)', () => {
  it('resets an admin confirmed by the Windows user, ends their sessions and records who and how', async () => {
    await signInOn();
    const admin = await signIn('admin', 'owner-pass-1');
    expect(adminUsernames(db)).toEqual(['admin']);
    await resetAdminOnThisPc(db, { username: 'admin', password: 'from-windows-1', windowsUser: 'OFFICE-PC\\Raz', computer: 'OFFICE-PC', method: 'windows_hello' });
    expect((await req('GET', '/api/auth/me', undefined, admin)).json().user).toBeNull();
    await signIn('admin', 'from-windows-1');
    const [row] = audits('password_recovered');
    expect(row!.user_name).toBe('Windows: OFFICE-PC\\Raz');
    expect(JSON.parse(row!.details!)).toMatchObject({ username: 'admin', method: 'windows_hello', windowsUser: 'OFFICE-PC\\Raz', computer: 'OFFICE-PC' });
    // never for a user who is not an admin
    await expect(resetAdminOnThisPc(db, { username: 'mer', password: 'from-windows-1', windowsUser: 'x', computer: 'y', method: 'windows_hello' }))
      .rejects.toMatchObject({ code: 'validation' });
    await signIn('mer', 'mer-pass-1');
  });

  it('takes Windows Hello only: a one-click confirmation is refused, and every try is audited', async () => {
    await signInOn();
    // without Windows Hello, a dialog anyone at the PC can click proves nothing: only the recovery code resets an admin
    await expect(resetAdminOnThisPc(db, { username: 'admin', password: 'from-windows-1', windowsUser: 'OFFICE-PC\\Las', computer: 'OFFICE-PC', method: 'windows_confirm' as never }))
      .rejects.toMatchObject({ code: 'validation', details: [{ code: 'recovery_method_invalid' }] });
    await signIn('admin', 'owner-pass-1');
    expect(audits('password_recovered')).toHaveLength(0);
    // a short password and a user who is not an admin are written down too
    await expect(resetAdminOnThisPc(db, { username: 'admin', password: 'short', windowsUser: 'OFFICE-PC\\Las', computer: 'OFFICE-PC', method: 'windows_hello' })).rejects.toBeTruthy();
    await expect(resetAdminOnThisPc(db, { username: 'mer', password: 'from-windows-1', windowsUser: 'OFFICE-PC\\Las', computer: 'OFFICE-PC', method: 'windows_hello' })).rejects.toBeTruthy();
    // Windows did not confirm (no Hello here, cancelled): nothing changes, and that try is audited as well
    auditUnconfirmedReset(db, { username: 'admin', windowsUser: 'OFFICE-PC\\Las', computer: 'OFFICE-PC', outcome: 'hello_unavailable' });
    const failed = audits('recovery_failed');
    expect(failed.map((r) => r.user_name)).toEqual(Array(4).fill('Windows: OFFICE-PC\\Las'));
    expect(failed.map((r) => JSON.parse(r.details!).outcome)).toEqual(['method_refused', 'password_invalid', 'not_admin', 'hello_unavailable']);
    expect(JSON.parse(failed[0]!.details!)).toMatchObject({ username: 'admin', method: 'windows_confirm', windowsUser: 'OFFICE-PC\\Las', computer: 'OFFICE-PC' });
    await signIn('admin', 'owner-pass-1');
  });
});
