import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  costOut, isIsoDate, lineAmount, MAX_BATCH_NO, toBase, todayIso, UNIT_CODES, type CurrencyCode, type EntryInput, type Names, type UnitCode
} from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { planStatus } from './license.ts';
import { isPeriodLocked, readSetting } from './settings.ts';
import { assertValid, createJournalEntry, deleteEntry, getEntry, insertEntry, nextNumber, reverseEntryInternal } from './journal.ts';
import { addStockMove, stockOf } from './items.ts';
import { resolveLines } from './item-units.ts';
import { preparerOf } from './quick-vouchers.ts';
import { seesBooks, type Actor } from './auth.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';
import { onceOnly } from './idempotency.ts';
import { featureAccount } from './feature-accounts.ts';
import {
  addTaken, allocateOut, assertReversible, batchColumns, batchTracking, cancelBatchMoves, inboundBatch, lineBatchErrors, writeBatchMoves,
  type BatchError, type BatchMove
} from './batches.ts';

/**
 * Goods on consignment (بضاعة أمانة, sale-or-return; Starter, Pro and Business): a supplier leaves goods in the shop
 * and is paid only for what sells. It is very common in Iraqi markets (bread, dairy, cosmetics, phone cards…).
 *
 * - An item is put on consignment with one supplier at an agreed cost per base unit, in dinars or dollars. While it
 *   is, all of its stock is that supplier's: it is never bought on a purchase invoice or brought in as opening stock.
 *   A new agreed cost is for the goods received from then on: what is already on hand stays owed at what it was
 *   received at, wherever it is moved (a transfer's leg that comes in carries what its leg that went out took).
 * - A consignment receipt brings the goods into a warehouse at the agreed cost: Dr the warehouse's stock account /
 *   Cr consignment goods held (268, under creditors: the goods are the supplier's, not ours; nothing is payable yet).
 *   A return to the supplier is the reverse, at the cost the goods are carried at. Both post at once, as stock
 *   documents and adjustments do (with "separate duties" on, by someone other than the preparer).
 * - Everything else is the shop's ordinary work: the till and sale invoices sell the item as any other, at its cost
 *   (the agreed cost), so profit is right on the day of the sale; customers' returns, cancels and write-offs work as
 *   usual. Each such stock move is recorded beside it (consignment_moves, by addStockMove) with its value in the
 *   agreed currency: those are "sold" (owed to the supplier). A write-off counts as sold too: the shop bears goods it
 *   lost or damaged, at their cost (the adjustment's loss account already carries it).
 * - A settlement takes what sold and was not settled yet (up to its date) and makes what the supplier is owed: a
 *   journal entry Dr 268 (the goods' value in the books) / Cr the supplier, that waits for checking and approval like
 *   any voucher (createJournalEntry): separation of duties is never bypassed. In dollars the difference between the
 *   goods' dinar value and the dollars owed at the settlement's rate goes to other expenses or other revenue. The
 *   supplier is then paid with an ordinary payment voucher.
 *
 * 268 so always holds the goods on hand at cost plus what sold and is not settled yet.
 */

export const CONSIGNMENT_HELD = '268';
const HELD_NAMES: Names = { ar: 'بضاعة الأمانة (للمجهزين)', en: 'Consignment goods held (suppliers’)', ku: 'کاڵای ئەمانەت (هی دابینکەران)' };

export type ConsignmentDocKind = 'receipt' | 'return';
export type ConsignmentDocStatus = 'draft' | 'posted' | 'cancelled';
export type ConsignmentDocAction = 'edit' | 'delete' | 'post' | 'cancel';
type MoveKind = 'received' | 'returned' | 'sold' | 'transfer';

export const consignmentAvailable = (db: Db): boolean => planStatus(db).features.includes('consignment');

function requirePlan(db: Db): void {
  if (!consignmentAvailable(db)) throw conflict('plan_limit', { limit: 'consignment' });
}

const nowIso = () => new Date().toISOString();

// ——— the account ———

/**
 * Consignment goods held (268 under 26, creditors). Made the first time it is needed, as a standard account, unless 26
 * itself already holds entries (then it can't take a sub-account; the accountant chooses one: setting consignment_account).
 */
export function consignmentAccount(db: Db, user: string): string {
  return featureAccount(db, 'consignment', user, HELD_NAMES);
}

/** The first postable account at or under `root` (other expenses 39, other revenue 49): exchange differences. */
function firstPostableUnder(db: Db, root: string): string {
  const a = loadAccounts(db).filter((x) => x.postable && x.code.startsWith(root)).sort((x, y) => x.code.localeCompare(y.code))[0];
  if (!a) throw conflict('cs_account_missing', { root });
  return a.code;
}

// ——— items on consignment ———

export interface ConsignmentItemView {
  itemId: string;
  itemCode: string;
  itemName: Names;
  unit: UnitCode;
  supplierId: string;
  supplierName: string;
  currency: CurrencyCode;
  unitCost: number;
  active: boolean;
  /** on hand in every warehouse (all of it the supplier's) */
  onHandMilli: number;
  /** on hand at cost in the books (IQD) */
  onHandValue: number;
}

interface ConsignmentItemRow { item_id: string; supplier_id: string; currency: CurrencyCode; unit_cost: number; active: number }

export function consignedItem(db: Db, itemId: string): ConsignmentItemRow | null {
  const row = db.prepare('SELECT item_id, supplier_id, currency, unit_cost, active FROM consignment_items WHERE item_id = ? AND active = 1').get(itemId) as unknown as ConsignmentItemRow | undefined;
  return row ? { ...row, unit_cost: Number(row.unit_cost), active: Number(row.active) } : null;
}

function onHand(db: Db, itemId: string): { qtyMilli: number; value: number } {
  const r = db.prepare('SELECT SUM(qty_milli) AS q, SUM(value) AS v FROM stock_moves WHERE item_id = ?').get(itemId) as { q: number | null; v: number | null };
  return { qtyMilli: Number(r.q ?? 0), value: Number(r.v ?? 0) };
}

const ITEM_SELECT = `SELECT c.item_id, c.supplier_id, c.currency, c.unit_cost, c.active, i.code, i.name_ar, i.name_en, i.name_ku, i.unit, p.name AS supplier_name
                     FROM consignment_items c JOIN items i ON i.id = c.item_id JOIN parties p ON p.id = c.supplier_id`;

function itemView(db: Db, r: Record<string, unknown>): ConsignmentItemView {
  const s = onHand(db, String(r.item_id));
  return {
    itemId: String(r.item_id), itemCode: String(r.code), itemName: { ar: String(r.name_ar), en: String(r.name_en), ku: String(r.name_ku) },
    unit: r.unit as UnitCode, supplierId: String(r.supplier_id), supplierName: String(r.supplier_name), currency: r.currency as CurrencyCode,
    unitCost: Number(r.unit_cost), active: Number(r.active) === 1, onHandMilli: s.qtyMilli, onHandValue: s.value
  };
}

export function listConsignmentItems(db: Db, f: { supplierId?: string | undefined; all?: boolean | undefined } = {}): ConsignmentItemView[] {
  const where: string[] = [];
  const params: string[] = [];
  if (!f.all) where.push('c.active = 1');
  if (f.supplierId) { where.push('c.supplier_id = ?'); params.push(f.supplierId); }
  const rows = db.prepare(`${ITEM_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY i.code`).all(...params);
  return rows.map((r) => itemView(db, r));
}

export function getConsignmentItem(db: Db, itemId: string): ConsignmentItemView | null {
  const r = db.prepare(`${ITEM_SELECT} WHERE c.item_id = ?`).get(itemId);
  return r ? itemView(db, r) : null;
}

function supplierRow(db: Db, id: string): { id: string; name: string; account_code: string; active: number } {
  const p = db.prepare("SELECT id, name, account_code, active FROM parties WHERE id = ? AND type = 'supplier'").get(id) as { id: string; name: string; account_code: string; active: number } | undefined;
  if (!p) throw invalid([{ code: 'supplier_invalid', field: 'supplierId' }]);
  return p;
}

/**
 * Puts an item on consignment with a supplier, or changes its agreed cost. A new supplier or currency only while none
 * of the item is on hand (stock is all the supplier's, or all ours: never both).
 */
export function setConsignmentItem(db: Db, itemId: string, input: { supplierId: string; currency: CurrencyCode; unitCost: number }, actor: Actor): ConsignmentItemView {
  requirePlan(db);
  const item = db.prepare('SELECT id, track_stock FROM items WHERE id = ?').get(itemId) as { id: string; track_stock: number } | undefined;
  if (!item) throw notFound('item');
  if (Number(item.track_stock) !== 1) throw invalid([{ code: 'cs_item_not_stocked', field: 'itemId' }]);
  const supplier = supplierRow(db, input.supplierId);
  if (Number(supplier.active) !== 1) throw invalid([{ code: 'supplier_invalid', field: 'supplierId' }]);
  if (!Number.isSafeInteger(input.unitCost) || input.unitCost < 0) throw invalid([{ code: 'line_price_invalid', field: 'unitCost' }]);
  const current = db.prepare('SELECT supplier_id, currency, active FROM consignment_items WHERE item_id = ?').get(itemId) as { supplier_id: string; currency: string; active: number } | undefined;
  const sameTerms = current && Number(current.active) === 1 && current.supplier_id === input.supplierId && current.currency === input.currency;
  if (!sameTerms && onHand(db, itemId).qtyMilli !== 0) throw conflict('cs_item_has_stock');
  transaction(db, () => {
    const now = nowIso();
    if (current) {
      db.prepare('UPDATE consignment_items SET supplier_id = ?, currency = ?, unit_cost = ?, active = 1, updated_at = ? WHERE item_id = ?')
        .run(input.supplierId, input.currency, input.unitCost, now, itemId);
    } else {
      db.prepare('INSERT INTO consignment_items (item_id, supplier_id, currency, unit_cost, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
        .run(itemId, input.supplierId, input.currency, input.unitCost, now, now);
    }
    audit(db, actor.name, current ? 'update' : 'create', 'consignment_item', itemId, { supplierId: input.supplierId, currency: input.currency, unitCost: input.unitCost });
  });
  return getConsignmentItem(db, itemId)!;
}

/** Takes an item off consignment (it becomes an ordinary item again): only with none of it on hand. */
export function endConsignmentItem(db: Db, itemId: string, actor: Actor): ConsignmentItemView {
  const row = consignedItem(db, itemId);
  if (!row) throw notFound('consignment_item');
  if (onHand(db, itemId).qtyMilli !== 0) throw conflict('cs_item_has_stock');
  db.prepare('UPDATE consignment_items SET active = 0, updated_at = ? WHERE item_id = ?').run(nowIso(), itemId);
  audit(db, actor.name, 'end', 'consignment_item', itemId);
  return getConsignmentItem(db, itemId)!;
}

// ——— the moves (kept beside every stock move of an item on consignment) ———

interface Ledger { qtyMilli: number; value: number; ccy: number }

function ledgerOf(db: Db, itemId: string, warehouseId: string): Ledger {
  const r = db.prepare('SELECT SUM(qty_milli) AS q, SUM(value) AS v, SUM(ccy_value) AS c FROM consignment_moves WHERE item_id = ? AND warehouse_id = ?')
    .get(itemId, warehouseId) as { q: number | null; v: number | null; c: number | null };
  return { qtyMilli: Number(r.q ?? 0), value: Number(r.v ?? 0), ccy: Number(r.c ?? 0) };
}

/** The agreed-currency value of a move of `value` (IQD) and `qtyMilli`, as the item stands in that warehouse. */
function ccyValueOf(db: Db, item: ConsignmentItemRow, warehouseId: string, qtyMilli: number, value: number): number {
  if (item.currency === 'IQD') return value;
  const l = ledgerOf(db, item.item_id, warehouseId);
  if (qtyMilli < 0) return -costOut(l.qtyMilli, l.ccy, -qtyMilli);
  if (l.value > 0 && l.ccy > 0) return Math.round((value * l.ccy) / l.value);
  return lineAmount(qtyMilli, item.unit_cost);
}

const MOVE_INSERT = `INSERT INTO consignment_moves (id, item_id, supplier_id, warehouse_id, date, kind, source_type, source_id, qty_milli, value, currency, ccy_value, settlement_id, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`;

function writeMove(db: Db, item: ConsignmentItemRow, m: { warehouseId: string; date: string; kind: MoveKind; sourceType: string; sourceId: string; qtyMilli: number; value: number; ccy: number }): void {
  db.prepare(MOVE_INSERT).run(randomUUID(), item.item_id, item.supplier_id, m.warehouseId, m.date, m.kind, m.sourceType, m.sourceId, m.qtyMilli, m.value, item.currency, m.ccy, nowIso());
}

type StockMove = { itemId: string; warehouseId: string; date: string; qtyMilli: number; value: number; sourceType: string; sourceId: string };

/**
 * Called by addStockMove before every stock move is written (in its transaction). For an item on consignment: a
 * purchase or opening stock is refused (the stock is the supplier's), and the move is recorded as the supplier sees
 * it. Consignment receipts and returns (consignment_*) are recorded by this module itself, with their agreed value.
 */
export function onStockMove(db: Db, move: StockMove): void {
  if (move.sourceType.startsWith('consignment_')) return;
  const item = consignedItem(db, move.itemId);
  if (!item) return;
  if (move.qtyMilli > 0 && (move.sourceType === 'purchase' || move.sourceType === 'opening')) throw conflict('item_on_consignment', { itemId: move.itemId });
  const kind: MoveKind = move.sourceType === 'transfer' || move.sourceType === 'transfer_cancel' ? 'transfer' : 'sold';
  // goods coming back from a sale (a customer's return, or the sale cancelled) are the supplier's whose goods were sold,
  // at what they were sold at, even if the item has another supplier or terms now (accounting review #10)
  if (move.qtyMilli > 0 && (move.sourceType === 'sale_return' || move.sourceType === 'sale_cancel')) {
    const saleId = move.sourceType === 'sale_cancel'
      ? move.sourceId
      : (db.prepare('SELECT return_of FROM invoices WHERE id = ?').get(move.sourceId) as { return_of: string | null } | undefined)?.return_of ?? null;
    const sold = saleId ? db.prepare(`SELECT supplier_id, currency, SUM(qty_milli) AS q, SUM(ccy_value) AS c FROM consignment_moves
                                       WHERE item_id = ? AND source_id = ? AND kind = 'sold' AND qty_milli < 0 GROUP BY supplier_id, currency`)
      .get(move.itemId, saleId) as { supplier_id: string; currency: CurrencyCode; q: number; c: number } | undefined : undefined;
    if (sold && Number(sold.q) < 0) {
      const ccy = Math.round((Number(sold.c) * move.qtyMilli) / Number(sold.q));
      db.prepare(MOVE_INSERT).run(randomUUID(), move.itemId, sold.supplier_id, move.warehouseId, move.date, 'sold', move.sourceType, move.sourceId, move.qtyMilli, move.value, sold.currency, ccy, nowIso());
      return;
    }
  }
  const base = { warehouseId: move.warehouseId, date: move.date, kind, sourceType: move.sourceType, sourceId: move.sourceId };
  const insert = (supplierId: string, currency: CurrencyCode, qtyMilli: number, value: number, ccy: number) =>
    db.prepare(MOVE_INSERT).run(randomUUID(), move.itemId, supplierId, base.warehouseId, base.date, base.kind, base.sourceType, base.sourceId, qtyMilli, value, currency, ccy, nowIso());

  // the leg of a transfer that comes in carries what its leg that went out took, supplier by supplier: the same goods
  // moved, so the dollars owed for them are the same in the other warehouse (never worked out again from dinars at
  // that warehouse's average, nor from the agreed cost of today) — review of the 2.0 books #4
  if (kind === 'transfer' && move.qtyMilli > 0) {
    const legs = db.prepare(`SELECT supplier_id, currency, SUM(CASE WHEN qty_milli < 0 THEN -qty_milli ELSE 0 END) AS out_q, SUM(CASE WHEN qty_milli < 0 THEN -ccy_value ELSE 0 END) AS out_c,
                                    SUM(CASE WHEN qty_milli > 0 THEN qty_milli ELSE 0 END) AS in_q, SUM(CASE WHEN qty_milli > 0 THEN ccy_value ELSE 0 END) AS in_c, MIN(created_at) AS first
                             FROM consignment_moves WHERE item_id = ? AND source_type = ? AND source_id = ? GROUP BY supplier_id, currency ORDER BY first, supplier_id`)
      .all(move.itemId, move.sourceType, move.sourceId) as { supplier_id: string; currency: CurrencyCode; out_q: number; out_c: number; in_q: number; in_c: number }[];
    const open = legs.map((l) => ({ supplierId: l.supplier_id, currency: l.currency, qty: Number(l.out_q) - Number(l.in_q), ccy: Number(l.out_c) - Number(l.in_c) })).filter((l) => l.qty > 0);
    let left = move.qtyMilli;
    let valueLeft = move.value;
    const parts: { supplierId: string; currency: CurrencyCode; qty: number; ccy: number }[] = [];
    for (const l of open) {
      if (left <= 0) break;
      const take = Math.min(left, l.qty);
      parts.push({ supplierId: l.supplierId, currency: l.currency, qty: take, ccy: take === l.qty ? l.ccy : Math.round((l.ccy * take) / l.qty) });
      left -= take;
    }
    if (left === 0 && parts.length) {
      parts.forEach((part, i) => {
        const value = i === parts.length - 1 ? valueLeft : Math.round((move.value * part.qty) / move.qtyMilli);
        valueLeft -= value;
        insert(part.supplierId, part.currency, part.qty, value, part.currency === 'IQD' ? value : part.ccy);
      });
      return;
    }
  }

  // goods going out (a sale, a write-off, a transfer's first leg): what is on hand of an earlier supplier's goods (a
  // unit a customer brought back after the item changed supplier) goes first, and is owed to that supplier at what it
  // is carried at; the rest is the current supplier's — review of the 2.0 books #11
  if (move.qtyMilli < 0) {
    const layers = (db.prepare(`SELECT supplier_id, currency, SUM(qty_milli) AS q, SUM(value) AS v, SUM(ccy_value) AS c, MIN(created_at) AS first FROM consignment_moves
                                WHERE item_id = ? AND warehouse_id = ? GROUP BY supplier_id, currency HAVING SUM(qty_milli) > 0 ORDER BY first, supplier_id`)
      .all(move.itemId, move.warehouseId) as { supplier_id: string; currency: CurrencyCode; q: number; v: number; c: number }[])
      .filter((l) => l.supplier_id !== item.supplier_id || l.currency !== item.currency);
    if (layers.length) {
      let left = -move.qtyMilli;
      let valueLeft = -move.value;
      for (const l of layers) {
        if (left <= 0) break;
        const take = Math.min(left, Number(l.q));
        const value = Math.min(valueLeft, costOut(Number(l.q), Number(l.v), take));
        const ccy = l.currency === 'IQD' ? value : costOut(Number(l.q), Number(l.c), take);
        insert(l.supplier_id, l.currency, -take, -value, -ccy);
        left -= take;
        valueLeft -= value;
      }
      // the current supplier's part; with none of its goods in this move, what the stock's one average cost put on
      // the earlier supplier's goods beyond what they are carried at stays with the current supplier's (no quantity)
      if (left > 0 || valueLeft !== 0) {
        const own = ledgerOfSupplier(db, move.itemId, move.warehouseId, item.supplier_id, item.currency);
        const ccy = item.currency === 'IQD' ? valueLeft : left > 0 ? costOut(own.qtyMilli, own.ccy, left) : 0;
        insert(item.supplier_id, item.currency, -left, -valueLeft, -ccy);
      }
      return;
    }
  }
  const ccy = ccyValueOf(db, item, move.warehouseId, move.qtyMilli, move.value);
  writeMove(db, item, { ...base, qtyMilli: move.qtyMilli, value: move.value, ccy });
}

function ledgerOfSupplier(db: Db, itemId: string, warehouseId: string, supplierId: string, currency: CurrencyCode): Ledger {
  const r = db.prepare('SELECT SUM(qty_milli) AS q, SUM(value) AS v, SUM(ccy_value) AS c FROM consignment_moves WHERE item_id = ? AND warehouse_id = ? AND supplier_id = ? AND currency = ?')
    .get(itemId, warehouseId, supplierId, currency) as { q: number | null; v: number | null; c: number | null };
  return { qtyMilli: Number(r.q ?? 0), value: Number(r.v ?? 0), ccy: Number(r.c ?? 0) };
}

// ——— receipts and returns ———

export interface ConsignmentLineInput {
  itemId: string;
  qtyMilli: number;
  /** receipts: the agreed cost per unit of the line (its own unit when it has one); else the item's agreed cost */
  unitCost?: number | undefined;
  unit?: UnitCode | undefined;
  unitQtyMilli?: number | undefined;
  unitFactorMilli?: number | undefined;
  batchNo?: string | null | undefined;
  expiry?: string | null | undefined;
  batchId?: string | null | undefined;
}
type LineRequest = Omit<ConsignmentLineInput, 'qtyMilli' | 'unitFactorMilli'> & { qtyMilli?: number | undefined };

export interface ConsignmentDocInput {
  kind: ConsignmentDocKind;
  date: string;
  supplierId: string;
  warehouseId: string;
  /** dollars to dinars × 100: the day's rate, for goods agreed in dollars (else 100) */
  rateX100?: number | undefined;
  notes?: string | undefined;
  lines: ConsignmentLineInput[];
}

export interface ConsignmentDocLineView {
  seq: number;
  itemId: string;
  itemCode: string;
  itemName: Names;
  unit: UnitCode;
  qtyMilli: number;
  unitCost: number | null;
  lineUnit: UnitCode | null;
  unitFactorMilli: number | null;
  unitQtyMilli: number | null;
  batchNo: string | null;
  expiry: string | null;
  batchId: string | null;
  /** set once posted: the line's value in the agreed currency, and in the books (IQD) */
  amount: number | null;
  value: number | null;
}

export interface ConsignmentDocView {
  id: string;
  kind: ConsignmentDocKind;
  number: string | null;
  date: string;
  status: ConsignmentDocStatus;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: Names;
  currency: CurrencyCode;
  rateX100: number;
  entryId: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  total: number;
  actions: ConsignmentDocAction[];
  lines: ConsignmentDocLineView[];
}

interface DocRow {
  id: string; kind: ConsignmentDocKind; number: string | null; date: string; supplier_id: string; warehouse_id: string; currency: CurrencyCode;
  rate_x100: number; status: ConsignmentDocStatus; entry_id: string | null; notes: string | null; created_by: string; prepared_by_id: string | null;
  created_at: string;
}

function loadDoc(db: Db, id: string): DocRow {
  const row = db.prepare('SELECT * FROM consignment_docs WHERE id = ?').get(id) as unknown as DocRow | undefined;
  if (!row) throw notFound('consignment_doc');
  return row;
}

const docActions = (status: ConsignmentDocStatus): ConsignmentDocAction[] =>
  status === 'draft' ? ['edit', 'delete', 'post'] : status === 'posted' ? ['cancel'] : [];

export function getConsignmentDoc(db: Db, id: string): ConsignmentDocView {
  const row = loadDoc(db, id);
  const supplier = db.prepare('SELECT name FROM parties WHERE id = ?').get(row.supplier_id) as { name: string };
  const w = db.prepare('SELECT name_ar, name_en, name_ku FROM warehouses WHERE id = ?').get(row.warehouse_id) as { name_ar: string; name_en: string; name_ku: string };
  const lines = db.prepare(`SELECT l.*, i.code, i.name_ar, i.name_en, i.name_ku, i.unit AS base_unit FROM consignment_doc_lines l JOIN items i ON i.id = l.item_id
                            WHERE l.doc_id = ? ORDER BY l.seq`).all(id) as Record<string, unknown>[];
  const sourceType = `consignment_${row.kind}`;
  const moved = new Map<string, { qty: number; value: number; ccy: number }[]>();
  if (row.status !== 'draft') {
    for (const m of db.prepare('SELECT item_id, qty_milli, value, ccy_value FROM consignment_moves WHERE source_type = ? AND source_id = ? ORDER BY created_at, id').all(sourceType, id) as Record<string, unknown>[]) {
      const list = moved.get(String(m.item_id)) ?? [];
      list.push({ qty: Number(m.qty_milli), value: Number(m.value), ccy: Number(m.ccy_value) });
      moved.set(String(m.item_id), list);
    }
  }
  let total = 0;
  const views = lines.map((l): ConsignmentDocLineView => {
    const mv = moved.get(String(l.item_id))?.shift();
    const amount = mv ? Math.abs(mv.ccy) : row.kind === 'receipt' && l.unit_cost !== null
      ? lineAmount(l.unit !== null && l.unit_qty_milli !== null ? Number(l.unit_qty_milli) : Number(l.qty_milli), Number(l.unit_cost)) : null;
    total += amount ?? 0;
    return {
      seq: Number(l.seq), itemId: String(l.item_id), itemCode: String(l.code), itemName: { ar: String(l.name_ar), en: String(l.name_en), ku: String(l.name_ku) },
      unit: l.base_unit as UnitCode, qtyMilli: Number(l.qty_milli), unitCost: l.unit_cost === null ? null : Number(l.unit_cost),
      lineUnit: (l.unit as UnitCode | null) ?? null, unitFactorMilli: l.unit_factor_milli === null ? null : Number(l.unit_factor_milli),
      unitQtyMilli: l.unit_qty_milli === null ? null : Number(l.unit_qty_milli), batchNo: (l.batch_no as string | null) ?? null,
      expiry: (l.expiry as string | null) ?? null, batchId: (l.batch_id as string | null) ?? null,
      amount, value: mv ? Math.abs(mv.value) : null
    };
  });
  return {
    id: row.id, kind: row.kind, number: row.number, date: row.date, status: row.status, supplierId: row.supplier_id, supplierName: supplier.name,
    warehouseId: row.warehouse_id, warehouseName: { ar: w.name_ar, en: w.name_en, ku: w.name_ku }, currency: row.currency, rateX100: Number(row.rate_x100),
    entryId: row.entry_id, notes: row.notes, createdBy: row.created_by, createdAt: row.created_at, total, actions: docActions(row.status), lines: views
  };
}

export interface ConsignmentDocSummary {
  id: string; kind: ConsignmentDocKind; number: string | null; date: string; status: ConsignmentDocStatus; supplierId: string; supplierName: string;
  warehouseId: string; currency: CurrencyCode; lineCount: number;
}

export function listConsignmentDocs(db: Db, f: { supplierId?: string | undefined; kind?: ConsignmentDocKind | undefined; status?: ConsignmentDocStatus | undefined; limit?: number | undefined } = {}): ConsignmentDocSummary[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.supplierId) { where.push('d.supplier_id = ?'); params.push(f.supplierId); }
  if (f.kind) { where.push('d.kind = ?'); params.push(f.kind); }
  if (f.status) { where.push('d.status = ?'); params.push(f.status); }
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 1000);
  const rows = db.prepare(`SELECT d.id, d.kind, d.number, d.date, d.status, d.supplier_id, d.warehouse_id, d.currency, p.name AS supplier_name,
                                  (SELECT COUNT(*) FROM consignment_doc_lines l WHERE l.doc_id = d.id) AS line_count
                           FROM consignment_docs d JOIN parties p ON p.id = d.supplier_id
                           ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.date DESC, d.created_at DESC LIMIT ${limit}`).all(...params) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id), kind: r.kind as ConsignmentDocKind, number: (r.number as string | null) ?? null, date: String(r.date), status: r.status as ConsignmentDocStatus,
    supplierId: String(r.supplier_id), supplierName: String(r.supplier_name), warehouseId: String(r.warehouse_id), currency: r.currency as CurrencyCode, lineCount: Number(r.line_count)
  }));
}

/** The currency of a document: its items' agreed currency (one supplier, one currency per document). */
function docCurrency(db: Db, input: ConsignmentDocInput): CurrencyCode {
  const errors: { code: string; line?: number; field?: string }[] = [];
  let currency: CurrencyCode | null = null;
  input.lines.forEach((l, i) => {
    const c = consignedItem(db, l.itemId);
    if (!c || c.supplier_id !== input.supplierId) { errors.push({ code: 'cs_item_not_from_supplier', line: i + 1 }); return; }
    if (currency && currency !== c.currency) errors.push({ code: 'cs_mixed_currencies', line: i + 1 });
    currency ??= c.currency;
  });
  if (errors.length) throw invalid(errors);
  return currency ?? 'IQD';
}

function assertDocInput(db: Db, input: ConsignmentDocInput): CurrencyCode {
  const errors: { code: string; line?: number; field?: string }[] = [];
  if (input.kind !== 'receipt' && input.kind !== 'return') errors.push({ code: 'kind_invalid', field: 'kind' });
  if (!isIsoDate(input.date)) errors.push({ code: 'date_invalid', field: 'date' });
  supplierRow(db, input.supplierId);
  const w = db.prepare('SELECT active FROM warehouses WHERE id = ?').get(input.warehouseId) as { active: number } | undefined;
  if (!w || Number(w.active) !== 1) errors.push({ code: 'warehouse_invalid', field: 'warehouseId' });
  if (!Array.isArray(input.lines) || input.lines.length === 0) errors.push({ code: 'lines_required' });
  if (errors.length) throw invalid(errors);
  const currency = docCurrency(db, input);
  if (currency === 'USD' && (!Number.isSafeInteger(input.rateX100) || (input.rateX100 ?? 0) <= 0)) errors.push({ code: 'rate_invalid', field: 'rateX100' });
  input.lines.forEach((l, i) => {
    if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0) errors.push({ code: 'line_qty_invalid', line: i + 1 });
    if (l.unitCost !== undefined && (!Number.isSafeInteger(l.unitCost) || l.unitCost < 0)) errors.push({ code: 'line_price_invalid', line: i + 1 });
    errors.push(...lineBatchErrors(db, l.itemId, input.kind === 'receipt' ? { batchNo: l.batchNo, expiry: l.expiry } : { batchId: l.batchId }, i + 1));
  });
  if (errors.length) throw invalid(errors);
  return currency;
}

function writeDocLines(db: Db, id: string, kind: ConsignmentDocKind, lines: ConsignmentLineInput[]): void {
  db.prepare('DELETE FROM consignment_doc_lines WHERE doc_id = ?').run(id);
  const insert = db.prepare(`INSERT INTO consignment_doc_lines (doc_id, seq, item_id, qty_milli, unit_cost, unit, unit_factor_milli, unit_qty_milli, batch_no, expiry, batch_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  lines.forEach((l, i) => insert.run(id, i + 1, l.itemId, l.qtyMilli, kind === 'receipt' && l.unitCost !== undefined ? l.unitCost : null,
    l.unit ?? null, l.unit ? l.unitFactorMilli ?? null : null, l.unit ? l.unitQtyMilli ?? null : null,
    ...(kind === 'receipt' ? batchColumns({ batchNo: l.batchNo, expiry: l.expiry }) : batchColumns({ batchId: l.batchId }))));
}

const withUnits = (db: Db, input: Omit<ConsignmentDocInput, 'lines'> & { lines: (ConsignmentLineInput | LineRequest)[] }): ConsignmentDocInput =>
  ({ ...input, lines: Array.isArray(input.lines) ? resolveLines(db, input.lines) as ConsignmentLineInput[] : input.lines as ConsignmentLineInput[] });

export function createConsignmentDoc(db: Db, raw: Omit<ConsignmentDocInput, 'lines'> & { lines: (ConsignmentLineInput | LineRequest)[] }, actor: Actor): ConsignmentDocView {
  requirePlan(db);
  const input = withUnits(db, raw);
  const currency = assertDocInput(db, input);
  const id = randomUUID();
  transaction(db, () => {
    const now = nowIso();
    db.prepare(`INSERT INTO consignment_docs (id, kind, number, date, supplier_id, warehouse_id, currency, rate_x100, status, entry_id, notes, created_by, prepared_by_id, created_at, updated_at)
                VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?, ?, ?)`)
      .run(id, input.kind, input.date, input.supplierId, input.warehouseId, currency, currency === 'USD' ? input.rateX100! : 100, input.notes?.trim() || null, actor.name, actor.id, now, now);
    writeDocLines(db, id, input.kind, input.lines);
    audit(db, actor.name, 'create', 'consignment_doc', id, { kind: input.kind, lines: input.lines.length });
  });
  return getConsignmentDoc(db, id);
}

export function updateConsignmentDoc(db: Db, id: string, raw: Omit<ConsignmentDocInput, 'lines'> & { lines: (ConsignmentLineInput | LineRequest)[] }, actor: Actor): ConsignmentDocView {
  requirePlan(db);
  const row = loadDoc(db, id);
  if (row.status !== 'draft') throw conflict('action_not_allowed', { status: row.status, action: 'edit' });
  const input = withUnits(db, { ...raw, kind: row.kind });
  const currency = assertDocInput(db, input);
  transaction(db, () => {
    db.prepare('UPDATE consignment_docs SET date = ?, supplier_id = ?, warehouse_id = ?, currency = ?, rate_x100 = ?, notes = ?, prepared_by_id = ?, updated_at = ? WHERE id = ?')
      .run(input.date, input.supplierId, input.warehouseId, currency, currency === 'USD' ? input.rateX100! : 100, input.notes?.trim() || null, actor.id, nowIso(), id);
    writeDocLines(db, id, row.kind, input.lines);
    audit(db, actor.name, 'update', 'consignment_doc', id);
  });
  return getConsignmentDoc(db, id);
}

export function deleteConsignmentDoc(db: Db, id: string, actor: Actor): void {
  const row = loadDoc(db, id);
  if (row.status !== 'draft') throw conflict('action_not_allowed', { status: row.status, action: 'delete' });
  transaction(db, () => {
    db.prepare('DELETE FROM consignment_doc_lines WHERE doc_id = ?').run(id);
    db.prepare('DELETE FROM consignment_docs WHERE id = ?').run(id);
    audit(db, actor.name, 'delete', 'consignment_doc', id);
  });
}

/** With "separate duties" on, posting (which approves its entry at once) is the approver's step, not the preparer's. */
function assertMayPost(db: Db, row: DocRow, actor: Actor): void {
  if (readSetting(db, 'separate_duties') !== '1') return;
  if (!actor.permissions.includes('entries.approve')) throw new AppError(403, 'forbidden', { need: 'entries.approve' });
  if (actor.id && row.prepared_by_id === actor.id) throw conflict('same_person');
}

const warehouseAccount = (db: Db, warehouseId: string): string =>
  (db.prepare('SELECT account_code FROM warehouses WHERE id = ?').get(warehouseId) as { account_code: string }).account_code;

export type ConsignmentLang = 'ar' | 'en' | 'ku';
const DOC_WORDS: Record<ConsignmentLang, Record<ConsignmentDocKind | 'settlement', string>> = {
  ar: { receipt: 'استلام بضاعة أمانة', return: 'إرجاع بضاعة أمانة', settlement: 'تسوية بضاعة أمانة' },
  en: { receipt: 'Consignment receipt', return: 'Consignment return', settlement: 'Consignment settlement' },
  ku: { receipt: 'وەرگرتنی کاڵای ئەمانەت', return: 'گەڕاندنەوەی کاڵای ئەمانەت', settlement: 'یەکلاکردنەوەی کاڵای ئەمانەت' }
};

/** Approves a document's entry at once, as stock documents and adjustments do. */
function insertApproved(db: Db, entry: EntryInput, user: string): string {
  assertValid(db, entry);
  const entryId = insertEntry(db, entry, user, null);
  const now = nowIso();
  db.prepare(`UPDATE entries SET status = 'approved', number = ?, checked_by = ?, checked_at = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
    .run(nextNumber(db, 'journal', entry.date), user, now, user, now, now, entryId);
  return entryId;
}

export function postConsignmentDoc(db: Db, id: string, actor: Actor, lang: ConsignmentLang = 'ar'): ConsignmentDocView {
  requirePlan(db);
  const row = loadDoc(db, id);
  if (row.status !== 'draft') throw conflict('action_not_allowed', { status: row.status, action: 'post' });
  assertMayPost(db, row, actor);
  const view = getConsignmentDoc(db, id);
  const input: ConsignmentDocInput = {
    kind: row.kind, date: row.date, supplierId: row.supplier_id, warehouseId: row.warehouse_id, rateX100: Number(row.rate_x100),
    lines: view.lines.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli, unitCost: l.unitCost ?? undefined, batchNo: l.batchNo, expiry: l.expiry, batchId: l.batchId }))
  };
  const currency = assertDocInput(db, input);
  if (isPeriodLocked(db, row.date)) throw invalid([{ code: 'period_locked', period: row.date.slice(0, 7) }]);
  const rate = currency === 'USD' ? Number(row.rate_x100) : 100;
  const held = consignmentAccount(db, actor.name);

  type Planned = { item: ConsignmentItemRow; qtyMilli: number; value: number; ccy: number; seq: number };
  const planned: Planned[] = [];
  const errors: { code: string; line: number; available?: number }[] = [];
  const stock = new Map<string, { qtyMilli: number; value: number }>();
  const ledgers = new Map<string, Ledger>();
  for (const l of view.lines) {
    const item = consignedItem(db, l.itemId)!;
    if (row.kind === 'receipt') {
      const cost = l.unitCost ?? (l.lineUnit && l.unitFactorMilli ? Math.round((item.unit_cost * l.unitFactorMilli) / 1000) : item.unit_cost);
      const ccy = lineAmount(l.lineUnit && l.unitQtyMilli !== null ? l.unitQtyMilli : l.qtyMilli, cost);
      planned.push({ item, qtyMilli: l.qtyMilli, value: toBase(ccy, currency, rate), ccy, seq: l.seq });
    } else {
      const s = stock.get(l.itemId) ?? stockOf(db, l.itemId, row.warehouse_id);
      const led = ledgers.get(l.itemId) ?? ledgerOf(db, l.itemId, row.warehouse_id);
      if (s.qtyMilli < l.qtyMilli) errors.push({ code: 'stock_insufficient', line: l.seq, available: Math.max(0, s.qtyMilli) });
      const value = costOut(s.qtyMilli, s.value, l.qtyMilli);
      const ccy = currency === 'IQD' ? value : costOut(led.qtyMilli, led.ccy, l.qtyMilli);
      stock.set(l.itemId, { qtyMilli: s.qtyMilli - l.qtyMilli, value: s.value - value });
      ledgers.set(l.itemId, { qtyMilli: led.qtyMilli - l.qtyMilli, value: led.value - value, ccy: led.ccy - ccy });
      planned.push({ item, qtyMilli: -l.qtyMilli, value: -value, ccy: -ccy, seq: l.seq });
    }
  }
  if (errors.length) throw invalid(errors);

  const batchMoves: BatchMove[] = [];
  const inbound: { lineNo: number; itemId: string; qtyMilli: number; batchNo: string | null; expiry: string | null }[] = [];
  const taken = new Map<string, number>();
  const batchErrors: (BatchError | { code: string; line: number })[] = [];
  for (const l of view.lines) {
    const tracking = batchTracking(db, l.itemId);
    if (!tracking.batches) continue;
    if (row.kind === 'return') {
      const r = allocateOut(db, { itemId: l.itemId, warehouseId: row.warehouse_id, qtyMilli: l.qtyMilli, date: row.date, line: l.seq, purpose: 'other', allowExpired: true, pinned: l.batchId }, taken);
      if ('code' in r) { batchErrors.push(r); continue; }
      addTaken(taken, r.picks);
      for (const p of r.picks) batchMoves.push({ batchId: p.batchId, itemId: l.itemId, warehouseId: row.warehouse_id, qtyMilli: -p.qtyMilli, lineNo: l.seq });
    } else {
      if (tracking.expiry && !l.expiry) batchErrors.push({ code: 'expiry_required', line: l.seq });
      inbound.push({ lineNo: l.seq, itemId: l.itemId, qtyMilli: l.qtyMilli, batchNo: l.batchNo, expiry: l.expiry });
    }
  }
  if (batchErrors.length) throw invalid(batchErrors);

  const total = planned.reduce((s, p) => s + Math.abs(p.value), 0);
  const stockAccount = warehouseAccount(db, row.warehouse_id);
  const sourceType = `consignment_${row.kind}`;
  transaction(db, () => {
    const prefix = row.kind === 'receipt' ? 'CSR' : 'CST';
    const number = `${prefix}-${row.date.slice(0, 4)}-${String(nextSequence(db, `consignment_${row.kind}:${row.date.slice(0, 4)}`)).padStart(4, '0')}`;
    const supplier = supplierRow(db, row.supplier_id);
    let entryId: string | null = null;
    if (total > 0) {
      const description = `${number} · ${DOC_WORDS[lang][row.kind]} · ${supplier.name}${row.notes ? ` · ${row.notes}` : ''}`.slice(0, 300);
      const lines: EntryInput['lines'] = row.kind === 'receipt'
        ? [{ accountCode: stockAccount, debit: total, credit: 0, description }, { accountCode: held, debit: 0, credit: total, description }]
        : [{ accountCode: held, debit: total, credit: 0, description }, { accountCode: stockAccount, debit: 0, credit: total, description }];
      entryId = insertApproved(db, { type: 'journal', date: row.date, currency: 'IQD', rateX100: 100, description, party: supplier.name, lines }, actor.name);
    }
    for (const p of planned) {
      addStockMove(db, { itemId: p.item.item_id, warehouseId: row.warehouse_id, date: row.date, qtyMilli: p.qtyMilli, value: p.value, sourceType, sourceId: id });
      writeMove(db, p.item, { warehouseId: row.warehouse_id, date: row.date, kind: row.kind === 'receipt' ? 'received' : 'returned', sourceType, sourceId: id, qtyMilli: p.qtyMilli, value: p.value, ccy: p.ccy });
    }
    for (const l of inbound) {
      const b = inboundBatch(db, l.itemId, l, l.lineNo, row.date);
      if (b) batchMoves.push({ batchId: b.batchId, itemId: l.itemId, warehouseId: row.warehouse_id, qtyMilli: l.qtyMilli, lineNo: l.lineNo });
    }
    writeBatchMoves(db, batchMoves, row.date, sourceType, id);
    db.prepare(`UPDATE consignment_docs SET status = 'posted', number = ?, entry_id = ?, updated_at = ? WHERE id = ?`).run(number, entryId, nowIso(), id);
    audit(db, actor.name, 'post', 'consignment_doc', id, { number, entryId, value: total });
  });
  return getConsignmentDoc(db, id);
}

/** Cancels a posted receipt or return: its entry is reversed and its stock moves undone (received goods must still be there). */
export function cancelConsignmentDoc(db: Db, id: string, actor: Actor, date?: string): ConsignmentDocView {
  const row = loadDoc(db, id);
  if (row.status !== 'posted') throw conflict('action_not_allowed', { status: row.status, action: 'cancel' });
  assertMayPost(db, row, actor);
  const cancelDate = date ?? (todayIso() < row.date ? row.date : todayIso());
  if (!isIsoDate(cancelDate)) throw invalid([{ code: 'date_invalid' }]);
  if (cancelDate < row.date) throw invalid([{ code: 'date_before_document' }]);
  if (isPeriodLocked(db, cancelDate)) throw invalid([{ code: 'period_locked', period: cancelDate.slice(0, 7) }]);
  const sourceType = `consignment_${row.kind}`;
  const moves = db.prepare('SELECT item_id, supplier_id, currency, qty_milli, value, ccy_value FROM consignment_moves WHERE source_type = ? AND source_id = ? ORDER BY created_at, id')
    .all(sourceType, id) as Record<string, unknown>[];
  const remaining = new Map<string, { qtyMilli: number; value: number }>();
  const errors: { code: string; itemId: string; available?: number }[] = [];
  for (const m of moves) {
    const qty = Number(m.qty_milli);
    if (qty < 0) continue;
    const itemId = String(m.item_id);
    const s = remaining.get(itemId) ?? stockOf(db, itemId, row.warehouse_id);
    const after = { qtyMilli: s.qtyMilli - qty, value: s.value - Number(m.value) };
    if (after.qtyMilli < 0) errors.push({ code: 'stock_insufficient', itemId, available: Math.max(0, s.qtyMilli) });
    else if (after.value < 0 || (after.qtyMilli === 0 && after.value !== 0)) errors.push({ code: 'stock_already_used', itemId });
    remaining.set(itemId, after);
  }
  if (errors.length) throw invalid(errors);
  assertReversible(db, sourceType, id);
  transaction(db, () => {
    const reversalId = row.entry_id ? reverseEntryInternal(db, row.entry_id, actor.name, cancelDate) : null;
    for (const m of moves) {
      const item: ConsignmentItemRow = { item_id: String(m.item_id), supplier_id: String(m.supplier_id), currency: m.currency as CurrencyCode, unit_cost: 0, active: 1 };
      addStockMove(db, { itemId: item.item_id, warehouseId: row.warehouse_id, date: cancelDate, qtyMilli: -Number(m.qty_milli), value: -Number(m.value), sourceType: `${sourceType}_cancel`, sourceId: id });
      writeMove(db, item, {
        warehouseId: row.warehouse_id, date: cancelDate, kind: row.kind === 'receipt' ? 'received' : 'returned', sourceType: `${sourceType}_cancel`, sourceId: id,
        qtyMilli: -Number(m.qty_milli), value: -Number(m.value), ccy: -Number(m.ccy_value)
      });
    }
    cancelBatchMoves(db, sourceType, id, cancelDate, moves.map((m) => ({ itemId: String(m.item_id), warehouseId: row.warehouse_id })));
    db.prepare("UPDATE consignment_docs SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), id);
    audit(db, actor.name, 'cancel', 'consignment_doc', id, { reversalId });
  });
  return getConsignmentDoc(db, id);
}

// ——— settlements ———

export interface SettlementLine { itemId: string; itemCode: string; itemName: Names; unit: UnitCode; qtyMilli: number; amount: number; value: number }
export interface SettlementPreview { supplierId: string; currency: CurrencyCode; date: string; amount: number; value: number; lines: SettlementLine[] }

function unsettledSql(alias = 'm'): string {
  return `${alias}.supplier_id = ? AND ${alias}.currency = ? AND ${alias}.kind = 'sold' AND ${alias}.settlement_id IS NULL AND ${alias}.date <= ?`;
}

/** What sold (net of customers' returns) and is not settled yet, up to `date`, per item: what the supplier is owed. */
export function settlementPreview(db: Db, supplierId: string, currency: CurrencyCode, date: string): SettlementPreview {
  supplierRow(db, supplierId);
  if (!isIsoDate(date)) throw invalid([{ code: 'date_invalid', field: 'date' }]);
  const rows = db.prepare(`SELECT m.item_id, i.code, i.name_ar, i.name_en, i.name_ku, i.unit, SUM(m.qty_milli) AS q, SUM(m.ccy_value) AS c, SUM(m.value) AS v
                           FROM consignment_moves m JOIN items i ON i.id = m.item_id WHERE ${unsettledSql()}
                           GROUP BY m.item_id, i.code, i.name_ar, i.name_en, i.name_ku, i.unit ORDER BY i.code`).all(supplierId, currency, date) as Record<string, unknown>[];
  const lines = rows.map((r) => ({
    itemId: String(r.item_id), itemCode: String(r.code), itemName: { ar: String(r.name_ar), en: String(r.name_en), ku: String(r.name_ku) }, unit: r.unit as UnitCode,
    qtyMilli: -Number(r.q ?? 0), amount: -Number(r.c ?? 0), value: -Number(r.v ?? 0)
  })).filter((l) => l.qtyMilli !== 0 || l.amount !== 0 || l.value !== 0);
  return { supplierId, currency, date, amount: lines.reduce((s, l) => s + l.amount, 0), value: lines.reduce((s, l) => s + l.value, 0), lines };
}

export interface SettlementView {
  id: string; number: string; date: string; supplierId: string; supplierName: string; currency: CurrencyCode; rateX100: number; amount: number; value: number;
  status: 'open' | 'cancelled';
  /** where its entry stands: waiting (draft or checked), approved (owed to the supplier in the books), or reversed */
  entryState: 'draft' | 'checked' | 'approved' | 'reversed' | 'none';
  entryId: string | null; cancelEntryId: string | null; notes: string | null; createdBy: string; createdAt: string; lines: SettlementLine[];
}

interface SettlementRow {
  id: string; number: string; date: string; supplier_id: string; currency: CurrencyCode; rate_x100: number; amount: number; book_value: number;
  status: 'open' | 'cancelled'; entry_id: string | null; cancel_entry_id: string | null; notes: string | null; created_by: string; created_at: string;
}

function loadSettlement(db: Db, id: string): SettlementRow {
  const row = db.prepare('SELECT * FROM consignment_settlements WHERE id = ?').get(id) as unknown as SettlementRow | undefined;
  if (!row) throw notFound('consignment_settlement');
  return row;
}

function entryStateOf(db: Db, row: SettlementRow): SettlementView['entryState'] {
  if (row.cancel_entry_id) return 'reversed';
  if (!row.entry_id) return 'none';
  const e = db.prepare('SELECT status FROM entries WHERE id = ?').get(row.entry_id) as { status: string } | undefined;
  return e?.status === 'approved' ? 'approved' : e?.status === 'checked' ? 'checked' : e ? 'draft' : 'none';
}

export function getSettlement(db: Db, id: string): SettlementView {
  const row = loadSettlement(db, id);
  const supplier = db.prepare('SELECT name FROM parties WHERE id = ?').get(row.supplier_id) as { name: string };
  const rows = db.prepare(`SELECT m.item_id, i.code, i.name_ar, i.name_en, i.name_ku, i.unit, SUM(m.qty_milli) AS q, SUM(m.ccy_value) AS c, SUM(m.value) AS v
                           FROM consignment_moves m JOIN items i ON i.id = m.item_id WHERE m.settlement_id = ?
                           GROUP BY m.item_id, i.code, i.name_ar, i.name_en, i.name_ku, i.unit ORDER BY i.code`).all(id) as Record<string, unknown>[];
  return {
    id: row.id, number: row.number, date: row.date, supplierId: row.supplier_id, supplierName: supplier.name, currency: row.currency, rateX100: Number(row.rate_x100),
    amount: Number(row.amount), value: Number(row.book_value), status: row.status, entryState: entryStateOf(db, row), entryId: row.entry_id,
    cancelEntryId: row.cancel_entry_id, notes: row.notes, createdBy: row.created_by, createdAt: row.created_at,
    lines: rows.map((r) => ({
      itemId: String(r.item_id), itemCode: String(r.code), itemName: { ar: String(r.name_ar), en: String(r.name_en), ku: String(r.name_ku) }, unit: r.unit as UnitCode,
      qtyMilli: -Number(r.q ?? 0), amount: -Number(r.c ?? 0), value: -Number(r.v ?? 0)
    }))
  };
}

export function listSettlements(db: Db, f: { supplierId?: string | undefined } = {}): Omit<SettlementView, 'lines'>[] {
  const rows = db.prepare(`SELECT id FROM consignment_settlements ${f.supplierId ? 'WHERE supplier_id = ?' : ''} ORDER BY date DESC, created_at DESC LIMIT 500`)
    .all(...(f.supplierId ? [f.supplierId] : [])) as { id: string }[];
  return rows.map((r) => { const { lines: _lines, ...rest } = getSettlement(db, r.id); return rest; });
}

/**
 * Settles what sold up to `date`: one journal entry Dr consignment goods held (their value in the books) / Cr the
 * supplier (what is owed in the agreed currency), made like any other voucher: it waits for checking and approval
 * unless its preparer may approve their own (createJournalEntry). The moves it covers are not settled again.
 */
export function createSettlement(db: Db, input: { supplierId: string; currency: CurrencyCode; date: string; rateX100?: number | undefined; notes?: string | undefined; lang?: ConsignmentLang | undefined }, actor: Actor): SettlementView {
  requirePlan(db);
  const supplier = supplierRow(db, input.supplierId);
  if (input.currency !== 'IQD' && input.currency !== 'USD') throw invalid([{ code: 'currency_invalid', field: 'currency' }]);
  const rate = input.currency === 'USD' ? input.rateX100 ?? 0 : 100;
  if (!Number.isSafeInteger(rate) || rate <= 0) throw invalid([{ code: 'rate_invalid', field: 'rateX100' }]);
  const preview = settlementPreview(db, input.supplierId, input.currency, input.date);
  if (preview.amount <= 0) throw conflict('cs_nothing_to_settle', { amount: preview.amount });
  const held = consignmentAccount(db, actor.name);
  const lang = input.lang ?? 'ar';
  const id = randomUUID();
  transaction(db, () => {
    const number = `CSS-${input.date.slice(0, 4)}-${String(nextSequence(db, `consignment_settlement:${input.date.slice(0, 4)}`)).padStart(4, '0')}`;
    const description = `${number} · ${DOC_WORDS[lang].settlement} · ${supplier.name}${input.notes?.trim() ? ` · ${input.notes.trim()}` : ''}`.slice(0, 300);
    const lines: EntryInput['lines'] = [];
    if (input.currency === 'IQD') {
      lines.push({ accountCode: held, debit: preview.value, credit: 0, description });
      const diff = preview.amount - preview.value;
      if (diff > 0) lines.push({ accountCode: firstPostableUnder(db, '39'), debit: diff, credit: 0, description });
      if (diff < 0) lines.push({ accountCode: firstPostableUnder(db, '49'), debit: 0, credit: -diff, description });
      lines.push({ accountCode: supplier.account_code, debit: 0, credit: preview.amount, description, partyId: supplier.id });
    } else {
      // dollars owed at today's rate; the goods are carried in the books at the dinars they came in at
      const owedIqd = toBase(preview.amount, 'USD', rate);
      const diff = owedIqd - preview.value;
      lines.push({ accountCode: held, debit: preview.amount, credit: 0, baseDebit: preview.value, baseCredit: 0, description });
      lines.push({ accountCode: supplier.account_code, debit: 0, credit: preview.amount, baseDebit: 0, baseCredit: owedIqd, description, partyId: supplier.id });
      if (diff > 0) lines.push({ accountCode: firstPostableUnder(db, '39'), debit: 0, credit: 0, baseDebit: diff, baseCredit: 0, description });
      if (diff < 0) lines.push({ accountCode: firstPostableUnder(db, '49'), debit: 0, credit: 0, baseDebit: 0, baseCredit: -diff, description });
    }
    const entry = createJournalEntry(db, { date: input.date, description, party: supplier.name, currency: input.currency, rateX100: rate, lines }, actor.name, actor.id, preparerOf(actor));
    const now = nowIso();
    db.prepare(`INSERT INTO consignment_settlements (id, number, date, supplier_id, currency, rate_x100, amount, book_value, status, entry_id, cancel_entry_id, notes, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?, ?, ?, ?)`)
      .run(id, number, input.date, supplier.id, input.currency, rate, preview.amount, preview.value, entry.id, input.notes?.trim() || null, actor.name, now, now);
    const claimed = db.prepare(`UPDATE consignment_moves SET settlement_id = ? WHERE ${unsettledSql('consignment_moves')}`).run(id, supplier.id, input.currency, input.date);
    if (Number(claimed.changes) === 0) throw conflict('cs_nothing_to_settle');
    audit(db, actor.name, 'create', 'consignment_settlement', id, { number, amount: preview.amount, currency: input.currency, entryId: entry.id });
  });
  return getSettlement(db, id);
}

/**
 * Takes a settlement back: while its entry waits (a draft) the entry is deleted; once approved it is reversed. Either
 * way what it covered is unsettled again. A checked entry is returned to draft by its checker first.
 */
export function cancelSettlement(db: Db, id: string, actor: Actor, date?: string): SettlementView {
  const row = loadSettlement(db, id);
  if (row.status !== 'open') throw conflict('action_not_allowed', { status: row.status, action: 'cancel' });
  transaction(db, () => {
    let reversal: string | null = null;
    if (row.entry_id) {
      const entry = getEntry(db, row.entry_id);
      if (entry.status === 'approved') {
        if (entry.reversedById) throw conflict('cs_entry_reversed');
        // reversing an approved settlement takes back what the supplier is owed: someone who may approve entries,
        // and not the one who made it when duties are separate (accounting review #8)
        if (!actor.permissions.includes('admin') && !actor.permissions.includes('entries.approve')) throw new AppError(403, 'forbidden', { need: 'entries.approve' });
        if (readSetting(db, 'separate_duties') === '1' && !actor.permissions.includes('admin')
          && ((actor.id && entry.preparedById === actor.id) || entry.preparedBy === actor.name)) throw conflict('same_person');
        const d = date ?? (todayIso() < row.date ? row.date : todayIso());
        if (d < row.date) throw invalid([{ code: 'date_before_document' }]);
        reversal = reverseEntryInternal(db, row.entry_id, actor.name, d);
      } else if (entry.status === 'draft') {
        db.prepare('UPDATE consignment_settlements SET entry_id = NULL WHERE id = ?').run(id);
        deleteEntry(db, row.entry_id, actor.name);
      } else throw conflict('cs_entry_checked', { status: entry.status });
    }
    db.prepare('UPDATE consignment_moves SET settlement_id = NULL WHERE settlement_id = ?').run(id);
    db.prepare("UPDATE consignment_settlements SET status = 'cancelled', cancel_entry_id = ?, updated_at = ? WHERE id = ?").run(reversal, nowIso(), id);
    audit(db, actor.name, 'cancel', 'consignment_settlement', id, { reversal });
  });
  return getSettlement(db, id);
}

// ——— the supplier's statement ———

export interface ConsignmentStatementItem {
  itemId: string; itemCode: string; itemName: Names; unit: UnitCode; currency: CurrencyCode; unitCost: number;
  receivedMilli: number; returnedMilli: number; soldMilli: number; onHandMilli: number;
  receivedAmount: number; returnedAmount: number; soldAmount: number; onHandAmount: number;
}

export interface ConsignmentStatement {
  supplierId: string; supplierName: string; from: string | null; to: string;
  items: ConsignmentStatementItem[];
  /** per currency: sold in the period, settled in the period (approved), settled waiting for approval, sold and not settled yet (to `to`) */
  totals: Record<CurrencyCode, { received: number; returned: number; sold: number; onHand: number; settled: number; waiting: number; unsettled: number }>;
  /** paid to the supplier in the period (payments in the books, every currency in IQD) and what the books say is owed now */
  paid: number;
  balance: number;
  settlements: Omit<SettlementView, 'lines'>[];
}

export function consignmentStatement(db: Db, supplierId: string, range: { from?: string | undefined; to?: string | undefined } = {}): ConsignmentStatement {
  const supplier = supplierRow(db, supplierId);
  const to = range.to ?? todayIso();
  const from = range.from ?? null;
  if (!isIsoDate(to) || (from && !isIsoDate(from))) throw invalid([{ code: 'date_invalid' }]);
  const inRange = from ? 'm.date >= ? AND m.date <= ?' : 'm.date <= ?';
  const rangeParams = from ? [from, to] : [to];
  const rows = db.prepare(`SELECT m.item_id, m.currency, m.kind,
                                  SUM(CASE WHEN ${inRange} THEN m.qty_milli ELSE 0 END) AS q,
                                  SUM(CASE WHEN ${inRange} THEN m.ccy_value ELSE 0 END) AS c,
                                  SUM(CASE WHEN m.date <= ? THEN m.qty_milli ELSE 0 END) AS q_end,
                                  SUM(CASE WHEN m.date <= ? THEN m.ccy_value ELSE 0 END) AS c_end
                           FROM consignment_moves m WHERE m.supplier_id = ? GROUP BY m.item_id, m.currency, m.kind`)
    .all(...rangeParams, ...rangeParams, to, to, supplierId) as Record<string, unknown>[];
  const byItem = new Map<string, ConsignmentStatementItem>();
  const zero = () => ({ received: 0, returned: 0, sold: 0, onHand: 0, settled: 0, waiting: 0, unsettled: 0 });
  const totals: ConsignmentStatement['totals'] = { IQD: zero(), USD: zero() };
  for (const r of rows) {
    const itemId = String(r.item_id);
    let it = byItem.get(itemId);
    if (!it) {
      const i = db.prepare('SELECT code, name_ar, name_en, name_ku, unit FROM items WHERE id = ?').get(itemId) as Record<string, unknown>;
      const c = db.prepare('SELECT currency, unit_cost FROM consignment_items WHERE item_id = ?').get(itemId) as { currency: CurrencyCode; unit_cost: number } | undefined;
      it = {
        itemId, itemCode: String(i.code), itemName: { ar: String(i.name_ar), en: String(i.name_en), ku: String(i.name_ku) }, unit: i.unit as UnitCode,
        currency: (r.currency as CurrencyCode), unitCost: Number(c?.unit_cost ?? 0),
        receivedMilli: 0, returnedMilli: 0, soldMilli: 0, onHandMilli: 0, receivedAmount: 0, returnedAmount: 0, soldAmount: 0, onHandAmount: 0
      };
      byItem.set(itemId, it);
    }
    const q = Number(r.q ?? 0), c = Number(r.c ?? 0);
    const t = totals[r.currency as CurrencyCode];
    if (r.kind === 'received') { it.receivedMilli += q; it.receivedAmount += c; t.received += c; }
    if (r.kind === 'returned') { it.returnedMilli -= q; it.returnedAmount -= c; t.returned -= c; }
    if (r.kind === 'sold') { it.soldMilli -= q; it.soldAmount -= c; t.sold -= c; }
    it.onHandMilli += Number(r.q_end ?? 0);
    it.onHandAmount += Number(r.c_end ?? 0);
    t.onHand += Number(r.c_end ?? 0);
  }
  const settlements = listSettlements(db, { supplierId });
  for (const s of settlements) {
    if (s.status !== 'open') continue;
    if (from && s.date < from) continue;
    if (s.date > to) continue;
    if (s.entryState === 'approved') totals[s.currency].settled += s.amount;
    else totals[s.currency].waiting += s.amount;
  }
  for (const currency of ['IQD', 'USD'] as const) totals[currency].unsettled = settlementPreview(db, supplierId, currency, to).amount;
  const paid = Number((db.prepare(`SELECT COALESCE(SUM(l.base_debit), 0) AS p FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                                   WHERE l.party_id = ? AND e.status = 'approved' AND e.type = 'payment' AND e.date <= ?${from ? ' AND e.date >= ?' : ''}`)
    .get(supplierId, to, ...(from ? [from] : [])) as { p: number }).p);
  const balance = Number((db.prepare(`SELECT COALESCE(SUM(l.base_credit - l.base_debit), 0) AS b FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                                      WHERE l.party_id = ? AND e.status = 'approved' AND e.date <= ?`).get(supplierId, to) as { b: number }).b);
  return {
    supplierId, supplierName: supplier.name, from, to, items: [...byItem.values()].sort((a, b) => a.itemCode.localeCompare(b.itemCode)),
    totals, paid, balance, settlements: settlements.filter((s) => (!from || s.date >= from) && s.date <= to)
  };
}

/** Suppliers with goods on consignment, with what they have on hand and what sold and is not settled yet. */
export function consignmentSuppliers(db: Db): { supplierId: string; supplierName: string; items: number; unsettled: Record<CurrencyCode, number> }[] {
  const rows = db.prepare(`SELECT p.id, p.name, (SELECT COUNT(*) FROM consignment_items c WHERE c.supplier_id = p.id AND c.active = 1) AS items
                           FROM parties p WHERE p.type = 'supplier' AND (EXISTS (SELECT 1 FROM consignment_items c WHERE c.supplier_id = p.id AND c.active = 1)
                             OR EXISTS (SELECT 1 FROM consignment_moves m WHERE m.supplier_id = p.id)) ORDER BY p.name`).all() as Record<string, unknown>[];
  const today = todayIso();
  return rows.map((r) => ({
    supplierId: String(r.id), supplierName: String(r.name), items: Number(r.items),
    unsettled: { IQD: settlementPreview(db, String(r.id), 'IQD', today).amount, USD: settlementPreview(db, String(r.id), 'USD', today).amount }
  }));
}

// ——— API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const idParam = z.object({ id });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const qty = z.number().int().min(1).max(1e12);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currency = z.enum(['IQD', 'USD']);
const lang = z.enum(['ar', 'en', 'ku']).optional();
const docBody = z.object({
  kind: z.enum(['receipt', 'return']), date, supplierId: id, warehouseId: id, rateX100: z.number().int().positive().max(1e9).optional(),
  notes: z.string().max(500).optional(),
  lines: z.array(z.object({
    itemId: id, qtyMilli: qty.optional(), unitCost: money.optional(), unit: z.enum(UNIT_CODES).optional(), unitQtyMilli: qty.optional(),
    batchNo: z.string().max(MAX_BATCH_NO * 2).optional(), expiry: date.optional(), batchId: id.optional()
  })).min(1).max(2000)
});

/** The books' side of consignment (costs, what is owed) is for those who see the books. */
function readable(actor: Actor): Actor {
  if (!seesBooks(actor)) throw new AppError(403, 'forbidden', { need: 'purchases' });
  return actor;
}

export const consignmentApi: ApiExtension = {
  rules: {
    'PUT /api/consignment/items/:id': 'purchases',
    'POST /api/consignment/items/:id/end': 'purchases',
    'POST /api/consignment/docs': 'stock',
    'PUT /api/consignment/docs/:id': 'stock',
    'DELETE /api/consignment/docs/:id': 'stock',
    'POST /api/consignment/docs/:id/post': 'stock',
    'POST /api/consignment/docs/:id/cancel': 'stock',
    'POST /api/consignment/settlements': 'purchases',
    'POST /api/consignment/settlements/:id/cancel': 'purchases'
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      {
        method: 'GET', path: '/api/consignment',
        handler: async (req) => { readable(actor(req)); return { available: consignmentAvailable(db), suppliers: consignmentSuppliers(db) }; }
      },
      {
        method: 'GET', path: '/api/consignment/items',
        handler: async (req) => {
          readable(actor(req));
          const f = parse(z.object({ supplierId: id.optional(), all: z.enum(['1', '0']).optional() }), req.query);
          return listConsignmentItems(db, { supplierId: f.supplierId, all: f.all === '1' });
        }
      },
      { method: 'GET', path: '/api/consignment/items/:id', handler: async (req) => { readable(actor(req)); return getConsignmentItem(db, parse(idParam, req.params).id); } },
      {
        method: 'PUT', path: '/api/consignment/items/:id',
        handler: async (req) => setConsignmentItem(db, parse(idParam, req.params).id, parse(z.object({ supplierId: id, currency, unitCost: money }), req.body), actor(req))
      },
      { method: 'POST', path: '/api/consignment/items/:id/end', handler: async (req) => endConsignmentItem(db, parse(idParam, req.params).id, actor(req)) },
      {
        method: 'GET', path: '/api/consignment/docs',
        handler: async (req) => {
          readable(actor(req));
          const f = parse(z.object({
            supplierId: id.optional(), kind: z.enum(['receipt', 'return']).optional(), status: z.enum(['draft', 'posted', 'cancelled']).optional(),
            limit: z.coerce.number().int().min(1).max(1000).optional()
          }), req.query);
          return listConsignmentDocs(db, f);
        }
      },
      { method: 'GET', path: '/api/consignment/docs/:id', handler: async (req) => { readable(actor(req)); return getConsignmentDoc(db, parse(idParam, req.params).id); } },
      {
        method: 'POST', path: '/api/consignment/docs',
        handler: async (req, reply) => {
          const body = parse(docBody, req.body);
          const who = actor(req);
          reply.status(201).send(onceOnly(db, req, reply, who, 'POST /api/consignment/docs', () => { const made = createConsignmentDoc(db, body, who); return { id: made.id, result: made }; }, (doc) => getConsignmentDoc(db, doc)));
          return undefined;
        }
      },
      { method: 'PUT', path: '/api/consignment/docs/:id', handler: async (req) => updateConsignmentDoc(db, parse(idParam, req.params).id, parse(docBody, req.body), actor(req)) },
      {
        method: 'DELETE', path: '/api/consignment/docs/:id',
        handler: async (req, reply) => { deleteConsignmentDoc(db, parse(idParam, req.params).id, actor(req)); reply.status(204).send(); return undefined; }
      },
      {
        method: 'POST', path: '/api/consignment/docs/:id/post',
        handler: async (req, reply) => {
          const { id: docId } = parse(idParam, req.params);
          const l = parse(z.object({ lang }), req.body ?? {}).lang;
          const who = actor(req);
          return onceOnly(db, req, reply, who, 'POST /api/consignment/docs/:id/post', () => { const posted = postConsignmentDoc(db, docId, who, l); return { id: posted.id, result: posted }; }, (doc) => getConsignmentDoc(db, doc));
        }
      },
      {
        method: 'POST', path: '/api/consignment/docs/:id/cancel',
        handler: async (req) => cancelConsignmentDoc(db, parse(idParam, req.params).id, actor(req), parse(z.object({ date: date.optional() }), req.body ?? {}).date)
      },
      {
        method: 'GET', path: '/api/consignment/settlements',
        handler: async (req) => { readable(actor(req)); return listSettlements(db, parse(z.object({ supplierId: id.optional() }), req.query)); }
      },
      {
        method: 'GET', path: '/api/consignment/settlements/preview',
        handler: async (req) => {
          readable(actor(req));
          const q = parse(z.object({ supplierId: id, currency, date }), req.query);
          return settlementPreview(db, q.supplierId, q.currency, q.date);
        }
      },
      { method: 'GET', path: '/api/consignment/settlements/:id', handler: async (req) => { readable(actor(req)); return getSettlement(db, parse(idParam, req.params).id); } },
      {
        method: 'POST', path: '/api/consignment/settlements',
        handler: async (req, reply) => {
          const body = parse(z.object({ supplierId: id, currency, date, rateX100: z.number().int().positive().max(1e9).optional(), notes: z.string().max(500).optional(), lang }), req.body);
          const who = actor(req);
          reply.status(201).send(onceOnly(db, req, reply, who, 'POST /api/consignment/settlements', () => { const made = createSettlement(db, body, who); return { id: made.id, result: made }; }, (s) => getSettlement(db, s)));
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/consignment/settlements/:id/cancel',
        handler: async (req) => cancelSettlement(db, parse(idParam, req.params).id, actor(req), parse(z.object({ date: date.optional() }), req.body ?? {}).date)
      },
      {
        method: 'GET', path: '/api/consignment/statement/:id',
        handler: async (req) => {
          readable(actor(req));
          const q = parse(z.object({ from: date.optional(), to: date.optional() }), req.query);
          return consignmentStatement(db, parse(idParam, req.params).id, q);
        }
      }
    ];
  }
};
