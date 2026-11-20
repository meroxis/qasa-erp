import { isCashRounding, NO_ROUNDING, type CashRounding } from '@qasa/core';
import type { Db } from './db.ts';
import { audit } from './audit.ts';
import { conflict, invalid } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { readSetting } from './settings.ts';
import { seesBooks, type Actor } from './auth.ts';

/**
 * The till's rules (2.0, Iraqi markets), as settings: dinar rounding, a blind close, what needs a supervisor's PIN,
 * the open-price "miscellaneous" item, and the customer screen. Read by the sale (pos.ts) and the till's own API
 * (till-rules.ts). Every rule is off until an admin turns it on, so a till works as before.
 */

export const APPROVAL_ACTIONS = ['line_delete', 'void', 'price', 'discount', 'no_sale', 'refund', 'credit_over', 'blind_view'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
/** Approved at the till and done there (nothing the server books): the approval is used as it is given. */
export const TILL_ONLY_ACTIONS: readonly ApprovalAction[] = ['line_delete', 'void', 'blind_view'];
/** How long an approval waits for the action it was given for. */
export const APPROVAL_MS = 2 * 60 * 1000;

export interface SupervisorRules {
  lineDelete: boolean; void: boolean; price: boolean;
  /** a discount above this share of the sale (percent) needs a PIN; 0 = never */
  discountPct: number;
  noSale: boolean; refund: boolean; creditOver: boolean;
}
export const NO_SUPERVISOR: SupervisorRules = { lineDelete: false, void: false, price: false, discountPct: 0, noSale: false, refund: false, creditOver: false };

export interface MiscRules {
  /** the open-price item (a service the admin made, e.g. "Miscellaneous"); null = off */
  itemId: string | null;
  /** the most one line of it may be (dinars) */
  max: number;
  /** the users who may sell it (ids); null = every cashier */
  users: string[] | null;
}
export const NO_MISC: MiscRules = { itemId: null, max: 0, users: null };

export interface DisplayRules {
  /** the language the customer screen shows: the till's own, or one the admin chose */
  lang: 'till' | 'ar' | 'en' | 'ku';
  /** shown at payment: the shop's FIB or ZainCash number, or any short text (plain text, never HTML) */
  paymentText: string;
  /** the offers and the admin's pictures while the till is idle */
  slideshow: boolean;
}
export const DEFAULT_DISPLAY: DisplayRules = { lang: 'till', paymentText: '', slideshow: true };

export interface TillRules {
  rounding: CashRounding;
  /** the account the rounding goes to; null = other revenue (49…) for up, other expenses (39…) for down */
  roundingAccount: string | null;
  blindClose: boolean;
  supervisor: SupervisorRules;
  misc: MiscRules;
  display: DisplayRules;
}

function json<T>(db: Db, key: string): Partial<T> | null {
  try { const raw = readSetting(db, key); return raw ? JSON.parse(raw) as Partial<T> : null; } catch { return null; }
}

export function tillRules(db: Db): TillRules {
  const rounding = json<CashRounding>(db, 'pos_rounding');
  const sup = json<SupervisorRules>(db, 'pos_supervisor') ?? {};
  const misc = json<MiscRules>(db, 'pos_misc') ?? {};
  const display = json<DisplayRules>(db, 'pos_display') ?? {};
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    rounding: isCashRounding(rounding) ? rounding : NO_ROUNDING,
    roundingAccount: readSetting(db, 'pos_rounding_account') || null,
    blindClose: readSetting(db, 'pos_blind_close') === '1',
    supervisor: {
      lineDelete: bool(sup.lineDelete, false), void: bool(sup.void, false), price: bool(sup.price, false),
      discountPct: Number.isInteger(sup.discountPct) && sup.discountPct! >= 0 && sup.discountPct! <= 100 ? sup.discountPct! : 0,
      noSale: bool(sup.noSale, false), refund: bool(sup.refund, false), creditOver: bool(sup.creditOver, false)
    },
    misc: {
      itemId: typeof misc.itemId === 'string' && misc.itemId ? misc.itemId : null,
      max: Number.isSafeInteger(misc.max) && misc.max! > 0 ? misc.max! : 0,
      users: Array.isArray(misc.users) ? misc.users.filter((u): u is string => typeof u === 'string') : null
    },
    display: {
      lang: (['till', 'ar', 'en', 'ku'] as const).includes(display.lang as 'till') ? display.lang! : 'till',
      paymentText: typeof display.paymentText === 'string' ? display.paymentText.slice(0, 200) : '',
      slideshow: bool(display.slideshow, true)
    }
  };
}

/** Whoever may approve at a till: a supervisor (posSupervise) or an admin. */
export const maySupervise = (actor: Pick<Actor, 'permissions'>): boolean => actor.permissions.includes('posSupervise') || actor.permissions.includes('admin');

/** This person may sell the open-price item. */
export const maySellMisc = (rules: MiscRules, actor: Pick<Actor, 'id'>): boolean =>
  !!rules.itemId && rules.max > 0 && (rules.users === null || (!!actor.id && rules.users.includes(actor.id)));

/** The account a rounding of `diff` dinars goes to (see TillRules.roundingAccount). */
export function roundingAccount(db: Db, diff: number): string {
  const chosen = tillRules(db).roundingAccount;
  const accounts = loadAccounts(db).filter((a) => a.postable);
  if (chosen && accounts.some((a) => a.code === chosen)) return chosen;
  const root = diff > 0 ? '49' : '39';
  const a = accounts.filter((x) => x.code.startsWith(root)).sort((x, y) => x.code.localeCompare(y.code))[0];
  if (!a) throw conflict('pos_rounding_account_missing');
  return a.code;
}

/**
 * Uses one approval a supervisor gave at this shift's till for `action`: unused, not expired. Inside the sale's (or the
 * drawer's) transaction; refused otherwise, so one PIN never approves two things.
 */
export function useApproval(db: Db, tokens: readonly string[] | undefined, shiftId: string, action: ApprovalAction, user: string): string {
  const now = new Date().toISOString();
  for (const token of tokens ?? []) {
    const r = db.prepare('SELECT id, approver FROM pos_approvals WHERE id = ? AND shift_id = ? AND action = ? AND used_at IS NULL AND expires_at >= ?')
      .get(token, shiftId, action, now) as { id: string; approver: string } | undefined;
    if (!r) continue;
    db.prepare('UPDATE pos_approvals SET used_at = ? WHERE id = ? AND used_at IS NULL').run(now, r.id);
    audit(db, user, 'approval_used', 'pos_shift', shiftId, { action, approver: r.approver, approval: r.id });
    return r.approver;
  }
  throw invalid([{ code: 'pos_needs_supervisor', action }]);
}

/**
 * A refund of a till sale (a return, a cancel, an exchange at the till) when the rule asks a supervisor for refunds:
 * someone who neither supervises nor is an admin brings an approval given at one of their own open shifts. Checked by
 * the server whatever screen asks (the till asks for the PIN first). Sales made elsewhere are not the till's rule.
 */
export function assertRefundApproved(db: Db, invoiceId: string, actor: Pick<Actor, 'name' | 'permissions' | 'roles'> | undefined, tokens: readonly string[] | undefined): void {
  if (!tillRules(db).supervisor.refund || !actor) return;
  if (!db.prepare('SELECT 1 FROM pos_sales WHERE invoice_id = ?').get(invoiceId)) return;
  if (actor.permissions.includes('admin') || maySupervise(actor)) return;
  // (an approval is given only at a shift of the cashier who asked for it: any open shift may hold theirs)
  const shifts = db.prepare("SELECT id FROM pos_shifts WHERE status = 'open'").all() as { id: string }[];
  for (const s of shifts) {
    try { useApproval(db, tokens, s.id, 'refund', actor.name); return; } catch { /* the next shift */ }
  }
  throw invalid([{ code: 'pos_needs_supervisor', action: 'refund' }]);
}

/** Whether this person closes blind: the rule is on and they neither supervise nor read the books. */
export const closesBlind = (db: Db, actor: Pick<Actor, 'permissions' | 'roles'> | null): boolean =>
  !!actor && tillRules(db).blindClose && !maySupervise(actor) && !seesBooks(actor);

const NONE = { IQD: 0, USD: 0 };

/**
 * A shift as a cashier who closes blind sees it: nothing that tells the cash expected (the sales, their methods, the
 * refunds, the dollars taken, the expected cash and the difference); `blind` says so. Their counted cash stays theirs.
 */
export function blindShift<T extends { expected: unknown; difference: unknown; sales: unknown; refunds: unknown; methods?: unknown; usdTaken?: unknown }>(view: T): T & { blind: true } {
  return { ...view, expected: NONE, difference: null, sales: NONE, refunds: NONE, methods: {}, usdTaken: { usd: 0, iqd: 0 }, blind: true };
}
