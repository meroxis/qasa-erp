import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
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

/**
 * Who may see what things cost (1.4): the purchase price and average cost of an item, the value of the stock, the cost
 * and profit of a sale. Those who buy, keep the stock or manage the company; a cashier (the sales role alone) may not,
 * and neither may anyone else without one of these permissions.
 */
export const seesCost = (actor: Pick<Actor, 'permissions'>): boolean =>
  actor.permissions.some((p) => p === 'admin' || p === 'stock' || p === 'purchases');

/**
 * Who may read the company's books and the reports made from them (the journal, the trial balance, final accounts,
 * profit in the reports and on the dashboard, what purchases cost): those who see cost, the accounting roles (they
 * prepare, check and approve the entries) and the viewer, whose role is to read them. Not a cashier.
 */
export const seesBooks = (actor: Pick<Actor, 'permissions' | 'roles'>): boolean =>
  seesCost(actor) || actor.permissions.some((p) => p.startsWith('entries.')) || actor.roles.includes('viewer');

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
  /** Active, but over the plan's number of users: can't sign in until an admin makes room or the plan grows. */
  overLimit: boolean;
}

interface UserRow {
  id: string; username: string; name: string; password_hash: string | null; roles: string; active: number; created_at: string; last_login_at: string | null;
}

const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'qasa_auth';

// ——— passwords (scrypt, per-user salt) ———

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** scrypt off the event loop (Node's thread pool), so a sign-in never holds up other requests. */
function scryptAsync(password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
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

function toView(r: UserRow, seats: UserSeats | null = null): UserView {
  return {
    id: r.id, username: r.username, name: r.name, roles: parseRoles(r.roles), active: r.active === 1, hasPassword: !!r.password_hash,
    createdAt: r.created_at, lastLoginAt: r.last_login_at, overLimit: r.active === 1 && !!seats && !seats.ids.has(r.id)
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
  const seats = userSeats(db);
  return (db.prepare('SELECT * FROM users ORDER BY created_at').all() as unknown as UserRow[]).map((r) => toView(r, seats));
}

// ——— more active users than the plan has ———

/** The users who may sign in while the company has more active users than its plan allows. */
export interface UserSeats { max: number; ids: ReadonlySet<string> }

/**
 * A company can come to hold more active users than its plan allows: users made in the free month and a smaller plan
 * after it, a licence that ended, a move from Pro to Starter. Nothing is deleted or switched off for that, and adding
 * users is refused as always; but only as many as the plan allows may sign in. Those are the admins first (the ones
 * with a password before the ones without, so an admin who can sign in always may: the company is never locked out),
 * then the other active users, each group from the earliest made. An admin chooses otherwise by making users inactive.
 * Null while the active users fit the plan (always so for one user, and for a plan without a limit).
 */
export function userSeats(db: Db): UserSeats | null {
  const active = db.prepare('SELECT id, roles, password_hash, created_at FROM users WHERE active = 1 ORDER BY created_at, id').all() as
    { id: string; roles: string; password_hash: string | null; created_at: string }[];
  if (active.length <= 1) return null;
  const max = planStatus(db).limits.users;
  if (max === null || active.length <= max) return null;
  const rank = (u: { roles: string; password_hash: string | null }) => (parseRoles(u.roles).includes('admin') ? (u.password_hash ? 0 : 1) : 2);
  // (sort is stable: within a group the order stays earliest first)
  const order = [...active].sort((a, b) => rank(a) - rank(b));
  return { max, ids: new Set(order.slice(0, Math.max(1, max)).map((u) => u.id)) };
}

/** May this active user sign in under the plan's number of users? */
function hasSeat(db: Db, userId: string): { ok: true } | { ok: false; max: number } {
  const seats = userSeats(db);
  return !seats || seats.ids.has(userId) ? { ok: true } : { ok: false, max: seats.max };
}

const activeCount = (db: Db) => (db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get() as { n: number }).n;

/** Active admins who can sign in: there must always be one, or nobody could manage the users. */
function signInAdmins(db: Db, except?: string): number {
  return (db.prepare("SELECT id, roles FROM users WHERE active = 1 AND password_hash IS NOT NULL").all() as { id: string; roles: string }[])
    .filter((u) => u.id !== except && parseRoles(u.roles).includes('admin')).length;
}

/** What a username may be: plain Latin letters, digits, '.', '_' and '-', 3 to 32 of them. */
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;

function assertUserFields(db: Db, input: { username: string; name: string; roles: Role[] }, id?: string): void {
  const errors: { code: string }[] = [];
  if (!USERNAME_PATTERN.test(input.username)) errors.push({ code: 'username_invalid' });
  else if (db.prepare('SELECT 1 FROM users WHERE username = ? AND id <> ?').get(input.username, id ?? '')) errors.push({ code: 'username_taken' });
  if (!input.name.trim() || input.name.trim().length > 100) errors.push({ code: 'name_required' });
  if (!Array.isArray(input.roles) || input.roles.length === 0 || input.roles.some((r) => !ROLES.includes(r))) errors.push({ code: 'roles_required' });
  if (errors.length) throw invalid(errors);
}

export async function createUser(db: Db, input: { username: string; name: string; roles: Role[]; password?: string | undefined }, by: string): Promise<UserView> {
  assertUserFields(db, input);
  if (input.password !== undefined) assertPassword(input.password);
  // more than one user is a Pro feature (users limit of the plan)
  assertWithinLimit(db, 'users', activeCount(db));
  const id = randomUUID();
  const hash = input.password !== undefined ? await hashPassword(input.password) : null;
  // checked again after the hashing (another request may have run meanwhile)
  assertUserFields(db, input);
  assertWithinLimit(db, 'users', activeCount(db));
  transaction(db, () => {
    db.prepare('INSERT INTO users (id, username, name, password_hash, roles, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run(id, input.username, input.name.trim(), hash, JSON.stringify(input.roles), new Date().toISOString());
    audit(db, by, 'create', 'user', id, { username: input.username, roles: input.roles });
  });
  return toView(loadUser(db, id), userSeats(db));
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
  return toView(loadUser(db, id), userSeats(db));
}

/** An admin sets (or resets) someone's password; their other sessions end. */
export async function setPassword(db: Db, id: string, password: string, by: string): Promise<UserView> {
  loadUser(db, id);
  assertPassword(password);
  const hash = await hashPassword(password);
  loadUser(db, id);
  transaction(db, () => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(db, by, 'password', 'user', id);
  });
  return toView(loadUser(db, id), userSeats(db));
}

/** A user changes their own password; the current one is required when there is one. */
export async function changeOwnPassword(db: Db, actor: Actor, current: string | undefined, next: string, keepToken?: string): Promise<void> {
  if (!actor.id) throw new AppError(401, 'unauthorized');
  const row = loadUser(db, actor.id);
  if (row.password_hash && !(await verifyPassword(current ?? '', row.password_hash))) throw invalid([{ code: 'password_wrong' }]);
  assertPassword(next);
  const hash = await hashPassword(next);
  transaction(db, () => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, actor.id);
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
  // other PCs reach this company over the office network only with sign-in (the Pro module sets network_on)
  if (!on && readSetting(db, 'network_on') === '1') throw conflict('network_needs_signin');
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

// ——— admin recovery ———

/**
 * A forgotten admin password must not lock a company out of its own books, and must not open a way around sign-in.
 * When sign-in is switched on the admin is shown a recovery code once; only its scrypt hash is kept (like a password).
 * The code, or Windows itself on this PC, resets an admin password, and only from the Windows app's own menu (through
 * its private bridge to this server, see apps/desktop): there is no web or network route that takes either. Each use is
 * written to the audit log, and a used code is replaced by a new one.
 */
const RECOVERY_SETTING = 'admin_recovery_hash';
/** Crockford's base32: no I, L, O or U, so a code read off paper is not misread. 25 characters, 125 random bits. */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_LENGTH = 25;

/** A new recovery code, as shown: five groups of five. */
export function makeRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_LENGTH);
  // 32 symbols: the low 5 bits of each byte are uniform
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b & 31]!).join('');
  return chars.match(/.{5}/g)!.join('-');
}

/** A code as typed (spaces, dashes, small letters, O for 0, I or L for 1) in its stored form, or null when it can't be one. */
export function normalizeRecoveryCode(typed: string): string | null {
  if (typeof typed !== 'string' || typed.length > 80) return null;
  const plain = typed.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return plain.length === RECOVERY_LENGTH && [...plain].every((c) => RECOVERY_ALPHABET.includes(c)) ? plain : null;
}

export function hasRecoveryCode(db: Db): boolean {
  return !!readSetting(db, RECOVERY_SETTING);
}

/** Makes a new recovery code (the one before stops working) and gives it once; only its hash is kept. */
export async function issueRecoveryCode(db: Db, by: string): Promise<string> {
  const code = makeRecoveryCode();
  const hash = await hashPassword(normalizeRecoveryCode(code)!);
  transaction(db, () => {
    writeSetting(db, RECOVERY_SETTING, hash);
    audit(db, by, 'recovery_code', 'settings', null);
  });
  return code;
}

/** An active admin by username, or null. */
function activeAdmin(db: Db, username: string): UserRow | null {
  if (!USERNAME_PATTERN.test(username)) return null;
  const row = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username) as unknown as UserRow | undefined;
  return row && parseRoles(row.roles).includes('admin') ? row : null;
}

/** The new password goes in and every session of that admin ends. */
function replaceAdminPassword(db: Db, row: UserRow, hash: string, by: string, details: Record<string, unknown>): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, row.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
  // a lock someone else caused (wrong passwords sent for this admin) must not refuse the new password
  clearLoginFailures(`id:${row.id}`);
  audit(db, by, 'password_recovered', 'user', row.id, { username: row.username, ...details });
}

/**
 * Resets an active admin's password with the recovery code. Wrong tries count like sign-ins (after 5 in a row it
 * waits, up to 15 minutes) and every try is audited. The code is used up: a new one is made and given back once.
 */
export async function recoverAdminWithCode(db: Db, input: { username: string; code: string; password: string }, via: string): Promise<{ recoveryCode: string }> {
  const key = 'recovery';
  assertNotLocked(key);
  assertPassword(input.password);
  const username = String(input.username ?? '').trim();
  const code = normalizeRecoveryCode(input.code);
  const stored = readSetting(db, RECOVERY_SETTING);
  const row = activeAdmin(db, username);
  // the same work whether or not there is a code, a user, or a well-formed code
  const codeOk = await verifyPassword(code ?? 'x', stored ?? DUMMY_HASH);
  if (!codeOk || !code || !stored || !row) {
    countFailure(key);
    audit(db, `${via}`.slice(0, 100), 'recovery_failed', 'user', row?.id ?? null, { username: username.slice(0, 64) });
    throw new AppError(401, 'recovery_failed');
  }
  failures.delete(key);
  const hash = await hashPassword(input.password);
  const next = makeRecoveryCode();
  const nextHash = await hashPassword(normalizeRecoveryCode(next)!);
  transaction(db, () => {
    // used once: checked again inside the transaction, so two tries with one code can't both get through
    if (readSetting(db, RECOVERY_SETTING) !== stored) throw new AppError(401, 'recovery_failed');
    replaceAdminPassword(db, row, hash, via, { method: 'recovery_code' });
    writeSetting(db, RECOVERY_SETTING, nextHash);
    audit(db, via, 'recovery_code', 'settings', null, { after: 'used' });
  });
  return { recoveryCode: next };
}

/** How a reset on this PC may be confirmed: Windows Hello only. Without Hello, only the recovery code resets an admin. */
export type ThisPcResetMethod = 'windows_hello';

/** What the audit log keeps of a reset tried on this PC: the Windows user and PC, the admin asked for, how it ended. */
function auditThisPcAttempt(
  db: Db, input: { username: string; windowsUser: string; computer: string }, rowId: string | null, details: Record<string, unknown>
): void {
  const windowsUser = String(input.windowsUser ?? '').slice(0, 100);
  audit(db, `Windows: ${windowsUser}`, 'recovery_failed', 'user', rowId, {
    username: String(input.username ?? '').slice(0, 64), windowsUser, computer: String(input.computer ?? '').slice(0, 100), ...details
  });
}

/**
 * Resets an active admin's password on this PC, confirmed by the signed-in Windows user with Windows Hello. Only the
 * Windows app's main process can ask for this, through its private bridge to this server. Any other confirmation is
 * refused (a click on a dialog proves nothing about who is at the PC). Every try is audited: who (the Windows user
 * and PC), for which admin, and how it ended.
 */
export async function resetAdminOnThisPc(
  db: Db, input: { username: string; password: string; windowsUser: string; computer: string; method: ThisPcResetMethod }
): Promise<void> {
  const row = activeAdmin(db, String(input.username ?? '').trim());
  if (input.method !== 'windows_hello') {
    auditThisPcAttempt(db, input, row?.id ?? null, { method: String(input.method).slice(0, 40), outcome: 'method_refused' });
    throw invalid([{ code: 'recovery_method_invalid' }]);
  }
  try {
    assertPassword(input.password);
  } catch (error) {
    auditThisPcAttempt(db, input, row?.id ?? null, { method: input.method, outcome: 'password_invalid' });
    throw error;
  }
  if (!row) {
    auditThisPcAttempt(db, input, null, { method: input.method, outcome: 'not_admin' });
    throw invalid([{ code: 'recovery_not_admin' }]);
  }
  const hash = await hashPassword(input.password);
  const windowsUser = String(input.windowsUser).slice(0, 100);
  transaction(db, () => {
    replaceAdminPassword(db, row, hash, `Windows: ${windowsUser}`, { method: input.method, windowsUser, computer: String(input.computer).slice(0, 100) });
  });
}

/**
 * A reset on this PC that Windows did not confirm (no Windows Hello here, cancelled, or it failed): nothing changes,
 * but the try is written to the audit log like any other.
 */
export function auditUnconfirmedReset(db: Db, input: { username: string; windowsUser: string; computer: string; outcome: string }): void {
  const row = activeAdmin(db, String(input.username ?? '').trim());
  auditThisPcAttempt(db, input, row?.id ?? null, { method: 'windows_hello', outcome: String(input.outcome).slice(0, 40) });
}

/** The active admins that can be reset (usernames), for the Windows app's reset window. */
export function adminUsernames(db: Db): string[] {
  return (db.prepare('SELECT username, roles FROM users WHERE active = 1 ORDER BY created_at').all() as { username: string; roles: string }[])
    .filter((u) => parseRoles(u.roles).includes('admin')).map((u) => u.username);
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
  // more active users than the plan has (a smaller plan since they signed in): the ones over it are signed out here,
  // at their next request, and told why when they sign in again
  if (!hasSeat(db, row.id).ok) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
    return null;
  }
  if (now - Date.parse(row.last_seen_at) > 60_000) {
    const expires = Math.min(now + SESSION_IDLE_MS, Date.parse(row.created_at) + SESSION_MAX_MS);
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(new Date(now).toISOString(), new Date(expires).toISOString(), row.token_hash);
  }
  return toActor(row);
}

// ——— signing in ———

/**
 * Failed sign-ins are counted per account and per place they come from (the `source`: this PC's own server, or a PC
 * or phone on the office network, each by its own address). After 5 in a row from one place, that place waits for that
 * account, 1 minute doubling up to 15, while the account's owner signs in from anywhere else as usual: someone who
 * keeps typing wrong passwords for the admin locks out only themselves. Guessing from many places at once is limited
 * by the account's own counter: after 30 failures in all, every place waits, except this PC's own server and the
 * places this account already signed in from. A counter with no failure for a day starts over, and an admin's
 * password reset (recovery code, Windows Hello) clears the account's counters.
 *
 * The account is keyed by the user's id when the name finds a user, so every spelling that reaches the same user (a
 * MySQL server compares names without case or accents) shares one counter; an unknown name is keyed by its lower-case
 * text, and counted the same way.
 */
const SOURCE_LIMIT = 5;
const ACCOUNT_LIMIT = 30;
const FORGET_AFTER_MS = 24 * 3_600_000;
const failures = new Map<string, { count: number; lockedUntil: number; last: number }>();
/** Places each account signed in from (in this run of the app): never held up by the account's own counter. */
const knownSources = new Map<string, Set<string>>();

/** Where a sign-in on this PC's own server (the app on this PC) comes from: see app.ts. */
export const isThisPcSource = (source: string): boolean => source.startsWith('local:');

/** Refuses a sign-in while its counter waits out a lock. */
function assertNotLocked(key: string): void {
  const state = failures.get(key);
  if (state && state.lockedUntil > Date.now()) {
    throw new AppError(429, 'too_many_attempts', { retryAfterSeconds: Math.ceil((state.lockedUntil - Date.now()) / 1000) });
  }
}

/** Counts one more failed sign-in under the key (from the `limit`th on it waits) and gives the new count. */
function countFailure(key: string, limit = SOURCE_LIMIT): number {
  const now = Date.now();
  const before = failures.get(key);
  const count = (before && now - before.last < FORGET_AFTER_MS ? before.count : 0) + 1;
  const lockedUntil = count >= limit ? now + Math.min(15, 2 ** (count - limit)) * 60_000 : 0;
  // made-up usernames must not fill the memory; a user's own counter for all places (one per user) stays for its day,
  // or a flood of made-up names from a few places would wipe it and let guessing from many places go on
  if (failures.size > 5000) {
    for (const [k, v] of failures) {
      const userCounter = k.startsWith('id:') && !k.includes('@');
      if (v.lockedUntil < now && (!userCounter || now - v.last >= FORGET_AFTER_MS)) failures.delete(k);
    }
  }
  failures.set(key, { count, lockedUntil, last: now });
  return count;
}

/** Forgets an account's failed sign-ins everywhere (its password was just reset by an admin's recovery). */
function clearLoginFailures(account: string): void {
  for (const key of [...failures.keys()]) if (key === account || key.startsWith(`${account}@`)) failures.delete(key);
}

/**
 * Signs in. `source` says where the request comes from ('local:<address>' for this PC's own server, 'net:<address>'
 * for the office network); without one, every caller counts as one unknown place.
 */
export async function login(db: Db, username: string, password: string, device?: string, source = 'unknown'): Promise<{ token: string; actor: Actor }> {
  const typed = username.trim();
  const place = String(source).slice(0, 100);
  // a name no user can have (the pattern users are created with) is refused before any lookup or password work, yet
  // counted and locked like any unknown name (by its first 64 characters); only the tries up to the lock are written to
  // the audit log, so one such name sent again and again adds no rows after its fifth
  if (!USERNAME_PATTERN.test(typed)) {
    const key = `name:${typed.toLowerCase().slice(0, 64)}@${place}`;
    assertNotLocked(key);
    if (countFailure(key) <= SOURCE_LIMIT) audit(db, typed.slice(0, 100) || '?', 'login_failed', 'user', null, { source: place });
    throw new AppError(401, 'invalid_login');
  }
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(typed) as unknown as UserRow | undefined;
  const account = row ? `id:${row.id}` : `name:${typed.toLowerCase()}`;
  const key = `${account}@${place}`;
  assertNotLocked(key);
  // guessing from many places: held up everywhere but on this PC and where the account already signed in
  if (!isThisPcSource(place) && !knownSources.get(account)?.has(place)) assertNotLocked(account);
  // the same answer, after the same work, for an unknown user, a wrong password, a user without a password and an inactive user
  const passwordOk = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  const ok = !!row && row.active === 1 && !!row.password_hash && passwordOk;
  if (!ok || !row) {
    countFailure(key);
    countFailure(account, ACCOUNT_LIMIT);
    audit(db, typed.slice(0, 100) || '?', 'login_failed', 'user', row?.id ?? null, { source: place });
    throw new AppError(401, 'invalid_login');
  }
  failures.delete(key);
  // the right password, but the company has more active users than its plan and this one is over it: said plainly (only
  // after the password was right, so it tells a stranger nothing), with how many the plan allows
  const seat = hasSeat(db, row.id);
  if (!seat.ok) {
    audit(db, row.name, 'login_over_limit', 'user', row.id, { source: place, max: seat.max });
    throw new AppError(403, 'plan_user_limit', { limit: 'users', max: seat.max, plan: planStatus(db).plan });
  }
  const known = knownSources.get(account) ?? new Set<string>();
  if (known.size < 50) known.add(place);
  knownSources.set(account, known);
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
  knownSources.clear();
}

const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

export function sessionCookie(token: string, secure: boolean, maxAgeSeconds = SESSION_MAX_MS / 1000): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}
