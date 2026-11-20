import { z } from 'zod';
import type { Names } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import type { ApiExtension } from './routes.ts';
import { parse } from './categories.ts';

/**
 * Shelf labels to reprint (1.7, every plan). When the price of an item, or of one of its units (a box, a carton),
 * changes, the label on the shelf is wrong until a new one is printed: the item (with the unit) is listed here from
 * the change until the labels are marked printed. A new item is listed too (it has no label yet).
 *
 * One row per item and unit (unit '' is the item's own unit). `old_price` is the price the label on the shelf shows:
 * the price before the first change not printed yet (null for a new item), so a price changed twice before printing
 * still shows the price that is on the shelf. A price changed back to what the shelf shows takes the row away.
 * Services and items without stock tracking have no shelf and are never listed.
 */

/** An item's prices as a shelf label shows them: its own (unit '') and each unit's (its own price, else base × factor). */
export type ShelfPrices = Map<string, { price: number; currency: string }>;

export function shelfPrices(db: Db, itemId: string): ShelfPrices {
  const out: ShelfPrices = new Map();
  const it = db.prepare('SELECT sale_price, sale_currency, unit, track_stock, active FROM items WHERE id = ?').get(itemId) as
    { sale_price: number; sale_currency: string; unit: string; track_stock: number; active: number } | undefined;
  if (!it || it.unit === 'service' || !it.track_stock || !it.active) return out;
  out.set('', { price: Number(it.sale_price), currency: it.sale_currency });
  const units = db.prepare('SELECT unit, factor_milli, sale_price FROM item_units WHERE item_id = ?').all(itemId) as { unit: string; factor_milli: number; sale_price: number | null }[];
  for (const u of units) {
    out.set(u.unit, { price: u.sale_price ?? Math.round((Number(it.sale_price) * Number(u.factor_milli)) / 1000), currency: it.sale_currency });
  }
  return out;
}

/**
 * Notes what changed between `before` (null: a new item) and the item's prices now, inside the item's transaction.
 * Without ON CONFLICT (server databases): each key is read, then written.
 */
export function notePriceChanges(db: Db, itemId: string, before: ShelfPrices | null, user: string): void {
  const after = shelfPrices(db, itemId);
  const now = new Date().toISOString();
  const read = db.prepare('SELECT old_price, currency FROM shelf_label_flags WHERE item_id = ? AND unit = ?');
  const drop = db.prepare('DELETE FROM shelf_label_flags WHERE item_id = ? AND unit = ?');
  // a unit taken away (or the item switched off, made a service): nothing of it is on a shelf to fix
  const listed = db.prepare('SELECT unit FROM shelf_label_flags WHERE item_id = ?').all(itemId) as { unit: string }[];
  for (const r of listed) if (!after.has(r.unit)) drop.run(itemId, r.unit);
  for (const [unit, now_] of after) {
    const was = before?.get(unit) ?? null;
    if (was && was.price === now_.price && was.currency === now_.currency) continue;
    const flag = read.get(itemId, unit) as { old_price: number | null; currency: string } | undefined;
    if (flag) {
      // back to what the shelf shows: nothing to reprint
      if (flag.old_price !== null && Number(flag.old_price) === now_.price && flag.currency === now_.currency) drop.run(itemId, unit);
      else db.prepare('UPDATE shelf_label_flags SET new_price = ?, currency = ?, changed_at = ?, changed_by = ? WHERE item_id = ? AND unit = ?')
        .run(now_.price, now_.currency, now, user, itemId, unit);
      continue;
    }
    // the shelf shows the old price in the old currency; a currency change shows no old price (it can't be compared)
    const oldPrice = was && was.currency === now_.currency ? was.price : null;
    db.prepare('INSERT INTO shelf_label_flags (item_id, unit, old_price, new_price, currency, changed_at, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(itemId, unit, oldPrice, now_.price, now_.currency, now, user);
  }
}

/** An item deleted: its rows go first (the item may be deleted only while nothing has moved). */
export function dropShelfFlags(db: Db, itemId: string): void {
  db.prepare('DELETE FROM shelf_label_flags WHERE item_id = ?').run(itemId);
}

export interface ShelfFlagView {
  itemId: string; unit: string | null; code: string; barcode: string; name: Names;
  categoryId: string | null;
  oldPrice: number | null; newPrice: number; currency: string; changedAt: string; changedBy: string;
}

export function listShelfFlags(db: Db, categoryId?: string): ShelfFlagView[] {
  const rows = db.prepare(`SELECT f.item_id, f.unit, f.old_price, f.new_price, f.currency, f.changed_at, f.changed_by,
                                  it.code, it.barcode, it.name_ar, it.name_en, it.name_ku, it.category_id, u.barcode AS unit_barcode
                           FROM shelf_label_flags f JOIN items it ON it.id = f.item_id
                             LEFT JOIN item_units u ON u.item_id = f.item_id AND u.unit = f.unit
                           ${categoryId ? 'WHERE (it.category_id = ? OR it.category_id IN (SELECT id FROM item_categories WHERE parent_id = ?))' : ''}
                           ORDER BY f.changed_at DESC, it.code, f.unit`).all(...(categoryId ? [categoryId, categoryId] : [])) as
    { item_id: string; unit: string; old_price: number | null; new_price: number; currency: string; changed_at: string; changed_by: string;
      code: string; barcode: string | null; name_ar: string; name_en: string; name_ku: string; category_id: string | null; unit_barcode: string | null }[];
  return rows.map((r) => ({
    itemId: r.item_id, unit: r.unit || null, code: r.code, barcode: (r.unit ? r.unit_barcode : r.barcode) ?? '',
    name: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, categoryId: r.category_id,
    oldPrice: r.old_price === null ? null : Number(r.old_price), newPrice: Number(r.new_price), currency: r.currency,
    changedAt: r.changed_at, changedBy: r.changed_by
  }));
}

/**
 * Labels printed: each row named goes, unless its price changed again after the list was read (`changedAt` is the
 * time the list showed), so a change made while printing still waits for its label.
 */
export function markShelfLabelsPrinted(db: Db, rows: readonly { itemId: string; unit: string | null; changedAt: string }[], user: string): { cleared: number } {
  let cleared = 0;
  transaction(db, () => {
    const del = db.prepare('DELETE FROM shelf_label_flags WHERE item_id = ? AND unit = ? AND changed_at = ?');
    for (const r of rows) cleared += Number(del.run(r.itemId, r.unit ?? '', r.changedAt).changes);
    if (cleared) audit(db, user, 'update', 'shelf_labels', 'printed', { cleared });
  });
  return { cleared };
}

const printed = z.object({
  rows: z.array(z.object({ itemId: z.string().min(1).max(64), unit: z.string().max(24).nullable(), changedAt: z.string().min(1).max(40) })).min(1).max(5000)
});

/** Reading is open to every signed-in user; marking labels printed needs the stock permission, like editing items. */
export const shelfLabelsApi: ApiExtension = {
  rules: { 'POST /api/shelf-labels/printed': 'stock' },
  routes(db, { actorOf }) {
    return [
      {
        method: 'GET', path: '/api/shelf-labels',
        handler: async (req) => {
          const q = parse(z.object({ categoryId: z.string().min(1).max(64).optional() }), req.query ?? {});
          const rows = listShelfFlags(db, q.categoryId);
          return { rows, count: rows.length };
        }
      },
      {
        method: 'POST', path: '/api/shelf-labels/printed',
        handler: async (req) => markShelfLabelsPrinted(db, parse(printed, req.body ?? {}).rows, actorOf(req).name)
      }
    ];
  }
};
