import { z } from 'zod';
import { addDays, daysBetween, todayIso, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { invalid } from './errors.ts';
import type { ApiExtension } from './routes.ts';
import { branchOf, type BranchFilter } from './brief.ts';
import { IN_CATEGORY_SQL, parse } from './categories.ts';

/**
 * Slow sellers and dead stock (1.7, every plan): goods on the shelf that have not sold, or sell too slowly for what is
 * held, and what they tie up at average cost.
 *
 * - dead: in stock on the day and nothing sold (net of returns) in the last `days` days;
 * - slow: in stock and something sold, but at that pace what is held lasts longer than `coverDays` days.
 *
 * Only stocked items; a service or an item without stock tracking never shows. An item whose first stock came in
 * after the window began has not had the whole window to sell, so it is left out unless `includeNew` asks for it.
 * Everything is for the branch (or one of its warehouses) asked for: the stock, the sales and the last sale.
 *
 * The answer is under /api/brief, so someone who may not read the books gets it without its `value` fields
 * (cost-view.ts): what sits on the shelf and since when, not what it cost.
 */

export const SLOW_MODES = ['dead', 'slow'] as const;
export type SlowMode = (typeof SLOW_MODES)[number];

export interface SlowStockQuery {
  asOf: string;
  days: number;
  mode: SlowMode;
  /** slow only: what is held lasts longer than this many days at the window's pace */
  coverDays: number;
  warehouseId?: string | undefined;
  categoryId?: string | undefined;
  includeNew?: boolean | undefined;
}

export interface SlowStockRow {
  itemId: string; code: string; barcode: string; name: Names; unit: string;
  categoryId: string | null; categoryName: Names | null;
  qtyMilli: number; value: number;
  /** sold in the window, thousandths, net of returns */
  soldMilli: number;
  /** the last posted sale up to the day (any time before the window too), null: never sold */
  lastSale: string | null;
  /** days from the last sale (or from the first stock when never sold) to the day */
  idleDays: number;
  /** days what is held lasts at the window's pace; null when nothing sold */
  coverDays: number | null;
  firstIn: string | null;
}

export const MAX_SLOW_ROWS = 2000;

const num = (v: unknown) => Number(v ?? 0);
const marks = (list: readonly string[]) => (list.length ? list.map(() => '?').join(', ') : 'NULL');

export function slowStock(db: Db, q: SlowStockQuery, branch: BranchFilter = null): { rows: SlowStockRow[]; total: { items: number; qtyMilli: number; value: number } } {
  const since = addDays(q.asOf, -(q.days - 1));
  // the warehouses this report reads: the one asked for, else the branch's, else all
  const houses = q.warehouseId ? [q.warehouseId] : branch?.warehouses ?? null;
  const mw = houses ? ` AND m.warehouse_id IN (${marks(houses)})` : '';
  const iw = houses ? ` AND i.warehouse_id IN (${marks(houses)})` : '';
  const hp = houses ?? [];
  const cat = q.categoryId ? ` AND ${IN_CATEGORY_SQL('it.category_id')}` : '';
  const cp = q.categoryId ? [q.categoryId, q.categoryId] : [];
  const rows = db.prepare(`
    WITH stock AS (SELECT m.item_id, SUM(m.qty_milli) AS qty, SUM(m.value) AS value, MIN(CASE WHEN m.qty_milli > 0 THEN m.date END) AS first_in
                   FROM stock_moves m WHERE m.date <= ?${mw} GROUP BY m.item_id),
         sold AS (SELECT l.item_id, SUM(CASE i.kind WHEN 'sale_return' THEN -l.qty_milli ELSE l.qty_milli END) AS qty
                  FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
                  WHERE i.status = 'posted' AND i.kind IN ('sale', 'sale_return') AND i.date BETWEEN ? AND ?${iw} GROUP BY l.item_id),
         last_sale AS (SELECT l.item_id, MAX(i.date) AS d FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
                       WHERE i.status = 'posted' AND i.kind = 'sale' AND i.date <= ?${iw} GROUP BY l.item_id)
    SELECT it.id, it.code, it.barcode, it.name_ar, it.name_en, it.name_ku, it.unit, it.category_id,
           c.name_ar AS c_ar, c.name_en AS c_en, c.name_ku AS c_ku,
           s.qty, s.value, s.first_in, COALESCE(so.qty, 0) AS sold, ls.d AS last_sale
    FROM items it JOIN stock s ON s.item_id = it.id
      LEFT JOIN sold so ON so.item_id = it.id LEFT JOIN last_sale ls ON ls.item_id = it.id
      LEFT JOIN item_categories c ON c.id = it.category_id
    WHERE it.track_stock = 1 AND s.qty > 0${cat}
    ORDER BY s.value DESC, it.code`).all(q.asOf, ...hp, since, q.asOf, ...hp, q.asOf, ...hp, ...cp) as
    { id: string; code: string; barcode: string | null; name_ar: string; name_en: string; name_ku: string; unit: string; category_id: string | null;
      c_ar: string | null; c_en: string | null; c_ku: string | null; qty: number; value: number; first_in: string | null; sold: number; last_sale: string | null }[];

  const out: SlowStockRow[] = [];
  for (const r of rows) {
    const qty = num(r.qty);
    const sold = num(r.sold);
    if (!q.includeNew && r.first_in && r.first_in > since) continue;
    // the window's pace: what sold per day; what is held lasts qty / pace days
    const cover = sold > 0 ? Math.round((qty * q.days) / sold) : null;
    if (q.mode === 'dead' ? sold > 0 : cover === null || cover <= q.coverDays) continue;
    const from = r.last_sale ?? r.first_in;
    out.push({
      itemId: r.id, code: r.code, barcode: r.barcode ?? '', name: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, unit: r.unit,
      categoryId: r.category_id, categoryName: r.c_ar === null ? null : { ar: r.c_ar, en: r.c_en ?? '', ku: r.c_ku ?? '' },
      qtyMilli: qty, value: num(r.value), soldMilli: Math.max(0, sold), lastSale: r.last_sale,
      idleDays: from ? Math.max(0, daysBetween(from, q.asOf)) : 0, coverDays: cover, firstIn: r.first_in
    });
  }
  const total = out.reduce((t, r) => ({ items: t.items + 1, qtyMilli: t.qtyMilli + r.qtyMilli, value: t.value + r.value }), { items: 0, qtyMilli: 0, value: 0 });
  return { rows: out.slice(0, MAX_SLOW_ROWS), total };
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')));
const query = z.object({
  date: date.optional(),
  days: z.coerce.number().int().min(7).max(730).optional(),
  mode: z.enum(SLOW_MODES).optional(),
  coverDays: z.coerce.number().int().min(7).max(3650).optional(),
  warehouseId: z.string().min(1).max(64).optional(),
  categoryId: z.string().min(1).max(64).optional(),
  includeNew: z.enum(['true', 'false']).optional()
});

/** Reading only, like the other management reports: open to every signed-in user, cost left out by cost-view.ts. */
export const slowStockApi: ApiExtension = {
  routes(db, { actorOf }) {
    return [{
      method: 'GET', path: '/api/brief/reports/slow-stock',
      handler: async (req) => {
        const p = parse(query, req.query ?? {});
        const branch = branchOf(db, req, actorOf(req));
        if (p.warehouseId) {
          if (!db.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(p.warehouseId)) throw invalid([{ code: 'warehouse_invalid' }]);
          // someone kept to some branches reads only their warehouses
          if (branch && !branch.warehouses.includes(p.warehouseId)) throw invalid([{ code: 'warehouse_invalid' }]);
        }
        if (p.categoryId && !db.prepare('SELECT 1 FROM item_categories WHERE id = ?').get(p.categoryId)) throw invalid([{ code: 'category_invalid' }]);
        const asOf = p.date ?? todayIso();
        const q: SlowStockQuery = { asOf, days: p.days ?? 90, mode: p.mode ?? 'dead', coverDays: p.coverDays ?? 180, warehouseId: p.warehouseId, categoryId: p.categoryId, includeNew: p.includeNew === 'true' };
        return { date: asOf, days: q.days, mode: q.mode, coverDays: q.coverDays, ...slowStock(db, q, branch) };
      }
    }];
  }
};
