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

/** A scale label's two parts, or null when the code is not one (13 digits starting with 2, a correct check digit, a weight). */
export function parseScaleBarcode(code: string): { prefix: string; grams: number } | null {
  if (!/^2\d{12}$/.test(code)) return null;
  if (checkDigit(code.slice(0, 12)) !== Number(code[12])) return null;
  const grams = Number(code.slice(7, 12));
  return grams > 0 ? { prefix: code.slice(0, 7), grams } : null;
}

/** The units a scale label's weight is read in. */
export const isWeighedUnit = (unit: string | null | undefined): boolean => unit === 'kg' || unit === 'g';
