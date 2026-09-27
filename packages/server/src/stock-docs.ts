import { randomUUID } from 'node:crypto';
import { costOut, isIsoDate, lineAmount, todayIso, type EntryInput, type Names, type UnitCode } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { assertValid, insertEntry, nextNumber, reverseEntryInternal } from './journal.ts';
import { addStockMove, stockOf } from './items.ts';
import { isPeriodLocked } from './settings.ts';

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
  /** Opening stock: the account credited for the goods' value (usually capital, 21). */
  counterAccountCode?: string;
  notes?: string;
  /** unitCost: opening stock only, IQD per unit. */
  lines: { itemId: string; qtyMilli: number; unitCost?: number }[];
}

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
  const lines = (db.prepare(`SELECT l.*, i.code, i.name_ar, i.name_en, i.name_ku, i.unit FROM stock_doc_lines l JOIN items i ON i.id = l.item_id
                             WHERE l.doc_id = ? ORDER BY l.line_no`).all(id) as {
    line_no: number; item_id: string; qty_milli: number; unit_cost: number | null; value: number | null; code: string; name_ar: string; name_en: string; name_ku: string; unit: UnitCode;
  }[]).map((l) => ({
    lineNo: l.line_no, itemId: l.item_id, itemCode: l.code, itemName: { ar: l.name_ar, en: l.name_en, ku: l.name_ku }, unit: l.unit,
    qtyMilli: l.qty_milli, unitCost: l.unit_cost, value: l.value
  }));
  const counter = r.counter_account ? db.prepare('SELECT name_ar, name_en, name_ku FROM accounts WHERE code = ?').get(r.counter_account) as { name_ar: string; name_en: string; name_ku: string } | undefined : undefined;
  const numberOf = (entryId: string | null) => entryId ? (db.prepare('SELECT number FROM entries WHERE id = ?').get(entryId) as { number: string | null }).number : null;
  return {
    ...toSummary(r),
    counterAccountCode: r.counter_account, counterAccountName: counter ? { ar: counter.name_ar, en: counter.name_en, ku: counter.name_ku } : null,
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

function assertDoc(db: Db, input: StockDocInput): void {
  const errors: { code: string; line?: number; period?: string }[] = [];
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
    // any postable account except stock itself; normally capital (21)
    if (!account || !account.postable || account.code.startsWith('13')) errors.push({ code: 'account_invalid' });
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
    });
  }
  if (errors.length) throw invalid(errors);
}

function writeDraft(db: Db, id: string, input: StockDocInput): void {
  const total = input.kind === 'opening' ? input.lines.reduce((s, l) => s + lineAmount(l.qtyMilli, l.unitCost ?? 0), 0) : 0;
  db.prepare('UPDATE stock_docs SET date = ?, warehouse_id = ?, to_warehouse_id = ?, counter_account = ?, notes = ?, total_value = ?, updated_at = ? WHERE id = ?')
    .run(input.date, input.warehouseId, input.kind === 'transfer' ? input.toWarehouseId! : null, input.kind === 'opening' ? input.counterAccountCode! : null,
      input.notes?.trim() || null, total, new Date().toISOString(), id);
  db.prepare('DELETE FROM stock_doc_lines WHERE doc_id = ?').run(id);
  const insert = db.prepare('INSERT INTO stock_doc_lines (doc_id, line_no, item_id, qty_milli, unit_cost) VALUES (?, ?, ?, ?, ?)');
  input.lines.forEach((l, i) => insert.run(id, i + 1, l.itemId, l.qtyMilli, input.kind === 'opening' ? l.unitCost ?? 0 : null));
}

export function createStockDoc(db: Db, input: StockDocInput, user: string): StockDocView {
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

function requireAction(row: DocRow, action: StockDocAction): void {
  if (!actionsFor(row.status).includes(action)) throw conflict('action_not_allowed', { status: row.status, action });
}

export function updateStockDoc(db: Db, id: string, raw: StockDocInput, user: string): StockDocView {
  const row = loadRow(db, id);
  requireAction(row, 'edit');
  const input = { ...raw, kind: row.kind };
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
    lines: v.lines.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli, ...(l.unitCost !== null ? { unitCost: l.unitCost } : {}) }))
  };
}

/**
 * Posts a stock document: numbers it (OS / ST), moves the stock and writes its entry in IQD.
 * Opening stock: Dr warehouse / Cr the chosen account (capital).  Transfer: Dr receiving warehouse / Cr sending warehouse, at average cost.
 */
export function postStockDoc(db: Db, id: string, user: string): StockDocView {
  const view = getStockDoc(db, id);
  requireAction(loadRow(db, id), 'post');
  assertDoc(db, storedInput(view));
  const moves: { itemId: string; warehouseId: string; qtyMilli: number; value: number }[] = [];
  const values: number[] = [];

  if (view.kind === 'opening') {
    for (const l of view.lines) {
      const value = lineAmount(l.qtyMilli, l.unitCost ?? 0);
      values.push(value);
      moves.push({ itemId: l.itemId, warehouseId: view.warehouseId, qtyMilli: l.qtyMilli, value });
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
  const cancelDate = date ?? todayIso();
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
  transaction(db, () => {
    const reversalId = view.entryId ? reverseEntryInternal(db, view.entryId, user, cancelDate) : null;
    for (const m of moves) addStockMove(db, { itemId: m.itemId, warehouseId: m.warehouseId, date: cancelDate, qtyMilli: m.qtyMilli, value: m.value, sourceType: `${view.kind}_cancel`, sourceId: id });
    const now = new Date().toISOString();
    db.prepare(`UPDATE stock_docs SET status = 'cancelled', cancel_entry_id = ?, cancelled_by = ?, cancelled_at = ?, updated_at = ? WHERE id = ?`)
      .run(reversalId, user, now, now, id);
    audit(db, user, 'cancel', 'stock_doc', id, { reversalId });
  });
  return getStockDoc(db, id);
}
