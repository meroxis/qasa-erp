import { randomUUID } from 'node:crypto';
import { roundCash } from '@qasa/core';
import { giftCashOf, giftOfShift, giftParts, takeGiftParts } from './gift-vouchers.ts';
import { blindShift, closesBlind, maySellMisc, roundingAccount, tillRules, useApproval } from './till-settings.ts';
import { z } from 'zod';
import { todayIso, UNIT_CODES, type CurrencyCode, type UnitCode } from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { createInvoice, getInvoice, postInvoice, type InvoiceView, type SalePart } from './invoices.ts';
import { loyaltyPaidFor, planRedemption } from './loyalty.ts';
import { readSetting, writeSetting } from './settings.ts';
import { seesBooks, signInRequired, type Actor } from './auth.ts';
import { scopeOf, userBranchLists } from './branches.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';
import { onceOnly } from './idempotency.ts';

/**
 * Point of sale (every plan). A cashier opens a shift on a register (the safe the cash goes into, the warehouse the
 * goods leave, the cash in the drawer at the start); every sale is a cash sale invoice made and posted at once into
 * that safe and kept with the shift; closing compares the cash expected (opening + the shift's cash sales, by
 * currency) with what was counted. Returns go through the normal returns page; a cash refund paid from the shift's
 * safe while the shift is open comes out of the expected cash. A difference at closing is reported, not posted.
 */

type Money = Record<CurrencyCode, number>;
const zero = (): Money => ({ IQD: 0, USD: 0 });

/**
 * How a customer pays at the counter (1.1): cash into the shift's safe, a card or a wallet (FIB, ZainCash, Qi) into
 * the account the admin set for it, or on the chosen customer's account (credit). Money paid now can be split over up
 * to 4 of them; since 1.4 a sale on credit is on credit as a whole, never mixed with money paid now.
 *
 * Since 1.4 the till itself offers cash and credit only, and Settings no longer has the card and wallet accounts. The
 * server still takes a card or a wallet part, under the same checks as before (the method must have an account set
 * before 1.4, inside the user's branches): a sale a till kept while offline before the update is sent after it, and a
 * PC in the office still on an older version sells against this server. A company that never set an account can't be
 * sent one: the method is refused. Old sales keep their parts for receipts, returns, shift reports and the day close.
 */
export const POS_METHODS = ['cash', 'card', 'fib', 'zaincash', 'qi', 'account'] as const;
export type PosMethod = (typeof POS_METHODS)[number];
/** The methods that need an account of their own (cash uses the shift's safe; on account, the customer's). */
export const POS_ACCOUNT_METHODS = ['card', 'fib', 'zaincash', 'qi'] as const;
export type PosAccounts = Partial<Record<(typeof POS_ACCOUNT_METHODS)[number], string>>;
const POS_ACCOUNTS = 'pos_payment_accounts';

export function posPaymentAccounts(db: Db): PosAccounts {
  try {
    const stored = JSON.parse(readSetting(db, POS_ACCOUNTS) ?? '{}') as Record<string, unknown>;
    const out: PosAccounts = {};
    for (const m of POS_ACCOUNT_METHODS) if (typeof stored[m] === 'string') out[m] = stored[m] as string;
    return out;
  } catch {
    return {};
  }
}

export function setPosPaymentAccounts(db: Db, input: PosAccounts, user: string): PosAccounts {
  const clean: PosAccounts = {};
  const errors: { code: string; field: string }[] = [];
  for (const m of POS_ACCOUNT_METHODS) {
    const code = input[m]?.trim();
    if (!code) continue;
    if (!cashAccountOk(db, code)) errors.push({ code: 'cash_account_invalid', field: m });
    else clean[m] = code;
  }
  if (errors.length) throw invalid(errors);
  transaction(db, () => {
    writeSetting(db, POS_ACCOUNTS, JSON.stringify(clean));
    audit(db, user, 'update', 'settings', POS_ACCOUNTS, clean);
  });
  return posPaymentAccounts(db);
}

/**
 * The card and wallet accounts a user may take payments into: all of them, or for a user limited to branches, only
 * those that are their branches' own (the settings name one account per method for the whole company, and a head
 * office's or another branch's bank is not a limited cashier's to debit).
 */
export function posAccountsFor(db: Db, actor?: Actor | null): PosAccounts {
  const accounts = posPaymentAccounts(db);
  const scope = actor ? scopeOf(db, actor) : null;
  if (!scope) return accounts;
  const out: PosAccounts = {};
  for (const m of POS_ACCOUNT_METHODS) if (accounts[m] && scope.accounts.has(accounts[m])) out[m] = accounts[m];
  return out;
}

/** The methods the counter offers: cash and on account always, the others once they have an account the user may use. */
export function posMethods(db: Db, actor?: Actor | null): PosMethod[] {
  const accounts = posAccountsFor(db, actor);
  return POS_METHODS.filter((m) => m === 'cash' || m === 'account' || !!accounts[m as keyof PosAccounts]);
}

export interface ShiftSaleView {
  invoiceId: string;
  number: string | null;
  createdAt: string;
  partyName: string | null;
  currency: CurrencyCode;
  total: number;
  status: string;
  /** 1.2: sold while the till was offline: the temporary reference on its receipt (createdAt is when it was sold) */
  offlineRef?: string;
}

export interface ShiftView {
  id: string;
  number: string;
  register: string;
  cashAccountCode: string;
  warehouseId: string;
  status: 'open' | 'closed';
  openedBy: string;
  openedAt: string;
  /** in IQD */
  openingCash: number;
  closedBy: string | null;
  closedAt: string | null;
  /** posted, not cancelled cash sales of the shift, by currency */
  sales: Money;
  count: number;
  /** cash refunds (posted cash sales returns from this safe while the shift was open), by currency */
  refunds: Money;
  /** cash that should be in the drawer: the opening cash (IQD) plus the sales, less the cash refunds */
  expected: Money;
  /** what was counted at closing (null while open) */
  counted: Money | null;
  /** 1.1: the posted sales by how they were paid (a sale not split: all cash); 1.2: loyalty, what points paid */
  methods: Partial<Record<PosMethod | 'loyalty', Money>>;
  /** counted − expected, by currency (null while open) */
  difference: Money | null;
  notes: string;
  /** the actions this user may take */
  actions: ('sell' | 'close')[];
  /** 2.0: the named till the shift was opened on (null: a register typed by name, as before) */
  tillId: string | null;
  /**
   * 2.0: dollar notes taken at the till for dinar sales (`usd` in cents) and the dinars they stood for (`iqd`): in the
   * drawer they are dollars, so the dinars expected are that much less and the dollars that much more
   */
  usdTaken: { usd: number; iqd: number };
}

export interface ShiftReport extends ShiftView {
  invoices: ShiftSaleView[];
  /** what was sold, item by item (posted sales only) */
  items: { itemId: string; code: string; name: { ar: string; en: string; ku: string }; qtyMilli: number; amount: Money }[];
  /** 2.0.0: gift vouchers sold at this till and used on its sales */
  gift: { soldCount: number; sold: number; used: number };
}

export interface OpenShiftInput {
  /** 2.0: a named till (pos-tills.ts): its name, safe and warehouse are the shift's */
  tillId?: string | undefined;
  register: string;
  cashAccountCode: string;
  warehouseId: string;
  openingCash: number;
  notes?: string | undefined;
}

export interface SaleInput {
  currency: CurrencyCode;
  rateX100?: number | undefined;
  partyId?: string | undefined;
  discount: number;
  notes?: string | undefined;
  /** qtyMilli in base units, or (1.1) unit + unitQtyMilli: the quantity in one of the item's units, priced per that unit */
  lines: { itemId: string; qtyMilli?: number | undefined; unitPrice: number; unit?: UnitCode | undefined; unitQtyMilli?: number | undefined; batchId?: string | undefined }[];
  /** the cashier confirmed selling stock past its expiry date (only the 'warn' policy allows it) */
  allowExpired?: boolean | undefined;
  /** 1.1: how it was paid, 1–4 parts adding up to the sale's total (less what points pay); none = all cash, as before */
  payments?: { method: PosMethod; amount: number }[] | undefined;
  /**
   * 1.2: a sale made at the till while the office server could not be reached, sent when the link came back: the
   * temporary reference printed on its receipt, the moment it was sold and the till's date then (the invoice's date).
   */
  offline?: OfflineSale | undefined;
  /** 1.2 (Pro): loyalty points the customer uses on this sale */
  loyaltyPoints?: number | undefined;
  /**
   * 1.4: the cash the customer handed over, in the sale's currency. Kept with a cash sale when it covers the cash
   * due, so the receipt prints "Amount paid" and "Change" again later; it changes nothing in the books.
   */
  tendered?: number | undefined;
  /**
   * 2.0: a dinar sale paid partly in dollar notes: the dollars taken (cents) and the rate they were taken at. The books
   * keep the sale in dinars (the dollars' worth is part of the cash); the shift expects those dollars in the drawer
   * instead of their dinars, and any change from them is given in dinars.
   */
  usdCash?: { amount: number; rateX100: number } | undefined;
  /** 2.0: approvals a supervisor gave at this till (till-rules.ts) for what the sale needs one for */
  approvals?: string[] | undefined;
  /** 2.0: gift vouchers that pay part of the sale (gift-vouchers.ts) */
  vouchers?: { code: string; amount: number }[] | undefined;
}

export interface OfflineSale { reference: string; soldAt: string; soldOn: string }

/**
 * "OFF-<register>-<PC>-0001": letters and digits of the register's name (any script), the code of the PC's own list
 * (6 letters and digits, apps/desktop/src/outbox.ts), then that list's count. A reference kept before the code
 * ("OFF-<register>-0001") is still taken.
 */
export const OFFLINE_REFERENCE = /^OFF-[\p{L}\p{N}]{1,16}-(?:[0-9A-HJKMNP-TV-Z]{6}-)?\d{4,9}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * The date an offline sale is booked on: the till's date when it was sold, never before the shift was opened and never
 * after today here (a till whose clock is wrong can't move a sale out of its shift or into the future).
 */
export function offlineSaleDate(soldOn: string, openedAt: string, now: Date = new Date()): string {
  const opened = todayIso(new Date(openedAt));
  const today = todayIso(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(soldOn) || soldOn > today) return today;
  return soldOn < opened ? opened : soldOn;
}

export interface CloseInput {
  countedCash: number;
  countedUsd?: number | undefined;
  notes?: string | undefined;
}

interface ShiftRow {
  id: string; number: string; register: string; cash_account: string; warehouse_id: string; status: 'open' | 'closed';
  opened_by: string; opened_at: string; opening_cash: number; closed_by: string | null; closed_at: string | null;
  expected_cash: number | null; counted_cash: number | null; expected_usd: number | null; counted_usd: number | null; notes: string | null;
  till_id?: string | null;
}

function loadShift(db: Db, id: string): ShiftRow {
  const r = db.prepare('SELECT * FROM pos_shifts WHERE id = ?').get(id) as ShiftRow | undefined;
  if (!r) throw notFound('shift');
  return r;
}

/**
 * The shift's posted sales: all of them, the cash in them (a split sale counts only its cash part; a sale from before
 * 1.1 or not split is all cash), and the totals per method.
 */
/** 2.0: the dollar notes taken for the shift's posted dinar sales, and the dinars they stood for. */
function usdTakenOf(db: Db, shiftId: string): { usd: number; iqd: number } {
  const rows = db.prepare(`SELECT s.usd_cash, s.usd_rate_x100 FROM pos_sales s JOIN invoices i ON i.id = s.invoice_id
                           WHERE s.shift_id = ? AND i.status = 'posted' AND s.usd_cash IS NOT NULL`).all(shiftId) as { usd_cash: number; usd_rate_x100: number }[];
  let usd = 0, iqd = 0;
  for (const r of rows) { usd += Number(r.usd_cash); iqd += usdCashValue(Number(r.usd_cash), Number(r.usd_rate_x100)); }
  return { usd, iqd };
}

/** The dinars dollar notes stand for: cents × (dinars per dollar × 100) / 10 000, rounded. */
export const usdCashValue = (cents: number, rateX100: number): number => Math.round((cents * rateX100) / 10000);

function salesOf(db: Db, shiftId: string): { sales: Money; cash: Money; count: number; methods: Partial<Record<PosMethod | 'loyalty', Money>> } {
  const rows = db.prepare(`SELECT i.id, i.currency AS currency, i.total FROM pos_sales s JOIN invoices i ON i.id = s.invoice_id
                           WHERE s.shift_id = ? AND i.status = 'posted'`).all(shiftId) as { id: string; currency: CurrencyCode; total: number }[];
  const parts = new Map<string, { method: PosMethod; amount: number }[]>();
  if (rows.length) {
    for (const p of db.prepare(`SELECT p.invoice_id, p.method, p.amount FROM invoice_payments p JOIN pos_sales s ON s.invoice_id = p.invoice_id
                                WHERE s.shift_id = ? AND p.kind = 'pos'`).all(shiftId) as { invoice_id: string; method: PosMethod; amount: number }[]) {
      parts.set(p.invoice_id, [...(parts.get(p.invoice_id) ?? []), { method: p.method, amount: Number(p.amount) }]);
    }
  }
  const sales = zero();
  const cash = zero();
  const methods: Partial<Record<PosMethod | 'loyalty', Money>> = {};
  // 1.2: what loyalty points paid (never in the drawer)
  const points = loyaltyPaidFor(db, rows.map((r) => r.id));
  for (const r of rows) {
    sales[r.currency] += Number(r.total);
    const byPoints = points.get(r.id) ?? 0;
    if (byPoints) (methods.loyalty ??= zero())[r.currency] += byPoints;
    const rest = Number(r.total) - byPoints;
    for (const p of parts.get(r.id) ?? (rest > 0 ? [{ method: 'cash' as const, amount: rest }] : [])) {
      (methods[p.method] ??= zero())[r.currency] += p.amount;
      if (p.method === 'cash') cash[r.currency] += p.amount;
    }
  }
  return { sales, cash, count: rows.length, methods };
}

/**
 * Cash paid back from the shift's safe while it was open: posted cash sales returns from that safe, made between the
 * opening and the closing (or now). That money left the drawer, so it is not expected at closing. Two registers can
 * be open on the same safe at once; a refund then counts in one shift only, the newest one opened on that safe before
 * it and still open when it was paid, so the same money is never taken off two drawers.
 */
function refundsOf(db: Db, row: ShiftRow): Money {
  const [where, params] = shiftReturnsWhere(row);
  // points given back on a return never leave the drawer
  const rows = db.prepare(`SELECT i.currency AS currency,
                                  COALESCE(SUM(i.total - COALESCE((SELECT SUM(m.value) FROM loyalty_moves m WHERE m.invoice_id = i.id AND m.kind = 'return_redeem'), 0)), 0) AS total
                           FROM invoices i WHERE ${where}
                           GROUP BY i.currency`)
    .all(...params) as { currency: CurrencyCode; total: number }[];
  const refunds = zero();
  for (const r of rows) refunds[r.currency] = Number(r.total);
  return refunds;
}

/** The returns paid out of a shift's drawer (the rule above), as a condition on invoices `i` with its parameters. */
function shiftReturnsWhere(row: ShiftRow): [string, string[]] {
  return [`i.kind = 'sale_return' AND i.status = 'posted' AND i.payment = 'cash' AND i.cash_account = ?
             AND i.posted_at >= ? ${row.closed_at ? 'AND i.posted_at <= ?' : ''}
             AND NOT EXISTS (SELECT 1 FROM pos_shifts o WHERE o.cash_account = i.cash_account AND o.id <> ?
                               AND o.opened_at > ? AND o.opened_at <= i.posted_at
                               AND (o.closed_at IS NULL OR o.closed_at >= i.posted_at))`,
  [row.cash_account, row.opened_at, ...(row.closed_at ? [row.closed_at] : []), row.id, row.opened_at]];
}

/**
 * The invoices of a shift (1.4.1, the end-of-day close of someone who does not keep the books): the sales made on it
 * and the returns paid out of its drawer.
 */
export function shiftInvoiceIds(db: Db, shiftId: string): string[] {
  const row = loadShift(db, shiftId);
  const sales = db.prepare('SELECT invoice_id FROM pos_sales WHERE shift_id = ?').all(shiftId) as { invoice_id: string }[];
  const [where, params] = shiftReturnsWhere(row);
  const returns = db.prepare(`SELECT i.id FROM invoices i WHERE ${where}`).all(...params) as { id: string }[];
  return [...sales.map((s) => s.invoice_id), ...returns.map((r) => r.id)];
}

/**
 * Whether this user opened the shift, for the end-of-day close (closed shifts too). Strict with sign-in on: a shift
 * whose "open" record names no user (one opened before the id was recorded) is nobody's by name there, so a cashier
 * never sees the register of another user who happens to share their name; the close's debts go by id as well.
 */
export function openedShift(db: Db, shiftId: string, actor: ShiftActor): boolean {
  return isOpener(db, loadShift(db, shiftId), actor, true);
}

type ShiftActor = Pick<Actor, 'id' | 'name' | 'permissions'>;

/**
 * Whether this user opened the shift. Names are not unique (two users can both be called "Mer S"), so with sign-in on
 * the user id kept in the shift's append-only "open" audit record decides; it also survives renaming the user. Without
 * sign-in every PC is the owner, and the name typed on the PC tells the cashiers apart. `byIdOnly` (the day close):
 * with sign-in on, a record without a user id matches nobody instead of falling back to the name.
 */
function isOpener(db: Db, row: ShiftRow, actor: ShiftActor, byIdOnly = false): boolean {
  if (actor.id && signInRequired(db)) {
    const opened = db.prepare("SELECT details FROM audit_log WHERE entity = 'pos_shift' AND entity_id = ? AND action = 'open' ORDER BY id DESC LIMIT 1")
      .get(row.id) as { details: string | null } | undefined;
    let openerId: unknown = null;
    try { openerId = opened?.details ? (JSON.parse(opened.details) as { userId?: unknown }).userId ?? null : null; } catch { openerId = null; }
    if (typeof openerId === 'string') return openerId === actor.id;
    if (byIdOnly) return false;
  }
  return row.opened_by === actor.name;
}

const mayRun = (db: Db, row: ShiftRow, actor: ShiftActor | null) =>
  !!actor && actor.permissions.includes('pos') && (actor.permissions.includes('admin') || isOpener(db, row, actor));

function shiftView(db: Db, row: ShiftRow, actor: ShiftActor | null): ShiftView {
  const { sales, cash, count, methods } = salesOf(db, row.id);
  const refunds = refundsOf(db, row);
  const usdTaken = usdTakenOf(db, row.id);
  // only the cash that went into the drawer: a card or a wallet part of a sale never was there; dollar notes taken for
  // dinar sales are in it as dollars
  // 2.0: gift vouchers sold at this till were paid in cash into its drawer
  const giftCash = giftCashOf(db, row.id);
  const expected: Money = { IQD: Number(row.opening_cash) + cash.IQD - refunds.IQD - usdTaken.iqd + giftCash, USD: cash.USD - refunds.USD + usdTaken.usd };
  const notes = row.notes ?? '';
  let counted: Money | null = null;
  let difference: Money | null = null;
  if (row.status === 'closed') {
    // a closed shift shows what was expected at closing (sales cancelled later don't change it)
    if (row.expected_cash !== null) expected.IQD = Number(row.expected_cash);
    if (row.expected_usd !== null) expected.USD = Number(row.expected_usd);
    counted = { IQD: Number(row.counted_cash ?? 0), USD: Number(row.counted_usd ?? 0) };
    difference = { IQD: counted.IQD - expected.IQD, USD: counted.USD - expected.USD };
  }
  const actions: ShiftView['actions'] = row.status === 'open' && mayRun(db, row, actor) ? ['sell', 'close'] : [];
  return {
    id: row.id, number: row.number, register: row.register, cashAccountCode: row.cash_account, warehouseId: row.warehouse_id,
    status: row.status, openedBy: row.opened_by, openedAt: row.opened_at, openingCash: Number(row.opening_cash),
    closedBy: row.closed_by, closedAt: row.closed_at, sales, count, refunds, expected, counted, difference, notes, actions, methods,
    tillId: row.till_id ?? null, usdTaken
  };
}

export function getShift(db: Db, id: string, actor: ShiftActor | null = null): ShiftView {
  return shiftView(db, loadShift(db, id), actor);
}

/**
 * Whether this user may read the shift (1.4.1, the rule of the end-of-day close): whoever keeps the books reads every
 * shift; anyone else (a cashier) only the shifts they opened, matched by the user id of the shift's "open" record.
 */
function readsShift(db: Db, row: ShiftRow, actor: Actor | null): boolean {
  // 2.0: a till supervisor reads every shift too (they see the difference on a blind close)
  return !actor || seesBooks(actor) || actor.permissions.includes('posSupervise') || isOpener(db, row, actor, true);
}

export function listShifts(db: Db, f: { status?: 'open' | 'closed' | undefined; limit?: number | undefined } = {},
  actor: Actor | null = null): ShiftView[] {
  const limit = f.limit ?? 100;
  const ownOnly = !!actor && !seesBooks(actor);
  // someone who reads only their own shifts gets up to `limit` of theirs, not of everyone's
  const rows = (db.prepare(`SELECT * FROM pos_shifts ${f.status ? 'WHERE status = ?' : ''} ORDER BY opened_at DESC${ownOnly ? '' : ' LIMIT ?'}`)
    .all(...(f.status ? [f.status] : []), ...(ownOnly ? [] : [limit])) as unknown as ShiftRow[])
    .filter((r) => !ownOnly || readsShift(db, r, actor));
  return rows.slice(0, limit).map((r) => shiftView(db, r, actor));
}

/**
 * The open shift this user can sell on (their own; the newest if several registers). 2.0: a PC that chose a till asks
 * for that till's shift only, so two tills of the same cashier never mix.
 */
export function myShift(db: Db, actor: ShiftActor, tillId?: string | null): ShiftView | null {
  const open = db.prepare("SELECT * FROM pos_shifts WHERE status = 'open' ORDER BY opened_at DESC").all() as unknown as ShiftRow[];
  const row = open.find((r) => (!tillId || r.till_id === tillId) && isOpener(db, r, actor));
  return row ? shiftView(db, row, actor) : null;
}

export function shiftReport(db: Db, id: string, actor: Actor | null = null): ShiftReport {
  const row = loadShift(db, id);
  // another cashier's shift is not theirs to read: answered as if it were not there
  if (!readsShift(db, row, actor)) throw notFound('shift');
  const invoices = (db.prepare(`SELECT i.id, i.number, i.created_at, p.name AS party_name, i.currency, i.total, i.status, o.reference AS offline_ref, o.sold_at
                                FROM pos_sales s JOIN invoices i ON i.id = s.invoice_id LEFT JOIN parties p ON p.id = i.party_id
                                LEFT JOIN pos_offline_sales o ON o.invoice_id = i.id
                                WHERE s.shift_id = ? ORDER BY COALESCE(o.sold_at, i.created_at)`).all(id) as {
    id: string; number: string | null; created_at: string; party_name: string | null; currency: CurrencyCode; total: number; status: string;
    offline_ref: string | null; sold_at: string | null
  }[]).map((r) => ({
    invoiceId: r.id, number: r.number, createdAt: r.sold_at ?? r.created_at, partyName: r.party_name, currency: r.currency, total: Number(r.total), status: r.status,
    ...(r.offline_ref ? { offlineRef: r.offline_ref } : {})
  }));
  const lines = db.prepare(`SELECT l.item_id, it.code, it.name_ar, it.name_en, it.name_ku, i.currency, SUM(l.qty_milli) AS qty,
                                   SUM(l.amount - COALESCE(l.discount_share, CASE WHEN i.subtotal > 0 THEN i.discount * l.amount * 1.0 / i.subtotal ELSE 0 END)) AS amount
                            FROM pos_sales s JOIN invoices i ON i.id = s.invoice_id JOIN invoice_lines l ON l.invoice_id = i.id
                            JOIN items it ON it.id = l.item_id
                            WHERE s.shift_id = ? AND i.status = 'posted'
                            GROUP BY l.item_id, it.code, it.name_ar, it.name_en, it.name_ku, i.currency
                            ORDER BY it.code`).all(id) as {
    item_id: string; code: string; name_ar: string; name_en: string; name_ku: string; currency: CurrencyCode; qty: number; amount: number
  }[];
  const byItem = new Map<string, ShiftReport['items'][number]>();
  for (const l of lines) {
    const e = byItem.get(l.item_id) ?? { itemId: l.item_id, code: l.code, name: { ar: l.name_ar, en: l.name_en, ku: l.name_ku }, qtyMilli: 0, amount: zero() };
    e.qtyMilli += Number(l.qty);
    e.amount[l.currency] += Math.round(Number(l.amount)); // after the invoice discount, so the items add up to the sales
    byItem.set(l.item_id, e);
  }
  return { ...shiftView(db, row, actor), invoices, items: [...byItem.values()], gift: giftOfShift(db, id) };
}

const trimmed = (s: string | undefined) => s?.trim() || null;
const isAmount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

function cashAccountOk(db: Db, code: string): boolean {
  if (!code.startsWith('18')) return false;
  const account = loadAccounts(db).find((a) => a.code === code);
  return !!account && account.postable;
}

export function openShift(db: Db, input: OpenShiftInput, actor: Actor): ShiftView {
  // 2.0: on a named till, its name, safe and warehouse are the shift's
  const till = input.tillId ? db.prepare('SELECT id, name, cash_account, warehouse_id, active FROM pos_tills WHERE id = ?').get(input.tillId) as
    { id: string; name: string; cash_account: string; warehouse_id: string; active: number } | undefined : undefined;
  if (input.tillId && (!till || Number(till.active) !== 1)) throw invalid([{ code: 'till_invalid' }]);
  if (till) input = { ...input, register: till.name, cashAccountCode: till.cash_account, warehouseId: till.warehouse_id };
  const register = input.register?.trim() ?? '';
  const errors: { code: string }[] = [];
  if (!register) errors.push({ code: 'pos_register_required' });
  if (!cashAccountOk(db, input.cashAccountCode)) errors.push({ code: 'cash_account_invalid' });
  const warehouse = db.prepare('SELECT active FROM warehouses WHERE id = ?').get(input.warehouseId) as { active: number } | undefined;
  if (!warehouse || Number(warehouse.active) !== 1) errors.push({ code: 'warehouse_invalid' });
  if (!isAmount(input.openingCash)) errors.push({ code: 'amount_invalid' });
  if (errors.length) throw invalid(errors);
  const id = transaction(db, () => {
    const busy = (db.prepare("SELECT register FROM pos_shifts WHERE status = 'open'").all() as { register: string }[])
      .some((r) => r.register.trim().toLowerCase() === register.toLowerCase());
    if (busy) throw conflict('pos_register_open', { register });
    if (till && db.prepare("SELECT 1 FROM pos_shifts WHERE status = 'open' AND till_id = ?").get(till.id)) throw conflict('pos_register_open', { register });
    const newId = randomUUID();
    const year = todayIso().slice(0, 4);
    const number = `POS-${year}-${String(nextSequence(db, `pos_shift:${year}`)).padStart(4, '0')}`;
    db.prepare(`INSERT INTO pos_shifts (id, number, register, cash_account, warehouse_id, status, opened_by, opened_at, opening_cash, notes, till_id)
                VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`)
      .run(newId, number, register, input.cashAccountCode, input.warehouseId, actor.name, new Date().toISOString(), input.openingCash, trimmed(input.notes), till?.id ?? null);
    // the user id decides who opened it only with sign-in on; without it every PC is the owner, and the typed name does
    audit(db, actor.name, 'open', 'pos_shift', newId, {
      number, register, openingCash: input.openingCash, ...(signInRequired(db) && actor.id ? { userId: actor.id } : {})
    });
    return newId;
  });
  return getShift(db, id, actor);
}

function requireRunnable(db: Db, id: string, actor: Actor): ShiftRow {
  const row = loadShift(db, id);
  if (row.status !== 'open') throw conflict('pos_shift_closed');
  if (!mayRun(db, row, actor)) throw new AppError(403, 'forbidden', { need: 'shift_owner' });
  return row;
}

/** One sale at the counter: a cash sale invoice into the shift's safe, posted at once and kept with the shift. */
export function sell(db: Db, shiftId: string, input: SaleInput, actor: Actor): { invoice: InvoiceView; shift: ShiftView; rounding: number } {
  const row = requireRunnable(db, shiftId, actor);
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw invalid([{ code: 'pos_cart_empty' }]);
  if (input.currency === 'USD' && !(Number.isSafeInteger(input.rateX100) && (input.rateX100 ?? 0) > 0)) throw invalid([{ code: 'rate_invalid' }]);
  const payments = input.payments ?? [];
  if (payments.length > 4) throw invalid([{ code: 'payments_too_many' }]);
  // 1.4: a sale is paid now or put on the customer's account, never part one and part the other
  const onCredit = payments.some((p) => p.method === 'account');
  // (a till page loaded before 1.4 still offers that split and has no words for the first code: the second is one it
  // can show, so its cashier reads that the payment is the trouble)
  if (onCredit && payments.some((p) => p.method !== 'account')) throw invalid([{ code: 'pos_credit_not_mixed' }, { code: 'pos_payment_invalid', method: 'account' }]);
  const accounts = posPaymentAccounts(db);
  const mine = posAccountsFor(db, actor);
  const errors: { code: string; method?: string }[] = [];
  for (const p of payments) {
    if (!(POS_METHODS as readonly string[]).includes(p.method) || !Number.isSafeInteger(p.amount) || p.amount <= 0) errors.push({ code: 'pos_payment_invalid', method: String(p.method) });
    // a method the admin gave no account is not offered at the counter, and refused here
    else if (p.method !== 'cash' && p.method !== 'account' && !accounts[p.method as keyof PosAccounts]) errors.push({ code: 'pos_method_unavailable', method: p.method });
    // its account is outside the user's branches: not offered to them either, and never debited for them
    else if (p.method !== 'cash' && p.method !== 'account' && !mine[p.method as keyof PosAccounts]) errors.push({ code: 'pos_method_other_branch', method: p.method });
    else if (p.method === 'account' && !input.partyId) errors.push({ code: 'party_required' });
    // on a customer's account needs the live credit-limit check: never from a till that was offline
    else if (p.method === 'account' && input.offline) errors.push({ code: 'pos_offline_on_account' });
  }
  const offline = input.offline;
  if (offline && (!OFFLINE_REFERENCE.test(offline.reference) || !ISO_INSTANT.test(offline.soldAt) || Number.isNaN(Date.parse(offline.soldAt)))) {
    errors.push({ code: 'pos_offline_invalid' });
  }
  // loyalty points need the customer's live balance: never from a till that was offline
  if (offline && input.loyaltyPoints) errors.push({ code: 'pos_offline_loyalty' });
  // 2.0: dollar notes on a dinar sale paid now, at a rate near the company's (a slip of a digit is refused)
  const usdCash = input.usdCash;
  if (usdCash) {
    const companyRate = Number(readSetting(db, 'default_rate_x100') ?? '142000');
    if (input.currency !== 'IQD' || onCredit) errors.push({ code: 'pos_usd_cash_not_here' });
    else if (!Number.isSafeInteger(usdCash.amount) || usdCash.amount <= 0 || usdCash.amount > 10_000_000) errors.push({ code: 'pos_usd_cash_invalid' });
    else if (!Number.isSafeInteger(usdCash.rateX100) || usdCash.rateX100 <= 0 || Math.abs(usdCash.rateX100 - companyRate) > companyRate * 0.15) errors.push({ code: 'pos_usd_rate_far' });
  }
  // 2.0: the till's rules (till-settings.ts): gift vouchers, the open-price item, prices and discounts a supervisor approves
  const rules = tillRules(db);
  const vouchers = input.vouchers ?? [];
  if (vouchers.length && offline) errors.push({ code: 'pos_offline_voucher' });
  if (vouchers.length && input.currency !== 'IQD') errors.push({ code: 'gv_dinar_only' });
  const misc = rules.misc.itemId ? input.lines.filter((l) => l.itemId === rules.misc.itemId) : [];
  if (misc.length) {
    if (!maySellMisc(rules.misc, actor)) errors.push({ code: 'pos_misc_not_allowed' });
    else if (misc.some((l) => Math.round(((l.unitQtyMilli ?? l.qtyMilli ?? 1000) * l.unitPrice) / 1000) > rules.misc.max)) errors.push({ code: 'pos_misc_over_max' });
    if (!input.notes?.trim()) errors.push({ code: 'pos_misc_note_required' });
  }
  if (errors.length) throw invalid(errors);
  const gross = input.lines.reduce((sum, l) => sum + Math.round(((l.unitQtyMilli ?? l.qtyMilli ?? 1000) * l.unitPrice) / 1000), 0);
  const needs: ('discount' | 'price')[] = [];
  if (rules.supervisor.discountPct > 0 && input.discount * 100 > rules.supervisor.discountPct * gross) needs.push('discount');
  if (rules.supervisor.price) {
    // a line below the item's own price (same currency, its base unit; the open-price item is open)
    const price = db.prepare('SELECT sale_price, sale_currency FROM items WHERE id = ?');
    const lower = input.lines.some((l) => {
      if (l.unit || l.itemId === rules.misc.itemId) return false;
      const it = price.get(l.itemId) as { sale_price: number | null; sale_currency: string } | undefined;
      return !!it && it.sale_price !== null && it.sale_currency === input.currency && l.unitPrice < Number(it.sale_price);
    });
    if (lower) needs.push('price');
  }
  if (needs.length && offline) throw invalid([{ code: 'pos_offline_supervisor' }]);
  const now = new Date();
  const date = offline ? offlineSaleDate(offline.soldOn, row.opened_at, now) : todayIso(now);
  const voucherCheck = vouchers.length ? giftParts(db, vouchers, date) : [];
  void voucherCheck;
  // 1.7: the offers are those on when it was sold (an offline sale: the moment on its receipt, never in the future)
  const offersAt = offline && Date.parse(offline.soldAt) <= now.getTime() ? new Date(offline.soldAt) : now;
  const { invoiceId, rounding: rounded } = transaction(db, () => {
    const draft = createInvoice(db, {
      kind: 'sale', date, ...(input.partyId ? { partyId: input.partyId } : {}), warehouseId: row.warehouse_id,
      currency: input.currency, rateX100: input.currency === 'IQD' ? 100 : input.rateX100!,
      // a sale on the customer's account is a credit invoice (Dr the customer), like one made on the invoice screen
      ...(onCredit ? { payment: 'credit' as const } : { payment: 'cash' as const, cashAccountCode: row.cash_account }),
      discount: input.discount, ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      lines: input.lines.map((l) => ({
        itemId: l.itemId, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, ...(l.unit ? { unit: l.unit, unitQtyMilli: l.unitQtyMilli ?? l.qtyMilli } : {}),
        ...(l.batchId ? { batchId: l.batchId } : {})
      }))
    }, actor.name, { offersAt });
    for (const action of needs) useApproval(db, input.approvals, shiftId, action, actor.name);
    let split: (SalePart & { method?: PosMethod })[] | undefined;
    // what loyalty points pay (checked again as the sale is posted); the parts pay the rest
    const byPoints = input.loyaltyPoints
      ? planRedemption(db, { partyId: input.partyId, points: input.loyaltyPoints, total: draft.total, currency: draft.currency, date: draft.date }).value
      : 0;
    // 2.0: what gift vouchers pay (checked and taken in this transaction)
    const gifts = vouchers.length ? giftParts(db, vouchers, draft.date) : [];
    const byGifts = gifts.reduce((sum, g) => sum + g.amount, 0);
    if (byGifts > draft.total - byPoints) throw invalid([{ code: 'gv_too_much' }]);
    if (payments.length) {
      if (payments.reduce((s, p) => s + p.amount, 0) !== draft.total - byPoints - byGifts) throw invalid([{ code: 'payments_total_mismatch', total: draft.total - byPoints - byGifts } as { code: string }]);
      const partyAccount = input.partyId ? (db.prepare('SELECT account_code FROM parties WHERE id = ?').get(input.partyId) as { account_code: string } | undefined)?.account_code : undefined;
      // the same method twice is one part
      const merged = new Map<PosMethod, number>();
      for (const p of payments) merged.set(p.method, (merged.get(p.method) ?? 0) + p.amount);
      split = [...merged].map(([method, amount]) => ({
        method, amount,
        accountCode: method === 'cash' ? row.cash_account : method === 'account' ? partyAccount! : mine[method as keyof PosAccounts]!,
        ...(method === 'account' ? { partyId: input.partyId } : {})
      }));
    }
    // 2.0: gift vouchers and the dinar rounding of the cash part are parts of their own beside the money paid
    let rounding = 0;
    if (!onCredit) {
      const rest = draft.total - byPoints - byGifts;
      if ((gifts.length || rules.rounding.step) && !split) split = rest > 0 ? [{ method: 'cash', amount: rest, accountCode: row.cash_account }] : [];
      for (const g of gifts) split!.push({ accountCode: g.accountCode, amount: g.amount, kind: 'voucher' });
      const cashPart = split?.find((p) => p.method === 'cash');
      if (cashPart && input.currency === 'IQD' && rules.rounding.step) {
        rounding = roundCash(cashPart.amount, rules.rounding) - cashPart.amount;
        if (rounding) {
          cashPart.amount += rounding;
          split!.push({ accountCode: roundingAccount(db, rounding), amount: -rounding, kind: 'rounding' });
        }
      }
      if (split && !split.length) split = undefined;
    }
    // a credit sale over the customer's limit: only with a supervisor's approval given at this till
    let overLimit = false;
    if (onCredit && rules.supervisor.creditOver && input.approvals?.length) {
      try { useApproval(db, input.approvals, shiftId, 'credit_over', actor.name); overLimit = true; } catch { overLimit = false; }
    }
    // (a credit invoice posts to the customer's account by itself, with its credit limit checked: no parts are passed)
    const posted = postInvoice(db, draft.id, actor.name, {
      allowExpired: input.allowExpired === true, ...(split && !onCredit ? { split } : {}), ...(input.loyaltyPoints ? { loyaltyPoints: input.loyaltyPoints } : {}), offersAt,
      ...(overLimit ? { overLimit: true } : {})
    });
    if (gifts.length) takeGiftParts(db, posted.id, gifts, actor.name);
    // the cash handed over: kept for a cash sale when it covers the cash due (the cash part, or all that points left)
    const cashDue = onCredit ? 0 : split ? split.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0) : draft.total - byPoints;
    const tendered = Number.isSafeInteger(input.tendered) && cashDue > 0 && input.tendered! >= cashDue ? input.tendered! : null;
    if (usdCash) {
      // the dollars stand for part of the cash due (or all of it, with change in dinars), never more than a 100-dollar
      // note past it, and never on a sale with no cash part
      const worth = usdCashValue(usdCash.amount, usdCash.rateX100);
      if (cashDue <= 0 || worth - cashDue >= usdCash.rateX100) throw invalid([{ code: 'pos_usd_cash_too_much', due: cashDue } as { code: string }]);
    }
    db.prepare('INSERT INTO pos_sales (invoice_id, shift_id, tendered, usd_cash, usd_rate_x100, rounding) VALUES (?, ?, ?, ?, ?, ?)')
      .run(posted.id, shiftId, tendered, usdCash?.amount ?? null, usdCash?.rateX100 ?? null, rounding);
    if (usdCash) audit(db, actor.name, 'usd_cash', 'invoice', posted.id, { usd: usdCash.amount, rateX100: usdCash.rateX100, number: posted.number });
    if (split) {
      const insert = db.prepare(`INSERT INTO invoice_payments (id, invoice_id, kind, method, account_code, amount, currency, entry_id, source, reference, created_by, created_at)
                                 VALUES (?, ?, 'pos', ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`);
      const now = new Date().toISOString();
      for (const p of split) if (p.method) insert.run(randomUUID(), posted.id, p.method, p.accountCode, p.amount, posted.currency, posted.entryId, actor.name, now);
    }
    if (offline) {
      // the receipt's temporary reference stays with the sale, so both it and the invoice number find it
      const soldAt = Date.parse(offline.soldAt) > now.getTime() ? now.toISOString() : new Date(offline.soldAt).toISOString();
      db.prepare('INSERT INTO pos_offline_sales (invoice_id, reference, sold_at, synced_at) VALUES (?, ?, ?, ?)')
        .run(posted.id, offline.reference, soldAt, now.toISOString());
      audit(db, actor.name, 'offline_sale', 'invoice', posted.id, { reference: offline.reference, soldAt, number: posted.number });
    }
    if (rounding) audit(db, actor.name, 'cash_rounding', 'invoice', posted.id, { rounding, number: posted.number });
    return { invoiceId: posted.id, rounding };
  });
  return { invoice: getInvoice(db, invoiceId, userBranchLists(db, actor)), shift: getShift(db, shiftId, actor), rounding: rounded };
}

/**
 * A sale booked by a first try whose answer never reached the till: the till printed its receipt with a temporary
 * reference afterwards, and that reference is kept now, so it finds the sale too. Once only.
 */
export function attachOfflineReference(db: Db, invoiceId: string, offline: OfflineSale, user: string): void {
  if (!OFFLINE_REFERENCE.test(offline.reference)) return;
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM pos_offline_sales WHERE invoice_id = ?').get(invoiceId)) return;
    if (!db.prepare('SELECT 1 FROM pos_sales WHERE invoice_id = ?').get(invoiceId)) return;
    const now = new Date();
    const soldAt = ISO_INSTANT.test(offline.soldAt) && Date.parse(offline.soldAt) <= now.getTime() ? new Date(offline.soldAt).toISOString() : now.toISOString();
    db.prepare('INSERT INTO pos_offline_sales (invoice_id, reference, sold_at, synced_at) VALUES (?, ?, ?, ?)').run(invoiceId, offline.reference, soldAt, now.toISOString());
    audit(db, user, 'offline_sale', 'invoice', invoiceId, { reference: offline.reference, soldAt, sentBefore: true });
  });
}

export function closeShift(db: Db, id: string, input: CloseInput, actor: Actor): ShiftView {
  requireRunnable(db, id, actor);
  const errors: { code: string }[] = [];
  if (!isAmount(input.countedCash)) errors.push({ code: 'amount_invalid' });
  if (input.countedUsd !== undefined && !isAmount(input.countedUsd)) errors.push({ code: 'amount_invalid' });
  if (errors.length) throw invalid(errors);
  transaction(db, () => {
    const before = getShift(db, id, actor);
    const notes = [before.notes, input.notes?.trim()].filter(Boolean).join('\n');
    const now = new Date().toISOString();
    db.prepare(`UPDATE pos_shifts SET status = 'closed', closed_by = ?, closed_at = ?, expected_cash = ?, counted_cash = ?, expected_usd = ?, counted_usd = ?, notes = ?
                WHERE id = ?`)
      .run(actor.name, now, before.expected.IQD, input.countedCash, before.expected.USD, input.countedUsd ?? 0, notes || null, id);
    audit(db, actor.name, 'close', 'pos_shift', id, {
      number: before.number, expected: before.expected, counted: { IQD: input.countedCash, USD: input.countedUsd ?? 0 },
      difference: { IQD: input.countedCash - before.expected.IQD, USD: (input.countedUsd ?? 0) - before.expected.USD }
    });
  });
  return getShift(db, id, actor);
}

// ——— the API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(64);
const idParam = z.object({ id });
const text = (max: number) => z.string().max(max);

/**
 * The point of sale API. Opening, selling and closing need the Point of sale permission ('pos', 1.5.2: the sales role
 * alone no longer does; nobody gets it by an update, an admin gives it in Users), and selling or closing a shift is for
 * whoever opened it (or an admin). The till's own reads (the open shift of this user, the card and wallet accounts it
 * takes) need 'pos' too. Reading shifts and their reports (the X report of an open shift, the Z report of a closed
 * one: GET /api/pos/shifts and /api/pos/shifts/:id) stays as it was: whoever keeps or reads the books reads every
 * shift, anyone else only the shifts they opened (readsShift), so a cashier keeps reading their old shifts.
 *
 * The rules are checked before any route runs (routes.ts), for a request from this PC, from a PC on the office network
 * or through Qasa Relay alike, and for a sale a till kept while offline and sends later (its outbox): sent by someone
 * without 'pos' it is refused (403), never booked.
 */
export const posApi: ApiExtension = {
  rules: {
    'POST /api/pos/shifts': 'pos',
    'POST /api/pos/shifts/:id/sales': 'pos',
    'POST /api/pos/shifts/:id/close': 'pos',
    'GET /api/pos/current': 'pos',
    'GET /api/pos/payment-accounts': 'pos'
    // PUT /api/pos/payment-accounts is not listed: it needs an admin, as every change not listed does
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      {
        method: 'GET', path: '/api/pos/shifts',
        handler: async (req) => {
          const f = parse(z.object({ status: z.enum(['open', 'closed']).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }), req.query);
          const who = actor(req);
          // 2.0: a cashier who closes blind never reads the cash expected (till-settings.ts)
          return closesBlind(db, who) ? listShifts(db, f, who).map(blindShift) : listShifts(db, f, who);
        }
      },
      {
        method: 'GET', path: '/api/pos/current',
        handler: async (req) => {
          const who = actor(req);
          const shift = myShift(db, who, parse(z.object({ tillId: id.optional() }), req.query ?? {}).tillId ?? null);
          return { shift: shift && closesBlind(db, who) ? blindShift(shift) : shift };
        }
      },
      { method: 'GET', path: '/api/pos/payment-accounts', handler: async (req) => ({ accounts: posAccountsFor(db, actor(req)), methods: posMethods(db, actor(req)) }) },
      {
        method: 'PUT', path: '/api/pos/payment-accounts',
        handler: async (req) => {
          const code = z.string().max(12).optional();
          const body = parse(z.object({ card: code, fib: code, zaincash: code, qi: code }), req.body);
          return { accounts: setPosPaymentAccounts(db, body, actor(req).name), methods: posMethods(db, actor(req)) };
        }
      },
      {
        method: 'GET', path: '/api/pos/shifts/:id',
        handler: async (req) => {
          const who = actor(req);
          const report = shiftReport(db, parse(idParam, req.params).id, who);
          return closesBlind(db, who) ? blindShift(report) : report;
        }
      },
      {
        method: 'POST', path: '/api/pos/shifts',
        handler: async (req, reply) => {
          const body = parse(z.object({
            tillId: id.optional(), register: text(60), cashAccountCode: z.string().min(1).max(12), warehouseId: id, openingCash: amount, notes: text(500).optional()
          }), req.body);
          reply.status(201).send(openShift(db, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/pos/shifts/:id/sales',
        handler: async (req, reply) => {
          const body = parse(z.object({
            currency: z.enum(['IQD', 'USD']), rateX100: z.number().int().positive().optional(), partyId: id.optional(), discount: amount.default(0),
            notes: text(500).optional(),
            lines: z.array(z.object({
              itemId: id, qtyMilli: z.number().int().positive().max(1e12).optional(), unitPrice: amount,
              unit: z.enum(UNIT_CODES).optional(), unitQtyMilli: z.number().int().positive().max(1e12).optional(), batchId: id.optional()
            })).min(1).max(300),
            allowExpired: z.boolean().optional(),
            payments: z.array(z.object({ method: z.enum(POS_METHODS), amount: amount.refine((n) => n > 0) })).min(1).max(4).optional(),
            offline: z.object({
              reference: z.string().max(40).regex(OFFLINE_REFERENCE), soldAt: z.string().max(30).regex(ISO_INSTANT), soldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
            }).optional(),
            loyaltyPoints: z.number().int().positive().max(100_000_000).optional(),
            tendered: amount.optional(),
            usdCash: z.object({ amount: z.number().int().positive().max(10_000_000), rateX100: z.number().int().positive().max(100_000_000) }).optional(),
            approvals: z.array(id).max(8).optional(),
            vouchers: z.array(z.object({ code: z.string().min(4).max(40), amount: amount.refine((n) => n > 0) })).max(4).optional()
          }), req.body);
          const shiftId = parse(idParam, req.params).id;
          const who = actor(req);
          // a till sends a sale again with the same key after a lost link: it is booked once (idempotency.ts). The first
          // try may have gone out before the till knew it was offline, without the offline stamp the till added after:
          // the stamp is not part of what must match, and a sale booked by that first try gets its receipt reference then
          const { offline: _stamp, ...sameEachTime } = (req.body ?? {}) as Record<string, unknown>;
          const made = onceOnly(db, req, reply, who, 'POST /api/pos/shifts/:id/sales', () => {
            const result = sell(db, shiftId, body, who);
            return { id: result.invoice.id, result };
          }, (invoiceId) => {
            if (body.offline) attachOfflineReference(db, invoiceId, body.offline, who.name);
            const kept = db.prepare('SELECT rounding FROM pos_sales WHERE invoice_id = ?').get(invoiceId) as { rounding: number } | undefined;
            return { invoice: getInvoice(db, invoiceId, userBranchLists(db, who)), shift: getShift(db, shiftId, who), rounding: Number(kept?.rounding ?? 0) };
          }, { fingerprint: sameEachTime });
          // a cashier who closes blind: the shift's totals stay out of the answer
          reply.status(201).send(closesBlind(db, who) && made && typeof made === 'object' && 'shift' in made ? { ...made, shift: blindShift((made as { shift: ShiftView }).shift) } : made);
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/pos/shifts/:id/close',
        handler: async (req) => {
          const body = parse(z.object({ countedCash: amount, countedUsd: amount.optional(), notes: text(500).optional() }), req.body);
          const who = actor(req);
          const closed = closeShift(db, parse(idParam, req.params).id, body, who);
          return closesBlind(db, who) ? blindShift(closed) : closed;
        }
      }
    ];
  }
};
