import { randomUUID } from 'node:crypto';
import { addDays, isCurrency, isMinorAmount, isUnit, normalizeForSearch, todayIso, type CurrencyCode, type ItemUnit, type Names, type UnitCode } from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { conflict, invalid, notFound } from './errors.ts';
import { assertWithinLimit } from './license.ts';
import { assertItemUnits, openDocumentsWithItem, replaceItemUnits, unitsByItem, type ItemUnitView } from './item-units.ts';
import { startTracking } from './batches.ts';
import { assertItemCategory } from './categories.ts';

// ——— Warehouses (المخازن) ———

export interface WarehouseView {
  id: string;
  code: string;
  name: Names;
  accountCode: string;
  active: boolean;
  /** Stock value in IQD. */
  value: number;
}

interface WarehouseRow { id: string; code: string; name_ar: string; name_en: string; name_ku: string; account_code: string; active: number }

export function listWarehouses(db: Db): WarehouseView[] {
  const rows = db.prepare('SELECT * FROM warehouses ORDER BY code').all() as unknown as WarehouseRow[];
  const values = new Map((db.prepare('SELECT warehouse_id, SUM(value) AS value FROM stock_moves GROUP BY warehouse_id').all() as { warehouse_id: string; value: number }[])
    .map((r) => [r.warehouse_id, r.value]));
  return rows.map((r) => ({
    id: r.id, code: r.code, name: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, accountCode: r.account_code, active: r.active === 1,
    value: values.get(r.id) ?? 0
  }));
}

export function getWarehouse(db: Db, id: string): WarehouseView {
  const found = listWarehouses(db).find((w) => w.id === id);
  if (!found) throw notFound('warehouse');
  return found;
}

function assertNames(name: Names): void {
  if (!name.ar.trim() && !name.en.trim() && !name.ku.trim()) throw invalid([{ code: 'name_required' }]);
}

/** Fixed-width leaves stay siblings. Skip entire branches already occupied by other accounts. */
function nextWarehouseAccount(db: Db): string {
  const codes = (db.prepare("SELECT code FROM accounts WHERE code LIKE '137%' AND code <> '137'").all() as { code: string }[]).map((r) => r.code);
  for (let n = 1; n <= 999_999;) {
    const code = `137${String(n).padStart(6, '0')}`;
    const parent = codes.find((c) => code.startsWith(c));
    if (parent) {
      const block = 10 ** (code.length - parent.length);
      n = (Math.floor(n / block) + 1) * block;
    } else if (codes.some((c) => c.startsWith(code))) n += 1;
    else return code;
  }
  throw conflict('warehouse_accounts_full');
}

/** A new warehouse gets its own inventory account under 137, so the trial balance shows stock per warehouse. */
export function createWarehouse(db: Db, input: { code: string; name: Names }, user: string): WarehouseView {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,12}$/.test(code)) throw invalid([{ code: 'code_invalid' }]);
  assertNames(input.name);
  if (db.prepare('SELECT 1 FROM warehouses WHERE code = ?').get(code)) throw conflict('code_exists');
  assertWithinLimit(db, 'warehouses', (db.prepare('SELECT COUNT(*) AS n FROM warehouses').get() as { n: number }).n);
  if (db.prepare("SELECT 1 FROM entry_lines WHERE account_code = '137' LIMIT 1").get()) throw conflict('parent_has_entries');
  const id = randomUUID();
  transaction(db, () => {
    const accountCode = nextWarehouseAccount(db);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO accounts (code, name_ar, name_en, name_ku, "system", created_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(accountCode, input.name.ar.trim() || input.name.en.trim(), input.name.en.trim() || input.name.ar.trim(), input.name.ku.trim() || input.name.ar.trim(), now);
    db.prepare('INSERT INTO warehouses (id, code, name_ar, name_en, name_ku, account_code, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      .run(id, code, input.name.ar.trim(), input.name.en.trim(), input.name.ku.trim(), accountCode, now);
    audit(db, user, 'create', 'warehouse', id, { code, accountCode });
  });
  return getWarehouse(db, id);
}

export function updateWarehouse(db: Db, id: string, input: { name: Names; active?: boolean | undefined }, user: string): WarehouseView {
  getWarehouse(db, id);
  assertNames(input.name);
  transaction(db, () => {
    db.prepare('UPDATE warehouses SET name_ar = ?, name_en = ?, name_ku = ?, active = ? WHERE id = ?')
      .run(input.name.ar.trim(), input.name.en.trim(), input.name.ku.trim(), input.active === false ? 0 : 1, id);
    audit(db, user, 'update', 'warehouse', id, input);
  });
  return getWarehouse(db, id);
}

// ——— Items (المواد) and stock ———

export interface ItemInput {
  code?: string | undefined;
  barcode?: string | undefined;
  name: Names;
  unit: UnitCode;
  salePrice: number;
  saleCurrency: CurrencyCode;
  trackStock?: boolean | undefined;
  active?: boolean | undefined;
  /** 1.1: the other units (absent on an update: kept as they are) */
  units?: ItemUnit[] | undefined;
  /** the unit sale and purchase lines start in (null: the base unit; absent on an update: kept) */
  saleUnit?: UnitCode | null | undefined;
  purchaseUnit?: UnitCode | null | undefined;
  /** 1.1: stock kept per batch number; an expiry date asked on the way in (implies batches). Absent: new items follow the setting, updates keep them */
  trackBatches?: boolean | undefined;
  trackExpiry?: boolean | undefined;
  /** the item's category (null: none; absent on an update: kept) */
  categoryId?: string | null | undefined;
}

export interface ItemView {
  id: string;
  code: string;
  barcode: string;
  name: Names;
  unit: UnitCode;
  salePrice: number;
  saleCurrency: CurrencyCode;
  trackStock: boolean;
  active: boolean;
  /** Stock in thousandths, and its value in IQD (all warehouses, or the one asked for). */
  qtyMilli: number;
  value: number;
  hasMoves: boolean;
  /** 1.1: the other units, the default sale and purchase units (null: the base unit), and when the item last changed */
  units: ItemUnitView[];
  saleUnit: UnitCode | null;
  purchaseUnit: UnitCode | null;
  updatedAt: string | null;
  trackBatches: boolean;
  trackExpiry: boolean;
  categoryId: string | null;
}

interface ItemRow {
  id: string; code: string; barcode: string | null; name_ar: string; name_en: string; name_ku: string; unit: UnitCode;
  sale_price: number; sale_currency: CurrencyCode; track_stock: number; active: number;
  sale_unit: UnitCode | null; purchase_unit: UnitCode | null; updated_at: string | null; track_batches: number; track_expiry: number; category_id: string | null;
  qty: number | null; value: number | null; moves: number | null;
}

function toView(r: ItemRow, units: ItemUnitView[] = []): ItemView {
  return {
    id: r.id, code: r.code, barcode: r.barcode ?? '', name: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, unit: r.unit,
    salePrice: r.sale_price, saleCurrency: r.sale_currency, trackStock: r.track_stock === 1, active: r.active === 1,
    qtyMilli: r.qty ?? 0, value: r.value ?? 0, hasMoves: (r.moves ?? 0) > 0,
    units, saleUnit: r.sale_unit ?? null, purchaseUnit: r.purchase_unit ?? null, updatedAt: r.updated_at ?? null,
    trackBatches: Number(r.track_batches) === 1, trackExpiry: Number(r.track_expiry) === 1, categoryId: r.category_id ?? null
  };
}

/**
 * Warehouses to count stock in: undefined or null = every warehouse; a list = only those (an empty list = none, for
 * a user limited to branches that have no warehouse).
 */
export type WarehouseFilter = readonly string[] | null | undefined;
const whereWarehouse = (col: string, warehouses: WarehouseFilter): [string, string[]] =>
  warehouses ? [` AND ${col} IN (${warehouses.length ? warehouses.map(() => '?').join(', ') : 'NULL'})`, [...warehouses]] : ['', []];

function itemRows(db: Db, where: string, params: string[], warehouses?: WarehouseFilter): ItemRow[] {
  const [stockFilter, stockParams] = whereWarehouse('m.warehouse_id', warehouses);
  // hasMoves is about the item itself (it decides whether stock tracking may still be switched), so it counts everywhere
  return db.prepare(`SELECT i.*, s.qty, s.value, a.moves FROM items i
                     LEFT JOIN (SELECT item_id, SUM(qty_milli) AS qty, SUM(value) AS value
                                FROM stock_moves m WHERE 1 = 1${stockFilter} GROUP BY item_id) s ON s.item_id = i.id
                     LEFT JOIN (SELECT item_id, COUNT(*) AS moves FROM stock_moves GROUP BY item_id) a ON a.item_id = i.id
                     ${where} ORDER BY i.code`).all(...stockParams, ...params) as unknown as ItemRow[];
}

/**
 * The items with their stock: in the warehouse asked for, or else in `warehouses` (a user limited to branches: their
 * branches' warehouses only), or else in every warehouse.
 */
export function listItems(
  db: Db, filters: { q?: string | undefined; warehouseId?: string | undefined; active?: boolean | undefined; categoryId?: string | undefined } = {}, warehouses: WarehouseFilter = null
): ItemView[] {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filters.active !== undefined) conditions.push(`i.active = ${filters.active ? 1 : 0}`);
  // "none": items with no category
  if (filters.categoryId === 'none') conditions.push('i.category_id IS NULL');
  else if (filters.categoryId) { conditions.push('i.category_id = ?'); params.push(filters.categoryId); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const q = filters.q ? normalizeForSearch(filters.q) : '';
  const units = unitsByItem(db);
  // a unit's barcode finds its item too
  const unitBarcodes = (id: string) => (units.get(id) ?? []).map((u) => u.barcode).join(' ');
  return itemRows(db, where, params, filters.warehouseId ? [filters.warehouseId] : warehouses)
    .filter((r) => !q || normalizeForSearch(`${r.code} ${r.barcode ?? ''} ${unitBarcodes(r.id)} ${r.name_ar} ${r.name_en} ${r.name_ku}`).includes(q))
    .map((r) => toView(r, units.get(r.id)));
}

/** An item with its stock in `warehouses` (null: every warehouse). */
export function getItem(db: Db, id: string, warehouses: WarehouseFilter = null): ItemView {
  const row = itemRows(db, 'WHERE i.id = ?', [id], warehouses)[0];
  if (!row) throw notFound('item');
  return toView(row, unitsByItem(db, [id]).get(id));
}

function assertItem(db: Db, input: ItemInput, id: string | null): void {
  const errors: { code: string }[] = [];
  if (!input.name || (!input.name.ar.trim() && !input.name.en.trim() && !input.name.ku.trim())) errors.push({ code: 'name_required' });
  if (!isUnit(input.unit)) errors.push({ code: 'unit_invalid' });
  if (!isMinorAmount(input.salePrice) || input.salePrice < 0) errors.push({ code: 'price_invalid' });
  if (!isCurrency(input.saleCurrency)) errors.push({ code: 'currency_invalid' });
  if (input.code !== undefined && input.code.trim() && !/^[\p{L}\p{N}._\/-]{1,24}$/u.test(input.code.trim())) errors.push({ code: 'code_invalid' });
  if (errors.length) throw invalid(errors);
  const code = input.code?.trim();
  if (code && db.prepare("SELECT 1 FROM items WHERE code = ? AND id <> COALESCE(?, '')").get(code, id ?? null)) throw conflict('code_exists');
  const barcode = input.barcode?.trim();
  if (barcode && db.prepare("SELECT 1 FROM items WHERE barcode = ? AND id <> COALESCE(?, '')").get(barcode, id ?? null)) throw conflict('barcode_exists');
  if (input.unit === 'service' && input.units?.length) throw invalid([{ code: 'unit_invalid' }]);
  assertItemCategory(db, input.categoryId, id);
  const current = id ? (db.prepare('SELECT sale_unit, purchase_unit FROM items WHERE id = ?').get(id) as { sale_unit: string | null; purchase_unit: string | null } | undefined) : undefined;
  assertItemUnits(db, {
    unit: input.unit, barcode: input.barcode, units: input.units,
    saleUnit: input.saleUnit === undefined ? current?.sale_unit : input.saleUnit,
    purchaseUnit: input.purchaseUnit === undefined ? current?.purchase_unit : input.purchaseUnit
  }, id);
}

export function createItem(db: Db, input: ItemInput, user: string): ItemView {
  assertItem(db, input, null);
  const id = randomUUID();
  transaction(db, () => {
    let code = input.code?.trim();
    while (!code || db.prepare('SELECT 1 FROM items WHERE code = ?').get(code)) {
      code = `I-${String(nextSequence(db, 'item')).padStart(4, '0')}`;
    }
    const now = new Date().toISOString();
    const stocked = !(input.unit === 'service' || input.trackStock === false);
    // a new item starts with the company's choice for expiry dates (a pharmacy: on); expiry implies batches
    const expiry = stocked && (input.trackExpiry ?? readTrackExpiryDefault(db));
    const batches = stocked && (expiry || input.trackBatches === true);
    db.prepare(`INSERT INTO items (id, code, barcode, name_ar, name_en, name_ku, unit, sale_price, sale_currency, track_stock, active, created_at,
                                   sale_unit, purchase_unit, updated_at, track_batches, track_expiry, category_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, code, input.barcode?.trim() || null, input.name.ar.trim(), input.name.en.trim(), input.name.ku.trim(), input.unit,
        input.salePrice, input.saleCurrency, stocked ? 1 : 0, input.active === false ? 0 : 1,
        now, input.saleUnit ?? null, input.purchaseUnit ?? null, now, batches ? 1 : 0, expiry ? 1 : 0, input.categoryId ?? null);
    if (input.units?.length) replaceItemUnits(db, id, input.units);
    audit(db, user, 'create', 'item', id, { code });
  });
  return getItem(db, id);
}

export function updateItem(db: Db, id: string, input: ItemInput, user: string): ItemView {
  const current = getItem(db, id);
  assertItem(db, input, id);
  // the base unit is what stock and every posted line count in: it changes only while nothing has moved
  if (input.unit !== current.unit && current.hasMoves) throw conflict('item_has_moves');
  // nor while an open document names the item: its quantities, typed in the old base unit, would be read in the new one
  if (input.unit !== current.unit) {
    const drafts = openDocumentsWithItem(db, id);
    if (drafts.length) throw conflict('base_unit_in_use', { drafts });
  }
  const trackStock = input.unit === 'service' || input.trackStock === false ? false : true;
  // Switching stock tracking on or off would leave the stock and the books telling different stories.
  if (trackStock !== current.trackStock && current.hasMoves) throw conflict('item_has_moves');
  const trackExpiry = trackStock && (input.trackExpiry ?? current.trackExpiry);
  const trackBatches = trackStock && (trackExpiry || (input.trackBatches ?? current.trackBatches));
  transaction(db, () => {
    db.prepare(`UPDATE items SET code = ?, barcode = ?, name_ar = ?, name_en = ?, name_ku = ?, unit = ?, sale_price = ?, sale_currency = ?,
                track_stock = ?, active = ?, sale_unit = ?, purchase_unit = ?, updated_at = ? WHERE id = ?`)
      .run(input.code?.trim() || current.code, input.barcode?.trim() || null, input.name.ar.trim(), input.name.en.trim(), input.name.ku.trim(),
        input.unit, input.salePrice, input.saleCurrency, trackStock ? 1 : 0, input.active === false ? 0 : 1,
        input.saleUnit === undefined ? current.saleUnit : input.saleUnit, input.purchaseUnit === undefined ? current.purchaseUnit : input.purchaseUnit,
        new Date().toISOString(), id);
    if (input.units) replaceItemUnits(db, id, input.units);
    db.prepare('UPDATE items SET track_batches = ?, track_expiry = ?, category_id = ? WHERE id = ?')
      .run(trackBatches ? 1 : 0, trackExpiry ? 1 : 0, input.categoryId === undefined ? current.categoryId : input.categoryId, id);
    // switched on: what is in stock goes into the batch with no number, so the batches add up to the stock from now on
    if (trackBatches && !current.trackBatches) startTracking(db, id);
    audit(db, user, 'update', 'item', id, input);
  });
  return getItem(db, id);
}

function readTrackExpiryDefault(db: Db): boolean {
  return (db.prepare('SELECT value FROM settings WHERE "key" = ?').get('default_track_expiry') as { value: string } | undefined)?.value === '1';
}

export function deleteItem(db: Db, id: string, user: string): void {
  getItem(db, id);
  if (db.prepare('SELECT 1 FROM invoice_lines WHERE item_id = ? UNION SELECT 1 FROM stock_moves WHERE item_id = ? LIMIT 1').get(id, id)) {
    throw conflict('item_has_moves');
  }
  // documents that are not in the books yet still name the item: deleting it would break them
  const usedBy = ['quote_lines', 'purchase_order_lines', 'stock_doc_lines', 'stock_adjustment_lines', 'serials', 're_projects']
    .map((table) => `SELECT 1 FROM ${table} WHERE item_id = ?`).join(' UNION ALL ');
  if (db.prepare(`${usedBy} LIMIT 1`).get(id, id, id, id, id, id)) throw conflict('item_in_use');
  transaction(db, () => {
    // what belongs to the item alone goes with it: its picture, its price-list prices and its car-part details
    // (and its place on the item list a stock count fixed when it started: that is no document)
    for (const table of ['item_images', 'item_prices', 'part_fitments', 'part_numbers', 'part_details', 'stock_count_items', 'item_units', 'pharma_details', 'item_batches']) {
      db.prepare(`DELETE FROM ${table} WHERE item_id = ?`).run(id);
    }
    db.prepare('DELETE FROM items WHERE id = ?').run(id);
    audit(db, user, 'delete', 'item', id);
  });
}

/** Quantity and IQD value of one item in one warehouse. */
export function stockOf(db: Db, itemId: string, warehouseId: string): { qtyMilli: number; value: number } {
  const row = db.prepare('SELECT SUM(qty_milli) AS qty, SUM(value) AS value FROM stock_moves WHERE item_id = ? AND warehouse_id = ?')
    .get(itemId, warehouseId) as { qty: number | null; value: number | null };
  return { qtyMilli: row.qty ?? 0, value: row.value ?? 0 };
}

export interface StockByWarehouse { warehouseId: string; warehouseCode: string; warehouseName: Names; qtyMilli: number; value: number }

/** An item's stock per warehouse (only `warehouses` when given: a user limited to branches sees their own). */
export function itemStock(db: Db, itemId: string, warehouses: WarehouseFilter = null): StockByWarehouse[] {
  const [w, wp] = whereWarehouse('m.warehouse_id', warehouses);
  return (db.prepare(`SELECT w.id, w.code, w.name_ar, w.name_en, w.name_ku, SUM(m.qty_milli) AS qty, SUM(m.value) AS value
                      FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id WHERE m.item_id = ?${w}
                      GROUP BY w.id, w.code, w.name_ar, w.name_en, w.name_ku ORDER BY w.code`).all(itemId, ...wp) as
    { id: string; code: string; name_ar: string; name_en: string; name_ku: string; qty: number; value: number }[])
    .map((r) => ({ warehouseId: r.id, warehouseCode: r.code, warehouseName: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, qtyMilli: r.qty, value: r.value }));
}

export interface StockMoveView {
  id: number;
  date: string;
  warehouseCode: string;
  qtyMilli: number;
  value: number;
  sourceType: string;
  sourceId: string | null;
  sourceNumber: string | null;
  /** Stock after this move, in the same warehouse. */
  balanceQtyMilli: number;
}

/**
 * بطاقة المادة — every stock move of an item, oldest first, with a running quantity per warehouse (only the moves of
 * `warehouses` when given; the running quantity is per warehouse, so it is the same either way).
 */
export function itemMoves(db: Db, itemId: string, warehouses: WarehouseFilter = null): StockMoveView[] {
  getItem(db, itemId);
  const [w, wp] = whereWarehouse('m.warehouse_id', warehouses);
  const rows = db.prepare(`SELECT m.id, m.date, m.qty_milli, m.value, m.source_type, m.source_id, m.warehouse_id, w.code AS warehouse_code,
                                  COALESCE(i.number, d.number) AS number
                           FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id
                           LEFT JOIN invoices i ON i.id = m.source_id
                           LEFT JOIN stock_docs d ON d.id = m.source_id
                           WHERE m.item_id = ?${w} ORDER BY m.date, m.id`).all(itemId, ...wp) as
    { id: number; date: string; qty_milli: number; value: number; source_type: string; source_id: string | null; warehouse_id: string; warehouse_code: string; number: string | null }[];
  const running = new Map<string, number>();
  return rows.map((r) => {
    const balance = (running.get(r.warehouse_id) ?? 0) + r.qty_milli;
    running.set(r.warehouse_id, balance);
    return {
      id: r.id, date: r.date, warehouseCode: r.warehouse_code, qtyMilli: r.qty_milli, value: r.value, sourceType: r.source_type,
      sourceId: r.source_id, sourceNumber: r.number, balanceQtyMilli: balance
    };
  });
}

/**
 * A scanned barcode: an item's own (its base unit) or one of its units' (that unit). Inactive items are found too, as
 * by the item list; the screen decides.
 */
export function findByBarcode(db: Db, barcode: string, warehouses: WarehouseFilter = null): { item: ItemView | null; unit: UnitCode | null } {
  const code = barcode.trim();
  if (!code) return { item: null, unit: null };
  const own = db.prepare('SELECT id FROM items WHERE barcode = ?').get(code) as { id: string } | undefined;
  if (own) return { item: getItem(db, own.id, warehouses), unit: null };
  const unit = db.prepare('SELECT item_id, unit FROM item_units WHERE barcode = ?').get(code) as { item_id: string; unit: UnitCode } | undefined;
  return unit ? { item: getItem(db, unit.item_id, warehouses), unit: unit.unit } : { item: null, unit: null };
}

/**
 * How far ahead of today a stock move may be dated. Every later move of the same item in the same warehouse must be on
 * or after the newest one, and moves are never changed or deleted, so a move dated far ahead (a mistyped year, or on
 * purpose) would block that item there until that day, with no way back short of a backup.
 */
export const STOCK_DATE_AHEAD_DAYS = 31;

export function addStockMove(db: Db, move: { itemId: string; warehouseId: string; date: string; qtyMilli: number; value: number; sourceType: string; sourceId: string }): void {
  const latestAllowed = addDays(todayIso(), STOCK_DATE_AHEAD_DAYS);
  if (move.date > latestAllowed) throw invalid([{ code: 'stock_date_too_far', date: latestAllowed }]);
  // Costs are calculated in posting order. A backdated move would invalidate the dated stock history.
  const latest = (db.prepare('SELECT MAX(date) AS date FROM stock_moves WHERE item_id = ? AND warehouse_id = ?')
    .get(move.itemId, move.warehouseId) as { date: string | null }).date;
  if (latest && move.date < latest) throw invalid([{ code: 'stock_date_before_latest', date: latest }]);
  db.prepare('INSERT INTO stock_moves (item_id, warehouse_id, date, qty_milli, value, source_type, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(move.itemId, move.warehouseId, move.date, move.qtyMilli, move.value, move.sourceType, move.sourceId, new Date().toISOString());
}
