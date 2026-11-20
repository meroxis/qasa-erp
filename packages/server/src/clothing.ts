import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  cleanSize, cleanSizes, COLOR_CODE, gridOrder, internalBarcode, isIsoDate, isUnit, MAX_MODEL_COLORS, MAX_MODEL_SIZES, MAX_MODEL_VARIANTS, sellThroughBp,
  todayIso, variantCode, variantNames, type CurrencyCode, type Names, type UnitCode
} from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { planStatus } from './license.ts';
import { createItem, deleteItem, getItem, updateItem, type ItemView } from './items.ts';
import { userBranchLists } from './branches.ts';
import { createReturn } from './returns.ts';
import { getShift, requireRunnable, sell, type SaleInput } from './pos.ts';
import { assertRefundApproved } from './till-settings.ts';
import { getInvoice } from './invoices.ts';
import type { Actor } from './auth.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Clothing and shoes (2.0, plan feature clothingShop). A model is one design — a shirt, a pair of shoes — that comes in
 * sizes and colours. Every size and colour of it is a real item (a variant): its own code, barcode, stock, price and
 * lines, sold, bought, counted, labelled and returned as any item is, so the till, invoices, purchase orders, stock
 * counts and labels need nothing of their own. What this file adds is the model around them:
 *
 * - the shop's colours (names in the three languages, a short code that goes into a variant's code);
 * - models: their sizes (in the shop's order), season or collection, category, brand, and the price new variants start
 *   with; making a model makes its grid of variants at once, each with a barcode of the shop's own when it has none
 *   (EAN-13 in the 04 range GS1 keeps for numbers used inside one company: never 2…, which shop scales print);
 * - the stock of a model as a size × colour grid, per warehouse, within the user's branches;
 * - a grid of quantities turned into document lines (a purchase, a purchase order, a sale), the price of each variant
 *   with it; lines for sizes or colours the model does not have yet are refused, not made on the way;
 * - an exchange at the till: what comes back from a till sale returned to the drawer and the new goods sold, in one
 *   go (the books are a sales return paid from the shift's safe and a till sale, so the drawer expects only the
 *   difference); a card or wallet sale is paid back as it was paid, so its exchange is refused for the cash part;
 * - reports: sales and stock by model, by size and by colour, and the sell-through of each model (of what it had to
 *   sell, sold and on hand, how much sold).
 *
 * Reading needs no plan (a company whose licence ended still sees its models); every change needs the plan.
 */

export const clothingAvailable = (db: Db): boolean => planStatus(db).features.includes('clothingShop');
function requirePlan(db: Db): void {
  if (!clothingAvailable(db)) throw conflict('plan_limit', { limit: 'clothingShop' });
}

export interface ColorView { id: string; code: string; name: Names; hex: string | null; sort: number; active: boolean }
export interface VariantView {
  itemId: string; code: string; barcode: string | null; size: string; colorId: string | null;
  salePrice: number; saleCurrency: CurrencyCode; active: boolean; onHandMilli: number
}
export interface ModelSummary {
  id: string; code: string; name: Names; season: string | null; categoryId: string | null; brandId: string | null;
  sizes: string[]; colorIds: string[]; variantCount: number; onHandMilli: number; salePrice: number; saleCurrency: CurrencyCode; active: boolean
}
export interface ModelView extends ModelSummary {
  unit: UnitCode; purchasePrice: number | null; purchaseCurrency: CurrencyCode | null;
  variants: VariantView[];
  /** on hand by warehouse (only the user's branches'): warehouse → item → thousandths */
  stock: { warehouseId: string; byItem: Record<string, number> }[];
}

const names = (r: { name_ar: string; name_en: string; name_ku: string }): Names => ({ ar: r.name_ar, en: r.name_en, ku: r.name_ku });
const marks = (list: readonly unknown[]) => (list.length ? list.map(() => '?').join(', ') : 'NULL');

/* ---------------- colours ---------------- */

interface ColorRow { id: string; code: string; name_ar: string; name_en: string; name_ku: string; hex: string | null; sort: number; active: number }
const toColor = (r: ColorRow): ColorView => ({ id: r.id, code: r.code, name: names(r), hex: r.hex, sort: Number(r.sort), active: Number(r.active) === 1 });

export function listColors(db: Db): ColorView[] {
  return (db.prepare('SELECT * FROM cl_colors ORDER BY sort, code').all() as unknown as ColorRow[]).map(toColor);
}

export interface ColorInput { code: string; name: Names; hex?: string | null | undefined; sort?: number | undefined; active?: boolean | undefined }

function checkColor(db: Db, input: ColorInput, id: string | null): string {
  const code = input.code.trim().toUpperCase();
  const errors: { code: string }[] = [];
  if (!COLOR_CODE.test(code)) errors.push({ code: 'cl_color_code_invalid' });
  if (!input.name.ar.trim() || !input.name.en.trim() || !input.name.ku.trim()) errors.push({ code: 'name_required' });
  if (input.hex && !/^#[0-9a-fA-F]{6}$/.test(input.hex)) errors.push({ code: 'cl_color_hex_invalid' });
  if (errors.length) throw invalid(errors);
  const same = db.prepare('SELECT id FROM cl_colors WHERE code = ?').get(code) as { id: string } | undefined;
  if (same && same.id !== id) throw conflict('cl_color_code_taken', { code });
  return code;
}

export function saveColor(db: Db, id: string | null, input: ColorInput, user: string): ColorView {
  requirePlan(db);
  const code = checkColor(db, input, id);
  const now = new Date().toISOString();
  const n = { ar: input.name.ar.trim(), en: input.name.en.trim(), ku: input.name.ku.trim() };
  if (id) {
    const row = db.prepare('SELECT * FROM cl_colors WHERE id = ?').get(id) as ColorRow | undefined;
    if (!row) throw notFound('color');
    // a colour's code is in its variants' codes: it changes only while no variant has it
    if (code !== row.code && db.prepare('SELECT 1 FROM cl_variants WHERE color_id = ? LIMIT 1').get(id)) throw conflict('cl_color_in_use');
    db.prepare('UPDATE cl_colors SET code = ?, name_ar = ?, name_en = ?, name_ku = ?, hex = ?, sort = ?, active = ?, updated_at = ? WHERE id = ?')
      .run(code, n.ar, n.en, n.ku, input.hex ?? null, input.sort ?? row.sort, input.active === false ? 0 : 1, now, id);
    audit(db, user, 'update', 'cl_color', id, { code });
  } else {
    id = randomUUID();
    db.prepare('INSERT INTO cl_colors (id, code, name_ar, name_en, name_ku, hex, sort, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, code, n.ar, n.en, n.ku, input.hex ?? null, input.sort ?? 0, input.active === false ? 0 : 1, now, now);
    audit(db, user, 'create', 'cl_color', id, { code });
  }
  return toColor(db.prepare('SELECT * FROM cl_colors WHERE id = ?').get(id) as unknown as ColorRow);
}

/* ---------------- models ---------------- */

interface ModelRow {
  id: string; code: string; name_ar: string; name_en: string; name_ku: string; sizes: string; season: string | null; category_id: string | null; brand_id: string | null;
  unit: string; sale_price: number; sale_currency: CurrencyCode; purchase_price: number | null; purchase_currency: CurrencyCode | null; active: number
}

function parseSizes(text: string): string[] {
  try {
    const list = JSON.parse(text) as unknown;
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function modelRow(db: Db, id: string): ModelRow {
  const row = db.prepare('SELECT * FROM cl_models WHERE id = ?').get(id) as ModelRow | undefined;
  if (!row) throw notFound('model');
  return row;
}

interface VariantRow { item_id: string; size: string; color_id: string; code: string; barcode: string | null; sale_price: number; sale_currency: CurrencyCode; active: number }
function variantRows(db: Db, modelId: string): VariantRow[] {
  return db.prepare(`SELECT v.item_id, v.size, v.color_id, it.code, it.barcode, it.sale_price, it.sale_currency, it.active
                     FROM cl_variants v JOIN items it ON it.id = v.item_id WHERE v.model_id = ?`).all(modelId) as unknown as VariantRow[];
}

/** The warehouses an actor sees (null: every one). */
function warehousesOf(db: Db, actor: Actor | null): string[] | null {
  return userBranchLists(db, actor)?.warehouses ?? null;
}

function onHand(db: Db, itemIds: readonly string[], warehouses: string[] | null): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  if (!itemIds.length) return out;
  const w = warehouses ? ` AND warehouse_id IN (${marks(warehouses)})` : '';
  const rows = db.prepare(`SELECT item_id, warehouse_id, SUM(qty_milli) AS qty FROM stock_moves WHERE item_id IN (${marks(itemIds)})${w}
                           GROUP BY item_id, warehouse_id`).all(...itemIds, ...(warehouses ?? [])) as { item_id: string; warehouse_id: string; qty: number }[];
  for (const r of rows) {
    const byItem = out.get(r.warehouse_id) ?? new Map<string, number>();
    byItem.set(r.item_id, Number(r.qty ?? 0));
    out.set(r.warehouse_id, byItem);
  }
  return out;
}

function colorOrder(db: Db, ids: readonly string[]): string[] {
  const real = ids.filter((c) => c !== '');
  const order = real.length
    ? (db.prepare(`SELECT id FROM cl_colors WHERE id IN (${marks(real)}) ORDER BY sort, code`).all(...real) as { id: string }[]).map((r) => r.id)
    : [];
  return ids.includes('') ? ['', ...order] : order;
}

function summary(db: Db, row: ModelRow, variants: VariantRow[], stock: Map<string, Map<string, number>>): ModelSummary {
  const total = [...stock.values()].reduce((s, m) => s + [...m.values()].reduce((a, b) => a + b, 0), 0);
  return {
    id: row.id, code: row.code, name: names(row), season: row.season, categoryId: row.category_id, brandId: row.brand_id, sizes: parseSizes(row.sizes),
    colorIds: colorOrder(db, [...new Set(variants.map((v) => v.color_id))]).map((c) => c || null).filter((c): c is string => c !== null),
    variantCount: variants.length, onHandMilli: total, salePrice: Number(row.sale_price), saleCurrency: row.sale_currency, active: Number(row.active) === 1
  };
}

export function getModel(db: Db, id: string, actor: Actor | null = null): ModelView {
  const row = modelRow(db, id);
  const rows = variantRows(db, id);
  const warehouses = warehousesOf(db, actor);
  const stock = onHand(db, rows.map((r) => r.item_id), warehouses);
  const sizes = parseSizes(row.sizes);
  const colors = colorOrder(db, [...new Set(rows.map((r) => r.color_id))]);
  const total = (itemId: string) => [...stock.values()].reduce((s, m) => s + (m.get(itemId) ?? 0), 0);
  const variants = gridOrder(rows.map((r): VariantView => ({
    itemId: r.item_id, code: r.code, barcode: r.barcode, size: r.size, colorId: r.color_id || null, salePrice: Number(r.sale_price), saleCurrency: r.sale_currency,
    active: Number(r.active) === 1, onHandMilli: total(r.item_id)
  })), sizes, colors.map((c) => c || null));
  return {
    ...summary(db, row, rows, stock),
    unit: row.unit as UnitCode, purchasePrice: row.purchase_price === null ? null : Number(row.purchase_price), purchaseCurrency: row.purchase_currency,
    variants,
    stock: [...stock].map(([warehouseId, m]) => ({ warehouseId, byItem: Object.fromEntries(m) }))
  };
}

export interface ModelFilter { q?: string | undefined; season?: string | undefined; categoryId?: string | undefined; active?: boolean | undefined }

export function listModels(db: Db, f: ModelFilter = {}, actor: Actor | null = null): ModelSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (f.q?.trim()) {
    const like = `%${f.q.trim().toLowerCase()}%`;
    where.push(`(LOWER(m.code) LIKE ? OR LOWER(m.name_ar) LIKE ? OR LOWER(m.name_en) LIKE ? OR LOWER(m.name_ku) LIKE ?
                 OR EXISTS (SELECT 1 FROM cl_variants v JOIN items it ON it.id = v.item_id WHERE v.model_id = m.id AND (it.barcode = ? OR LOWER(it.code) = ?)))`);
    params.push(like, like, like, like, f.q.trim(), f.q.trim().toLowerCase());
  }
  if (f.season?.trim()) { where.push('m.season = ?'); params.push(f.season.trim()); }
  if (f.categoryId) { where.push('m.category_id = ?'); params.push(f.categoryId); }
  if (f.active !== undefined) { where.push('m.active = ?'); params.push(f.active ? '1' : '0'); }
  const rows = db.prepare(`SELECT m.* FROM cl_models m${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY m.created_at DESC LIMIT 500`).all(...params) as unknown as ModelRow[];
  const warehouses = warehousesOf(db, actor);
  return rows.map((r) => {
    const variants = variantRows(db, r.id);
    return summary(db, r, variants, onHand(db, variants.map((v) => v.item_id), warehouses));
  });
}

/** The seasons and collections the shop has used, newest first. */
export function listSeasons(db: Db): string[] {
  return (db.prepare("SELECT season, MAX(created_at) AS at FROM cl_models WHERE season IS NOT NULL AND season <> '' GROUP BY season ORDER BY at DESC").all() as { season: string }[])
    .map((r) => r.season);
}

export interface ModelInput {
  code?: string | undefined;
  name: Names;
  sizes: string[];
  colorIds: string[];
  season?: string | null | undefined;
  categoryId?: string | null | undefined;
  brandId?: string | null | undefined;
  unit?: UnitCode | undefined;
  salePrice: number;
  saleCurrency: CurrencyCode;
  purchasePrice?: number | null | undefined;
  purchaseCurrency?: CurrencyCode | null | undefined;
  /** give variants that have none a barcode of the shop's own (default on) */
  barcodes?: boolean | undefined;
  /** a size's own price, where it differs from the model's (bigger sizes often cost more) */
  sizePrices?: Record<string, number> | undefined;
}

function checkModel(db: Db, input: ModelInput): { sizes: string[]; colors: ColorRow[] } {
  const errors: { code: string; size?: string }[] = [];
  const sizes = cleanSizes(input.sizes);
  if (!sizes) errors.push({ code: 'cl_size_invalid' });
  else if (!sizes.length) errors.push({ code: 'cl_sizes_required' });
  else if (sizes.length > MAX_MODEL_SIZES) errors.push({ code: 'cl_too_many_sizes' });
  const colorIds = [...new Set(input.colorIds)];
  if (colorIds.length > MAX_MODEL_COLORS) errors.push({ code: 'cl_too_many_colors' });
  const colors = colorIds.length ? db.prepare(`SELECT * FROM cl_colors WHERE id IN (${marks(colorIds)})`).all(...colorIds) as unknown as ColorRow[] : [];
  if (colors.length !== colorIds.length) errors.push({ code: 'cl_color_unknown' });
  if (sizes && sizes.length * Math.max(1, colorIds.length) > MAX_MODEL_VARIANTS) errors.push({ code: 'cl_too_many_variants' });
  if (!input.name.ar.trim() || !input.name.en.trim() || !input.name.ku.trim()) errors.push({ code: 'name_required' });
  if (input.unit !== undefined && (!isUnit(input.unit) || input.unit === 'service')) errors.push({ code: 'unit_invalid' });
  for (const [size, price] of Object.entries(input.sizePrices ?? {})) {
    if (!sizes?.includes(cleanSize(size) ?? '') || !Number.isSafeInteger(price) || price < 0) errors.push({ code: 'cl_size_price_invalid', size });
  }
  if (input.categoryId && !db.prepare('SELECT 1 FROM item_categories WHERE id = ?').get(input.categoryId)) errors.push({ code: 'category_unknown' });
  if (input.brandId && !db.prepare('SELECT 1 FROM brands WHERE id = ?').get(input.brandId)) errors.push({ code: 'brand_unknown' });
  if (errors.length) throw invalid(errors);
  return { sizes: sizes!, colors };
}

function sizePrice(input: Pick<ModelInput, 'sizePrices' | 'salePrice'>, size: string): number {
  for (const [s, p] of Object.entries(input.sizePrices ?? {})) if (cleanSize(s) === size) return p;
  return input.salePrice;
}

/** A barcode of the shop's own no item (and no item's other unit) has. */
function freshBarcode(db: Db): string {
  for (;;) {
    const code = internalBarcode(nextSequence(db, 'cl_barcode'));
    const used = db.prepare('SELECT 1 FROM items WHERE barcode = ? UNION SELECT 1 FROM item_units WHERE barcode = ? LIMIT 1').get(code, code);
    if (!used) return code;
  }
}

interface ModelBase { id: string; code: string; name: Names; unit: UnitCode; categoryId: string | null; brandId: string | null; purchasePrice: number | null; purchaseCurrency: CurrencyCode | null; saleCurrency: CurrencyCode }

function addVariant(db: Db, m: ModelBase, size: string, color: ColorRow | null, price: number, barcode: boolean, user: string): ItemView {
  const colorNames = color ? names(color) : null;
  const item = createItem(db, {
    code: variantCode(m.code, size, color?.code ?? null),
    ...(barcode ? { barcode: freshBarcode(db) } : {}),
    name: variantNames(m.name, size, colorNames),
    unit: m.unit, salePrice: price, saleCurrency: m.saleCurrency,
    categoryId: m.categoryId, brandId: m.brandId,
    ...(m.purchasePrice !== null ? { purchasePrice: m.purchasePrice, purchaseCurrency: m.purchaseCurrency ?? m.saleCurrency } : {})
  }, user);
  db.prepare('INSERT INTO cl_variants (item_id, model_id, size, color_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(item.id, m.id, size, color?.id ?? '', new Date().toISOString());
  return item;
}

export function createModel(db: Db, input: ModelInput, actor: Actor): ModelView {
  requirePlan(db);
  const { sizes, colors } = checkModel(db, input);
  const ordered = [...colors].sort((a, b) => Number(a.sort) - Number(b.sort) || a.code.localeCompare(b.code));
  const id = randomUUID();
  transaction(db, () => {
    let code = input.code?.trim();
    if (code && db.prepare('SELECT 1 FROM cl_models WHERE code = ?').get(code)) throw conflict('cl_model_code_taken', { code });
    while (!code || db.prepare('SELECT 1 FROM cl_models WHERE code = ?').get(code)) code = `M-${String(nextSequence(db, 'cl_model')).padStart(4, '0')}`;
    const now = new Date().toISOString();
    const n = { ar: input.name.ar.trim(), en: input.name.en.trim(), ku: input.name.ku.trim() };
    const unit = input.unit ?? 'piece';
    const purchaseCurrency = input.purchasePrice === undefined || input.purchasePrice === null ? null : input.purchaseCurrency ?? input.saleCurrency;
    db.prepare(`INSERT INTO cl_models (id, code, name_ar, name_en, name_ku, sizes, season, category_id, brand_id, unit, sale_price, sale_currency,
                                       purchase_price, purchase_currency, active, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .run(id, code, n.ar, n.en, n.ku, JSON.stringify(sizes), input.season?.trim() || null, input.categoryId ?? null, input.brandId ?? null, unit,
        input.salePrice, input.saleCurrency, input.purchasePrice ?? null, purchaseCurrency, actor.name, now, now);
    const base: ModelBase = { id, code, name: n, unit, categoryId: input.categoryId ?? null, brandId: input.brandId ?? null, purchasePrice: input.purchasePrice ?? null, purchaseCurrency, saleCurrency: input.saleCurrency };
    for (const size of sizes) {
      for (const color of ordered.length ? ordered : [null]) addVariant(db, base, size, color, sizePrice(input, size), input.barcodes !== false, actor.name);
    }
    audit(db, actor.name, 'create', 'cl_model', id, { code, sizes, colors: ordered.map((c) => c.code) });
  });
  return getModel(db, id, actor);
}

export interface ModelUpdate {
  name?: Names | undefined;
  season?: string | null | undefined;
  categoryId?: string | null | undefined;
  brandId?: string | null | undefined;
  active?: boolean | undefined;
  /** a new price for every variant (sizePrices still win for their sizes) */
  salePrice?: number | undefined;
  sizePrices?: Record<string, number> | undefined;
  /** sizes and colours to add to the grid (the grid only grows: a variant that sold stays) */
  addSizes?: string[] | undefined;
  addColorIds?: string[] | undefined;
  barcodes?: boolean | undefined;
}

export function updateModel(db: Db, id: string, input: ModelUpdate, actor: Actor): ModelView {
  requirePlan(db);
  const row = modelRow(db, id);
  const current = parseSizes(row.sizes);
  const addSizes = input.addSizes ? cleanSizes(input.addSizes) : [];
  if (!addSizes) throw invalid([{ code: 'cl_size_invalid' }]);
  const sizes = [...current, ...addSizes.filter((s) => !current.includes(s))];
  const rows = variantRows(db, id);
  const haveColors = [...new Set(rows.map((r) => r.color_id))];
  const newColorIds = [...new Set(input.addColorIds ?? [])].filter((c) => !haveColors.includes(c));
  const allColorIds = [...haveColors.filter((c) => c !== ''), ...newColorIds];
  const n = input.name ?? names(row);
  // the same checks as a new model, on what the model will be
  const { colors } = checkModel(db, {
    name: n, sizes, colorIds: allColorIds, salePrice: input.salePrice ?? Number(row.sale_price), saleCurrency: row.sale_currency,
    ...(input.sizePrices ? { sizePrices: input.sizePrices } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}), ...(input.brandId !== undefined ? { brandId: input.brandId } : {})
  });
  // a model without colours gets none later (its variants would stand beside coloured ones with no colour); nor the reverse
  if (newColorIds.length && haveColors.includes('')) throw conflict('cl_model_has_no_colors');
  const now = new Date().toISOString();
  transaction(db, () => {
    const categoryId = input.categoryId === undefined ? row.category_id : input.categoryId;
    const brandId = input.brandId === undefined ? row.brand_id : input.brandId;
    const salePrice = input.salePrice ?? Number(row.sale_price);
    db.prepare(`UPDATE cl_models SET name_ar = ?, name_en = ?, name_ku = ?, sizes = ?, season = ?, category_id = ?, brand_id = ?, sale_price = ?, active = ?, updated_at = ? WHERE id = ?`)
      .run(n.ar.trim(), n.en.trim(), n.ku.trim(), JSON.stringify(sizes), input.season === undefined ? row.season : input.season?.trim() || null, categoryId, brandId, salePrice,
        input.active === undefined ? row.active : input.active ? 1 : 0, now, id);
    const base: ModelBase = {
      id, code: row.code, name: n, unit: row.unit as UnitCode, categoryId, brandId, purchasePrice: row.purchase_price === null ? null : Number(row.purchase_price),
      purchaseCurrency: row.purchase_currency, saleCurrency: row.sale_currency
    };
    const colorById = new Map(colors.map((c) => [c.id, c]));
    // the names, prices, category and brand follow to the variants that are there (each keeps its code and barcode)
    const priceChange = input.salePrice !== undefined || input.sizePrices !== undefined;
    for (const v of rows) {
      const item = getItem(db, v.item_id);
      const color = v.color_id ? colorById.get(v.color_id) ?? null : null;
      const price = priceChange ? sizePrice({ salePrice, ...(input.sizePrices ? { sizePrices: input.sizePrices } : {}) }, v.size) : item.salePrice;
      updateItem(db, v.item_id, {
        code: item.code, ...(item.barcode ? { barcode: item.barcode } : {}), name: variantNames(n, v.size, color ? names(color) : null), unit: item.unit,
        salePrice: price, saleCurrency: item.saleCurrency, trackStock: item.trackStock, active: input.active === false ? false : item.active,
        categoryId, brandId
      }, actor.name);
    }
    // the new cells of the grid
    const have = new Set(rows.map((r) => `${r.size}\u0000${r.color_id}`));
    const colorList = haveColors.includes('') ? [null] : allColorIds.map((c) => colorById.get(c) ?? null);
    for (const size of sizes) {
      for (const color of colorList) {
        if (have.has(`${size}\u0000${color?.id ?? ''}`)) continue;
        addVariant(db, base, size, color, sizePrice({ salePrice, ...(input.sizePrices ? { sizePrices: input.sizePrices } : {}) }, size), input.barcodes !== false, actor.name);
      }
    }
    audit(db, actor.name, 'update', 'cl_model', id, { addSizes, addColors: newColorIds.length, price: input.salePrice, active: input.active });
  });
  return getModel(db, id, actor);
}

/** A model with nothing done yet goes, with its variants; one whose goods were bought or sold can't (it is switched off instead). */
export function deleteModel(db: Db, id: string, actor: Actor): void {
  requirePlan(db);
  const row = modelRow(db, id);
  const rows = variantRows(db, id);
  transaction(db, () => {
    for (const v of rows) {
      db.prepare('DELETE FROM cl_variants WHERE item_id = ?').run(v.item_id);
      deleteItem(db, v.item_id, actor.name);
    }
    db.prepare('DELETE FROM cl_models WHERE id = ?').run(id);
    audit(db, actor.name, 'delete', 'cl_model', id, { code: row.code });
  });
}

/** The model and size/colour of items (for the till and the invoice screen: "which model is this barcode"). */
export function variantsOf(db: Db, itemIds: readonly string[]): { itemId: string; modelId: string; size: string; colorId: string | null }[] {
  if (!itemIds.length) return [];
  return (db.prepare(`SELECT item_id, model_id, size, color_id FROM cl_variants WHERE item_id IN (${marks(itemIds)})`).all(...itemIds) as
    { item_id: string; model_id: string; size: string; color_id: string }[]).map((r) => ({ itemId: r.item_id, modelId: r.model_id, size: r.size, colorId: r.color_id || null }));
}

/* ---------------- a grid of quantities as document lines ---------------- */

export interface GridCell { size: string; colorId?: string | null | undefined; qtyMilli: number }
export interface GridLine { itemId: string; code: string; name: Names; size: string; colorId: string | null; qtyMilli: number; unitPrice: number; currency: CurrencyCode }

/**
 * A grid of quantities (a purchase, a purchase order, a sale) as document lines: the variant of each cell, its
 * quantity and price — the sale price for a sale, the model's purchase price (or the item's own) for a purchase.
 * A cell the model has no variant for is refused (sizes and colours are added on the model first).
 */
export function gridLines(db: Db, modelId: string, cells: readonly GridCell[], kind: 'sale' | 'purchase'): GridLine[] {
  const row = modelRow(db, modelId);
  const rows = variantRows(db, modelId);
  const errors: { code: string; size?: string }[] = [];
  const out: GridLine[] = [];
  for (const cell of cells) {
    if (!Number.isSafeInteger(cell.qtyMilli) || cell.qtyMilli < 0) { errors.push({ code: 'qty_invalid', size: cell.size }); continue; }
    if (cell.qtyMilli === 0) continue;
    const size = cleanSize(cell.size);
    const v = rows.find((r) => r.size === size && r.color_id === (cell.colorId ?? ''));
    if (!v) { errors.push({ code: 'cl_variant_missing', size: cell.size }); continue; }
    const item = getItem(db, v.item_id);
    const price = kind === 'sale' ? item.salePrice : item.purchasePrice ?? (row.purchase_price === null ? 0 : Number(row.purchase_price));
    const currency = kind === 'sale' ? item.saleCurrency : item.purchaseCurrency ?? row.purchase_currency ?? item.saleCurrency;
    out.push({ itemId: v.item_id, code: item.code, name: item.name, size: v.size, colorId: v.color_id || null, qtyMilli: cell.qtyMilli, unitPrice: price, currency });
  }
  if (errors.length) throw invalid(errors);
  return gridOrder(out, parseSizes(row.sizes), colorOrder(db, [...new Set(rows.map((r) => r.color_id))]).map((c) => c || null));
}

/** The variants of the lines of a document (a purchase, mostly), with their quantities: for labels in one go. */
export function invoiceVariants(db: Db, invoiceId: string): { itemId: string; qtyMilli: number }[] {
  getInvoice(db, invoiceId);
  return (db.prepare(`SELECT l.item_id, SUM(l.qty_milli) AS qty FROM invoice_lines l JOIN cl_variants v ON v.item_id = l.item_id
                      WHERE l.invoice_id = ? GROUP BY l.item_id ORDER BY MIN(l.line_no)`).all(invoiceId) as { item_id: string; qty: number }[])
    .map((r) => ({ itemId: r.item_id, qtyMilli: Number(r.qty) }));
}

/* ---------------- exchanges at the till ---------------- */

export interface ExchangeInput {
  /** the till sale the goods came from */
  invoiceId: string;
  /** its lines and how much of each comes back */
  back: { lineNo: number; qtyMilli: number }[];
  /** a till supervisor's approvals, when the till's rules ask one for refunds */
  approvals?: string[] | undefined;
  /** the new goods, sold as at the till (payments, the customer, the cash handed over …); none: a plain return */
  sale?: Omit<SaleInput, 'currency'> | undefined;
}

/**
 * An exchange at the till: the goods brought back are returned to the drawer (a sales return paid in cash from the
 * shift's safe, under the rules of returns: as paid, by an approver when duties are separate) and the new goods sold on
 * the same shift, in one go. The drawer gives back the difference, or takes it: its expected cash is the sale's cash
 * less the refund. Both are documents of their own (a return and a sale), each in the shift's report.
 */
export function exchange(db: Db, shiftId: string, input: ExchangeInput, actor: Actor): { returnId: string; saleId: string | null; difference: number } {
  requirePlan(db);
  // the cashier's own open shift (or one an admin runs), as for a sale: a refund out of another cashier's drawer is refused
  requireRunnable(db, shiftId, actor);
  const shift = getShift(db, shiftId, actor);
  const original = getInvoice(db, input.invoiceId);
  if (original.kind !== 'sale' || original.status !== 'posted') throw conflict('action_not_allowed', { status: original.status, action: 'exchange' });
  // a till sale of this company's till only: the drawer pays back what came into a drawer
  if (!db.prepare('SELECT 1 FROM pos_sales WHERE invoice_id = ?').get(input.invoiceId)) throw conflict('cl_exchange_not_till_sale');
  if (!input.back.length) throw invalid([{ code: 'cl_exchange_nothing_back' }]);
  return transaction(db, () => {
    assertRefundApproved(db, input.invoiceId, actor, input.approvals);
    const back = createReturn(db, input.invoiceId, {
      date: todayIso(), payment: 'cash', cashAccountCode: shift.cashAccountCode, notes: 'exchange', lines: input.back
    }, actor.name, actor);
    let saleId: string | null = null;
    let saleTotal = 0;
    if (input.sale?.lines.length) {
      const sold = sell(db, shiftId, { ...input.sale, currency: original.currency, ...(original.currency === 'USD' ? { rateX100: input.sale.rateX100 ?? original.rateX100 } : {}) }, actor);
      saleId = sold.invoice.id;
      saleTotal = sold.invoice.total;
    }
    audit(db, actor.name, 'exchange', 'invoice', input.invoiceId, { returnId: back.id, saleId, shiftId });
    return { returnId: back.id, saleId, difference: saleTotal - back.total };
  });
}

/* ---------------- reports ---------------- */

const BASE = (amount: string) => `(CASE WHEN i.currency = 'IQD' THEN ${amount} ELSE ROUND(${amount} * i.rate_x100 / 10000.0) END)`;
const LINE_NET = `(l.amount - COALESCE(l.discount_share, CASE WHEN i.subtotal > 0 THEN i.discount * l.amount * 1.0 / i.subtotal ELSE 0 END))`;
const SIGN = `(CASE i.kind WHEN 'sale_return' THEN -1 ELSE 1 END)`;

export interface ClothingFigures { soldMilli: number; sales: number; onHandMilli: number; sellThroughBp: number | null }
export interface ClothingReport {
  from: string; to: string;
  models: (ClothingFigures & { modelId: string; code: string; name: Names; season: string | null })[];
  sizes: (ClothingFigures & { size: string })[];
  colors: (ClothingFigures & { colorId: string | null; name: Names | null })[];
}

/**
 * Sales (IQD, returns taken off, as the other sales reports) and stock now, by model, by size and by colour, within the
 * user's branches; the sell-through of each (of what was sold and is on hand, how much was sold). Best sellers first;
 * the sizes in the order a shop knows them by (their first use), the worst at the end of their own list.
 */
export function clothingReport(db: Db, from: string, to: string, f: { season?: string | undefined } = {}, actor: Actor | null = null): ClothingReport {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw invalid([{ code: 'date_invalid' }]);
  const warehouses = warehousesOf(db, actor);
  const w = warehouses ? ` AND i.warehouse_id IN (${marks(warehouses)})` : '';
  const s = f.season?.trim() ? ' AND m.season = ?' : '';
  const sales = db.prepare(`SELECT v.item_id, v.model_id, v.size, v.color_id, SUM(${SIGN} * l.qty_milli) AS qty, SUM(${SIGN} * ${BASE(LINE_NET)}) AS sales
                            FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN cl_variants v ON v.item_id = l.item_id JOIN cl_models m ON m.id = v.model_id
                            WHERE i.status = 'posted' AND i.kind IN ('sale', 'sale_return') AND i.date BETWEEN ? AND ?${w}${s}
                            GROUP BY v.item_id, v.model_id, v.size, v.color_id`).all(from, to, ...(warehouses ?? []), ...(s ? [f.season!.trim()] : [])) as
    { item_id: string; model_id: string; size: string; color_id: string; qty: number; sales: number }[];
  const ws = warehouses ? ` AND sm.warehouse_id IN (${marks(warehouses)})` : '';
  const stock = db.prepare(`SELECT v.item_id, v.model_id, v.size, v.color_id, SUM(sm.qty_milli) AS qty
                            FROM cl_variants v JOIN cl_models m ON m.id = v.model_id JOIN stock_moves sm ON sm.item_id = v.item_id
                            WHERE 1 = 1${ws}${s} GROUP BY v.item_id, v.model_id, v.size, v.color_id`).all(...(warehouses ?? []), ...(s ? [f.season!.trim()] : [])) as
    { item_id: string; model_id: string; size: string; color_id: string; qty: number }[];
  type Acc = { soldMilli: number; sales: number; onHandMilli: number };
  const add = (m: Map<string, Acc>, key: string, sold: number, value: number, hand: number) => {
    const a = m.get(key) ?? { soldMilli: 0, sales: 0, onHandMilli: 0 };
    a.soldMilli += sold; a.sales += value; a.onHandMilli += hand;
    m.set(key, a);
  };
  const byModel = new Map<string, Acc>();
  const bySize = new Map<string, Acc>();
  const byColor = new Map<string, Acc>();
  for (const r of sales) {
    const q = Number(r.qty ?? 0); const v = Math.round(Number(r.sales ?? 0));
    add(byModel, r.model_id, q, v, 0); add(bySize, r.size, q, v, 0); add(byColor, r.color_id, q, v, 0);
  }
  for (const r of stock) {
    const q = Math.max(0, Number(r.qty ?? 0));
    add(byModel, r.model_id, 0, 0, q); add(bySize, r.size, 0, 0, q); add(byColor, r.color_id, 0, 0, q);
  }
  const fig = (a: Acc): ClothingFigures => ({ ...a, sellThroughBp: sellThroughBp(a.soldMilli, a.onHandMilli) });
  const modelIds = [...byModel.keys()];
  const models = modelIds.length ? db.prepare(`SELECT * FROM cl_models WHERE id IN (${marks(modelIds)})`).all(...modelIds) as unknown as ModelRow[] : [];
  const colorIds = [...byColor.keys()].filter((c) => c);
  const colors = new Map((colorIds.length ? db.prepare(`SELECT * FROM cl_colors WHERE id IN (${marks(colorIds)})`).all(...colorIds) as unknown as ColorRow[] : []).map((c) => [c.id, c]));
  const bySales = <T extends ClothingFigures>(a: T, b: T) => b.soldMilli - a.soldMilli || b.sales - a.sales;
  return {
    from, to,
    models: models.map((m) => ({ modelId: m.id, code: m.code, name: names(m), season: m.season, ...fig(byModel.get(m.id)!) })).sort(bySales),
    sizes: [...bySize].map(([size, a]) => ({ size, ...fig(a) })).sort(bySales),
    colors: [...byColor].map(([id, a]) => {
      const c = id ? colors.get(id) : undefined;
      return { colorId: id || null, name: c ? names(c) : null, ...fig(a) };
    }).sort(bySales)
  };
}

/* ---------------- the API ---------------- */

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const idParam = z.object({ id }).strict();
const nameSchema = z.object({ ar: z.string().max(100), en: z.string().max(100), ku: z.string().max(100) }).strict();
const money = z.number().int().nonnegative().max(1_000_000_000_000);
const currency = z.enum(['IQD', 'USD']);
const size = z.string().min(1).max(12);
const sizePrices = z.record(size, money).refine((r) => Object.keys(r).length <= MAX_MODEL_SIZES);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const qty = z.number().int().nonnegative().max(1_000_000_000);
const colorBody = z.object({
  code: z.string().min(1).max(6), name: nameSchema, hex: z.string().max(7).nullable().optional(), sort: z.number().int().min(0).max(10_000).optional(), active: z.boolean().optional()
}).strict();
const modelBody = z.object({
  code: z.string().max(20).optional(), name: nameSchema, sizes: z.array(size).min(1).max(MAX_MODEL_SIZES), colorIds: z.array(id).max(MAX_MODEL_COLORS),
  season: z.string().max(40).nullable().optional(), categoryId: id.nullable().optional(), brandId: id.nullable().optional(), unit: z.string().max(16).optional(),
  salePrice: money, saleCurrency: currency, purchasePrice: money.nullable().optional(), purchaseCurrency: currency.nullable().optional(),
  barcodes: z.boolean().optional(), sizePrices: sizePrices.optional()
}).strict();
const modelPatch = z.object({
  name: nameSchema.optional(), season: z.string().max(40).nullable().optional(), categoryId: id.nullable().optional(), brandId: id.nullable().optional(),
  active: z.boolean().optional(), salePrice: money.optional(), sizePrices: sizePrices.optional(),
  addSizes: z.array(size).max(MAX_MODEL_SIZES).optional(), addColorIds: z.array(id).max(MAX_MODEL_COLORS).optional(), barcodes: z.boolean().optional()
}).strict();
const gridBody = z.object({
  kind: z.enum(['sale', 'purchase']),
  cells: z.array(z.object({ size, colorId: id.nullable().optional(), qtyMilli: qty }).strict()).max(MAX_MODEL_VARIANTS)
}).strict();
const saleLine = z.object({
  itemId: id, qtyMilli: qty.optional(), unitPrice: money, unit: z.string().max(16).optional(), unitQtyMilli: qty.optional(), batchId: id.optional()
}).strict();
const exchangeBody = z.object({
  invoiceId: id,
  approvals: z.array(z.string().max(64)).max(4).optional(),
  back: z.array(z.object({ lineNo: z.number().int().positive().max(10_000), qtyMilli: z.number().int().positive().max(1_000_000_000) }).strict()).min(1).max(200),
  sale: z.object({
    rateX100: z.number().int().positive().optional(), partyId: id.optional(), discount: money, notes: z.string().max(300).optional(),
    lines: z.array(saleLine).max(200), allowExpired: z.boolean().optional(),
    payments: z.array(z.object({ method: z.enum(['cash', 'card', 'fib', 'zaincash', 'qi', 'account']), amount: money }).strict()).max(4).optional(),
    tendered: money.optional()
  }).strict().optional()
}).strict();

const STOCK = 'stock' as const;
const SALES = 'sales' as const;

export const clothingApi: ApiExtension = {
  rules: {
    'POST /api/clothing/colors': STOCK,
    'PUT /api/clothing/colors/:id': STOCK,
    'POST /api/clothing/models': STOCK,
    'PUT /api/clothing/models/:id': STOCK,
    'DELETE /api/clothing/models/:id': STOCK,
    // turning a grid into lines changes nothing: whoever makes a sale or a purchase may ask
    'POST /api/clothing/models/:id/lines': null,
    // money back from the drawer is a sales return: as on the returns page
    'POST /api/clothing/shifts/:id/exchange': SALES
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      { method: 'GET', path: '/api/clothing', handler: async () => ({ available: clothingAvailable(db), colors: listColors(db), seasons: listSeasons(db) }) },
      { method: 'GET', path: '/api/clothing/colors', handler: async () => ({ colors: listColors(db) }) },
      {
        method: 'POST', path: '/api/clothing/colors',
        handler: async (req, reply) => {
          reply.status(201).send(saveColor(db, null, parse(colorBody, req.body), actor(req).name));
          return undefined;
        }
      },
      { method: 'PUT', path: '/api/clothing/colors/:id', handler: async (req) => saveColor(db, parse(idParam, req.params).id, parse(colorBody, req.body), actor(req).name) },
      {
        method: 'GET', path: '/api/clothing/models',
        handler: async (req) => {
          const q = parse(z.object({ q: z.string().max(100).optional(), season: z.string().max(40).optional(), categoryId: id.optional(), active: z.enum(['0', '1']).optional() }).strict(), req.query ?? {});
          return { models: listModels(db, { q: q.q, season: q.season, categoryId: q.categoryId, ...(q.active ? { active: q.active === '1' } : {}) }, actor(req)) };
        }
      },
      { method: 'GET', path: '/api/clothing/models/:id', handler: async (req) => getModel(db, parse(idParam, req.params).id, actor(req)) },
      {
        method: 'POST', path: '/api/clothing/models',
        handler: async (req, reply) => {
          const body = parse(modelBody, req.body);
          reply.status(201).send(createModel(db, { ...body, ...(body.unit ? { unit: body.unit as UnitCode } : {}) } as ModelInput, actor(req)));
          return undefined;
        }
      },
      { method: 'PUT', path: '/api/clothing/models/:id', handler: async (req) => updateModel(db, parse(idParam, req.params).id, parse(modelPatch, req.body), actor(req)) },
      {
        method: 'DELETE', path: '/api/clothing/models/:id',
        handler: async (req, reply) => {
          deleteModel(db, parse(idParam, req.params).id, actor(req));
          reply.status(204).send();
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/clothing/models/:id/lines',
        handler: async (req) => {
          const body = parse(gridBody, req.body);
          // a purchase's lines carry what the goods are bought for: only for whoever buys (or keeps the books)
          const who = actor(req);
          if (body.kind === 'purchase' && !who.permissions.some((p) => p === 'purchases' || p === 'admin')) throw new AppError(403, 'forbidden', { need: 'purchases' });
          return { lines: gridLines(db, parse(idParam, req.params).id, body.cells, body.kind) };
        }
      },
      {
        method: 'GET', path: '/api/clothing/variants',
        handler: async (req) => {
          const q = parse(z.object({ itemIds: z.string().max(5000) }).strict(), req.query ?? {});
          return { variants: variantsOf(db, q.itemIds.split(',').filter(Boolean).slice(0, 200)) };
        }
      },
      { method: 'GET', path: '/api/clothing/invoices/:id/variants', handler: async (req) => ({ lines: invoiceVariants(db, parse(idParam, req.params).id) }) },
      {
        method: 'POST', path: '/api/clothing/shifts/:id/exchange',
        handler: async (req, reply) => {
          reply.status(201).send(exchange(db, parse(idParam, req.params).id, parse(exchangeBody, req.body) as ExchangeInput, actor(req)));
          return undefined;
        }
      },
      {
        method: 'GET', path: '/api/clothing/reports',
        handler: async (req) => {
          const q = parse(z.object({ from: isoDate, to: isoDate, season: z.string().max(40).optional() }).strict(), req.query ?? {});
          return clothingReport(db, q.from, q.to, { season: q.season }, actor(req));
        }
      }
    ];
  }
};
