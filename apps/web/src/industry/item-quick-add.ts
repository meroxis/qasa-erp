import type { CurrencyCode, UnitCode } from '@qasa/core';
import { isNetworkError, newIdempotencyKey, type ItemInput, type ItemView, type Permission, type SendOptions } from '../api.ts';
import { may } from '../may.ts';

/**
 * Adding an item from inside an item picker (QuickItemForm.tsx): who may, what the form starts with for what was typed
 * or scanned, what is sent, and sending it so that a try whose answer was lost never adds the item twice. The same
 * request as the Items page's "New item" (POST /api/items), checked by the server the same way.
 */

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
}

/** A letter of any script: a name has one; a barcode a scanner typed into the box has none. */
const hasLetter = (text: string): boolean => /\p{L}/u.test(text);
/** What a scanner types: digits (Arabic or Persian ones too), at least 4 of them, nothing else. */
export const looksLikeBarcode = (text: string): boolean => /^[0-9٠-٩۰-۹]{4,64}$/.test(text.trim());
const western = (text: string) => text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

/**
 * What the form starts with for the text typed or scanned in the box: a name, or (digits only: a scan or a typed
 * barcode found nowhere) the barcode, with the name still to be written.
 */
export function quickItemStart(typed: string, unit: UnitCode = 'piece'): QuickItemFields {
  const text = typed.trim().replace(/\s+/g, ' ');
  const scan = !!text && !hasLetter(text) && looksLikeBarcode(text);
  return {
    name: scan ? '' : text.slice(0, QUICK_ITEM_LIMITS.name), barcode: scan ? western(text) : '', unit,
    salePrice: null, purchasePrice: null, currency: 'IQD', categoryId: ''
  };
}

/** How the text in the box is offered in the picker's "add" row: by name, or as a barcode. */
export function addRowKind(typed: string): 'name' | 'barcode' | 'empty' {
  const text = typed.trim();
  if (!text) return 'empty';
  return !hasLetter(text) && looksLikeBarcode(text) ? 'barcode' : 'name';
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
  /** the server was not reached: maybe added, maybe not; the next try with the same fields sends the same key */
  | { status: 'offline'; key: HeldItemKey };

/** Adds the item through the Items page's own request; a refusal by the server is thrown as it is. */
export async function quickAddItem(
  input: ItemInput, held: HeldItemKey | null,
  create: (input: ItemInput, options: SendOptions) => Promise<ItemView>, makeKey?: () => string
): Promise<QuickItemResult> {
  const key = itemKey(held, input, makeKey);
  try {
    return { status: 'added', item: await create(input, { key: key.key, timeoutMs: QUICK_ITEM_TIMEOUT_MS }) };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    return { status: 'offline', key };
  }
}
