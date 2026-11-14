import { randomUUID } from 'node:crypto';
import { accountNames, costOut, isIsoDate, lineAmount, priceQty, todayIso, type EntryInput, type Names, type UnitCode } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import type { Actor } from './auth.ts';
import { loadAccounts } from './accounts.ts';
import { assertValid, insertEntry, nextNumber, reverseEntryInternal } from './journal.ts';
import { addStockMove, stockOf } from './items.ts';
import { isPeriodLocked, readSetting } from './settings.ts';
import { resolveLines } from './item-units.ts';
import {
  addTaken, allocateOut, assertReversible, batchColumns, batchTracking, cancelBatchMoves, inboundBatch, lineBatchErrors, writeBatchMoves,
  type BatchError, type BatchMove
} from './batches.ts';

/** opening = بضاعة أول المدة (goods on hand when the company starts with Qasa ERP) · transfer = مناقلة بين المخازن */
export type StockDocKind = 'opening' | 'transfer';
export type StockDocStatus = 'draft' | 'posted' | 'cancelled';
export type StockDocAction = 'edit' | 'delete' | 'post' | 'cancel';

export interface StockDocInput {
  kind: StockDocKind;
  date: string;
  /** Opening stock: the warehouse the goods are in. Transfer: the warehouse they leave. */
  warehouseId: string;
  /** Transfer: the warehouse they go to. */
  toWarehouseId?: string;
  /** Opening stock: the account credited for the goods' value: capital (21) or reserves (22), nothing else. */
  counterAccountCode?: string;
  notes?: string;
  /**
   * unitCost: opening stock only, IQD per unit (per the line's own unit when it has one). unit + unitQtyMilli (1.1): the
   * quantity typed in one of the item's units; qtyMilli is then worked out from the item's factor.
   */
  lines: StockDocLineInput[];
}

export interface StockDocLineInput {
  itemId: string;
  qtyMilli: number;
  unitCost?: number | undefined;
  unit?: UnitCode | undefined;
  unitQtyMilli?: number | undefined;
  unitFactorMilli?: number | undefined;
  /** 1.1 batches: opening stock brings a batch in (number, expiry); a transfer line may be pinned to a batch */
  batchNo?: string | null | undefined;
  expiry?: string | null | undefined;
  batchId?: string | null | undefined;
}

/** What a request may send: lines with a base quantity, or a unit and the quantity typed in it. */
export type StockDocRequest = Omit<StockDocInput, 'lines'> & { lines: (Omit<StockDocLineInput, 'qtyMilli' | 'unitFactorMilli'> & { qtyMilli?: number | undefined })[] };

export interface StockDocLineView {
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: Names;
  unit: UnitCode;
  qtyMilli: number;
  unitCost: number | null;
  /** IQD value that moved; set when posted. */
  value: number | null;
  /** 1.1: the unit the line was typed in (null: the base unit), its factor then and the quantity as typed */
  lineUnit: UnitCode | null;
  unitFactorMilli: number | null;
  unitQtyMilli: number | null;
  batchNo: string | null;
  expiry: string | null;
  batchId: string | null;
}

export interface StockDocSummary {
  id: string;
  kind: StockDocKind;
  status: StockDocStatus;
  number: string | null;
  date: string;
  warehouseId: string;
  warehouseName: Names;
  toWarehouseId: string | null;
  toWarehouseName: Names | null;
  totalValue: number;
  notes: string;
  createdBy: string;
}

export interface StockDocView extends StockDocSummary {
  counterAccountCode: string | null;
  counterAccountName: Names | null;
  entryId: string | null;
  entryNumber: string | null;
  cancelEntryId: string | null;
  cancelEntryNumber: string | null;
  postedBy: string | null;
  postedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  lines: StockDocLineView[];
  actions: StockDocAction[];
}

interface DocRow {
  id: string; kind: StockDocKind; status: StockDocStatus; number: string | null; date: string; warehouse_id: string; to_warehouse_id: string | null;
  counter_account: string | null; notes: string | null; total_value: number; entry_id: string | null; cancel_entry_id: string | null;
  created_by: string; posted_by: string | null; posted_at: string | null; cancelled_by: string | null; cancelled_at: string | null;
  w_ar: string; w_en: string; w_ku: string; t_ar: string | null; t_en: string | null; t_ku: string | null;
}

const SELECT_DOC = `SELECT d.*, w.name_ar AS w_ar, w.name_en AS w_en, w.name_ku AS w_ku, t.name_ar AS t_ar, t.name_en AS t_en, t.name_ku AS t_ku
                    FROM stock_docs d JOIN warehouses w ON w.id = d.warehouse_id LEFT JOIN warehouses t ON t.id = d.to_warehouse_id`;

function actionsFor(status: StockDocStatus): StockDocAction[] {
  if (status === 'draft') return ['edit', 'delete', 'post'];
  if (status === 'posted') return ['cancel'];
  return [];
}

function loadRow(db: Db, id: string): DocRow {
  const row = db.prepare(`${SELECT_DOC} WHERE d.id = ?`).get(id) as unknown as DocRow | undefined;
  if (!row) throw notFound('stock_doc');
  return row;
}

function toSummary(r: DocRow): StockDocSummary {
  return {
    id: r.id, kind: r.kind, status: r.status, number: r.number, date: r.date,
    warehouseId: r.warehouse_id, warehouseName: { ar: r.w_ar, en: r.w_en, ku: r.w_ku },
    toWarehouseId: r.to_warehouse_id, toWarehouseName: r.to_warehouse_id ? { ar: r.t_ar ?? '', en: r.t_en ?? '', ku: r.t_ku ?? '' } : null,
    totalValue: r.total_value, notes: r.notes ?? '', createdBy: r.created_by
  };
}

export function getStockDoc(db: Db, id: string): StockDocView {
  const r = loadRow(db, id);
  const lines = (db.prepare(`SELECT l.line_no, l.item_id, l.qty_milli, l.unit_cost, l.value, l.unit AS line_unit, l.unit_factor_milli, l.unit_qty_milli, l.batch_no, l.expiry, l.batch_id, i.code, i.name_ar, i.name_en, i.name_ku, i.unit FROM stock_doc_lines l JOIN items i ON i.id = l.item_id
                             WHERE l.doc_id = ? ORDER BY l.line_no`).all(id) as {
    line_no: number; item_id: string; qty_milli: number; unit_cost: number | null; value: number | null; code: string; name_ar: string; name_en: string; name_ku: string; unit: UnitCode;
    line_unit: UnitCode | null; unit_factor_milli: number | null; unit_qty_milli: number | null;
    batch_no: string | null; expiry: string | null; batch_id: string | null;
  }[]).map((l) => ({
    lineNo: l.line_no, itemId: l.item_id, itemCode: l.code, itemName: { ar: l.name_ar, en: l.name_en, ku: l.name_ku }, unit: l.unit,
    qtyMilli: l.qty_milli, unitCost: l.unit_cost, value: l.value,
    lineUnit: l.line_unit ?? null, unitFactorMilli: l.unit_factor_milli === null ? null : Number(l.unit_factor_milli),
    unitQtyMilli: l.unit_qty_milli === null ? null : Number(l.unit_qty_milli),
    batchNo: l.batch_no ?? null, expiry: l.expiry ?? null, batchId: l.batch_id ?? null
  }));
  const counter = r.counter_account ? db.prepare('SELECT name_ar, name_en, name_ku FROM accounts WHERE code = ?').get(r.counter_account) as { name_ar: string; name_en: string; name_ku: string } | undefined : undefined;
  const numberOf = (entryId: string | null) => entryId ? (db.prepare('SELECT number FROM entries WHERE id = ?').get(entryId) as { number: string | null }).number : null;
  return {
    ...toSummary(r),
    counterAccountCode: r.counter_account, counterAccountName: counter && r.counter_account ? accountNames(r.counter_account, { ar: counter.name_ar, en: counter.name_en, ku: counter.name_ku }) : null,
    entryId: r.entry_id, entryNumber: numberOf(r.entry_id), cancelEntryId: r.cancel_entry_id, cancelEntryNumber: numberOf(r.cancel_entry_id),
    postedBy: r.posted_by, postedAt: r.posted_at, cancelledBy: r.cancelled_by, cancelledAt: r.cancelled_at,
    lines, actions: actionsFor(r.status)
  };
}

export function listStockDocs(db: Db, f: { kind?: StockDocKind | undefined; status?: StockDocStatus | undefined } = {}): StockDocSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (f.kind) { where.push('d.kind = ?'); params.push(f.kind); }
  if (f.status) { where.push('d.status = ?'); params.push(f.status); }
  return (db.prepare(`${SELECT_DOC} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.date DESC, d.created_at DESC LIMIT 500`).all(...params) as unknown as DocRow[])
    .map(toSummary);
}

/** The accounts an opening stock document may credit: capital (21) and reserves (22), with their sub-accounts. */
export const isOpeningCounterAccount = (code: string): boolean => code.startsWith('21') || code.startsWith('22');

function assertDoc(db: Db, input: StockDocInput): void {
  const errors: { code: string; line?: number; period?: string; field?: string }[] = [];
  if (!isIsoDate(input.date)) errors.push({ code: 'date_invalid' });
  else if (isPeriodLocked(db, input.date)) errors.push({ code: 'period_locked', period: input.date.slice(0, 7) });
  const active = db.prepare('SELECT active FROM warehouses WHERE id = ?');
  const isActive = (id?: string) => !!id && (active.get(id) as { active: number } | undefined)?.active === 1;
  if (!isActive(input.warehouseId)) errors.push({ code: 'warehouse_invalid' });
  if (input.kind === 'transfer') {
    if (!isActive(input.toWarehouseId)) errors.push({ code: 'to_warehouse_invalid' });
    else if (input.toWarehouseId === input.warehouseId) errors.push({ code: 'same_warehouse' });
  } else {
    const account = input.counterAccountCode ? loadAccounts(db).find((a) => a.code === input.counterAccountCode) : undefined;
    // goods a company starts with are its owners' money: capital (21) or reserves (22, the accumulated result among
    // them). A stock user posts this entry with no checker, so it never reaches a safe, a bank, a customer, a
    // supplier, revenue or an expense (that would hide missing cash, or move value out of another branch's safe)
    if (!account || !account.postable || !isOpeningCounterAccount(account.code)) errors.push({ code: 'account_invalid', field: 'counterAccountCode' });
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) errors.push({ code: 'lines_required' });
  else {
    const find = db.prepare('SELECT track_stock, active FROM items WHERE id = ?');
    input.lines.forEach((l, i) => {
      const item = find.get(l.itemId) as { track_stock: number; active: number } | undefined;
      if (!item || item.active !== 1) errors.push({ code: 'item_invalid', line: i + 1 });
      else if (item.track_stock !== 1) errors.push({ code: 'item_not_stock', line: i + 1 });
      if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0) errors.push({ code: 'line_qty_invalid', line: i + 1 });
      if (input.kind === 'opening' && (l.unitCost === undefined || !Number.isSafeInteger(l.unitCost) || l.unitCost < 0)) errors.push({ code: 'line_price_invalid', line: i + 1 });
      if (item) errors.push(...lineBatchErrors(db, l.itemId, l, i + 1));
    });
  }
  if (errors.length) throw invalid(errors);
}

function writeDraft(db: Db, id: string, input: StockDocInput): void {
  const total = input.kind === 'opening' ? input.lines.reduce((s, l) => s + lineAmount(priceQty(l), l.unitCost ?? 0), 0) : 0;
  db.prepare('UPDATE stock_docs SET date = ?, warehouse_id = ?, to_warehouse_id = ?, counter_account = ?, notes = ?, total_value = ?, updated_at = ? WHERE id = ?')
    .run(input.date, input.warehouseId, input.kind === 'transfer' ? input.toWarehouseId! : null, input.kind === 'opening' ? input.counterAccountCode! : null,
      input.notes?.trim() || null, total, new Date().toISOString(), id);
  db.prepare('DELETE FROM stock_doc_lines WHERE doc_id = ?').run(id);
  const insert = db.prepare(`INSERT INTO stock_doc_lines (doc_id, line_no, item_id, qty_milli, unit_cost, unit, unit_factor_milli, unit_qty_milli, batch_no, expiry, batch_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  input.lines.forEach((l, i) => insert.run(id, i + 1, l.itemId, l.qtyMilli, input.kind === 'opening' ? l.unitCost ?? 0 : null,
    l.unit ?? null, l.unit ? l.unitFactorMilli ?? null : null, l.unit ? l.unitQtyMilli ?? null : null,
    ...(input.kind === 'opening' ? batchColumns({ batchNo: l.batchNo, expiry: l.expiry }) : batchColumns({ batchId: l.batchId }))));
}

const withUnits = (db: Db, input: StockDocRequest): StockDocInput =>
  (Array.isArray(input.lines) ? { ...input, lines: resolveLines(db, input.lines) } : input) as StockDocInput;

export function createStockDoc(db: Db, raw: StockDocInput | StockDocRequest, user: string): StockDocView {
  const input = withUnits(db, raw as StockDocRequest);
  assertDoc(db, input);
  const id = randomUUID();
  transaction(db, () => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO stock_docs (id, kind, status, date, warehouse_id, to_warehouse_id, created_by, created_at, updated_at)
                VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)`)
      .run(id, input.kind, input.date, input.warehouseId, input.kind === 'transfer' ? input.toWarehouseId! : null, user, now, now);
    writeDraft(db, id, input);
    audit(db, user, 'create', 'stock_doc', id, { kind: input.kind });
  });
  return getStockDoc(db, id);
}

/**
 * Separate duties (Settings): opening stock writes an approved entry with values someone typed, so like a stock
 * adjustment it is posted by an approver other than its maker (the document keeps its maker's name only).
 */
function assertMayPostOpening(db: Db, row: DocRow, actor: Pick<Actor, 'name' | 'permissions'>): void {
  if (readSetting(db, 'separate_duties') !== '1') return;
  if (!actor.permissions.includes('entries.approve')) throw new AppError(403, 'forbidden', { need: 'entries.approve' });
  if (row.created_by === actor.name) throw conflict('same_person');
}

function requireAction(row: DocRow, action: StockDocAction): void {
  if (!actionsFor(row.status).includes(action)) throw conflict('action_not_allowed', { status: row.status, action });
}

export function updateStockDoc(db: Db, id: string, raw: StockDocInput | StockDocRequest, user: string): StockDocView {
  const row = loadRow(db, id);
  requireAction(row, 'edit');
  const input = withUnits(db, { ...(raw as StockDocRequest), kind: row.kind });
  assertDoc(db, input);
  transaction(db, () => {
    writeDraft(db, id, input);
    audit(db, user, 'update', 'stock_doc', id);
  });
  return getStockDoc(db, id);
}

export function deleteStockDoc(db: Db, id: string, user: string): void {
  const row = loadRow(db, id);
  requireAction(row, 'delete');
  transaction(db, () => {
    db.prepare('DELETE FROM stock_docs WHERE id = ?').run(id);
    audit(db, user, 'delete', 'stock_doc', id, { kind: row.kind });
  });
}

function warehouseAccount(db: Db, warehouseId: string): string {
  return (db.prepare('SELECT account_code FROM warehouses WHERE id = ?').get(warehouseId) as { account_code: string }).account_code;
}

function storedInput(v: StockDocView): StockDocInput {
  return {
    kind: v.kind, date: v.date, warehouseId: v.warehouseId, notes: v.notes,
    ...(v.toWarehouseId ? { toWarehouseId: v.toWarehouseId } : {}),
    ...(v.counterAccountCode ? { counterAccountCode: v.counterAccountCode } : {}),
    lines: v.lines.map((l) => ({
      itemId: l.itemId, qtyMilli: l.qtyMilli, ...(l.unitCost !== null ? { unitCost: l.unitCost } : {}),
      ...(l.lineUnit ? { unit: l.lineUnit, unitFactorMilli: l.unitFactorMilli ?? undefined, unitQtyMilli: l.unitQtyMilli ?? undefined } : {}),
      ...(l.batchNo ? { batchNo: l.batchNo } : {}), ...(l.expiry ? { expiry: l.expiry } : {}), ...(l.batchId ? { batchId: l.batchId } : {})
    }))
  };
}

/**
 * Posts a stock document: numbers it (OS / ST), moves the stock and writes its entry in IQD.
 * Opening stock: Dr warehouse / Cr the chosen account (capital).  Transfer: Dr receiving warehouse / Cr sending warehouse, at average cost.
 */
export function postStockDoc(db: Db, id: string, user: string, actor?: Pick<Actor, 'name' | 'permissions'>): StockDocView {
  const view = getStockDoc(db, id);
  const row = loadRow(db, id);
  requireAction(row, 'post');
  if (row.kind === 'opening' && actor) assertMayPostOpening(db, row, actor);
  assertDoc(db, storedInput(view));
  const moves: { itemId: string; warehouseId: string; qtyMilli: number; value: number }[] = [];
  const values: number[] = [];
  const batchMoves: BatchMove[] = [];
  const inbound: { lineNo: number; itemId: string; qtyMilli: number; batchNo: string | null; expiry: string | null }[] = [];

  if (view.kind === 'opening') {
    for (const l of view.lines) {
      const value = lineAmount(l.lineUnit && l.unitQtyMilli !== null ? l.unitQtyMilli : l.qtyMilli, l.unitCost ?? 0);
      values.push(value);
      moves.push({ itemId: l.itemId, warehouseId: view.warehouseId, qtyMilli: l.qtyMilli, value });
      const tracking = batchTracking(db, l.itemId);
      if (tracking.batches) {
        if (tracking.expiry && !l.expiry) throw invalid([{ code: 'expiry_required', line: l.lineNo }]);
        inbound.push({ lineNo: l.lineNo, itemId: l.itemId, qtyMilli: l.qtyMilli, batchNo: l.batchNo, expiry: l.expiry });
      }
    }
  } else {
    const stock = new Map<string, { qtyMilli: number; value: number }>();
    const errors: { code: string; line: number; available: number }[] = [];
    view.lines.forEach((l, i) => {
      const s = stock.get(l.itemId) ?? stockOf(db, l.itemId, view.warehouseId);
      if (s.qtyMilli < l.qtyMilli) errors.push({ code: 'stock_insufficient', line: i + 1, available: Math.max(0, s.qtyMilli) });
      const value = costOut(s.qtyMilli, s.value, l.qtyMilli);
      stock.set(l.itemId, { qtyMilli: s.qtyMilli - l.qtyMilli, value: s.value - value });
      values.push(value);
      moves.push({ itemId: l.itemId, warehouseId: view.warehouseId, qtyMilli: -l.qtyMilli, value: -value });
      moves.push({ itemId: l.itemId, warehouseId: view.toWarehouseId!, qtyMilli: l.qtyMilli, value });
    });
    if (errors.length) throw invalid(errors);
    // batch items move with their batches: the same batch leaves one warehouse and arrives in the other
    const taken = new Map<string, number>();
    const batchErrors: BatchError[] = [];
    for (const l of view.lines) {
      if (!batchTracking(db, l.itemId).batches) continue;
      const r = allocateOut(db, { itemId: l.itemId, warehouseId: view.warehouseId, qtyMilli: l.qtyMilli, date: view.date, line: l.lineNo, purpose: 'other', pinned: l.batchId }, taken);
      if ('code' in r) { batchErrors.push(r); continue; }
      addTaken(taken, r.picks);
      for (const p of r.picks) {
        batchMoves.push({ batchId: p.batchId, itemId: l.itemId, warehouseId: view.warehouseId, qtyMilli: -p.qtyMilli, lineNo: l.lineNo });
        batchMoves.push({ batchId: p.batchId, itemId: l.itemId, warehouseId: view.toWarehouseId!, qtyMilli: p.qtyMilli, lineNo: l.lineNo });
      }
    }
    if (batchErrors.length) throw invalid(batchErrors);
  }
  const total = values.reduce((s, v) => s + v, 0);
  const entryType = view.kind === 'opening' ? 'opening_stock' : 'transfer';

  transaction(db, () => {
    const number = nextNumber(db, entryType, view.date);
    const now = new Date().toISOString();
    let entryId: string | null = null;
    if (total > 0) {
      const debitAccount = view.kind === 'opening' ? warehouseAccount(db, view.warehouseId) : warehouseAccount(db, view.toWarehouseId!);
      const creditAccount = view.kind === 'opening' ? view.counterAccountCode! : warehouseAccount(db, view.warehouseId);
      const entry: EntryInput = {
        type: entryType, date: view.date, currency: 'IQD', rateX100: 100,
        description: view.notes || number,
        lines: [{ accountCode: debitAccount, debit: total, credit: 0 }, { accountCode: creditAccount, debit: 0, credit: total }]
      };
      assertValid(db, entry);
      entryId = insertEntry(db, entry, user, null);
      db.prepare(`UPDATE entries SET status = 'approved', number = ?, checked_by = ?, checked_at = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
        .run(number, user, now, user, now, now, entryId);
    }
    const setValue = db.prepare('UPDATE stock_doc_lines SET value = ? WHERE doc_id = ? AND line_no = ?');
    values.forEach((v, i) => setValue.run(v, id, i + 1));
    for (const m of moves) addStockMove(db, { ...m, date: view.date, sourceType: view.kind, sourceId: id });
    for (const l of inbound) {
      const b = inboundBatch(db, l.itemId, l, l.lineNo, view.date);
      if (b) batchMoves.push({ batchId: b.batchId, itemId: l.itemId, warehouseId: view.warehouseId, qtyMilli: l.qtyMilli, lineNo: l.lineNo });
    }
    writeBatchMoves(db, batchMoves, view.date, view.kind, id);
    db.prepare(`UPDATE stock_docs SET status = 'posted', number = ?, total_value = ?, entry_id = ?, posted_by = ?, posted_at = ?, updated_at = ? WHERE id = ?`)
      .run(number, total, entryId, user, now, now, id);
    audit(db, user, 'post', 'stock_doc', id, { number, entryId });
  });
  return getStockDoc(db, id);
}

/** Cancels a posted document: its entry is reversed and its stock moves are undone, as long as the goods are still there. */
export function cancelStockDoc(db: Db, id: string, user: string, date?: string): StockDocView {
  const view = getStockDoc(db, id);
  requireAction(loadRow(db, id), 'cancel');
  // (no date: today, or the document's own date when that is later: a reversal is never dated before what it reverses)
  const cancelDate = date ?? (todayIso() < view.date ? view.date : todayIso());
  if (!isIsoDate(cancelDate)) throw invalid([{ code: 'date_invalid' }]);
  // goods leave the warehouse they went into (opening: that warehouse; transfer: the receiving one) and a transfer puts them back
  const into = view.kind === 'opening' ? view.warehouseId : view.toWarehouseId!;
  const moves: { itemId: string; warehouseId: string; qtyMilli: number; value: number; lineNo: number }[] = [];
  for (const l of view.lines) {
    moves.push({ itemId: l.itemId, warehouseId: into, qtyMilli: -l.qtyMilli, value: -(l.value ?? 0), lineNo: l.lineNo });
    if (view.kind === 'transfer') moves.push({ itemId: l.itemId, warehouseId: view.warehouseId, qtyMilli: l.qtyMilli, value: l.value ?? 0, lineNo: l.lineNo });
  }
  const remaining = new Map<string, { qtyMilli: number; value: number }>();
  const errors: { code: string; line: number; available?: number }[] = [];
  for (const m of moves) {
    if (m.qtyMilli > 0) continue;
    const key = `${m.itemId}@${m.warehouseId}`;
    const s = remaining.get(key) ?? stockOf(db, m.itemId, m.warehouseId);
    const after = { qtyMilli: s.qtyMilli + m.qtyMilli, value: s.value + m.value };
    if (after.qtyMilli < 0) errors.push({ code: 'stock_insufficient', line: m.lineNo, available: Math.max(0, s.qtyMilli) });
    else if (after.value < 0 || (after.qtyMilli === 0 && after.value !== 0)) errors.push({ code: 'stock_already_used', line: m.lineNo });
    remaining.set(key, after);
  }
  if (errors.length) throw invalid(errors);
  if (isPeriodLocked(db, cancelDate)) throw invalid([{ code: 'period_locked', period: cancelDate.slice(0, 7) }]);
  assertReversible(db, view.kind, id);
  transaction(db, () => {
    const reversalId = view.entryId ? reverseEntryInternal(db, view.entryId, user, cancelDate) : null;
    for (const m of moves) addStockMove(db, { itemId: m.itemId, warehouseId: m.warehouseId, date: cancelDate, qtyMilli: m.qtyMilli, value: m.value, sourceType: `${view.kind}_cancel`, sourceId: id });
    cancelBatchMoves(db, view.kind, id, cancelDate, moves);
    const now = new Date().toISOString();
    db.prepare(`UPDATE stock_docs SET status = 'cancelled', cancel_entry_id = ?, cancelled_by = ?, cancelled_at = ?, updated_at = ? WHERE id = ?`)
      .run(reversalId, user, now, now, id);
    audit(db, user, 'cancel', 'stock_doc', id, { reversalId });
  });
  return getStockDoc(db, id);
}
