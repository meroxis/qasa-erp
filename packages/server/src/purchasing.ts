import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fromBaseQty, isIsoDate, lineAmount, todayIso, UNIT_CODES, type CurrencyCode, type Names, type UnitCode } from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { createInvoice } from './invoices.ts';
import { defaultWarehouseId, userBranchLists } from './branches.ts';
import { getSettings } from './settings.ts';
import type { Actor } from './auth.ts';
import type { ApiExtension } from './routes.ts';
import { basePriceOf, resolveLines } from './item-units.ts';

/**
 * Purchase orders (أوامر الشراء). An order is written to a supplier (draft → sent), then received into purchase
 * invoices: "receive" makes a DRAFT purchase invoice for what is still to come, which the user checks and posts.
 * What has arrived is counted only from POSTED purchase invoices linked to the order (drafts and cancelled ones don't
 * count), so the status follows by itself: sent → partial → received. Purchase returns don't reopen an order.
 */

export type PoStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';
export const PO_STATUSES: readonly PoStatus[] = ['draft', 'sent', 'partial', 'received', 'cancelled'];
export type PoAction = 'edit' | 'send' | 'receive' | 'cancel' | 'reopen';

export interface PoLineInput {
  itemId: string;
  /** base units; worked out from unitQtyMilli when the line is in one of the item's units (1.1) */
  qtyMilli?: number | undefined;
  /** per the line's own unit when it has one */
  unitPrice: number;
  unit?: UnitCode | undefined;
  unitQtyMilli?: number | undefined;
}

type PoLine = { itemId: string; qtyMilli: number; unitPrice: number; unit?: UnitCode; unitFactorMilli?: number; unitQtyMilli?: number };

export interface PoInput {
  date: string;
  partyId: string;
  warehouseId?: string | null;
  currency: CurrencyCode;
  expectedDate?: string | null;
  notes?: string;
  lines: PoLineInput[];
}

export interface PoLineView {
  seq: number;
  itemId: string;
  itemCode: string;
  itemName: Names;
  unit: string;
  qtyMilli: number;
  unitPrice: number;
  amount: number;
  receivedMilli: number;
  remainingMilli: number;
  /** 1.1: the unit the line was typed in (null: the base unit), its factor then and the quantity as typed */
  lineUnit: UnitCode | null;
  unitFactorMilli: number | null;
  unitQtyMilli: number | null;
}

export interface PoReceiptView {
  invoiceId: string;
  number: string | null;
  date: string;
  status: 'draft' | 'posted' | 'cancelled';
  total: number;
}

export interface PoView {
  id: string;
  number: string;
  date: string;
  party: { id: string; code: string; name: string; phone: string | null; address: string | null };
  warehouse: { id: string; code: string; name: Names } | null;
  currency: CurrencyCode;
  expectedDate: string | null;
  status: PoStatus;
  overdue: boolean;
  notes: string;
  total: number;
  lines: PoLineView[];
  receipts: PoReceiptView[];
  createdBy: string;
  createdAt: string;
  actions: PoAction[];
}

export interface PoSummaryView {
  id: string;
  number: string;
  date: string;
  partyId: string;
  partyName: string;
  currency: CurrencyCode;
  expectedDate: string | null;
  status: PoStatus;
  overdue: boolean;
  total: number;
}

interface PoRow {
  id: string; number: string; date: string; party_id: string; warehouse_id: string | null; currency: CurrencyCode;
  expected_date: string | null; status: PoStatus; notes: string | null; created_by: string; created_at: string; updated_at: string;
}

const MAX_QTY = 1_000_000_000_000;
const MAX_PRICE = 1_000_000_000_000_000;

function loadRow(db: Db, id: string): PoRow {
  const r = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) as PoRow | undefined;
  if (!r) throw notFound('purchase_order');
  return r;
}

interface PoLineRow { seq: number; item_id: string; qty_milli: number; unit_price: number; unit: UnitCode | null; unit_factor_milli: number | null; unit_qty_milli: number | null }

function loadLines(db: Db, id: string): PoLineRow[] {
  return db.prepare('SELECT seq, item_id, qty_milli, unit_price, unit, unit_factor_milli, unit_qty_milli FROM purchase_order_lines WHERE order_id = ? ORDER BY seq')
    .all(id) as unknown as PoLineRow[];
}

/** A line's amount: the price is per the line's unit, so it goes with the quantity typed in that unit. */
const poLineAmount = (l: PoLineRow) => lineAmount(l.unit && l.unit_qty_milli !== null ? Number(l.unit_qty_milli) : l.qty_milli, l.unit_price);

/** Quantities that arrived, per item: lines of POSTED purchase invoices linked to the order. */
function receivedByItem(db: Db, orderId: string): Map<string, number> {
  const rows = db.prepare(`
    SELECT il.item_id AS item_id, SUM(il.qty_milli) AS qty FROM purchase_order_receipts r
    JOIN invoices i ON i.id = r.invoice_id JOIN invoice_lines il ON il.invoice_id = i.id
    WHERE r.order_id = ? AND i.status = 'posted' AND i.kind = 'purchase' AND il.item_id IS NOT NULL
    GROUP BY il.item_id`).all(orderId) as { item_id: string; qty: number }[];
  return new Map(rows.map((r) => [r.item_id, Number(r.qty)]));
}

/** Spreads what arrived over the order's lines (an item may be on more than one line), first line first. */
function progress(db: Db, orderId: string): (PoLineRow & { received: number; remaining: number })[] {
  const got = receivedByItem(db, orderId);
  return loadLines(db, orderId).map((l) => {
    const left = got.get(l.item_id) ?? 0;
    const received = Math.min(left, l.qty_milli);
    got.set(l.item_id, left - received);
    return { ...l, received, remaining: l.qty_milli - received };
  });
}

function pendingDraft(db: Db, orderId: string): { id: string } | undefined {
  return db.prepare(`SELECT i.id FROM purchase_order_receipts r JOIN invoices i ON i.id = r.invoice_id WHERE r.order_id = ? AND i.status = 'draft' LIMIT 1`).get(orderId) as { id: string } | undefined;
}

function hasReceipts(db: Db, orderId: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM purchase_order_receipts r JOIN invoices i ON i.id = r.invoice_id WHERE r.order_id = ? AND i.status <> 'cancelled' LIMIT 1`).get(orderId));
}

/** The status the receipts call for (sent / partial / received); draft and cancelled are kept as they are. */
function derivedStatus(db: Db, r: PoRow): PoStatus {
  if (r.status === 'draft' || r.status === 'cancelled') return r.status;
  const lines = progress(db, r.id);
  if (lines.length && lines.every((l) => l.remaining === 0)) return 'received';
  if (lines.some((l) => l.received > 0)) return 'partial';
  return 'sent';
}

/** Brings the stored status in line with the posted receipts (an invoice may have been posted or cancelled since). */
export function syncStatus(db: Db, id: string): PoStatus {
  const r = loadRow(db, id);
  const s = derivedStatus(db, r);
  if (s !== r.status) db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?').run(s, new Date().toISOString(), id);
  return s;
}

function mayChange(actor: Actor | undefined): boolean {
  return !actor || actor.permissions.includes('purchases') || actor.permissions.includes('admin');
}

function actionsOf(db: Db, r: PoRow, remaining: number): PoAction[] {
  const pending = Boolean(pendingDraft(db, r.id));
  const received = hasReceipts(db, r.id);
  const out: PoAction[] = [];
  if ((r.status === 'draft' || r.status === 'sent') && !received) out.push('edit');
  if (r.status === 'draft') out.push('send');
  if ((r.status === 'sent' || r.status === 'partial') && remaining > 0 && !pending) out.push('receive');
  if (r.status !== 'cancelled' && r.status !== 'received' && !pending) out.push('cancel');
  if (r.status === 'cancelled') out.push('reopen');
  return out;
}

function requireAction(db: Db, r: PoRow, action: PoAction): void {
  const remaining = progress(db, r.id).reduce((s, l) => s + l.remaining, 0);
  if (!actionsOf(db, r, remaining).includes(action)) {
    if (action !== 'edit' && action !== 'send' && action !== 'reopen' && pendingDraft(db, r.id)) throw conflict('po_receipt_pending', { invoiceId: pendingDraft(db, r.id)!.id });
    throw conflict('action_not_allowed', { status: r.status, action });
  }
}

export function getPurchaseOrder(db: Db, id: string, actor?: Actor): PoView {
  syncStatus(db, id);
  const r = loadRow(db, id);
  const p = db.prepare('SELECT id, code, name, phone, address FROM parties WHERE id = ?').get(r.party_id) as PoView['party'];
  const w = r.warehouse_id ? db.prepare('SELECT id, code, name_ar, name_en, name_ku FROM warehouses WHERE id = ?').get(r.warehouse_id) as { id: string; code: string; name_ar: string; name_en: string; name_ku: string } | undefined : undefined;
  const items = new Map<string, { code: string; name: Names; unit: string }>();
  const itemOf = (itemId: string) => {
    if (!items.has(itemId)) {
      const it = db.prepare('SELECT code, name_ar, name_en, name_ku, unit FROM items WHERE id = ?').get(itemId) as { code: string; name_ar: string; name_en: string; name_ku: string; unit: string };
      items.set(itemId, { code: it.code, name: { ar: it.name_ar, en: it.name_en, ku: it.name_ku }, unit: it.unit });
    }
    return items.get(itemId)!;
  };
  const lines: PoLineView[] = progress(db, id).map((l) => {
    const it = itemOf(l.item_id);
    return {
      seq: l.seq, itemId: l.item_id, itemCode: it.code, itemName: it.name, unit: it.unit, qtyMilli: l.qty_milli, unitPrice: l.unit_price, amount: poLineAmount(l),
      receivedMilli: l.received, remainingMilli: l.remaining,
      lineUnit: l.unit ?? null, unitFactorMilli: l.unit_factor_milli === null ? null : Number(l.unit_factor_milli), unitQtyMilli: l.unit_qty_milli === null ? null : Number(l.unit_qty_milli)
    };
  });
  const receipts = db.prepare(`
    SELECT i.id, i.number, i.date, i.status, i.total FROM purchase_order_receipts r JOIN invoices i ON i.id = r.invoice_id
    WHERE r.order_id = ? ORDER BY i.date, i.created_at`).all(id) as { id: string; number: string | null; date: string; status: PoReceiptView['status']; total: number }[];
  const remaining = lines.reduce((s, l) => s + l.remainingMilli, 0);
  return {
    id: r.id, number: r.number, date: r.date, party: p,
    warehouse: w ? { id: w.id, code: w.code, name: { ar: w.name_ar, en: w.name_en, ku: w.name_ku } } : null,
    currency: r.currency, expectedDate: r.expected_date, status: r.status, overdue: isOverdue(r), notes: r.notes ?? '',
    total: lines.reduce((s, l) => s + l.amount, 0), lines,
    receipts: receipts.map((x) => ({ invoiceId: x.id, number: x.number, date: x.date, status: x.status, total: x.total })),
    createdBy: r.created_by, createdAt: r.created_at,
    actions: mayChange(actor) ? actionsOf(db, r, remaining) : []
  };
}

function isOverdue(r: { status: PoStatus; expected_date: string | null }): boolean {
  return (r.status === 'sent' || r.status === 'partial') && Boolean(r.expected_date) && r.expected_date! < todayIso();
}

export function listPurchaseOrders(db: Db, f: { status?: PoStatus | 'open'; partyId?: string; q?: string } = {}): PoSummaryView[] {
  const open = db.prepare("SELECT id FROM purchase_orders WHERE status IN ('sent', 'partial', 'received')").all() as { id: string }[];
  for (const o of open) syncStatus(db, o.id);
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.status === 'open') where.push("o.status IN ('draft', 'sent', 'partial')");
  else if (f.status) { where.push('o.status = ?'); args.push(f.status); }
  if (f.partyId) { where.push('o.party_id = ?'); args.push(f.partyId); }
  if (f.q) {
    const like = `%${f.q.toLowerCase()}%`;
    where.push("(LOWER(o.number) LIKE ? OR LOWER(p.name) LIKE ? OR LOWER(COALESCE(o.notes, '')) LIKE ?)");
    args.push(like, like, like);
  }
  const rows = db.prepare(`
    SELECT o.id, o.number, o.date, o.party_id, p.name AS party_name, o.currency, o.expected_date, o.status
    FROM purchase_orders o JOIN parties p ON p.id = o.party_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY o.date DESC, o.number DESC LIMIT 500`).all(...args) as { id: string; number: string; date: string; party_id: string; party_name: string; currency: CurrencyCode; expected_date: string | null; status: PoStatus }[];
  return rows.map((r) => ({
    id: r.id, number: r.number, date: r.date, partyId: r.party_id, partyName: r.party_name, currency: r.currency,
    expectedDate: r.expected_date, status: r.status, overdue: isOverdue(r),
    total: loadLines(db, r.id).reduce((s, l) => s + poLineAmount(l), 0)
  }));
}

/** `warehouses`: a user limited to branches counts only orders with no warehouse yet or for one of theirs. */
export function purchaseOrdersSummary(db: Db, warehouses: readonly string[] | null = null): { draft: number; open: number; partial: number; overdue: number } {
  const elsewhere = warehouses
    ? new Set((db.prepare('SELECT id, warehouse_id FROM purchase_orders WHERE warehouse_id IS NOT NULL').all() as { id: string; warehouse_id: string }[])
      .filter((o) => !warehouses.includes(o.warehouse_id)).map((o) => o.id))
    : null;
  const all = listPurchaseOrders(db, { status: 'open' }).filter((o) => !elsewhere?.has(o.id));
  return {
    draft: all.filter((x) => x.status === 'draft').length,
    open: all.filter((x) => x.status === 'sent' || x.status === 'partial').length,
    partial: all.filter((x) => x.status === 'partial').length,
    overdue: all.filter((x) => x.overdue).length
  };
}

function check(db: Db, input: PoInput): void {
  const errors: { code: string; line?: number }[] = [];
  if (!isIsoDate(input.date)) errors.push({ code: 'date_invalid' });
  if (input.expectedDate && (!isIsoDate(input.expectedDate) || input.expectedDate < input.date)) errors.push({ code: 'po_expected_invalid' });
  const party = input.partyId ? db.prepare('SELECT type, active FROM parties WHERE id = ?').get(input.partyId) as { type: string; active: number } | undefined : undefined;
  if (!input.partyId) errors.push({ code: 'po_supplier_required' });
  else if (!party || party.type !== 'supplier' || party.active !== 1) errors.push({ code: 'party_invalid' });
  if (input.warehouseId) {
    const w = db.prepare('SELECT active FROM warehouses WHERE id = ?').get(input.warehouseId) as { active: number } | undefined;
    if (!w || w.active !== 1) errors.push({ code: 'warehouse_invalid' });
  }
  if (!input.lines.length) errors.push({ code: 'po_lines_required' });
  input.lines.forEach((l, i) => {
    const line = i + 1;
    const it = l.itemId ? db.prepare('SELECT active FROM items WHERE id = ?').get(l.itemId) as { active: number } | undefined : undefined;
    if (!it || it.active !== 1) errors.push({ code: 'line_item_invalid', line });
    if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli! <= 0 || l.qtyMilli! > MAX_QTY) errors.push({ code: 'line_qty_invalid', line });
    if (!Number.isSafeInteger(l.unitPrice) || l.unitPrice < 0 || l.unitPrice > MAX_PRICE) errors.push({ code: 'line_price_invalid', line });
  });
  if (errors.length) throw invalid(errors);
}

function writeLines(db: Db, id: string, lines: PoLine[]): void {
  db.prepare('DELETE FROM purchase_order_lines WHERE order_id = ?').run(id);
  const ins = db.prepare('INSERT INTO purchase_order_lines (order_id, seq, item_id, qty_milli, unit_price, unit, unit_factor_milli, unit_qty_milli) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  lines.forEach((l, i) => ins.run(id, i + 1, l.itemId, l.qtyMilli, l.unitPrice, l.unit ?? null, l.unit ? l.unitFactorMilli ?? null : null, l.unit ? l.unitQtyMilli ?? null : null));
}

/** The order's lines with their base quantities, from each item's units now. */
function withUnits(db: Db, raw: PoInput): PoInput & { lines: PoLine[] } {
  const lines = Array.isArray(raw.lines) ? resolveLines(db, raw.lines.map((l) => ({ ...l, itemId: l.itemId ?? '' }))) : [];
  return { ...raw, lines } as PoInput & { lines: PoLine[] };
}

export function createPurchaseOrder(db: Db, raw: PoInput, actor: Actor): PoView {
  const input = withUnits(db, raw);
  check(db, input);
  const id = randomUUID();
  transaction(db, () => {
    const year = input.date.slice(0, 4);
    const number = `PO-${year}-${String(nextSequence(db, `po:${year}`)).padStart(4, '0')}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO purchase_orders (id, number, date, party_id, warehouse_id, currency, expected_date, status, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`).run(id, number, input.date, input.partyId, input.warehouseId || null, input.currency, input.expectedDate || null, input.notes?.trim() || null, actor.name, now, now);
    writeLines(db, id, input.lines);
    audit(db, actor.name, 'po.create', 'purchase_order', id, { number });
  });
  return getPurchaseOrder(db, id, actor);
}

export function updatePurchaseOrder(db: Db, id: string, raw: PoInput, actor: Actor): PoView {
  const r = loadRow(db, id);
  requireAction(db, r, 'edit');
  const input = withUnits(db, raw);
  check(db, input);
  transaction(db, () => {
    db.prepare('UPDATE purchase_orders SET date = ?, party_id = ?, warehouse_id = ?, currency = ?, expected_date = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(input.date, input.partyId, input.warehouseId || null, input.currency, input.expectedDate || null, input.notes?.trim() || null, new Date().toISOString(), id);
    writeLines(db, id, input.lines);
    audit(db, actor.name, 'po.update', 'purchase_order', id, { number: r.number });
  });
  return getPurchaseOrder(db, id, actor);
}

export function movePurchaseOrder(db: Db, id: string, action: 'send' | 'cancel' | 'reopen', actor: Actor, reason?: string): PoView {
  syncStatus(db, id);
  const r = loadRow(db, id);
  requireAction(db, r, action);
  transaction(db, () => {
    let next: PoStatus;
    if (action === 'send') next = 'sent';
    else if (action === 'cancel') next = 'cancelled';
    else next = hasReceipts(db, id) ? 'sent' : 'draft';
    db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?').run(next, new Date().toISOString(), id);
    audit(db, actor.name, `po.${action}`, 'purchase_order', id, { number: r.number, ...(reason ? { reason } : {}) });
  });
  syncStatus(db, id);
  return getPurchaseOrder(db, id, actor);
}

export interface ReceiveInput {
  date: string;
  warehouseId?: string | null;
  rateX100?: number;
}

/** Makes a DRAFT purchase invoice for everything still to come and links it to the order. */
export function receivePurchaseOrder(db: Db, id: string, input: ReceiveInput, actor: Actor): { order: PoView; invoiceId: string } {
  syncStatus(db, id);
  const r = loadRow(db, id);
  requireAction(db, r, 'receive');
  if (!isIsoDate(input.date)) throw invalid([{ code: 'date_invalid' }]);
  // none on the order or the request: the first active one the user may use (a limited user's own branches only)
  const warehouseId = input.warehouseId || r.warehouse_id || defaultWarehouseId(db, actor);
  const rate = r.currency === 'USD' ? input.rateX100 ?? getSettings(db).defaultRateX100 : 100;
  // a line ordered in boxes is received in boxes, when what is left is whole thousandths of a box at the item's factor now
  const factorNow = db.prepare('SELECT factor_milli FROM item_units WHERE item_id = ? AND unit = ?');
  const lines = progress(db, id).filter((l) => l.remaining > 0).map((l) => {
    const factor = l.unit_factor_milli === null ? null : Number(l.unit_factor_milli);
    const now = l.unit ? (factorNow.get(l.item_id, l.unit) as { factor_milli: number } | undefined) : undefined;
    const typed = l.unit && factor && now && Number(now.factor_milli) === factor ? fromBaseQty(l.remaining, factor) : null;
    return l.unit && typed !== null
      ? { itemId: l.item_id, unit: l.unit, unitQtyMilli: typed, unitPrice: l.unit_price }
      : { itemId: l.item_id, qtyMilli: l.remaining, unitPrice: basePriceOf(l.unit_price, l.unit ? factor : null) };
  });
  let invoiceId = '';
  transaction(db, () => {
    const inv = createInvoice(db, {
      kind: 'purchase', date: input.date, partyId: r.party_id, warehouseId, currency: r.currency, rateX100: rate,
      payment: 'credit', discount: 0, notes: r.number, lines
    }, actor.name);
    invoiceId = inv.id;
    db.prepare('INSERT INTO purchase_order_receipts (order_id, invoice_id) VALUES (?, ?)').run(id, inv.id);
    audit(db, actor.name, 'po.receive', 'purchase_order', id, { number: r.number, invoiceId: inv.id });
  });
  return { order: getPurchaseOrder(db, id, actor), invoiceId };
}

/* ---------- what to order: items at or below their reorder level ---------- */

export interface ReorderLine {
  itemId: string;
  itemCode: string;
  itemName: Names;
  unit: string;
  onHandMilli: number;
  reorderMilli: number | null;
  onOrderMilli: number;
  suggestMilli: number;
  lastPrice: number | null;
}

export interface ReorderGroup {
  party: { id: string; name: string } | null;
  currency: CurrencyCode;
  lines: ReorderLine[];
}

/** `warehouses`: for a user limited to branches, the stock on hand in their branches' warehouses only. */
export function reorderSuggestions(db: Db, warehouses: readonly string[] | null = null): ReorderGroup[] {
  const inWarehouses = warehouses ? ` AND m.warehouse_id IN (${warehouses.length ? warehouses.map(() => '?').join(', ') : 'NULL'})` : '';
  const wp = warehouses ?? [];
  // part_details is in every schema (SQLite and server databases alike): the reorder level of a part
  const items = db.prepare(`
    SELECT i.id, i.code, i.name_ar, i.name_en, i.name_ku, i.unit,
      (SELECT COALESCE(SUM(m.qty_milli), 0) FROM stock_moves m WHERE m.item_id = i.id${inWarehouses}) AS on_hand,
      (SELECT COUNT(*) FROM stock_moves m WHERE m.item_id = i.id${inWarehouses}) AS moves
      , (SELECT d.reorder_milli FROM part_details d WHERE d.item_id = i.id) AS reorder
    FROM items i WHERE i.active = 1 AND i.track_stock = 1 ORDER BY i.code`).all(...wp, ...wp) as {
      id: string; code: string; name_ar: string; name_en: string; name_ku: string; unit: string; on_hand: number; moves: number; reorder: number | null;
    }[];
  // still to come on open orders
  const onOrder = new Map<string, number>();
  const open = db.prepare("SELECT id FROM purchase_orders WHERE status IN ('draft', 'sent', 'partial')").all() as { id: string }[];
  for (const o of open) for (const l of progress(db, o.id)) onOrder.set(l.item_id, (onOrder.get(l.item_id) ?? 0) + l.remaining);
  const lastBuy = db.prepare(`
    SELECT i.party_id, p.name, i.currency, il.unit_price, il.unit_factor_milli FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id JOIN parties p ON p.id = i.party_id
    WHERE il.item_id = ? AND i.kind = 'purchase' AND i.status = 'posted' ORDER BY i.date DESC, i.created_at DESC LIMIT 1`);
  const groups = new Map<string, ReorderGroup>();
  for (const it of items) {
    const onHand = Number(it.on_hand);
    const reorder = it.reorder === null || it.reorder === undefined ? null : Number(it.reorder);
    const low = reorder !== null ? onHand <= reorder : Number(it.moves) > 0 && onHand <= 0;
    if (!low) continue;
    const coming = onOrder.get(it.id) ?? 0;
    const target = reorder !== null ? Math.max(2 * reorder, reorder + 1000) : 1000;
    const suggest = target - onHand - coming;
    if (suggest <= 0) continue;
    const bought = lastBuy.get(it.id) as { party_id: string; name: string; currency: CurrencyCode; unit_price: number; unit_factor_milli: number | null } | undefined;
    // the last price per base unit (a purchase in boxes says so per box)
    const last = bought ? { ...bought, unit_price: basePriceOf(Number(bought.unit_price), bought.unit_factor_milli === null ? null : Number(bought.unit_factor_milli)) } : undefined;
    const currency: CurrencyCode = last?.currency ?? 'IQD';
    const key = `${last?.party_id ?? ''}|${currency}`;
    if (!groups.has(key)) groups.set(key, { party: last ? { id: last.party_id, name: last.name } : null, currency, lines: [] });
    groups.get(key)!.lines.push({
      itemId: it.id, itemCode: it.code, itemName: { ar: it.name_ar, en: it.name_en, ku: it.name_ku }, unit: it.unit,
      onHandMilli: onHand, reorderMilli: reorder, onOrderMilli: coming, suggestMilli: Math.ceil(suggest / 1000) * 1000, lastPrice: last?.unit_price ?? null
    });
  }
  return [...groups.values()].sort((a, b) => (a.party ? 0 : 1) - (b.party ? 0 : 1) || (a.party?.name ?? '').localeCompare(b.party?.name ?? ''));
}

/* ---------- API ---------- */

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().min(1).max(64);
const idParam = z.object({ id });
const poBody = z.object({
  date, partyId: z.string().max(64), warehouseId: id.nullable().optional(), currency: z.enum(['IQD', 'USD']),
  expectedDate: date.or(z.literal('')).nullable().optional(), notes: z.string().max(2000).optional(),
  lines: z.array(z.object({
    itemId: z.string().max(64), qtyMilli: z.number().int().optional(), unitPrice: z.number().int(),
    unit: z.enum(UNIT_CODES).optional(), unitQtyMilli: z.number().int().positive().max(1e12).optional()
  })).max(300)
});

export const purchasingApi: ApiExtension = {
  rules: {
    'POST /api/purchase-orders': 'purchases',
    'PUT /api/purchase-orders/:id': 'purchases',
    'POST /api/purchase-orders/:id/status': 'purchases',
    'POST /api/purchase-orders/:id/receive': 'purchases'
  },
  routes(db, { actorOf }) {
    return [
      // a user limited to branches: counted and suggested from their branches' orders and stock, as the list shows them
      { method: 'GET', path: '/api/purchase-orders/summary', handler: async (req) => purchaseOrdersSummary(db, userBranchLists(db, actorOf(req))?.warehouses ?? null) },
      { method: 'GET', path: '/api/purchase-orders/suggest', handler: async (req) => reorderSuggestions(db, userBranchLists(db, actorOf(req))?.warehouses ?? null) },
      {
        method: 'GET', path: '/api/purchase-orders',
        handler: async (req) => {
          const f = parse(z.object({ status: z.enum(['draft', 'sent', 'partial', 'received', 'cancelled', 'open']).optional(), partyId: id.optional(), q: z.string().max(100).optional() }), req.query);
          return listPurchaseOrders(db, { status: f.status, partyId: f.partyId, q: f.q?.trim() || undefined });
        }
      },
      { method: 'GET', path: '/api/purchase-orders/:id', handler: async (req) => getPurchaseOrder(db, parse(idParam, req.params).id, actorOf(req)) },
      {
        method: 'POST', path: '/api/purchase-orders',
        handler: async (req, reply) => {
          reply.status(201).send(createPurchaseOrder(db, parse(poBody, req.body) as PoInput, actorOf(req)));
          return undefined;
        }
      },
      { method: 'PUT', path: '/api/purchase-orders/:id', handler: async (req) => updatePurchaseOrder(db, parse(idParam, req.params).id, parse(poBody, req.body) as PoInput, actorOf(req)) },
      {
        method: 'POST', path: '/api/purchase-orders/:id/status',
        handler: async (req) => {
          const b = parse(z.object({ action: z.enum(['send', 'cancel', 'reopen']), reason: z.string().max(500).optional() }), req.body);
          return movePurchaseOrder(db, parse(idParam, req.params).id, b.action, actorOf(req), b.reason?.trim() || undefined);
        }
      },
      {
        method: 'POST', path: '/api/purchase-orders/:id/receive',
        handler: async (req, reply) => {
          const b = parse(z.object({ date, warehouseId: id.nullable().optional(), rateX100: z.number().int().positive().max(100_000_000).optional() }), req.body);
          reply.status(201).send(receivePurchaseOrder(db, parse(idParam, req.params).id, b, actorOf(req)));
          return undefined;
        }
      }
    ];
  }
};
