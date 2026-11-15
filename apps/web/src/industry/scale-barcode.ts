import { isWeighedUnit, parseScaleBarcode, type UnitCode } from '@qasa/core';

/**
 * Labels printed by a shop scale (1.4, markets). The scale prints an EAN-13 that starts with 2: two digits of prefix,
 * five of the item's number on the scale, five of the weight in grams, and the check digit:
 *
 *     2 1 0 0 0 1 7 | 0 1 2 5 0 | 3        item 21 00017, 1.250 kg
 *
 * An item sold this way has those first seven digits as its barcode (2100017) and kg (or g) as its base unit. Nothing
 * else is read as a weight: a full 13-digit barcode that belongs to an item is that item, as always. Labels that carry
 * the price instead of the weight are not read (the two look the same; which one a scale prints is set on the scale).
 * The label itself is read in @qasa/core (scale-label.ts), which the server uses too.
 */

export { parseScaleBarcode };

/**
 * The item a scale label is for and the quantity on it, in thousandths of the item's base unit: the item whose own
 * barcode is the label's first seven digits and that is kept in kg or g.
 */
export function findByScaleBarcode<T extends { barcode: string; unit?: UnitCode }>(code: string, items: readonly T[]): { item: T; qtyMilli: number } | null {
  const label = parseScaleBarcode(code);
  if (!label) return null;
  const item = items.find((it) => it.barcode === label.prefix && isWeighedUnit(it.unit));
  if (!item) return null;
  return { item, qtyMilli: item.unit === 'kg' ? label.grams : label.grams * 1000 };
}
