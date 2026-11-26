import { costOut, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { invalid, notFound } from './errors.ts';
import { seesCost, type Actor } from './auth.ts';

/**
 * Recipes (2.1, with restaurants and cafés): what one of a dish takes of each ingredient. A dish is an item that keeps
 * no stock of its own (it is made when it is ordered); its ingredients are items kept in stock (rice by the kilo, oil
 * by the litre, bread by the piece), in their own unit. When a sale with the dish is posted, its ingredients come out of
 * the sale's warehouse at their average cost, and that cost is the line's cost: the profit of a plate is its price less
 * what went into it, in every report, and the books take the cost of sales off the stock, as for any item sold.
 *
 * - A kitchen keeps cooking when the count of an ingredient is behind: a sale never waits for stock. What there is
 *   comes out (never below none); a count puts the ingredient right afterwards, as for anything used up uncounted.
 * - A sale cancelled gives each ingredient back at what it took (invoice_recipe_moves). A return of a dish gives
 *   nothing back: food that went out is not stock again.
 * - An ingredient whose stock is kept by batch or expiry date is never one (the batches would no longer add up).
 */

export const RECIPE_MAX_PARTS = 40;
/** At most 1,000 of an ingredient's unit for one dish (a million thousandths). */
export const RECIPE_MAX_QTY_MILLI = 1_000_000_000;

export interface RecipePartInput { ingredientId: string; qtyMilli: number }
export interface RecipePartView {
  ingredientId: string;
  code: string;
  name: Names;
  unit: string;
  qtyMilli: number;
  /** what the company has of it, in every warehouse */
  stockMilli: number;
  /** what this much of it costs at its average cost (null: none in stock); only for who sees cost (no key otherwise) */
  cost?: number | null;
}
export interface RecipeView {
  itemId: string;
  code: string;
  name: Names;
  unit: string;
  salePrice: number;
  saleCurrency: string;
  parts: RecipePartView[];
  /** what one dish costs by its ingredients (null: an ingredient has none in stock); only for who sees cost */
  cost?: number | null;
}

const names = (r: { name_ar: string; name_en: string; name_ku: string }): Names => ({ ar: r.name_ar, en: r.name_en, ku: r.name_ku });
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/**
 * The recipes of these items, for posting a sale: only ingredients still kept in stock without batches (an ingredient
 * changed since the recipe was saved is passed over, never taken wrongly).
 */
export function recipesOf(db: Db, itemIds: readonly string[]): Map<string, RecipePartInput[]> {
  const out = new Map<string, RecipePartInput[]>();
  const ids = [...new Set(itemIds)];
  if (!ids.length) return out;
  const rows = db.prepare(`SELECT r.item_id, r.ingredient_id, r.qty_milli FROM item_recipes r JOIN items g ON g.id = r.ingredient_id
                           WHERE r.item_id IN (${marks(ids.length)}) AND g.track_stock = 1 AND g.track_batches = 0
                           ORDER BY r.item_id, r.ingredient_id`).all(...ids) as { item_id: string; ingredient_id: string; qty_milli: number }[];
  for (const r of rows) {
    const list = out.get(r.item_id) ?? [];
    list.push({ ingredientId: r.ingredient_id, qtyMilli: Number(r.qty_milli) });
    out.set(r.item_id, list);
  }
  return out;
}

/** How much of an ingredient `qtyMilli` of the dish takes (rounded to the nearest thousandth of its unit). */
export const ingredientNeed = (partMilli: number, dishMilli: number): number => Math.round((partMilli * dishMilli) / 1000);

export interface RecipeTake { itemId: string; qtyMilli: number; value: number }

/**
 * What a line of `dishMilli` of a dish takes of each ingredient, from `stock` (what the sale has left of each in its
 * warehouse, updated here): what there is, never below none, each at its average cost.
 */
export function takeIngredients(parts: readonly RecipePartInput[], dishMilli: number, stock: Map<string, { qtyMilli: number; value: number }>,
  stockOf: (itemId: string) => { qtyMilli: number; value: number }): RecipeTake[] {
  const out: RecipeTake[] = [];
  for (const p of parts) {
    const need = ingredientNeed(p.qtyMilli, dishMilli);
    if (need <= 0) continue;
    const s = stock.get(p.ingredientId) ?? stockOf(p.ingredientId);
    const take = Math.min(need, Math.max(0, s.qtyMilli));
    if (take <= 0) { stock.set(p.ingredientId, s); continue; }
    const value = costOut(s.qtyMilli, s.value, take);
    stock.set(p.ingredientId, { qtyMilli: s.qtyMilli - take, value: s.value - value });
    out.push({ itemId: p.ingredientId, qtyMilli: take, value });
  }
  return out;
}

/** What a posted sale took for its dishes (to give back when it is cancelled). */
export function recipeMovesOf(db: Db, invoiceId: string): { lineNo: number; itemId: string; qtyMilli: number; value: number }[] {
  return (db.prepare('SELECT line_no, item_id, qty_milli, value FROM invoice_recipe_moves WHERE invoice_id = ? ORDER BY line_no, item_id').all(invoiceId) as
    { line_no: number; item_id: string; qty_milli: number; value: number }[]).map((r) => ({ lineNo: Number(r.line_no), itemId: r.item_id, qtyMilli: Number(r.qty_milli), value: Number(r.value) }));
}

/** Keeps what a sale took for its dishes (in the posting's transaction). */
export function keepRecipeMoves(db: Db, invoiceId: string, takes: readonly { lineNo: number; itemId: string; qtyMilli: number; value: number }[]): void {
  if (!takes.length) return;
  // one row per line and ingredient (a line's takes are one per ingredient already)
  const add = db.prepare('INSERT INTO invoice_recipe_moves (invoice_id, line_no, item_id, qty_milli, value) VALUES (?, ?, ?, ?, ?)');
  for (const t of takes) add.run(invoiceId, t.lineNo, t.itemId, t.qtyMilli, t.value);
}

interface ItemRow { id: string; code: string; name_ar: string; name_en: string; name_ku: string; unit: string; sale_price: number; sale_currency: string; track_stock: number; track_batches: number; active: number }
const ITEM_COLS = 'id, code, name_ar, name_en, name_ku, unit, sale_price, sale_currency, track_stock, track_batches, active';

/** The company's recipes (or one dish's), with what each ingredient has in stock and, for who sees cost, what it costs. */
export function listRecipes(db: Db, actor: Actor, only?: string): RecipeView[] {
  const showCost = seesCost(actor);
  const dishes = db.prepare(`SELECT ${ITEM_COLS} FROM items WHERE id IN (SELECT DISTINCT item_id FROM item_recipes${only ? ' WHERE item_id = ?' : ''}) ORDER BY code`)
    .all(...(only ? [only] : [])) as unknown as ItemRow[];
  if (!dishes.length) return [];
  const rows = db.prepare(`SELECT r.item_id, r.qty_milli, ${ITEM_COLS.split(', ').map((c) => `g.${c}`).join(', ')}
                           FROM item_recipes r JOIN items g ON g.id = r.ingredient_id WHERE r.item_id IN (${marks(dishes.length)})
                           ORDER BY g.code`).all(...dishes.map((d) => d.id)) as unknown as (ItemRow & { item_id: string; qty_milli: number })[];
  const ingredientIds = [...new Set(rows.map((r) => r.id))];
  const stock = new Map<string, { qty: number; value: number }>();
  if (ingredientIds.length) {
    for (const s of db.prepare(`SELECT item_id, SUM(qty_milli) AS qty, SUM(value) AS value FROM stock_moves WHERE item_id IN (${marks(ingredientIds.length)}) GROUP BY item_id`)
      .all(...ingredientIds) as { item_id: string; qty: number | null; value: number | null }[]) {
      stock.set(s.item_id, { qty: Number(s.qty ?? 0), value: Number(s.value ?? 0) });
    }
  }
  return dishes.map((d) => {
    const parts = rows.filter((r) => r.item_id === d.id).map((r): RecipePartView => {
      const s = stock.get(r.id) ?? { qty: 0, value: 0 };
      const part: RecipePartView = { ingredientId: r.id, code: r.code, name: names(r), unit: r.unit, qtyMilli: Number(r.qty_milli), stockMilli: s.qty };
      if (showCost) part.cost = s.qty > 0 ? Math.round((s.value * Number(r.qty_milli)) / s.qty) : null;
      return part;
    });
    const view: RecipeView = { itemId: d.id, code: d.code, name: names(d), unit: d.unit, salePrice: Number(d.sale_price), saleCurrency: d.sale_currency, parts };
    if (showCost) view.cost = parts.every((p) => p.cost !== null) ? parts.reduce((t, p) => t + (p.cost ?? 0), 0) : null;
    return view;
  });
}

/**
 * Saves a dish's recipe (an empty list takes it away). The dish keeps no stock of its own; each ingredient is another
 * item kept in stock, without batches, once.
 */
export function saveRecipe(db: Db, itemId: string, parts: readonly RecipePartInput[], actor: Actor): RecipeView | null {
  const dish = db.prepare(`SELECT ${ITEM_COLS} FROM items WHERE id = ?`).get(itemId) as unknown as ItemRow | undefined;
  if (!dish) throw notFound('item');
  const errors: { code: string; line?: number }[] = [];
  if (parts.length && Number(dish.track_stock) === 1) errors.push({ code: 'recipe_item_keeps_stock' });
  if (parts.length > RECIPE_MAX_PARTS) errors.push({ code: 'recipe_too_long' });
  const seen = new Set<string>();
  const find = db.prepare(`SELECT ${ITEM_COLS} FROM items WHERE id = ?`);
  parts.forEach((p, i) => {
    const line = i + 1;
    if (!Number.isSafeInteger(p.qtyMilli) || p.qtyMilli <= 0 || p.qtyMilli > RECIPE_MAX_QTY_MILLI) errors.push({ code: 'line_qty_invalid', line });
    if (p.ingredientId === itemId) { errors.push({ code: 'recipe_self', line }); return; }
    if (seen.has(p.ingredientId)) { errors.push({ code: 'recipe_duplicate', line }); return; }
    seen.add(p.ingredientId);
    const g = find.get(p.ingredientId) as unknown as ItemRow | undefined;
    if (!g || Number(g.active) !== 1) errors.push({ code: 'item_invalid', line });
    else if (Number(g.track_stock) !== 1) errors.push({ code: 'recipe_ingredient_no_stock', line });
    else if (Number(g.track_batches) === 1) errors.push({ code: 'recipe_ingredient_batches', line });
  });
  if (errors.length) throw invalid(errors);
  const at = new Date().toISOString();
  transaction(db, () => {
    db.prepare('DELETE FROM item_recipes WHERE item_id = ?').run(itemId);
    const add = db.prepare('INSERT INTO item_recipes (item_id, ingredient_id, qty_milli, updated_at) VALUES (?, ?, ?, ?)');
    for (const p of parts) add.run(itemId, p.ingredientId, p.qtyMilli, at);
    audit(db, actor.name, 'recipe', 'item', itemId, { parts: parts.length });
  });
  return listRecipes(db, actor, itemId)[0] ?? null;
}
