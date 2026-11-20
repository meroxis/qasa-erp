/**
 * Labels printed by a shop scale (1.4, markets). The scale prints an EAN-13 that starts with 2: two digits of prefix,
 * five of the item's number on the scale, five of the weight in grams, and the check digit:
 *
 *     2 1 0 0 0 1 7 | 0 1 2 5 0 | 3        item 21 00017, 1.250 kg
 *
 * An item sold this way has those first seven digits as its barcode (2100017) and kg (or g) as its base unit. Read by
 * the till (apps/web/src/industry/scale-barcode.ts) and, since 1.4.2, by the server, which keeps an item's barcode from
 * clashing with the labels of a weighed item.
 */

/** The EAN-13 check digit of the first twelve digits. */
function checkDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/**
 * 2.0.0: how the scale lays out its label (Settings → Tills and till rules): 5 digits for the item and 5 for the weight
 * or price (2 + 2 + 5 + 5 + check, the usual), or 4 for the item and 6 for the value (prices up to 999,999 dinars, as
 * some scales print for meat). The item's own barcode is then its first 7 or 6 digits.
 */
export type ScaleItemDigits = 4 | 5;
export const isScaleItemDigits = (n: unknown): n is ScaleItemDigits => n === 4 || n === 5;
let scaleDigits: ScaleItemDigits = 5;
/** The layout the till reads labels with (the web app sets the company's; the server passes it on each call). */
export function setScaleItemDigits(n: ScaleItemDigits): void { scaleDigits = n; }
export const scaleItemDigits = (): ScaleItemDigits => scaleDigits;

/** A scale label's two parts, or null when the code is not one (13 digits starting with 2, a correct check digit, a weight). */
export function parseScaleBarcode(code: string, itemDigits: ScaleItemDigits = scaleDigits): { prefix: string; grams: number } | null {
  if (!/^2\d{12}$/.test(code)) return null;
  if (checkDigit(code.slice(0, 12)) !== Number(code[12])) return null;
  const cut = 2 + itemDigits;
  const grams = Number(code.slice(cut, 12));
  return grams > 0 ? { prefix: code.slice(0, cut), grams } : null;
}

/** The units a scale label's weight is read in. */
export const isWeighedUnit = (unit: string | null | undefined): boolean => unit === 'kg' || unit === 'g';

/**
 * Labels that carry the PRICE instead of the weight (2.0, markets): some scales print the price of what was weighed in
 * the last five digits. Which ones do is set per label prefix (the two digits after the 2, as the scale is set up),
 * e.g. "22": a label 22 00017 | 27500 | c is item 2200017, 27,500 dinars. The quantity is the price over the item's
 * price per kg. Nothing tells the two kinds apart in the code itself, so a prefix not listed is read as a weight.
 */
export const SCALE_PRICE_PREFIX = /^2\d$/;

/** The prefixes kept: each "2d" once, at most 10. */
export function cleanScalePrefixes(list: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const p of list) if (typeof p === 'string' && SCALE_PRICE_PREFIX.test(p) && !out.includes(p) && out.length < 10) out.push(p);
  return out;
}

export type ScaleLabel = { prefix: string; grams: number; price?: undefined } | { prefix: string; price: number; grams?: undefined };

/** A scale label read as a weight or, when its two-digit prefix is one of `pricePrefixes`, as a price in dinars. */
export function parseScaleLabel(code: string, pricePrefixes: readonly string[] = [], itemDigits: ScaleItemDigits = scaleDigits): ScaleLabel | null {
  const label = parseScaleBarcode(code, itemDigits);
  if (!label) return null;
  return pricePrefixes.includes(code.slice(0, 2)) ? { prefix: label.prefix, price: label.grams } : label;
}

/**
 * The quantity a price label stands for, in thousandths of the item's base unit (kg or g), at the item's price per
 * that unit (in the same currency as the label: dinars). Null when the item has no price to divide by.
 */
export function qtyForLabelPrice(price: number, unitPrice: number): number | null {
  if (!(unitPrice > 0) || !(price > 0)) return null;
  const qty = Math.round((price * 1000) / unitPrice);
  return qty > 0 ? qty : null;
}
