import type { CurrencyCode } from '@qasa/core';
import type { ItemView } from '../api.ts';

/**
 * The rate used to price items in a sale. A dollar sale uses the rate typed on the register; a dinar sale uses the
 * company's default rate, so a dollar-priced item is converted to dinars (never a fixed 1:1 or 1:100 factor).
 */
export function priceRateFor(currency: CurrencyCode, typedRateX100: number, defaultRateX100: number | undefined): number {
  return currency === 'USD' ? typedRateX100 : defaultRateX100 ?? 0;
}

/** An item's sale price in the sale's currency (IQD dinars or USD cents), at the given dinars-per-dollar rate (x100). */
export function priceIn(item: Pick<ItemView, 'saleCurrency' | 'salePrice'>, currency: CurrencyCode, rateX100: number): number {
  if (item.saleCurrency === currency) return item.salePrice;
  if (!rateX100) return 0;
  return currency === 'USD'
    ? Math.round((item.salePrice * 10000) / rateX100) // IQD → cents
    : Math.round((item.salePrice * rateX100) / 10000); // cents → IQD
}

/** Whether an item can be sold in this currency: a foreign-priced item needs a rate. */
export const canPrice = (item: Pick<ItemView, 'saleCurrency'>, currency: CurrencyCode, rateX100: number): boolean =>
  item.saleCurrency === currency || rateX100 > 0;

/** The price a tile shows, or null when it cannot be priced (no rate to convert it): the tile shows "—", never 0. */
export const tilePrice = (item: Pick<ItemView, 'saleCurrency' | 'salePrice'>, currency: CurrencyCode, rateX100: number): number | null =>
  canPrice(item, currency, rateX100) ? priceIn(item, currency, rateX100) : null;

/**
 * Why an item the cashier picked cannot go into the sale: no rate to convert its price ('pos_noRate', not the
 * "no item with this code" message, since the item exists), or null when it can be sold.
 */
export const addRefusal = (item: Pick<ItemView, 'saleCurrency'>, currency: CurrencyCode, rateX100: number): 'pos_noRate' | null =>
  canPrice(item, currency, rateX100) ? null : 'pos_noRate';

/**
 * What the cashier typed or scanned: an exact barcode or code wins (a code such as "12x5" is a code, not 12 × "5");
 * otherwise "3*code" or "3x code" sells three of that code.
 */
export function parseScan<T extends Pick<ItemView, 'barcode' | 'code'>>(raw: string, items: readonly T[]): { code: string; qtyMilli: number; exact: T | undefined } {
  const find = (code: string) => items.find((it) => it.barcode === code || it.code.toLowerCase() === code.toLowerCase());
  const whole = find(raw);
  if (whole) return { code: raw, qtyMilli: 1000, exact: whole };
  const star = /^(\d+(?:\.\d+)?)\s*[*x×]\s*(.+)$/i.exec(raw);
  if (!star) return { code: raw, qtyMilli: 1000, exact: undefined };
  const code = star[2]!.trim();
  return { code, qtyMilli: Math.round(Number(star[1]) * 1000), exact: find(code) };
}
