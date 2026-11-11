import type { Names, UnitCode } from '@qasa/core';
import type { Db } from './db.ts';

/**
 * Low stock (1.1): an item's minimum quantity is its own (items.reorder_milli), else its category's, else — for a
 * subcategory with none — its parent category's (item_categories.reorder_milli). Car parts keep theirs on the item too
 * (schema 11 moved part_details.reorder_milli there). The reorder list is the active, stocked items at or below it.
 */

/** The joins REORDER_LEVEL needs after `items it`. */
export const REORDER_JOINS = 'LEFT JOIN item_categories rc ON rc.id = it.category_id LEFT JOIN item_categories rp ON rp.id = rc.parent_id';
/** An item's minimum quantity (thousandths of its base unit), or NULL: none. */
export const REORDER_LEVEL = 'COALESCE(it.reorder_milli, rc.reorder_milli, rp.reorder_milli)';

export interface ReorderRow {
  itemId: string; code: string; name: Names; unit: UnitCode;
  qtyMilli: number; reorderMilli: number;
  /** where the level comes from: the item itself or its category */
  levelFrom: 'item' | 'category';
  categoryId: string | null; brandId: string | null;
}

/**
 * Items at or below their minimum quantity: in one warehouse, or in `warehouses` (a user limited to branches), or in
 * all. Ordered by category, then brand, then code, as the list shows them grouped.
 */
export function reorderList(db: Db, f: { warehouseId?: string | undefined } = {}, warehouses: readonly string[] | null = null): ReorderRow[] {
  const list = f.warehouseId ? [f.warehouseId] : warehouses;
  const where = list ? ` AND m.warehouse_id IN (${list.length ? list.map(() => '?').join(', ') : 'NULL'})` : '';
  const rows = db.prepare(`SELECT it.id, it.code, it.name_ar, it.name_en, it.name_ku, it.unit, it.category_id, it.brand_id, it.reorder_milli AS own,
                                  ${REORDER_LEVEL} AS level, COALESCE(s.qty, 0) AS qty
                           FROM items it ${REORDER_JOINS}
                           LEFT JOIN (SELECT m.item_id, SUM(m.qty_milli) AS qty FROM stock_moves m WHERE 1 = 1${where} GROUP BY m.item_id) s ON s.item_id = it.id
                           LEFT JOIN brands rb ON rb.id = it.brand_id
                           WHERE it.active = 1 AND it.track_stock = 1 AND ${REORDER_LEVEL} IS NOT NULL AND COALESCE(s.qty, 0) <= ${REORDER_LEVEL}
                           ORDER BY CASE WHEN rc.id IS NULL THEN 1 ELSE 0 END, COALESCE(rp.sort, rc.sort), COALESCE(rp.code, rc.code),
                                    CASE WHEN rc.parent_id IS NULL THEN 0 ELSE 1 END, rc.sort, rc.code, CASE WHEN rb.id IS NULL THEN 1 ELSE 0 END, rb.name, it.code`).all(...(list ?? [])) as
    { id: string; code: string; name_ar: string; name_en: string; name_ku: string; unit: UnitCode; category_id: string | null; brand_id: string | null; own: number | null; level: number; qty: number }[];
  return rows.map((r) => ({
    itemId: r.id, code: r.code, name: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, unit: r.unit, qtyMilli: Number(r.qty), reorderMilli: Number(r.level),
    levelFrom: r.own === null || r.own === undefined ? 'category' : 'item', categoryId: r.category_id ?? null, brandId: r.brand_id ?? null
  }));
}
