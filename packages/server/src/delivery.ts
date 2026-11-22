import { randomUUID } from 'node:crypto';
import { onceOnly } from './idempotency.ts';
import { z } from 'zod';
import { invoiceTotals, isLang, todayIso, UNIT_CODES, type Lang, type Names, type UnitCode } from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { planStatus } from './license.ts';
import { readSetting, writeSetting } from './settings.ts';
import { createInvoice, getInvoice, postInvoice, withUnits, type InvoiceView } from './invoices.ts';
import { createItem } from './items.ts';
import { assertMayReverseFeatureEntry, createJournalEntry, deleteFeatureDraft, reverseEntryInternal, voucherPendingSql } from './journal.ts';
import { preparerOf } from './quick-vouchers.ts';
import { saleOffers } from './offers.ts';
import { userBranchLists } from './branches.ts';
import { seesBooks, type Actor } from './auth.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Delivery orders (طلبات التوصيل; Starter, Pro and Business): orders a shop takes by phone or WhatsApp and sends out with
 * a driver. Nothing is in the books while the order is new, being prepared or out: the goods and the money move when it
 * is delivered.
 *
 * - An order names the customer (one of the company's, or only a name, phone and address), the goods at their sale
 *   prices, the delivery fee and how it is paid: cash on delivery, or on the customer's account (a known customer).
 * - Delivered: it becomes an ordinary sale invoice, made and posted as the till makes one (createInvoice, postInvoice),
 *   with the offers that were on when the order was taken, and the fee as a line of the "Delivery fee" service (made
 *   the first time it is needed). Stock goes out then. Cash on delivery is received into the driver's own cash account
 *   (a safe under 18 the admin gives each driver): Dr the driver's cash / Cr sales. On account: Dr the customer.
 * - Handover: the driver brings the cash to the office: a journal entry Dr the office safe / Cr the driver's cash, that
 *   waits for checking and approval like any voucher (createJournalEntry): separation of duties is never bypassed.
 *   What a driver still holds is his cash account's balance in the approved books, less handovers not approved yet.
 * - A delivered order is final here: undoing the sale is cancelling its invoice, as for any sale.
 *
 * Each step can open WhatsApp with a message to the customer (the app does that; nothing is sent by Qasa itself).
 */

export const DELIVERY_STATUSES = ['new', 'preparing', 'out', 'delivered', 'cancelled'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type DeliveryPayment = 'cod' | 'account';

export const deliveryAvailable = (db: Db): boolean => planStatus(db).features.includes('delivery');
function requirePlan(db: Db): void {
  if (!deliveryAvailable(db)) throw conflict('plan_limit', { limit: 'delivery' });
}

const nowIso = () => new Date().toISOString();
/** the steps an order may take: forwards one or more steps, back to the step before, or cancelled before it is delivered */
const NEXT: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  new: ['preparing', 'out', 'cancelled'],
  preparing: ['new', 'out', 'cancelled'],
  out: ['preparing', 'cancelled'],
  delivered: [],
  cancelled: []
};

// ——— drivers ———

export interface DriverInput { name: string; phone?: string | undefined; userId?: string | null | undefined; cashAccount?: string | null | undefined; active?: boolean | undefined }
export interface DriverView {
  id: string; name: string; phone: string; userId: string | null; cashAccount: string | null; active: boolean;
  /** cash the driver holds: his cash account in the approved books, less handovers that wait for approval */
  holding: number;
}

interface DriverRow { id: string; name: string; phone: string | null; user_id: string | null; cash_account: string | null; active: number }

/** The postable cash accounts (under 18): a driver's cash and the office safe of a handover are among them. */
function isCashAccount(db: Db, code: string): boolean {
  return code.startsWith('18') && loadAccounts(db).some((a) => a.code === code && a.postable);
}

function approvedBalance(db: Db, account: string): number {
  return Number((db.prepare(`SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS b FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                             WHERE l.account_code = ? AND e.status = 'approved'`).get(account) as { b: number }).b);
}

function pendingHandovers(db: Db, driverId: string): number {
  return Number((db.prepare(`SELECT COALESCE(SUM(h.amount), 0) AS s FROM delivery_handovers h JOIN entries e ON e.id = h.entry_id
                             WHERE h.driver_id = ? AND e.status IN ('draft', 'checked') AND ${voucherPendingSql('e')}`).get(driverId) as { s: number }).s);
}

function driverView(db: Db, r: DriverRow): DriverView {
  const holding = r.cash_account ? Math.max(0, approvedBalance(db, r.cash_account) - pendingHandovers(db, r.id)) : 0;
  return { id: r.id, name: r.name, phone: r.phone ?? '', userId: r.user_id, cashAccount: r.cash_account, active: r.active === 1, holding };
}

export function listDrivers(db: Db, all = false): DriverView[] {
  return (db.prepare(`SELECT * FROM delivery_drivers ${all ? '' : 'WHERE active = 1'} ORDER BY name`).all() as unknown as DriverRow[]).map((r) => driverView(db, r));
}

export function getDriver(db: Db, id: string): DriverView {
  const r = db.prepare('SELECT * FROM delivery_drivers WHERE id = ?').get(id) as DriverRow | undefined;
  if (!r) throw notFound('driver');
  return driverView(db, r);
}

function checkDriver(db: Db, input: DriverInput, selfId?: string): void {
  const errors: { code: string }[] = [];
  if (!input.name.trim()) errors.push({ code: 'dl_driver_name_required' });
  if (input.cashAccount && !isCashAccount(db, input.cashAccount)) errors.push({ code: 'dl_cash_account_invalid' });
  // what a driver holds is his cash account's balance: it is his alone (not another driver's, a rep's, a till's safe
  // or the office safe that handovers go to), or two people would each "hold" the same money
  else if (input.cashAccount && cashAccountTaken(db, input.cashAccount, selfId)) errors.push({ code: 'dl_cash_account_taken' });
  if (input.userId && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(input.userId)) errors.push({ code: 'dl_user_invalid' });
  if (errors.length) throw invalid(errors);
}

function cashAccountTaken(db: Db, code: string, selfId?: string): boolean {
  if (db.prepare('SELECT 1 FROM delivery_drivers WHERE cash_account = ? AND id <> ?').get(code, selfId ?? '')) return true;
  if (db.prepare('SELECT 1 FROM ws_reps WHERE cash_account = ?').get(code)) return true;
  if (db.prepare('SELECT 1 FROM pos_tills WHERE cash_account = ?').get(code)) return true;
  if (db.prepare("SELECT 1 FROM pos_shifts WHERE cash_account = ? AND status = 'open'").get(code)) return true;
  // the main safe: the first cash account of the chart
  const first = loadAccounts(db).filter((a) => a.postable && a.code.startsWith('18')).map((a) => a.code).sort()[0];
  return code === first;
}

export function createDriver(db: Db, input: DriverInput, user: string): DriverView {
  requirePlan(db);
  checkDriver(db, input);
  const id = randomUUID();
  const now = nowIso();
  db.prepare('INSERT INTO delivery_drivers (id, name, phone, user_id, cash_account, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.name.trim(), input.phone?.trim() || null, input.userId || null, input.cashAccount || null, input.active === false ? 0 : 1, now, now);
  audit(db, user, 'create', 'delivery_driver', id, { name: input.name.trim() });
  return getDriver(db, id);
}

export function updateDriver(db: Db, id: string, input: DriverInput, user: string): DriverView {
  requirePlan(db);
  const before = getDriver(db, id);
  // (a driver made before this rule keeps the account he has until it is changed)
  checkDriver(db, input.cashAccount === before.cashAccount ? { ...input, cashAccount: null } : input, id);
  db.prepare('UPDATE delivery_drivers SET name = ?, phone = ?, user_id = ?, cash_account = ?, active = ?, updated_at = ? WHERE id = ?')
    .run(input.name.trim(), input.phone?.trim() || null, input.userId || null, input.cashAccount || null, input.active === false ? 0 : 1, nowIso(), id);
  audit(db, user, 'update', 'delivery_driver', id);
  return getDriver(db, id);
}

// ——— orders ———

export interface DeliveryLineInput { itemId: string; qtyMilli?: number | undefined; unitPrice: number; unit?: UnitCode | undefined; unitQtyMilli?: number | undefined }
export interface DeliveryOrderInput {
  partyId?: string | null | undefined;
  customerName: string;
  phone?: string | undefined;
  address: string;
  area?: string | undefined;
  notes?: string | undefined;
  lang?: Lang | null | undefined;
  warehouseId: string;
  payment: DeliveryPayment;
  /** dinars */
  fee: number;
  driverId?: string | null | undefined;
  lines: DeliveryLineInput[];
}

export interface DeliveryLineView { lineNo: number; itemId: string; itemCode: string; itemName: Names; unit: UnitCode | null; qtyMilli: number; unitQtyMilli: number | null; unitPrice: number; amount: number; discount: number }
export interface DeliveryOrderView {
  id: string; number: string; status: DeliveryStatus; partyId: string | null; customerName: string; phone: string; address: string; area: string; notes: string;
  lang: Lang | null; warehouseId: string; payment: DeliveryPayment; fee: number; driverId: string | null; driverName: string | null;
  invoiceId: string | null; invoiceNumber: string | null; cancelReason: string | null;
  createdBy: string; createdAt: string; outAt: string | null; deliveredAt: string | null;
  /** dinars: goods before offers, what the offers take off, the fee and what the customer pays */
  subtotal: number; offerDiscount: number; total: number;
  lines: DeliveryLineView[];
  /** what may be done next */
  next: DeliveryStatus[];
}

interface OrderRow {
  id: string; number: string; status: DeliveryStatus; party_id: string | null; customer_name: string; phone: string | null; address: string; area: string | null;
  notes: string | null; lang: string | null; warehouse_id: string; payment: DeliveryPayment; fee: number; driver_id: string | null; invoice_id: string | null;
  cancel_reason: string | null; created_by: string; created_at: string; out_at: string | null; delivered_at: string | null;
}
interface LineRow { line_no: number; item_id: string; code: string; name_ar: string; name_en: string; name_ku: string; qty_milli: number; unit_price: number; unit: UnitCode | null; unit_qty_milli: number | null }

/** The goods' amounts and what the offers on at `at` take off each (in dinars), as the sale invoice will work them out. */
function priced(db: Db, warehouseId: string, lines: readonly { itemId: string; qtyMilli: number; unitPrice: number; unit?: UnitCode | null | undefined; unitQtyMilli?: number | null | undefined }[], at: Date) {
  const shaped = lines.map((l) => ({ qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, ...(l.unit ? { unit: l.unit, unitQtyMilli: l.unitQtyMilli ?? l.qtyMilli } : {}) }));
  const totals = invoiceTotals(shaped, 0);
  const offers = saleOffers(db, {
    date: todayIso(at), warehouseId, currency: 'IQD', rateX100: 100,
    lines: lines.map((l, i) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli, amount: totals.lineAmounts[i] ?? 0 }))
  }, at);
  return { amounts: totals.lineAmounts, subtotal: totals.subtotal, byLine: offers.byLine, offerTotal: offers.total };
}

export function getDeliveryOrder(db: Db, id: string): DeliveryOrderView {
  const r = db.prepare('SELECT * FROM delivery_orders WHERE id = ?').get(id) as OrderRow | undefined;
  if (!r) throw notFound('delivery_order');
  const rows = db.prepare(`SELECT l.line_no, l.item_id, i.code, i.name_ar, i.name_en, i.name_ku, l.qty_milli, l.unit_price, l.unit, l.unit_qty_milli
                           FROM delivery_order_lines l JOIN items i ON i.id = l.item_id WHERE l.order_id = ? ORDER BY l.line_no`).all(id) as unknown as LineRow[];
  const lines = rows.map((l) => ({ itemId: l.item_id, qtyMilli: Number(l.qty_milli), unitPrice: Number(l.unit_price), unit: l.unit, unitQtyMilli: l.unit_qty_milli === null ? null : Number(l.unit_qty_milli) }));
  // a delivered order shows what its invoice charged; the others what the offers on when it was taken give
  const invoice = r.invoice_id ? getInvoice(db, r.invoice_id) : null;
  const p = priced(db, r.warehouse_id, lines, new Date(r.created_at));
  const offerDiscount = invoice ? invoice.offerDiscount : p.offerTotal;
  const subtotal = p.subtotal;
  const driver = r.driver_id ? db.prepare('SELECT name FROM delivery_drivers WHERE id = ?').get(r.driver_id) as { name: string } | undefined : undefined;
  return {
    id: r.id, number: r.number, status: r.status, partyId: r.party_id, customerName: r.customer_name, phone: r.phone ?? '', address: r.address, area: r.area ?? '',
    notes: r.notes ?? '', lang: r.lang && isLang(r.lang) ? r.lang : null, warehouseId: r.warehouse_id, payment: r.payment, fee: Number(r.fee),
    driverId: r.driver_id, driverName: driver?.name ?? null, invoiceId: r.invoice_id, invoiceNumber: invoice?.number ?? null, cancelReason: r.cancel_reason,
    createdBy: r.created_by, createdAt: r.created_at, outAt: r.out_at, deliveredAt: r.delivered_at,
    subtotal, offerDiscount, total: invoice ? invoice.total : subtotal - offerDiscount + Number(r.fee),
    lines: rows.map((l, i) => ({
      lineNo: l.line_no, itemId: l.item_id, itemCode: l.code, itemName: { ar: l.name_ar, en: l.name_en, ku: l.name_ku }, unit: l.unit, qtyMilli: Number(l.qty_milli),
      unitQtyMilli: l.unit_qty_milli === null ? null : Number(l.unit_qty_milli), unitPrice: Number(l.unit_price), amount: p.amounts[i] ?? 0, discount: p.byLine[i + 1] ?? 0
    })),
    next: [...NEXT[r.status], ...(r.status === 'out' ? ['delivered' as const] : [])]
  };
}

export interface DeliveryFilters { status?: DeliveryStatus | 'open' | undefined; from?: string | undefined; to?: string | undefined; driverId?: string | undefined }
export type DeliveryOrderSummary = Omit<DeliveryOrderView, 'lines'> & { lineCount: number };

export function listDeliveryOrders(db: Db, f: DeliveryFilters = {}, warehouses: readonly string[] | null = null): DeliveryOrderSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (f.status === 'open') where.push("o.status IN ('new', 'preparing', 'out')");
  else if (f.status) { where.push('o.status = ?'); params.push(f.status); }
  if (f.from) { where.push('substr(o.created_at, 1, 10) >= ?'); params.push(f.from); }
  if (f.to) { where.push('substr(o.created_at, 1, 10) <= ?'); params.push(f.to); }
  if (f.driverId) { where.push('o.driver_id = ?'); params.push(f.driverId); }
  if (warehouses) { where.push(`o.warehouse_id IN (${warehouses.length ? warehouses.map(() => '?').join(', ') : 'NULL'})`); params.push(...warehouses); }
  const ids = db.prepare(`SELECT o.id FROM delivery_orders o ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.created_at DESC LIMIT 500`).all(...params) as { id: string }[];
  return ids.map(({ id }) => { const { lines, ...rest } = getDeliveryOrder(db, id); return { ...rest, lineCount: lines.length }; });
}

function checkOrder(db: Db, input: DeliveryOrderInput): void {
  const errors: { code: string; line?: number }[] = [];
  if (!input.customerName.trim()) errors.push({ code: 'dl_customer_required' });
  if (!input.address.trim()) errors.push({ code: 'dl_address_required' });
  if (!input.lines.length) errors.push({ code: 'dl_lines_required' });
  if (input.lines.length > 200) errors.push({ code: 'dl_lines_too_many' });
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id = ? AND active = 1').get(input.warehouseId)) errors.push({ code: 'warehouse_invalid' });
  if (input.partyId && !db.prepare("SELECT 1 FROM parties WHERE id = ? AND type = 'customer'").get(input.partyId)) errors.push({ code: 'dl_customer_invalid' });
  if (input.payment === 'account' && !input.partyId) errors.push({ code: 'dl_account_needs_customer' });
  if (input.driverId && !db.prepare('SELECT 1 FROM delivery_drivers WHERE id = ? AND active = 1').get(input.driverId)) errors.push({ code: 'dl_driver_invalid' });
  input.lines.forEach((l, i) => {
    const item = db.prepare('SELECT active FROM items WHERE id = ?').get(l.itemId) as { active: number } | undefined;
    if (!item || item.active !== 1) errors.push({ code: 'item_invalid', line: i + 1 });
  });
  if (errors.length) throw invalid(errors);
}

/** the lines with their base quantity worked out from the unit typed, as an invoice line is */
function baseLines(db: Db, input: DeliveryOrderInput, warehouseId: string) {
  const shaped = withUnits(db, {
    kind: 'sale', date: todayIso(), warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
    lines: input.lines.map((l) => ({ itemId: l.itemId, unitPrice: l.unitPrice, ...(l.qtyMilli !== undefined ? { qtyMilli: l.qtyMilli } : {}), ...(l.unit ? { unit: l.unit, unitQtyMilli: l.unitQtyMilli ?? l.qtyMilli ?? 0 } : {}) }))
  });
  return shaped.lines.map((l) => {
    if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0) throw invalid([{ code: 'dl_qty_invalid' }]);
    return { itemId: l.itemId, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, unit: l.unit ?? null, unitQtyMilli: l.unit ? l.unitQtyMilli ?? null : null };
  });
}

function writeLines(db: Db, orderId: string, lines: ReturnType<typeof baseLines>): void {
  db.prepare('DELETE FROM delivery_order_lines WHERE order_id = ?').run(orderId);
  const insert = db.prepare('INSERT INTO delivery_order_lines (order_id, line_no, item_id, qty_milli, unit_price, unit, unit_qty_milli) VALUES (?, ?, ?, ?, ?, ?, ?)');
  lines.forEach((l, i) => insert.run(orderId, i + 1, l.itemId, l.qtyMilli, l.unitPrice, l.unit, l.unitQtyMilli));
}

function assertWarehouse(warehouses: readonly string[] | null, warehouseId: string): void {
  if (warehouses && !warehouses.includes(warehouseId)) throw new AppError(403, 'forbidden', { need: 'branch' });
}

export function createDeliveryOrder(db: Db, input: DeliveryOrderInput, actor: Actor): DeliveryOrderView {
  requirePlan(db);
  checkOrder(db, input);
  assertWarehouse(userBranchLists(db, actor)?.warehouses ?? null, input.warehouseId);
  const lines = baseLines(db, input, input.warehouseId);
  const id = randomUUID();
  transaction(db, () => {
    const now = nowIso();
    const number = `DLV-${now.slice(0, 4)}-${String(nextSequence(db, `delivery:${now.slice(0, 4)}`)).padStart(4, '0')}`;
    db.prepare(`INSERT INTO delivery_orders (id, number, status, party_id, customer_name, phone, address, area, notes, lang, warehouse_id, payment, fee, driver_id,
                created_by, created_at, updated_at) VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, number, input.partyId || null, input.customerName.trim(), input.phone?.trim() || null, input.address.trim(), input.area?.trim() || null,
        input.notes?.trim() || null, input.lang ?? null, input.warehouseId, input.payment, input.fee, input.driverId || null, actor.name, now, now);
    writeLines(db, id, lines);
    audit(db, actor.name, 'create', 'delivery_order', id, { number });
  });
  return getDeliveryOrder(db, id);
}

function loadOrder(db: Db, id: string): OrderRow {
  const r = db.prepare('SELECT * FROM delivery_orders WHERE id = ?').get(id) as OrderRow | undefined;
  if (!r) throw notFound('delivery_order');
  return r;
}

export function updateDeliveryOrder(db: Db, id: string, input: DeliveryOrderInput, actor: Actor): DeliveryOrderView {
  requirePlan(db);
  const row = loadOrder(db, id);
  const mine = userBranchLists(db, actor)?.warehouses ?? null;
  assertWarehouse(mine, row.warehouse_id);
  // the goods and the money are settled while it is in the shop; once out, only who drives it and notes change on the board
  if (row.status !== 'new' && row.status !== 'preparing') throw conflict('dl_not_editable', { status: row.status });
  checkOrder(db, input);
  assertWarehouse(mine, input.warehouseId);
  const lines = baseLines(db, input, input.warehouseId);
  transaction(db, () => {
    db.prepare(`UPDATE delivery_orders SET party_id = ?, customer_name = ?, phone = ?, address = ?, area = ?, notes = ?, lang = ?, warehouse_id = ?, payment = ?, fee = ?,
                driver_id = ?, updated_at = ? WHERE id = ?`)
      .run(input.partyId || null, input.customerName.trim(), input.phone?.trim() || null, input.address.trim(), input.area?.trim() || null, input.notes?.trim() || null,
        input.lang ?? null, input.warehouseId, input.payment, input.fee, input.driverId || null, nowIso(), id);
    writeLines(db, id, lines);
    audit(db, actor.name, 'update', 'delivery_order', id);
  });
  return getDeliveryOrder(db, id);
}

/** The "Delivery fee" service the fee is sold as: the one chosen, or made the first time it is needed. */
export function deliveryFeeItem(db: Db, user: string): string {
  const chosen = readSetting(db, 'delivery_fee_item');
  if (chosen && db.prepare('SELECT 1 FROM items WHERE id = ?').get(chosen)) return chosen;
  const existing = db.prepare("SELECT id FROM items WHERE code = 'DELIVERY-FEE'").get() as { id: string } | undefined;
  const itemId = existing?.id ?? createItem(db, {
    code: 'DELIVERY-FEE', name: { ar: 'أجور التوصيل', en: 'Delivery fee', ku: 'کرێی گەیاندن' }, unit: 'service', salePrice: 0, saleCurrency: 'IQD', trackStock: false
  }, user).id;
  writeSetting(db, 'delivery_fee_item', itemId);
  return itemId;
}

/** Moves an order on the board: preparing, out with its driver, back a step, delivered (the sale) or cancelled. */
export function setDeliveryStatus(db: Db, id: string, input: { status: DeliveryStatus; driverId?: string | null | undefined; reason?: string | undefined }, actor: Actor): DeliveryOrderView {
  requirePlan(db);
  const row = loadOrder(db, id);
  assertWarehouse(userBranchLists(db, actor)?.warehouses ?? null, row.warehouse_id);
  const allowed = [...NEXT[row.status], ...(row.status === 'out' ? ['delivered' as const] : [])];
  if (!allowed.includes(input.status)) throw conflict('dl_status_not_allowed', { from: row.status, to: input.status });
  const driverId = input.driverId !== undefined ? input.driverId || null : row.driver_id;
  if (driverId && driverId !== row.driver_id && !db.prepare('SELECT 1 FROM delivery_drivers WHERE id = ? AND active = 1').get(driverId)) throw invalid([{ code: 'dl_driver_invalid' }]);
  if (input.status === 'out' && !driverId) throw invalid([{ code: 'dl_driver_required' }]);
  if (input.status === 'cancelled' && !input.reason?.trim()) throw invalid([{ code: 'dl_cancel_reason_required' }]);
  if (input.status === 'delivered') return deliver(db, row, actor);
  const now = nowIso();
  db.prepare('UPDATE delivery_orders SET status = ?, driver_id = ?, out_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?')
    .run(input.status, driverId, input.status === 'out' ? now : input.status === 'preparing' || input.status === 'new' ? null : row.out_at,
      input.status === 'cancelled' ? input.reason!.trim().slice(0, 300) : null, now, id);
  audit(db, actor.name, input.status === 'cancelled' ? 'cancel' : 'status', 'delivery_order', id, { from: row.status, to: input.status });
  return getDeliveryOrder(db, id);
}

function deliver(db: Db, row: OrderRow, actor: Actor): DeliveryOrderView {
  const driver = row.driver_id ? db.prepare('SELECT * FROM delivery_drivers WHERE id = ?').get(row.driver_id) as DriverRow | undefined : undefined;
  if (!driver) throw invalid([{ code: 'dl_driver_required' }]);
  if (row.payment === 'cod' && (!driver.cash_account || !isCashAccount(db, driver.cash_account))) throw conflict('dl_driver_cash_account');
  if (row.payment === 'account' && !row.party_id) throw invalid([{ code: 'dl_account_needs_customer' }]);
  const lines = db.prepare('SELECT item_id, qty_milli, unit_price, unit, unit_qty_milli FROM delivery_order_lines WHERE order_id = ? ORDER BY line_no').all(row.id) as {
    item_id: string; qty_milli: number; unit_price: number; unit: UnitCode | null; unit_qty_milli: number | null;
  }[];
  // the offers the customer was told of: those on when the order was taken (never a moment in the future)
  // (also when it is delivered on a later day: the invoice is dated today, its offers are the order's day's)
  const taken = new Date(row.created_at);
  const offersAt = taken.getTime() <= Date.now() ? taken : new Date();
  const offersOn = todayIso(offersAt);
  transaction(db, () => {
    const feeLines = row.fee > 0 ? [{ itemId: deliveryFeeItem(db, actor.name), qtyMilli: 1000, unitPrice: Number(row.fee) }] : [];
    const draft = createInvoice(db, {
      kind: 'sale', date: todayIso(), ...(row.party_id ? { partyId: row.party_id } : {}), warehouseId: row.warehouse_id, currency: 'IQD', rateX100: 100,
      ...(row.payment === 'account' ? { payment: 'credit' as const } : { payment: 'cash' as const, cashAccountCode: driver.cash_account! }),
      discount: 0, notes: `${row.number} · ${row.customer_name}`.slice(0, 500),
      lines: [
        ...lines.map((l) => ({ itemId: l.item_id, qtyMilli: Number(l.qty_milli), unitPrice: Number(l.unit_price), ...(l.unit ? { unit: l.unit, unitQtyMilli: Number(l.unit_qty_milli ?? l.qty_milli) } : {}) })),
        ...feeLines
      ]
    }, actor.name, { offersAt, offersOn });
    const posted: InvoiceView = postInvoice(db, draft.id, actor.name, { offersAt, offersOn });
    const now = nowIso();
    db.prepare("UPDATE delivery_orders SET status = 'delivered', invoice_id = ?, delivered_at = ?, updated_at = ? WHERE id = ?").run(posted.id, now, now, row.id);
    audit(db, actor.name, 'deliver', 'delivery_order', row.id, { number: row.number, invoice: posted.number });
  });
  return getDeliveryOrder(db, row.id);
}

/** Taken back while it is new or being prepared (nothing in the books yet); afterwards it is cancelled with a reason. */
export function deleteDeliveryOrder(db: Db, id: string, actor: Actor): void {
  requirePlan(db);
  const row = loadOrder(db, id);
  assertWarehouse(userBranchLists(db, actor)?.warehouses ?? null, row.warehouse_id);
  if (row.status !== 'new') throw conflict('dl_not_deletable', { status: row.status });
  db.prepare('DELETE FROM delivery_orders WHERE id = ?').run(id);
  audit(db, actor.name, 'delete', 'delivery_order', id, { number: row.number });
}

/** A preview of what an order costs the customer: the goods, the offers on now and the fee (the order form). */
export function previewDelivery(db: Db, input: { warehouseId: string; fee: number; lines: DeliveryLineInput[] }): { subtotal: number; offerDiscount: number; fee: number; total: number; byLine: Record<number, number> } {
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(input.warehouseId)) throw invalid([{ code: 'warehouse_invalid' }]);
  if (!input.lines.length) return { subtotal: 0, offerDiscount: 0, fee: input.fee, total: input.fee, byLine: {} };
  const lines = baseLines(db, { customerName: '-', address: '-', payment: 'cod', fee: input.fee, warehouseId: input.warehouseId, lines: input.lines }, input.warehouseId);
  const p = priced(db, input.warehouseId, lines, new Date());
  return { subtotal: p.subtotal, offerDiscount: p.offerTotal, fee: input.fee, total: p.subtotal - p.offerTotal + input.fee, byLine: p.byLine };
}

// ——— handovers ———

export interface HandoverView { id: string; driverId: string; driverName: string; amount: number; entryId: string; entryNumber: string; entryStatus: string; createdBy: string; createdAt: string }

/** The cash a driver brings to the office: Dr the office safe / Cr the driver's cash, a draft through checking and approval. */
export function handOver(db: Db, input: { driverId: string; amount: number; cashAccountCode: string; date?: string | undefined; note?: string | undefined }, actor: Actor): HandoverView {
  requirePlan(db);
  const driver = getDriver(db, input.driverId);
  const errors: { code: string }[] = [];
  if (!driver.cashAccount) errors.push({ code: 'dl_driver_cash_account' });
  if (!isCashAccount(db, input.cashAccountCode)) errors.push({ code: 'dl_cash_account_invalid' });
  if (driver.cashAccount && input.cashAccountCode === driver.cashAccount) errors.push({ code: 'dl_same_account' });
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) errors.push({ code: 'amount_invalid' });
  else if (input.amount > driver.holding) errors.push({ code: 'dl_more_than_held', held: driver.holding } as { code: string });
  const mine = userBranchLists(db, actor);
  if (mine && !mine.accounts.includes(input.cashAccountCode)) errors.push({ code: 'dl_cash_account_invalid' });
  if (errors.length) throw invalid(errors);
  const id = randomUUID();
  const date = input.date ?? todayIso();
  const entryId = transaction(db, () => {
    const memo = (input.note?.trim() || `${driver.name}`).slice(0, 300);
    const entry = createJournalEntry(db, {
      date, currency: 'IQD', rateX100: 100, description: memo,
      lines: [
        { accountCode: input.cashAccountCode, debit: input.amount, credit: 0 },
        { accountCode: driver.cashAccount!, debit: 0, credit: input.amount }
      ]
    }, actor.name, actor.id, preparerOf(actor));
    db.prepare('INSERT INTO delivery_handovers (id, driver_id, entry_id, amount, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, driver.id, entry.id, input.amount, actor.name, nowIso());
    audit(db, actor.name, 'create', 'delivery_handover', id, { driver: driver.name, amount: input.amount });
    return entry.id;
  });
  return listHandovers(db, driver.id).find((h) => h.entryId === entryId)!;
}

/**
 * Takes a handover back (the wrong amount or safe, or one that was refused): while its entry is not in the books it is
 * deleted with the handover; once approved it is reversed, by someone who may approve entries and, under separate
 * duties, not the one who made it. Either way the driver holds the cash again.
 */
export function cancelHandover(db: Db, id: string, actor: Actor, date?: string): { cancelled: true; reversalId: string | null } {
  requirePlan(db);
  const row = db.prepare('SELECT id, driver_id, entry_id, amount FROM delivery_handovers WHERE id = ?').get(id) as { id: string; driver_id: string; entry_id: string; amount: number } | undefined;
  if (!row) throw notFound('delivery_handover');
  const entry = db.prepare('SELECT status, reversed_by_id FROM entries WHERE id = ?').get(row.entry_id) as { status: string; reversed_by_id: string | null } | undefined;
  let reversalId: string | null = null;
  transaction(db, () => {
    if (entry?.status === 'approved') {
      if (entry.reversed_by_id) throw conflict('dl_handover_cancelled');
      assertMayReverseFeatureEntry(db, row.entry_id, actor);
      reversalId = reverseEntryInternal(db, row.entry_id, actor.name, date);
    } else {
      db.prepare('DELETE FROM delivery_handovers WHERE id = ?').run(id);
      if (entry) deleteFeatureDraft(db, row.entry_id, actor.name);
    }
    audit(db, actor.name, 'cancel', 'delivery_handover', id, { amount: Number(row.amount), reversalId });
  });
  return { cancelled: true, reversalId };
}

export function listHandovers(db: Db, driverId?: string): HandoverView[] {
  const rows = db.prepare(`SELECT h.*, d.name AS driver_name FROM delivery_handovers h JOIN delivery_drivers d ON d.id = h.driver_id
                           ${driverId ? 'WHERE h.driver_id = ?' : ''} ORDER BY h.created_at DESC LIMIT 200`).all(...(driverId ? [driverId] : [])) as {
    id: string; driver_id: string; driver_name: string; amount: number; entry_id: string; created_by: string; created_at: string;
  }[];
  return rows.map((r) => {
    const e = db.prepare('SELECT number, status, reversed_by_id FROM entries WHERE id = ?').get(r.entry_id) as { number: string | null; status: string; reversed_by_id: string | null } | undefined;
    return {
      id: r.id, driverId: r.driver_id, driverName: r.driver_name, amount: Number(r.amount), entryId: r.entry_id, entryNumber: e?.number ?? '',
      entryStatus: e ? (e.reversed_by_id ? 'reversed' : e.status) : 'deleted', createdBy: r.created_by, createdAt: r.created_at
    };
  });
}

// ——— API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const idParam = z.object({ id });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int().min(0).max(1e12);
const lineBody = z.object({
  itemId: id, qtyMilli: z.number().int().positive().max(1e12).optional(), unitPrice: money,
  unit: z.enum(UNIT_CODES as unknown as [UnitCode, ...UnitCode[]]).optional(), unitQtyMilli: z.number().int().positive().max(1e12).optional()
});
const orderBody = z.object({
  partyId: id.nullable().optional(), customerName: z.string().max(200), phone: z.string().max(40).optional(), address: z.string().max(500), area: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(), lang: z.enum(['ar', 'en', 'ku']).nullable().optional(), warehouseId: id, payment: z.enum(['cod', 'account']),
  fee: money, driverId: id.nullable().optional(), lines: z.array(lineBody).max(200)
});
const driverBody = z.object({
  name: z.string().max(120), phone: z.string().max(40).optional(), userId: id.nullable().optional(), cashAccount: z.string().max(12).nullable().optional(), active: z.boolean().optional()
});

/**
 * Reading the orders and the drivers is open to every signed-in user, as the app's other lists are; taking and moving
 * orders needs sales. A driver's details: the admin (not listed: changes need admin). Handovers: whoever prepares
 * vouchers; what each driver holds and the handovers are read by those who keep the books only.
 */
export const deliveryApi: ApiExtension = {
  rules: {
    'POST /api/delivery/orders': 'sales',
    'PUT /api/delivery/orders/:id': 'sales',
    'DELETE /api/delivery/orders/:id': 'sales',
    'POST /api/delivery/orders/:id/status': 'sales',
    'POST /api/delivery/preview': 'sales',
    'POST /api/delivery/handovers': 'entries.prepare',
    'POST /api/delivery/handovers/:id/cancel': 'entries.prepare'
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    const scope = (req: ApiRequest) => userBranchLists(db, actor(req))?.warehouses ?? null;
    return [
      {
        method: 'GET', path: '/api/delivery/orders',
        handler: async (req) => {
          const q = parse(z.object({ status: z.enum([...DELIVERY_STATUSES, 'open']).optional(), from: day.optional(), to: day.optional(), driverId: id.optional() }), req.query ?? {});
          return { available: deliveryAvailable(db), orders: listDeliveryOrders(db, q, scope(req)) };
        }
      },
      {
        method: 'GET', path: '/api/delivery/orders/:id',
        handler: async (req) => {
          const o = getDeliveryOrder(db, parse(idParam, req.params).id);
          assertWarehouse(scope(req), o.warehouseId);
          return o;
        }
      },
      {
        method: 'POST', path: '/api/delivery/orders',
        handler: async (req, reply) => {
          const who = actor(req);
          const body = parse(orderBody, req.body);
          reply.status(201).send(onceOnly(db, req, reply, who, 'POST /api/delivery/orders',
            () => { const made = createDeliveryOrder(db, body, who); return { id: made.id, result: made }; }, (o) => getDeliveryOrder(db, o)));
          return undefined;
        }
      },
      { method: 'PUT', path: '/api/delivery/orders/:id', handler: async (req) => updateDeliveryOrder(db, parse(idParam, req.params).id, parse(orderBody, req.body), actor(req)) },
      {
        method: 'DELETE', path: '/api/delivery/orders/:id',
        handler: async (req, reply) => { deleteDeliveryOrder(db, parse(idParam, req.params).id, actor(req)); reply.status(204).send(); return undefined; }
      },
      {
        method: 'POST', path: '/api/delivery/orders/:id/status',
        handler: async (req) => setDeliveryStatus(db, parse(idParam, req.params).id,
          parse(z.object({ status: z.enum(DELIVERY_STATUSES), driverId: id.nullable().optional(), reason: z.string().max(300).optional() }), req.body), actor(req))
      },
      {
        method: 'POST', path: '/api/delivery/preview',
        handler: async (req) => previewDelivery(db, parse(z.object({ warehouseId: id, fee: money, lines: z.array(lineBody).max(200) }), req.body))
      },
      {
        method: 'GET', path: '/api/delivery/drivers',
        handler: async (req) => {
          const q = parse(z.object({ all: z.enum(['1', '0']).optional() }), req.query ?? {});
          const drivers = listDrivers(db, q.all === '1');
          // the cash each holds is the books' (cost-view): staff without the books see the drivers, not their money
          return seesBooks(actor(req)) ? drivers : drivers.map((d) => ({ ...d, holding: 0, cashAccount: null }));
        }
      },
      {
        method: 'POST', path: '/api/delivery/drivers',
        handler: async (req, reply) => { reply.status(201).send(createDriver(db, parse(driverBody, req.body), actor(req).name)); return undefined; }
      },
      { method: 'PUT', path: '/api/delivery/drivers/:id', handler: async (req) => updateDriver(db, parse(idParam, req.params).id, parse(driverBody, req.body), actor(req).name) },
      {
        method: 'GET', path: '/api/delivery/handovers',
        handler: async (req) => {
          if (!seesBooks(actor(req))) throw new AppError(403, 'forbidden');
          return listHandovers(db, parse(z.object({ driverId: id.optional() }), req.query ?? {}).driverId);
        }
      },
      {
        method: 'POST', path: '/api/delivery/handovers',
        handler: async (req, reply) => {
          const body = parse(z.object({ driverId: id, amount: z.number().int().positive().max(1e12), cashAccountCode: z.string().max(12), date: day.optional(), note: z.string().max(300).optional() }), req.body);
          reply.status(201).send(handOver(db, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/delivery/handovers/:id/cancel',
        handler: async (req) => cancelHandover(db, parse(idParam, req.params).id, actor(req), parse(z.object({ date: day.optional() }), req.body ?? {}).date)
      }
    ];
  }
};
