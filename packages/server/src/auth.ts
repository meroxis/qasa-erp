import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { assertWithinLimit, planStatus } from './license.ts';
import { readSetting, writeSetting } from './settings.ts';

/**
 * Users, sign-in and roles.
 * Until sign-in is switched on, the app opens as the owner (the first admin) — the way a one-person office works.
 * With sign-in on, every request needs a session: a random token in an HttpOnly cookie, stored here only as a hash.
 */

export type Role = 'admin' | 'preparer' | 'checker' | 'approver' | 'sales' | 'purchasing' | 'storekeeper' | 'viewer';
export const ROLES: readonly Role[] = ['admin', 'preparer', 'checker', 'approver', 'sales', 'purchasing', 'storekeeper', 'viewer'];

/** What a role may change. Every signed-in user may look at the books; changing them needs a permission. */
export type Permission = 'admin' | 'entries.prepare' | 'entries.check' | 'entries.approve' | 'sales' | 'purchases' | 'stock';
const ALL: Permission[] = ['admin', 'entries.prepare', 'entries.check', 'entries.approve', 'sales', 'purchases', 'stock'];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ALL,
  preparer: ['entries.prepare'], // المنظم
  checker: ['entries.check'], // المدقق
  approver: ['entries.approve'], // المصادق
  sales: ['sales'],
  purchasing: ['purchases'],
  storekeeper: ['stock'],
  viewer: []
};

export interface Actor {
  /** null only for requests made before any user existed (never in practice) */
  id: string | null;
  name: string;
  username: string;
  roles: Role[];
  permissions: Permission[];
}

export interface UserView {
  id: string;
  username: string;
  name: string;
  roles: Role[];
  active: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface UserRow {
  id: string; username: string; name: string; password_hash: string | null; roles: string; active: number; created_at: string; last_login_at: string | null;
}

const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'qasa_auth';

// ——— passwords (scrypt, per-user salt) ———

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function assertPassword(password: string): void {
  if (typeof password !== 'string' || password.length < 8) throw invalid([{ code: 'password_too_short' }]);
  if (password.length > 200) throw invalid([{ code: 'password_too_long' }]);
}

// ——— users ———

function parseRoles(json: string): Role[] {
  try {
    const roles = JSON.parse(json) as unknown;
    return Array.isArray(roles) ? roles.filter((r): r is Role => ROLES.includes(r as Role)) : [];
  } catch {
    return [];
  }
}

function toView(r: UserRow): UserView {
  return {
    id: r.id, username: r.username, name: r.name, roles: parseRoles(r.roles), active: r.active === 1, hasPassword: !!r.password_hash,
    createdAt: r.created_at, lastLoginAt: r.last_login_at
  };
}

export function permissionsOf(roles: Role[]): Permission[] {
  return [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))];
}

function toActor(r: Pick<UserRow, 'id' | 'username' | 'name' | 'roles'>): Actor {
  const roles = parseRoles(r.roles);
  return { id: r.id, name: r.name, username: r.username, roles, permissions: permissionsOf(roles) };
}

function loadUser(db: Db, id: string): UserRow {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
  if (!row) throw notFound('user');
  return row;
}

export function listUsers(db: Db): UserView[] {
  return (db.prepare('SELECT * FROM users ORDER BY created_at').all() as unknown as UserRow[]).map(toView);
}

const activeCount = (db: Db) => (db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get() as { n: number }).n;

/** Active admins who can sign in: there must always be one, or nobody could manage the users. */
function signInAdmins(db: Db, except?: string): number {
  return (db.prepare("SELECT id, roles FROM users WHERE active = 1 AND password_hash IS NOT NULL").all() as { id: string; roles: string }[])
    .filter((u) => u.id !== except && parseRoles(u.roles).includes('admin')).length;
}

function assertUserFields(db: Db, input: { username: string; name: string; roles: Role[] }, id?: string): void {
  const errors: { code: string }[] = [];
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(input.username)) errors.push({ code: 'username_invalid' });
  else if (db.prepare('SELECT 1 FROM users WHERE username = ? AND id <> ?').get(input.username, id ?? '')) errors.push({ code: 'username_taken' });
  if (!input.name.trim() || input.name.trim().length > 100) errors.push({ code: 'name_required' });
  if (!Array.isArray(input.roles) || input.roles.length === 0 || input.roles.some((r) => !ROLES.includes(r))) errors.push({ code: 'roles_required' });
  if (errors.length) throw invalid(errors);
}

export function createUser(db: Db, input: { username: string; name: string; roles: Role[]; password?: string | undefined }, by: string): UserView {
  assertUserFields(db, input);
  if (input.password !== undefined) assertPassword(input.password);
  // more than one user is a Pro feature (users limit of the plan)
  assertWithinLimit(db, 'users', activeCount(db));
  const id = randomUUID();
  transaction(db, () => {
    db.prepare('INSERT INTO users (id, username, name, password_hash, roles, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run(id, input.username, input.name.trim(), input.password !== undefined ? hashPassword(input.password) : null, JSON.stringify(input.roles), new Date().toISOString());
    audit(db, by, 'create', 'user', id, { username: input.username, roles: input.roles });
  });
  return toView(loadUser(db, id));
}

export function updateUser(db: Db, id: string, input: { username: string; name: string; roles: Role[]; active: boolean }, actor: Actor): UserView {
  const row = loadUser(db, id);
  assertUserFields(db, input, id);
  const wasActive = row.active === 1;
  const staysAdmin = input.active && input.roles.includes('admin');
  if (actor.id === id && !staysAdmin) throw conflict('cannot_lock_yourself_out');
  if (!staysAdmin && signInRequired(db) && row.password_hash && parseRoles(row.roles).includes('admin') && signInAdmins(db, id) === 0) {
    throw conflict('last_admin');
  }
  if (!wasActive && input.active) assertWithinLimit(db, 'users', activeCount(db));
  transaction(db, () => {
    db.prepare('UPDATE users SET username = ?, name = ?, roles = ?, active = ? WHERE id = ?')
      .run(input.username, input.name.trim(), JSON.stringify(input.roles), input.active ? 1 : 0, id);
    if (!input.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(db, actor.name, 'update', 'user', id, { username: input.username, roles: input.roles, active: input.active });
  });
  return toView(loadUser(db, id));
}

/** An admin sets (or resets) someone's password; their other sessions end. */
export function setPassword(db: Db, id: string, password: string, by: string): UserView {
  loadUser(db, id);
  assertPassword(password);
  transaction(db, () => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(db, by, 'password', 'user', id);
  });
  return toView(loadUser(db, id));
}

/** A user changes their own password; the current one is required when there is one. */
export function changeOwnPassword(db: Db, actor: Actor, current: string | undefined, next: string, keepToken?: string): void {
  if (!actor.id) throw new AppError(401, 'unauthorized');
  const row = loadUser(db, actor.id);
  if (row.password_hash && !verifyPassword(current ?? '', row.password_hash)) throw invalid([{ code: 'password_wrong' }]);
  assertPassword(next);
  transaction(db, () => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), actor.id);
    // sign out everywhere else
    const keep = keepToken ? tokenHash(keepToken) : '';
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(actor.id, keep);
    audit(db, actor.name, 'password', 'user', actor.id);
  });
}

// ——— the sign-in switch ———

export function signInRequired(db: Db): boolean {
  return readSetting(db, 'signin_required') === '1';
}

/** Switching sign-in on needs an admin who can sign in (with a password), so nobody is locked out. */
export function setSignInRequired(db: Db, on: boolean, actor: Actor): void {
  if (on && signInAdmins(db) === 0) throw conflict('admin_password_required');
  transaction(db, () => {
    writeSetting(db, 'signin_required', on ? '1' : '0');
    if (!on) db.prepare('DELETE FROM sessions').run();
    audit(db, actor.name, on ? 'signin_on' : 'signin_off', 'settings', null);
  });
}

/** "Separate duties": the one who prepared a voucher can neither check nor approve it. A Pro feature. */
export function separateDuties(db: Db): boolean {
  return readSetting(db, 'separate_duties') === '1';
}

export function setSeparateDuties(db: Db, on: boolean, actor: Actor): void {
  if (on && !planStatus(db).features.includes('roles')) throw conflict('plan_limit', { limit: 'roles', plan: planStatus(db).plan });
  transaction(db, () => {
    writeSetting(db, 'separate_duties', on ? '1' : '0');
    audit(db, actor.name, 'update', 'settings', null, { separateDuties: on });
  });
}

// ——— who is asking ———

/** Without sign-in: the owner, under the name typed on this PC (kept from before users existed). */
export function ownerActor(db: Db, typedName?: string): Actor {
  const owner = (db.prepare("SELECT * FROM users WHERE active = 1 ORDER BY created_at").all() as unknown as UserRow[])
    .find((u) => parseRoles(u.roles).includes('admin'));
  if (!owner) return { id: null, name: typedName || 'Admin', username: 'admin', roles: ['admin'], permissions: ALL };
  const actor = toActor(owner);
  return { ...actor, name: typedName || actor.name, permissions: ALL };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The user behind a session token, or null. Keeps an active session alive (sliding, up to 7 days). */
export function sessionActor(db: Db, token: string): Actor | null {
  if (!token || token.length > 200) return null;
  const row = db.prepare(`SELECT s.token_hash, s.created_at, s.last_seen_at, s.expires_at, u.id, u.username, u.name, u.roles, u.active
                          FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(tokenHash(token)) as
    { token_hash: string; created_at: string; last_seen_at: string; expires_at: string; id: string; username: string; name: string; roles: string; active: number } | undefined;
  if (!row) return null;
  const now = Date.now();
  if (row.active !== 1 || Date.parse(row.expires_at) <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  if (now - Date.parse(row.last_seen_at) > 60_000) {
    const expires = Math.min(now + SESSION_IDLE_MS, Date.parse(row.created_at) + SESSION_MAX_MS);
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(new Date(now).toISOString(), new Date(expires).toISOString(), row.token_hash);
  }
  return toActor(row);
}

// ——— signing in ———

/** Failed sign-ins per username: after 5 in a row the account waits, 1 minute doubling up to 15. */
const failures = new Map<string, { count: number; lockedUntil: number }>();

export function login(db: Db, username: string, password: string, device?: string): { token: string; actor: Actor } {
  const key = username.trim().toLowerCase();
  const state = failures.get(key);
  if (state && state.lockedUntil > Date.now()) {
    throw new AppError(429, 'too_many_attempts', { retryAfterSeconds: Math.ceil((state.lockedUntil - Date.now()) / 1000) });
  }
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as unknown as UserRow | undefined;
  // the same answer, after the same work, for an unknown user, a wrong password, a user without a password and an inactive user
  const passwordOk = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  const ok = !!row && row.active === 1 && !!row.password_hash && passwordOk;
  if (!ok || !row) {
    const count = (state?.count ?? 0) + 1;
    const lockedUntil = count >= 5 ? Date.now() + Math.min(15, 2 ** (count - 5)) * 60_000 : 0;
    // made-up usernames must not fill the memory
    if (failures.size > 5000) for (const [k, v] of failures) if (v.lockedUntil < Date.now()) failures.delete(k);
    failures.set(key, { count, lockedUntil });
    audit(db, username.trim().slice(0, 100) || '?', 'login_failed', 'user', row?.id ?? null);
    throw new AppError(401, 'invalid_login');
  }
  failures.delete(key);
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  transaction(db, () => {
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, device) VALUES (?, ?, ?, ?, ?, ?)')
      .run(tokenHash(token), row.id, now.toISOString(), now.toISOString(), new Date(now.getTime() + SESSION_IDLE_MS).toISOString(), device?.slice(0, 200) ?? null);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now.toISOString(), row.id);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
    audit(db, row.name, 'login', 'user', row.id);
  });
  return { token, actor: toActor(row) };
}

export function logout(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

/** For tests: forget failed attempts. */
export function resetLoginThrottle(): void {
  failures.clear();
}

const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

export function sessionCookie(token: string, secure: boolean, maxAgeSeconds = SESSION_MAX_MS / 1000): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}
