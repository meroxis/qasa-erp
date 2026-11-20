import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isCashRounding, todayIso } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { readSetting, writeSetting } from './settings.ts';
import { hashPassword, verifyPassword, type Actor } from './auth.ts';
import { getParty } from './parties.ts';
import { getShift } from './pos.ts';
import { userBranchLists } from './branches.ts';
import { imageMime, fromBase64, MAX_IMAGE_BYTES } from './media.ts';
import { getPrintProfile } from './print-profile.ts';
import { cancelGiftVoucher, findGiftVoucher, giftReport, sellGiftVoucher, writeOffExpired } from './gift-vouchers.ts';
import {
  APPROVAL_ACTIONS, APPROVAL_MS, maySellMisc, maySupervise, TILL_ONLY_ACTIONS, tillRules, type ApprovalAction, type TillRules
} from './till-settings.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * The till's rules and what goes with them (2.0, Iraqi markets): the rules themselves (till-settings.ts), supervisors'
 * PINs and the approvals they give at a till, a customer's debt read at the till, gift vouchers sold and looked up there,
 * and the customer screen on another device (a tablet or a second PC) paired to a till with a code.
 *
 * A PIN is a supervisor's own (6–8 digits; one set before 2.0 may still be 4 or 5 until it is changed), stored as a
 * password is (scrypt). An approval is given for one action at one shift and used once within two minutes; each one,
 * and each PIN that failed, is written to the audit log. Wrong PINs are counted per cashier (whatever shift they type
 * them at: opening another shift does not start the count again) and for the whole company: five from one cashier lock
 * that cashier's approvals for fifteen minutes, twenty from everyone in ten minutes lock every till's for ten, and each
 * lock is written to the audit log and shown to an admin in Settings. Approvals need the server: a till that can't
 * reach it holds the basket instead (an offline PIN check would need the PINs on the cashier's PC).
 */

/** what a PIN typed at a till may be (older 4-digit PINs keep working until changed) */
const PIN = /^\d{4,8}$/;
/** what a PIN set now must be */
const NEW_PIN = /^\d{6,8}$/;
/** PINs anyone would try first */
const WEAK = new Set(['0000', '1111', '1234', '12345', '123456', '1234567', '12345678', '4321', '2580', '9999', '1212']);
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;
const ALL_LOCK_AFTER = 20;
const ALL_WINDOW_MS = 10 * 60 * 1000;
const ALL_LOCK_MS = 10 * 60 * 1000;
/** wrong PINs per cashier (by user id, or name with sign-in off) and for the whole company */
const failures = new Map<string, { n: number; until: number }>();
let allFailures = { n: 0, since: Date.now(), until: 0 };
/** for tests: forget the counts */
export function resetPinFailures(): void { failures.clear(); allFailures = { n: 0, since: Date.now(), until: 0 }; }
const cashierKey = (a: Pick<Actor, 'id' | 'name'>) => a.id ? `u:${a.id}` : `n:${a.name}`;

function pinAlert(db: Db, alert: { scope: 'cashier' | 'all'; cashier: string; tries: number }): void {
  const at = new Date().toISOString();
  writeSetting(db, 'pos_pin_alert', JSON.stringify({ ...alert, at }));
  audit(db, alert.cashier, 'pin_lockout', 'pos_rules', null, alert);
}

export function setPin(db: Db, actor: Pick<Actor, 'id' | 'name' | 'permissions'>, pin: string): Promise<{ ok: true }> {
  if (!maySupervise(actor) || !actor.id) throw new AppError(403, 'forbidden', { need: 'posSupervise' });
  if (!NEW_PIN.test(pin)) throw invalid([{ code: 'pin_invalid' }]);
  if (WEAK.has(pin) || /^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw invalid([{ code: 'pin_weak' }]);
  const id = actor.id;
  return hashPassword(pin).then((hash) => {
    transaction(db, () => {
      db.prepare('DELETE FROM pos_pins WHERE user_id = ?').run(id);
      db.prepare('INSERT INTO pos_pins (user_id, pin_hash, digits, updated_at) VALUES (?, ?, ?, ?)').run(id, hash, pin.length, new Date().toISOString());
      audit(db, actor.name, 'set_pin', 'user', id, {});
    });
    return { ok: true as const };
  });
}

export const hasPin = (db: Db, userId: string | null): boolean => !!userId && !!db.prepare('SELECT 1 FROM pos_pins WHERE user_id = ?').get(userId);
/** a PIN set before 6 digits were asked for (or of unknown length): Settings asks for a new one */
const pinShort = (db: Db, userId: string | null): boolean => {
  if (!userId) return false;
  const r = db.prepare('SELECT digits FROM pos_pins WHERE user_id = ?').get(userId) as { digits: number | null } | undefined;
  return !!r && (r.digits === null || Number(r.digits) < 6);
};

interface Supervisor { id: string; name: string; hash: string }

/** The active users who may approve (a supervisor or an admin) and have set a PIN. */
function supervisors(db: Db): Supervisor[] {
  const rows = db.prepare(`SELECT u.id, u.name, u.roles, p.pin_hash FROM users u JOIN pos_pins p ON p.user_id = u.id WHERE u.active = 1`)
    .all() as { id: string; name: string; roles: string; pin_hash: string }[];
  return rows.filter((r) => {
    try { const roles = JSON.parse(r.roles) as string[]; return roles.includes('supervisor') || roles.includes('admin'); } catch { return false; }
  }).map((r) => ({ id: r.id, name: r.name, hash: r.pin_hash }));
}

export interface ApprovalView { token: string; approver: string; action: ApprovalAction; expiresAt: string; used: boolean }

/**
 * A supervisor's PIN typed at a till for `action`: the approval, for that shift. The cashier never approves their own
 * till unless they are an admin. An action done at the till alone (TILL_ONLY_ACTIONS) is used as it is given.
 */
export async function approve(db: Db, input: { shiftId: string; action: ApprovalAction; pin: string; detail?: string | undefined }, cashier: Actor): Promise<ApprovalView> {
  const shift = getShift(db, input.shiftId, cashier);
  if (shift.status !== 'open') throw conflict('pos_shift_closed');
  if (!shift.actions.includes('sell')) throw new AppError(403, 'forbidden', { need: 'shift_owner' });
  const now0 = Date.now();
  if (allFailures.until > now0) throw conflict('pin_locked', { seconds: Math.ceil((allFailures.until - now0) / 1000) });
  if (now0 - allFailures.since > ALL_WINDOW_MS) allFailures = { n: 0, since: now0, until: 0 };
  const key = cashierKey(cashier);
  const lock = failures.get(key);
  if (lock && lock.n >= LOCK_AFTER && lock.until > now0) throw conflict('pin_locked', { seconds: Math.ceil((lock.until - now0) / 1000) });
  // counted before the slow PIN check (reliability review #1): a burst sent at once can't all pass the lock while
  // the first ones are still being checked; taken back if the PIN is right
  const n = (lock && lock.until > now0 ? lock.n : 0) + 1;
  failures.set(key, { n, until: now0 + LOCK_MS });
  allFailures.n++;
  const undo = () => {
    const f = failures.get(key);
    if (f) { f.n = Math.max(0, f.n - 1); if (!f.n) failures.delete(key); }
    allFailures.n = Math.max(0, allFailures.n - 1);
  };
  const fail = (self: boolean): never => {
    audit(db, cashier.name, 'pin_failed', 'pos_shift', input.shiftId, { action: input.action, tries: n, self });
    if (n === LOCK_AFTER) pinAlert(db, { scope: 'cashier', cashier: cashier.name, tries: n });
    if (allFailures.n >= ALL_LOCK_AFTER && allFailures.until <= Date.now()) {
      allFailures.until = Date.now() + ALL_LOCK_MS;
      pinAlert(db, { scope: 'all', cashier: cashier.name, tries: allFailures.n });
    }
    throw invalid([{ code: self ? 'pin_self' : 'pin_wrong' }]);
  };
  if (!PIN.test(input.pin)) fail(false);
  let found: Supervisor | null = null;
  for (const s of supervisors(db)) {
    if (await verifyPassword(input.pin, s.hash)) { found = s; break; }
  }
  if (!found || (found.id === cashier.id && !cashier.permissions.includes('admin'))) return fail(!!found);
  undo();
  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + APPROVAL_MS).toISOString();
  const used = TILL_ONLY_ACTIONS.includes(input.action);
  const detail = input.detail?.trim().slice(0, 300) || null;
  db.prepare(`INSERT INTO pos_approvals (id, shift_id, action, approver, approver_id, cashier, detail, created_at, expires_at, used_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(token, input.shiftId, input.action, found.name, found.id, cashier.name, detail, now.toISOString(), expiresAt, used ? now.toISOString() : null);
  audit(db, cashier.name, 'supervisor_ok', 'pos_shift', input.shiftId, { action: input.action, approver: found.name, detail });
  return { token, approver: found.name, action: input.action, expiresAt, used };
}

/** What the till reads of its rules: everything but who may sell the open-price item (only whether this person may). */
export function rulesForTill(db: Db, actor: Actor) {
  const rules = tillRules(db);
  return {
    rounding: rules.rounding, blindClose: rules.blindClose, supervisor: rules.supervisor,
    misc: { itemId: rules.misc.itemId, max: rules.misc.max, allowed: maySellMisc(rules.misc, actor) },
    display: rules.display,
    mayApprove: maySupervise(actor), hasPin: hasPin(db, actor.id), pinShort: pinShort(db, actor.id),
    // the last time wrong PINs locked approvals: shown to an admin until they clear it
    pinAlert: actor.permissions.includes('admin') ? readPinAlert(db) : null
  };
}

function readPinAlert(db: Db): { scope: 'cashier' | 'all'; cashier: string; tries: number; at: string } | null {
  try { const v = readSetting(db, 'pos_pin_alert'); return v ? JSON.parse(v) as { scope: 'cashier' | 'all'; cashier: string; tries: number; at: string } : null; } catch { return null; }
}

const roundingBody = z.object({ step: z.union([z.literal(0), z.literal(250), z.literal(500), z.literal(1000)]), mode: z.enum(['nearest', 'up', 'down']) });
const rulesBody = z.object({
  rounding: roundingBody.optional(),
  roundingAccount: z.string().max(12).nullable().optional(),
  blindClose: z.boolean().optional(),
  supervisor: z.object({
    lineDelete: z.boolean(), void: z.boolean(), price: z.boolean(), discountPct: z.number().int().min(0).max(100),
    noSale: z.boolean(), refund: z.boolean(), creditOver: z.boolean()
  }).optional(),
  misc: z.object({ itemId: z.string().max(64).nullable(), max: z.number().int().min(0).max(1_000_000_000), users: z.array(z.string().max(64)).max(200).nullable() }).optional(),
  display: z.object({ lang: z.enum(['till', 'ar', 'en', 'ku']), paymentText: z.string().max(200), slideshow: z.boolean() }).optional()
}).strict();

/** An admin changes the rules; each change is in the audit log. */
export function saveRules(db: Db, input: z.infer<typeof rulesBody>, user: string): TillRules {
  const errors: { code: string }[] = [];
  if (input.rounding && !isCashRounding(input.rounding)) errors.push({ code: 'pos_rounding_invalid' });
  if (input.roundingAccount) {
    const a = loadAccounts(db).find((x) => x.code === input.roundingAccount);
    if (!a || !a.postable || !/^[34]/.test(a.code)) errors.push({ code: 'pos_rounding_account_invalid' });
  }
  if (input.misc?.itemId) {
    const it = db.prepare('SELECT track_stock, active FROM items WHERE id = ?').get(input.misc.itemId) as { track_stock: number; active: number } | undefined;
    if (!it || Number(it.track_stock) === 1 || Number(it.active) !== 1) errors.push({ code: 'pos_misc_item_invalid' });
    if (input.misc.max <= 0) errors.push({ code: 'pos_misc_over_max' });
  }
  if (input.display && /[<>]/.test(input.display.paymentText)) errors.push({ code: 'pos_display_text_invalid' });
  if (errors.length) throw invalid(errors);
  transaction(db, () => {
    if (input.rounding) writeSetting(db, 'pos_rounding', JSON.stringify(input.rounding));
    if (input.roundingAccount !== undefined) writeSetting(db, 'pos_rounding_account', input.roundingAccount ?? '');
    if (input.blindClose !== undefined) writeSetting(db, 'pos_blind_close', input.blindClose ? '1' : '0');
    if (input.supervisor) writeSetting(db, 'pos_supervisor', JSON.stringify(input.supervisor));
    if (input.misc) writeSetting(db, 'pos_misc', JSON.stringify(input.misc));
    if (input.display) writeSetting(db, 'pos_display', JSON.stringify({ ...input.display, paymentText: input.display.paymentText.trim() }));
    audit(db, user, 'update', 'pos_rules', null, input);
  });
  return tillRules(db);
}

// ——— the customer screen on another device ———

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** The basket each till shows now (in memory: a customer screen only ever needs the moment). */
const showing = new Map<string, { state: unknown; at: number }>();
const STATE_MAX = 24 * 1024;
/** wrong codes and keys per place (address) asking, a minute at a time */
const badTries = new Map<string, { n: number; since: number }>();
const CODE_MS = 10 * 60 * 1000;
const BAD_PER_MINUTE = 20;
/** for tests */
export function resetDisplayTries(): void { badTries.clear(); }
function badTry(source: string): void {
  const now = Date.now();
  const b = badTries.get(source);
  if (!b || now - b.since > 60_000) badTries.set(source, { n: 1, since: now });
  else b.n++;
  if (badTries.size > 5000) badTries.clear();
}
function lockedOut(source: string): boolean {
  const b = badTries.get(source);
  return !!b && Date.now() - b.since <= 60_000 && b.n >= BAD_PER_MINUTE;
}

/**
 * A new pairing code for a till's customer screen (the code before it stops working; screens already paired go on).
 * Six digits, kept only as a hash, for ten minutes and one pairing. Only for a till in the asker's branches.
 */
export function newDisplayCode(db: Db, tillId: string, user: string, actor?: Actor): { code: string } {
  const till = db.prepare('SELECT warehouse_id FROM pos_tills WHERE id = ?').get(tillId) as { warehouse_id: string } | undefined;
  if (!till) throw notFound('till');
  const lists = actor ? userBranchLists(db, actor) : null;
  if (lists && !lists.warehouses.includes(till.warehouse_id)) throw notFound('till');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  transaction(db, () => {
    db.prepare('DELETE FROM pos_display_codes WHERE till_id = ?').run(tillId);
    db.prepare('INSERT INTO pos_display_codes (till_id, code_hash, created_at) VALUES (?, ?, ?)').run(tillId, sha(`${tillId}:${code}`), new Date().toISOString());
    audit(db, user, 'display_code', 'pos_till', tillId, {});
  });
  return { code };
}

/**
 * Pairs a screen: a till's code (six digits, made in the last ten minutes) gives a long random key for that till, and
 * the code is used up. A right code always works; twenty wrong ones in a minute from one place stop that place only.
 */
export function pairDisplay(db: Db, code: string, source: string): { key: string } {
  if (/^\d{6}$/.test(code)) {
    const since = new Date(Date.now() - CODE_MS).toISOString();
    for (const r of db.prepare('SELECT till_id, code_hash, created_at FROM pos_display_codes').all() as { till_id: string; code_hash: string; created_at: string }[]) {
      if (sha(`${r.till_id}:${code}`) !== r.code_hash) continue;
      if (r.created_at < since) break;
      const key = randomBytes(32).toString('hex');
      transaction(db, () => {
        db.prepare('DELETE FROM pos_display_codes WHERE till_id = ?').run(r.till_id);
        db.prepare('INSERT INTO pos_display_keys (key_hash, till_id, created_at, seen_at) VALUES (?, ?, ?, NULL)').run(sha(key), r.till_id, new Date().toISOString());
        audit(db, 'customer screen', 'display_paired', 'pos_till', r.till_id, { source: source.slice(0, 60) });
      });
      return { key };
    }
  }
  if (lockedOut(source)) throw new AppError(429, 'too_many_requests', null);
  badTry(source);
  throw new AppError(404, 'not_found', { what: 'display_code' });
}

/** The till a paired screen's key is for (a key checked before the per-place lock, so others can't shut a screen out). */
function tillOfKey(db: Db, key: string, source: string): string {
  if (/^[0-9a-f]{64}$/.test(key)) {
    const r = db.prepare('SELECT till_id FROM pos_display_keys WHERE key_hash = ?').get(sha(key)) as { till_id: string } | undefined;
    if (r) return r.till_id;
  }
  if (lockedOut(source)) throw new AppError(429, 'too_many_requests', null);
  badTry(source);
  throw new AppError(404, 'not_found', { what: 'display_key' });
}

/** The till's basket, as the till sends it for its screens: only what a customer at the counter sees anyway. */
const stateBody = z.object({
  dir: z.enum(['rtl', 'ltr']), lang: z.enum(['ar', 'en', 'ku']), company: z.string().max(120), welcome: z.string().max(120), totalLabel: z.string().max(60),
  lines: z.array(z.object({ name: z.string().max(120), qty: z.string().max(30), amount: z.string().max(40), offer: z.string().max(80).optional() })).max(300),
  total: z.string().max(40),
  saved: z.object({ label: z.string().max(60), value: z.string().max(40) }).optional(),
  points: z.object({ label: z.string().max(60), value: z.string().max(40) }).optional(),
  paid: z.object({ label: z.string().max(60), value: z.string().max(80) }).optional(),
  change: z.object({ label: z.string().max(60), value: z.string().max(40) }).optional(),
  paying: z.boolean().optional(),
  done: z.string().max(120).optional()
}).strict();

export function showOnTill(db: Db, tillId: string, state: unknown, actor: Actor): { ok: true } {
  // only the person running a shift on that till (or an admin) speaks for its screen
  const open = db.prepare("SELECT id FROM pos_shifts WHERE till_id = ? AND status = 'open'").all(tillId) as { id: string }[];
  if (!actor.permissions.includes('admin') && !open.some((s) => getShift(db, s.id, actor).actions.includes('sell'))) throw new AppError(403, 'forbidden', { need: 'shift_owner' });
  if (JSON.stringify(state).length > STATE_MAX) throw invalid([{ code: 'pos_display_too_big' }]);
  showing.set(tillId, { state, at: Date.now() });
  return { ok: true };
}

/** What a paired screen shows: the till's basket now, the screen's rules, the offers running and the pictures' ids. */
export function displayFeed(db: Db, key: string, source = '') {
  const tillId = tillOfKey(db, key, source);
  const rules = tillRules(db).display;
  const now = showing.get(tillId);
  const today = todayIso();
  const offers = (db.prepare(`SELECT name_ar, name_en, name_ku FROM offers WHERE active = 1 AND (starts_on IS NULL OR starts_on <= ?) AND (ends_on IS NULL OR ends_on >= ?)
                              ORDER BY priority DESC LIMIT 12`).all(today, today) as { name_ar: string; name_en: string; name_ku: string }[])
    .map((o) => ({ ar: o.name_ar, en: o.name_en, ku: o.name_ku }));
  const images = (db.prepare('SELECT id FROM pos_display_images ORDER BY sort, created_at').all() as { id: string }[]).map((r) => r.id);
  let company = { ar: '', en: '', ku: '' };
  try { company = { ...company, ...(JSON.parse(readSetting(db, 'company_name') ?? '{}') as typeof company) }; } catch { /* the name stays empty */ }
  const logo = getPrintProfile(db).logo;
  return {
    state: now && Date.now() - now.at < 12 * 60 * 60 * 1000 ? now.state : null, display: rules, offers: rules.slideshow ? offers : [], images: rules.slideshow ? images : [], company,
    logo: logo ? { mime: logo.mime, data: logo.data } : null
  };
}

export function displayImage(db: Db, key: string, id: string, source = ''): { mime: string; data: string } {
  tillOfKey(db, key, source);
  const r = db.prepare('SELECT mime, data FROM pos_display_images WHERE id = ?').get(id) as { mime: string; data: string } | undefined;
  if (!r) throw notFound('image');
  return r;
}

export const DISPLAY_IMAGES_MAX = 12;

export function addDisplayImage(db: Db, base64: string, user: string): { id: string } {
  const bytes = fromBase64(base64);
  if (!bytes || !bytes.length) throw invalid([{ code: 'image_invalid' }]);
  if (bytes.length > MAX_IMAGE_BYTES) throw invalid([{ code: 'image_too_big', max: MAX_IMAGE_BYTES } as { code: string }]);
  const mime = imageMime(bytes);
  if (!mime) throw invalid([{ code: 'image_type' }]);
  const n = Number((db.prepare('SELECT COUNT(*) AS n FROM pos_display_images').get() as { n: number }).n);
  if (n >= DISPLAY_IMAGES_MAX) throw conflict('pos_display_images_full', { max: DISPLAY_IMAGES_MAX });
  const id = randomUUID();
  db.prepare('INSERT INTO pos_display_images (id, mime, data, sort, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, mime, Buffer.from(bytes).toString('base64'), n, user, new Date().toISOString());
  audit(db, user, 'create', 'pos_display_image', id, { mime, bytes: bytes.length });
  return { id };
}

// ——— the API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}
const id = z.string().min(1).max(64);

/**
 * Rules for who reaches what (checked before the routes run, routes.ts). Reading the till's rules, asking for an
 * approval, reading a customer's debt, selling and looking up a voucher, and speaking for the till's screen need the
 * Point of sale permission; a supervisor sets their own PIN; the rules, the screen's pictures, cancelling a voucher and
 * the voucher report are an admin's (as every change not listed). The paired screen reads its feed with its code alone.
 */
export const tillRulesApi: ApiExtension = {
  rules: {
    'GET /api/pos/rules': 'pos',
    'POST /api/pos/approve': 'pos',
    'PUT /api/pos/pin': 'posSupervise',
    'GET /api/pos/customer/:id': 'pos',
    'POST /api/pos/shifts/:id/gift-vouchers': 'pos',
    'GET /api/pos/gift-vouchers/lookup': 'pos',
    'POST /api/pos/display/state': 'pos',
    'POST /api/pos/display/code': 'pos',
    // the codes of vouchers sold are worth money: the list is an admin's
    'GET /api/pos/gift-vouchers': 'admin',
    'POST /api/pos/gift-vouchers/expire': 'admin',
    // the screen's pictures are shown to customers anyway: a till reads them for the screen beside it
    'GET /api/pos/display/images': 'pos',
    'GET /api/pos/display/image-admin/:id': 'pos'
  },
  public: ['POST /api/pos/display/pair', 'GET /api/pos/display/feed', 'GET /api/pos/display/image/:id'],
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      { method: 'GET', path: '/api/pos/rules', handler: async (req) => rulesForTill(db, actor(req)) },
      { method: 'PUT', path: '/api/pos/rules', handler: async (req) => saveRules(db, parse(rulesBody, req.body), actor(req).name) },
      {
        method: 'POST', path: '/api/pos/approve',
        handler: async (req) => approve(db, parse(z.object({
          shiftId: id, action: z.enum(APPROVAL_ACTIONS), pin: z.string().max(12), detail: z.string().max(300).optional()
        }), req.body), actor(req))
      },
      { method: 'DELETE', path: '/api/pos/pin-alert', handler: async (req) => { writeSetting(db, 'pos_pin_alert', ''); audit(db, actor(req).name, 'seen', 'pos_pin_alert', null, {}); return { ok: true }; } },
      { method: 'PUT', path: '/api/pos/pin', handler: async (req) => setPin(db, actor(req), parse(z.object({ pin: z.string().max(12) }), req.body).pin) },
      {
        method: 'GET', path: '/api/pos/customer/:id',
        handler: async (req) => {
          const p = getParty(db, parse(z.object({ id }), req.params).id);
          if (p.type !== 'customer') throw notFound('party');
          return { id: p.id, balance: p.balance, creditLimit: p.creditLimit, overLimit: p.creditLimit !== null && p.balance > p.creditLimit };
        }
      },
      {
        method: 'POST', path: '/api/pos/shifts/:id/gift-vouchers',
        handler: async (req, reply) => {
          const who = actor(req);
          const shift = getShift(db, parse(z.object({ id }), req.params).id, who);
          if (shift.status !== 'open') throw conflict('pos_shift_closed');
          if (!shift.actions.includes('sell')) throw new AppError(403, 'forbidden', { need: 'shift_owner' });
          const body = parse(z.object({ amount: z.number().int().positive(), expiresOn: z.string().max(10).optional() }), req.body);
          reply.status(201).send(transaction(db, () => sellGiftVoucher(db, { id: shift.id, cashAccount: shift.cashAccountCode }, body, who)));
          return undefined;
        }
      },
      {
        method: 'GET', path: '/api/pos/gift-vouchers/lookup',
        handler: async (req) => {
          const v = findGiftVoucher(db, parse(z.object({ code: z.string().min(4).max(40) }), req.query).code);
          if (!v) throw notFound('gift_voucher');
          return v;
        }
      },
      { method: 'GET', path: '/api/pos/gift-vouchers', handler: async () => giftReport(db) },
      {
        method: 'POST', path: '/api/pos/gift-vouchers/expire',
        handler: async (req) => writeOffExpired(db, actor(req), parse(z.object({ incomeAccount: z.string().max(12).optional() }), req.body ?? {}).incomeAccount)
      },
      { method: 'POST', path: '/api/pos/gift-vouchers/:id/cancel', handler: async (req) => transaction(db, () => cancelGiftVoucher(db, parse(z.object({ id }), req.params).id, actor(req).name)) },
      { method: 'POST', path: '/api/pos/display/code', handler: async (req) => newDisplayCode(db, parse(z.object({ tillId: id }), req.body).tillId, actor(req).name, actor(req)) },
      { method: 'POST', path: '/api/pos/display/pair', handler: async (req) => pairDisplay(db, parse(z.object({ code: z.string().max(12) }), req.body).code, req.source ?? '') },
      {
        method: 'POST', path: '/api/pos/display/state',
        handler: async (req) => {
          const body = parse(z.object({ tillId: id, state: stateBody }), req.body);
          return showOnTill(db, body.tillId, body.state, actor(req));
        }
      },
      { method: 'GET', path: '/api/pos/display/feed', handler: async (req) => displayFeed(db, parse(z.object({ key: z.string().max(80) }), req.query).key, req.source ?? '') },
      {
        method: 'GET', path: '/api/pos/display/image/:id',
        handler: async (req) => displayImage(db, parse(z.object({ key: z.string().max(80) }), req.query).key, parse(z.object({ id }), req.params).id, req.source ?? '')
      },
      { method: 'GET', path: '/api/pos/display/images', handler: async () => ({ images: (db.prepare('SELECT id, mime, sort FROM pos_display_images ORDER BY sort, created_at').all() as { id: string }[]), max: DISPLAY_IMAGES_MAX }) },
      {
        method: 'POST', path: '/api/pos/display/images',
        handler: async (req, reply) => { reply.status(201).send(addDisplayImage(db, parse(z.object({ base64: z.string().max(MAX_IMAGE_BYTES * 2) }), req.body).base64, actor(req).name)); return undefined; }
      },
      {
        method: 'DELETE', path: '/api/pos/display/images/:id',
        handler: async (req) => {
          const imageId = parse(z.object({ id }), req.params).id;
          db.prepare('DELETE FROM pos_display_images WHERE id = ?').run(imageId);
          audit(db, actor(req).name, 'delete', 'pos_display_image', imageId, {});
          return { ok: true };
        }
      },
      { method: 'GET', path: '/api/pos/display/image-admin/:id', handler: async (req) => {
        const r = db.prepare('SELECT mime, data FROM pos_display_images WHERE id = ?').get(parse(z.object({ id }), req.params).id) as { mime: string; data: string } | undefined;
        if (!r) throw notFound('image');
        return r;
      } }
    ];
  }
};
