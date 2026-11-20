import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { invoiceTotals, isIsoDate, todayIso, toBase, type CurrencyCode, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { planStatus } from './license.ts';
import { isPeriodLocked, readSetting, writeSetting } from './settings.ts';
import { documentVoucherStates, postDocumentVoucher } from './journal.ts';
import { getParty } from './parties.ts';
import { createInvoice, postInvoice, withUnits } from './invoices.ts';
import { createStockDoc, postStockDoc } from './stock-docs.ts';
import { createAdjustment } from './adjustments.ts';
import { aging } from './brief.ts';
import { seesBooks, type Actor } from './auth.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Wholesale and distribution (1.8; Starter, Pro and Business): the sales reps who drive a route of shops, the van stock
 * they carry, the sales orders taken for a shop, credit control, and the money the reps collect.
 *
 * - A rep is a user of the company with a van (a warehouse of its own, loaded from a main warehouse with a transfer and
 *   unloaded back the same way: stock-docs.ts posts both, with their entry when the two warehouses' accounts differ) and
 *   a cash account of their own (a safe under 18) that what they collect goes into.
 * - A route is the rep's shop customers for each weekday, in visiting order. A visit records what happened at a shop
 *   (an order, nothing, closed, money collected); the visits report sets them against the route's plan.
 * - A sales order is taken for a shop by a rep (only for a shop on their own route) or by the office. Approving it is
 *   the office's: never a rep's, never the person who took it when the company separates duties. Approval checks the
 *   customer's credit limit and overdue balance by the company's rules (warn, or block unless an admin overrides it,
 *   with a reason, in the audit log). Delivering it makes and posts the sale invoice, on credit, from the van or the
 *   warehouse the order names; the invoice is the document of record (its entry, its stock moves, its returns).
 * - A collection is a receipt voucher into the rep's cash account (Dr rep's cash / Cr the customer), made as every
 *   document's receipt is (journal.ts postDocumentVoucher: posted at once, or waiting for approval when the company asks
 *   for it); only approved ones count. A handover moves the approved, not yet handed collections of one rep and one
 *   currency to the office's safe with another such receipt (Dr office safe / Cr rep's cash).
 * - At the end of a day the van is counted: expected = what was in it before the day + loaded − unloaded − sold +
 *   returned ± anything else; closing the count (the stock team, not the rep) makes a draft stock adjustment (reason
 *   "count") of the differences, posted on the adjustments page like any other.
 *
 * A rep (a user with a rep record who is not an admin and does not keep the books) sees only their own route's
 * customers, orders, van and collections. No answer carries cost or stock value: quantities and sale prices only.
 * The phone app (not released yet) would call the same routes: the rep's day, an order, a visit and a collection.
 */

export type WsOutcome = 'order' | 'no_order' | 'closed' | 'collected';
export type WsOrderStatus = 'draft' | 'approved' | 'delivered' | 'cancelled';
export type WsPolicy = 'off' | 'warn' | 'block';

export interface WsSettings {
  /** over the credit limit: warn (the order goes through, marked), or block (an admin may override it with a reason) */
  creditPolicy: Exclude<WsPolicy, 'off'>;
  /** a customer is overdue when the oldest part of what they owe is older than this many days */
  overdueDays: number;
  overduePolicy: WsPolicy;
  /** the office's safe a handover goes into (empty: asked each time) */
  officeCashAccount: string;
  /** what a van's shortage at its count is charged to (empty: the count's own account, as any stock count) */
  vanShortAccount: string;
}

export const DEFAULT_WS_SETTINGS: WsSettings = { creditPolicy: 'block', overdueDays: 60, overduePolicy: 'warn', officeCashAccount: '', vanShortAccount: '' };
const SETTINGS_KEY = 'wholesale_settings';

export interface RepView {
  id: string; userId: string; userName: string; name: string; warehouseId: string; warehouseName: Names; loadWarehouseId: string;
  cashAccount: string; active: boolean; stops: number;
}
export interface StopView { id: string; weekday: number; seq: number; partyId: string; partyName: string; partyCode: string; phone: string; address: string }
export interface CreditState {
  partyId: string; balance: number; limit: number | null; overLimit: boolean; oldestDays: number; overdue: boolean;
  /** what the rules say for this customer now: ok, warn or block (block: an admin may override) */
  verdict: 'ok' | 'warn' | 'block';
  reasons: ('over_limit' | 'overdue')[];
}
export interface OrderLineView { lineNo: number; itemId: string; itemCode: string; itemName: Names; qtyMilli: number; unit: string | null; unitQtyMilli: number | null; unitPrice: number; amount: number }
export interface OrderView {
  id: string; number: string; repId: string | null; repName: string | null; partyId: string; partyName: string; date: string; warehouseId: string;
  currency: CurrencyCode; rateX100: number; status: WsOrderStatus; total: number; limitCheck: 'ok' | 'warn' | 'override' | null;
  overrideBy: string | null; overrideReason: string | null; approvedBy: string | null; approvedAt: string | null;
  invoiceId: string | null; invoiceNumber: string | null; notes: string; createdBy: string; createdAt: string; lines: OrderLineView[];
  actions: ('edit' | 'approve' | 'deliver' | 'cancel')[];
}
export interface VanRow {
  itemId: string; code: string; name: Names; unit: string;
  opening: number; loaded: number; unloaded: number; sold: number; returned: number; other: number; expected: number; counted: number | null;
}
export interface VanDay { repId: string; date: string; status: 'none' | 'open' | 'closed'; adjustmentId: string | null; rows: VanRow[] }
export interface CollectionView {
  id: string; number: string; repId: string; repName: string; partyId: string; partyName: string; date: string; currency: CurrencyCode; rateX100: number;
  amount: number; entryId: string | null; state: 'approved' | 'waiting' | 'rejected'; handoverId: string | null; notes: string; createdBy: string;
}
export interface HandoverView {
  id: string; number: string; repId: string; repName: string; date: string; toAccount: string; currency: CurrencyCode; amount: number;
  entryId: string | null; state: 'approved' | 'waiting' | 'rejected'; collections: number; createdBy: string; createdAt: string;
}

const now = () => new Date().toISOString();
const MAX_AMOUNT = 1_000_000_000_000_000;

export const wholesaleAvailable = (db: Db): boolean => planStatus(db).features.includes('wholesale');
function requirePlan(db: Db): void {
  if (!wholesaleAvailable(db)) throw conflict('plan_limit', { limit: 'wholesale' });
}

function assertDate(db: Db, date: string): void {
  if (!isIsoDate(date)) throw invalid([{ code: 'date_invalid', field: 'date' }]);
  if (isPeriodLocked(db, date)) throw invalid([{ code: 'period_locked', period: date.slice(0, 7) }]);
}

// ——— who sees what ———

/** The office: an admin, or someone who keeps the books. Everyone else with a rep record is a rep, scoped to their own. */
const isOffice = (actor: Actor) => actor.permissions.includes('admin') || seesBooks(actor);

interface RepRow { id: string; user_id: string; name: string; warehouse_id: string; load_warehouse_id: string; cash_account: string; active: number; created_at: string; updated_at: string }

/** The rep record of a user who works as a rep (not the office): their reads and changes are limited to their own. */
export function ownRep(db: Db, actor: Actor): RepRow | null {
  if (!actor.id || isOffice(actor)) return null;
  return (db.prepare('SELECT * FROM ws_reps WHERE user_id = ? AND active = 1').get(actor.id) as RepRow | undefined) ?? null;
}

function repRow(db: Db, id: string): RepRow {
  const row = db.prepare('SELECT * FROM ws_reps WHERE id = ?').get(id) as RepRow | undefined;
  if (!row) throw notFound('rep');
  return row;
}

/** A rep reads and works only their own record; the office any. */
function repFor(db: Db, id: string, actor: Actor): RepRow {
  const row = repRow(db, id);
  const own = ownRep(db, actor);
  if (own && own.id !== row.id) throw notFound('rep');
  return row;
}

/** The customers on a rep's route (any weekday). */
function routeParties(db: Db, repId: string): Set<string> {
  return new Set((db.prepare('SELECT DISTINCT party_id FROM ws_route_stops WHERE rep_id = ?').all(repId) as { party_id: string }[]).map((r) => r.party_id));
}

/** A rep may only work with the shops on their own route. */
function assertPartyForRep(db: Db, rep: RepRow | null, partyId: string): void {
  if (rep && !routeParties(db, rep.id).has(partyId)) throw new AppError(403, 'party_not_on_route');
}

function assertCustomer(db: Db, partyId: string): void {
  const p = db.prepare('SELECT type, active FROM parties WHERE id = ?').get(partyId) as { type: string; active: number } | undefined;
  if (!p || p.type !== 'customer' || p.active !== 1) throw invalid([{ code: 'party_invalid' }]);
}

function assertCashAccount(db: Db, code: string, field: string): void {
  const account = loadAccounts(db).find((a) => a.code === code);
  if (!account || !account.postable || !code.startsWith('18')) throw invalid([{ code: 'account_invalid', field }]);
}

function assertWarehouse(db: Db, id: string, field: string): void {
  const w = db.prepare('SELECT active FROM warehouses WHERE id = ?').get(id) as { active: number } | undefined;
  if (!w || w.active !== 1) throw invalid([{ code: 'warehouse_invalid', field }]);
}

// ——— settings ———

export function wholesaleSettings(db: Db): WsSettings {
  try {
    const raw = JSON.parse(readSetting(db, SETTINGS_KEY) ?? '{}') as Partial<WsSettings>;
    return { ...DEFAULT_WS_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_WS_SETTINGS };
  }
}

export function updateWholesaleSettings(db: Db, patch: Partial<WsSettings>, actor: Actor): WsSettings {
  requirePlan(db);
  const next = { ...wholesaleSettings(db), ...patch };
  if (next.officeCashAccount) assertCashAccount(db, next.officeCashAccount, 'officeCashAccount');
  if (next.vanShortAccount) {
    const a = loadAccounts(db).find((x) => x.code === next.vanShortAccount);
    if (!a || !a.postable) throw invalid([{ code: 'account_invalid', field: 'vanShortAccount' }]);
  }
  writeSetting(db, SETTINGS_KEY, JSON.stringify(next));
  audit(db, actor.name, 'update', 'wholesale_settings', null, patch);
  return next;
}

// ——— reps and routes ———

function repView(db: Db, r: RepRow): RepView {
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(r.user_id) as { name: string } | undefined;
  const w = db.prepare('SELECT name_ar, name_en, name_ku FROM warehouses WHERE id = ?').get(r.warehouse_id) as { name_ar: string; name_en: string; name_ku: string };
  const stops = (db.prepare('SELECT COUNT(*) AS n FROM ws_route_stops WHERE rep_id = ?').get(r.id) as { n: number }).n;
  return {
    id: r.id, userId: r.user_id, userName: user?.name ?? '', name: r.name, warehouseId: r.warehouse_id, warehouseName: { ar: w.name_ar, en: w.name_en, ku: w.name_ku },
    loadWarehouseId: r.load_warehouse_id, cashAccount: r.cash_account, active: r.active === 1, stops: Number(stops)
  };
}

export function listReps(db: Db, actor: Actor): RepView[] {
  const own = ownRep(db, actor);
  const rows = own ? [own] : db.prepare('SELECT * FROM ws_reps ORDER BY active DESC, name').all() as unknown as RepRow[];
  return rows.map((r) => repView(db, r));
}

export interface RepInput { userId: string; name: string; warehouseId: string; loadWarehouseId: string; cashAccount: string; active?: boolean | undefined }

function assertRep(db: Db, input: RepInput, id: string | null): void {
  const user = db.prepare('SELECT active FROM users WHERE id = ?').get(input.userId) as { active: number } | undefined;
  if (!user) throw invalid([{ code: 'user_invalid', field: 'userId' }]);
  if (!input.name.trim()) throw invalid([{ code: 'name_required' }]);
  assertWarehouse(db, input.warehouseId, 'warehouseId');
  assertWarehouse(db, input.loadWarehouseId, 'loadWarehouseId');
  if (input.warehouseId === input.loadWarehouseId) throw invalid([{ code: 'ws_van_same_warehouse' }]);
  assertCashAccount(db, input.cashAccount, 'cashAccount');
  const taken = db.prepare('SELECT id FROM ws_reps WHERE (user_id = ? OR warehouse_id = ?) AND id <> ?').get(input.userId, input.warehouseId, id ?? '') as { id: string } | undefined;
  if (taken) throw conflict('ws_rep_taken');
  // a van is a rep's alone: never the warehouse the shop sells from at the till, nor another rep's cash
  const cashTaken = db.prepare('SELECT id FROM ws_reps WHERE cash_account = ? AND id <> ?').get(input.cashAccount, id ?? '');
  if (cashTaken) throw conflict('ws_cash_taken');
}

export function saveRep(db: Db, id: string | null, input: RepInput, actor: Actor): RepView {
  requirePlan(db);
  assertRep(db, input, id);
  const rid = id ?? randomUUID();
  transaction(db, () => {
    const t = now();
    if (id) {
      repRow(db, id);
      db.prepare('UPDATE ws_reps SET user_id = ?, name = ?, warehouse_id = ?, load_warehouse_id = ?, cash_account = ?, active = ?, updated_at = ? WHERE id = ?')
        .run(input.userId, input.name.trim(), input.warehouseId, input.loadWarehouseId, input.cashAccount, input.active === false ? 0 : 1, t, id);
    } else {
      db.prepare('INSERT INTO ws_reps (id, user_id, name, warehouse_id, load_warehouse_id, cash_account, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(rid, input.userId, input.name.trim(), input.warehouseId, input.loadWarehouseId, input.cashAccount, input.active === false ? 0 : 1, t, t);
    }
    audit(db, actor.name, id ? 'update' : 'create', 'ws_rep', rid, { userId: input.userId, warehouseId: input.warehouseId });
  });
  return repView(db, repRow(db, rid));
}

export function routeOf(db: Db, repId: string, actor: Actor): StopView[] {
  repFor(db, repId, actor);
  return (db.prepare(`SELECT s.id, s.weekday, s.seq, s.party_id, p.name, p.code, COALESCE(p.phone, '') AS phone, COALESCE(p.address, '') AS address
                      FROM ws_route_stops s JOIN parties p ON p.id = s.party_id WHERE s.rep_id = ? ORDER BY s.weekday, s.seq, p.name`).all(repId) as
    { id: string; weekday: number; seq: number; party_id: string; name: string; code: string; phone: string; address: string }[])
    .map((r) => ({ id: r.id, weekday: Number(r.weekday), seq: Number(r.seq), partyId: r.party_id, partyName: r.name, partyCode: r.code, phone: r.phone, address: r.address }));
}

/** Sets a rep's route for one weekday: the customers in visiting order (replaces that day's list). */
export function setRouteDay(db: Db, repId: string, weekday: number, partyIds: readonly string[], actor: Actor): StopView[] {
  requirePlan(db);
  repRow(db, repId);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw invalid([{ code: 'ws_weekday_invalid' }]);
  if (new Set(partyIds).size !== partyIds.length) throw invalid([{ code: 'ws_stop_twice' }]);
  for (const p of partyIds) assertCustomer(db, p);
  transaction(db, () => {
    db.prepare('DELETE FROM ws_route_stops WHERE rep_id = ? AND weekday = ?').run(repId, weekday);
    const insert = db.prepare('INSERT INTO ws_route_stops (id, rep_id, weekday, party_id, seq) VALUES (?, ?, ?, ?, ?)');
    partyIds.forEach((p, i) => insert.run(randomUUID(), repId, weekday, p, i));
    audit(db, actor.name, 'update', 'ws_route', repId, { weekday, stops: partyIds.length });
  });
  return routeOf(db, repId, actor);
}

// ——— credit control ———

/** Where a customer stands against the company's rules, with `adding` (IQD) more on their account. */
export function creditState(db: Db, partyId: string, adding = 0, date = todayIso()): CreditState {
  const s = wholesaleSettings(db);
  const party = getParty(db, partyId);
  const overLimit = party.creditLimit !== null && party.balance + adding > party.creditLimit;
  const row = s.overduePolicy === 'off' || s.overdueDays <= 0 ? undefined : aging(db, 'customer', date).find((r) => r.partyId === partyId);
  const oldestDays = row?.oldestDays ?? 0;
  const overdue = !!row && oldestDays > s.overdueDays;
  const reasons: CreditState['reasons'] = [];
  let verdict: CreditState['verdict'] = 'ok';
  const raise = (v: 'warn' | 'block') => { if (v === 'block' || verdict === 'ok') verdict = v; };
  if (overLimit) { reasons.push('over_limit'); raise(s.creditPolicy); }
  if (overdue) { reasons.push('overdue'); raise(s.overduePolicy === 'block' ? 'block' : 'warn'); }
  return { partyId, balance: party.balance, limit: party.creditLimit, overLimit, oldestDays, overdue, verdict, reasons };
}

// ——— sales orders ———

interface OrderRow {
  id: string; number: string; rep_id: string | null; party_id: string; date: string; warehouse_id: string; currency: CurrencyCode; rate_x100: number;
  status: WsOrderStatus; total: number; limit_check: 'ok' | 'warn' | 'override' | null; override_by: string | null; override_reason: string | null;
  approved_by: string | null; approved_at: string | null; invoice_id: string | null; notes: string | null; created_by: string; created_at: string; updated_at: string;
}

function orderRow(db: Db, id: string): OrderRow {
  const row = db.prepare('SELECT * FROM ws_orders WHERE id = ?').get(id) as OrderRow | undefined;
  if (!row) throw notFound('ws_order');
  return row;
}

function orderFor(db: Db, id: string, actor: Actor): OrderRow {
  const row = orderRow(db, id);
  const own = ownRep(db, actor);
  if (own && row.rep_id !== own.id) throw notFound('ws_order');
  return row;
}

function orderActions(db: Db, r: OrderRow, actor: Actor): OrderView['actions'] {
  const rep = ownRep(db, actor);
  const mayApprove = !rep && (actor.permissions.includes('admin') || actor.permissions.includes('sales'));
  if (r.status === 'draft') return ['edit', ...(mayApprove ? ['approve' as const] : []), 'cancel'];
  if (r.status === 'approved') return [...(rep && r.warehouse_id !== rep.warehouse_id ? [] : ['deliver' as const]), ...(rep ? [] : ['cancel' as const])];
  return [];
}

function orderView(db: Db, r: OrderRow, actor: Actor): OrderView {
  const lines = (db.prepare(`SELECT l.line_no, l.item_id, i.code, i.name_ar, i.name_en, i.name_ku, l.qty_milli, l.unit, l.unit_qty_milli, l.unit_price, l.amount
                             FROM ws_order_lines l JOIN items i ON i.id = l.item_id WHERE l.order_id = ? ORDER BY l.line_no`).all(r.id) as
    { line_no: number; item_id: string; code: string; name_ar: string; name_en: string; name_ku: string; qty_milli: number; unit: string | null; unit_qty_milli: number | null; unit_price: number; amount: number }[])
    .map((l) => ({
      lineNo: Number(l.line_no), itemId: l.item_id, itemCode: l.code, itemName: { ar: l.name_ar, en: l.name_en, ku: l.name_ku }, qtyMilli: Number(l.qty_milli),
      unit: l.unit, unitQtyMilli: l.unit_qty_milli === null ? null : Number(l.unit_qty_milli), unitPrice: Number(l.unit_price), amount: Number(l.amount)
    }));
  const rep = r.rep_id ? db.prepare('SELECT name FROM ws_reps WHERE id = ?').get(r.rep_id) as { name: string } | undefined : undefined;
  const party = db.prepare('SELECT name FROM parties WHERE id = ?').get(r.party_id) as { name: string };
  const inv = r.invoice_id ? db.prepare('SELECT number FROM invoices WHERE id = ?').get(r.invoice_id) as { number: string | null } | undefined : undefined;
  return {
    id: r.id, number: r.number, repId: r.rep_id, repName: rep?.name ?? null, partyId: r.party_id, partyName: party.name, date: r.date, warehouseId: r.warehouse_id,
    currency: r.currency, rateX100: Number(r.rate_x100), status: r.status, total: Number(r.total), limitCheck: r.limit_check, overrideBy: r.override_by,
    overrideReason: r.override_reason, approvedBy: r.approved_by, approvedAt: r.approved_at, invoiceId: r.invoice_id, invoiceNumber: inv?.number ?? null,
    notes: r.notes ?? '', createdBy: r.created_by, createdAt: r.created_at, lines, actions: orderActions(db, r, actor)
  };
}

export function getOrder(db: Db, id: string, actor: Actor): OrderView {
  return orderView(db, orderFor(db, id, actor), actor);
}

export function listOrders(db: Db, f: { status?: WsOrderStatus | undefined; repId?: string | undefined; partyId?: string | undefined; from?: string | undefined; to?: string | undefined }, actor: Actor): OrderView[] {
  const own = ownRep(db, actor);
  const where: string[] = [];
  const params: string[] = [];
  const repId = own ? own.id : f.repId;
  if (repId) { where.push('rep_id = ?'); params.push(repId); }
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  if (f.partyId) { where.push('party_id = ?'); params.push(f.partyId); }
  if (f.from) { where.push('date >= ?'); params.push(f.from); }
  if (f.to) { where.push('date <= ?'); params.push(f.to); }
  const rows = db.prepare(`SELECT * FROM ws_orders${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY date DESC, number DESC LIMIT 500`).all(...params) as unknown as OrderRow[];
  return rows.map((r) => orderView(db, r, actor));
}

export interface OrderLineInput { itemId: string; qtyMilli?: number | undefined; unit?: string | undefined; unitQtyMilli?: number | undefined; unitPrice: number }
export interface OrderInput {
  partyId: string; date: string; warehouseId?: string | undefined; repId?: string | null | undefined; currency: CurrencyCode; rateX100: number;
  notes?: string | undefined; lines: OrderLineInput[];
}

/** The lines as the invoice will take them: base quantities worked out from each item's units (invoices.ts withUnits). */
function resolvedLines(db: Db, input: OrderInput, warehouseId: string) {
  const resolved = withUnits(db, {
    kind: 'sale', date: input.date, partyId: input.partyId, warehouseId, currency: input.currency, rateX100: input.rateX100, payment: 'credit', discount: 0,
    lines: input.lines.map((l) => ({ itemId: l.itemId, unitPrice: l.unitPrice, ...(l.unit ? { unit: l.unit, unitQtyMilli: l.unitQtyMilli } : { qtyMilli: l.qtyMilli }) }))
  } as Parameters<typeof withUnits>[1]);
  return resolved.lines;
}

function writeOrder(db: Db, id: string, input: OrderInput, warehouseId: string): number {
  if (!input.lines.length) throw invalid([{ code: 'lines_required' }]);
  if (input.lines.length > 300) throw invalid([{ code: 'lines_too_many' }]);
  const lines = resolvedLines(db, input, warehouseId);
  const errors: { code: string; line: number }[] = [];
  const findItem = db.prepare('SELECT active FROM items WHERE id = ?');
  lines.forEach((l, i) => {
    const item = findItem.get(l.itemId) as { active: number } | undefined;
    if (!item || item.active !== 1) errors.push({ code: 'item_invalid', line: i + 1 });
    if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0) errors.push({ code: 'line_qty_invalid', line: i + 1 });
    if (!Number.isSafeInteger(l.unitPrice) || l.unitPrice < 0) errors.push({ code: 'line_price_invalid', line: i + 1 });
  });
  if (errors.length) throw invalid(errors);
  const totals = invoiceTotals(lines, 0);
  if (totals.total <= 0 || totals.total > MAX_AMOUNT) throw invalid([{ code: 'total_invalid' }]);
  db.prepare('DELETE FROM ws_order_lines WHERE order_id = ?').run(id);
  const insert = db.prepare('INSERT INTO ws_order_lines (order_id, line_no, item_id, qty_milli, unit, unit_qty_milli, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  lines.forEach((l, i) => insert.run(id, i + 1, l.itemId, l.qtyMilli, l.unit ?? null, l.unit ? l.unitQtyMilli ?? null : null, l.unitPrice, totals.lineAmounts[i] ?? 0));
  return totals.total;
}

function assertOrderInput(db: Db, input: OrderInput): void {
  assertDate(db, input.date);
  assertCustomer(db, input.partyId);
  if (input.currency !== 'IQD' && input.currency !== 'USD') throw invalid([{ code: 'currency_invalid' }]);
  if (!Number.isSafeInteger(input.rateX100) || input.rateX100 <= 0 || (input.currency === 'IQD' && input.rateX100 !== 100)) throw invalid([{ code: 'rate_invalid' }]);
}

/** Who takes it and where it is delivered from: a rep for themselves (from their van unless they name the warehouse); the office as it says. */
function orderTarget(db: Db, input: OrderInput, actor: Actor): { repId: string | null; warehouseId: string } {
  const own = ownRep(db, actor);
  if (own) {
    assertPartyForRep(db, own, input.partyId);
    const warehouseId = input.warehouseId ?? own.warehouse_id;
    if (warehouseId !== own.warehouse_id && warehouseId !== own.load_warehouse_id) throw invalid([{ code: 'warehouse_invalid', field: 'warehouseId' }]);
    return { repId: own.id, warehouseId };
  }
  const repId = input.repId ?? null;
  if (repId) repRow(db, repId);
  const warehouseId = input.warehouseId ?? (repId ? repRow(db, repId).warehouse_id : null);
  if (!warehouseId) throw invalid([{ code: 'warehouse_invalid', field: 'warehouseId' }]);
  assertWarehouse(db, warehouseId, 'warehouseId');
  return { repId, warehouseId };
}

export function createOrder(db: Db, input: OrderInput, actor: Actor): OrderView {
  requirePlan(db);
  assertOrderInput(db, input);
  const target = orderTarget(db, input, actor);
  const id = randomUUID();
  transaction(db, () => {
    const t = now();
    const number = `SO-${input.date.slice(0, 4)}-${String(nextSequence(db, `ws_order:${input.date.slice(0, 4)}`)).padStart(5, '0')}`;
    db.prepare(`INSERT INTO ws_orders (id, number, rep_id, party_id, date, warehouse_id, currency, rate_x100, status, total, notes, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?, ?, ?)`)
      .run(id, number, target.repId, input.partyId, input.date, target.warehouseId, input.currency, input.rateX100, input.notes?.trim() || null, actor.name, t, t);
    const total = writeOrder(db, id, input, target.warehouseId);
    db.prepare('UPDATE ws_orders SET total = ? WHERE id = ?').run(total, id);
    audit(db, actor.name, 'create', 'ws_order', id, { number, partyId: input.partyId, repId: target.repId });
  });
  return getOrder(db, id, actor);
}

export function updateOrder(db: Db, id: string, input: OrderInput, actor: Actor): OrderView {
  requirePlan(db);
  const row = orderFor(db, id, actor);
  if (row.status !== 'draft') throw conflict('action_not_allowed', { status: row.status, action: 'edit' });
  assertOrderInput(db, input);
  const target = orderTarget(db, { ...input, repId: input.repId === undefined ? row.rep_id : input.repId }, actor);
  transaction(db, () => {
    const total = writeOrder(db, id, input, target.warehouseId);
    db.prepare(`UPDATE ws_orders SET party_id = ?, date = ?, rep_id = ?, warehouse_id = ?, currency = ?, rate_x100 = ?, total = ?, notes = ?, updated_at = ?
                WHERE id = ? AND status = 'draft'`)
      .run(input.partyId, input.date, target.repId, target.warehouseId, input.currency, input.rateX100, total, input.notes?.trim() || null, now(), id);
    audit(db, actor.name, 'update', 'ws_order', id);
  });
  return getOrder(db, id, actor);
}

/** A limit check that needs an admin's word: a reason, kept with the order and in the audit log. */
export interface Override { reason: string }

function checkCredit(db: Db, row: OrderRow, override: Override | undefined, actor: Actor, step: 'approve' | 'deliver'): 'ok' | 'warn' | 'override' {
  const state = creditState(db, row.party_id, toBase(row.total, row.currency, row.rate_x100), row.date);
  if (state.verdict === 'ok') return 'ok';
  if (state.verdict === 'warn') return 'warn';
  if (!override) throw conflict('ws_credit_blocked', { reasons: state.reasons, balance: state.balance, limit: state.limit, oldestDays: state.oldestDays });
  if (!actor.permissions.includes('admin')) throw new AppError(403, 'ws_override_admin_only');
  const reason = override.reason.trim();
  if (!reason) throw invalid([{ code: 'reason_required' }]);
  audit(db, actor.name, 'ws_credit_override', 'ws_order', row.id, { step, reasons: state.reasons, balance: state.balance, limit: state.limit, oldestDays: state.oldestDays, reason });
  return 'override';
}

export function approveOrder(db: Db, id: string, override: Override | undefined, actor: Actor): OrderView {
  requirePlan(db);
  const row = orderFor(db, id, actor);
  if (ownRep(db, actor)) throw new AppError(403, 'ws_rep_cannot_approve');
  if (row.status !== 'draft') throw conflict('action_not_allowed', { status: row.status, action: 'approve' });
  // under "separate duties" whoever took the order does not approve it
  if (readSetting(db, 'separate_duties') === '1' && row.created_by === actor.name && !actor.permissions.includes('admin')) throw conflict('ws_approve_own');
  transaction(db, () => {
    const check = checkCredit(db, row, override, actor, 'approve');
    const res = db.prepare(`UPDATE ws_orders SET status = 'approved', limit_check = ?, override_by = ?, override_reason = ?, approved_by = ?, approved_at = ?, updated_at = ?
                            WHERE id = ? AND status = 'draft'`)
      .run(check, check === 'override' ? actor.name : null, check === 'override' ? override!.reason.trim() : null, actor.name, now(), now(), id);
    if (Number(res.changes) !== 1) throw conflict('action_not_allowed', { status: row.status, action: 'approve' });
    audit(db, actor.name, 'approve', 'ws_order', id, { limitCheck: check });
  });
  return getOrder(db, id, actor);
}

/**
 * Delivers an approved order: the sale invoice is made from its lines (on credit, from the order's warehouse) and posted.
 * The customer is checked again (things change between approval and the van): what was approved over a warning or by an
 * admin's override is let through the invoice's own limit check; something new that blocks needs an admin's override now.
 */
export function deliverOrder(db: Db, id: string, input: { date?: string | undefined; override?: Override | undefined }, actor: Actor): OrderView {
  requirePlan(db);
  const row = orderFor(db, id, actor);
  if (row.status !== 'approved') throw conflict('action_not_allowed', { status: row.status, action: 'deliver' });
  const own = ownRep(db, actor);
  // a rep delivers from their own van; the warehouse's orders are the warehouse's to deliver
  if (own && row.warehouse_id !== own.warehouse_id) throw new AppError(403, 'ws_deliver_from_van_only');
  const date = input.date ?? todayIso();
  assertDate(db, date);
  transaction(db, () => {
    let check = row.limit_check ?? 'ok';
    // an admin's override at approval stands for the delivery; anything else is checked again as things are now
    const now2 = check === 'override' ? 'ok' : checkCredit(db, { ...row, date }, input.override, actor, 'deliver');
    if (now2 === 'override') check = 'override';
    else if (now2 === 'warn' && check === 'ok') check = 'warn';
    const lines = db.prepare('SELECT item_id, qty_milli, unit, unit_qty_milli, unit_price FROM ws_order_lines WHERE order_id = ? ORDER BY line_no').all(id) as
      { item_id: string; qty_milli: number; unit: string | null; unit_qty_milli: number | null; unit_price: number }[];
    const invoice = createInvoice(db, {
      kind: 'sale', date, partyId: row.party_id, warehouseId: row.warehouse_id, currency: row.currency, rateX100: Number(row.rate_x100), payment: 'credit', discount: 0,
      notes: row.number,
      lines: lines.map((l) => ({ itemId: l.item_id, unitPrice: Number(l.unit_price), ...(l.unit ? { unit: l.unit, unitQtyMilli: Number(l.unit_qty_milli) } : { qtyMilli: Number(l.qty_milli) }) }))
    } as Parameters<typeof createInvoice>[1], actor.name);
    postInvoice(db, invoice.id, actor.name, { allowOverLimit: check !== 'ok' });
    const res = db.prepare(`UPDATE ws_orders SET status = 'delivered', invoice_id = ?, limit_check = ?, override_by = COALESCE(?, override_by),
                              override_reason = COALESCE(?, override_reason), updated_at = ? WHERE id = ? AND status = 'approved'`)
      .run(invoice.id, check, now2 === 'override' ? actor.name : null, now2 === 'override' ? input.override!.reason.trim() : null, now(), id);
    if (Number(res.changes) !== 1) throw conflict('action_not_allowed', { status: row.status, action: 'deliver' });
    audit(db, actor.name, 'deliver', 'ws_order', id, { invoiceId: invoice.id });
  });
  return getOrder(db, id, actor);
}

export function cancelOrder(db: Db, id: string, reason: string, actor: Actor): OrderView {
  const row = orderFor(db, id, actor);
  const own = ownRep(db, actor);
  if (row.status === 'delivered' || row.status === 'cancelled') throw conflict('action_not_allowed', { status: row.status, action: 'cancel' });
  // an approved order is the office's: a rep cancels only their own drafts
  if (own && row.status !== 'draft') throw new AppError(403, 'ws_rep_cannot_cancel');
  transaction(db, () => {
    db.prepare("UPDATE ws_orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('draft', 'approved')").run(now(), id);
    audit(db, actor.name, 'cancel', 'ws_order', id, { reason: reason.trim() || null });
  });
  return getOrder(db, id, actor);
}

// ——— visits ———

export function recordVisit(db: Db, input: { repId?: string | undefined; partyId: string; date: string; outcome: WsOutcome; notes?: string | undefined }, actor: Actor): { id: string } {
  requirePlan(db);
  if (!isIsoDate(input.date)) throw invalid([{ code: 'date_invalid' }]);
  const own = ownRep(db, actor);
  const repId = own ? own.id : input.repId;
  if (!repId) throw invalid([{ code: 'ws_rep_required' }]);
  repRow(db, repId);
  assertCustomer(db, input.partyId);
  assertPartyForRep(db, own, input.partyId);
  const id = randomUUID();
  db.prepare('INSERT INTO ws_visits (id, rep_id, party_id, date, outcome, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, repId, input.partyId, input.date, input.outcome, input.notes?.trim() || null, actor.name, now());
  return { id };
}

/** A rep's day: the route's shops for that weekday, in order, each with today's visit, its credit state and open orders. */
export function repDay(db: Db, repId: string, date: string, actor: Actor) {
  const rep = repFor(db, repId, actor);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const stops = routeOf(db, rep.id, actor).filter((s) => s.weekday === weekday);
  const visits = db.prepare('SELECT party_id, outcome FROM ws_visits WHERE rep_id = ? AND date = ?').all(rep.id, date) as { party_id: string; outcome: WsOutcome }[];
  return {
    repId: rep.id, date, weekday,
    stops: stops.map((s) => {
      const c = creditState(db, s.partyId, 0, date);
      return { ...s, visits: visits.filter((v) => v.party_id === s.partyId).map((v) => v.outcome), balance: c.balance, limit: c.limit, overLimit: c.overLimit, overdue: c.overdue, oldestDays: c.oldestDays };
    })
  };
}

// ——— van stock: loads, unloads and the day's count ———

export function moveVan(db: Db, repId: string, input: { direction: 'load' | 'unload'; date: string; notes?: string | undefined; lines: { itemId: string; qtyMilli?: number | undefined; unit?: string | undefined; unitQtyMilli?: number | undefined }[] }, actor: Actor): { id: string; number: string | null } {
  requirePlan(db);
  const rep = repRow(db, repId);
  if (ownRep(db, actor)) throw new AppError(403, 'ws_rep_cannot_load');
  assertDate(db, input.date);
  if (!input.lines.length) throw invalid([{ code: 'lines_required' }]);
  const from = input.direction === 'load' ? rep.load_warehouse_id : rep.warehouse_id;
  const to = input.direction === 'load' ? rep.warehouse_id : rep.load_warehouse_id;
  let out: { id: string; number: string | null } = { id: '', number: null };
  transaction(db, () => {
    const doc = createStockDoc(db, {
      kind: 'transfer', date: input.date, warehouseId: from, toWarehouseId: to, notes: input.notes?.trim() || `${input.direction === 'load' ? 'Van load' : 'Van unload'}: ${rep.name}`,
      lines: input.lines.map((l) => (l.unit ? { itemId: l.itemId, unit: l.unit, unitQtyMilli: l.unitQtyMilli } : { itemId: l.itemId, qtyMilli: l.qtyMilli }))
    } as Parameters<typeof createStockDoc>[1], actor.name);
    const posted = postStockDoc(db, doc.id, actor.name, actor);
    out = { id: posted.id, number: posted.number };
    if (input.direction === 'load') audit(db, actor.name, 'ws_load', 'ws_rep', rep.id, { stockDocId: doc.id });
    else audit(db, actor.name, 'ws_unload', 'ws_rep', rep.id, { stockDocId: doc.id });
  });
  return out;
}

export function vanMoves(db: Db, repId: string, actor: Actor): { id: string; number: string | null; date: string; direction: 'load' | 'unload'; status: string }[] {
  const rep = repFor(db, repId, actor);
  return (db.prepare(`SELECT id, number, date, warehouse_id, status FROM stock_docs WHERE kind = 'transfer' AND (to_warehouse_id = ? OR warehouse_id = ?)
                      ORDER BY date DESC, number DESC LIMIT 200`).all(rep.warehouse_id, rep.warehouse_id) as { id: string; number: string | null; date: string; warehouse_id: string; status: string }[])
    .map((r) => ({ id: r.id, number: r.number, date: r.date, direction: r.warehouse_id === rep.warehouse_id ? 'unload' as const : 'load' as const, status: r.status }));
}

function bucket(source: string): keyof Pick<VanRow, 'loaded' | 'unloaded' | 'sold' | 'returned' | 'other'> | 'transfer' {
  if (source === 'transfer' || source === 'transfer_cancel') return 'transfer';
  if (source === 'sale' || source === 'sale_cancel') return 'sold';
  if (source === 'sale_return' || source === 'sale_return_cancel') return 'returned';
  return 'other';
}

interface CountRow { id: string; rep_id: string; date: string; status: 'open' | 'closed'; adjustment_id: string | null }

/** The van on a day, item by item: what it held before, what moved that day, what it should hold, and what was counted. */
export function vanDay(db: Db, repId: string, date: string, actor: Actor): VanDay {
  const rep = repFor(db, repId, actor);
  if (!isIsoDate(date)) throw invalid([{ code: 'date_invalid' }]);
  const rows = new Map<string, VanRow>();
  const items = db.prepare('SELECT code, name_ar, name_en, name_ku, unit FROM items WHERE id = ?');
  const rowOf = (itemId: string): VanRow => {
    let r = rows.get(itemId);
    if (!r) {
      const i = items.get(itemId) as { code: string; name_ar: string; name_en: string; name_ku: string; unit: string };
      r = { itemId, code: i.code, name: { ar: i.name_ar, en: i.name_en, ku: i.name_ku }, unit: i.unit, opening: 0, loaded: 0, unloaded: 0, sold: 0, returned: 0, other: 0, expected: 0, counted: null };
      rows.set(itemId, r);
    }
    return r;
  };
  for (const m of db.prepare('SELECT item_id, SUM(qty_milli) AS q FROM stock_moves WHERE warehouse_id = ? AND date < ? GROUP BY item_id').all(rep.warehouse_id, date) as { item_id: string; q: number }[]) {
    if (Number(m.q) !== 0) rowOf(m.item_id).opening = Number(m.q);
  }
  for (const m of db.prepare('SELECT item_id, source_type, qty_milli FROM stock_moves WHERE warehouse_id = ? AND date = ?').all(rep.warehouse_id, date) as { item_id: string; source_type: string; qty_milli: number }[]) {
    const r = rowOf(m.item_id);
    const q = Number(m.qty_milli);
    const b = bucket(m.source_type);
    if (b === 'transfer') { if (q > 0) r.loaded += q; else r.unloaded -= q; }
    else if (b === 'sold') r.sold -= q;
    else if (b === 'returned') r.returned += q;
    else r.other += q;
  }
  const count = db.prepare('SELECT id, rep_id, date, status, adjustment_id FROM ws_van_counts WHERE rep_id = ? AND date = ?').get(rep.id, date) as CountRow | undefined;
  const counted = count ? db.prepare('SELECT item_id, expected_milli, counted_milli FROM ws_van_count_lines WHERE count_id = ?').all(count.id) as { item_id: string; expected_milli: number; counted_milli: number }[] : [];
  for (const c of counted) rowOf(c.item_id).counted = Number(c.counted_milli);
  for (const r of rows.values()) r.expected = r.opening + r.loaded - r.unloaded - r.sold + r.returned + r.other;
  // a closed count keeps what was expected when it was closed (what the adjustment was made from)
  if (count?.status === 'closed') for (const c of counted) rowOf(c.item_id).expected = Number(c.expected_milli);
  const list = [...rows.values()].filter((r) => r.opening || r.loaded || r.unloaded || r.sold || r.returned || r.other || r.counted !== null).sort((a, b) => a.code.localeCompare(b.code));
  return { repId: rep.id, date, status: count?.status ?? 'none', adjustmentId: count?.adjustment_id ?? null, rows: list };
}

/** The rep (or the stock team) types what is in the van; saved as typed, until the count is closed. */
export function saveVanCount(db: Db, repId: string, input: { date: string; lines: { itemId: string; countedMilli: number }[] }, actor: Actor): VanDay {
  requirePlan(db);
  const rep = repFor(db, repId, actor);
  if (!isIsoDate(input.date)) throw invalid([{ code: 'date_invalid' }]);
  const errors: { code: string; line: number }[] = [];
  input.lines.forEach((l, i) => { if (!Number.isSafeInteger(l.countedMilli) || l.countedMilli < 0) errors.push({ code: 'line_qty_invalid', line: i + 1 }); });
  if (errors.length) throw invalid(errors);
  transaction(db, () => {
    let count = db.prepare('SELECT id, status FROM ws_van_counts WHERE rep_id = ? AND date = ?').get(rep.id, input.date) as { id: string; status: string } | undefined;
    if (count?.status === 'closed') throw conflict('ws_count_closed');
    if (!count) {
      count = { id: randomUUID(), status: 'open' };
      db.prepare("INSERT INTO ws_van_counts (id, rep_id, date, status, created_by, created_at) VALUES (?, ?, ?, 'open', ?, ?)").run(count.id, rep.id, input.date, actor.name, now());
    }
    const day = vanDay(db, rep.id, input.date, actor);
    const expected = new Map(day.rows.map((r) => [r.itemId, r.expected]));
    const del = db.prepare('DELETE FROM ws_van_count_lines WHERE count_id = ? AND item_id = ?');
    const ins = db.prepare('INSERT INTO ws_van_count_lines (count_id, item_id, expected_milli, counted_milli) VALUES (?, ?, ?, ?)');
    const items = db.prepare('SELECT 1 FROM items WHERE id = ?');
    input.lines.forEach((l, i) => {
      if (!items.get(l.itemId)) throw invalid([{ code: 'item_invalid', line: i + 1 }]);
      del.run(count!.id, l.itemId);
      ins.run(count!.id, l.itemId, expected.get(l.itemId) ?? 0, l.countedMilli);
    });
    audit(db, actor.name, 'update', 'ws_van_count', count.id, { lines: input.lines.length });
  });
  return vanDay(db, rep.id, input.date, actor);
}

/**
 * Closes the day's count (the stock team or an admin, never the rep): what was expected is kept, and the differences
 * become a draft stock adjustment of the van (reason "count"; a shortage charged to the account set for it), which the
 * stock team posts on the adjustments page. Items in the van that were not counted count as zero.
 */
export function closeVanCount(db: Db, repId: string, date: string, actor: Actor): VanDay {
  requirePlan(db);
  const rep = repRow(db, repId);
  if (ownRep(db, actor)) throw new AppError(403, 'ws_rep_cannot_close_count');
  const count = db.prepare('SELECT id, status FROM ws_van_counts WHERE rep_id = ? AND date = ?').get(rep.id, date) as { id: string; status: string } | undefined;
  if (!count) throw notFound('ws_van_count');
  if (count.status === 'closed') throw conflict('ws_count_closed');
  assertDate(db, date);
  transaction(db, () => {
    const day = vanDay(db, rep.id, date, actor);
    const ins = db.prepare('INSERT INTO ws_van_count_lines (count_id, item_id, expected_milli, counted_milli) VALUES (?, ?, ?, ?)');
    const upd = db.prepare('UPDATE ws_van_count_lines SET expected_milli = ? WHERE count_id = ? AND item_id = ?');
    const lines: { itemId: string; qtyMilli: number }[] = [];
    for (const r of day.rows) {
      if (r.counted === null) ins.run(count.id, r.itemId, r.expected, 0);
      else upd.run(r.expected, count.id, r.itemId);
      const diff = (r.counted ?? 0) - r.expected;
      if (diff !== 0) lines.push({ itemId: r.itemId, qtyMilli: diff });
    }
    let adjustmentId: string | null = null;
    if (lines.length) {
      const short = wholesaleSettings(db).vanShortAccount;
      const adj = createAdjustment(db, {
        date, warehouseId: rep.warehouse_id, reason: 'count', notes: `Van count: ${rep.name}`, lines,
        ...(short && lines.every((l) => l.qtyMilli < 0) ? { accountCode: short } : {})
      }, actor);
      adjustmentId = adj.id;
    }
    db.prepare("UPDATE ws_van_counts SET status = 'closed', adjustment_id = ?, closed_by = ?, closed_at = ? WHERE id = ? AND status = 'open'").run(adjustmentId, actor.name, now(), count.id);
    audit(db, actor.name, 'close', 'ws_van_count', count.id, { adjustmentId, differences: lines.length });
  });
  return vanDay(db, rep.id, date, actor);
}

// ——— collections and handovers ———

interface CollectionRow { id: string; number: string; rep_id: string; party_id: string; date: string; currency: CurrencyCode; rate_x100: number; amount: number; entry_id: string | null; handover_id: string | null; notes: string | null; created_by: string }

function states(db: Db, ids: (string | null)[]): Map<string, { state: 'waiting' | 'rejected' }> {
  return documentVoucherStates(db, ids.filter((x): x is string => !!x)) as Map<string, { state: 'waiting' | 'rejected' }>;
}

export function listCollections(db: Db, f: { repId?: string | undefined; from?: string | undefined; to?: string | undefined; open?: boolean | undefined }, actor: Actor): CollectionView[] {
  const own = ownRep(db, actor);
  const where: string[] = [];
  const params: string[] = [];
  const repId = own ? own.id : f.repId;
  if (repId) { where.push('c.rep_id = ?'); params.push(repId); }
  if (f.from) { where.push('c.date >= ?'); params.push(f.from); }
  if (f.to) { where.push('c.date <= ?'); params.push(f.to); }
  const rows = db.prepare(`SELECT c.*, r.name AS rep_name, p.name AS party_name FROM ws_collections c JOIN ws_reps r ON r.id = c.rep_id JOIN parties p ON p.id = c.party_id
                           ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.date DESC, c.number DESC LIMIT 1000`).all(...params) as unknown as (CollectionRow & { rep_name: string; party_name: string })[];
  const st = states(db, rows.map((r) => r.entry_id));
  const handed = handedSet(db);
  const list = rows.map((r) => ({
    id: r.id, number: r.number, repId: r.rep_id, repName: r.rep_name, partyId: r.party_id, partyName: r.party_name, date: r.date, currency: r.currency,
    rateX100: Number(r.rate_x100), amount: Number(r.amount), entryId: r.entry_id, state: (r.entry_id ? st.get(r.entry_id)?.state : 'rejected') ?? 'approved' as const,
    handoverId: r.handover_id && handed.has(r.handover_id) ? r.handover_id : null, notes: r.notes ?? '', createdBy: r.created_by
  }));
  return f.open ? list.filter((c) => c.state === 'approved' && !c.handoverId) : list;
}

/** The handovers that stand: their receipt is approved or waiting (a rejected or deleted one frees its collections). */
function handedSet(db: Db): Set<string> {
  const rows = db.prepare('SELECT h.id, h.entry_id FROM ws_handovers h LEFT JOIN entries e ON e.id = h.entry_id WHERE e.id IS NOT NULL').all() as { id: string; entry_id: string }[];
  const st = states(db, rows.map((r) => r.entry_id));
  return new Set(rows.filter((r) => st.get(r.entry_id)?.state !== 'rejected').map((r) => r.id));
}

export function collect(db: Db, input: { repId?: string | undefined; partyId: string; date: string; currency: CurrencyCode; rateX100: number; amount: number; notes?: string | undefined }, actor: Actor): CollectionView {
  requirePlan(db);
  assertDate(db, input.date);
  const own = ownRep(db, actor);
  const repId = own ? own.id : input.repId;
  if (!repId) throw invalid([{ code: 'ws_rep_required' }]);
  const rep = repRow(db, repId);
  if (rep.active !== 1) throw invalid([{ code: 'ws_rep_inactive' }]);
  assertCustomer(db, input.partyId);
  assertPartyForRep(db, own, input.partyId);
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > MAX_AMOUNT) throw invalid([{ code: 'amount_invalid' }]);
  if (input.currency !== 'IQD' && input.currency !== 'USD') throw invalid([{ code: 'currency_invalid' }]);
  if (!Number.isSafeInteger(input.rateX100) || input.rateX100 <= 0 || (input.currency === 'IQD' && input.rateX100 !== 100)) throw invalid([{ code: 'rate_invalid' }]);
  const party = getParty(db, input.partyId);
  const id = randomUUID();
  transaction(db, () => {
    const number = `CL-${input.date.slice(0, 4)}-${String(nextSequence(db, `ws_collection:${input.date.slice(0, 4)}`)).padStart(5, '0')}`;
    const voucher = postDocumentVoucher(db, {
      kind: 'receipt', date: input.date, cashAccountCode: rep.cash_account, party: party.name, description: `${number} · ${rep.name}`,
      currency: input.currency, rateX100: input.rateX100, items: [{ accountCode: party.accountCode, amount: input.amount, partyId: party.id }]
    }, actor);
    db.prepare(`INSERT INTO ws_collections (id, number, rep_id, party_id, date, currency, rate_x100, amount, entry_id, notes, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, number, rep.id, party.id, input.date, input.currency, input.rateX100, input.amount, voucher.id, input.notes?.trim() || null, actor.name, now());
    audit(db, actor.name, 'create', 'ws_collection', id, { number, amount: input.amount, currency: input.currency, waiting: voucher.waiting });
  });
  return listCollections(db, { repId: rep.id }, actor).find((c) => c.id === id)!;
}

export function listHandovers(db: Db, f: { repId?: string | undefined }, actor: Actor): HandoverView[] {
  const own = ownRep(db, actor);
  const repId = own ? own.id : f.repId;
  const rows = db.prepare(`SELECT h.*, r.name AS rep_name, (SELECT COUNT(*) FROM ws_collections c WHERE c.handover_id = h.id) AS n
                           FROM ws_handovers h JOIN ws_reps r ON r.id = h.rep_id ${repId ? 'WHERE h.rep_id = ?' : ''} ORDER BY h.date DESC, h.number DESC LIMIT 500`)
    .all(...(repId ? [repId] : [])) as { id: string; number: string; rep_id: string; rep_name: string; date: string; to_account: string; currency: CurrencyCode; amount: number; entry_id: string | null; created_by: string; created_at: string; n: number }[];
  const st = states(db, rows.map((r) => r.entry_id));
  const exists = db.prepare('SELECT 1 FROM entries WHERE id = ?');
  return rows.map((r) => ({
    id: r.id, number: r.number, repId: r.rep_id, repName: r.rep_name, date: r.date, toAccount: r.to_account, currency: r.currency, amount: Number(r.amount),
    entryId: r.entry_id, state: r.entry_id && exists.get(r.entry_id) ? st.get(r.entry_id)?.state ?? 'approved' : 'rejected', collections: Number(r.n), createdBy: r.created_by, createdAt: r.created_at
  }));
}

/**
 * The office takes a rep's cash: every approved collection of that rep in that currency not handed over yet goes into the
 * office's safe with one receipt (Dr office safe / Cr the rep's cash account), at the rate given (dinars at 100).
 */
export function handOver(db: Db, input: { repId: string; date: string; currency: CurrencyCode; rateX100: number; toAccount?: string | undefined }, actor: Actor): HandoverView {
  requirePlan(db);
  if (!isOffice(actor)) throw new AppError(403, 'ws_handover_office_only');
  const rep = repRow(db, input.repId);
  assertDate(db, input.date);
  if (input.currency !== 'IQD' && input.currency !== 'USD') throw invalid([{ code: 'currency_invalid' }]);
  if (!Number.isSafeInteger(input.rateX100) || input.rateX100 <= 0 || (input.currency === 'IQD' && input.rateX100 !== 100)) throw invalid([{ code: 'rate_invalid' }]);
  const toAccount = input.toAccount || wholesaleSettings(db).officeCashAccount;
  if (!toAccount) throw invalid([{ code: 'account_invalid', field: 'toAccount' }]);
  assertCashAccount(db, toAccount, 'toAccount');
  if (toAccount === rep.cash_account) throw invalid([{ code: 'account_invalid', field: 'toAccount' }]);
  const id = randomUUID();
  transaction(db, () => {
    const open = listCollections(db, { repId: rep.id, open: true }, actor).filter((c) => c.currency === input.currency && c.date <= input.date);
    if (!open.length) throw conflict('ws_nothing_to_hand_over');
    const amount = open.reduce((s, c) => s + c.amount, 0);
    const number = `HO-${input.date.slice(0, 4)}-${String(nextSequence(db, `ws_handover:${input.date.slice(0, 4)}`)).padStart(5, '0')}`;
    const voucher = postDocumentVoucher(db, {
      kind: 'receipt', date: input.date, cashAccountCode: toAccount, description: `${number} · ${rep.name}`, currency: input.currency, rateX100: input.rateX100,
      items: [{ accountCode: rep.cash_account, amount }]
    }, actor);
    db.prepare(`INSERT INTO ws_handovers (id, number, rep_id, date, to_account, currency, rate_x100, amount, entry_id, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, number, rep.id, input.date, toAccount, input.currency, input.rateX100, amount, voucher.id, actor.name, now());
    const link = db.prepare('UPDATE ws_collections SET handover_id = ? WHERE id = ?');
    for (const c of open) link.run(id, c.id);
    audit(db, actor.name, 'create', 'ws_handover', id, { number, amount, currency: input.currency, collections: open.length });
  });
  return listHandovers(db, { repId: rep.id }, actor).find((h) => h.id === id)!;
}

// ——— reports ———

export function salesByRep(db: Db, from: string, to: string, actor: Actor) {
  const own = ownRep(db, actor);
  const rows = db.prepare(`SELECT o.rep_id, COALESCE(r.name, '') AS rep_name, o.date, i.currency, i.total, i.rate_x100
                           FROM ws_orders o JOIN invoices i ON i.id = o.invoice_id LEFT JOIN ws_reps r ON r.id = o.rep_id
                           WHERE o.status = 'delivered' AND i.status = 'posted' AND i.date >= ? AND i.date <= ?${own ? ' AND o.rep_id = ?' : ''}`)
    .all(from, to, ...(own ? [own.id] : [])) as { rep_id: string | null; rep_name: string; date: string; currency: CurrencyCode; total: number; rate_x100: number }[];
  const byRep = new Map<string, { repId: string | null; repName: string; orders: number; total: number; byWeekday: number[] }>();
  for (const r of rows) {
    const key = r.rep_id ?? '';
    const e = byRep.get(key) ?? { repId: r.rep_id, repName: r.rep_name, orders: 0, total: 0, byWeekday: [0, 0, 0, 0, 0, 0, 0] };
    const base = toBase(Number(r.total), r.currency, Number(r.rate_x100));
    e.orders += 1;
    e.total += base;
    e.byWeekday[new Date(`${r.date}T00:00:00Z`).getUTCDay()]! += base;
    byRep.set(key, e);
  }
  return [...byRep.values()].sort((a, b) => b.total - a.total);
}

export function collectionsReport(db: Db, from: string, to: string, actor: Actor) {
  const list = listCollections(db, { from, to }, actor).filter((c) => c.state === 'approved');
  const byRep = new Map<string, { repId: string; repName: string; IQD: number; USD: number; handedIQD: number; handedUSD: number; count: number }>();
  for (const c of list) {
    const e = byRep.get(c.repId) ?? { repId: c.repId, repName: c.repName, IQD: 0, USD: 0, handedIQD: 0, handedUSD: 0, count: 0 };
    e[c.currency] += c.amount;
    if (c.handoverId) e[c.currency === 'IQD' ? 'handedIQD' : 'handedUSD'] += c.amount;
    e.count += 1;
    byRep.set(c.repId, e);
  }
  return [...byRep.values()];
}

/** Visits planned by the routes against those made, by rep, over the days asked (at most a year). */
export function visitsReport(db: Db, from: string, to: string, actor: Actor) {
  const days: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`) && days.length < 366; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  return listReps(db, actor).map((rep) => {
    const stops = db.prepare('SELECT weekday, party_id FROM ws_route_stops WHERE rep_id = ?').all(rep.id) as { weekday: number; party_id: string }[];
    const visits = db.prepare('SELECT DISTINCT date, party_id FROM ws_visits WHERE rep_id = ? AND date >= ? AND date <= ?').all(rep.id, from, to) as { date: string; party_id: string }[];
    const made = new Set(visits.map((v) => `${v.date}|${v.party_id}`));
    let planned = 0;
    let done = 0;
    for (const d of days) {
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
      for (const s of stops) if (Number(s.weekday) === wd) { planned += 1; if (made.has(`${d}|${s.party_id}`)) done += 1; }
    }
    return { repId: rep.id, repName: rep.name, planned, done, unplanned: visits.length - done };
  });
}

/** Customers over their limit or overdue: the office's whole list, a rep's own route only. */
export function creditReport(db: Db, actor: Actor) {
  const own = ownRep(db, actor);
  const scope = own ? routeParties(db, own.id) : null;
  const ids = (db.prepare("SELECT id FROM parties WHERE type = 'customer' AND active = 1").all() as { id: string }[]).map((r) => r.id).filter((id) => !scope || scope.has(id));
  const s = wholesaleSettings(db);
  const aged = new Map(aging(db, 'customer', todayIso()).map((r) => [r.partyId, r.oldestDays]));
  const out: { partyId: string; name: string; balance: number; limit: number | null; overLimit: boolean; oldestDays: number; overdue: boolean }[] = [];
  for (const id of ids) {
    const p = getParty(db, id);
    const overLimit = p.creditLimit !== null && p.balance > p.creditLimit;
    const oldestDays = aged.get(id) ?? 0;
    const overdue = s.overdueDays > 0 && s.overduePolicy !== 'off' && oldestDays > s.overdueDays;
    if (overLimit || overdue) out.push({ partyId: id, name: p.name, balance: p.balance, limit: p.creditLimit, overLimit, oldestDays, overdue });
  }
  return out.sort((a, b) => b.balance - a.balance);
}

// ——— the API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => isIsoDate(s));
const id = z.string().min(1).max(64);
const idParam = z.object({ id }).strict();
const money = z.number().int().positive().max(MAX_AMOUNT);
const qty = z.number().int().positive().max(1_000_000_000_000);
const account = z.string().regex(/^\d{1,12}$/);
const currency = z.enum(['IQD', 'USD']);
const rate = z.number().int().positive().max(100_000_000);
const unit = z.string().min(1).max(20);
const override = z.object({ reason: z.string().min(1).max(300) }).strict();
const period = z.object({ from: isoDate.optional(), to: isoDate.optional() }).strict();
const stockLine = z.object({ itemId: id, qtyMilli: qty.optional(), unit: unit.optional(), unitQtyMilli: qty.optional() }).strict()
  .refine((l) => (l.unit ? l.unitQtyMilli !== undefined : l.qtyMilli !== undefined));
const orderBody = z.object({
  partyId: id, date: isoDate, warehouseId: id.optional(), repId: id.nullable().optional(), currency, rateX100: rate, notes: z.string().max(500).optional(),
  lines: z.array(z.object({ itemId: id, qtyMilli: qty.optional(), unit: unit.optional(), unitQtyMilli: qty.optional(), unitPrice: z.number().int().nonnegative().max(MAX_AMOUNT) }).strict()
    .refine((l) => (l.unit ? l.unitQtyMilli !== undefined : l.qtyMilli !== undefined))).min(1).max(300)
}).strict();
const repBody = z.object({ userId: id, name: z.string().min(1).max(100), warehouseId: id, loadWarehouseId: id, cashAccount: account, active: z.boolean().optional() }).strict();

const SALES = 'sales' as const;
const STOCK = 'stock' as const;
const ADMIN = 'admin' as const;

/** Reading needs sales, the books or an admin: a cashier at the till has nothing here. */
function mayRead(actor: Actor): void {
  if (!(actor.permissions.includes('sales') || isOffice(actor))) throw new AppError(403, 'forbidden');
}

export const wholesaleApi: ApiExtension = {
  rules: {
    'POST /api/wholesale/reps': ADMIN,
    'PUT /api/wholesale/reps/:id': ADMIN,
    'PUT /api/wholesale/reps/:id/route': ADMIN,
    'PUT /api/wholesale/settings': ADMIN,
    'POST /api/wholesale/orders': SALES,
    'PUT /api/wholesale/orders/:id': SALES,
    'POST /api/wholesale/orders/:id/approve': SALES,
    'POST /api/wholesale/orders/:id/deliver': SALES,
    'POST /api/wholesale/orders/:id/cancel': SALES,
    'POST /api/wholesale/visits': SALES,
    'POST /api/wholesale/collections': SALES,
    'POST /api/wholesale/handovers': null,
    'POST /api/wholesale/reps/:id/van': STOCK,
    'PUT /api/wholesale/reps/:id/van-count': SALES,
    'POST /api/wholesale/reps/:id/van-count/close': STOCK
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => { const a = actorOf(req); mayRead(a); return a; };
    return [
      { method: 'GET', path: '/api/wholesale/settings', handler: async (req) => { actor(req); return { available: wholesaleAvailable(db), settings: wholesaleSettings(db) }; } },
      {
        method: 'PUT', path: '/api/wholesale/settings',
        handler: async (req) => updateWholesaleSettings(db, parse(z.object({
          creditPolicy: z.enum(['warn', 'block']), overdueDays: z.number().int().min(0).max(3650), overduePolicy: z.enum(['off', 'warn', 'block']),
          officeCashAccount: account.or(z.literal('')), vanShortAccount: account.or(z.literal(''))
        }).partial().strict(), req.body), actor(req))
      },
      { method: 'GET', path: '/api/wholesale/reps', handler: async (req) => listReps(db, actor(req)) },
      {
        method: 'POST', path: '/api/wholesale/reps',
        handler: async (req, reply) => { reply.status(201).send(saveRep(db, null, parse(repBody, req.body), actor(req))); return undefined; }
      },
      { method: 'PUT', path: '/api/wholesale/reps/:id', handler: async (req) => saveRep(db, parse(idParam, req.params).id, parse(repBody, req.body), actor(req)) },
      { method: 'GET', path: '/api/wholesale/reps/:id/route', handler: async (req) => routeOf(db, parse(idParam, req.params).id, actor(req)) },
      {
        method: 'PUT', path: '/api/wholesale/reps/:id/route',
        handler: async (req) => {
          const body = parse(z.object({ weekday: z.number().int().min(0).max(6), partyIds: z.array(id).max(300) }).strict(), req.body);
          return setRouteDay(db, parse(idParam, req.params).id, body.weekday, body.partyIds, actor(req));
        }
      },
      {
        method: 'GET', path: '/api/wholesale/reps/:id/day',
        handler: async (req) => repDay(db, parse(idParam, req.params).id, parse(z.object({ date: isoDate.optional() }).strict(), req.query ?? {}).date ?? todayIso(), actor(req))
      },
      { method: 'GET', path: '/api/wholesale/reps/:id/van-moves', handler: async (req) => vanMoves(db, parse(idParam, req.params).id, actor(req)) },
      {
        method: 'POST', path: '/api/wholesale/reps/:id/van',
        handler: async (req, reply) => {
          const body = parse(z.object({ direction: z.enum(['load', 'unload']), date: isoDate, notes: z.string().max(300).optional(), lines: z.array(stockLine).min(1).max(300) }).strict(), req.body);
          reply.status(201).send(moveVan(db, parse(idParam, req.params).id, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'GET', path: '/api/wholesale/reps/:id/van-count',
        handler: async (req) => vanDay(db, parse(idParam, req.params).id, parse(z.object({ date: isoDate.optional() }).strict(), req.query ?? {}).date ?? todayIso(), actor(req))
      },
      {
        method: 'PUT', path: '/api/wholesale/reps/:id/van-count',
        handler: async (req) => saveVanCount(db, parse(idParam, req.params).id, parse(z.object({
          date: isoDate, lines: z.array(z.object({ itemId: id, countedMilli: z.number().int().min(0).max(1_000_000_000_000) }).strict()).max(1000)
        }).strict(), req.body), actor(req))
      },
      {
        method: 'POST', path: '/api/wholesale/reps/:id/van-count/close',
        handler: async (req) => closeVanCount(db, parse(idParam, req.params).id, parse(z.object({ date: isoDate }).strict(), req.body).date, actor(req))
      },
      {
        method: 'GET', path: '/api/wholesale/orders',
        handler: async (req) => listOrders(db, parse(z.object({
          status: z.enum(['draft', 'approved', 'delivered', 'cancelled']).optional(), repId: id.optional(), partyId: id.optional(), from: isoDate.optional(), to: isoDate.optional()
        }).strict(), req.query ?? {}), actor(req))
      },
      { method: 'GET', path: '/api/wholesale/orders/:id', handler: async (req) => getOrder(db, parse(idParam, req.params).id, actor(req)) },
      {
        method: 'POST', path: '/api/wholesale/orders',
        handler: async (req, reply) => { reply.status(201).send(createOrder(db, parse(orderBody, req.body) as OrderInput, actor(req))); return undefined; }
      },
      { method: 'PUT', path: '/api/wholesale/orders/:id', handler: async (req) => updateOrder(db, parse(idParam, req.params).id, parse(orderBody, req.body) as OrderInput, actor(req)) },
      {
        method: 'POST', path: '/api/wholesale/orders/:id/approve',
        handler: async (req) => approveOrder(db, parse(idParam, req.params).id, parse(z.object({ override: override.optional() }).strict(), req.body ?? {}).override, actor(req))
      },
      {
        method: 'POST', path: '/api/wholesale/orders/:id/deliver',
        handler: async (req) => deliverOrder(db, parse(idParam, req.params).id, parse(z.object({ date: isoDate.optional(), override: override.optional() }).strict(), req.body ?? {}), actor(req))
      },
      {
        method: 'POST', path: '/api/wholesale/orders/:id/cancel',
        handler: async (req) => cancelOrder(db, parse(idParam, req.params).id, parse(z.object({ reason: z.string().max(300).optional() }).strict(), req.body ?? {}).reason ?? '', actor(req))
      },
      {
        method: 'GET', path: '/api/wholesale/credit/:id',
        handler: async (req) => {
          const a = actor(req);
          const partyId = parse(idParam, req.params).id;
          if (!db.prepare("SELECT 1 FROM parties WHERE id = ? AND type = 'customer'").get(partyId)) throw notFound('party');
          assertPartyForRep(db, ownRep(db, a), partyId);
          return creditState(db, partyId, parse(z.object({ adding: z.coerce.number().int().min(0).max(MAX_AMOUNT).optional() }).strict(), req.query ?? {}).adding ?? 0);
        }
      },
      {
        method: 'POST', path: '/api/wholesale/visits',
        handler: async (req, reply) => {
          const body = parse(z.object({ repId: id.optional(), partyId: id, date: isoDate, outcome: z.enum(['order', 'no_order', 'closed', 'collected']), notes: z.string().max(300).optional() }).strict(), req.body);
          reply.status(201).send(recordVisit(db, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'GET', path: '/api/wholesale/collections',
        handler: async (req) => {
          const q = parse(z.object({ repId: id.optional(), from: isoDate.optional(), to: isoDate.optional(), open: z.enum(['1']).optional() }).strict(), req.query ?? {});
          return listCollections(db, { repId: q.repId, from: q.from, to: q.to, open: q.open === '1' }, actor(req));
        }
      },
      {
        method: 'POST', path: '/api/wholesale/collections',
        handler: async (req, reply) => {
          const body = parse(z.object({ repId: id.optional(), partyId: id, date: isoDate, currency, rateX100: rate, amount: money, notes: z.string().max(300).optional() }).strict(), req.body);
          reply.status(201).send(collect(db, body, actor(req)));
          return undefined;
        }
      },
      { method: 'GET', path: '/api/wholesale/handovers', handler: async (req) => listHandovers(db, parse(z.object({ repId: id.optional() }).strict(), req.query ?? {}), actor(req)) },
      {
        method: 'POST', path: '/api/wholesale/handovers',
        handler: async (req, reply) => {
          const body = parse(z.object({ repId: id, date: isoDate, currency, rateX100: rate, toAccount: account.optional() }).strict(), req.body);
          reply.status(201).send(handOver(db, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'GET', path: '/api/wholesale/reports',
        handler: async (req) => {
          const a = actor(req);
          const q = parse(period, req.query ?? {});
          // the month so far, unless a period is asked for
          const to = q.to ?? todayIso();
          const from = q.from ?? `${to.slice(0, 7)}-01`;
          if (from > to) throw invalid([{ code: 'period_invalid' }]);
          return { from, to, sales: salesByRep(db, from, to, a), collections: collectionsReport(db, from, to, a), visits: visitsReport(db, from, to, a), credit: creditReport(db, a) };
        }
      }
    ];
  }
};
