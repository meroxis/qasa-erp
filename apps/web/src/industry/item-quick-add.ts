import { normalizeForSearch, parseScaleBarcode, type CurrencyCode, type UnitCode } from '@qasa/core';
import { ApiError, isNetworkError, newIdempotencyKey, type ItemInput, type ItemView, type Permission, type SendOptions } from '../api.ts';
import { may } from '../may.ts';

/**
 * Adding an item from inside an item picker (QuickItemForm.tsx): who may, what the form starts with for what was typed
 * or scanned, what is sent, and sending it so that a try whose answer was lost never adds the item twice. The same
 * request as the Items page's "New item" (POST /api/items), checked by the server the same way.
 */

/**
 * An office server before 1.4.2 has no POST /api/items/:id/stock-correction: it answers with the web server's own 404
 * ("Not Found", "Route … not found"), unlike a record that is missing (404 'not_found'). This PC then says the office
 * server needs 1.4.2, in place of an error that names nothing.
 */
export function oldServerRefusal(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404 && e.code !== 'not_found';
}

/**
 * Whether the "+" shows: the stock permission, as for "New item" on the Items page (routes.ts: 'POST /api/items').
 * A cashier (sales alone) or a buyer (purchases alone) asks someone who keeps the stock: an item carries its prices
 * and, for whoever sees cost, its purchase price. Unknown permissions (not loaded yet): hidden.
 */
export function mayAddItem(permissions: readonly Permission[] | undefined): boolean {
  return may(permissions, 'item');
}

/** The limits of the server's own check (routes.ts, itemSchema), so a refusal is said at the field. */
export const QUICK_ITEM_LIMITS = { name: 200, barcode: 64 } as const;

export interface QuickItemFields {
  name: string;
  barcode: string;
  unit: UnitCode;
  salePrice: number | null;
  /** only sent by someone who sees cost */
  purchasePrice: number | null;
  currency: CurrencyCode;
  categoryId: string;
  /**
   * A sale (an invoice, the till) only: what is on the shelf now (base thousandths; null: nothing said). The item is
   * put on the sale with its stock, entered as opening stock at the purchase price (StockCorrection's "opening":
   * goods the shop had, against capital), so it can be sold at once.
   */
  stockMilli: number | null;
  /** a scale's label was scanned (a market): the label as scanned, whose weight goes on the sale once the item is made */
  scaleLabel: string | null;
}

/** A letter of any script: a name has one; a barcode a scanner typed into the box has none. */
const hasLetter = (text: string): boolean => /\p{L}/u.test(text);
/** What a scanner types: digits (Arabic or Persian ones too), at least 4 of them, nothing else. */
export const looksLikeBarcode = (text: string): boolean => /^[0-9٠-٩۰-۹]{4,64}$/.test(text.trim());
export const western = (text: string) => text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

/**
 * What the form starts with for the text typed or scanned in the box: a name, or (digits only: a scan or a typed
 * barcode found nowhere) the barcode, with the name still to be written. In a market, a scale's label (13 digits
 * starting with 2, the weight inside: scale-label.ts) is for a weighed item: its barcode is the label's first seven
 * digits and its unit the kilogram, so every label of that item finds it, each with its own weight.
 */
export function quickItemStart(typed: string, unit: UnitCode = 'piece', market = false): QuickItemFields {
  const text = typed.trim().replace(/\s+/g, ' ');
  const scan = !!text && !hasLetter(text) && looksLikeBarcode(text);
  const label = scan && market ? parseScaleBarcode(western(text)) : null;
  return {
    name: scan ? '' : text.slice(0, QUICK_ITEM_LIMITS.name), barcode: label ? label.prefix : scan ? western(text) : '', unit: label ? 'kg' : unit,
    salePrice: null, purchasePrice: null, currency: 'IQD', categoryId: '', stockMilli: null, scaleLabel: label ? western(text) : null
  };
}

/** How the text in the box is offered in the picker's "add" row: by name, as a barcode, or (a market) as a scale's label. */
export function addRowKind(typed: string, market = false): 'name' | 'barcode' | 'scale' | 'empty' {
  const text = typed.trim();
  if (!text) return 'empty';
  if (hasLetter(text) || !looksLikeBarcode(text)) return 'name';
  return market && parseScaleBarcode(western(text)) ? 'scale' : 'barcode';
}

/**
 * Whether the text in a search box finds anything at all in the whole list (each word in an item's search key), whatever
 * a category chosen on the page shows: only when it finds nothing is the item missing, and offered to be added.
 */
export function anyItemMatches(text: string, keys: readonly string[]): boolean {
  const words = normalizeForSearch(text).split(/\s+/).filter(Boolean);
  return words.length > 0 && keys.some((key) => words.every((w) => key.includes(w)));
}

/** What the form opens with for the text in a search box: a name as it was typed (its own digits kept), a scan in western digits. */
export const typedForForm = (typed: string): string => (addRowKind(typed) === 'name' ? typed.trim() : western(typed.trim()));

/** An item that is already there under the name (or code, or barcode) about to be added, and what is the same. */
export interface SameItem { item: ItemView; by: 'name' | 'code' | 'barcode' }

const comparable = (text: string): string => normalizeForSearch(western(text));

/**
 * The items already there that the one about to be added would duplicate (1.4.2): the same name in any of its
 * languages (letter case, Arabic and Kurdish letter forms, Arabic digits and extra spaces don't count), the same code,
 * or the same barcode. Checked against the whole list, whatever the page around the picker shows (a category, stock
 * items only), so an item hidden there is found, not made twice. Active ones first, at most five.
 */
export function sameItems(items: readonly ItemView[], fields: Pick<QuickItemFields, 'name' | 'barcode'>): SameItem[] {
  const name = comparable(fields.name);
  const barcode = western(fields.barcode.trim());
  const found: SameItem[] = [];
  for (const item of items) {
    if (barcode && item.barcode === barcode) found.push({ item, by: 'barcode' });
    else if (name && [item.name.ar, item.name.en, item.name.ku].some((n) => comparable(n) === name)) found.push({ item, by: 'name' });
    else if (name && comparable(item.code) === name) found.push({ item, by: 'code' });
  }
  return found.sort((a, b) => Number(b.item.active) - Number(a.item.active)).slice(0, 5);
}

/** What the server is asked for to find those items: the longest word of the name without digits (digits may be written either way). */
export function sameSearch(fields: Pick<QuickItemFields, 'name' | 'barcode'>): string {
  const words = normalizeForSearch(fields.name).split(' ').filter((w) => w && !/[0-9٠-٩۰-۹]/.test(w));
  return words.sort((a, b) => b.length - a.length)[0] ?? western(fields.barcode.trim());
}

export type QuickItemCheck = { ok: true; input: ItemInput } | { ok: false; field: 'name' | 'barcode' | 'salePrice'; code: 'name_required' | 'too_long' | 'price_required' };

/**
 * What the form sends: the one name (kept for every language by the server), the barcode when given, the unit, the
 * sale price and, from someone who sees cost, the purchase price (both in the currency picked), and the category.
 * Everything else keeps the Items page's defaults (stock kept, the company's batch setting, no other units).
 */
export function quickItemInput(fields: QuickItemFields, seesCost: boolean): QuickItemCheck {
  const name = fields.name.trim().replace(/\s+/g, ' ');
  const barcode = western(fields.barcode.trim());
  if (!name) return { ok: false, field: 'name', code: 'name_required' };
  if (name.length > QUICK_ITEM_LIMITS.name) return { ok: false, field: 'name', code: 'too_long' };
  if (barcode.length > QUICK_ITEM_LIMITS.barcode) return { ok: false, field: 'barcode', code: 'too_long' };
  if (fields.salePrice === null) return { ok: false, field: 'salePrice', code: 'price_required' };
  const input: ItemInput = {
    name: { ar: name, en: name, ku: name }, unit: fields.unit, salePrice: fields.salePrice, saleCurrency: fields.currency,
    ...(barcode ? { barcode } : {}),
    ...(seesCost && fields.purchasePrice !== null ? { purchasePrice: fields.purchasePrice, purchaseCurrency: fields.currency } : {}),
    ...(fields.categoryId ? { categoryId: fields.categoryId } : {})
  };
  return { ok: true, input };
}

/**
 * Whether the form shows the batch and expiry fields for what is on the shelf: once the item is there (made, or one
 * already there that was chosen), by its own settings; before, by the company's choice for new items (unknown when it
 * could not be read: the item's own settings decide once it is made, so a stock entry is never stuck without them).
 */
export function showsBatchFields(item: Pick<ItemView, 'trackBatches' | 'trackExpiry'> | null, companyExpiry: boolean): boolean {
  return item ? item.trackBatches || item.trackExpiry : companyExpiry;
}

/**
 * The stock typed in the form for an item that is already there and was chosen instead ("Use this one"), against what
 * the sale's warehouse holds of it: nothing typed (or 0), or the same as there is: nothing changes. Nothing there yet:
 * opening stock at the purchase price, as for a new item. Some there: a count correction to what was typed (a surplus
 * at the warehouse's average cost, a shortage written off), each with the company's approval rules.
 */
export type ExistingStockStep = { kind: 'none' } | { kind: 'enter'; reason: 'opening' | 'found'; adds: boolean };

export function existingStockStep(haveMilli: number, typedMilli: number | null): ExistingStockStep {
  if (typedMilli === null || typedMilli <= 0 || typedMilli === haveMilli) return { kind: 'none' };
  if (haveMilli <= 0) return { kind: 'enter', reason: 'opening', adds: true };
  return { kind: 'enter', reason: 'found', adds: typedMilli > haveMilli };
}

/** How long a quick add waits for the server before it says the link is down (as the customer box does). */
export const QUICK_ITEM_TIMEOUT_MS = 12_000;

/** The key an add is sent with: the same while the same item is sent again, a new one once anything changed. */
export interface HeldItemKey { key: string; of: string }

export function itemKey(held: HeldItemKey | null, input: ItemInput, make: () => string = newIdempotencyKey): HeldItemKey {
  const of = JSON.stringify(input);
  return held && held.of === of ? held : { key: make(), of };
}

export type QuickItemResult =
  | { status: 'added'; item: ItemView }
  /** items already there by that name, code or barcode: nothing was added; "Add anyway" sends it again with force */
  | { status: 'same'; same: SameItem[] }
  /** the server was not reached: maybe added, maybe not; the next try with the same fields sends the same key */
  | { status: 'offline'; key: HeldItemKey };

/**
 * Adds the item through the Items page's own request; a refusal by the server is thrown as it is. With `check`, the
 * items already there are asked for first (the whole list, by the name's words), and an item by the same name, code or
 * barcode is answered instead of adding a second one, unless `check.force` (the person chose "Add anyway").
 */
export async function quickAddItem(
  input: ItemInput, held: HeldItemKey | null,
  create: (input: ItemInput, options: SendOptions) => Promise<ItemView>, makeKey?: () => string,
  check?: { force: boolean; list(q: string, options: SendOptions): Promise<ItemView[]> }
): Promise<QuickItemResult> {
  const key = itemKey(held, input, makeKey);
  try {
    // a try sent again with its held key may have made the item already: the server answers it, never twice
    if (check && !check.force && !(held && held.key === key.key)) {
      const fields = { name: input.name.ar || input.name.en || input.name.ku, barcode: input.barcode ?? '' };
      const same = sameItems(await check.list(sameSearch(fields), { timeoutMs: QUICK_ITEM_TIMEOUT_MS }), fields);
      if (same.length) return { status: 'same', same };
    }
    return { status: 'added', item: await create(input, { key: key.key, timeoutMs: QUICK_ITEM_TIMEOUT_MS }) };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    return { status: 'offline', key };
  }
}
