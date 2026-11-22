import { isCashRounding, NO_ROUNDING, todayIso, type CashRounding } from '@qasa/core';
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

export const APPROVAL_ACTIONS = ['line_delete', 'void', 'price', 'discount', 'no_sale', 'refund', 'credit_over', 'blind_view', 'offline_sale', 'rate'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
/**
 * Approved at the till and done there (nothing the server books): the approval is used as it is given.
 * Taking a scanned line off and voiding a basket happen before anything reaches the server (a basket is the till's
 * own, in the cashier's browser), so the server cannot enforce them: the rule is the till page's, and the approval and
 * its detail in the audit log are the record. A sale's price, discount, credit and refunds are enforced here.
 */
// a refund (returns, cancels, exchanges, the till's own return) is checked on the server: assertRefundApproved
export const TILL_ONLY_ACTIONS: readonly ApprovalAction[] = ['line_delete', 'void', 'blind_view'];
/** How long an approval waits for the action it was given for. */
export const APPROVAL_MS = 2 * 60 * 1000;
/** A lower price is approved while the basket is still being rung up: it waits this long for its sale. */
export const PRICE_APPROVAL_MS = 20 * 60 * 1000;
/**
 * A sale a cut-off till kept that the server refuses for want of a supervisor (a price below the list, a discount over
 * the limit) is approved afterwards, from the list of what waits on that PC: for that receipt (its temporary
 * reference) and no smaller a sale. It waits a day for the PC that kept the sale to send it again.
 */
export const OFFLINE_APPROVAL_MS = 24 * 60 * 60 * 1000;

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

/** What an approval is used for now, to hold against what the supervisor approved (see approve, till-rules.ts). */
export interface ApprovalUse {
  /** the shift it must have been given at (a sale, the drawer); none: any shift still open (a refund asked from another screen) */
  shiftId?: string | undefined;
  /** the invoice (refund), the customer (credit over the limit) or the item and unit (a lower price): approvalSubject */
  subject?: string | null | undefined;
  /** a lower price: the line's unit price (not below the approved one); a discount, credit over the limit: the amount (not above) */
  value?: number | undefined;
  /** a refund: the lines coming back (within those approved); none = the whole invoice (a cancel) */
  lines?: readonly { lineNo: number; qtyMilli: number }[] | undefined;
  /** a lower price: the currency the line is sold in (the approved price is in that currency, never another) */
  currency?: string | undefined;
  /** a discount: the basket it is given on now (before discounts); never a smaller share than the one approved */
  gross?: number | undefined;
}

/**
 * The rate dollars are held to at a till: today's on the rate board when one was set for today, else the company's own.
 * A rate typed within RATE_FREE of it passes; further, up to RATE_BAND, a supervisor approves that very rate; beyond
 * is refused (a slip of a digit).
 */
export function referenceRate(db: Db, date = todayIso()): number {
  const r = db.prepare('SELECT rate_x100 FROM fx_rates WHERE date = ?').get(date) as { rate_x100: number } | undefined;
  return r ? Number(r.rate_x100) : Number(readSetting(db, 'default_rate_x100') ?? '142000');
}
export const RATE_FREE = 0.03;
export const RATE_BAND = 0.15;
/** How a typed rate stands against the reference: fine, a supervisor's to approve, or too far. */
export function rateStanding(rateX100: number, reference: number): 'ok' | 'approve' | 'far' {
  if (!Number.isSafeInteger(rateX100) || rateX100 <= 0) return 'far';
  // whole numbers only: 3% and 15% of the reference, never a float's rounding
  const off = Math.abs(rateX100 - reference) * 100;
  return off <= reference * 3 ? 'ok' : off <= reference * 15 ? 'approve' : 'far';
}

/** The subject of a dollar-rate approval: dollar notes on a dinar sale ('notes') or a dollar sale's own rate ('sale'), at this very rate. */
export const rateSubject = (kind: 'notes' | 'sale', rateX100: number): string => `${kind}:${rateX100}`;

/** The subject of a lower-price approval: the item, and the unit when it is not the item's own. */
export const priceSubject = (itemId: string, unit: string | null | undefined): string => `${itemId}|${unit ?? ''}`;

/** How an approval's amount is held, by action: a floor (the price), a ceiling, or none. */
const BOUND: Partial<Record<ApprovalAction, 'floor' | 'ceiling' | 'subject'>> = { price: 'floor', discount: 'ceiling', credit_over: 'ceiling', refund: 'subject', rate: 'subject' };

/**
 * Uses one approval a supervisor gave for `action`: unused, not expired, given to this cashier (never another's), at
 * this shift (or, for a refund asked from another screen, at a shift still open or at the office), and for this very
 * thing: the invoice and lines of a refund, the item, unit, currency and lowest price of a price change, the largest
 * discount on a basket no smaller than the one it was given on (so never a larger share of the sale), the customer and
 * largest amount of a credit sale over the limit, the very rate of dollars. Inside the transaction of what it approves, so an approval is never used up
 * by something that then fails, and one PIN never approves two things (the update is checked: a second process that
 * took it first leaves nothing to take).
 */
export function useApproval(db: Db, tokens: readonly string[] | undefined, action: ApprovalAction, who: { id?: string | null | undefined; name: string }, use: ApprovalUse = {}): string {
  const now = new Date().toISOString();
  for (const token of tokens ?? []) {
    const r = db.prepare(`SELECT a.id, a.approver, a.shift_id, a.cashier, a.cashier_id, a.subject, a.amount, a.currency, a.gross, a.scope, s.status AS shift_status
                          FROM till_approvals a LEFT JOIN pos_shifts s ON s.id = a.shift_id
                          WHERE a.id = ? AND a.action = ? AND a.used_at IS NULL AND a.expires_at >= ?`)
      .get(token, action, now) as { id: string; approver: string; shift_id: string | null; cashier: string; cashier_id: string | null; subject: string | null; amount: number | null;
        currency: string | null; gross: number | null; scope: string | null; shift_status: string | null } | undefined;
    if (!r) continue;
    // at this shift; or, asked from another screen: one given at the office (no shift), or at a shift still open
    if (use.shiftId ? r.shift_id !== use.shiftId : (r.shift_id !== null && r.shift_status !== 'open')) continue;
    if (r.cashier_id && who.id ? r.cashier_id !== who.id : r.cashier !== who.name) continue;
    const bound = BOUND[action];
    if (bound && action !== 'discount' && (r.subject ?? null) !== (use.subject ?? null)) continue;
    if (bound === 'floor' && (r.amount === null || !Number.isSafeInteger(use.value) || use.value! < Number(r.amount))) continue;
    if (bound === 'ceiling' && (r.amount === null || !Number.isSafeInteger(use.value) || use.value! > Number(r.amount))) continue;
    // a price is approved in one currency: 100.00 dollars never stands for 10,000 dinars
    if (action === 'price' && (r.currency ?? null) !== (use.currency ?? null)) continue;
    // a discount was approved on a basket: it never becomes a larger share of a smaller one (8,000 off 55,000 is not
    // 8,000 off 8,250)
    if (action === 'discount' && (r.gross === null || !Number.isSafeInteger(use.gross) || use.gross! <= 0
      || BigInt(use.value!) * BigInt(Number(r.gross)) > BigInt(Number(r.amount)) * BigInt(use.gross!))) continue;
    if (action === 'refund' && r.scope !== null) {
      let allowed: [number, number][] = [];
      try { allowed = JSON.parse(r.scope) as [number, number][]; } catch { allowed = []; }
      const most = new Map(allowed.map(([lineNo, qty]) => [Number(lineNo), Number(qty)]));
      const asked = new Map<number, number>();
      for (const l of use.lines ?? []) asked.set(l.lineNo, (asked.get(l.lineNo) ?? 0) + l.qtyMilli);
      if (!use.lines || [...asked].some(([lineNo, qty]) => qty > (most.get(lineNo) ?? 0))) continue;
    }
    const taken = db.prepare('UPDATE till_approvals SET used_at = ? WHERE id = ? AND used_at IS NULL').run(now, r.id);
    if (Number(taken.changes) !== 1) continue;
    audit(db, who.name, 'approval_used', r.shift_id ? 'pos_shift' : 'invoice', r.shift_id ?? r.subject, { action, approver: r.approver, approval: r.id });
    return r.approver;
  }
  throw invalid([{ code: 'pos_needs_supervisor', action }]);
}

/** Whether a supervisor has approved the kept sale with this receipt reference (not used yet). */
export function offlineApprovalWaits(db: Db, shiftId: string, reference: string): boolean {
  return !!db.prepare("SELECT 1 FROM till_approvals WHERE action = 'offline_sale' AND shift_id = ? AND subject = ? AND used_at IS NULL AND expires_at >= ?")
    .get(shiftId, reference, new Date().toISOString());
}

/**
 * Uses the approval a supervisor gave for a kept sale (by its receipt reference: the kept sale itself can't carry a
 * token, it is sent as it was kept): the sale is worth no less than what was approved. Null when there is none.
 * Inside the sale's transaction.
 */
export function useOfflineApproval(db: Db, shiftId: string, reference: string, value: number, user: string): string | null {
  const now = new Date().toISOString();
  const rows = db.prepare("SELECT id, approver, amount FROM till_approvals WHERE action = 'offline_sale' AND shift_id = ? AND subject = ? AND used_at IS NULL AND expires_at >= ? ORDER BY created_at")
    .all(shiftId, reference, now) as { id: string; approver: string; amount: number | null }[];
  for (const r of rows) {
    if (r.amount === null || value < Number(r.amount)) continue;
    if (Number(db.prepare('UPDATE till_approvals SET used_at = ? WHERE id = ? AND used_at IS NULL').run(now, r.id).changes) !== 1) continue;
    audit(db, user, 'approval_used', 'pos_shift', shiftId, { action: 'offline_sale', approver: r.approver, approval: r.id, reference });
    return r.approver;
  }
  return null;
}

/**
 * A refund when the company's rule asks a supervisor for refunds: a return or a cancel of a till sale, and (review
 * 2.0) any cash paid back out of a safe a shift is open on, whatever screen the sale was made on: that money leaves
 * a cashier's drawer too. Someone who neither supervises nor is an admin brings an approval a supervisor gave them
 * for this invoice (and, for a return, for these lines). Checked by the server whatever screen asks, inside the
 * transaction of the return or the cancel.
 *
 * `cashAccount`: the safe a return pays the money back from (none: on the customer's account). A cancel pays back
 * into the invoice's own safe.
 */
export function assertRefundApproved(db: Db, invoiceId: string, actor: Pick<Actor, 'id' | 'name' | 'permissions' | 'roles'> | undefined, tokens: readonly string[] | undefined,
  refund: { cashAccount?: string | null | undefined; lines?: readonly { lineNo: number; qtyMilli: number }[] | undefined; cancel?: boolean } = {}): void {
  if (!tillRules(db).supervisor.refund || !actor) return;
  if (actor.permissions.includes('admin') || maySupervise(actor)) return;
  const inv = db.prepare('SELECT kind, payment, cash_account FROM invoices WHERE id = ?').get(invoiceId) as { kind: string; payment: string; cash_account: string | null } | undefined;
  if (!inv || inv.kind !== 'sale') return;
  const tillSale = !!db.prepare('SELECT 1 FROM pos_sales WHERE invoice_id = ?').get(invoiceId);
  const safe = refund.cancel ? (inv.payment === 'cash' ? inv.cash_account : null) : refund.cashAccount ?? null;
  const fromDrawer = !!safe && !!db.prepare("SELECT 1 FROM pos_shifts WHERE status = 'open' AND cash_account = ?").get(safe);
  if (!tillSale && !fromDrawer) return;
  useApproval(db, tokens, 'refund', actor, { subject: invoiceId, lines: refund.cancel ? undefined : refund.lines });
}

/** Whether this person closes blind: the rule is on and they neither supervise nor read the books. */
export const closesBlind = (db: Db, actor: Pick<Actor, 'permissions' | 'roles'> | null): boolean =>
  !!actor && tillRules(db).blindClose && !maySupervise(actor) && !seesBooks(actor);

const NONE = { IQD: 0, USD: 0 };

/**
 * A shift as a cashier who closes blind sees it: nothing that tells the cash expected (the sales, their methods, the
 * refunds, the dollars taken, the expected cash and the difference); `blind` says so. Their counted cash stays theirs.
 * A shift's report (X/Z) keeps its list of sales and of items, without their amounts, and no gift voucher sums.
 */
export function blindShift<T extends { expected: unknown; difference: unknown; sales: unknown; refunds: unknown; methods?: unknown; usdTaken?: unknown }>(view: T): T & { blind: true } {
  const report = view as T & { invoices?: { total: number }[]; items?: { amount: unknown }[]; gift?: unknown; otherCash?: unknown };
  return {
    ...view, expected: NONE, difference: null, sales: NONE, refunds: NONE, methods: {}, usdTaken: { usd: 0, iqd: 0 },
    ...('otherCash' in report ? { otherCash: NONE } : {}),
    ...(Array.isArray(report.invoices) ? { invoices: report.invoices.map((i) => ({ ...i, total: 0 })) } : {}),
    ...(Array.isArray(report.items) ? { items: report.items.map((i) => ({ ...i, amount: NONE })) } : {}),
    ...(report.gift ? { gift: { soldCount: 0, sold: 0, used: 0 } } : {}),
    blind: true
  };
}

/**
 * What else tells a cashier who closes blind the day's takings (review 2.0): the sales figures of the Daily Brief and
 * the dashboard, the sales reports, and the totals in the list of invoices. Sent without those sums (the router calls
 * this for every answer, as it does for cost: routes.ts). One invoice opened by itself keeps its total: its receipt
 * prints it anyway.
 */
export function blindAnswer(db: Db, actor: Pick<Actor, 'permissions' | 'roles'> | null, method: string, path: string, result: unknown): unknown {
  if (method !== 'GET' || !result || typeof result !== 'object' || !actor) return result;
  const brief = path === '/api/brief' || path === '/api/brief/dashboard';
  const reports = path.startsWith('/api/brief/reports/sales-');
  const list = path === '/api/invoices';
  if (!brief && !reports && !list) return result;
  if (!closesBlind(db, actor)) return result;
  if (list && Array.isArray(result)) {
    return result.map((r) => (r && typeof r === 'object' && ((r as { kind?: string }).kind === 'sale' || (r as { kind?: string }).kind === 'sale_return')
      ? { ...r, total: 0, subtotal: 0, discount: 0, baseTotal: 0, blind: true } : r));
  }
  const o = result as Record<string, unknown>;
  if (reports) return { ...o, rows: [], blind: true };
  if (brief) {
    const out: Record<string, unknown> = { ...o, blind: true };
    if (o.sales && typeof o.sales === 'object') out.sales = Object.fromEntries(Object.keys(o.sales as object).map((k) => [k, 0]));
    for (const k of ['salesMonth', 'salesLastMonth']) if (typeof o[k] === 'number') out[k] = 0;
    if (Array.isArray(o.topItems)) out.topItems = [];
    if (Array.isArray(o.months)) out.months = (o.months as Record<string, unknown>[]).map((m) => ({ ...m, sales: 0 }));
    return out;
  }
  return result;
}
