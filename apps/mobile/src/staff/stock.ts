import type { Names } from '../api';
import { isPending, type OutboxItem } from '../outbox';
import type { BarcodeHit, OrderDetail } from './api';

/**
 * Moving stock between warehouses and receiving goods against a purchase order, as the phone builds them from what was
 * scanned: lines of items and base quantities (thousandths), checked here as the office will check them, and the
 * bodies the office takes (the phone link refuses anything else: pro/src/phone/staff-routes.ts).
 */

/** A line of stock moved or received: the item, and its quantity in base units (thousandths). */
export interface StockLine {
  item: { id: string; code: string; name: Names; unit: string; trackStock?: boolean | undefined };
  qtyMilli: number;
}

/** The most of one item on a line (as the office takes it), and the most lines. */
export const MAX_LINE_QTY_MILLI = 1_000_000_000_000;
export const MAX_LINES = 300;

/** The same item again adds to its line; a new one goes on top. */
export function addStockLine(lines: StockLine[], item: StockLine['item'], qtyMilli: number): StockLine[] {
  if (!Number.isSafeInteger(qtyMilli) || qtyMilli <= 0) return lines;
  const existing = lines.find((l) => l.item.id === item.id);
  if (existing) return lines.map((l) => (l.item.id === item.id ? { ...l, qtyMilli: Math.min(MAX_LINE_QTY_MILLI, l.qtyMilli + qtyMilli) } : l));
  return [{ item, qtyMilli: Math.min(MAX_LINE_QTY_MILLI, qtyMilli) }, ...lines];
}

/** A line's quantity set again (a stepper, a typed number): the line goes when it comes to nothing. */
export function setStockLine(lines: StockLine[], itemId: string, qtyMilli: number): StockLine[] {
  if (!Number.isSafeInteger(qtyMilli) || qtyMilli <= 0) return lines.filter((l) => l.item.id !== itemId);
  return lines.map((l) => (l.item.id === itemId ? { ...l, qtyMilli: Math.min(MAX_LINE_QTY_MILLI, qtyMilli) } : l));
}

/** What a scan counts: one of the item's base unit, or a whole unit (a box) when its own barcode was scanned. */
export function scannedQtyMilli(hit: BarcodeHit, count = 1): number {
  const unit = hit.unit ? hit.item?.units?.find((u) => u.unit === hit.unit) : undefined;
  const per = unit && Number.isSafeInteger(unit.factorMilli) && unit.factorMilli > 0 ? unit.factorMilli : 1000;
  return per * count;
}

/** Whole units of `factorMilli` (a box of 12 is 12,000) in a base quantity, or null when it is not whole. */
export function wholeUnits(qtyMilli: number, factorMilli: number | null | undefined): number | null {
  if (!factorMilli || factorMilli <= 0 || qtyMilli <= 0 || qtyMilli % factorMilli !== 0) return null;
  return qtyMilli / factorMilli;
}

// ——— a transfer between warehouses ———

export interface TransferInput { date: string; from: string; to: string; notes: string; lines: StockLine[] }

/** Why a transfer can't go yet: no lines, the same warehouse twice, a service (it does not move in stock). */
export function transferProblem(t: Pick<TransferInput, 'from' | 'to' | 'lines'>): 'empty' | 'same_warehouse' | 'service' | null {
  if (!t.lines.length) return 'empty';
  if (!t.from || !t.to || t.from === t.to) return 'same_warehouse';
  if (t.lines.some((l) => l.item.trackStock === false)) return 'service';
  return null;
}

/** A draft transfer for the office: the warehouses, the day, and items with their base quantities, nothing else. */
export function transferBody(t: TransferInput) {
  const problem = transferProblem(t);
  if (problem) throw new Error(problem);
  return {
    kind: 'transfer' as const, date: t.date, warehouseId: t.from, toWarehouseId: t.to, notes: t.notes.slice(0, 1000),
    lines: t.lines.slice(0, MAX_LINES).map((l) => ({ itemId: l.item.id, qtyMilli: l.qtyMilli }))
  };
}

/** More than the warehouse it leaves holds (the office refuses it at posting, with what is there). */
export const moreThanThere = (qtyMilli: number, inWarehouse: number) => qtyMilli > Math.max(0, inWarehouse);

// ——— goods received against a purchase order ———

/** Whether an order can take what arrived now: sent or partly received, something still to come, no draft receipt waiting. */
export function receivable(order: Pick<OrderDetail, 'status' | 'lines' | 'receipts'>): 'ok' | 'pending' | 'closed' {
  if (order.status !== 'sent' && order.status !== 'partial') return 'closed';
  if (order.receipts.some((r) => r.status === 'draft')) return 'pending';
  return order.lines.some((l) => l.remainingMilli > 0) ? 'ok' : 'closed';
}

/** What is still to come of an item, over all the order's lines (null: the item is not on the order). */
export function toComeOf(order: Pick<OrderDetail, 'lines'>, itemId: string): number | null {
  const lines = order.lines.filter((l) => l.itemId === itemId);
  return lines.length ? lines.reduce((s, l) => s + Math.max(0, l.remainingMilli), 0) : null;
}

/** Whether `qtyMilli` more of an item can be taken, with what is on the list already: as the office will answer. */
export function arrivalProblem(order: Pick<OrderDetail, 'lines'>, lines: StockLine[], itemId: string, qtyMilli: number):
  { code: 'po_line_unknown' } | { code: 'po_over_remaining'; remaining: number } | null {
  const remaining = toComeOf(order, itemId);
  if (remaining === null) return { code: 'po_line_unknown' };
  const already = lines.filter((l) => l.item.id === itemId).reduce((s, l) => s + l.qtyMilli, 0);
  return already + qtyMilli > remaining ? { code: 'po_over_remaining', remaining } : null;
}

/**
 * What arrived, for the office (a draft purchase invoice at the order's prices): dated the day it was scanned (an
 * arrival that waits in the outbox keeps it), with a warehouse only when the order names none.
 */
export function arrivalBody(a: { date: string; order: Pick<OrderDetail, 'warehouse'>; lines: StockLine[]; warehouseId: string | null }) {
  if (!a.lines.length) throw new Error('empty');
  return {
    date: a.date,
    ...(a.order.warehouse || !a.warehouseId ? {} : { warehouseId: a.warehouseId }),
    lines: a.lines.slice(0, MAX_LINES).map((l) => ({ itemId: l.item.id, qtyMilli: l.qtyMilli }))
  };
}

/** One arrival per order in the outbox: one for this order still waits to be sent (not refused, not sent). */
export const arrivalWaiting = (outbox: readonly OutboxItem[], orderId: string) =>
  outbox.some((i) => i.kind === 'arrival' && i.target === orderId && isPending(i));
