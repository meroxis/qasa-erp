import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { onceOnly } from './idempotency.ts';
import { z } from 'zod';
import { isCashRounding, todayIso } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { readSetting, writeSetting } from './settings.ts';
import { hashPassword, signInRequired, verifyPassword, type Actor } from './auth.ts';
import { getParty } from './parties.ts';
import { getShift, OFFLINE_REFERENCE } from './pos.ts';
import { userBranchLists } from './branches.ts';
import { imageMime, fromBase64, MAX_IMAGE_BYTES } from './media.ts';
import { getPrintProfile } from './print-profile.ts';
import { cancelGiftVoucher, findGiftVoucher, getGiftVoucher, giftReport, sellGiftVoucher, writeOffExpired } from './gift-vouchers.ts';
import {
  APPROVAL_ACTIONS, APPROVAL_MS, maySellMisc, maySupervise, OFFLINE_APPROVAL_MS, PRICE_APPROVAL_MS, priceSubject, RATE_BAND, RATE_FREE, rateSubject, referenceRate, TILL_ONLY_ACTIONS, tillRules, type ApprovalAction, type TillRules
} from './till-settings.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * The till's rules and what goes with them (2.0, Iraqi markets): the rules themselves (till-settings.ts), supervisors'
 * PINs and the approvals they give at a till, a customer's debt read at the till, gift vouchers sold and looked up there,
 * and the customer screen on another device (a tablet or a second PC) paired to a till with a code.
 *
 * A PIN is a supervisor's own (6–8 digits; one set before 2.0 may still be 4 or 5 until it is changed), stored as a
 * password is (scrypt). An approval is given for one action at one shift, to one cashier, for one very thing (the
 * invoice and lines of a refund, the item and price, the discount, the customer and amount: boundTo) and used once
 * within two minutes (a price: twenty, while the basket is rung up); each one, and each PIN that failed, is written to
 * the audit log. The counts of wrong PINs are kept in the database (pos_pin_tries), so a restart does not clear them.
 * Wrong PINs are counted per cashier (whatever shift they type them at: opening another shift does not start the count
 * again; with sign-in off every PC is the owner, so they are counted per till) and for the whole company: five from
 * one cashier within fifteen minutes of the first lock that cashier's approvals for fifteen minutes, twenty from
 * everyone in ten minutes lock every till's for ten; fifteen wrong PINs from one signed-in cashier in a day stop that
 * cashier's approvals until the next day. A right PIN starts the cashier's count again (a typo an hour never adds up
 * to a lock). Each lock is written to the audit log and shown to an admin in Settings, who can lift it there. Approvals need the server: a till that can't
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
/** a cashier's wrong PINs in one day (however slowly they come): their approvals stop until tomorrow, and an admin is told */
const DAY_LOCK_AFTER = 15;
/** Who the wrong PINs are counted for: the signed-in cashier; with sign-in off (every PC is the owner) the till they are typed at. */
const cashierKey = (db: Db, a: Pick<Actor, 'id' | 'name'>, register?: string | null): string =>
  signInRequired(db) && a.id ? `u:${a.id}` : register ? `t:${register.trim().toLowerCase()}` : a.id ? `u:${a.id}` : `n:${a.name}`;

/**
 * Wrong PINs are counted in the database (pos_pin_tries), per cashier (by user id, or name with sign-in off) and under
 * 'all' for the whole company: a restart, or a second server process on the same database, does not start the count
 * again. Each step is one statement, so two processes counting at once never lose a try.
 */
interface Tries { n: number; since: string; locked_until: string | null; day_on: string | null; day_n: number }
const readTries = (db: Db, k: string): Tries | undefined => {
  const r = db.prepare('SELECT n, since, locked_until, day_on, day_n FROM pos_pin_tries WHERE k = ?').get(k) as unknown as Tries | undefined;
  return r ? { n: Number(r.n), since: r.since, locked_until: r.locked_until, day_on: r.day_on, day_n: Number(r.day_n) } : undefined;
};
function ensureTries(db: Db, k: string, nowIso: string): void {
  if (readTries(db, k)) return;
  try { db.prepare('INSERT INTO pos_pin_tries (k, n, since, locked_until, day_on, day_n) VALUES (?, 0, ?, NULL, NULL, 0)').run(k, nowIso); } catch { /* another process made it first */ }
}
/** for tests: forget the counts */
export function resetPinFailures(db?: Db): void { db?.prepare('DELETE FROM pos_pin_tries').run(); }

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

/** What a supervisor is asked to approve, beside the action (each kept on the approval and held to when it is used). */
export interface ApprovalAsk {
  shiftId: string; action: ApprovalAction; pin: string; detail?: string | undefined;
  /** a refund: the sale, and for a return the lines and quantities coming back (none: the whole sale, a cancel) */
  invoiceId?: string | undefined; lines?: { lineNo: number; qtyMilli: number }[] | undefined;
  /** a lower price: the item, the unit when not its own, and the price (`amount`, per that unit) */
  itemId?: string | undefined; unit?: string | undefined;
  /** credit over the limit: the customer, and the amount going on their account (`amount`) */
  partyId?: string | undefined;
  /** a kept sale the server refused for want of a supervisor: the temporary reference on its receipt, and what it is worth (`amount`) */
  reference?: string | undefined;
  /** the lowest price, the largest discount, the largest amount on account, or the least a kept sale is worth */
  amount?: number | undefined;
  /** a lower price: the currency the line is sold in */
  currency?: 'IQD' | 'USD' | undefined;
  /** a discount: the basket it is given on (before discounts) */
  gross?: number | undefined;
  /** dollars at a rate away from the day's: dollar notes on a dinar sale ('notes') or a dollar sale ('sale'), and the rate */
  rate?: { kind: 'notes' | 'sale'; rateX100: number } | undefined;
}

/** What the approval is bound to, from what was asked: refused when the action's own details are missing. */
interface Bound { subject: string | null; amount: number | null; currency: string | null; gross: number | null; scope: string | null }
function boundTo(db: Db, input: Omit<ApprovalAsk, 'shiftId' | 'pin'>): Bound {
  const amount = Number.isSafeInteger(input.amount) && input.amount! >= 0 ? input.amount! : null;
  const none = { currency: null, gross: null, scope: null };
  if (input.action === 'price') {
    const it = input.itemId ? db.prepare('SELECT unit FROM items WHERE id = ?').get(input.itemId) as { unit: string } | undefined : undefined;
    if (!it || amount === null || (input.currency !== 'IQD' && input.currency !== 'USD')) throw invalid([{ code: 'pos_approval_incomplete' }]);
    return { ...none, subject: priceSubject(input.itemId!, input.unit && input.unit !== it.unit ? input.unit : null), amount, currency: input.currency };
  }
  if (input.action === 'discount') {
    if (amount === null || !Number.isSafeInteger(input.gross) || input.gross! <= 0 || amount > input.gross!) throw invalid([{ code: 'pos_approval_incomplete' }]);
    return { ...none, subject: null, amount, gross: input.gross! };
  }
  if (input.action === 'credit_over') {
    if (!input.partyId || amount === null) throw invalid([{ code: 'pos_approval_incomplete' }]);
    return { ...none, subject: input.partyId, amount };
  }
  if (input.action === 'refund') {
    if (!input.invoiceId || !db.prepare("SELECT 1 FROM invoices WHERE id = ? AND kind IN ('sale', 'sale_return')").get(input.invoiceId)) throw invalid([{ code: 'pos_approval_incomplete' }]);
    const lines = input.lines?.filter((l) => l.qtyMilli > 0);
    return { ...none, subject: input.invoiceId, amount: null, scope: lines?.length ? JSON.stringify(lines.map((l) => [l.lineNo, l.qtyMilli])) : null };
  }
  if (input.action === 'offline_sale') {
    if (!input.reference || !OFFLINE_REFERENCE.test(input.reference) || amount === null) throw invalid([{ code: 'pos_approval_incomplete' }]);
    return { ...none, subject: input.reference, amount };
  }
  if (input.action === 'rate') {
    const r = input.rate;
    if (!r || (r.kind !== 'notes' && r.kind !== 'sale') || !Number.isSafeInteger(r.rateX100) || r.rateX100 <= 0) throw invalid([{ code: 'pos_approval_incomplete' }]);
    return { ...none, subject: rateSubject(r.kind, r.rateX100), amount: null };
  }
  return { ...none, subject: null, amount: null };
}

/**
 * A supervisor's PIN, typed by someone who may not approve themselves: counted first (so a burst sent at once can't
 * all pass the lock while the first ones are still being checked), then checked. `key` is who the wrong ones are
 * counted for; `shiftId` where they were typed (for the audit log; none: the office). The supervisor found is never
 * the one asking, unless that one is an admin.
 */
async function supervisorByPin(db: Db, asker: Actor, key: string, pin: string, where: { shiftId: string | null; action: ApprovalAction }): Promise<Supervisor> {
  const now0 = Date.now();
  const nowIso = new Date(now0).toISOString();
  const today = todayIso(new Date(now0));
  const signedIn = signInRequired(db) && !!asker.id;
  ensureTries(db, 'all', nowIso);
  ensureTries(db, key, nowIso);
  const secondsTo = (iso: string) => Math.max(1, Math.ceil((Date.parse(iso) - now0) / 1000));
  const all = readTries(db, 'all')!;
  if (all.locked_until && all.locked_until > nowIso) throw conflict('pin_locked', { seconds: secondsTo(all.locked_until) });
  // a new ten minutes for the company's count
  db.prepare('UPDATE pos_pin_tries SET n = 0, since = ? WHERE k = ? AND since <= ?').run(nowIso, 'all', new Date(now0 - ALL_WINDOW_MS).toISOString());
  const mine = readTries(db, key)!;
  if (mine.locked_until && mine.locked_until > nowIso) throw conflict('pin_locked', { seconds: secondsTo(mine.locked_until) });
  // the day's lock is a signed-in cashier's own: with sign-in off the count is a till's, which must not stop for a day
  if (signedIn && mine.day_on === today && mine.day_n >= DAY_LOCK_AFTER) {
    const tomorrow = new Date(now0); tomorrow.setHours(24, 0, 0, 0);
    throw conflict('pin_locked', { seconds: secondsTo(tomorrow.toISOString()) });
  }
  // the count starts again when its lock has run out, or fifteen minutes after its FIRST wrong PIN (a window that
  // does not move with each try: a typo now and then never adds up)
  db.prepare('UPDATE pos_pin_tries SET n = 0, since = ?, locked_until = NULL WHERE k = ? AND ((locked_until IS NOT NULL AND locked_until <= ?) OR (locked_until IS NULL AND (n = 0 OR since <= ?)))')
    .run(nowIso, key, nowIso, new Date(now0 - LOCK_MS).toISOString());
  db.prepare('UPDATE pos_pin_tries SET day_n = 0, day_on = ? WHERE k = ? AND (day_on IS NULL OR day_on <> ?)').run(today, key, today);
  // counted before the slow PIN check; the fifth locks at once (lifted again below if this PIN is right)
  db.prepare('UPDATE pos_pin_tries SET n = n + 1, day_n = day_n + 1 WHERE k = ?').run(key);
  db.prepare('UPDATE pos_pin_tries SET locked_until = ? WHERE k = ? AND n >= ? AND locked_until IS NULL').run(new Date(now0 + LOCK_MS).toISOString(), key, LOCK_AFTER);
  db.prepare('UPDATE pos_pin_tries SET n = n + 1 WHERE k = ?').run('all');
  const counted = readTries(db, key)!;
  const n = counted.n;
  if (n > LOCK_AFTER) throw conflict('pin_locked', { seconds: secondsTo(counted.locked_until ?? new Date(now0 + LOCK_MS).toISOString()) });
  const fail = (self: boolean): never => {
    audit(db, asker.name, 'pin_failed', where.shiftId ? 'pos_shift' : 'pos_rules', where.shiftId, { action: where.action, tries: n, self });
    if (n === LOCK_AFTER) pinAlert(db, { scope: 'cashier', cashier: asker.name, tries: n });
    // slow guessing (a few tries, a wait, a few more) never reaches the short lock: the day's count does
    else if (signedIn && counted.day_n === DAY_LOCK_AFTER) pinAlert(db, { scope: 'cashier', cashier: asker.name, tries: counted.day_n });
    const everyone = readTries(db, 'all')!;
    if (everyone.n >= ALL_LOCK_AFTER && !(everyone.locked_until && everyone.locked_until > new Date().toISOString())) {
      db.prepare('UPDATE pos_pin_tries SET locked_until = ? WHERE k = ?').run(new Date(Date.now() + ALL_LOCK_MS).toISOString(), 'all');
      pinAlert(db, { scope: 'all', cashier: asker.name, tries: everyone.n });
    }
    throw invalid([{ code: self ? 'pin_self' : 'pin_wrong' }]);
  };
  if (!PIN.test(pin)) fail(false);
  let found: Supervisor | null = null;
  for (const s of supervisors(db)) {
    if (await verifyPassword(pin, s.hash)) { found = s; break; }
  }
  if (!found || (found.id === asker.id && !asker.permissions.includes('admin'))) return fail(!!found);
  // a right PIN: this try is not a wrong one, and the cashier's count starts again
  db.prepare('UPDATE pos_pin_tries SET n = 0, locked_until = NULL, day_n = CASE WHEN day_n > 0 THEN day_n - 1 ELSE 0 END WHERE k = ?').run(key);
  db.prepare('UPDATE pos_pin_tries SET n = CASE WHEN n > 0 THEN n - 1 ELSE 0 END WHERE k = ?').run('all');
  return found;
}

function writeApproval(db: Db, input: { shiftId: string | null; action: ApprovalAction; detail?: string | undefined }, bound: Bound, found: Supervisor, asker: Actor): ApprovalView {
  const token = randomUUID();
  const now = new Date();
  // a lower price is approved while the basket is still being rung up: it waits longer for its sale than the others
  const expiresAt = new Date(now.getTime() + (input.action === 'price' ? PRICE_APPROVAL_MS : input.action === 'offline_sale' ? OFFLINE_APPROVAL_MS : APPROVAL_MS)).toISOString();
  const used = TILL_ONLY_ACTIONS.includes(input.action);
  const detail = input.detail?.trim().slice(0, 300) || null;
  db.prepare(`INSERT INTO till_approvals (id, shift_id, action, approver, approver_id, cashier, cashier_id, subject, amount, currency, gross, scope, detail, created_at, expires_at, used_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(token, input.shiftId, input.action, found.name, found.id, asker.name, asker.id ?? null, bound.subject, bound.amount, bound.currency, bound.gross, bound.scope, detail,
      now.toISOString(), expiresAt, used ? now.toISOString() : null);
  audit(db, asker.name, 'supervisor_ok', input.shiftId ? 'pos_shift' : 'invoice', input.shiftId ?? bound.subject, {
    action: input.action, approver: found.name, detail, ...(bound.subject ? { subject: bound.subject } : {}), ...(bound.amount !== null ? { amount: bound.amount } : {}),
    ...(bound.currency ? { currency: bound.currency } : {}), ...(bound.gross !== null ? { gross: bound.gross } : {})
  });
  return { token, approver: found.name, action: input.action, expiresAt, used };
}

/**
 * A supervisor's PIN typed at a till for `action`: the approval, for that shift, that cashier and that very thing
 * (boundTo). The cashier never approves their own till unless they are an admin. An action done at the till alone
 * (TILL_ONLY_ACTIONS) is used as it is given.
 */
export async function approve(db: Db, input: ApprovalAsk, cashier: Actor): Promise<ApprovalView> {
  const shift = getShift(db, input.shiftId, cashier);
  if (shift.status !== 'open') throw conflict('pos_shift_closed');
  if (!shift.actions.includes('sell')) throw new AppError(403, 'forbidden', { need: 'shift_owner' });
  const bound = boundTo(db, input);
  const found = await supervisorByPin(db, cashier, cashierKey(db, cashier, shift.register), input.pin, { shiftId: input.shiftId, action: input.action });
  return writeApproval(db, input, bound, found, cashier);
}

/**
 * A refund asked from the office (the invoice screens: a return or a cancel there, review of the fixes, finding 7):
 * when the company's rule asks a supervisor for refunds and the money leaves a till's safe, someone with the sales
 * permission who neither supervises nor is an admin brings a supervisor to type their PIN on that screen. The approval
 * is for that invoice (and, for a return, those lines), that person, once, within two minutes; it belongs to no shift.
 */
export async function approveOfficeRefund(db: Db, input: { invoiceId: string; lines?: { lineNo: number; qtyMilli: number }[] | undefined; pin: string; detail?: string | undefined }, asker: Actor): Promise<ApprovalView> {
  const bound = boundTo(db, { action: 'refund', invoiceId: input.invoiceId, lines: input.lines });
  const found = await supervisorByPin(db, asker, cashierKey(db, asker), input.pin, { shiftId: null, action: 'refund' });
  return writeApproval(db, { shiftId: null, action: 'refund', detail: input.detail }, bound, found, asker);
}

/** An admin lifts the locks wrong PINs left (every till's and each cashier's, the day's too) and clears the notice; written to the audit log. */
export function unlockPins(db: Db, user: string): { ok: true } {
  const locked = (db.prepare('SELECT k FROM pos_pin_tries WHERE n > 0 OR day_n > 0 OR locked_until IS NOT NULL').all() as { k: string }[]).map((r) => r.k);
  db.prepare('DELETE FROM pos_pin_tries').run();
  writeSetting(db, 'pos_pin_alert', '');
  audit(db, user, 'pin_unlock', 'pos_rules', null, { keys: locked });
  return { ok: true };
}

/** What the till reads of its rules: everything but who may sell the open-price item (only whether this person may). */
export function rulesForTill(db: Db, actor: Actor) {
  const rules = tillRules(db);
  return {
    rounding: rules.rounding, blindClose: rules.blindClose, supervisor: rules.supervisor,
    misc: { itemId: rules.misc.itemId, max: rules.misc.max, allowed: maySellMisc(rules.misc, actor) },
    display: rules.display,
    // the rate dollars are held to today (the rate board's, else the company's) and how far a typed one may be from it
    rate: { referenceX100: referenceRate(db), freePct: RATE_FREE * 100, bandPct: RATE_BAND * 100 },
    mayApprove: maySupervise(actor), hasPin: hasPin(db, actor.id), pinShort: pinShort(db, actor.id),
    // (the day's lock is a signed-in cashier's, counted under their own key, for today)
    pinLocked: actor.permissions.includes('admin') && !!db.prepare("SELECT 1 FROM pos_pin_tries WHERE locked_until > ? OR (day_n >= ? AND day_on = ? AND k LIKE 'u:%')")
      .get(new Date().toISOString(), DAY_LOCK_AFTER, todayIso()),
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
    // asked by whoever makes the refund on the invoice screens
    'POST /api/refund-approvals': 'sales',
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
          shiftId: id, action: z.enum(APPROVAL_ACTIONS), pin: z.string().max(12), detail: z.string().max(300).optional(),
          invoiceId: id.optional(), lines: z.array(z.object({ lineNo: z.number().int().min(1), qtyMilli: z.number().int().min(0).max(1e12) })).max(500).optional(),
          itemId: id.optional(), unit: z.string().max(32).optional(), partyId: id.optional(), reference: z.string().max(40).optional(), amount: z.number().int().nonnegative().max(1e15).optional(),
          currency: z.enum(['IQD', 'USD']).optional(), gross: z.number().int().positive().max(1e15).optional(),
          rate: z.object({ kind: z.enum(['notes', 'sale']), rateX100: z.number().int().positive().max(1e12) }).optional()
        }), req.body), actor(req))
      },
      {
        // a supervisor's PIN typed on an invoice screen for a refund there (no shift)
        method: 'POST', path: '/api/refund-approvals',
        handler: async (req) => approveOfficeRefund(db, parse(z.object({
          invoiceId: id, pin: z.string().max(12), detail: z.string().max(300).optional(),
          lines: z.array(z.object({ lineNo: z.number().int().min(1), qtyMilli: z.number().int().min(0).max(1e12) })).max(500).optional()
        }), req.body), actor(req))
      },
      { method: 'POST', path: '/api/pos/pin-unlock', handler: async (req) => unlockPins(db, actor(req).name) },
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
          reply.status(201).send(onceOnly(db, req, reply, who, 'POST /api/pos/shifts/:id/gift-vouchers',
            () => { const v = transaction(db, () => sellGiftVoucher(db, { id: shift.id, cashAccount: shift.cashAccountCode }, body, who)); return { id: v.id, result: v }; },
            (v) => getGiftVoucher(db, v)));
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
      { method: 'POST', path: '/api/pos/gift-vouchers/:id/cancel', handler: async (req) => transaction(db, () => cancelGiftVoucher(db, parse(z.object({ id }), req.params).id, actor(req),
          // (a voucher a refund made is paid out of a safe: this one, else the company's cash account)
          parse(z.object({ cashAccountCode: z.string().max(12).optional() }), req.body ?? {}).cashAccountCode)) },
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
