import { randomUUID } from 'node:crypto';
import {
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
  type LineInput,
  type Names,
  type PaymentMode,
  type UnitCode
} from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { assertValid, insertEntry, nextNumber, reverseEntryInternal } from './journal.ts';
import { getParty } from './parties.ts';
import { addStockMove, stockOf } from './items.ts';
import { getPostingAccounts, isPeriodLocked } from './settings.ts';
import { resolveLines } from './item-units.ts';
import {
  addTaken, allocateOut, assertReversible, batchColumns, batchMovesOf, batchTracking, inboundBatch, lineBatchErrors, reverseBatchMoves, writeBatchMoves,
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

export interface InvoiceView extends InvoiceSummary {
  partyPhone: string | null;
  partyAddress: string | null;
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
      OR (v.payment = 'credit' AND l.party_id = v.party_id))) AS settlement_base,
  (SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = v.id AND ip.kind = 'online') AS online_paid
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

export function getInvoice(db: Db, id: string): InvoiceView {
  const r = loadRow(db, id);
  const party = r.party_id ? db.prepare('SELECT phone, address FROM parties WHERE id = ?').get(r.party_id) as { phone: string | null; address: string | null } : null;
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
    partyPhone: party?.phone ?? null, partyAddress: party?.address ?? null,
    warehouseCode: w.code, warehouseName: { ar: w.name_ar, en: w.name_en, ku: w.name_ku },
    cashAccountName: cash ? { ar: cash.name_ar, en: cash.name_en, ku: cash.name_ku } : null,
    entryId: r.entry_id, entryNumber: numberOf(r.entry_id), cancelEntryId: r.cancel_entry_id, cancelEntryNumber: numberOf(r.cancel_entry_id),
    postedBy: r.posted_by, postedAt: r.posted_at, cancelledBy: r.cancelled_by, cancelledAt: r.cancelled_at,
    lines: lineViews, actions: actionsFor(db, r, lineViews.some((l) => l.returnedQtyMilli < l.qtyMilli)),
    returnOfNumber: r.return_of ? (db.prepare('SELECT number FROM invoices WHERE id = ?').get(r.return_of) as { number: string | null }).number : null,
    returns,
    installmentContract: activeContractOf(db, id),
    payments: invoicePayments(db, id)
  };
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
  return rows
    .filter((r) => !q || normalizeForSearch(`${r.number ?? ''} ${r.party_code ?? ''} ${r.party_name ?? ''} ${r.notes ?? ''}`).includes(q))
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
export function postInvoice(
  db: Db, id: string, user: string, opts: { settledNow?: number; allowExpired?: boolean; split?: readonly SalePart[] } = {}
): InvoiceView {
  const view = getInvoice(db, id);
  requireAction(db, loadRow(db, id), 'post');
  const input = storedInput(view);
  assertInvoice(db, input);
  const accounts = getPostingAccounts(db);
  const warehouseAccount = (db.prepare('SELECT account_code FROM warehouses WHERE id = ?').get(view.warehouseId) as { account_code: string }).account_code;
  const party = view.partyId ? getParty(db, view.partyId) : null;
  const { total } = invoiceTotals(input.lines, input.discount);
  const baseTotal = toBase(total, view.currency, view.rateX100);
  const counterAccount = view.payment === 'cash' ? view.cashAccountCode! : party!.accountCode;
  const counterParty = view.payment === 'credit' && party ? { partyId: party.id } : {};

  const lineCosts: (number | null)[] = [];
  const moves: { itemId: string; qtyMilli: number; value: number }[] = [];
  const lines: LineInput[] = [];
  // batch items: which batches each line takes (sales) or brings in (purchases, made in the transaction)
  const batchMoves: BatchMove[] = [];
  const inbound: { lineNo: number; itemId: string; qtyMilli: number; batchNo: string | null; expiry: string | null }[] = [];
  let usedExpired = false;

  if (view.kind === 'sale') {
    const settled = Number.isSafeInteger(opts.settledNow) ? Math.min(Math.max(opts.settledNow!, 0), total) : 0;
    const onCredit = baseTotal - (settled ? toBase(settled, view.currency, view.rateX100) : 0);
    if (party && view.payment === 'credit' && party.creditLimit !== null && party.balance + onCredit > party.creditLimit) {
      throw conflict('credit_limit_exceeded', { balance: party.balance, limit: party.creditLimit, total: baseTotal });
    }
    // a split sale (POS): only the part put on the customer's account counts against their credit limit
    if (opts.split?.length) {
      if (opts.split.reduce((s, p) => s + p.amount, 0) !== total) throw invalid([{ code: 'payments_total_mismatch' }]);
      const onAccount = toBase(opts.split.filter((p) => p.partyId).reduce((s, p) => s + p.amount, 0), view.currency, view.rateX100);
      if (onAccount > 0) {
        if (!party || opts.split.some((p) => p.partyId && p.partyId !== party.id)) throw invalid([{ code: 'party_required' }]);
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
    if (opts.split?.length) {
      // one debit line per part: the safe for cash, a card or wallet account, or the customer for what goes on account
      for (const p of opts.split) lines.push({ accountCode: p.accountCode, debit: p.amount, credit: 0, ...(p.partyId ? { partyId: p.partyId } : {}) });
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
    // selling stock past its date (the user confirmed it, under the 'warn' policy) is kept on record
    if (usedExpired) audit(db, user, 'sell_expired', 'invoice', id, { number, batches: batchMoves.map((m) => m.batchId) });
  });
  return getInvoice(db, id);
}

/**
 * Cancels a posted invoice: its entry is reversed (قيد عكسي) and its stock moves are undone. Both stay on record.
 * A purchase whose goods were already sold cannot be cancelled — the stock it brought in is gone.
 */
export function cancelInvoice(db: Db, id: string, user: string, date?: string): InvoiceView {
  const view = getInvoice(db, id);
  if (view.installmentContract) throw conflict('invoice_has_contract', { contract: view.installmentContract.number });
  requireAction(db, loadRow(db, id), 'cancel');
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
    if (batchMovesOf(db, view.kind, id).length) reverseBatchMoves(db, view.kind, id, cancelDate);
    const now = new Date().toISOString();
    db.prepare(`UPDATE invoices SET status = 'cancelled', cancel_entry_id = ?, cancelled_by = ?, cancelled_at = ?, updated_at = ? WHERE id = ?`)
      .run(reversalId, user, now, now, id);
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
