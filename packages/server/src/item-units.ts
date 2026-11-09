import { isUnit, toBaseQty, validateItemUnits, type ItemUnit, type UnitCode } from '@qasa/core';
import type { Db } from './db.ts';
import { conflict, invalid } from './errors.ts';

/**
 * An item's other units (item_units): boxes, strips … each with a factor (base units in one, in thousandths), a
 * barcode and a price. The base unit is items.unit and is never listed here.
 */

export interface ItemUnitView { unit: UnitCode; factorMilli: number; barcode: string; salePrice: number | null }

interface UnitRow { item_id: string; unit: UnitCode; factor_milli: number; barcode: string | null; sale_price: number | null }

const view = (r: UnitRow): ItemUnitView => ({
  unit: r.unit, factorMilli: Number(r.factor_milli), barcode: r.barcode ?? '', salePrice: r.sale_price === null ? null : Number(r.sale_price)
});

export function itemUnits(db: Db, itemId: string): ItemUnitView[] {
  return (db.prepare('SELECT * FROM item_units WHERE item_id = ? ORDER BY sort, unit').all(itemId) as unknown as UnitRow[]).map(view);
}

/** The units of many items at once (an item list), by item id. */
export function unitsByItem(db: Db, itemIds?: readonly string[]): Map<string, ItemUnitView[]> {
  const map = new Map<string, ItemUnitView[]>();
  const rows = (itemIds === undefined
    ? db.prepare('SELECT * FROM item_units ORDER BY item_id, sort, unit').all()
    : itemIds.length
      ? db.prepare(`SELECT * FROM item_units WHERE item_id IN (${itemIds.map(() => '?').join(', ')}) ORDER BY item_id, sort, unit`).all(...itemIds)
      : []) as unknown as UnitRow[];
  for (const r of rows) {
    const list = map.get(r.item_id) ?? [];
    list.push(view(r));
    map.set(r.item_id, list);
  }
  return map;
}

/**
 * Who has a barcode already: an item's own barcode, or one of an item's units (`except`: the item being saved, whose
 * own barcodes are checked by validateItemUnits).
 */
export function barcodeOwner(db: Db, barcode: string, except: string | null): { itemId: string; code: string; unit: UnitCode | null } | null {
  const own = db.prepare("SELECT id, code FROM items WHERE barcode = ? AND id <> COALESCE(?, '')").get(barcode, except) as { id: string; code: string } | undefined;
  if (own) return { itemId: own.id, code: own.code, unit: null };
  const unit = db.prepare(`SELECT u.item_id, u.unit, i.code FROM item_units u JOIN items i ON i.id = u.item_id
                           WHERE u.barcode = ? AND u.item_id <> COALESCE(?, '')`).get(barcode, except) as { item_id: string; unit: UnitCode; code: string } | undefined;
  return unit ? { itemId: unit.item_id, code: unit.code, unit: unit.unit } : null;
}

export interface UnitsInput {
  unit: UnitCode;
  barcode?: string | undefined;
  saleUnit?: string | null | undefined;
  purchaseUnit?: string | null | undefined;
  units?: ItemUnit[] | undefined;
}

/** Checks an item's units: the rules (core), barcodes against every other item, and units still used by drafts. */
export function assertItemUnits(db: Db, input: UnitsInput, id: string | null): void {
  const units = input.units ?? (id ? itemUnits(db, id) : []);
  const errors = validateItemUnits({ unit: input.unit, barcode: input.barcode, saleUnit: input.saleUnit, purchaseUnit: input.purchaseUnit }, units);
  if (errors.length) throw invalid(errors);
  for (const u of units) {
    const barcode = u.barcode?.trim();
    if (!barcode) continue;
    const owner = barcodeOwner(db, barcode, id);
    if (owner) throw conflict('barcode_taken', { barcode, item: owner.code, unit: u.unit });
  }
  const own = input.barcode?.trim();
  if (own) {
    const owner = db.prepare("SELECT i.code FROM item_units u JOIN items i ON i.id = u.item_id WHERE u.barcode = ? AND u.item_id <> COALESCE(?, '')").get(own, id) as { code: string } | undefined;
    if (owner) throw conflict('barcode_taken', { barcode: own, item: owner.code });
  }
  if (id && input.units) {
    const kept = new Set(input.units.map((u) => u.unit));
    // the base unit changing also drops every line typed in the old base unit's terms: those name the unit itself
    const removed = itemUnits(db, id).map((u) => u.unit).filter((u) => !kept.has(u));
    const drafts = removed.length ? draftsUsing(db, id, removed) : [];
    if (drafts.length) throw conflict('unit_in_use', { units: removed, drafts });
  }
}

/** Open documents (drafts, purchase orders not received) with lines in one of `units` of an item. */
export function draftsUsing(db: Db, itemId: string, units: readonly string[]): { type: string; id: string }[] {
  if (!units.length) return [];
  const marks = units.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT 'invoice' AS type, l.invoice_id AS id FROM invoice_lines l JOIN invoices v ON v.id = l.invoice_id
      WHERE v.status = 'draft' AND l.item_id = ? AND l.unit IN (${marks})
    UNION SELECT 'stock_doc' AS type, l.doc_id AS id FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
      WHERE d.status = 'draft' AND l.item_id = ? AND l.unit IN (${marks})
    UNION SELECT 'adjustment' AS type, l.adjustment_id AS id FROM stock_adjustment_lines l JOIN stock_adjustments a ON a.id = l.adjustment_id
      WHERE a.status = 'draft' AND l.item_id = ? AND l.unit IN (${marks})
    UNION SELECT 'purchase_order' AS type, l.order_id AS id FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id
      WHERE o.status IN ('draft', 'sent', 'partial') AND l.item_id = ? AND l.unit IN (${marks})`)
    .all(itemId, ...units, itemId, ...units, itemId, ...units, itemId, ...units) as { type: string; id: string }[];
  return rows.slice(0, 20);
}

/** Puts an item's units in place of what it had (inside the item's transaction). An empty barcode is kept as NULL. */
export function replaceItemUnits(db: Db, itemId: string, units: readonly ItemUnit[]): void {
  db.prepare('DELETE FROM item_units WHERE item_id = ?').run(itemId);
  const insert = db.prepare('INSERT INTO item_units (item_id, unit, factor_milli, barcode, sale_price, sort) VALUES (?, ?, ?, ?, ?, ?)');
  units.forEach((u, i) => insert.run(itemId, u.unit, u.factorMilli, u.barcode?.trim() || null, u.salePrice ?? null, i));
}

export interface ResolvedQty {
  /** the base quantity, thousandths */
  qtyMilli: number;
  /** null: the base unit (the line is kept as before 1.1) */
  unit: UnitCode | null;
  unitFactorMilli: number | null;
  unitQtyMilli: number | null;
}

/**
 * A line typed in a unit: its base quantity from the item's factor now (never a factor from the request). Without a
 * unit, or in the base unit, the quantity is the base quantity as before 1.1. Errors name the line (1-based).
 */
export function resolveLineQty(
  db: Db, line: { itemId: string; qtyMilli?: number | undefined; unit?: string | undefined; unitQtyMilli?: number | undefined }, lineNo: number
): ResolvedQty | { code: string; line: number } {
  if (line.unit === undefined || line.unit === null) {
    if (typeof line.qtyMilli !== 'number') return { code: 'line_qty_invalid', line: lineNo };
    return { qtyMilli: line.qtyMilli, unit: null, unitFactorMilli: null, unitQtyMilli: null };
  }
  if (!isUnit(line.unit)) return { code: 'unit_invalid', line: lineNo };
  const typed = line.unitQtyMilli ?? line.qtyMilli;
  if (typeof typed !== 'number' || !Number.isSafeInteger(typed) || typed === 0) return { code: 'line_qty_invalid', line: lineNo };
  const item = db.prepare('SELECT unit FROM items WHERE id = ?').get(line.itemId) as { unit: string } | undefined;
  if (!item) return { code: 'item_invalid', line: lineNo };
  if (item.unit === line.unit) return { qtyMilli: typed, unit: null, unitFactorMilli: null, unitQtyMilli: null };
  const row = db.prepare('SELECT factor_milli FROM item_units WHERE item_id = ? AND unit = ?').get(line.itemId, line.unit) as { factor_milli: number } | undefined;
  if (!row) return { code: 'unit_invalid', line: lineNo };
  const factor = Number(row.factor_milli);
  const base = toBaseQty(typed, factor);
  if (base === null) return { code: 'unit_qty_fraction', line: lineNo };
  return { qtyMilli: base, unit: line.unit, unitFactorMilli: factor, unitQtyMilli: typed };
}

/** Resolves every line, or fails with each line's error at once. */
export function resolveLines<L extends { itemId: string; qtyMilli?: number | undefined; unit?: string | undefined; unitQtyMilli?: number | undefined }>(
  db: Db, lines: readonly L[]
): (Omit<L, 'qtyMilli' | 'unit' | 'unitQtyMilli'> & { qtyMilli: number; unit?: UnitCode; unitFactorMilli?: number; unitQtyMilli?: number })[] {
  const errors: { code: string; line: number }[] = [];
  const out = lines.map((l, i) => {
    const r = resolveLineQty(db, l, i + 1);
    if ('code' in r) {
      errors.push(r);
      return { ...l, qtyMilli: 0 };
    }
    const { unit: _u, unitQtyMilli: _q, ...rest } = l;
    return {
      ...rest, qtyMilli: r.qtyMilli,
      ...(r.unit ? { unit: r.unit, unitFactorMilli: r.unitFactorMilli!, unitQtyMilli: r.unitQtyMilli! } : {})
    };
  });
  if (errors.length) throw invalid(errors);
  return out as never;
}

/** The base-unit price of a line kept in a unit (for reports that compare prices per base unit). */
export function basePriceOf(unitPrice: number, unitFactorMilli: number | null): number {
  if (!unitFactorMilli) return unitPrice;
  return Math.round((unitPrice * 1000) / unitFactorMilli);
}
