import type { CurrencyCode, UnitCode } from '@qasa/core';
import type { ItemView } from '../api.ts';
import { salePriceFor } from '../industry/units.ts';

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
 * otherwise "3*code" or "3x code" sells three of that code. A barcode of one of an item's units (a box, a strip) finds
 * the item with that unit (`unit`; null: the item's own barcode or code, its base unit).
 */
export function parseScan<T extends Pick<ItemView, 'barcode' | 'code'> & { units?: ItemView['units'] }>(raw: string, items: readonly T[]): {
  code: string; qtyMilli: number; exact: T | undefined; unit: UnitCode | null;
} {
  const find = (code: string): { item: T; unit: UnitCode | null } | undefined => {
    const own = items.find((it) => it.barcode === code || it.code.toLowerCase() === code.toLowerCase());
    if (own) return { item: own, unit: null };
    for (const it of items) {
      const u = it.units?.find((x) => x.barcode && x.barcode === code);
      if (u) return { item: it, unit: u.unit };
    }
    return undefined;
  };
  const whole = find(raw);
  if (whole) return { code: raw, qtyMilli: 1000, exact: whole.item, unit: whole.unit };
  const star = /^(\d+(?:\.\d+)?)\s*[*x×]\s*(.+)$/i.exec(raw);
  if (!star) return { code: raw, qtyMilli: 1000, exact: undefined, unit: null };
  const code = star[2]!.trim();
  const found = find(code);
  return { code, qtyMilli: Math.round(Number(star[1]) * 1000), exact: found?.item, unit: found?.unit ?? null };
}

/**
 * Change for the cash the customer handed over. All cash (no split): against the whole total. A split sale: against
 * its cash part only (the card or wallet parts are paid apart); null when the split has no cash part.
 */
export function cashChange(paid: number | null, total: number, parts: readonly { method: string; amount: number | null }[]): number | null {
  if (paid === null) return null;
  if (parts.length === 0) return paid - total;
  const cash = parts.filter((p) => p.method === 'cash').reduce((s, p) => s + (p.amount ?? 0), 0);
  return cash > 0 ? paid - cash : null;
}

/**
 * A cart line as the sale sends it: in its unit (or the base unit), and pinned to the batch the cashier picked ('':
 * automatic, the earliest expiry first).
 */
export function posSaleLine(l: { item: { id: string }; unit: UnitCode | null; qtyMilli: number; unitPrice: number; batchId?: string }):
  ({ itemId: string; qtyMilli: number; unitPrice: number } | { itemId: string; unit: UnitCode; unitQtyMilli: number; unitPrice: number }) & { batchId?: string } {
  const batch = l.batchId ? { batchId: l.batchId } : {};
  return l.unit
    ? { itemId: l.item.id, unit: l.unit, unitQtyMilli: l.qtyMilli, unitPrice: l.unitPrice, ...batch }
    : { itemId: l.item.id, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, ...batch };
}

/**
 * A cart line taken to another unit (the unit chip): when the cart already has a line of that item in that unit, the
 * two become one (that line takes the quantity), so the cart never holds two lines with the same item and unit.
 */
export function changeLineUnit<L extends { item: { id: string }; unit: UnitCode | null; qtyMilli: number; unitPrice: number }>(
  cart: readonly L[], index: number, unit: UnitCode | null, unitPrice: number
): L[] {
  const line = cart[index];
  if (!line) return [...cart];
  const into = cart.findIndex((l, i) => i !== index && l.item.id === line.item.id && l.unit === unit);
  if (into < 0) return cart.map((l, i) => (i === index ? { ...l, unit, unitPrice } : l));
  return cart.flatMap((l, i) => (i === index ? [] : i === into ? [{ ...l, qtyMilli: l.qtyMilli + line.qtyMilli }] : [l]));
}

/**
 * What a tile shows: the price of the unit a tap adds (the item's sale unit; its own price, or the base price × its
 * factor), in the sale's currency; null when it cannot be priced (no rate).
 */
export function tileOffer(item: Pick<ItemView, 'saleCurrency' | 'salePrice' | 'saleUnit' | 'units'>, currency: CurrencyCode, rateX100: number): { unit: UnitCode | null; price: number | null } {
  const unit = item.saleUnit ?? null;
  if (!canPrice(item, currency, rateX100)) return { unit, price: null };
  const own = unit ? item.units?.find((u) => u.unit === unit)?.salePrice ?? null : null;
  const ownIn = own !== null ? priceIn({ salePrice: own, saleCurrency: item.saleCurrency }, currency, rateX100) : null;
  return { unit, price: salePriceFor(item, unit, priceIn(item, currency, rateX100), { own: ownIn }) };
}
