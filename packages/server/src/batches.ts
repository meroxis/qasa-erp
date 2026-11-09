import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  addDays, daysBetween, DEFAULT_NEAR_EXPIRY_DAYS, EXPIRED_SALES_POLICIES, expiryState, isExpired, MAX_BATCH_NO, normalizeBatchNo, normalizeExpiry, pickFefo,
  returnToBatches, roundHalfUp, todayIso, type BatchStock, type ExpiredSalesPolicy, type Names, type UnitCode
} from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { readSetting, writeSetting } from './settings.ts';
import { userBranchLists } from './branches.ts';
import type { Actor } from './auth.ts';
import type { ApiExtension } from './routes.ts';
import { createAdjustment } from './adjustments.ts';

/**
 * Batches and expiry dates (every plan). An item that tracks batches keeps its quantity per batch number beside its
 * stock moves: stock_batch_moves holds quantity only, the value stays the item's average cost per warehouse. Every
 * batch move is written here, in the same transaction as the stock move it goes with, so for a tracked item the batch
 * quantities of a warehouse always add up to its stock (from the time tracking was switched on).
 */

export type BatchPurpose = 'sale' | 'other';

export interface BatchSettings { nearExpiryDays: number; expiredSales: ExpiredSalesPolicy; defaultTrackExpiry: boolean }

export function batchSettings(db: Db): BatchSettings {
  const days = Number(readSetting(db, 'near_expiry_days') ?? DEFAULT_NEAR_EXPIRY_DAYS);
  const policy = readSetting(db, 'expired_sales');
  return {
    nearExpiryDays: Number.isSafeInteger(days) && days >= 1 && days <= 730 ? days : DEFAULT_NEAR_EXPIRY_DAYS,
    expiredSales: (EXPIRED_SALES_POLICIES as readonly string[]).includes(policy ?? '') ? policy as ExpiredSalesPolicy : 'block',
    defaultTrackExpiry: readSetting(db, 'default_track_expiry') === '1'
  };
}

export function updateBatchSettings(db: Db, patch: Partial<BatchSettings>, user: string): BatchSettings {
  const errors: { code: string; field: string }[] = [];
  if (patch.nearExpiryDays !== undefined && (!Number.isSafeInteger(patch.nearExpiryDays) || patch.nearExpiryDays < 1 || patch.nearExpiryDays > 730)) errors.push({ code: 'value_invalid', field: 'nearExpiryDays' });
  if (patch.expiredSales !== undefined && !(EXPIRED_SALES_POLICIES as readonly string[]).includes(patch.expiredSales)) errors.push({ code: 'value_invalid', field: 'expiredSales' });
  if (errors.length) throw invalid(errors);
  transaction(db, () => {
    if (patch.nearExpiryDays !== undefined) writeSetting(db, 'near_expiry_days', String(patch.nearExpiryDays));
    if (patch.expiredSales !== undefined) writeSetting(db, 'expired_sales', patch.expiredSales);
    if (patch.defaultTrackExpiry !== undefined) writeSetting(db, 'default_track_expiry', patch.defaultTrackExpiry ? '1' : '0');
    audit(db, user, 'update', 'settings', 'batches', patch);
  });
  return batchSettings(db);
}

/** Whether an item keeps its stock per batch, and asks for an expiry date on the way in. */
export function batchTracking(db: Db, itemId: string): { batches: boolean; expiry: boolean } {
  const r = db.prepare('SELECT track_batches, track_expiry, track_stock FROM items WHERE id = ?').get(itemId) as { track_batches: number; track_expiry: number; track_stock: number } | undefined;
  if (!r || Number(r.track_stock) !== 1) return { batches: false, expiry: false };
  return { batches: Number(r.track_batches) === 1, expiry: Number(r.track_expiry) === 1 };
}

export interface BatchRow { id: string; number: string; expiry: string | null; createdAt: string }

/**
 * The batch of an item with this number (made the first time it comes in). The same number with another expiry date
 * is refused: one number means one expiry. '' is the batch of stock with no number.
 */
export function ensureBatch(db: Db, itemId: string, numberRaw: string, expiryRaw: string | null, line?: number): string {
  const number = normalizeBatchNo(numberRaw);
  const expiry = normalizeExpiry(expiryRaw);
  if (expiry === 'invalid') throw invalid([{ code: 'expiry_invalid', ...(line ? { line } : {}) }]);
  const found = db.prepare('SELECT id, expiry FROM item_batches WHERE item_id = ? AND number = ?').get(itemId, number) as { id: string; expiry: string | null } | undefined;
  if (found) {
    // a batch with no number keeps whatever came first; a numbered one keeps one expiry date
    if (number && (found.expiry ?? null) !== expiry && expiry !== null) throw invalid([{ code: 'batch_expiry_differs', ...(line ? { line } : {}), expiry: found.expiry ?? '' }]);
    if (number && found.expiry === null && expiry !== null) db.prepare('UPDATE item_batches SET expiry = ? WHERE id = ?').run(expiry, found.id);
    return found.id;
  }
  const id = randomUUID();
  db.prepare('INSERT INTO item_batches (id, item_id, number, expiry, created_at) VALUES (?, ?, ?, ?, ?)').run(id, itemId, number, expiry, new Date().toISOString());
  return id;
}

/** What each batch of an item holds in a warehouse (batches with nothing left included only when `withEmpty`). */
export function batchStock(db: Db, itemId: string, warehouseId: string, withEmpty = false): (BatchStock & { number: string })[] {
  const rows = db.prepare(`SELECT b.id, b.number, b.expiry, b.created_at, COALESCE(SUM(m.qty_milli), 0) AS qty
                           FROM item_batches b JOIN stock_batch_moves m ON m.batch_id = b.id AND m.warehouse_id = ?
                           WHERE b.item_id = ? GROUP BY b.id, b.number, b.expiry, b.created_at`).all(warehouseId, itemId) as
    { id: string; number: string; expiry: string | null; created_at: string; qty: number }[];
  return rows.map((r) => ({ id: r.id, number: r.number, expiry: r.expiry, createdAt: r.created_at, qtyMilli: Number(r.qty) }))
    .filter((r) => withEmpty || r.qtyMilli !== 0);
}

export interface BatchPick { batchId: string; qtyMilli: number }
export type BatchError = { code: 'batch_insufficient' | 'batch_expired' | 'batch_invalid'; line: number; available: number; batch?: string; expiry?: string };

/**
 * Batches for `qtyMilli` going out of a warehouse: the pinned batch, else earliest expiry first. A sale under the
 * 'block' policy never takes expired stock; under 'warn' only with `allowExpired` (the user confirmed). Everything else
 * (a write-off, a return to the supplier, a transfer, a count) may take expired stock.
 */
export function allocateOut(
  db: Db,
  a: { itemId: string; warehouseId: string; qtyMilli: number; date: string; line: number; purpose: BatchPurpose; allowExpired?: boolean; pinned?: string | null },
  taken: Map<string, number> = new Map()
): { picks: BatchPick[]; usedExpired: boolean } | BatchError {
  const policy = batchSettings(db).expiredSales;
  const sale = a.purpose === 'sale';
  // what earlier lines of the same document took already
  const stock = batchStock(db, a.itemId, a.warehouseId).map((b) => ({ ...b, qtyMilli: b.qtyMilli - (taken.get(b.id) ?? 0) }));
  if (a.pinned) {
    const b = stock.find((x) => x.id === a.pinned);
    const owned = db.prepare('SELECT expiry, number FROM item_batches WHERE id = ? AND item_id = ?').get(a.pinned, a.itemId) as { expiry: string | null; number: string } | undefined;
    if (!owned) return { code: 'batch_invalid', line: a.line, available: 0 };
    const expired = isExpired(owned.expiry, a.date);
    if (expired && sale && (policy === 'block' || !a.allowExpired)) {
      return { code: 'batch_expired', line: a.line, available: Math.max(0, b?.qtyMilli ?? 0), batch: owned.number, expiry: owned.expiry ?? '' };
    }
    if (!b || b.qtyMilli < a.qtyMilli) return { code: 'batch_insufficient', line: a.line, available: Math.max(0, b?.qtyMilli ?? 0), batch: owned.number };
    return { picks: [{ batchId: b.id, qtyMilli: a.qtyMilli }], usedExpired: expired };
  }
  const r = sale ? pickFefo(stock, a.qtyMilli, a.date, policy, !!a.allowExpired) : pickFefo(stock, a.qtyMilli, a.date, 'warn', true);
  if (!r.ok) {
    const firstExpired = fefoExpired(stock, a.date);
    return { code: r.code, line: a.line, available: r.availableMilli, ...(r.code === 'batch_expired' && firstExpired ? { batch: firstExpired.number, expiry: firstExpired.expiry ?? '' } : {}) };
  }
  return { picks: r.picks.map((p) => ({ batchId: p.id, qtyMilli: p.qtyMilli })), usedExpired: r.usedExpired };
}

const fefoExpired = (stock: (BatchStock & { number: string })[], date: string) =>
  stock.filter((b) => b.qtyMilli > 0 && isExpired(b.expiry, date)).sort((x, y) => (x.expiry ?? '') < (y.expiry ?? '') ? -1 : 1)[0];

export interface BatchMove { batchId: string; itemId: string; warehouseId: string; qtyMilli: number; lineNo: number | null }

export function writeBatchMoves(db: Db, moves: readonly BatchMove[], date: string, sourceType: string, sourceId: string): void {
  const insert = db.prepare(`INSERT INTO stock_batch_moves (batch_id, item_id, warehouse_id, date, qty_milli, source_type, source_id, line_no, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const now = new Date().toISOString();
  for (const m of moves) if (m.qtyMilli !== 0) insert.run(m.batchId, m.itemId, m.warehouseId, date, m.qtyMilli, sourceType, sourceId, m.lineNo, now);
}

/** The batch moves a document made (to undo them, or to know which batches a line took). */
export function batchMovesOf(db: Db, sourceType: string, sourceId: string): BatchMove[] {
  return (db.prepare('SELECT batch_id, item_id, warehouse_id, qty_milli, line_no FROM stock_batch_moves WHERE source_type = ? AND source_id = ? ORDER BY id')
    .all(sourceType, sourceId) as { batch_id: string; item_id: string; warehouse_id: string; qty_milli: number; line_no: number | null }[])
    .map((r) => ({ batchId: r.batch_id, itemId: r.item_id, warehouseId: r.warehouse_id, qtyMilli: Number(r.qty_milli), lineNo: r.line_no === null ? null : Number(r.line_no) }));
}

/**
 * Before a document is cancelled: what it put into batches must still be there to come out again (the goods from that
 * purchase may have been sold already). Errors name the line.
 */
export function assertReversible(db: Db, sourceType: string, sourceId: string): void {
  const moves = batchMovesOf(db, sourceType, sourceId).filter((m) => m.qtyMilli > 0);
  const need = new Map<string, { qty: number; line: number; itemId: string; warehouseId: string }>();
  for (const m of moves) {
    const k = `${m.batchId}|${m.warehouseId}`;
    const e = need.get(k) ?? { qty: 0, line: m.lineNo ?? 0, itemId: m.itemId, warehouseId: m.warehouseId };
    e.qty += m.qtyMilli;
    need.set(k, e);
  }
  const errors: BatchError[] = [];
  for (const [k, e] of need) {
    const batchId = k.split('|')[0]!;
    const have = batchStock(db, e.itemId, e.warehouseId).find((b) => b.id === batchId)?.qtyMilli ?? 0;
    if (have < e.qty) {
      const number = (db.prepare('SELECT number FROM item_batches WHERE id = ?').get(batchId) as { number: string } | undefined)?.number ?? '';
      errors.push({ code: 'batch_insufficient', line: e.line, available: Math.max(0, have), batch: number });
    }
  }
  if (errors.length) throw invalid(errors);
}

/** Cancelling a document: the negation of every batch move it made, as `<type>_cancel`. */
export function reverseBatchMoves(db: Db, sourceType: string, sourceId: string, date: string): void {
  const moves = batchMovesOf(db, sourceType, sourceId).map((m) => ({ ...m, qtyMilli: -m.qtyMilli }));
  writeBatchMoves(db, moves, date, `${sourceType}_cancel`, sourceId);
}

/**
 * Switching batches on for an item that has stock: what is not in a batch yet goes into its '' batch (no number, no
 * expiry), per warehouse, so the batches add up to the stock from now on. Switching it on again after a while off
 * does the same with the difference (what left meanwhile comes out earliest expiry first).
 */
export function startTracking(db: Db, itemId: string, date = todayIso()): void {
  const stock = db.prepare('SELECT warehouse_id, SUM(qty_milli) AS qty FROM stock_moves WHERE item_id = ? GROUP BY warehouse_id').all(itemId) as { warehouse_id: string; qty: number }[];
  const inBatches = new Map((db.prepare('SELECT warehouse_id, SUM(qty_milli) AS qty FROM stock_batch_moves WHERE item_id = ? GROUP BY warehouse_id').all(itemId) as
    { warehouse_id: string; qty: number }[]).map((r) => [r.warehouse_id, Number(r.qty)]));
  const moves: BatchMove[] = [];
  for (const s of stock) {
    const diff = Number(s.qty) - (inBatches.get(s.warehouse_id) ?? 0);
    if (diff > 0) moves.push({ batchId: ensureBatch(db, itemId, '', null), itemId, warehouseId: s.warehouse_id, qtyMilli: diff, lineNo: null });
    else if (diff < 0) {
      const r = pickFefo(batchStock(db, itemId, s.warehouse_id), -diff, date, 'warn', true);
      if (r.ok) for (const p of r.picks) moves.push({ batchId: p.id, itemId, warehouseId: s.warehouse_id, qtyMilli: -p.qtyMilli, lineNo: null });
    }
  }
  writeBatchMoves(db, moves, date, 'batch_start', itemId);
}

/** For the tests and the checks: the batch total and the stock of a tracked item in a warehouse. */
export function batchBalance(db: Db, itemId: string, warehouseId: string): { batches: number; stock: number } {
  const b = db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_batch_moves WHERE item_id = ? AND warehouse_id = ?').get(itemId, warehouseId) as { q: number };
  const s = db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE item_id = ? AND warehouse_id = ?').get(itemId, warehouseId) as { q: number };
  return { batches: Number(b.q), stock: Number(s.q) };
}

// ——— inbound and outbound lines ———

/** A line coming in: its batch number and expiry (normalized), checked against the item's tracking. */
export function inboundBatch(db: Db, itemId: string, line: { batchNo?: string | null | undefined; expiry?: string | null | undefined }, lineNo: number, date: string): { batchId: string } | null {
  const t = batchTracking(db, itemId);
  if (!t.batches) return null;
  const expiry = normalizeExpiry(line.expiry ?? null);
  if (expiry === 'invalid') throw invalid([{ code: 'expiry_invalid', line: lineNo }]);
  if (t.expiry && !expiry) throw invalid([{ code: 'expiry_required', line: lineNo }]);
  // (an expiry before the document's date is allowed: expired goods can come in, to go back to the supplier)
  void date;
  return { batchId: ensureBatch(db, itemId, line.batchNo ?? '', expiry, lineNo) };
}

/** Checks a line's batch fields as typed on a draft: a number of at most 40, a real date, a batch of that item. */
export function lineBatchErrors(db: Db, itemId: string, line: { batchNo?: string | null | undefined; expiry?: string | null | undefined; batchId?: string | null | undefined }, lineNo: number): { code: string; line: number }[] {
  const errors: { code: string; line: number }[] = [];
  if (line.batchNo && normalizeBatchNo(line.batchNo).length > MAX_BATCH_NO) errors.push({ code: 'batch_no_invalid', line: lineNo });
  if (line.expiry && normalizeExpiry(line.expiry) === 'invalid') errors.push({ code: 'expiry_invalid', line: lineNo });
  if (line.batchId && !db.prepare('SELECT 1 FROM item_batches WHERE id = ? AND item_id = ?').get(line.batchId, itemId)) errors.push({ code: 'batch_invalid', line: lineNo });
  return errors;
}

/** The batch fields a draft line keeps: NULL when empty. */
export function batchColumns(line: { batchNo?: string | null | undefined; expiry?: string | null | undefined; batchId?: string | null | undefined }): [string | null, string | null, string | null] {
  const number = normalizeBatchNo(line.batchNo ?? '');
  const expiry = normalizeExpiry(line.expiry ?? null);
  return [number || null, expiry === 'invalid' ? null : expiry, line.batchId || null];
}

/**
 * A sale return: back into the batches the original line took, the last taken first, less what earlier returns of
 * the same line put back already.
 */
export function saleReturnPicks(db: Db, originalId: string, sourceLine: number, qtyMilli: number): BatchPick[] {
  const taken = (db.prepare("SELECT batch_id, qty_milli FROM stock_batch_moves WHERE source_type = 'sale' AND source_id = ? AND line_no = ? ORDER BY id")
    .all(originalId, sourceLine) as { batch_id: string; qty_milli: number }[]).map((r) => ({ id: r.batch_id, qtyMilli: -Number(r.qty_milli) }));
  if (!taken.length) return [];
  const back = new Map((db.prepare(`SELECT m.batch_id, SUM(m.qty_milli) AS qty FROM stock_batch_moves m
                                    JOIN invoices r ON r.id = m.source_id
                                    JOIN invoice_lines rl ON rl.invoice_id = r.id AND rl.line_no = m.line_no
                                    WHERE m.source_type = 'sale_return' AND r.return_of = ? AND r.status = 'posted' AND rl.source_line = ?
                                    GROUP BY m.batch_id`).all(originalId, sourceLine) as { batch_id: string; qty: number }[]).map((r) => [r.batch_id, Number(r.qty)]));
  return returnToBatches(taken, back, qtyMilli).map((p) => ({ batchId: p.id, qtyMilli: p.qtyMilli }));
}

/** A purchase return: from the batch(es) the purchase line brought in; refused when they no longer hold enough. */
export function purchaseReturnPicks(db: Db, originalId: string, sourceLine: number, warehouseId: string, itemId: string, qtyMilli: number, lineNo: number, taken: Map<string, number>): BatchPick[] | BatchError {
  const brought = (db.prepare("SELECT batch_id, SUM(qty_milli) AS qty FROM stock_batch_moves WHERE source_type = 'purchase' AND source_id = ? AND line_no = ? GROUP BY batch_id")
    .all(originalId, sourceLine) as { batch_id: string; qty: number }[]);
  if (!brought.length) {
    // bought before batches were tracked: as any other outbound line
    const r = allocateOut(db, { itemId, warehouseId, qtyMilli, date: todayIso(), line: lineNo, purpose: 'other' }, taken);
    return 'code' in r ? r : r.picks;
  }
  const stock = new Map(batchStock(db, itemId, warehouseId).map((b) => [b.id, b.qtyMilli - (taken.get(b.id) ?? 0)]));
  const picks: BatchPick[] = [];
  let rest = qtyMilli;
  for (const b of brought) {
    if (rest <= 0) break;
    const take = Math.min(rest, Math.max(0, stock.get(b.batch_id) ?? 0));
    if (take > 0) picks.push({ batchId: b.batch_id, qtyMilli: take });
    rest -= take;
  }
  if (rest > 0) {
    const number = (db.prepare('SELECT number FROM item_batches WHERE id = ?').get(brought[0]!.batch_id) as { number: string } | undefined)?.number ?? '';
    return { code: 'batch_insufficient', line: lineNo, available: qtyMilli - rest, batch: number };
  }
  return picks;
}

export const addTaken = (taken: Map<string, number>, picks: readonly BatchPick[]) => {
  for (const p of picks) taken.set(p.batchId, (taken.get(p.batchId) ?? 0) + p.qtyMilli);
};

// ——— reports ———

export interface BatchReportRow {
  itemId: string; itemCode: string; itemName: Names; unit: UnitCode;
  batchId: string; batch: string; expiry: string | null;
  warehouseId: string; warehouseCode: string; warehouseName: Names;
  qtyMilli: number;
  /** IQD: the quantity at the item's average cost in that warehouse */
  value: number;
  /** days until the expiry date (negative: past it); null: no expiry */
  daysLeft: number | null;
  state: 'expired' | 'near' | 'ok' | null;
}

export interface BatchReportFilter { itemId?: string | undefined; warehouseId?: string | undefined; state?: 'expired' | 'near' | 'all' | undefined; pharmacyOnly?: boolean | undefined }

/** Batches with stock, earliest expiry first: per item, batch and warehouse (only `warehouses` when given). */
export function batchReport(db: Db, f: BatchReportFilter = {}, warehouses: readonly string[] | null = null, today = todayIso()): BatchReportRow[] {
  const where: string[] = [];
  const params: string[] = [];
  if (f.itemId) { where.push('b.item_id = ?'); params.push(f.itemId); }
  if (f.warehouseId) { where.push('m.warehouse_id = ?'); params.push(f.warehouseId); }
  if (warehouses) where.push(`m.warehouse_id IN (${warehouses.length ? warehouses.map(() => '?').join(', ') : 'NULL'})`), params.push(...warehouses);
  if (f.pharmacyOnly) where.push('EXISTS (SELECT 1 FROM pharma_details pd WHERE pd.item_id = b.item_id)');
  const { nearExpiryDays } = batchSettings(db);
  if (f.state === 'expired') { where.push('b.expiry IS NOT NULL AND b.expiry < ?'); params.push(today); }
  if (f.state === 'near') { where.push('b.expiry IS NOT NULL AND b.expiry >= ? AND b.expiry <= ?'); params.push(today, addDays(today, nearExpiryDays)); }
  const rows = db.prepare(`SELECT b.id AS batch_id, b.number, b.expiry, b.item_id, i.code, i.name_ar, i.name_en, i.name_ku, i.unit,
                                  m.warehouse_id, w.code AS w_code, w.name_ar AS w_ar, w.name_en AS w_en, w.name_ku AS w_ku, SUM(m.qty_milli) AS qty
                           FROM stock_batch_moves m JOIN item_batches b ON b.id = m.batch_id JOIN items i ON i.id = b.item_id JOIN warehouses w ON w.id = m.warehouse_id
                           ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                           GROUP BY b.id, b.number, b.expiry, b.item_id, i.code, i.name_ar, i.name_en, i.name_ku, i.unit, m.warehouse_id, w.code, w.name_ar, w.name_en, w.name_ku
                           HAVING SUM(m.qty_milli) <> 0
                           ORDER BY CASE WHEN b.expiry IS NULL THEN 1 ELSE 0 END, b.expiry, i.code, b.number`).all(...params) as {
    batch_id: string; number: string; expiry: string | null; item_id: string; code: string; name_ar: string; name_en: string; name_ku: string; unit: UnitCode;
    warehouse_id: string; w_code: string; w_ar: string; w_en: string; w_ku: string; qty: number;
  }[];
  const avg = new Map<string, { qty: number; value: number }>();
  const avgOf = (itemId: string, warehouseId: string) => {
    const k = `${itemId}|${warehouseId}`;
    if (!avg.has(k)) {
      const s = db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q, COALESCE(SUM(value), 0) AS v FROM stock_moves WHERE item_id = ? AND warehouse_id = ?').get(itemId, warehouseId) as { q: number; v: number };
      avg.set(k, { qty: Number(s.q), value: Number(s.v) });
    }
    return avg.get(k)!;
  };
  return rows.map((r) => {
    const s = avgOf(r.item_id, r.warehouse_id);
    const qty = Number(r.qty);
    return {
      itemId: r.item_id, itemCode: r.code, itemName: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, unit: r.unit,
      batchId: r.batch_id, batch: r.number, expiry: r.expiry,
      warehouseId: r.warehouse_id, warehouseCode: r.w_code, warehouseName: { ar: r.w_ar, en: r.w_en, ku: r.w_ku },
      qtyMilli: qty, value: s.qty > 0 ? roundHalfUp((s.value * qty) / s.qty) : 0,
      daysLeft: r.expiry ? daysBetween(today, r.expiry) : null,
      state: expiryState(r.expiry, today, nearExpiryDays)
    };
  });
}

/** For the morning brief: how many batches with stock are past their date or near it (only when some item tracks expiry). */
export function expiryAlert(db: Db, today: string, warehouses: readonly string[] | null = null): { expired: number; near: number; days: number; top: BatchReportRow[] } | null {
  if (!db.prepare('SELECT 1 FROM items WHERE track_expiry = 1 AND active = 1 LIMIT 1').get()) return null;
  const rows = batchReport(db, {}, warehouses, today).filter((r) => r.qtyMilli > 0 && (r.state === 'expired' || r.state === 'near'));
  return {
    expired: rows.filter((r) => r.state === 'expired').length,
    near: rows.filter((r) => r.state === 'near').length,
    days: batchSettings(db).nearExpiryDays,
    top: rows.slice(0, 5)
  };
}

/** Fixes a batch's number or expiry date, while nothing has gone out of it yet. */
export function updateBatch(db: Db, id: string, input: { number?: string | undefined; expiry?: string | null | undefined }, user: string): BatchRow {
  const b = db.prepare('SELECT id, item_id, number, expiry, created_at FROM item_batches WHERE id = ?').get(id) as { id: string; item_id: string; number: string; expiry: string | null; created_at: string } | undefined;
  if (!b) throw notFound('batch');
  if (db.prepare('SELECT 1 FROM stock_batch_moves WHERE batch_id = ? AND qty_milli < 0 LIMIT 1').get(id)) throw conflict('batch_in_use');
  const number = input.number === undefined ? b.number : normalizeBatchNo(input.number);
  const expiry = input.expiry === undefined ? b.expiry : normalizeExpiry(input.expiry);
  if (expiry === 'invalid') throw invalid([{ code: 'expiry_invalid' }]);
  if (number !== b.number && db.prepare('SELECT 1 FROM item_batches WHERE item_id = ? AND number = ? AND id <> ?').get(b.item_id, number, id)) throw conflict('batch_number_taken');
  transaction(db, () => {
    db.prepare('UPDATE item_batches SET number = ?, expiry = ? WHERE id = ?').run(number, expiry, id);
    audit(db, user, 'update', 'batch', id, { before: { number: b.number, expiry: b.expiry }, after: { number, expiry } });
  });
  return { id, number, expiry, createdAt: b.created_at };
}

// ——— the API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Batches: reading is open to signed-in users (a user limited to branches sees their warehouses only); fixing a batch
 * and writing off expired stock need the stock permission. A write-off makes a DRAFT adjustment (reason "expired")
 * with its lines pinned to the batches, posted as any adjustment is.
 */
export const batchesApi: ApiExtension = {
  rules: { 'PUT /api/batches/:id': 'stock', 'POST /api/batches/write-off': 'stock', 'PUT /api/batches/settings': 'admin' },
  routes(db, { actorOf }) {
    const scope = (actor: Actor) => userBranchLists(db, actor)?.warehouses ?? null;
    return [
      { method: 'GET', path: '/api/batches/settings', handler: async () => batchSettings(db) },
      {
        method: 'PUT', path: '/api/batches/settings',
        handler: async (req) => {
          const body = parse(z.object({ nearExpiryDays: z.number().int().min(1).max(730).optional(), expiredSales: z.enum(['block', 'warn']).optional(), defaultTrackExpiry: z.boolean().optional() }), req.body);
          return updateBatchSettings(db, body, actorOf(req).name);
        }
      },
      {
        method: 'GET', path: '/api/batches',
        handler: async (req) => {
          const q = parse(z.object({ itemId: id, warehouseId: id.optional() }), req.query);
          const limited = scope(actorOf(req));
          if (q.warehouseId && limited && !limited.includes(q.warehouseId)) throw new AppError(403, 'forbidden', { need: 'branch' });
          return batchReport(db, { itemId: q.itemId, warehouseId: q.warehouseId, state: 'all' }, limited);
        }
      },
      {
        method: 'GET', path: '/api/batches/report',
        handler: async (req) => {
          const q = parse(z.object({ state: z.enum(['expired', 'near', 'all']).optional(), warehouseId: id.optional(), itemId: id.optional(), date: isoDate.optional() }), req.query);
          return { date: q.date ?? todayIso(), nearExpiryDays: batchSettings(db).nearExpiryDays, rows: batchReport(db, q, scope(actorOf(req)), q.date ?? todayIso()) };
        }
      },
      {
        method: 'PUT', path: '/api/batches/:id',
        handler: async (req) => {
          const body = parse(z.object({ number: z.string().max(MAX_BATCH_NO * 2).optional(), expiry: isoDate.nullable().optional() }), req.body);
          return updateBatch(db, parse(z.object({ id }), req.params).id, body, actorOf(req).name);
        }
      },
      {
        method: 'POST', path: '/api/batches/write-off',
        handler: async (req, reply) => {
          const body = parse(z.object({
            warehouseId: id, date: isoDate.optional(), notes: z.string().max(500).optional(),
            rows: z.array(z.object({ batchId: id, qtyMilli: z.number().int().positive().max(1e12) })).min(1).max(500)
          }), req.body);
          const actor = actorOf(req);
          const limited = scope(actor);
          if (limited && !limited.includes(body.warehouseId)) throw new AppError(403, 'forbidden', { need: 'branch' });

          const lines = body.rows.map((r, i) => {
            const b = db.prepare('SELECT item_id FROM item_batches WHERE id = ?').get(r.batchId) as { item_id: string } | undefined;
            if (!b) throw invalid([{ code: 'batch_invalid', line: i + 1 }]);
            return { itemId: b.item_id, qtyMilli: -r.qtyMilli, batchId: r.batchId };
          });
          reply.status(201).send(createAdjustment(db, { date: body.date ?? todayIso(), warehouseId: body.warehouseId, reason: 'expired', notes: body.notes, lines }, actor));
          return undefined;
        }
      }
    ];
  }
};
