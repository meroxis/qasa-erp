import { randomUUID } from 'node:crypto';
import { isCurrency, isMinorAmount, isUnit, normalizeForSearch, type CurrencyCode, type Names, type UnitCode } from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { conflict, invalid, notFound } from './errors.ts';
import { assertWithinLimit } from './license.ts';

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
}

interface ItemRow {
  id: string; code: string; barcode: string | null; name_ar: string; name_en: string; name_ku: string; unit: UnitCode;
  sale_price: number; sale_currency: CurrencyCode; track_stock: number; active: number;
  qty: number | null; value: number | null; moves: number | null;
}

function toView(r: ItemRow): ItemView {
  return {
    id: r.id, code: r.code, barcode: r.barcode ?? '', name: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, unit: r.unit,
    salePrice: r.sale_price, saleCurrency: r.sale_currency, trackStock: r.track_stock === 1, active: r.active === 1,
    qtyMilli: r.qty ?? 0, value: r.value ?? 0, hasMoves: (r.moves ?? 0) > 0
  };
}

function itemRows(db: Db, where: string, params: string[], warehouseId?: string): ItemRow[] {
  const stockFilter = warehouseId ? 'AND m.warehouse_id = ?' : '';
  return db.prepare(`SELECT i.*, s.qty, s.value, s.moves FROM items i
                     LEFT JOIN (SELECT item_id, SUM(qty_milli) AS qty, SUM(value) AS value, COUNT(*) AS moves
                                FROM stock_moves m WHERE 1 = 1 ${stockFilter} GROUP BY item_id) s ON s.item_id = i.id
                     ${where} ORDER BY i.code`).all(...(warehouseId ? [warehouseId] : []), ...params) as unknown as ItemRow[];
}

export function listItems(db: Db, filters: { q?: string | undefined; warehouseId?: string | undefined; active?: boolean | undefined } = {}): ItemView[] {
  const where = filters.active === undefined ? '' : `WHERE i.active = ${filters.active ? 1 : 0}`;
  const q = filters.q ? normalizeForSearch(filters.q) : '';
  return itemRows(db, where, [], filters.warehouseId)
    .filter((r) => !q || normalizeForSearch(`${r.code} ${r.barcode ?? ''} ${r.name_ar} ${r.name_en} ${r.name_ku}`).includes(q))
    .map(toView);
}

export function getItem(db: Db, id: string): ItemView {
  const row = itemRows(db, 'WHERE i.id = ?', [id])[0];
  if (!row) throw notFound('item');
  return toView(row);
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
}

export function createItem(db: Db, input: ItemInput, user: string): ItemView {
  assertItem(db, input, null);
  const id = randomUUID();
  transaction(db, () => {
    let code = input.code?.trim();
    while (!code || db.prepare('SELECT 1 FROM items WHERE code = ?').get(code)) {
      code = `I-${String(nextSequence(db, 'item')).padStart(4, '0')}`;
    }
    db.prepare(`INSERT INTO items (id, code, barcode, name_ar, name_en, name_ku, unit, sale_price, sale_currency, track_stock, active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, code, input.barcode?.trim() || null, input.name.ar.trim(), input.name.en.trim(), input.name.ku.trim(), input.unit,
        input.salePrice, input.saleCurrency, input.unit === 'service' || input.trackStock === false ? 0 : 1, input.active === false ? 0 : 1,
        new Date().toISOString());
    audit(db, user, 'create', 'item', id, { code });
  });
  return getItem(db, id);
}

export function updateItem(db: Db, id: string, input: ItemInput, user: string): ItemView {
  const current = getItem(db, id);
  assertItem(db, input, id);
  const trackStock = input.unit === 'service' || input.trackStock === false ? false : true;
  // Switching stock tracking on or off would leave the stock and the books telling different stories.
  if (trackStock !== current.trackStock && current.hasMoves) throw conflict('item_has_moves');
  transaction(db, () => {
    db.prepare(`UPDATE items SET code = ?, barcode = ?, name_ar = ?, name_en = ?, name_ku = ?, unit = ?, sale_price = ?, sale_currency = ?,
                track_stock = ?, active = ? WHERE id = ?`)
      .run(input.code?.trim() || current.code, input.barcode?.trim() || null, input.name.ar.trim(), input.name.en.trim(), input.name.ku.trim(),
        input.unit, input.salePrice, input.saleCurrency, trackStock ? 1 : 0, input.active === false ? 0 : 1, id);
    audit(db, user, 'update', 'item', id, input);
  });
  return getItem(db, id);
}

export function deleteItem(db: Db, id: string, user: string): void {
  getItem(db, id);
  if (db.prepare('SELECT 1 FROM invoice_lines WHERE item_id = ? UNION SELECT 1 FROM stock_moves WHERE item_id = ? LIMIT 1').get(id, id)) {
    throw conflict('item_has_moves');
  }
  transaction(db, () => {
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

export function itemStock(db: Db, itemId: string): StockByWarehouse[] {
  return (db.prepare(`SELECT w.id, w.code, w.name_ar, w.name_en, w.name_ku, SUM(m.qty_milli) AS qty, SUM(m.value) AS value
                      FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id WHERE m.item_id = ? GROUP BY w.id ORDER BY w.code`).all(itemId) as
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

/** بطاقة المادة — every stock move of an item, oldest first, with a running quantity per warehouse. */
export function itemMoves(db: Db, itemId: string): StockMoveView[] {
  getItem(db, itemId);
  const rows = db.prepare(`SELECT m.id, m.date, m.qty_milli, m.value, m.source_type, m.source_id, m.warehouse_id, w.code AS warehouse_code,
                                  COALESCE(i.number, d.number) AS number
                           FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id
                           LEFT JOIN invoices i ON i.id = m.source_id
                           LEFT JOIN stock_docs d ON d.id = m.source_id
                           WHERE m.item_id = ? ORDER BY m.date, m.id`).all(itemId) as
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

export function addStockMove(db: Db, move: { itemId: string; warehouseId: string; date: string; qtyMilli: number; value: number; sourceType: string; sourceId: string }): void {
  // Costs are calculated in posting order. A backdated move would invalidate the dated stock history.
  const latest = (db.prepare('SELECT MAX(date) AS date FROM stock_moves WHERE item_id = ? AND warehouse_id = ?')
    .get(move.itemId, move.warehouseId) as { date: string | null }).date;
  if (latest && move.date < latest) throw invalid([{ code: 'stock_date_before_latest', date: latest }]);
  db.prepare('INSERT INTO stock_moves (item_id, warehouse_id, date, qty_milli, value, source_type, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(move.itemId, move.warehouseId, move.date, move.qtyMilli, move.value, move.sourceType, move.sourceId, new Date().toISOString());
}
