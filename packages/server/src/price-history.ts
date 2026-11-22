import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';

/**
 * An item's sale prices over time (2.0), per unit ('' = the item's own unit; another unit at its own price, or the
 * item's price × its factor). Written at every change made on the item's page (items.ts); the first change of a unit
 * also keeps the price it had before, as in force since ever. An item or unit with no rows has had its price since
 * before 2.0: its price now is the only one known.
 *
 * Used by the till's "price below the list needs a supervisor" rule for a sale a till kept while it was cut off
 * (pos.ts): a line at a price that was the list price at some time since the till's shift opened is the till's own
 * cached price, not a cashier's cut.
 */
export type ListPrices = Map<string, { price: number; currency: string }>;
const EVER = '0000-00-00T00:00:00.000Z';

/** The item's list prices now: its own unit under '', and each other unit. */
export function listPrices(db: Db, itemId: string): ListPrices {
  const out: ListPrices = new Map();
  const it = db.prepare('SELECT sale_price, sale_currency FROM items WHERE id = ?').get(itemId) as { sale_price: number | null; sale_currency: string } | undefined;
  if (!it || it.sale_price === null) return out;
  out.set('', { price: Number(it.sale_price), currency: it.sale_currency });
  const units = db.prepare('SELECT unit, factor_milli, sale_price FROM item_units WHERE item_id = ?').all(itemId) as { unit: string; factor_milli: number; sale_price: number | null }[];
  for (const u of units) out.set(u.unit, { price: u.sale_price !== null ? Number(u.sale_price) : Math.round((Number(it.sale_price) * Number(u.factor_milli)) / 1000), currency: it.sale_currency });
  return out;
}

/** Keeps what changed between `before` and the item's prices now. Inside the item's transaction. */
export function notePriceHistory(db: Db, itemId: string, before: ListPrices, at: Date = new Date()): void {
  const now = at.toISOString();
  const has = db.prepare('SELECT 1 FROM item_price_history WHERE item_id = ? AND unit = ? LIMIT 1');
  const add = db.prepare('INSERT INTO item_price_history (id, item_id, unit, price, currency, changed_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [unit, p] of listPrices(db, itemId)) {
    const was = before.get(unit);
    if (was && was.price === p.price && was.currency === p.currency) continue;
    if (was && !has.get(itemId, unit)) add.run(randomUUID(), itemId, unit, was.price, was.currency, EVER);
    add.run(randomUUID(), itemId, unit, p.price, p.currency, now);
  }
}

/**
 * The lowest list price of an item's unit in `currency` at any time from `from` to `to` (ISO instants): the price in
 * force at `from` and every price set after it up to `to`. Null when nothing is known of that time (no history, or
 * only prices in another currency): the price now is then the only list price.
 */
export function lowestListPrice(db: Db, itemId: string, unit: string, currency: string, from: string, to: string): number | null {
  const rows = db.prepare('SELECT price, currency, changed_at FROM item_price_history WHERE item_id = ? AND unit = ? AND changed_at <= ? ORDER BY changed_at')
    .all(itemId, unit, to) as { price: number; currency: string; changed_at: string }[];
  let atFrom: { price: number; currency: string } | null = null;
  const during: { price: number; currency: string }[] = [];
  for (const r of rows) {
    if (r.changed_at <= from) atFrom = r; else during.push(r);
  }
  // a price of nothing is an item not priced yet (a gold piece before its first board, an item made without a
  // price), never a list price to sell at: it gives no allowance
  const prices = [...(atFrom ? [atFrom] : []), ...during].filter((r) => r.currency === currency && Number(r.price) > 0).map((r) => Number(r.price));
  return prices.length ? Math.min(...prices) : null;
}

/** An item deleted: its history goes first. */
export function dropPriceHistory(db: Db, itemId: string): void {
  db.prepare('DELETE FROM item_price_history WHERE item_id = ?').run(itemId);
}
