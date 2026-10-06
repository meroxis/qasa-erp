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

export type InvoiceAction = 'edit' | 'delete' | 'post' | 'cancel' | 'return';

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
}

interface InvoiceRow {
  id: string; kind: InvoiceDocKind; return_of: string | null; status: InvoiceStatus; number: string | null; date: string; party_id: string | null;
  warehouse_id: string; currency: CurrencyCode; rate_x100: number; payment: PaymentMode; cash_account: string | null;
  discount: number; subtotal: number; total: number; notes: string | null; entry_id: string | null; cancel_entry_id: string | null;
  created_by: string; created_at: string; posted_by: string | null; posted_at: string | null; cancelled_by: string | null; cancelled_at: string | null;
  party_code: string | null; party_name: string | null;
  settlement_base: number | null;
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
    returnOf: r.return_of, createdBy: r.created_by, createdAt: r.created_at
  };
}

const SELECT_INVOICE = `SELECT v.*, p.code AS party_code, p.name AS party_name,
  (SELECT SUM(CASE WHEN v.kind IN ('purchase', 'sale_return') THEN l.base_credit - l.base_debit ELSE l.base_debit - l.base_credit END)
   FROM entry_lines l WHERE l.entry_id = v.entry_id AND
     ((v.payment = 'cash' AND l.account_code = v.cash_account) OR (v.payment = 'credit' AND l.party_id = v.party_id))) AS settlement_base
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
  const lines = (db.prepare(`SELECT l.*, i.code, i.name_ar, i.name_en, i.name_ku, i.unit, i.track_stock FROM invoice_lines l JOIN items i ON i.id = l.item_id
                             WHERE l.invoice_id = ? ORDER BY l.line_no`).all(id) as {
    line_no: number; item_id: string; description: string | null; qty_milli: number; unit_price: number; amount: number; cost: number | null; source_line: number | null;
    code: string; name_ar: string; name_en: string; name_ku: string; unit: UnitCode; track_stock: number;
  }[]);
  const returned = r.status === 'posted' && !isReturn(r.kind) ? returnedByLine(db, id) : new Map<number, { qtyMilli: number; amount: number }>();
  const lineViews: InvoiceLineView[] = lines.map((l) => ({
    lineNo: l.line_no, itemId: l.item_id, itemCode: l.code, itemName: { ar: l.name_ar, en: l.name_en, ku: l.name_ku }, unit: l.unit,
    trackStock: l.track_stock === 1, description: l.description ?? '', qtyMilli: l.qty_milli, unitPrice: l.unit_price, amount: l.amount, cost: l.cost,
    sourceLine: l.source_line, returnedQtyMilli: returned.get(l.line_no)?.qtyMilli ?? 0, returnedAmount: returned.get(l.line_no)?.amount ?? 0
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
    installmentContract: activeContractOf(db, id)
  };
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
  const insert = db.prepare('INSERT INTO invoice_lines (invoice_id, line_no, item_id, description, qty_milli, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?)');
  input.lines.forEach((l, i) => insert.run(id, i + 1, l.itemId, l.description?.trim() || null, l.qtyMilli, l.unitPrice, totals.lineAmounts[i] ?? 0));
}

export function createInvoice(db: Db, raw: InvoiceInput, user: string): InvoiceView {
  const input = normalize(raw);
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

export function updateInvoice(db: Db, id: string, raw: InvoiceInput, user: string): InvoiceView {
  const row = loadRow(db, id);
  requireAction(db, row, 'edit');
  if (isReturn(row.kind)) throw conflict('action_not_allowed', { status: row.status, action: 'edit' });
  const input = normalize({ ...raw, kind: row.kind as InvoiceKind });
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
    lines: view.lines.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, description: l.description }))
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
 */
export function postInvoice(db: Db, id: string, user: string): InvoiceView {
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

  if (view.kind === 'sale') {
    if (party && view.payment === 'credit' && party.creditLimit !== null && party.balance + baseTotal > party.creditLimit) {
      throw conflict('credit_limit_exceeded', { balance: party.balance, limit: party.creditLimit, total: baseTotal });
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
    const totalCost = lineCosts.reduce<number>((s, c) => s + (c ?? 0), 0);
    lines.push({ accountCode: counterAccount, debit: total, credit: 0, ...counterParty });
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
    db.prepare(`UPDATE invoices SET status = 'posted', number = ?, entry_id = ?, posted_by = ?, posted_at = ?, updated_at = ? WHERE id = ?`)
      .run(number, entryId, user, now, now, id);
    audit(db, user, 'post', 'invoice', id, { number, entryId });
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
  const cancelDate = date ?? todayIso();
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
  }
  transaction(db, () => {
    const reversalId = view.entryId ? reverseEntryInternal(db, view.entryId, user, cancelDate) : null;
    for (const m of moves) addStockMove(db, { itemId: m.itemId, warehouseId: view.warehouseId, date: cancelDate, qtyMilli: m.qtyMilli, value: m.value, sourceType: `${view.kind}_cancel`, sourceId: id });
    const now = new Date().toISOString();
    db.prepare(`UPDATE invoices SET status = 'cancelled', cancel_entry_id = ?, cancelled_by = ?, cancelled_at = ?, updated_at = ? WHERE id = ?`)
      .run(reversalId, user, now, now, id);
    audit(db, user, 'cancel', 'invoice', id, { reversalId });
  });
  return getInvoice(db, id);
}
