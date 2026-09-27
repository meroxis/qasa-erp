import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { resetLoginThrottle } from './auth.ts';

let db: Db;
let app: FastifyInstance;
let ownerId: string;

const APP = { 'x-qasa-client': '1' };
const voucher = {
  kind: 'receipt', date: '2026-09-26', cashAccountCode: '1811', description: 'Receipt', currency: 'IQD', rateX100: 100,
  items: [{ accountCode: '1612', amount: 375_000 }]
};

type Headers = Record<string, string>;
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, headers: Headers = {}) =>
  app.inject({ method, url, headers: { ...APP, ...headers }, ...(body !== undefined ? { payload: body as object } : {}) });

/** Signs in and returns the cookie header for the next requests. */
async function signIn(username: string, password: string): Promise<Headers> {
  const res = await req('POST', '/api/auth/login', { username, password });
  expect(res.statusCode, res.body).toBe(200);
  const setCookie = String(res.headers['set-cookie']);
  return { cookie: setCookie.split(';')[0]! };
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

/** Owner with a password, the Pro trial (for more users) and sign-in switched on. */
async function officeWithSignIn(users: { username: string; roles: string[] }[] = []) {
  await req('POST', '/api/plan/trial');
  await req('POST', `/api/users/${ownerId}/password`, { password: 'owner-pass-1' });
  for (const u of users) {
    const res = await req('POST', '/api/users', { username: u.username, name: u.username === 'mer' ? 'Mer Las' : 'Raz', roles: u.roles, password: `${u.username}-pass-1` });
    expect(res.statusCode, res.body).toBe(201);
  }
  expect((await req('PUT', '/api/auth/signin', { on: true })).statusCode).toBe(200);
}

describe('without sign-in', () => {
  it('opens as the owner, with the name typed on this PC on vouchers', async () => {
    const me = (await req('GET', '/api/auth/me', undefined, { 'x-qasa-user': encodeURIComponent('Mer Las') })).json();
    expect(me).toMatchObject({ signInRequired: false, user: { id: ownerId, name: 'Mer Las', roles: ['admin'] } });
    const entry = (await req('POST', '/api/vouchers', voucher, { 'x-qasa-user': encodeURIComponent('Mer Las') })).json();
    expect(entry).toMatchObject({ preparedBy: 'Mer Las', actions: ['edit', 'delete', 'check'] });
  });

  it('allows one user on Free; more with Pro', async () => {
    const extra = { username: 'raz', name: 'Raz', roles: ['checker'] };
    expect((await req('POST', '/api/users', extra)).json()).toMatchObject({ error: 'plan_limit', details: { limit: 'users', max: 1 } });
    await req('POST', '/api/plan/trial');
    expect((await req('POST', '/api/users', extra)).statusCode).toBe(201);
    const bad = await req('POST', '/api/users', { username: 'raz', name: '', roles: [] });
    expect(bad.json().details).toEqual(expect.arrayContaining([{ code: 'username_taken' }, { code: 'name_required' }, { code: 'roles_required' }]));
  });

  it('needs an admin with a password before sign-in can be switched on', async () => {
    expect((await req('PUT', '/api/auth/signin', { on: true })).json().error).toBe('admin_password_required');
    expect((await req('POST', `/api/users/${ownerId}/password`, { password: 'short' })).json().details).toEqual([{ code: 'password_too_short' }]);
  });
});

describe('with sign-in', () => {
  it('asks everyone to sign in, with a session cookie the page cannot read', async () => {
    await officeWithSignIn();
    expect((await req('GET', '/api/accounts')).statusCode).toBe(401);
    expect((await req('GET', '/api/auth/me')).json()).toMatchObject({ signInRequired: true, user: null });
    expect((await req('POST', '/api/auth/login', { username: 'admin', password: 'wrong-password' })).json().error).toBe('invalid_login');
    expect((await req('POST', '/api/auth/login', { username: 'nobody', password: 'wrong-password' })).json().error).toBe('invalid_login');

    const res = await req('POST', '/api/auth/login', { username: 'ADMIN', password: 'owner-pass-1' });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^qasa_auth=[\w-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
    const session = { cookie: setCookie.split(';')[0]! };
    expect((await req('GET', '/api/accounts', undefined, session)).statusCode).toBe(200);
    expect((await req('GET', '/api/auth/me', undefined, session)).json().user).toMatchObject({ username: 'admin', roles: ['admin'] });

    // changes must come from the app itself (no cross-site forms)
    const noHeader = await app.inject({ method: 'POST', url: '/api/vouchers', payload: voucher, headers: session });
    expect(noHeader.statusCode).toBe(403);

    await req('POST', '/api/auth/logout', {}, session);
    expect((await req('GET', '/api/accounts', undefined, session)).statusCode).toBe(401);
  });

  it('waits after five wrong passwords in a row', async () => {
    await officeWithSignIn();
    for (let i = 0; i < 5; i++) expect((await req('POST', '/api/auth/login', { username: 'admin', password: 'wrong-password' })).statusCode).toBe(401);
    const locked = await req('POST', '/api/auth/login', { username: 'admin', password: 'owner-pass-1' });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: 'too_many_attempts', details: { retryAfterSeconds: 60 } });
  });

  it('lets each role do its own part of the approval chain', async () => {
    await officeWithSignIn([{ username: 'mer', roles: ['preparer', 'sales'] }, { username: 'raz', roles: ['checker', 'approver'] }]);
    const mer = await signIn('mer', 'mer-pass-1');
    const raz = await signIn('raz', 'raz-pass-1');

    const created = await req('POST', '/api/vouchers', voucher, mer);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ preparedBy: 'Mer Las', actions: ['edit', 'delete'] }); // no "check" for a preparer
    const id = created.json().id;
    expect((await req('POST', `/api/entries/${id}/check`, {}, mer)).json()).toMatchObject({ error: 'forbidden', details: { need: 'entries.check' } });
    expect((await req('GET', `/api/entries/${id}`, undefined, raz)).json().actions).toEqual(['check']);
    expect((await req('POST', `/api/entries/${id}/check`, {}, raz)).json()).toMatchObject({ status: 'checked', checkedBy: 'Raz' });
    expect((await req('POST', `/api/entries/${id}/approve`, {}, raz)).json()).toMatchObject({ status: 'approved', approvedBy: 'Raz' });

    // purchases, users and settings are not theirs
    const purchase = { kind: 'purchase', date: '2026-09-26', warehouseId: 'x', currency: 'IQD', rateX100: 100, payment: 'cash', cashAccountCode: '1811', discount: 0, lines: [] };
    expect((await req('POST', '/api/invoices', purchase, mer)).json()).toMatchObject({ error: 'forbidden', details: { need: 'purchases' } });
    expect((await req('GET', '/api/users', undefined, mer)).statusCode).toBe(403);
    expect((await req('PUT', '/api/settings', { defaultRateX100: 150000 }, raz)).statusCode).toBe(403);
    expect((await req('GET', '/api/reports/trial-balance', undefined, mer)).statusCode).toBe(200);
  });

  it('with separate duties, the preparer cannot check or approve their own voucher', async () => {
    await officeWithSignIn([{ username: 'mer', roles: ['preparer', 'checker', 'approver'] }, { username: 'raz', roles: ['checker', 'approver'] }]);
    const owner = await signIn('admin', 'owner-pass-1');
    expect((await req('PUT', '/api/auth/separate-duties', { on: true }, owner)).json().separateDuties).toBe(true);
    const mer = await signIn('mer', 'mer-pass-1');
    const raz = await signIn('raz', 'raz-pass-1');
    const id = (await req('POST', '/api/vouchers', voucher, mer)).json().id;
    expect((await req('POST', `/api/entries/${id}/check`, {}, mer)).json().error).toBe('same_person');
    expect((await req('POST', `/api/entries/${id}/check`, {}, raz)).statusCode).toBe(200);
    expect((await req('POST', `/api/entries/${id}/approve`, {}, mer)).json().error).toBe('same_person');
    expect((await req('POST', `/api/entries/${id}/approve`, {}, raz)).json().status).toBe('approved');
  });

  it('ends sessions when a password is changed or a user is switched off, and never locks out the last admin', async () => {
    await officeWithSignIn([{ username: 'mer', roles: ['preparer'] }]);
    const owner = await signIn('admin', 'owner-pass-1');
    const mer = await signIn('mer', 'mer-pass-1');
    const merId = (await req('GET', '/api/auth/me', undefined, mer)).json().user.id;

    expect((await req('POST', '/api/auth/password', { current: 'nope', password: 'mer-pass-2' }, mer)).json().details).toEqual([{ code: 'password_wrong' }]);
    expect((await req('POST', '/api/auth/password', { current: 'mer-pass-1', password: 'mer-pass-2' }, mer)).statusCode).toBe(200);
    const mer2 = await signIn('mer', 'mer-pass-2');

    expect((await req('PUT', `/api/users/${merId}`, { username: 'mer', name: 'Mer Las', roles: ['preparer'], active: false }, owner)).json().active).toBe(false);
    expect((await req('GET', '/api/accounts', undefined, mer2)).statusCode).toBe(401);
    expect((await req('POST', '/api/auth/login', { username: 'mer', password: 'mer-pass-2' })).statusCode).toBe(401);

    expect((await req('PUT', `/api/users/${ownerId}`, { username: 'admin', name: 'Admin', roles: ['viewer'], active: true }, owner)).json().error).toBe('cannot_lock_yourself_out');
    const audit = (await req('GET', '/api/audit', undefined, owner)).json() as { action: string }[];
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['login', 'login_failed', 'password', 'signin_on']));
  });
});
