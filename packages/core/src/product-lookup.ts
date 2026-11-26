/**
 * Looking a product up by its barcode in the open product databases (2.0): Open Food Facts and its sister projects.
 * What is here is shared by the server (which asks), the web app and the phone app (which show the answer and the
 * credit): which barcodes may be asked about at all, the databases, and the credit their licences ask for.
 *
 * Only a barcode a manufacturer printed is ever sent. A code the shop made itself says something about the shop and
 * finds nothing anyway, so it never leaves the building:
 *  - a scale's label and every other number GS1 keeps for use inside a shop (EAN-13 starting with 2, 02 or 04: the
 *    variants the app numbers itself are in the 04 range; a 12-digit UPC starting with 2 or 4; an 8-digit code
 *    starting with 2),
 *  - anything shorter than 8 digits, with letters, or of a length that is no GTIN (8, 12, 13 or 14 digits),
 *  - a code whose check digit is wrong (a typing slip, or a code that only looks like a barcode).
 */

/** The GTIN check digit of every digit but the last (the same rule for 8, 12, 13 and 14 digits). */
function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/**
 * The barcode as it may be sent to the open product databases (its digits, as typed), or null when it is the shop's
 * own or no manufacturer's barcode at all. Spaces around it don't count; Western digits only.
 */
export function publicBarcode(code: string | null | undefined): string | null {
  const text = (code ?? '').trim();
  if (!/^(\d{8}|\d{12,14})$/.test(text)) return null;
  if (gtinCheckDigit(text.slice(0, -1)) !== Number(text[text.length - 1])) return null;
  if (text.length === 8) return text.startsWith('2') ? null : text;
  // as 13 digits (a UPC with a zero before it; a 14-digit case code without its first digit): the GS1 prefix
  const ean = text.length === 12 ? `0${text}` : text.length === 14 ? text.slice(1) : text;
  if (/^(2|02|04)/.test(ean)) return null;
  return text;
}

/** The open product databases a picture or a name can come from. */
export const PRODUCT_SOURCES = ['openfoodfacts', 'openbeautyfacts', 'openproductsfacts', 'openpetfoodfacts'] as const;
export type ProductSource = (typeof PRODUCT_SOURCES)[number];
export const isProductSource = (v: unknown): v is ProductSource => typeof v === 'string' && (PRODUCT_SOURCES as readonly string[]).includes(v);

/** Each database's name as it is credited (a proper name: the same in every language) and its site. */
export const PRODUCT_SOURCE_NAMES: Record<ProductSource, string> = {
  openfoodfacts: 'Open Food Facts',
  openbeautyfacts: 'Open Beauty Facts',
  openproductsfacts: 'Open Products Facts',
  openpetfoodfacts: 'Open Pet Food Facts'
};
export const PRODUCT_SOURCE_SITES: Record<ProductSource, string> = {
  openfoodfacts: 'https://world.openfoodfacts.org',
  openbeautyfacts: 'https://world.openbeautyfacts.org',
  openproductsfacts: 'https://world.openproductsfacts.org',
  openpetfoodfacts: 'https://world.openpetfoodfacts.org'
};

/** The licence of the pictures (their terms of use: Creative Commons Attribution-ShareAlike), as stored with a picture. */
export const PRODUCT_IMAGE_LICENCE = 'CC BY-SA 3.0';
export const PRODUCT_IMAGE_LICENCE_URL = 'https://creativecommons.org/licenses/by-sa/3.0/';

/** The sources among `list`, each once, in the databases' own order (what a screen's credit line names). */
export function creditedSources(list: readonly (string | null | undefined)[]): ProductSource[] {
  return PRODUCT_SOURCES.filter((s) => list.includes(s));
}

/** "Open Food Facts, Open Beauty Facts": the names a credit line lists. */
export const creditNames = (sources: readonly ProductSource[]): string => sources.map((s) => PRODUCT_SOURCE_NAMES[s]).join(', ');
