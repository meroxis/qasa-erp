import { randomUUID } from 'node:crypto';
import {
  accountNames,
  allocateDiscount,
  costOut,
  invoiceTotals,
  normalizeForSearch,
  roundHalfUp,
  toBase,
  toBaseBalanced,
  todayIso,
  validateInvoice,
  type CurrencyCode,
  type EntryInput,
  type InvoiceDocKind,
  type InvoiceInput,
  type InvoiceKind,
  type InvoiceStatus,
  type Lang,
  type LineInput,
  type Names,
  type PaymentMode,
  type UnitCode
} from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import type { Actor } from './auth.ts';
import { loadAccounts } from './accounts.ts';
import { assertValid, insertEntry, nextNumber, reverseEntryInternal } from './journal.ts';
import { getParty } from './parties.ts';
import { addStockMove, stockOf } from './items.ts';
import { getPostingAccounts, isPeriodLocked, readSetting } from './settings.ts';
import { entryInBranchSql } from './branches.ts';
import { postedRevaluations } from './fx.ts';
import { cancelLoyalty, invoiceLoyalty, planRedemption, recordSaleLoyalty, type InvoiceLoyaltyView } from './loyalty.ts';
import { resolveLines } from './item-units.ts';
import {
  addTaken, allocateOut, assertReversible, batchColumns, batchTracking, cancelBatchMoves, inboundBatch, lineBatchErrors, writeBatchMoves,
  type BatchError, type BatchMove
} from './batches.ts';

export type InvoiceAction = 'edit' | 'delete' | 'post' | 'cancel' | 'return';

/** A part of a sale paid another way (POS split payments): internal callers only, never from a request. */
export interface SalePart { accountCode: string; amount: number; partyId?: string | undefined }

export interface InvoiceLineView {
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: Names;
  unit: UnitCode;
  trackStock: boolean;
  description: string;
  qtyMilli: number;
  unitPrice: number;
  amount: number;
  /** IQD: cost of goods sold (sales) or value added to stock (purchases). Set when posted. */
  cost: number | null;
  /** On a return: the line of the original invoice it gives back. */
  sourceLine: number | null;
  /** On a posted invoice: how much of the line posted returns have given back. */
  returnedQtyMilli: number;
  /** Rounded gross amount already returned; used when previewing another partial return. */
  returnedAmount: number;
  /** 1.1: the unit the line was typed in (null: the item's base unit), its factor then, and the quantity as typed */
  lineUnit: UnitCode | null;
  unitFactorMilli: number | null;
  unitQtyMilli: number | null;
  /** 1.1: the batch a purchase line brought in (number and expiry), or the batch a sale line was pinned to (null: earliest expiry first) */
  batchNo: string | null;
  expiry: string | null;
  batchId: string | null;
}

export interface InvoiceSummary {
  id: string;
  kind: InvoiceDocKind;
  status: InvoiceStatus;
  number: string | null;
  date: string;
  partyId: string | null;
  partyCode: string | null;
  partyName: string | null;
  warehouseId: string;
  currency: CurrencyCode;
  rateX100: number;
  payment: PaymentMode;
  cashAccountCode: string | null;
  discount: number;
  subtotal: number;
  total: number;
  /** Total in IQD. */
  baseTotal: number;
  notes: string;
  /** On a return: the invoice it returns goods from. */
  returnOf: string | null;
  createdBy: string;
  createdAt: string;
  /** 1.1: online payments recorded on it (a website order), in its currency */
  paidOnline: number;
}

/** Money taken for an invoice outside its own cash or credit: POS parts and online payments (1.1). */
export interface InvoicePaymentView {
  id: string; kind: 'pos' | 'online'; method: string; accountCode: string; amount: number; currency: CurrencyCode;
  reference: string | null; source: string | null; entryId: string | null; entryNumber: string | null; entryStatus: string | null; createdAt: string;
}

/**
 * 1.4: where a posted credit invoice stands, in its own currency: what was received for it (or paid, on a purchase)
 * and what is still open on it. Money counts for the invoice when it was taken with it (an online payment) or by a
 * "Receive payment" / "Pay supplier" voucher made from it (invoice_vouchers).
 */
export interface InvoiceSettlement {
  currency: CurrencyCode;
  total: number;
  /** goods given back on credit: they lowered what is owed for it */
  returned: number;
  /** received for it and in the books: online payments and its vouchers that are approved; never more than total − returned */
  received: number;
  /** its vouchers and online payments not in the books yet (waiting for approval, or a draft for the usual checking) */
  waiting: number;
  /** total − returned − received, never below zero and never more than its party owes in all: what is still open on it */
  open: number;
  /** open − waiting, never below zero: what is left to ask for, so money that waits is not collected twice */
  toCollect: number;
  /** what its party owes in all (never below zero), in the invoice's currency, as far as the reader may read the books */
  owed: number;
  /**
   * the party owes less than its invoices leave unreceived together: money was received without naming an invoice, the
   * books do not say which one it paid, and `open` is the most that can still be open on this one
   */
  unsure: boolean;
}

export interface InvoiceView extends InvoiceSummary {
  partyPhone: string | null;
  partyAddress: string | null;
  /** 1.2: the language the customer gets WhatsApp messages in (null: the app's) */
  partyLang: Lang | null;
  warehouseCode: string;
  warehouseName: Names;
  cashAccountName: Names | null;
  entryId: string | null;
  entryNumber: string | null;
  cancelEntryId: string | null;
  cancelEntryNumber: string | null;
  postedBy: string | null;
  postedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  lines: InvoiceLineView[];
  actions: InvoiceAction[];
  returnOfNumber: string | null;
  /** Returns made from this invoice. */
  returns: { id: string; kind: InvoiceDocKind; number: string | null; date: string; status: InvoiceStatus; total: number }[];
  /** The installment contract that schedules this sale (Pro), while it is active. */
  installmentContract: { id: string; number: string } | null;
  payments: InvoicePaymentView[];
  /** 1.2: a till's sale made offline: the temporary reference printed on its receipt (only on such a sale) */
  offlineRef?: string;
  /** 1.2 (Pro): the loyalty points it earned and used, and the customer's balance (null: none and points are off) */
  loyalty: InvoiceLoyaltyView | null;
  /** 1.4: a posted credit sale or purchase: what was received for it and what is still open (null: any other invoice) */
  settlement: InvoiceSettlement | null;
  /** 1.4: a till's cash sale: the cash handed over and the change given back (only when it was typed at the till) */
  tender?: { paid: number; change: number };
}

interface InvoiceRow {
  id: string; kind: InvoiceDocKind; return_of: string | null; status: InvoiceStatus; number: string | null; date: string; party_id: string | null;
  warehouse_id: string; currency: CurrencyCode; rate_x100: number; payment: PaymentMode; cash_account: string | null;
  discount: number; subtotal: number; total: number; notes: string | null; entry_id: string | null; cancel_entry_id: string | null;
  created_by: string; created_at: string; posted_by: string | null; posted_at: string | null; cancelled_by: string | null; cancelled_at: string | null;
  party_code: string | null; party_name: string | null;
  settlement_base: number | null;
  online_paid: number | null;
}

export const isReturn = (kind: InvoiceDocKind) => kind === 'sale_return' || kind === 'purchase_return';

function hasPostedReturns(db: Db, id: string): boolean {
  return !!db.prepare("SELECT 1 FROM invoices WHERE return_of = ? AND status = 'posted' LIMIT 1").get(id);
}

/** What posted returns have already given back, per line of the original invoice. */
export function returnedByLine(db: Db, originalId: string): Map<number, { qtyMilli: number; amount: number; discount: number; cost: number }> {
  const rows = db.prepare(`SELECT l.source_line, SUM(l.qty_milli) AS qty, SUM(l.amount) AS amount, SUM(COALESCE(l.discount_share, 0)) AS discount, SUM(COALESCE(l.cost, 0)) AS cost
                           FROM invoice_lines l JOIN invoices r ON r.id = l.invoice_id
                           WHERE r.return_of = ? AND r.status = 'posted' GROUP BY l.source_line`).all(originalId) as
    { source_line: number; qty: number; amount: number; discount: number; cost: number }[];
  return new Map(rows.map((r) => [r.source_line, { qtyMilli: r.qty, amount: r.amount, discount: r.discount, cost: r.cost }]));
}

/** The active installment contract that schedules a sale; while there is one, the sale is neither cancelled nor returned. */
export function activeContractOf(db: Db, invoiceId: string): { id: string; number: string } | null {
  return (db.prepare("SELECT id, number FROM installment_contracts WHERE invoice_id = ? AND status = 'active'").get(invoiceId) as
    { id: string; number: string } | undefined) ?? null;
}

function actionsFor(db: Db, row: Pick<InvoiceRow, 'id' | 'kind' | 'status'>, anyLeftToReturn = false): InvoiceAction[] {
  if (row.status === 'draft') return ['edit', 'delete', 'post'];
  if (row.status !== 'posted') return [];
  if (isReturn(row.kind)) return ['cancel'];
  if (activeContractOf(db, row.id)) return [];
  // an invoice with returns is cancelled only after its returns are
  const actions: InvoiceAction[] = hasPostedReturns(db, row.id) ? [] : ['cancel'];
  if (anyLeftToReturn) actions.push('return');
  return actions;
}

function toSummary(r: InvoiceRow): InvoiceSummary {
  return {
    id: r.id, kind: r.kind, status: r.status, number: r.number, date: r.date, partyId: r.party_id, partyCode: r.party_code, partyName: r.party_name,
    warehouseId: r.warehouse_id, currency: r.currency, rateX100: r.rate_x100, payment: r.payment, cashAccountCode: r.cash_account,
    discount: r.discount, subtotal: r.subtotal, total: r.total, baseTotal: r.settlement_base ?? toBase(r.total, r.currency, r.rate_x100), notes: r.notes ?? '',
    returnOf: r.return_of, createdBy: r.created_by, createdAt: r.created_at, paidOnline: Number(r.online_paid ?? 0)
  };
}

const SELECT_INVOICE = `SELECT v.*, p.code AS party_code, p.name AS party_name,
  (SELECT SUM(CASE WHEN v.kind IN ('purchase', 'sale_return') THEN l.base_credit - l.base_debit ELSE l.base_debit - l.base_credit END)
   FROM entry_lines l WHERE l.entry_id = v.entry_id AND
     ((v.payment = 'cash' AND (l.account_code = v.cash_account
         OR l.account_code IN (SELECT ip.account_code FROM invoice_payments ip WHERE ip.invoice_id = v.id AND ip.kind = 'pos' AND ip.entry_id = v.entry_id)))
      OR (v.payment = 'credit' AND l.party_id = v.party_id)))
   -- 1.2: what loyalty points paid of a sale, or gave back on a return, is part of its settlement too
   + COALESCE((SELECT SUM(lm.value) FROM loyalty_moves lm WHERE lm.invoice_id = v.id AND lm.kind IN ('redeem', 'return_redeem')), 0) AS settlement_base,
  (SELECT SUM(ip.amount) FROM invoice_payments ip JOIN entries ie ON ie.id = ip.entry_id
   WHERE ip.invoice_id = v.id AND ip.kind = 'online' AND ie.reversed_by_id IS NULL) AS online_paid
  FROM invoices v LEFT JOIN parties p ON p.id = v.party_id`;

/** Active refunds in both currencies. Read the posted settlement, including its rounding allocation. */
export function returnedTotals(db: Db, originalId: string): { total: number; baseTotal: number } {
  const rows = db.prepare(`${SELECT_INVOICE} WHERE v.return_of = ? AND v.status = 'posted'`).all(originalId) as unknown as InvoiceRow[];
  return rows.reduce((sum, row) => {
    const value = toSummary(row);
    return { total: sum.total + value.total, baseTotal: sum.baseTotal + value.baseTotal };
  }, { total: 0, baseTotal: 0 });
}

function loadRow(db: Db, id: string): InvoiceRow {
  const row = db.prepare(`${SELECT_INVOICE} WHERE v.id = ?`).get(id) as unknown as InvoiceRow | undefined;
  if (!row) throw notFound('invoice');
  return row;
}

/** `branch`: the lists of a reader limited to branches (null: the whole company); what is open on it is read from those. */
export function getInvoice(db: Db, id: string, branch: ReaderBranch = null): InvoiceView {
  const r = loadRow(db, id);
  const party = r.party_id ? db.prepare('SELECT phone, address, lang FROM parties WHERE id = ?').get(r.party_id) as { phone: string | null; address: string | null; lang: Lang | null } : null;
  const w = db.prepare('SELECT code, name_ar, name_en, name_ku FROM warehouses WHERE id = ?').get(r.warehouse_id) as { code: string; name_ar: string; name_en: string; name_ku: string };
  const cash = r.cash_account ? db.prepare('SELECT name_ar, name_en, name_ku FROM accounts WHERE code = ?').get(r.cash_account) as { name_ar: string; name_en: string; name_ku: string } : null;
  const numberOf = (entryId: string | null) => entryId ? (db.prepare('SELECT number FROM entries WHERE id = ?').get(entryId) as { number: string | null }).number : null;
  const lines = (db.prepare(`SELECT l.line_no, l.item_id, l.description, l.qty_milli, l.unit_price, l.amount, l.cost, l.source_line, l.unit AS line_unit, l.unit_factor_milli, l.unit_qty_milli, l.batch_no, l.expiry, l.batch_id, i.code, i.name_ar, i.name_en, i.name_ku, i.unit, i.track_stock FROM invoice_lines l JOIN items i ON i.id = l.item_id
                             WHERE l.invoice_id = ? ORDER BY l.line_no`).all(id) as {
    line_no: number; item_id: string; description: string | null; qty_milli: number; unit_price: number; amount: number; cost: number | null; source_line: number | null;
    code: string; name_ar: string; name_en: string; name_ku: string; unit: UnitCode; track_stock: number;
    line_unit: UnitCode | null; unit_factor_milli: number | null; unit_qty_milli: number | null;
    batch_no: string | null; expiry: string | null; batch_id: string | null;
  }[]);
  const returned = r.status === 'posted' && !isReturn(r.kind) ? returnedByLine(db, id) : new Map<number, { qtyMilli: number; amount: number }>();
  const lineViews: InvoiceLineView[] = lines.map((l) => ({
    lineNo: l.line_no, itemId: l.item_id, itemCode: l.code, itemName: { ar: l.name_ar, en: l.name_en, ku: l.name_ku }, unit: l.unit,
    trackStock: l.track_stock === 1, description: l.description ?? '', qtyMilli: l.qty_milli, unitPrice: l.unit_price, amount: l.amount, cost: l.cost,
    sourceLine: l.source_line, returnedQtyMilli: returned.get(l.line_no)?.qtyMilli ?? 0, returnedAmount: returned.get(l.line_no)?.amount ?? 0,
    lineUnit: l.line_unit ?? null,
    unitFactorMilli: l.unit_factor_milli === null ? null : Number(l.unit_factor_milli),
    unitQtyMilli: l.unit_qty_milli === null ? null : Number(l.unit_qty_milli),
    batchNo: l.batch_no ?? null, expiry: l.expiry ?? null, batchId: l.batch_id ?? null
  }));
  const returns = db.prepare('SELECT id, kind, number, date, status, total FROM invoices WHERE return_of = ? ORDER BY date, created_at').all(id) as
    { id: string; kind: InvoiceDocKind; number: string | null; date: string; status: InvoiceStatus; total: number }[];
  return {
    ...toSummary(r),
    partyPhone: party?.phone ?? null, partyAddress: party?.address ?? null, partyLang: party?.lang ?? null,
    warehouseCode: w.code, warehouseName: { ar: w.name_ar, en: w.name_en, ku: w.name_ku },
    cashAccountName: cash && r.cash_account ? accountNames(r.cash_account, { ar: cash.name_ar, en: cash.name_en, ku: cash.name_ku }) : null,
    entryId: r.entry_id, entryNumber: numberOf(r.entry_id), cancelEntryId: r.cancel_entry_id, cancelEntryNumber: numberOf(r.cancel_entry_id),
    postedBy: r.posted_by, postedAt: r.posted_at, cancelledBy: r.cancelled_by, cancelledAt: r.cancelled_at,
    lines: lineViews, actions: actionsFor(db, r, lineViews.some((l) => l.returnedQtyMilli < l.qtyMilli)),
    returnOfNumber: r.return_of ? (db.prepare('SELECT number FROM invoices WHERE id = ?').get(r.return_of) as { number: string | null }).number : null,
    returns,
    installmentContract: activeContractOf(db, id),
    payments: invoicePayments(db, id),
    loyalty: r.status === 'posted' && (r.kind === 'sale' || r.kind === 'sale_return') ? invoiceLoyalty(db, id, r.party_id) : null,
    settlement: invoiceSettlement(db, r, branch),
    ...tenderOf(db, r),
    ...offlineRefOf(db, id)
  };
}

/** An amount of an entry (its own currency, and the same in IQD) read in an invoice's currency. */
function inInvoiceCurrency(own: number, base: number, entryCurrency: CurrencyCode, currency: CurrencyCode, rateX100: number): number {
  if (entryCurrency === currency) return own;
  if (currency === 'IQD') return base;
  return rateX100 > 0 ? roundHalfUp((base * 10000) / rateX100) : 0;
}

/** The warehouses and safes of the branches a reader is limited to (null: the whole company). */
export type ReaderBranch = { warehouses: readonly string[]; accounts: readonly string[] } | null;

interface Standing { currency: CurrencyCode; rateX100: number; total: number; returned: number; received: number; waiting: number }

/**
 * Every posted credit invoice of one side of a party (sales, or purchases) that no active instalment contract
 * schedules, with what is known to be for it: goods returned on credit, the vouchers made from it and the payments
 * taken online for it. In the books: received; not yet (waiting for approval, a draft still to be checked): waiting; a
 * rejected, reversed or deleted one counts no longer. A voucher counts by what it puts on this party's account, so one
 * corrected on the vouchers screen follows. For a reader limited to branches: their warehouses' invoices (and `keep`,
 * the one being read) and the vouchers they may read.
 */
function standings(db: Db, partyId: string, kind: 'sale' | 'purchase', branch: ReaderBranch, keep: string): Map<string, Standing> {
  const sign = kind === 'sale' ? 1 : -1;
  const marks = branch?.warehouses.length ? branch.warehouses.map(() => '?').join(', ') : 'NULL';
  const invoices = db.prepare(`SELECT v.id, v.currency, v.rate_x100, v.total,
                                 (SELECT COALESCE(SUM(rt.total), 0) FROM invoices rt WHERE rt.return_of = v.id AND rt.status = 'posted' AND rt.payment = 'credit') AS returned
                               FROM invoices v
                               WHERE v.party_id = ? AND v.kind = ? AND v.status = 'posted' AND v.payment = 'credit'
                                 AND NOT EXISTS (SELECT 1 FROM installment_contracts c WHERE c.invoice_id = v.id AND c.status = 'active')
                                 ${branch ? `AND (v.id = ? OR v.warehouse_id IN (${marks}))` : ''}`)
    .all(partyId, kind, ...(branch ? [keep, ...branch.warehouses] : [])) as { id: string; currency: CurrencyCode; rate_x100: number; total: number; returned: number }[];
  const map = new Map<string, Standing>(invoices.map((v) => [v.id, {
    currency: v.currency, rateX100: Number(v.rate_x100), total: Number(v.total), returned: Number(v.returned), received: 0, waiting: 0
  }]));
  const [b, bp] = entryInBranchSql('e', branch);
  const vouchers = db.prepare(`SELECT iv.invoice_id, e.status, e.currency, e.reversed_by_id, va.state,
                                 (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM entry_lines l WHERE l.entry_id = e.id AND l.party_id = ?) AS own,
                                 (SELECT COALESCE(SUM(l.base_credit - l.base_debit), 0) FROM entry_lines l WHERE l.entry_id = e.id AND l.party_id = ?) AS base
                               FROM invoice_vouchers iv JOIN invoices v ON v.id = iv.invoice_id JOIN entries e ON e.id = iv.entry_id
                                 LEFT JOIN voucher_approvals va ON va.entry_id = e.id
                               WHERE v.party_id = ? AND v.kind = ?${b}`).all(partyId, partyId, partyId, kind, ...bp) as
    { invoice_id: string; status: string; currency: CurrencyCode; reversed_by_id: string | null; state: string | null; own: number; base: number }[];
  for (const v of vouchers) {
    const of = map.get(v.invoice_id);
    if (!of) continue;
    const amount = inInvoiceCurrency(sign * Number(v.own), sign * Number(v.base), v.currency, of.currency, of.rateX100);
    if (amount <= 0) continue;
    if (v.status === 'approved') { if (!v.reversed_by_id) of.received += amount; }
    else if (v.state !== 'rejected') of.waiting += amount;
  }
  if (kind === 'sale') {
    // an online payment's receipt is a draft until a person approves it: until then it waits, like any other voucher
    // (its amount is in the invoice's currency: a payment in another one is refused when it is recorded)
    const online = db.prepare(`SELECT p.invoice_id, p.amount, e.status FROM invoice_payments p JOIN invoices v ON v.id = p.invoice_id JOIN entries e ON e.id = p.entry_id
                               WHERE v.party_id = ? AND p.kind = 'online' AND e.reversed_by_id IS NULL`).all(partyId) as { invoice_id: string; amount: number; status: string }[];
    for (const p of online) {
      const of = map.get(p.invoice_id);
      if (!of) continue;
      if (p.status === 'approved') of.received += Number(p.amount);
      else of.waiting += Number(p.amount);
    }
  }
  // an invoice carries no more than its own total: money typed above it is the party's advance, on the account only
  for (const of of map.values()) {
    const due = Math.max(0, of.total - of.returned);
    of.received = Math.min(of.received, due);
    of.waiting = Math.min(of.waiting, due - of.received);
  }
  return map;
}

/**
 * What was received for a posted credit invoice and what is still open on it (InvoiceSettlement); null for an invoice
 * that is not one. "Received" is only money known to be for this invoice (standings above).
 *
 * An invoice is never more open than its party owes in all: money received without naming the invoice (every receipt
 * made before 1.4, a receipt from the customers list or the vouchers screen, a cheque, a deposit taken on a job, an
 * instalment) is on the party's account only, so what is open is held to the party's position. For a dinar invoice
 * that is the position the customers list shows (IQD at the book rates). For a dollar invoice the party's dollars
 * count as dollars, whatever rate each was booked at, and only its dinar entries are read at the invoice's rate
 * (rounded down); a revaluation of dollar balances is a dinar entry that changes no dollar owed, and is left out.
 *
 * Which invoice such money paid, the books do not say. When the party owes less than its invoices leave unreceived
 * together, `unsure` is set and `open` is the most that can still be open on this one; the page words it so.
 *
 * `branch`: a reader limited to branches gets all of this from the entries and invoices they may read, as with the
 * party's balance and statement: what another branch received is not theirs to read, through no figure here.
 * A sale that an instalment contract schedules is followed on its contract, and has none.
 */
export function invoiceSettlement(
  db: Db, r: Pick<InvoiceRow, 'id' | 'kind' | 'status' | 'payment' | 'party_id' | 'currency' | 'rate_x100' | 'total'>, branch: ReaderBranch = null
): InvoiceSettlement | null {
  if (r.status !== 'posted' || r.payment !== 'credit' || !r.party_id || (r.kind !== 'sale' && r.kind !== 'purchase')) return null;
  const all = standings(db, r.party_id, r.kind, branch, r.id);
  const own = all.get(r.id);
  if (!own) return null;
  const sign = r.kind === 'sale' ? 1 : -1;
  const want = Math.max(0, own.total - own.returned) - own.received;

  // the party's account by the currency of its entries: each in its own, and the same in dinars at the book rates
  const [b, bp] = entryInBranchSql('e', branch);
  const sums = db.prepare(`SELECT e.currency, COALESCE(SUM(l.debit - l.credit), 0) AS own, COALESCE(SUM(l.base_debit - l.base_credit), 0) AS base
                          FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                          WHERE e.status = 'approved' AND l.party_id = ?${b} GROUP BY e.currency`).all(r.party_id, ...bp) as { currency: CurrencyCode; own: number; base: number }[];
  const of = (c: CurrencyCode) => sums.find((x) => x.currency === c);
  let position = sign * sums.reduce((s, x) => s + Number(x.base), 0);
  if (r.currency === 'USD') {
    const dinars = sign * (Number(of('IQD')?.base ?? 0) - revaluedBase(db, r.party_id, branch));
    position = r.rate_x100 > 0 ? sign * Number(of('USD')?.own ?? 0) + Math.floor((dinars * 10000) / r.rate_x100) : 0;
  }
  const open = Math.max(0, Math.min(want, position));

  // what the party's other invoices leave unreceived, read as the position is. A dollar invoice beside a dinar one is
  // read at its own rate, where rounding may differ from the books by a dinar or two: that much is let pass.
  let others = 0;
  let slack = 0;
  for (const [id, o] of all) {
    if (id === r.id) continue;
    const left = Math.max(0, o.total - o.returned) - o.received;
    if (left <= 0) continue;
    if (o.currency === r.currency) others += left;
    else if (r.currency === 'IQD') { others += toBase(left, o.currency, o.rateX100); slack += 2; }
    else others += r.rate_x100 > 0 ? Math.floor((left * 10000) / r.rate_x100) : 0;
  }
  const unsure = want > 0 && position + slack < want + others;
  return {
    currency: r.currency, total: own.total, returned: own.returned, received: own.received, waiting: own.waiting,
    open, toCollect: Math.max(0, open - own.waiting), owed: Math.max(0, position), unsure
  };
}

/** What revaluations of dollar balances (fx.ts: dinar journal entries) put on a party's account, in dinars. */
function revaluedBase(db: Db, partyId: string, branch: ReaderBranch): number {
  const ids = postedRevaluations(db);
  if (!ids.length) return 0;
  const [b, bp] = entryInBranchSql('e', branch);
  return Number((db.prepare(`SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS s FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                             WHERE e.status = 'approved' AND e.currency = 'IQD' AND l.party_id = ? AND e.id IN (${ids.map(() => '?').join(', ')})${b}`)
    .get(partyId, ...ids, ...bp) as { s: number }).s);
}

/**
 * A till's cash sale whose cash was typed: what the customer handed over and the change, as the receipt printed them
 * (nothing when the exact money was given: the receipt printed neither). The cash due is the sale's cash part (a sale
 * paid in parts), else its total less what loyalty points paid.
 */
function tenderOf(db: Db, r: Pick<InvoiceRow, 'id' | 'kind' | 'payment' | 'total'>): { tender?: { paid: number; change: number } } {
  if (r.kind !== 'sale' || r.payment !== 'cash') return {};
  const row = db.prepare('SELECT tendered FROM pos_sales WHERE invoice_id = ?').get(r.id) as { tendered: number | null } | undefined;
  if (!row || row.tendered === null || row.tendered === undefined) return {};
  const parts = db.prepare("SELECT method, amount FROM invoice_payments WHERE invoice_id = ? AND kind = 'pos'").all(r.id) as { method: string; amount: number }[];
  // (points pay dinar sales only, and their value is in dinars)
  const byPoints = Number((db.prepare("SELECT COALESCE(SUM(value), 0) AS s FROM loyalty_moves WHERE invoice_id = ? AND kind = 'redeem'").get(r.id) as { s: number }).s);
  const due = parts.length ? parts.filter((p) => p.method === 'cash').reduce((s, p) => s + Number(p.amount), 0) : Number(r.total) - byPoints;
  const paid = Number(row.tendered);
  return due > 0 && paid > due ? { tender: { paid, change: paid - due } } : {};
}

/** A till's sale made offline keeps the reference on its receipt (pos.ts): { offlineRef }, or nothing. */
function offlineRefOf(db: Db, invoiceId: string): { offlineRef?: string } {
  const row = db.prepare('SELECT reference FROM pos_offline_sales WHERE invoice_id = ?').get(invoiceId) as { reference: string } | undefined;
  return row ? { offlineRef: row.reference } : {};
}

export function invoicePayments(db: Db, invoiceId: string): InvoicePaymentView[] {
  return (db.prepare(`SELECT p.*, e.number AS entry_number, e.status AS entry_status FROM invoice_payments p LEFT JOIN entries e ON e.id = p.entry_id
                      WHERE p.invoice_id = ? ORDER BY p.created_at, p.id`).all(invoiceId) as {
    id: string; kind: 'pos' | 'online'; method: string; account_code: string; amount: number; currency: CurrencyCode; reference: string | null; source: string | null;
    entry_id: string | null; entry_number: string | null; entry_status: string | null; created_at: string;
  }[]).map((p) => ({
    id: p.id, kind: p.kind, method: p.method, accountCode: p.account_code, amount: Number(p.amount), currency: p.currency, reference: p.reference, source: p.source,
    entryId: p.entry_id, entryNumber: p.entry_number, entryStatus: p.entry_status, createdAt: p.created_at
  }));
}

export interface InvoiceFilters {
  kind?: InvoiceDocKind | undefined;
  status?: InvoiceStatus | undefined;
  partyId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  q?: string | undefined;
  limit?: number | undefined;
}

export function listInvoices(db: Db, f: InvoiceFilters = {}): InvoiceSummary[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.kind) { where.push('v.kind = ?'); params.push(f.kind); }
  if (f.status) { where.push('v.status = ?'); params.push(f.status); }
  if (f.partyId) { where.push('v.party_id = ?'); params.push(f.partyId); }
  if (f.from) { where.push('v.date >= ?'); params.push(f.from); }
  if (f.to) { where.push('v.date <= ?'); params.push(f.to); }
  const rows = db.prepare(`${SELECT_INVOICE} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.date DESC, v.created_at DESC`)
    .all(...params) as unknown as InvoiceRow[];
  const q = f.q ? normalizeForSearch(f.q) : '';
  // a till's offline sale is found by the temporary reference on its receipt too (1.2)
  const offline = q ? new Map((db.prepare('SELECT invoice_id, reference FROM pos_offline_sales').all() as { invoice_id: string; reference: string }[]).map((o) => [o.invoice_id, o.reference])) : null;
  return rows
    .filter((r) => !q || normalizeForSearch(`${r.number ?? ''} ${r.party_code ?? ''} ${r.party_name ?? ''} ${r.notes ?? ''} ${offline?.get(r.id) ?? ''}`).includes(q))
    .slice(0, f.limit ?? 500)
    .map(toSummary);
}

// ——— Validation ———

interface ItemInfo { id: string; track_stock: number; active: number }

function normalize(input: InvoiceInput): InvoiceInput {
  return { ...input, rateX100: input.currency === 'IQD' ? 100 : input.rateX100, partyId: input.partyId || undefined, cashAccountCode: input.payment === 'cash' ? input.cashAccountCode : undefined } as InvoiceInput;
}

/** What a request may send for a line: a base quantity, or a unit and the quantity typed in it (1.1). */
export type InvoiceLineRequest = Omit<InvoiceInput['lines'][number], 'qtyMilli' | 'unitFactorMilli'> & { qtyMilli?: number | undefined };
export type InvoiceRequest = Omit<InvoiceInput, 'lines'> & { lines: InvoiceLineRequest[] };

/** A request's lines with their base quantities, from each item's units now (a factor is never taken from a request). */
export function withUnits(db: Db, input: InvoiceRequest): InvoiceInput {
  if (!Array.isArray(input.lines)) return input as InvoiceInput;
  return { ...input, lines: resolveLines(db, input.lines) } as InvoiceInput;
}

function assertInvoice(db: Db, input: InvoiceInput): void {
  const errors: { code: string; line?: number; period?: string }[] = validateInvoice(input);
  if (input.partyId) {
    const party = db.prepare('SELECT type, active FROM parties WHERE id = ?').get(input.partyId) as { type: string; active: number } | undefined;
    const wanted = input.kind === 'sale' ? 'customer' : 'supplier';
    if (!party || party.type !== wanted || party.active !== 1) errors.push({ code: 'party_invalid' });
  }
  const warehouse = db.prepare('SELECT active FROM warehouses WHERE id = ?').get(input.warehouseId) as { active: number } | undefined;
  if (!warehouse || warehouse.active !== 1) errors.push({ code: 'warehouse_invalid' });
  if (input.payment === 'cash' && input.cashAccountCode?.startsWith('18')) {
    const account = loadAccounts(db).find((a) => a.code === input.cashAccountCode);
    if (!account || !account.postable) errors.push({ code: 'cash_account_invalid' });
  }
  if (Array.isArray(input.lines)) {
    const find = db.prepare('SELECT id, track_stock, active FROM items WHERE id = ?');
    input.lines.forEach((l, i) => {
      const item = find.get(l.itemId) as ItemInfo | undefined;
      if (!item || item.active !== 1) errors.push({ code: 'item_invalid', line: i + 1 });
      else if (input.kind === 'purchase' && item.track_stock !== 1) errors.push({ code: 'item_not_stock', line: i + 1 });
      else errors.push(...lineBatchErrors(db, l.itemId, l, i + 1));
    });
    if (!errors.some((e) => e.code.startsWith('line_') || e.code === 'discount_invalid') && invoiceTotals(input.lines, input.discount).total <= 0) {
      errors.push({ code: 'total_invalid' });
    }
  }
  if (!errors.some((e) => e.code === 'date_invalid') && isPeriodLocked(db, input.date)) errors.push({ code: 'period_locked', period: input.date.slice(0, 7) });
  if (errors.length) throw invalid(errors);
}

function writeDraft(db: Db, id: string, input: InvoiceInput): void {
  const totals = invoiceTotals(input.lines, input.discount);
  db.prepare(`UPDATE invoices SET date = ?, party_id = ?, warehouse_id = ?, currency = ?, rate_x100 = ?, payment = ?, cash_account = ?, discount = ?,
              subtotal = ?, total = ?, notes = ?, updated_at = ? WHERE id = ?`)
    .run(input.date, input.partyId ?? null, input.warehouseId, input.currency, input.rateX100, input.payment, input.cashAccountCode ?? null,
      input.discount, totals.subtotal, totals.total, input.notes?.trim() || null, new Date().toISOString(), id);
  db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(id);
  const insert = db.prepare(`INSERT INTO invoice_lines (invoice_id, line_no, item_id, description, qty_milli, unit_price, amount, unit, unit_factor_milli, unit_qty_milli,
                                                        batch_no, expiry, batch_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  input.lines.forEach((l, i) => insert.run(id, i + 1, l.itemId, l.description?.trim() || null, l.qtyMilli, l.unitPrice, totals.lineAmounts[i] ?? 0,
    l.unit ?? null, l.unit ? l.unitFactorMilli ?? null : null, l.unit ? l.unitQtyMilli ?? null : null,
    // a purchase line brings a batch in (number, expiry); a sale line may be pinned to one
    ...(input.kind === 'purchase' ? batchColumns({ batchNo: l.batchNo, expiry: l.expiry }) : batchColumns({ batchId: l.batchId }))));
}

export function createInvoice(db: Db, raw: InvoiceInput | InvoiceRequest, user: string): InvoiceView {
  const input = normalize(withUnits(db, raw as InvoiceRequest));
  assertInvoice(db, input);
  const id = randomUUID();
  transaction(db, () => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO invoices (id, kind, status, date, warehouse_id, currency, rate_x100, payment, discount, subtotal, total, created_by, created_at, updated_at)
                VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`)
      .run(id, input.kind, input.date, input.warehouseId, input.currency, input.rateX100, input.payment, user, now, now);
    writeDraft(db, id, input);
    audit(db, user, 'create', 'invoice', id, { kind: input.kind });
  });
  return getInvoice(db, id);
}

function requireAction(db: Db, row: InvoiceRow, action: InvoiceAction): void {
  if (action === 'cancel' && row.status === 'posted' && !isReturn(row.kind) && hasPostedReturns(db, row.id)) throw conflict('has_returns');
  if (!actionsFor(db, row, action === 'return').includes(action)) throw conflict('action_not_allowed', { status: row.status, action });
}

export function updateInvoice(db: Db, id: string, raw: InvoiceInput | InvoiceRequest, user: string): InvoiceView {
  const row = loadRow(db, id);
  requireAction(db, row, 'edit');
  if (isReturn(row.kind)) throw conflict('action_not_allowed', { status: row.status, action: 'edit' });
  const input = normalize(withUnits(db, { ...(raw as InvoiceRequest), kind: row.kind as InvoiceKind }));
  assertInvoice(db, input);
  transaction(db, () => {
    writeDraft(db, id, input);
    audit(db, user, 'update', 'invoice', id);
  });
  return getInvoice(db, id);
}

export function deleteInvoice(db: Db, id: string, user: string): void {
  const row = loadRow(db, id);
  requireAction(db, row, 'delete');
  transaction(db, () => {
    // a draft made from a quotation: the quotation goes back to accepted, ready to be invoiced again
    db.prepare("UPDATE quotes SET invoice_id = NULL, status = 'accepted' WHERE invoice_id = ?").run(id);
    // a draft receipt of a purchase order: the order is free to be received again
    db.prepare('DELETE FROM purchase_order_receipts WHERE invoice_id = ?').run(id);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
    audit(db, user, 'delete', 'invoice', id, { kind: row.kind });
  });
}

function storedInput(view: InvoiceView): InvoiceInput {
  return {
    kind: view.kind as InvoiceKind, date: view.date, warehouseId: view.warehouseId, currency: view.currency, rateX100: view.rateX100, payment: view.payment,
    discount: view.discount, notes: view.notes,
    ...(view.partyId ? { partyId: view.partyId } : {}),
    ...(view.cashAccountCode ? { cashAccountCode: view.cashAccountCode } : {}),
    // the factor kept with the line, never the item's factor now: a later change of the factor leaves the line as it was
    lines: view.lines.map((l) => ({
      itemId: l.itemId, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, description: l.description,
      ...(l.lineUnit ? { unit: l.lineUnit, unitFactorMilli: l.unitFactorMilli ?? undefined, unitQtyMilli: l.unitQtyMilli ?? undefined } : {}),
      ...(l.batchNo ? { batchNo: l.batchNo } : {}), ...(l.expiry ? { expiry: l.expiry } : {}), ...(l.batchId ? { batchId: l.batchId } : {})
    }))
  };
}

/** IQD → invoice currency, for cost lines that must still balance in the entry currency. */
export function fromBase(amountIqd: number, currency: CurrencyCode, rateX100: number): number {
  if (currency === 'IQD') return amountIqd;
  return Math.max(1, roundHalfUp((amountIqd * 10000) / rateX100));
}

/**
 * Posts a draft invoice: numbers it (INV / PI), writes its journal entry and moves the stock, all in one transaction.
 * Sale:     Dr safe or customer / Cr sales (42);  Dr cost of sales (35) / Cr warehouse stock at average cost.
 * Purchase: Dr warehouse stock / Cr supplier or safe; the discount lowers the cost of each line.
 * `settledNow` (internal callers only, never from a request): the part of a credit sale's total, in the invoice's
 * currency, that the caller collects in the same transaction (a cash sale whose deposit put it on credit). Only that
 * part is left out of the customer's credit limit check; nothing else changes.
 * `allowExpired`: the user confirmed selling stock past its expiry date (only under the 'warn' policy; written to the
 * audit log). Batch items take their batches earliest expiry first, or the batch a line is pinned to.
 */
/**
 * What a sale's customer has paid online for it (website orders): the payments whose receipt voucher is still in the
 * books. A rejected one (its draft voucher deleted) or a reversed one no longer counts.
 */
export function onlinePaidAmount(db: Db, invoiceId: string): number {
  return Number((db.prepare(`SELECT COALESCE(SUM(p.amount), 0) AS s FROM invoice_payments p JOIN entries e ON e.id = p.entry_id
                              WHERE p.invoice_id = ? AND p.kind = 'online' AND e.reversed_by_id IS NULL`).get(invoiceId) as { s: number }).s);
}

export function postInvoice(
  db: Db, id: string, user: string, opts: { settledNow?: number; allowExpired?: boolean; split?: readonly SalePart[]; loyaltyPoints?: number | undefined } = {}
): InvoiceView {
  const view = getInvoice(db, id);
  requireAction(db, loadRow(db, id), 'post');
  if (opts.loyaltyPoints !== undefined && view.kind !== 'sale') throw invalid([{ code: 'loyalty_points_invalid' }]);
  // money already taken online for this order is on the customer's account: posted as cash too, it would be taken twice
  if (view.kind === 'sale' && (view.payment !== 'credit' || opts.split?.length) && onlinePaidAmount(db, id) > 0) throw conflict('invoice_has_online_payments');
  const input = storedInput(view);
  assertInvoice(db, input);
  const accounts = getPostingAccounts(db);
  const warehouseAccount = (db.prepare('SELECT account_code FROM warehouses WHERE id = ?').get(view.warehouseId) as { account_code: string }).account_code;
  const party = view.partyId ? getParty(db, view.partyId) : null;
  const { total } = invoiceTotals(input.lines, input.discount);
  const baseTotal = toBase(total, view.currency, view.rateX100);
  const counterAccount = view.payment === 'cash' ? view.cashAccountCode! : party!.accountCode;
  const counterParty = view.payment === 'credit' && party ? { partyId: party.id } : {};
  // 1.2 (Pro): loyalty points pay part of a sale: their value is a part of its own, debited to the loyalty account,
  // and the rest is paid as the invoice says (or as the till's parts say)
  const redeemed = view.kind === 'sale' && opts.loyaltyPoints ? planRedemption(db, { partyId: view.partyId, points: opts.loyaltyPoints, total, currency: view.currency, date: view.date }) : null;
  let split: readonly SalePart[] | undefined = opts.split;
  if (redeemed) {
    const rest = total - redeemed.value;
    const paid = split?.length ? split : rest > 0 ? [{ accountCode: counterAccount, amount: rest, ...counterParty }] : [];
    if (paid.reduce((s, p) => s + p.amount, 0) !== rest) throw invalid([{ code: 'payments_total_mismatch', total: rest } as { code: string }]);
    split = [...paid, { accountCode: redeemed.accountCode, amount: redeemed.value }];
  }

  const lineCosts: (number | null)[] = [];
  const moves: { itemId: string; qtyMilli: number; value: number }[] = [];
  const lines: LineInput[] = [];
  // batch items: which batches each line takes (sales) or brings in (purchases, made in the transaction)
  const batchMoves: BatchMove[] = [];
  const inbound: { lineNo: number; itemId: string; qtyMilli: number; batchNo: string | null; expiry: string | null }[] = [];
  let usedExpired = false;

  if (view.kind === 'sale') {
    const settled = Number.isSafeInteger(opts.settledNow) ? Math.min(Math.max(opts.settledNow!, 0), total) : 0;
    const onCredit = baseTotal - (settled ? toBase(settled, view.currency, view.rateX100) : 0) - (redeemed?.value ?? 0);
    if (party && view.payment === 'credit' && party.creditLimit !== null && party.balance + onCredit > party.creditLimit) {
      throw conflict('credit_limit_exceeded', { balance: party.balance, limit: party.creditLimit, total: baseTotal });
    }
    // a split sale (POS): only the part put on the customer's account counts against their credit limit
    if (split?.length) {
      if (split.reduce((s, p) => s + p.amount, 0) !== total) throw invalid([{ code: 'payments_total_mismatch' }]);
      const onAccount = toBase(split.filter((p) => p.partyId).reduce((s, p) => s + p.amount, 0), view.currency, view.rateX100);
      if (onAccount > 0) {
        if (!party || split.some((p) => p.partyId && p.partyId !== party.id)) throw invalid([{ code: 'party_required' }]);
        if (party.creditLimit !== null && party.balance + onAccount > party.creditLimit) {
          throw conflict('credit_limit_exceeded', { balance: party.balance, limit: party.creditLimit, total: onAccount });
        }
      }
    }
    const stock = new Map<string, { qtyMilli: number; value: number }>();
    const errors: { code: string; line: number; available: number }[] = [];
    view.lines.forEach((l, i) => {
      if (!l.trackStock) { lineCosts.push(null); return; }
      const s = stock.get(l.itemId) ?? stockOf(db, l.itemId, view.warehouseId);
      if (s.qtyMilli < l.qtyMilli) errors.push({ code: 'stock_insufficient', line: i + 1, available: Math.max(0, s.qtyMilli) });
      const cost = costOut(s.qtyMilli, s.value, l.qtyMilli);
      stock.set(l.itemId, { qtyMilli: s.qtyMilli - l.qtyMilli, value: s.value - cost });
      lineCosts.push(cost);
      moves.push({ itemId: l.itemId, qtyMilli: -l.qtyMilli, value: -cost });
    });
    if (errors.length) throw invalid(errors);
    const taken = new Map<string, number>();
    const batchErrors: BatchError[] = [];
    view.lines.forEach((l, i) => {
      if (!l.trackStock || !batchTracking(db, l.itemId).batches) return;
      const r = allocateOut(db, { itemId: l.itemId, warehouseId: view.warehouseId, qtyMilli: l.qtyMilli, date: view.date, line: i + 1, purpose: 'sale', allowExpired: opts.allowExpired, pinned: l.batchId }, taken);
      if ('code' in r) { batchErrors.push(r); return; }
      addTaken(taken, r.picks);
      if (r.usedExpired) usedExpired = true;
      for (const p of r.picks) batchMoves.push({ batchId: p.batchId, itemId: l.itemId, warehouseId: view.warehouseId, qtyMilli: -p.qtyMilli, lineNo: i + 1 });
    });
    if (batchErrors.length) throw invalid(batchErrors);
    const totalCost = lineCosts.reduce<number>((s, c) => s + (c ?? 0), 0);
    if (split?.length) {
      // one debit line per part: the safe for cash, a card or wallet account, or the customer for what goes on account
      for (const p of split) lines.push({ accountCode: p.accountCode, debit: p.amount, credit: 0, ...(p.partyId ? { partyId: p.partyId } : {}) });
    } else lines.push({ accountCode: counterAccount, debit: total, credit: 0, ...counterParty });
    lines.push({ accountCode: accounts.sales, debit: 0, credit: total });
    if (totalCost > 0) {
      const cost = fromBase(totalCost, view.currency, view.rateX100);
      lines.push({ accountCode: accounts.costOfSales, debit: cost, credit: 0, baseDebit: totalCost, baseCredit: 0 });
      lines.push({ accountCode: warehouseAccount, debit: 0, credit: cost, baseDebit: 0, baseCredit: totalCost });
    }
  } else {
    const amounts = view.lines.map((l) => l.amount);
    const discounts = allocateDiscount(amounts, input.discount);
    const values = toBaseBalanced(amounts.map((a, i) => a - (discounts[i] ?? 0)), view.currency, view.rateX100);
    view.lines.forEach((l, i) => {
      const value = values[i] ?? 0;
      lineCosts.push(value);
      moves.push({ itemId: l.itemId, qtyMilli: l.qtyMilli, value });
      const tracking = batchTracking(db, l.itemId);
      if (tracking.batches) {
        if (tracking.expiry && !l.expiry) throw invalid([{ code: 'expiry_required', line: i + 1 }]);
        inbound.push({ lineNo: i + 1, itemId: l.itemId, qtyMilli: l.qtyMilli, batchNo: l.batchNo, expiry: l.expiry });
      }
    });
    lines.push({ accountCode: warehouseAccount, debit: total, credit: 0, baseDebit: baseTotal, baseCredit: 0 });
    lines.push({ accountCode: counterAccount, debit: 0, credit: total, baseDebit: 0, baseCredit: baseTotal, ...counterParty });
  }

  transaction(db, () => {
    const number = nextNumber(db, view.kind, view.date);
    const entry: EntryInput = {
      type: view.kind, date: view.date, currency: view.currency, rateX100: view.rateX100, lines,
      description: [party?.name, view.notes].filter(Boolean).join(' — ') || number,
      ...(party ? { party: party.name } : {})
    };
    assertValid(db, entry);
    const entryId = insertEntry(db, entry, user, view.payment === 'cash' ? view.cashAccountCode : null);
    const now = new Date().toISOString();
    db.prepare(`UPDATE entries SET status = 'approved', number = ?, checked_by = ?, checked_at = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
      .run(number, user, now, user, now, now, entryId);
    const setCost = db.prepare('UPDATE invoice_lines SET cost = ? WHERE invoice_id = ? AND line_no = ?');
    lineCosts.forEach((c, i) => setCost.run(c, id, i + 1));
    for (const m of moves) addStockMove(db, { ...m, warehouseId: view.warehouseId, date: view.date, sourceType: view.kind, sourceId: id });
    for (const l of inbound) {
      const b = inboundBatch(db, l.itemId, l, l.lineNo, view.date);
      if (b) batchMoves.push({ batchId: b.batchId, itemId: l.itemId, warehouseId: view.warehouseId, qtyMilli: l.qtyMilli, lineNo: l.lineNo });
    }
    writeBatchMoves(db, batchMoves, view.date, view.kind, id);
    db.prepare(`UPDATE invoices SET status = 'posted', number = ?, entry_id = ?, posted_by = ?, posted_at = ?, updated_at = ? WHERE id = ?`)
      .run(number, entryId, user, now, now, id);
    audit(db, user, 'post', 'invoice', id, { number, entryId });
    if (view.kind === 'sale') {
      // the points used, and those earned on what was paid now (not on account, not with points)
      const paidNow = split?.length
        ? split.filter((p) => !p.partyId && p.accountCode !== redeemed?.accountCode).reduce((s, p) => s + p.amount, 0)
        : view.payment === 'cash' ? total : 0;
      recordSaleLoyalty(db, { invoiceId: id, partyId: view.partyId, date: view.date, warehouseId: view.warehouseId, paidIqd: toBase(paidNow, view.currency, view.rateX100), redeemed }, user);
    }
    // selling stock past its date (the user confirmed it, under the 'warn' policy) is kept on record
    if (usedExpired) audit(db, user, 'sell_expired', 'invoice', id, { number, batches: batchMoves.map((m) => m.batchId) });
  });
  return getInvoice(db, id);
}

/**
 * Cancels a posted invoice: its entry is reversed (قيد عكسي) and its stock moves are undone. Both stay on record.
 * A purchase whose goods were already sold cannot be cancelled — the stock it brought in is gone.
 */
/**
 * Separate duties (Settings): voiding a till sale, or paying one back in cash, takes the drawer's money out of what the
 * shift expects; so, like posting a stock adjustment or reversing an entry, it is done by an approver, and never by
 * whoever rang the sale up. (Without separate duties the sales permission does it, as with any other sale.)
 */
export function assertMayUndoPosSale(db: Db, invoiceId: string, postedBy: string | null, actor?: Pick<Actor, 'name' | 'permissions'>): void {
  if (!actor || readSetting(db, 'separate_duties') !== '1') return;
  if (!db.prepare('SELECT 1 FROM pos_sales WHERE invoice_id = ?').get(invoiceId)) return;
  if (!actor.permissions.includes('entries.approve')) throw new AppError(403, 'forbidden', { need: 'entries.approve' });
  if (postedBy && postedBy === actor.name) throw conflict('same_person');
}

export function cancelInvoice(db: Db, id: string, user: string, date?: string, actor?: Pick<Actor, 'name' | 'permissions'>): InvoiceView {
  const view = getInvoice(db, id);
  if (view.installmentContract) throw conflict('invoice_has_contract', { contract: view.installmentContract.number });
  requireAction(db, loadRow(db, id), 'cancel');
  if (view.kind === 'sale') assertMayUndoPosSale(db, id, view.postedBy, actor);
  // (no date: today, or the document's own date when that is later: a reversal is never dated before what it reverses)
  const cancelDate = date ?? (todayIso() < view.date ? view.date : todayIso());
  if (isPeriodLocked(db, cancelDate)) throw invalid([{ code: 'period_locked', period: cancelDate.slice(0, 7) }]);
  // cancelling a sale or a purchase return puts the goods back; a purchase or a sales return takes them out again
  const back = view.kind === 'sale' || view.kind === 'purchase_return';
  const moves = view.lines.filter((l) => l.trackStock && l.cost !== null).map((l) => ({
    itemId: l.itemId, lineNo: l.lineNo,
    qtyMilli: back ? l.qtyMilli : -l.qtyMilli,
    value: back ? l.cost! : -l.cost!
  }));
  if (!back) {
    const remaining = new Map<string, { qtyMilli: number; value: number }>();
    const errors: { code: string; line: number; available?: number }[] = [];
    for (const m of moves) {
      const s = remaining.get(m.itemId) ?? stockOf(db, m.itemId, view.warehouseId);
      const after = { qtyMilli: s.qtyMilli + m.qtyMilli, value: s.value + m.value };
      if (after.qtyMilli < 0) errors.push({ code: 'stock_insufficient', line: m.lineNo, available: Math.max(0, s.qtyMilli) });
      else if (after.value < 0 || (after.qtyMilli === 0 && after.value !== 0)) errors.push({ code: 'stock_already_used', line: m.lineNo });
      remaining.set(m.itemId, after);
    }
    if (errors.length) throw invalid(errors);
    // the batches it brought in must still hold what comes out again
    assertReversible(db, view.kind, id);
  }
  transaction(db, () => {
    const reversalId = view.entryId ? reverseEntryInternal(db, view.entryId, user, cancelDate) : null;
    for (const m of moves) addStockMove(db, { itemId: m.itemId, warehouseId: view.warehouseId, date: cancelDate, qtyMilli: m.qtyMilli, value: m.value, sourceType: `${view.kind}_cancel`, sourceId: id });
    cancelBatchMoves(db, view.kind, id, cancelDate, moves.map((m) => ({ itemId: m.itemId, warehouseId: view.warehouseId })));
    const now = new Date().toISOString();
    db.prepare(`UPDATE invoices SET status = 'cancelled', cancel_entry_id = ?, cancelled_by = ?, cancelled_at = ?, updated_at = ? WHERE id = ?`)
      .run(reversalId, user, now, now, id);
    // its loyalty points movements are undone too (the reversal gives the points' value back in the books)
    cancelLoyalty(db, id, cancelDate, user);
    // phones this sale took are back in stock, with no customer and no warranty. A job's bill (solar) keeps its
    // equipment linked: the job shows it waiting for the next bill, and reads it as unsold meanwhile
    if (view.kind === 'sale' && !db.prepare('SELECT 1 FROM jobs WHERE invoice_id = ?').get(id)) {
      db.prepare(`UPDATE serials SET status = 'in_stock', sale_invoice_id = NULL, party_id = NULL, sold_at = NULL, warranty_until = NULL, updated_at = ?
                  WHERE sale_invoice_id = ? AND status = 'sold'`).run(now, id);
    }
    audit(db, user, 'cancel', 'invoice', id, { reversalId });
  });
  return getInvoice(db, id);
}
