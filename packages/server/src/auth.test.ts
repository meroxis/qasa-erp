import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { login, resetLoginThrottle } from './auth.ts';

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
    const res = await req('POST', '/api/users', { username: u.username, name: u.username === 'mer' ? 'Mer' : 'Raz', roles: u.roles, password: `${u.username}-pass-1` });
    expect(res.statusCode, res.body).toBe(201);
  }
  expect((await req('PUT', '/api/auth/signin', { on: true })).statusCode).toBe(200);
}

describe('without sign-in', () => {
  it('opens as the owner, with the name typed on this PC on vouchers', async () => {
    const me = (await req('GET', '/api/auth/me', undefined, { 'x-qasa-user': encodeURIComponent('Mer') })).json();
    expect(me).toMatchObject({ signInRequired: false, user: { id: ownerId, name: 'Mer', roles: ['admin'] } });
    const entry = (await req('POST', '/api/vouchers', voucher, { 'x-qasa-user': encodeURIComponent('Mer') })).json();
    expect(entry).toMatchObject({ preparedBy: 'Mer', actions: ['edit', 'delete', 'check'] });
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

  it('locks only the place the wrong passwords come from: the admin still signs in on this PC and from other PCs', async () => {
    await officeWithSignIn();
    const from = (remoteAddress: string, password: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password }, headers: APP, remoteAddress });
    for (let i = 0; i < 5; i++) expect((await from('10.0.0.66', 'wrong-password')).statusCode).toBe(401);
    expect((await from('10.0.0.66', 'owner-pass-1')).statusCode).toBe(429);
    // the real admin, at the server PC and on another office PC, is not held up
    expect((await from('127.0.0.1', 'owner-pass-1')).statusCode).toBe(200);
    expect((await from('10.0.0.7', 'owner-pass-1')).statusCode).toBe(200);
    // the failures name where they came from
    const sources = (db.prepare("SELECT details FROM audit_log WHERE action = 'login_failed'").all() as { details: string }[]).map((r) => JSON.parse(r.details).source);
    expect(new Set(sources)).toEqual(new Set(['net:10.0.0.66']));
  });

  it('guessing from many places waits everywhere after 30 failures, except on this PC and where the account signed in before', async () => {
    await officeWithSignIn();
    await expect(login(db, 'admin', 'owner-pass-1', undefined, 'net:10.0.0.7')).resolves.toBeTruthy();
    for (let i = 0; i < 30; i++) await expect(login(db, 'admin', 'wrong-password', undefined, `net:10.9.0.${i}`)).rejects.toMatchObject({ code: 'invalid_login' });
    // a new place waits, even with the right password
    await expect(login(db, 'admin', 'owner-pass-1', undefined, 'net:10.9.1.1')).rejects.toMatchObject({ code: 'too_many_attempts' });
    // this PC's own server and a PC the admin already used still sign in
    await expect(login(db, 'admin', 'owner-pass-1', undefined, 'local:127.0.0.1')).resolves.toBeTruthy();
    await expect(login(db, 'admin', 'owner-pass-1', undefined, 'net:10.0.0.7')).resolves.toBeTruthy();
  });

  it('forgets a place\'s failures after a day without one, so a lock never lasts for ever', async () => {
    await officeWithSignIn();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (let i = 0; i < 9; i++) {
        vi.setSystemTime(Date.now() + 16 * 60_000);
        await expect(login(db, 'admin', 'wrong-password', undefined, 'net:10.0.0.66')).rejects.toMatchObject({ code: 'invalid_login' });
      }
      await expect(login(db, 'admin', 'owner-pass-1', undefined, 'net:10.0.0.66')).rejects.toMatchObject({ code: 'too_many_attempts', details: { retryAfterSeconds: 900 } });
      vi.setSystemTime(Date.now() + 25 * 3_600_000);
      // starts over: one wrong password is one failure, not a new 15-minute lock
      await expect(login(db, 'admin', 'wrong-password', undefined, 'net:10.0.0.66')).rejects.toMatchObject({ code: 'invalid_login' });
      await expect(login(db, 'admin', 'owner-pass-1', undefined, 'net:10.0.0.66')).resolves.toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps counting an account\'s failures from many places when made-up names fill the memory', async () => {
    await officeWithSignIn();
    for (let i = 0; i < 29; i++) await expect(login(db, 'admin', 'wrong-password', undefined, `net:10.9.0.${i}`)).rejects.toMatchObject({ code: 'invalid_login' });
    // over 5000 made-up names (cheap: no password work) must not wipe the admin's own counter
    for (let i = 0; i <= 5001; i++) await expect(login(db, `x${i}!`, 'p', undefined, 'net:10.8.0.1')).rejects.toMatchObject({ code: 'invalid_login' });
    await expect(login(db, 'admin', 'wrong-password', undefined, 'net:10.9.1.0')).rejects.toMatchObject({ code: 'invalid_login' });
    await expect(login(db, 'admin', 'owner-pass-1', undefined, 'net:10.9.1.1')).rejects.toMatchObject({ code: 'too_many_attempts' });
  });

  it('keeps one lock per user when the database compares names without accents (MySQL)', async () => {
    await officeWithSignIn();
    // a MySQL server's _ai_ci collation finds 'admin' for 'ádmin'; emulate that lookup on SQLite
    const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');
    const mysqlLike: Db = {
      exec: (sql) => db.exec(sql),
      close: () => undefined,
      prepare: (sql) => {
        const st = db.prepare(sql);
        if (!sql.startsWith('SELECT * FROM users WHERE username')) return st;
        return { ...st, run: st.run.bind(st), all: st.all.bind(st), get: (name) => st.get(typeof name === 'string' ? fold(name) : name) };
      }
    };
    for (let i = 0; i < 5; i++) await expect(login(mysqlLike, 'admin', 'wrong-password')).rejects.toMatchObject({ code: 'invalid_login' });
    await expect(login(mysqlLike, 'admin', 'owner-pass-1')).rejects.toMatchObject({ code: 'too_many_attempts' });
    // another spelling of the same name gets no fresh tries, even with the right password
    for (const other of ['ádmin', 'àdmin', 'admín']) await expect(login(mysqlLike, other, 'owner-pass-1')).rejects.toMatchObject({ code: 'invalid_login' });
    // a name with a stray space or other case still meets the same lock
    await expect(login(mysqlLike, ' ADMIN ', 'owner-pass-1')).rejects.toMatchObject({ code: 'too_many_attempts' });
  });

  it('counts names no user can have like any other: five tries, then a wait, and no audit rows past the fifth', async () => {
    await officeWithSignIn();
    const failedRows = () => (db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login_failed'").get() as { n: number }).n;
    const before = failedRows();
    const bad = 'no such name! '.repeat(8); // fails the username pattern; 112 characters
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (let i = 0; i < 5; i++) await expect(login(db, bad, 'x')).rejects.toMatchObject({ code: 'invalid_login' });
      // other case, or anything after the first 64 characters, meets the same lock
      await expect(login(db, bad.toUpperCase() + 'more', 'x')).rejects.toMatchObject({ code: 'too_many_attempts' });
      expect(failedRows() - before).toBe(5);
      // after the wait: one more try, refused as before but no longer written to the audit log, then a longer wait
      vi.setSystemTime(Date.now() + 61_000);
      await expect(login(db, bad, 'x')).rejects.toMatchObject({ code: 'invalid_login' });
      await expect(login(db, bad, 'x')).rejects.toMatchObject({ code: 'too_many_attempts', details: { retryAfterSeconds: 120 } });
      expect(failedRows() - before).toBe(5);
    } finally {
      vi.useRealTimers();
    }
    // the real users are not held up by it
    await expect(login(db, 'admin', 'owner-pass-1')).resolves.toMatchObject({ actor: { username: 'admin' } });
  });

  it('lets each role do its own part of the approval chain', async () => {
    await officeWithSignIn([{ username: 'mer', roles: ['preparer', 'sales'] }, { username: 'raz', roles: ['checker', 'approver'] }]);
    const mer = await signIn('mer', 'mer-pass-1');
    const raz = await signIn('raz', 'raz-pass-1');

    const created = await req('POST', '/api/vouchers', voucher, mer);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ preparedBy: 'Mer', actions: ['edit', 'delete'] }); // no "check" for a preparer
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

  it.each(['journal', 'receipt', 'payment'] as const)('keeps the editor of a %s independent from checking and approval', async (kind) => {
    await officeWithSignIn([{ username: 'mer', roles: ['preparer'] }, { username: 'raz', roles: ['preparer', 'checker', 'approver'] }]);
    const owner = await signIn('admin', 'owner-pass-1');
    const mer = await signIn('mer', 'mer-pass-1');
    const raz = await signIn('raz', 'raz-pass-1');
    expect((await req('PUT', '/api/auth/separate-duties', { on: true }, owner)).statusCode).toBe(200);
    const path = kind === 'journal' ? '/api/entries' : '/api/vouchers';
    const body = (amount: number) => kind === 'journal' ? {
      date: voucher.date, description: 'meroxis review', currency: 'IQD', rateX100: 100,
      lines: [{ accountCode: '1811', debit: amount, credit: 0 }, { accountCode: '42', debit: 0, credit: amount }]
    } : { ...voucher, kind, items: [{ accountCode: '1612', amount }] };
    const created = await req('POST', path, body(1000), mer);
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const updated = await req('PUT', `${path}/${id}`, body(9000), raz);
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json()).toMatchObject({ preparedBy: 'Raz', total: 9000 });
    expect((await req('POST', `/api/entries/${id}/check`, {}, raz)).json().error).toBe('same_person');
    expect((await req('POST', `/api/entries/${id}/check`, {}, owner)).statusCode).toBe(200);
    expect((await req('POST', `/api/entries/${id}/approve`, {}, raz)).json().error).toBe('same_person');
    expect((await req('POST', `/api/entries/${id}/return`, {}, owner)).statusCode).toBe(200);
    expect((await req('PUT', `${path}/${id}`, body(9500), raz)).statusCode).toBe(200);
    expect((await req('POST', `/api/entries/${id}/check`, {}, raz)).json().error).toBe('same_person');
    expect((await req('POST', `/api/entries/${id}/check`, {}, owner)).statusCode).toBe(200);
    expect((await req('POST', `/api/entries/${id}/approve`, {}, owner)).json()).toMatchObject({ status: 'approved', total: 9500 });
  });

  it('ends sessions when a password is changed or a user is switched off, and never locks out the last admin', async () => {
    await officeWithSignIn([{ username: 'mer', roles: ['preparer'] }]);
    const owner = await signIn('admin', 'owner-pass-1');
    const mer = await signIn('mer', 'mer-pass-1');
    const merId = (await req('GET', '/api/auth/me', undefined, mer)).json().user.id;

    expect((await req('POST', '/api/auth/password', { current: 'nope', password: 'mer-pass-2' }, mer)).json().details).toEqual([{ code: 'password_wrong' }]);
    expect((await req('POST', '/api/auth/password', { current: 'mer-pass-1', password: 'mer-pass-2' }, mer)).statusCode).toBe(200);
    const mer2 = await signIn('mer', 'mer-pass-2');

    expect((await req('PUT', `/api/users/${merId}`, { username: 'mer', name: 'Mer', roles: ['preparer'], active: false }, owner)).json().active).toBe(false);
    expect((await req('GET', '/api/accounts', undefined, mer2)).statusCode).toBe(401);
    expect((await req('POST', '/api/auth/login', { username: 'mer', password: 'mer-pass-2' })).statusCode).toBe(401);

    expect((await req('PUT', `/api/users/${ownerId}`, { username: 'admin', name: 'Admin', roles: ['viewer'], active: true }, owner)).json().error).toBe('cannot_lock_yourself_out');
    const audit = (await req('GET', '/api/audit', undefined, owner)).json() as { action: string }[];
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['login', 'login_failed', 'password', 'signin_on']));
  });
});

describe('more active users than the plan allows', () => {
  const ROLE = ['checker'];
  /** The free month with sign-in on: the owner (admin) and four more, made in this order. */
  async function officeOfFive() {
    await officeWithSignIn([{ username: 'las', roles: ROLE }, { username: 'raz', roles: ROLE }, { username: 'mer', roles: ['admin'] }, { username: 'late', roles: ROLE }]);
  }
  /** The free month ends: Free, one user. */
  const trialEnds = () => db.prepare("UPDATE settings SET value = '2020-01-01' WHERE key = 'trial_started'").run();
  const tryLogin = (username: string) => req('POST', '/api/auth/login', { username, password: `${username}-pass-1` });

  it('lets only as many sign in as the plan has: admins first, then the earliest made; nothing is deleted or switched off', async () => {
    await officeOfFive();
    const owner = await signIn((await req('GET', '/api/users', undefined, await signIn('mer', 'mer-pass-1'))).json()[0].username, 'owner-pass-1');
    for (const name of ['las', 'raz', 'late']) expect((await tryLogin(name)).statusCode, name).toBe(200);
    trialEnds();
    // Free: one user, the first admin (the owner); the second admin and everyone else wait
    for (const name of ['mer', 'las', 'raz', 'late']) {
      const res = await tryLogin(name);
      expect(res.statusCode, name).toBe(403);
      expect(res.json(), name).toEqual({ error: 'plan_user_limit', details: { limit: 'users', max: 1, plan: 'free' } });
    }
    const users = (await req('GET', '/api/users', undefined, owner)).json() as { username: string; active: boolean; overLimit: boolean }[];
    expect(users).toHaveLength(5);
    expect(users.every((u) => u.active)).toBe(true);
    expect(users.filter((u) => u.overLimit).map((u) => u.username).sort()).toEqual(['las', 'late', 'mer', 'raz']);
    // the refusal is written down, and is no failed password: the user is not locked out for it
    const audit = (await req('GET', '/api/audit', undefined, owner)).json() as { action: string }[];
    expect(audit.filter((a) => a.action === 'login_over_limit')).toHaveLength(4);
    for (let i = 0; i < 8; i++) expect((await tryLogin('las')).statusCode).toBe(403);
  });

  it('ends the sessions of the users over the limit at their next request, and keeps the others', async () => {
    await officeOfFive();
    const las = await signIn('las', 'las-pass-1');
    const mer = await signIn('mer', 'mer-pass-1');
    expect((await req('GET', '/api/auth/me', undefined, las)).json().user.username).toBe('las');
    trialEnds();
    expect((await req('GET', '/api/accounts', undefined, las)).statusCode).toBe(401);
    expect((await req('GET', '/api/accounts', undefined, mer)).statusCode).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    // the owner, an admin, always gets in
    const owner = await signIn((db.prepare('SELECT username FROM users WHERE id = ?').get(ownerId) as { username: string }).username, 'owner-pass-1');
    expect((await req('GET', '/api/accounts', undefined, owner)).statusCode).toBe(200);
  });

  it('lets the admin choose who is active: making users inactive gives the next ones their place', async () => {
    await officeOfFive();
    trialEnds();
    const ownerName = (db.prepare('SELECT username FROM users WHERE id = ?').get(ownerId) as { username: string }).username;
    const owner = await signIn(ownerName, 'owner-pass-1');
    const users = (await req('GET', '/api/users', undefined, owner)).json() as { id: string; username: string; name: string; roles: string[] }[];
    // the owner hands the one place to Mer (the other admin) by stepping aside is refused: an admin can't lock themself out
    const self = users.find((u) => u.id === ownerId)!;
    expect((await req('PUT', `/api/users/${ownerId}`, { username: self.username, name: self.name, roles: self.roles, active: false }, owner)).json().error).toBe('cannot_lock_yourself_out');
    // making someone active again is refused over the limit, as adding is
    expect((await req('POST', '/api/users', { username: 'more', name: 'Las', roles: ROLE }, owner)).json()).toMatchObject({ error: 'plan_limit', details: { limit: 'users', max: 1 } });
    // everyone but the owner made inactive: nobody is over the limit any more
    for (const u of users.filter((x) => x.id !== ownerId)) {
      expect((await req('PUT', `/api/users/${u.id}`, { username: u.username, name: u.name, roles: u.roles, active: false }, owner)).statusCode).toBe(200);
    }
    const after = (await req('GET', '/api/users', undefined, owner)).json() as { overLimit: boolean }[];
    expect(after.some((u) => u.overLimit)).toBe(false);
  });

  it('never leaves a company without an admin who can sign in: an admin with a password comes before one without', async () => {
    await req('POST', '/api/plan/trial');
    // the owner (the first admin) has no password; Mer, made later, is the admin who can sign in
    await req('POST', '/api/users', { username: 'las', name: 'Las', roles: ROLE, password: 'las-pass-1' });
    await req('POST', '/api/users', { username: 'mer', name: 'Mer', roles: ['admin'], password: 'mer-pass-1' });
    expect((await req('PUT', '/api/auth/signin', { on: true })).statusCode).toBe(200);
    trialEnds();
    expect((await tryLogin('las')).json().error).toBe('plan_user_limit');
    const mer = await signIn('mer', 'mer-pass-1');
    expect((await req('GET', '/api/users', undefined, mer)).statusCode).toBe(200);
  });

  it('says nothing about the limit to a wrong password or an unknown name', async () => {
    await officeOfFive();
    trialEnds();
    expect((await req('POST', '/api/auth/login', { username: 'las', password: 'not-the-password' })).json().error).toBe('invalid_login');
    expect((await req('POST', '/api/auth/login', { username: 'nobody', password: 'las-pass-1' })).json().error).toBe('invalid_login');
  });
});
