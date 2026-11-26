import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  isRsOrderKind, isRsStation, RS_KITCHEN_DONE_MINUTES, RS_KITCHEN_HOURS, RS_MAX_ADD, RS_MAX_GUESTS, RS_MAX_LINES, RS_MAX_NOTE, RS_MAX_QTY_MILLI, RS_STATIONS,
  RS_TICKET_MODES, rsLineAmount, type Names, type RsOrderKind, type RsStation, type RsTicketMode
} from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { planStatus } from './license.ts';
import { readSetting, writeSetting } from './settings.ts';
import { listRecipes, RECIPE_MAX_PARTS, saveRecipe } from './recipes.ts';
import { userBranchLists } from './branches.ts';
import { getShift, sell, type SaleInput, type ShiftView } from './pos.ts';
import { getInvoice, type InvoiceView } from './invoices.ts';
import { onceOnly } from './idempotency.ts';
import { parse } from './categories.ts';
import type { Actor, Permission } from './auth.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Restaurants and cafés (2.1, plan feature 'restaurant'). The dining room is areas (a family section among them) with
 * their tables; an order is a table's tab, or one to take away or to deliver. Its lines are the menu's items (real
 * items: sold, counted and reported on as any item is), each with a note for the kitchen ("no onion").
 *
 * - Sending to the kitchen gives the lines not sent yet a ticket number: the page prints that ticket on the kitchen's
 *   printer. A line sent is cooking: it is no longer changed or taken off, only cancelled by a supervisor, with a
 *   reason, and the kitchen gets a ticket saying so.
 * - The bill is printed as often as asked (shared evenly by the guests if they like); the table shows it was printed.
 * - Paying is the till's own sale on the cashier's open shift (pos.ts sell), in the same transaction as the order
 *   noting what it paid: all that is left, or some lines and quantities (each guest what they had), until nothing is
 *   left and the order closes. So the drawer, the receipt, the methods of payment, discounts with a supervisor's
 *   approval and the books are the till's, unchanged. A sale cancelled later leaves its lines unpaid again: an admin
 *   reopens the order to take the money again.
 * - Prices are in dinars, the item's price when the line is added (a dollar price at the company's rate, as the till
 *   reckons it), so a line never needs a supervisor at the till for a price nobody lowered.
 *
 * Reading needs no plan (a company whose licence ended still sees its orders); every change needs the plan. Taking
 * orders is for whoever sells at the till or on invoices ('pos' or 'sales'); paying is the cashier's, on their shift;
 * the room's areas and tables are an admin's.
 */

export const restaurantAvailable = (db: Db): boolean => planStatus(db).features.includes('restaurant');
function requirePlan(db: Db): void {
  if (!restaurantAvailable(db)) throw conflict('plan_limit', { limit: 'restaurant' });
}
const has = (actor: Actor, p: Permission) => actor.permissions.includes(p) || actor.permissions.includes('admin');
/** Whoever sells may take an order and send it to the kitchen. */
function requireWaiter(actor: Actor): void {
  if (!has(actor, 'pos') && !has(actor, 'sales')) throw new AppError(403, 'forbidden', { need: 'pos' });
}
/** Cancelling what the kitchen already has, or an order it is cooking for: a supervisor's (or an admin's). */
function requireSupervisor(actor: Actor): void {
  if (!has(actor, 'posSupervise')) throw new AppError(403, 'forbidden', { need: 'posSupervise' });
}

const names = (r: { name_ar: string; name_en: string; name_ku: string }): Names => ({ ar: r.name_ar, en: r.name_en, ku: r.name_ku });
const marks = (list: readonly unknown[]) => (list.length ? list.map(() => '?').join(', ') : 'NULL');
const now = () => new Date().toISOString();

/* ---------------- the room: areas and tables ---------------- */

export interface AreaView { id: string; name: Names; family: boolean; sort: number; active: boolean }
export interface TableView { id: string; areaId: string; name: string; seats: number; sort: number; active: boolean }

interface AreaRow { id: string; name_ar: string; name_en: string; name_ku: string; family: number; sort: number; active: number }
interface TableRow { id: string; area_id: string; name: string; seats: number; sort: number; active: number }
const toArea = (r: AreaRow): AreaView => ({ id: r.id, name: names(r), family: Number(r.family) === 1, sort: Number(r.sort), active: Number(r.active) === 1 });
const toTable = (r: TableRow): TableView => ({ id: r.id, areaId: r.area_id, name: r.name, seats: Number(r.seats), sort: Number(r.sort), active: Number(r.active) === 1 });

export function listAreas(db: Db): AreaView[] {
  return (db.prepare('SELECT * FROM rs_areas ORDER BY sort, name_en, id').all() as unknown as AreaRow[]).map(toArea);
}
export function listTables(db: Db): TableView[] {
  return (db.prepare('SELECT t.* FROM rs_tables t JOIN rs_areas a ON a.id = t.area_id ORDER BY a.sort, t.sort, t.name, t.id').all() as unknown as TableRow[]).map(toTable);
}

export interface AreaInput { name: Names; family?: boolean | undefined; sort?: number | undefined; active?: boolean | undefined }
export function saveArea(db: Db, id: string | null, input: AreaInput, actor: Actor): AreaView {
  requirePlan(db);
  const name = { ar: input.name.ar.trim(), en: input.name.en.trim(), ku: input.name.ku.trim() };
  if (!name.ar && !name.en && !name.ku) throw invalid([{ code: 'name_required' }]);
  // a name missing in a language is the one given in another
  const any = name.ar || name.en || name.ku;
  const full = { ar: name.ar || any, en: name.en || any, ku: name.ku || any };
  const areaId = transaction(db, () => {
    const at = now();
    if (id) {
      const row = db.prepare('SELECT * FROM rs_areas WHERE id = ?').get(id) as AreaRow | undefined;
      if (!row) throw notFound('rs_area');
      if (input.active === false && Number(row.active) === 1 && db.prepare(`SELECT 1 FROM rs_orders o JOIN rs_tables t ON t.id = o.table_id WHERE t.area_id = ? AND o.status = 'open' LIMIT 1`).get(id)) {
        throw conflict('rs_area_busy');
      }
      db.prepare('UPDATE rs_areas SET name_ar = ?, name_en = ?, name_ku = ?, family = ?, sort = ?, active = ?, updated_at = ? WHERE id = ?').run(
        full.ar, full.en, full.ku, input.family === undefined ? Number(row.family) : input.family ? 1 : 0, input.sort ?? Number(row.sort),
        input.active === undefined ? Number(row.active) : input.active ? 1 : 0, at, id
      );
      audit(db, actor.name, 'update', 'rs_area', id, { name: full.en });
      return id;
    }
    const made = randomUUID();
    const sort = input.sort ?? Number((db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM rs_areas').get() as { s: number }).s) + 1;
    db.prepare('INSERT INTO rs_areas (id, name_ar, name_en, name_ku, family, sort, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(made, full.ar, full.en, full.ku, input.family ? 1 : 0, sort, input.active === false ? 0 : 1, at, at);
    audit(db, actor.name, 'create', 'rs_area', made, { name: full.en, family: !!input.family });
    return made;
  });
  return toArea(db.prepare('SELECT * FROM rs_areas WHERE id = ?').get(areaId) as unknown as AreaRow);
}

export interface TableInput { areaId: string; name: string; seats?: number | undefined; sort?: number | undefined; active?: boolean | undefined }
export function saveTable(db: Db, id: string | null, input: TableInput, actor: Actor): TableView {
  requirePlan(db);
  const name = input.name.trim();
  if (!name) throw invalid([{ code: 'name_required' }]);
  if (!db.prepare('SELECT 1 FROM rs_areas WHERE id = ?').get(input.areaId)) throw invalid([{ code: 'rs_area_invalid' }]);
  const tableId = transaction(db, () => {
    const same = db.prepare('SELECT id FROM rs_tables WHERE area_id = ? AND name = ?').get(input.areaId, name) as { id: string } | undefined;
    if (same && same.id !== id) throw conflict('rs_table_name_taken');
    const at = now();
    if (id) {
      const row = db.prepare('SELECT * FROM rs_tables WHERE id = ?').get(id) as TableRow | undefined;
      if (!row) throw notFound('rs_table');
      if (input.active === false && Number(row.active) === 1 && openOrderOfTable(db, id)) throw conflict('rs_table_busy');
      db.prepare('UPDATE rs_tables SET area_id = ?, name = ?, seats = ?, sort = ?, active = ?, updated_at = ? WHERE id = ?').run(
        input.areaId, name, input.seats ?? Number(row.seats), input.sort ?? Number(row.sort), input.active === undefined ? Number(row.active) : input.active ? 1 : 0, at, id
      );
      audit(db, actor.name, 'update', 'rs_table', id, { name });
      return id;
    }
    const made = randomUUID();
    const sort = input.sort ?? Number((db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM rs_tables WHERE area_id = ?').get(input.areaId) as { s: number }).s) + 1;
    db.prepare('INSERT INTO rs_tables (id, area_id, name, seats, sort, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(made, input.areaId, name, input.seats ?? 4, sort, input.active === false ? 0 : 1, at, at);
    audit(db, actor.name, 'create', 'rs_table', made, { name, areaId: input.areaId });
    return made;
  });
  return toTable(db.prepare('SELECT * FROM rs_tables WHERE id = ?').get(tableId) as unknown as TableRow);
}

/**
 * A room to start with (2.1): "Hall" with tables 1 to `tables`, and a family section with `family` tables (F1, F2 …).
 * Only for a restaurant that has no areas yet.
 */
export function quickRoom(db: Db, input: { tables: number; family: number }, actor: Actor): { areas: AreaView[]; tables: TableView[] } {
  requirePlan(db);
  if (listAreas(db).length) throw conflict('rs_room_exists');
  transaction(db, () => {
    const hall = saveArea(db, null, { name: { ar: 'الصالة', en: 'Hall', ku: 'هۆڵ' } }, actor);
    for (let i = 1; i <= input.tables; i++) saveTable(db, null, { areaId: hall.id, name: String(i) }, actor);
    if (input.family > 0) {
      const family = saveArea(db, null, { name: { ar: 'قسم العوائل', en: 'Family section', ku: 'بەشی خێزانان' }, family: true }, actor);
      for (let i = 1; i <= input.family; i++) saveTable(db, null, { areaId: family.id, name: `F${i}` }, actor);
    }
  });
  return { areas: listAreas(db), tables: listTables(db) };
}

/* ---------------- orders ---------------- */

export interface OrderLineView {
  id: string; lineNo: number; itemId: string; code: string; name: Names; qtyMilli: number; unitPrice: number; amount: number; note: string | null;
  /** the kitchen ticket it went on (null: not sent yet) */
  ticket: number | null; sentAt: string | null;
  /** cancelled after it was sent (it counts for nothing) */
  voided: { at: string; by: string; reason: string } | null;
  paidMilli: number; unpaidMilli: number; addedBy: string;
  /** where it is made (set when it is sent), when the kitchen said it is ready, and when it went to the table */
  station: RsStation | null; readyAt: string | null; servedAt: string | null;
}
export interface OrderView {
  id: string; number: string; kind: RsOrderKind; tableId: string | null; tableName: string | null; areaId: string | null; areaName: Names | null;
  guests: number | null; partyId: string | null; partyName: string | null; phone: string | null; address: string | null; notes: string | null;
  status: 'open' | 'closed' | 'cancelled'; warehouseId: string; openedBy: string; openedAt: string; closedAt: string | null; closedBy: string | null;
  billPrintedAt: string | null; tickets: number; cancelReason: string | null;
  lines: OrderLineView[];
  /** what was ordered (lines not cancelled), what is paid of it (sales still standing), and what is left */
  total: number; paid: number; unpaid: number;
  /** lines the kitchen does not have yet, and lines ready in the kitchen for the waiter to take */
  unsent: number;
  ready: number;
  /** the till sales that paid it (a cancelled one too: its lines are unpaid again) */
  sales: { invoiceId: string; number: string | null; status: string; total: number }[];
}
export type OrderSummary = Omit<OrderView, 'lines' | 'sales'> & { lineCount: number };

interface OrderRow {
  id: string; number: string; kind: RsOrderKind; table_id: string | null; guests: number | null; party_id: string | null; phone: string | null; address: string | null;
  notes: string | null; status: OrderView['status']; warehouse_id: string; tickets: number; bill_printed_at: string | null; opened_by: string; opened_at: string;
  closed_at: string | null; closed_by: string | null; cancel_reason: string | null;
  t_name: string | null; area_id: string | null; a_ar: string | null; a_en: string | null; a_ku: string | null; party_name: string | null;
}
interface LineRow {
  id: string; order_id: string; line_no: number; item_id: string; qty_milli: number; unit_price: number; note: string | null; ticket: number | null; sent_at: string | null;
  voided_at: string | null; voided_by: string | null; void_reason: string | null; added_by: string; code: string; name_ar: string; name_en: string; name_ku: string;
  station: string | null; ready_at: string | null; served_at: string | null;
}

const ORDER_SELECT = `SELECT o.*, t.name AS t_name, t.area_id, a.name_ar AS a_ar, a.name_en AS a_en, a.name_ku AS a_ku, p.name AS party_name
                      FROM rs_orders o LEFT JOIN rs_tables t ON t.id = o.table_id LEFT JOIN rs_areas a ON a.id = t.area_id LEFT JOIN parties p ON p.id = o.party_id`;

/** What the sales still standing paid of each line (a cancelled sale pays nothing). */
function paidByLine(db: Db, orderIds: readonly string[]): Map<string, number> {
  if (!orderIds.length) return new Map();
  const rows = db.prepare(`SELECT r.line_id, SUM(r.qty_milli) AS q FROM rs_paid r JOIN invoices i ON i.id = r.invoice_id
                           WHERE r.order_id IN (${marks(orderIds)}) AND i.status = 'posted' GROUP BY r.line_id`).all(...orderIds) as { line_id: string; q: number }[];
  return new Map(rows.map((r) => [r.line_id, Number(r.q)]));
}

function linesOf(db: Db, orderIds: readonly string[]): Map<string, OrderLineView[]> {
  const out = new Map<string, OrderLineView[]>();
  if (!orderIds.length) return out;
  const paid = paidByLine(db, orderIds);
  const rows = db.prepare(`SELECT l.*, i.code, i.name_ar, i.name_en, i.name_ku FROM rs_order_lines l JOIN items i ON i.id = l.item_id
                           WHERE l.order_id IN (${marks(orderIds)}) ORDER BY l.order_id, l.line_no`).all(...orderIds) as unknown as LineRow[];
  for (const r of rows) {
    const qty = Number(r.qty_milli);
    const voided = r.voided_at ? { at: r.voided_at, by: r.voided_by ?? '', reason: r.void_reason ?? '' } : null;
    const paidMilli = Math.min(qty, paid.get(r.id) ?? 0);
    const line: OrderLineView = {
      id: r.id, lineNo: Number(r.line_no), itemId: r.item_id, code: r.code, name: names(r), qtyMilli: qty, unitPrice: Number(r.unit_price),
      amount: rsLineAmount(qty, Number(r.unit_price)), note: r.note, ticket: r.ticket === null ? null : Number(r.ticket), sentAt: r.sent_at, voided,
      paidMilli, unpaidMilli: voided ? 0 : qty - paidMilli, addedBy: r.added_by,
      station: isRsStation(r.station) ? r.station : null, readyAt: r.ready_at, servedAt: r.served_at
    };
    const list = out.get(r.order_id);
    if (list) list.push(line); else out.set(r.order_id, [line]);
  }
  return out;
}

function summaryOf(r: OrderRow, lines: OrderLineView[]): OrderSummary {
  const live = lines.filter((l) => !l.voided);
  const total = live.reduce((s, l) => s + l.amount, 0);
  const unpaid = live.reduce((s, l) => s + rsLineAmount(l.unpaidMilli, l.unitPrice), 0);
  return {
    id: r.id, number: r.number, kind: r.kind, tableId: r.table_id, tableName: r.t_name, areaId: r.area_id, areaName: r.a_ar !== null ? { ar: r.a_ar, en: r.a_en ?? '', ku: r.a_ku ?? '' } : null,
    guests: r.guests === null ? null : Number(r.guests), partyId: r.party_id, partyName: r.party_name, phone: r.phone, address: r.address, notes: r.notes,
    status: r.status, warehouseId: r.warehouse_id, openedBy: r.opened_by, openedAt: r.opened_at, closedAt: r.closed_at, closedBy: r.closed_by,
    billPrintedAt: r.bill_printed_at, tickets: Number(r.tickets), cancelReason: r.cancel_reason,
    total, paid: total - unpaid, unpaid, unsent: live.filter((l) => l.ticket === null).length,
    ready: live.filter((l) => l.readyAt !== null && l.servedAt === null).length, lineCount: live.length
  };
}

function loadOrder(db: Db, id: string): OrderRow {
  const row = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id) as OrderRow | undefined;
  if (!row) throw notFound('rs_order');
  return row;
}

/** An order the person may see: a user limited to branches sees the orders of their warehouses only. */
function assertMine(db: Db, row: OrderRow, actor: Actor | null): void {
  const own = userBranchLists(db, actor);
  if (own && !own.warehouses.includes(row.warehouse_id)) throw notFound('rs_order');
}

export function getOrder(db: Db, id: string, actor: Actor | null = null): OrderView {
  const row = loadOrder(db, id);
  assertMine(db, row, actor);
  const lines = linesOf(db, [id]).get(id) ?? [];
  const { lineCount: _n, ...summary } = summaryOf(row, lines);
  const sales = (db.prepare(`SELECT i.id, i.number, i.status, i.total FROM invoices i WHERE i.id IN (SELECT DISTINCT invoice_id FROM rs_paid WHERE order_id = ?) ORDER BY i.created_at`)
    .all(id) as { id: string; number: string | null; status: string; total: number }[]).map((s) => ({ invoiceId: s.id, number: s.number, status: s.status, total: Number(s.total) }));
  return { ...summary, lines, sales };
}

function summaries(db: Db, rows: OrderRow[]): OrderSummary[] {
  const lines = linesOf(db, rows.map((r) => r.id));
  return rows.map((r) => summaryOf(r, lines.get(r.id) ?? []));
}

/** The orders (open ones first, newest first), within the user's branches: by status and the day they were opened. */
export function listOrders(db: Db, f: { status?: OrderView['status'] | undefined; from?: string | undefined; to?: string | undefined; limit?: number | undefined }, actor: Actor | null): OrderSummary[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.status) { where.push('o.status = ?'); params.push(f.status); }
  if (f.from) { where.push('o.opened_at >= ?'); params.push(`${f.from}T00:00:00`); }
  if (f.to) { where.push('o.opened_at < ?'); params.push(`${f.to}T99`); }
  const own = userBranchLists(db, actor);
  if (own) { where.push(`o.warehouse_id IN (${marks(own.warehouses)})`); params.push(...own.warehouses); }
  const rows = db.prepare(`${ORDER_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE WHEN o.status = 'open' THEN 0 ELSE 1 END, o.opened_at DESC LIMIT ?`)
    .all(...params, Math.min(f.limit ?? 200, 500)) as unknown as OrderRow[];
  return summaries(db, rows);
}

export interface FloorView {
  available: boolean;
  areas: (AreaView & { tables: (TableView & { order: OrderSummary | null })[] })[];
  /** open orders to take away or to deliver, the oldest first */
  orders: OrderSummary[];
}

/** The room as it is now: each area's tables (active ones) with the order open on each, and the other open orders. */
export function floor(db: Db, actor: Actor | null): FloorView {
  const own = userBranchLists(db, actor);
  const open = summaries(db, db.prepare(`${ORDER_SELECT} WHERE o.status = 'open' ${own ? `AND o.warehouse_id IN (${marks(own.warehouses)})` : ''} ORDER BY o.opened_at`)
    .all(...(own ? own.warehouses : [])) as unknown as OrderRow[]);
  const byTable = new Map(open.filter((o) => o.tableId).map((o) => [o.tableId!, o]));
  const tables = listTables(db).filter((t) => t.active);
  return {
    available: restaurantAvailable(db),
    areas: listAreas(db).filter((a) => a.active).map((a) => ({ ...a, tables: tables.filter((t) => t.areaId === a.id).map((t) => ({ ...t, order: byTable.get(t.id) ?? null })) })),
    orders: open.filter((o) => !o.tableId)
  };
}

function openOrderOfTable(db: Db, tableId: string): string | null {
  return (db.prepare("SELECT id FROM rs_orders WHERE table_id = ? AND status = 'open' LIMIT 1").get(tableId) as { id: string } | undefined)?.id ?? null;
}

/** The warehouse an order sells from: the one asked for when it is the user's, else the user's first, else the first. */
function warehouseFor(db: Db, asked: string | undefined, actor: Actor): string {
  const own = userBranchLists(db, actor);
  const active = (db.prepare('SELECT id FROM warehouses WHERE active = 1 ORDER BY code, id').all() as { id: string }[]).map((w) => w.id).filter((id) => !own || own.warehouses.includes(id));
  if (asked) {
    if (!active.includes(asked)) throw invalid([{ code: 'warehouse_invalid' }]);
    return asked;
  }
  if (!active[0]) throw invalid([{ code: 'warehouse_invalid' }]);
  return active[0];
}

export interface OpenOrderInput {
  kind: RsOrderKind; tableId?: string | undefined; guests?: number | undefined; partyId?: string | undefined; phone?: string | undefined; address?: string | undefined;
  notes?: string | undefined; warehouseId?: string | undefined;
}

/** A new order: at a table (one open order a table: the open one is answered 409 with its id), to take away, or to deliver. */
export function openOrder(db: Db, input: OpenOrderInput, actor: Actor): OrderView {
  requirePlan(db);
  requireWaiter(actor);
  if (!isRsOrderKind(input.kind)) throw invalid([{ code: 'rs_kind_invalid' }]);
  if (input.kind === 'table' && !input.tableId) throw invalid([{ code: 'rs_table_required' }]);
  if (input.kind !== 'table' && input.tableId) throw invalid([{ code: 'rs_table_invalid' }]);
  if (input.partyId && !db.prepare("SELECT 1 FROM parties WHERE id = ? AND type = 'customer'").get(input.partyId)) throw invalid([{ code: 'party_invalid' }]);
  const warehouseId = warehouseFor(db, input.warehouseId, actor);
  const id = transaction(db, () => {
    if (input.tableId) {
      const t = db.prepare('SELECT active FROM rs_tables WHERE id = ?').get(input.tableId) as { active: number } | undefined;
      if (!t || Number(t.active) !== 1) throw invalid([{ code: 'rs_table_invalid' }]);
      const busy = openOrderOfTable(db, input.tableId);
      if (busy) throw conflict('rs_table_busy', { orderId: busy });
    }
    const made = randomUUID();
    const at = now();
    db.prepare(`INSERT INTO rs_orders (id, number, kind, table_id, guests, party_id, phone, address, notes, status, warehouse_id, tickets, bill_printed_at, opened_by, opened_by_id, opened_at, updated_at, closed_at, closed_by, cancel_reason)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, 0, NULL, ?, ?, ?, ?, NULL, NULL, NULL)`)
      .run(made, String(nextSequence(db, 'rs_order')), input.kind, input.tableId ?? null, input.guests ?? null, input.partyId ?? null, input.phone?.trim() || null,
        input.address?.trim() || null, input.notes?.trim() || null, warehouseId, actor.name, actor.id ?? null, at, at);
    audit(db, actor.name, 'create', 'rs_order', made, { kind: input.kind, ...(input.tableId ? { tableId: input.tableId } : {}) });
    return made;
  });
  return getOrder(db, id, actor);
}

function openRow(db: Db, id: string, actor: Actor): OrderRow {
  const row = loadOrder(db, id);
  assertMine(db, row, actor);
  if (row.status !== 'open') throw conflict('rs_order_closed', { status: row.status });
  return row;
}

export interface OrderPatch {
  guests?: number | null | undefined; partyId?: string | null | undefined; phone?: string | null | undefined; address?: string | null | undefined; notes?: string | null | undefined;
}
export function updateOrder(db: Db, id: string, patch: OrderPatch, actor: Actor): OrderView {
  requirePlan(db);
  requireWaiter(actor);
  if (patch.partyId && !db.prepare("SELECT 1 FROM parties WHERE id = ? AND type = 'customer'").get(patch.partyId)) throw invalid([{ code: 'party_invalid' }]);
  transaction(db, () => {
    const row = openRow(db, id, actor);
    const text = (v: string | null | undefined, was: string | null) => (v === undefined ? was : v?.trim() || null);
    db.prepare('UPDATE rs_orders SET guests = ?, party_id = ?, phone = ?, address = ?, notes = ?, updated_at = ? WHERE id = ?').run(
      patch.guests === undefined ? row.guests : patch.guests, patch.partyId === undefined ? row.party_id : patch.partyId,
      text(patch.phone, row.phone), text(patch.address, row.address), text(patch.notes, row.notes), now(), id
    );
  });
  return getOrder(db, id, actor);
}

/** The item's price in dinars as the till reckons it (a dollar price at the company's rate). */
function dinarPrice(db: Db, price: number, currency: string): number {
  if (currency === 'IQD') return price;
  const rate = Number(readSetting(db, 'default_rate_x100') ?? '142000');
  return Math.round((price * rate) / 10000);
}

export function addLines(db: Db, id: string, lines: { itemId: string; qtyMilli: number; note?: string | undefined }[], actor: Actor): OrderView {
  requirePlan(db);
  requireWaiter(actor);
  if (!lines.length) throw invalid([{ code: 'rs_lines_empty' }]);
  if (lines.length > RS_MAX_ADD) throw invalid([{ code: 'rs_too_many_lines', max: RS_MAX_ADD }]);
  const item = db.prepare('SELECT active, sale_price, sale_currency FROM items WHERE id = ?');
  const errors: { code: string; line: number }[] = [];
  const priced = lines.map((l, i) => {
    const it = item.get(l.itemId) as { active: number; sale_price: number | null; sale_currency: string } | undefined;
    if (!it || Number(it.active) !== 1) errors.push({ code: 'item_invalid', line: i + 1 });
    if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0 || l.qtyMilli > RS_MAX_QTY_MILLI) errors.push({ code: 'line_qty_invalid', line: i + 1 });
    if ((l.note ?? '').length > RS_MAX_NOTE) errors.push({ code: 'rs_note_too_long', line: i + 1 });
    return { ...l, unitPrice: it ? dinarPrice(db, Number(it.sale_price ?? 0), it.sale_currency) : 0 };
  });
  if (errors.length) throw invalid(errors);
  transaction(db, () => {
    openRow(db, id, actor);
    const count = Number((db.prepare('SELECT COUNT(*) AS n FROM rs_order_lines WHERE order_id = ?').get(id) as { n: number }).n);
    if (count + lines.length > RS_MAX_LINES) throw invalid([{ code: 'rs_too_many_lines', max: RS_MAX_LINES }]);
    let lineNo = Number((db.prepare('SELECT COALESCE(MAX(line_no), 0) AS n FROM rs_order_lines WHERE order_id = ?').get(id) as { n: number }).n);
    const at = now();
    const insert = db.prepare(`INSERT INTO rs_order_lines (id, order_id, line_no, item_id, qty_milli, unit_price, note, ticket, sent_at, voided_at, voided_by, void_reason, added_by, added_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`);
    for (const l of priced) insert.run(randomUUID(), id, ++lineNo, l.itemId, l.qtyMilli, l.unitPrice, l.note?.trim() || null, actor.name, at);
    db.prepare('UPDATE rs_orders SET updated_at = ? WHERE id = ?').run(at, id);
  });
  return getOrder(db, id, actor);
}

function lineRow(db: Db, orderId: string, lineId: string): { ticket: number | null; voided_at: string | null; qty_milli: number; item_id: string } {
  const row = db.prepare('SELECT ticket, voided_at, qty_milli, item_id FROM rs_order_lines WHERE id = ? AND order_id = ?').get(lineId, orderId) as
    { ticket: number | null; voided_at: string | null; qty_milli: number; item_id: string } | undefined;
  if (!row) throw notFound('rs_order_line');
  return row;
}

/** A line the kitchen does not have yet: its quantity and its note change freely. */
export function changeLine(db: Db, id: string, lineId: string, patch: { qtyMilli?: number | undefined; note?: string | null | undefined }, actor: Actor): OrderView {
  requirePlan(db);
  requireWaiter(actor);
  if (patch.qtyMilli !== undefined && (!Number.isSafeInteger(patch.qtyMilli) || patch.qtyMilli <= 0 || patch.qtyMilli > RS_MAX_QTY_MILLI)) throw invalid([{ code: 'line_qty_invalid' }]);
  if ((patch.note ?? '').length > RS_MAX_NOTE) throw invalid([{ code: 'rs_note_too_long' }]);
  transaction(db, () => {
    openRow(db, id, actor);
    const line = lineRow(db, id, lineId);
    if (line.ticket !== null) throw conflict('rs_line_sent');
    if (patch.qtyMilli !== undefined) db.prepare('UPDATE rs_order_lines SET qty_milli = ? WHERE id = ?').run(patch.qtyMilli, lineId);
    if (patch.note !== undefined) db.prepare('UPDATE rs_order_lines SET note = ? WHERE id = ?').run(patch.note?.trim() || null, lineId);
    db.prepare('UPDATE rs_orders SET updated_at = ? WHERE id = ?').run(now(), id);
  });
  return getOrder(db, id, actor);
}

export function removeLine(db: Db, id: string, lineId: string, actor: Actor): OrderView {
  requirePlan(db);
  requireWaiter(actor);
  transaction(db, () => {
    openRow(db, id, actor);
    const line = lineRow(db, id, lineId);
    // sent: the kitchen is making it; only a supervisor cancels it (voidLine)
    if (line.ticket !== null) throw conflict('rs_line_sent');
    db.prepare('DELETE FROM rs_order_lines WHERE id = ?').run(lineId);
    db.prepare('UPDATE rs_orders SET updated_at = ? WHERE id = ?').run(now(), id);
  });
  return getOrder(db, id, actor);
}

/* ---------------- the kitchen ---------------- */

export interface TicketView {
  orderId: string; number: string; ticket: number; kind: RsOrderKind; tableName: string | null; areaName: Names | null; guests: number | null;
  /** the station it is for: printed on that station's printer */
  station: RsStation;
  by: string; at: string; notes: string | null;
  /** 'cancel': the kitchen stops making these */
  type: 'order' | 'cancel';
  lines: { itemId: string; code: string; name: Names; qtyMilli: number; note: string | null; reason?: string }[];
}

function ticketOf(order: OrderView, ticket: number, by: string, at: string, type: TicketView['type'], lines: OrderLineView[], reason?: string): TicketView {
  return {
    orderId: order.id, number: order.number, ticket, kind: order.kind, tableName: order.tableName, areaName: order.areaName, guests: order.guests,
    station: lines[0]?.station ?? 'kitchen', by, at, notes: order.notes, type,
    lines: lines.map((l) => ({ itemId: l.itemId, code: l.code, name: l.name, qtyMilli: l.qtyMilli, note: l.note, ...(reason ? { reason } : {}) }))
  };
}

/** A ticket's lines, one ticket per station (in the stations' order), for the stations that have some. */
function byStation(order: OrderView, ticket: number, by: string, at: string, lines: OrderLineView[]): TicketView[] {
  return RS_STATIONS.map((st) => lines.filter((l) => (l.station ?? 'kitchen') === st)).filter((ls) => ls.length).map((ls) => ticketOf(order, ticket, by, at, 'order', ls));
}

/** Gives the lines the kitchen does not have yet the order's next ticket number, inside the caller's transaction. */
function sendUnsent(db: Db, id: string, actor: Actor, only?: ReadonlySet<string>): { ticket: number; at: string } | null {
  const unsent = (db.prepare('SELECT id FROM rs_order_lines WHERE order_id = ? AND ticket IS NULL AND voided_at IS NULL').all(id) as { id: string }[])
    .map((r) => r.id).filter((lineId) => !only || only.has(lineId));
  if (!unsent.length) return null;
  const ticket = Number((db.prepare('SELECT tickets FROM rs_orders WHERE id = ?').get(id) as { tickets: number }).tickets) + 1;
  const at = now();
  // each to its category's station (the kitchen when none is set), kept on the line: a later change leaves it as sent
  db.prepare(`UPDATE rs_order_lines SET ticket = ?, sent_at = ?,
                station = COALESCE((SELECT s.station FROM rs_category_stations s JOIN items i ON i.category_id = s.category_id WHERE i.id = rs_order_lines.item_id), 'kitchen')
              WHERE id IN (${marks(unsent)})`).run(ticket, at, ...unsent);
  db.prepare('UPDATE rs_orders SET tickets = ?, updated_at = ? WHERE id = ?').run(ticket, at, id);
  audit(db, actor.name, 'rs_send', 'rs_order', id, { ticket, lines: unsent.length });
  return { ticket, at };
}

/** Sends what the kitchen does not have yet: the tickets to print, one per station (none: nothing new). */
export function sendToKitchen(db: Db, id: string, actor: Actor): { order: OrderView; tickets: TicketView[] } {
  requirePlan(db);
  requireWaiter(actor);
  const sent = transaction(db, () => { openRow(db, id, actor); return sendUnsent(db, id, actor); });
  const order = getOrder(db, id, actor);
  return { order, tickets: sent ? byStation(order, sent.ticket, actor.name, sent.at, order.lines.filter((l) => l.ticket === sent.ticket)) : [] };
}

/** A ticket printed again (the kitchen lost it): as it was sent, one per station. */
export function ticketAgain(db: Db, id: string, ticket: number, actor: Actor): { tickets: TicketView[] } {
  const order = getOrder(db, id, actor);
  const lines = order.lines.filter((l) => l.ticket === ticket && !l.voided);
  if (!lines.length) throw notFound('rs_ticket');
  return { tickets: byStation(order, ticket, lines[0]!.addedBy, lines[0]!.sentAt ?? order.openedAt, lines) };
}

/**
 * A line the kitchen has, cancelled (a supervisor's, with a reason): it counts for nothing, and the kitchen gets a
 * ticket saying so. Some of its quantity only (2 of 3 kebabs): the line keeps the rest, a cancelled line has the part.
 */
export function voidLine(db: Db, id: string, lineId: string, input: { reason: string; qtyMilli?: number | undefined }, actor: Actor): { order: OrderView; ticket: TicketView } {
  requirePlan(db);
  requireSupervisor(actor);
  const reason = input.reason.trim();
  if (!reason) throw invalid([{ code: 'rs_reason_required' }]);
  const at = now();
  const voidedId = transaction(db, () => {
    openRow(db, id, actor);
    const line = lineRow(db, id, lineId);
    if (line.ticket === null) throw conflict('rs_line_not_sent');
    if (line.voided_at) throw conflict('rs_line_voided');
    const qty = Number(line.qty_milli);
    const paid = paidByLine(db, [id]).get(lineId) ?? 0;
    const part = input.qtyMilli ?? qty - paid;
    if (!Number.isSafeInteger(part) || part <= 0 || part > qty - paid) throw invalid([{ code: 'rs_void_qty_invalid', max: qty - paid } as { code: string }]);
    let target = lineId;
    if (part < qty) {
      // the line keeps the rest; the part cancelled is a line of its own, on the same ticket
      db.prepare('UPDATE rs_order_lines SET qty_milli = ? WHERE id = ?').run(qty - part, lineId);
      const lineNo = Number((db.prepare('SELECT COALESCE(MAX(line_no), 0) AS n FROM rs_order_lines WHERE order_id = ?').get(id) as { n: number }).n) + 1;
      target = randomUUID();
      db.prepare(`INSERT INTO rs_order_lines (id, order_id, line_no, item_id, qty_milli, unit_price, note, ticket, sent_at, voided_at, voided_by, void_reason, added_by, added_at,
                    station, ready_at, ready_by, served_at)
                  SELECT ?, order_id, ?, item_id, ?, unit_price, note, ticket, sent_at, NULL, NULL, NULL, added_by, added_at, station, ready_at, ready_by, served_at
                  FROM rs_order_lines WHERE id = ?`).run(target, lineNo, part, lineId);
    }
    db.prepare('UPDATE rs_order_lines SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?').run(at, actor.name, reason, target);
    db.prepare('UPDATE rs_orders SET updated_at = ? WHERE id = ?').run(at, id);
    audit(db, actor.name, 'rs_void', 'rs_order', id, { lineId: target, itemId: line.item_id, qtyMilli: part, reason });
    closeIfPaid(db, id, actor);
    return target;
  });
  const order = getOrder(db, id, actor);
  const line = order.lines.find((l) => l.id === voidedId)!;
  return { order, ticket: ticketOf(order, line.ticket ?? 0, actor.name, at, 'cancel', [line], reason) };
}

/** The bill was printed (the table shows so): it changes nothing else, and it may be printed again. */
export function billPrinted(db: Db, id: string, actor: Actor): OrderView {
  requireWaiter(actor);
  transaction(db, () => {
    openRow(db, id, actor);
    db.prepare('UPDATE rs_orders SET bill_printed_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  });
  return getOrder(db, id, actor);
}

/** The guests moved to a free table. */
export function moveOrder(db: Db, id: string, tableId: string, actor: Actor): OrderView {
  requirePlan(db);
  requireWaiter(actor);
  transaction(db, () => {
    const row = openRow(db, id, actor);
    if (row.kind !== 'table') throw invalid([{ code: 'rs_table_invalid' }]);
    const t = db.prepare('SELECT active FROM rs_tables WHERE id = ?').get(tableId) as { active: number } | undefined;
    if (!t || Number(t.active) !== 1) throw invalid([{ code: 'rs_table_invalid' }]);
    const busy = openOrderOfTable(db, tableId);
    if (busy && busy !== id) throw conflict('rs_table_busy', { orderId: busy });
    db.prepare('UPDATE rs_orders SET table_id = ?, updated_at = ? WHERE id = ?').run(tableId, now(), id);
    audit(db, actor.name, 'rs_move', 'rs_order', id, { from: row.table_id, to: tableId });
  });
  return getOrder(db, id, actor);
}

/**
 * Two tables joined: this order's lines (and its unsent ones) go to `intoId`, and this order is closed as merged. Only
 * before anything of it was paid (a paid part stays with the order it paid).
 */
export function mergeOrder(db: Db, id: string, intoId: string, actor: Actor): OrderView {
  requirePlan(db);
  requireWaiter(actor);
  if (id === intoId) throw invalid([{ code: 'rs_merge_invalid' }]);
  transaction(db, () => {
    const from = openRow(db, id, actor);
    const into = openRow(db, intoId, actor);
    if (from.warehouse_id !== into.warehouse_id) throw invalid([{ code: 'rs_merge_invalid' }]);
    if (db.prepare('SELECT 1 FROM rs_paid WHERE order_id = ? LIMIT 1').get(id)) throw conflict('rs_order_paid_part');
    const count = (o: string) => Number((db.prepare('SELECT COUNT(*) AS n FROM rs_order_lines WHERE order_id = ?').get(o) as { n: number }).n);
    if (count(id) + count(intoId) > RS_MAX_LINES) throw invalid([{ code: 'rs_too_many_lines', max: RS_MAX_LINES }]);
    let lineNo = Number((db.prepare('SELECT COALESCE(MAX(line_no), 0) AS n FROM rs_order_lines WHERE order_id = ?').get(intoId) as { n: number }).n);
    // tickets keep their own numbers in the order they go to: the merged order's come after its own
    const offset = Number(into.tickets);
    for (const l of db.prepare('SELECT id, ticket FROM rs_order_lines WHERE order_id = ? ORDER BY line_no').all(id) as { id: string; ticket: number | null }[]) {
      db.prepare('UPDATE rs_order_lines SET order_id = ?, line_no = ?, ticket = ? WHERE id = ?').run(intoId, ++lineNo, l.ticket === null ? null : Number(l.ticket) + offset, l.id);
    }
    const at = now();
    db.prepare('UPDATE rs_orders SET tickets = ?, guests = ?, updated_at = ? WHERE id = ?').run(offset + Number(from.tickets),
      from.guests === null && into.guests === null ? null : Number(into.guests ?? 0) + Number(from.guests ?? 0), at, intoId);
    db.prepare("UPDATE rs_orders SET status = 'cancelled', cancel_reason = ?, closed_at = ?, closed_by = ?, updated_at = ? WHERE id = ?").run(`merged:${into.number}`, at, actor.name, at, id);
    audit(db, actor.name, 'rs_merge', 'rs_order', id, { into: intoId });
  });
  return getOrder(db, intoId, actor);
}

/**
 * An order nobody pays for (the guests left before ordering, a mistake): cancelled, with a reason. Once the kitchen has
 * something of it, a supervisor's; never once something of it was paid.
 */
export function cancelOrder(db: Db, id: string, reason: string, actor: Actor): OrderView {
  requirePlan(db);
  requireWaiter(actor);
  if (!reason.trim()) throw invalid([{ code: 'rs_reason_required' }]);
  transaction(db, () => {
    openRow(db, id, actor);
    if ([...paidByLine(db, [id]).values()].some((q) => q > 0)) throw conflict('rs_order_paid_part');
    if (db.prepare('SELECT 1 FROM rs_order_lines WHERE order_id = ? AND ticket IS NOT NULL AND voided_at IS NULL LIMIT 1').get(id)) requireSupervisor(actor);
    const at = now();
    db.prepare("UPDATE rs_orders SET status = 'cancelled', cancel_reason = ?, closed_at = ?, closed_by = ?, updated_at = ? WHERE id = ?").run(reason.trim(), at, actor.name, at, id);
    audit(db, actor.name, 'rs_cancel', 'rs_order', id, { reason: reason.trim() });
  });
  return getOrder(db, id, actor);
}

/** An order closed with something unpaid again (a sale that paid it was cancelled): open once more, to take the money. */
export function reopenOrder(db: Db, id: string, actor: Actor): OrderView {
  requirePlan(db);
  requireSupervisor(actor);
  transaction(db, () => {
    const row = loadOrder(db, id);
    assertMine(db, row, actor);
    if (row.status !== 'closed') throw conflict('rs_order_not_closed');
    const order = getOrder(db, id, actor);
    if (order.unpaid <= 0) throw conflict('rs_order_paid');
    if (row.table_id && openOrderOfTable(db, row.table_id)) throw conflict('rs_table_busy', { orderId: openOrderOfTable(db, row.table_id) });
    db.prepare("UPDATE rs_orders SET status = 'open', closed_at = NULL, closed_by = NULL, updated_at = ? WHERE id = ?").run(now(), id);
    audit(db, actor.name, 'rs_reopen', 'rs_order', id);
  });
  return getOrder(db, id, actor);
}

/** Closes an order once every line not cancelled is paid (and it has one). Inside the caller's transaction. */
function closeIfPaid(db: Db, id: string, actor: Actor): boolean {
  const lines = linesOf(db, [id]).get(id) ?? [];
  const live = lines.filter((l) => !l.voided);
  if (!live.length || live.some((l) => l.unpaidMilli > 0)) return false;
  const at = now();
  db.prepare("UPDATE rs_orders SET status = 'closed', closed_at = ?, closed_by = ?, updated_at = ? WHERE id = ? AND status = 'open'").run(at, actor.name, at, id);
  return true;
}

/* ---------------- paying at the till ---------------- */

export interface PayInput {
  shiftId: string;
  /** what is paid now: lines and quantities (each guest what they had); none: all that is left */
  lines?: { lineId: string; qtyMilli: number }[] | undefined;
  discount?: number | undefined;
  partyId?: string | undefined;
  payments?: SaleInput['payments'];
  tendered?: number | undefined;
  approvals?: string[] | undefined;
}
export interface PayResult { order: OrderView; invoice: InvoiceView; shift: ShiftView; rounding: number; tickets: TicketView[] }

/**
 * Pays an order, or a part of it, at the cashier's open shift: the till's own sale of those lines (sell), and the order
 * noting what that sale paid, in one transaction. Lines the kitchen does not have yet that are paid now (a café's
 * counter) are sent first: the answer has their ticket to print.
 */
export function payOrder(db: Db, id: string, input: PayInput, actor: Actor): PayResult {
  requirePlan(db);
  let sent: { ticket: number; at: string } | null = null;
  const result = transaction(db, () => {
    const row = openRow(db, id, actor);
    const lines = linesOf(db, [id]).get(id) ?? [];
    const byId = new Map(lines.map((l) => [l.id, l]));
    const chosen = input.lines?.length
      ? input.lines.map((c, i) => {
        const l = byId.get(c.lineId);
        if (!l || l.voided || !Number.isSafeInteger(c.qtyMilli) || c.qtyMilli <= 0 || c.qtyMilli > l.unpaidMilli) throw invalid([{ code: 'rs_pay_line_invalid', line: i + 1 } as { code: string }]);
        return { line: l, qtyMilli: c.qtyMilli };
      })
      : lines.filter((l) => l.unpaidMilli > 0).map((l) => ({ line: l, qtyMilli: l.unpaidMilli }));
    if (!chosen.length) throw conflict('rs_order_paid');
    if (new Set(chosen.map((c) => c.line.id)).size !== chosen.length) throw invalid([{ code: 'rs_pay_line_invalid' }]);
    sent = sendUnsent(db, id, actor, new Set(chosen.filter((c) => c.line.ticket === null).map((c) => c.line.id)));
    const partyId = input.partyId ?? row.party_id ?? undefined;
    const label = row.t_name ? `${row.t_name} · #${row.number}` : `#${row.number}`;
    const sold = sell(db, input.shiftId, {
      currency: 'IQD', discount: input.discount ?? 0, notes: label, ...(partyId ? { partyId } : {}),
      lines: chosen.map((c) => ({ itemId: c.line.itemId, qtyMilli: c.qtyMilli, unitPrice: c.line.unitPrice })),
      ...(input.payments?.length ? { payments: input.payments } : {}), ...(input.tendered !== undefined ? { tendered: input.tendered } : {}),
      ...(input.approvals?.length ? { approvals: input.approvals } : {})
    }, actor);
    const at = now();
    const insert = db.prepare('INSERT INTO rs_paid (id, order_id, line_id, invoice_id, qty_milli, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const c of chosen) insert.run(randomUUID(), id, c.line.id, sold.invoice.id, c.qtyMilli, at);
    db.prepare('UPDATE rs_orders SET updated_at = ? WHERE id = ?').run(at, id);
    closeIfPaid(db, id, actor);
    audit(db, actor.name, 'rs_pay', 'rs_order', id, { invoiceId: sold.invoice.id, number: sold.invoice.number, lines: chosen.length });
    return sold;
  });
  const order = getOrder(db, id, actor);
  const s = sent as { ticket: number; at: string } | null;
  return {
    order, invoice: result.invoice, shift: result.shift, rounding: result.rounding,
    tickets: s ? byStation(order, s.ticket, actor.name, s.at, order.lines.filter((l) => l.ticket === s.ticket && !l.voided)) : []
  };
}

/** A payment's answer again (its first answer was lost): the order as it is, the sale and the shift it was made on. */
function paidAgain(db: Db, orderId: string, invoiceId: string, actor: Actor): PayResult {
  const shift = db.prepare('SELECT shift_id, rounding FROM pos_sales WHERE invoice_id = ?').get(invoiceId) as { shift_id: string; rounding: number | null } | undefined;
  if (!shift) throw notFound('invoice');
  return { order: getOrder(db, orderId, actor), invoice: getInvoice(db, invoiceId, userBranchLists(db, actor)), shift: getShift(db, shift.shift_id, actor), rounding: Number(shift.rounding ?? 0), tickets: [] };
}

/* ---------------- the kitchen: stations, the kitchen screen, ready and served ---------------- */

export interface KitchenSettings {
  /** kitchen tickets on paper (and on the screen), or on the kitchen screen only */
  tickets: RsTicketMode;
  /** the categories whose dishes another station makes (a category not here: the kitchen) */
  stations: { categoryId: string; station: RsStation }[];
}

export function kitchenSettings(db: Db): KitchenSettings {
  const mode = readSetting(db, 'rs_tickets');
  return {
    tickets: mode === 'screen' ? 'screen' : 'print',
    stations: (db.prepare('SELECT category_id, station FROM rs_category_stations ORDER BY category_id').all() as { category_id: string; station: string }[])
      .filter((r) => isRsStation(r.station)).map((r) => ({ categoryId: r.category_id, station: r.station as RsStation }))
  };
}

/** Saves how tickets go to the kitchen and which station makes each category's dishes (the list given replaces the old). */
export function saveKitchenSettings(db: Db, input: KitchenSettings, actor: Actor): KitchenSettings {
  requirePlan(db);
  const ids = input.stations.map((s) => s.categoryId);
  if (new Set(ids).size !== ids.length) throw invalid([{ code: 'rs_station_twice' }]);
  if (ids.length) {
    const found = (db.prepare(`SELECT id FROM item_categories WHERE id IN (${marks(ids)})`).all(...ids) as { id: string }[]).length;
    if (found !== ids.length) throw invalid([{ code: 'category_unknown' }]);
  }
  const at = now();
  transaction(db, () => {
    writeSetting(db, 'rs_tickets', input.tickets);
    db.prepare('DELETE FROM rs_category_stations').run();
    const add = db.prepare('INSERT INTO rs_category_stations (category_id, station, updated_at) VALUES (?, ?, ?)');
    // the kitchen is where a category goes when none is set: only the others are kept
    for (const s of input.stations) if (s.station !== 'kitchen') add.run(s.categoryId, s.station, at);
    audit(db, actor.name, 'rs_kitchen', 'rs_kitchen', null, { tickets: input.tickets, stations: input.stations.filter((s) => s.station !== 'kitchen').length });
  });
  return kitchenSettings(db);
}

export interface KitchenTicketView {
  orderId: string; number: string; kind: RsOrderKind; tableName: string | null; areaName: Names | null; guests: number | null; notes: string | null;
  ticket: number; station: RsStation; sentAt: string; by: string;
  /** when the kitchen said it is ready (null: still cooking) */
  readyAt: string | null;
  lines: { id: string; code: string; name: Names; qtyMilli: number; note: string | null; voided: boolean; served: boolean }[];
}

interface KitchenRow {
  id: string; order_id: string; ticket: number; station: string | null; sent_at: string; ready_at: string | null; served_at: string | null; voided_at: string | null;
  qty_milli: number; note: string | null; added_by: string; code: string; name_ar: string; name_en: string; name_ku: string;
  number: string; kind: RsOrderKind; guests: number | null; notes: string | null; status: string; warehouse_id: string;
  t_name: string | null; a_ar: string | null; a_en: string | null; a_ku: string | null;
}

/**
 * The kitchen screen: what is cooking at a station (or at all), the oldest first, and what it finished in the last
 * half hour (to take back a "ready" pressed by mistake). Only what was sent in the last hours: older tickets were
 * cooked long ago (a kitchen that works on paper never marks them ready). A dish cancelled while it cooks stays on its
 * ticket, crossed out, so the cook sees it. Read by anyone signed in, as the floor is; marking ready is a waiter's.
 */
export function kitchen(db: Db, station: RsStation | 'all', actor: Actor): { cooking: KitchenTicketView[]; done: KitchenTicketView[]; tickets: RsTicketMode } {
  // read as the floor and the orders are; "ready" is for whoever takes orders
  const own = userBranchLists(db, actor);
  const since = new Date(Date.now() - RS_KITCHEN_HOURS * 3_600_000).toISOString();
  const doneSince = new Date(Date.now() - RS_KITCHEN_DONE_MINUTES * 60_000).toISOString();
  const rows = db.prepare(`SELECT l.id, l.order_id, l.ticket, l.station, l.sent_at, l.ready_at, l.served_at, l.voided_at, l.qty_milli, l.note, l.added_by,
                                  i.code, i.name_ar, i.name_en, i.name_ku, o.number, o.kind, o.guests, o.notes, o.status, o.warehouse_id,
                                  t.name AS t_name, a.name_ar AS a_ar, a.name_en AS a_en, a.name_ku AS a_ku
                           FROM rs_order_lines l JOIN rs_orders o ON o.id = l.order_id JOIN items i ON i.id = l.item_id
                           LEFT JOIN rs_tables t ON t.id = o.table_id LEFT JOIN rs_areas a ON a.id = t.area_id
                           WHERE l.sent_at >= ? AND o.status <> 'cancelled' ${station === 'all' ? '' : 'AND l.station = ?'}
                             ${own ? `AND o.warehouse_id IN (${marks(own.warehouses)})` : ''}
                           ORDER BY l.sent_at, l.order_id, l.ticket, l.line_no`)
    .all(since, ...(station === 'all' ? [] : [station]), ...(own ? own.warehouses : [])) as unknown as KitchenRow[];
  const groups = new Map<string, KitchenRow[]>();
  for (const r of rows) {
    const key = `${r.order_id}|${r.ticket}|${r.station ?? 'kitchen'}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  const cooking: KitchenTicketView[] = [];
  const done: KitchenTicketView[] = [];
  for (const g of groups.values()) {
    const live = g.filter((r) => !r.voided_at);
    // a ticket whose every dish was cancelled is gone from the screen (its paper ticket said so)
    if (!live.length) continue;
    const first = g[0]!;
    const readyAt = live.every((r) => r.ready_at) ? live.map((r) => r.ready_at!).sort().at(-1)! : null;
    if (readyAt && readyAt < doneSince) continue;
    const view: KitchenTicketView = {
      orderId: first.order_id, number: first.number, kind: first.kind, tableName: first.t_name,
      areaName: first.a_ar !== null ? { ar: first.a_ar, en: first.a_en ?? '', ku: first.a_ku ?? '' } : null,
      guests: first.guests === null ? null : Number(first.guests), notes: first.notes, ticket: Number(first.ticket), station: isRsStation(first.station) ? first.station : 'kitchen',
      sentAt: first.sent_at, by: first.added_by, readyAt,
      lines: g.map((r) => ({ id: r.id, code: r.code, name: names(r), qtyMilli: Number(r.qty_milli), note: r.note, voided: !!r.voided_at, served: !!r.served_at }))
    };
    (readyAt ? done : cooking).push(view);
  }
  done.sort((a, b) => (b.readyAt ?? '').localeCompare(a.readyAt ?? ''));
  return { cooking, done: done.slice(0, 20), tickets: kitchenSettings(db).tickets };
}

/** A station's part of a ticket is ready (or, pressed by mistake, not ready after all while nobody took it). */
export function markReady(db: Db, id: string, input: { ticket: number; station: RsStation; ready: boolean }, actor: Actor): { ok: true } {
  requirePlan(db);
  requireWaiter(actor);
  transaction(db, () => {
    const row = loadOrder(db, id);
    assertMine(db, row, actor);
    if (row.status === 'cancelled') throw conflict('rs_order_closed', { status: row.status });
    const at = now();
    const changed = input.ready
      ? db.prepare(`UPDATE rs_order_lines SET ready_at = ?, ready_by = ? WHERE order_id = ? AND ticket = ? AND station = ? AND voided_at IS NULL AND ready_at IS NULL`)
        .run(at, actor.name, id, input.ticket, input.station)
      : db.prepare(`UPDATE rs_order_lines SET ready_at = NULL, ready_by = NULL WHERE order_id = ? AND ticket = ? AND station = ? AND served_at IS NULL AND ready_at IS NOT NULL`)
        .run(id, input.ticket, input.station);
    if (Number(changed.changes) > 0) {
      db.prepare('UPDATE rs_orders SET updated_at = ? WHERE id = ?').run(at, id);
      audit(db, actor.name, input.ready ? 'rs_ready' : 'rs_not_ready', 'rs_order', id, { ticket: input.ticket, station: input.station });
    }
  });
  return { ok: true };
}

/** The waiter took what was ready to the table: the table no longer shows it waiting. */
export function markServed(db: Db, id: string, actor: Actor): OrderView {
  requirePlan(db);
  requireWaiter(actor);
  transaction(db, () => {
    const row = loadOrder(db, id);
    assertMine(db, row, actor);
    if (row.status === 'cancelled') throw conflict('rs_order_closed', { status: row.status });
    const at = now();
    const changed = db.prepare('UPDATE rs_order_lines SET served_at = ? WHERE order_id = ? AND ready_at IS NOT NULL AND served_at IS NULL AND voided_at IS NULL').run(at, id);
    if (Number(changed.changes) > 0) db.prepare('UPDATE rs_orders SET updated_at = ? WHERE id = ?').run(at, id);
  });
  return getOrder(db, id, actor);
}

/* ---------------- the API ---------------- */

const id = z.string().min(1).max(64);
const idParam = z.object({ id }).strict();
const lineParam = z.object({ id, lineId: id }).strict();
const nameSchema = z.object({ ar: z.string().max(60), en: z.string().max(60), ku: z.string().max(60) }).strict();
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const qty = z.number().int().positive().max(RS_MAX_QTY_MILLI);
const note = z.string().max(RS_MAX_NOTE);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const areaBody = z.object({ name: nameSchema, family: z.boolean().optional(), sort: z.number().int().min(0).max(10_000).optional(), active: z.boolean().optional() }).strict();
const tableBody = z.object({
  areaId: id, name: z.string().max(20), seats: z.number().int().min(1).max(99).optional(), sort: z.number().int().min(0).max(10_000).optional(), active: z.boolean().optional()
}).strict();
const openBody = z.object({
  kind: z.enum(['table', 'takeaway', 'delivery']), tableId: id.optional(), guests: z.number().int().min(1).max(RS_MAX_GUESTS).optional(), partyId: id.optional(),
  phone: z.string().max(30).optional(), address: z.string().max(300).optional(), notes: z.string().max(300).optional(), warehouseId: id.optional()
}).strict();
const patchBody = z.object({
  guests: z.number().int().min(1).max(RS_MAX_GUESTS).nullable().optional(), partyId: id.nullable().optional(), phone: z.string().max(30).nullable().optional(),
  address: z.string().max(300).nullable().optional(), notes: z.string().max(300).nullable().optional()
}).strict();
const addBody = z.object({ lines: z.array(z.object({ itemId: id, qtyMilli: qty, note: note.optional() }).strict()).min(1).max(RS_MAX_ADD) }).strict();
const lineBody = z.object({ qtyMilli: qty.optional(), note: note.nullable().optional() }).strict();
const voidBody = z.object({ reason: z.string().min(1).max(200), qtyMilli: qty.optional() }).strict();
const payBody = z.object({
  shiftId: id,
  lines: z.array(z.object({ lineId: id, qtyMilli: qty }).strict()).max(RS_MAX_LINES).optional(),
  discount: money.optional(), partyId: id.optional(),
  payments: z.array(z.object({ method: z.enum(['cash', 'card', 'fib', 'zaincash', 'qi', 'account']), amount: money }).strict()).max(4).optional(),
  tendered: money.optional(), approvals: z.array(z.string().max(64)).max(4).optional()
}).strict();

const kitchenBody = z.object({
  tickets: z.enum(RS_TICKET_MODES),
  stations: z.array(z.object({ categoryId: id, station: z.enum(RS_STATIONS) }).strict()).max(500)
}).strict();
const readyBody = z.object({ ticket: z.number().int().min(1).max(100_000), station: z.enum(RS_STATIONS), ready: z.boolean() }).strict();
const recipeBody = z.object({
  parts: z.array(z.object({ ingredientId: id, qtyMilli: z.number().int().positive().max(1_000_000_000) }).strict()).max(RECIPE_MAX_PARTS)
}).strict();

export const restaurantApi: ApiExtension = {
  rules: {
    // the room is set up by an admin
    'POST /api/restaurant/areas': 'admin',
    'PUT /api/restaurant/areas/:id': 'admin',
    'POST /api/restaurant/tables': 'admin',
    'PUT /api/restaurant/tables/:id': 'admin',
    'POST /api/restaurant/room': 'admin',
    // taking orders: whoever sells ('pos' or 'sales', checked by each), cancelling what is cooking: a supervisor
    'POST /api/restaurant/orders': null,
    'PUT /api/restaurant/orders/:id': null,
    'POST /api/restaurant/orders/:id/lines': null,
    'PUT /api/restaurant/orders/:id/lines/:lineId': null,
    'DELETE /api/restaurant/orders/:id/lines/:lineId': null,
    'POST /api/restaurant/orders/:id/lines/:lineId/void': 'posSupervise',
    'POST /api/restaurant/orders/:id/send': null,
    'POST /api/restaurant/orders/:id/bill': null,
    'POST /api/restaurant/orders/:id/move': null,
    'POST /api/restaurant/orders/:id/merge': null,
    'POST /api/restaurant/orders/:id/cancel': null,
    'POST /api/restaurant/orders/:id/reopen': 'posSupervise',
    // paying is a sale at the till: the cashier's, on their own open shift (pos.ts checks it)
    'POST /api/restaurant/orders/:id/pay': 'pos',
    // the kitchen screen's "ready", and the waiter's "served": whoever takes orders (checked by each)
    'POST /api/restaurant/orders/:id/ready': null,
    'POST /api/restaurant/orders/:id/served': null,
    // how tickets go to the kitchen and which station makes what: an admin's; a dish's recipe: whoever keeps the items
    'PUT /api/restaurant/kitchen-settings': 'admin',
    'PUT /api/restaurant/recipes/:id': 'stock'
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      { method: 'GET', path: '/api/restaurant', handler: async () => ({ available: restaurantAvailable(db), areas: listAreas(db), tables: listTables(db), kitchen: kitchenSettings(db) }) },
      {
        method: 'PUT', path: '/api/restaurant/kitchen-settings',
        handler: async (req) => saveKitchenSettings(db, parse(kitchenBody, req.body), actor(req))
      },
      {
        // the kitchen screen: GET …/kitchen?station=grill (all stations without one)
        method: 'GET', path: '/api/restaurant/kitchen',
        handler: async (req) => {
          const q = parse(z.object({ station: z.enum(RS_STATIONS).optional() }).strict(), req.query ?? {});
          return kitchen(db, q.station ?? 'all', actor(req));
        }
      },
      {
        method: 'POST', path: '/api/restaurant/orders/:id/ready',
        handler: async (req) => markReady(db, parse(idParam, req.params).id, parse(readyBody, req.body), actor(req))
      },
      { method: 'POST', path: '/api/restaurant/orders/:id/served', handler: async (req) => { parse(z.object({}).strict(), req.body ?? {}); return markServed(db, parse(idParam, req.params).id, actor(req)); } },
      {
        method: 'GET', path: '/api/restaurant/recipes',
        handler: async (req) => listRecipes(db, actor(req))
      },
      {
        method: 'PUT', path: '/api/restaurant/recipes/:id',
        handler: async (req) => {
          requirePlan(db);
          return { recipe: saveRecipe(db, parse(idParam, req.params).id, parse(recipeBody, req.body).parts, actor(req)) };
        }
      },
      { method: 'GET', path: '/api/restaurant/floor', handler: async (req) => floor(db, actor(req)) },
      {
        method: 'POST', path: '/api/restaurant/areas',
        handler: async (req, reply) => { reply.status(201).send(saveArea(db, null, parse(areaBody, req.body), actor(req))); return undefined; }
      },
      { method: 'PUT', path: '/api/restaurant/areas/:id', handler: async (req) => saveArea(db, parse(idParam, req.params).id, parse(areaBody, req.body), actor(req)) },
      {
        method: 'POST', path: '/api/restaurant/tables',
        handler: async (req, reply) => { reply.status(201).send(saveTable(db, null, parse(tableBody, req.body), actor(req))); return undefined; }
      },
      { method: 'PUT', path: '/api/restaurant/tables/:id', handler: async (req) => saveTable(db, parse(idParam, req.params).id, parse(tableBody, req.body), actor(req)) },
      {
        method: 'POST', path: '/api/restaurant/room',
        handler: async (req) => quickRoom(db, parse(z.object({ tables: z.number().int().min(1).max(60), family: z.number().int().min(0).max(30) }).strict(), req.body), actor(req))
      },
      {
        method: 'GET', path: '/api/restaurant/orders',
        handler: async (req) => {
          const q = parse(z.object({ status: z.enum(['open', 'closed', 'cancelled']).optional(), from: isoDate.optional(), to: isoDate.optional() }).strict(), req.query ?? {});
          return { orders: listOrders(db, q, actor(req)) };
        }
      },
      { method: 'GET', path: '/api/restaurant/orders/:id', handler: async (req) => getOrder(db, parse(idParam, req.params).id, actor(req)) },
      {
        method: 'POST', path: '/api/restaurant/orders',
        handler: async (req, reply) => {
          const who = actor(req);
          const body = parse(openBody, req.body);
          reply.status(201).send(onceOnly(db, req, reply, who, 'POST /api/restaurant/orders', () => { const o = openOrder(db, body, who); return { id: o.id, result: o }; }, (orderId) => getOrder(db, orderId, who)));
          return undefined;
        }
      },
      { method: 'PUT', path: '/api/restaurant/orders/:id', handler: async (req) => updateOrder(db, parse(idParam, req.params).id, parse(patchBody, req.body), actor(req)) },
      {
        method: 'POST', path: '/api/restaurant/orders/:id/lines',
        handler: async (req, reply) => {
          const who = actor(req);
          const orderId = parse(idParam, req.params).id;
          const body = parse(addBody, req.body);
          // a try whose answer was lost and is sent again adds the dishes once
          return onceOnly(db, req, reply, who, 'POST /api/restaurant/orders/:id/lines', () => ({ id: orderId, result: addLines(db, orderId, body.lines, who) }), () => getOrder(db, orderId, who));
        }
      },
      {
        method: 'PUT', path: '/api/restaurant/orders/:id/lines/:lineId',
        handler: async (req) => { const p = parse(lineParam, req.params); return changeLine(db, p.id, p.lineId, parse(lineBody, req.body), actor(req)); }
      },
      {
        method: 'DELETE', path: '/api/restaurant/orders/:id/lines/:lineId',
        handler: async (req) => { const p = parse(lineParam, req.params); return removeLine(db, p.id, p.lineId, actor(req)); }
      },
      {
        method: 'POST', path: '/api/restaurant/orders/:id/lines/:lineId/void',
        handler: async (req) => { const p = parse(lineParam, req.params); return voidLine(db, p.id, p.lineId, parse(voidBody, req.body), actor(req)); }
      },
      { method: 'POST', path: '/api/restaurant/orders/:id/send', handler: async (req) => sendToKitchen(db, parse(idParam, req.params).id, actor(req)) },
      {
        // a ticket printed again: GET …/ticket?n=2
        method: 'GET', path: '/api/restaurant/orders/:id/ticket',
        handler: async (req) => {
          const q = parse(z.object({ n: z.string().regex(/^[1-9]\d{0,3}$/) }).strict(), req.query ?? {});
          return ticketAgain(db, parse(idParam, req.params).id, Number(q.n), actor(req));
        }
      },
      { method: 'POST', path: '/api/restaurant/orders/:id/bill', handler: async (req) => billPrinted(db, parse(idParam, req.params).id, actor(req)) },
      { method: 'POST', path: '/api/restaurant/orders/:id/move', handler: async (req) => moveOrder(db, parse(idParam, req.params).id, parse(z.object({ tableId: id }).strict(), req.body).tableId, actor(req)) },
      { method: 'POST', path: '/api/restaurant/orders/:id/merge', handler: async (req) => mergeOrder(db, parse(idParam, req.params).id, parse(z.object({ intoId: id }).strict(), req.body).intoId, actor(req)) },
      { method: 'POST', path: '/api/restaurant/orders/:id/cancel', handler: async (req) => cancelOrder(db, parse(idParam, req.params).id, parse(z.object({ reason: z.string().min(1).max(200) }).strict(), req.body).reason, actor(req)) },
      { method: 'POST', path: '/api/restaurant/orders/:id/reopen', handler: async (req) => reopenOrder(db, parse(idParam, req.params).id, actor(req)) },
      {
        method: 'POST', path: '/api/restaurant/orders/:id/pay',
        handler: async (req, reply) => {
          const who = actor(req);
          const orderId = parse(idParam, req.params).id;
          const body = parse(payBody, req.body) as PayInput;
          // money: a try whose answer was lost and is sent again with its key is the same sale, never a second one
          return onceOnly(db, req, reply, who, 'POST /api/restaurant/orders/:id/pay',
            () => { const paid = payOrder(db, orderId, body, who); return { id: paid.invoice.id, result: paid }; }, (invoiceId) => paidAgain(db, orderId, invoiceId, who));
        }
      }
    ];
  }
};

