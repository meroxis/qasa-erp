/**
 * Clothing and shoes (2.0): a model (one design: a shirt, a shoe) sold in sizes and colours. Each size and colour of it
 * is a real item (a variant) with its own code, barcode, stock and, when it needs one, its own price; the model keeps
 * them together, so a shop buys, counts, labels and reports a model as a grid of sizes × colours.
 *
 * What is shared here: the size scales a shop starts from, how a variant's code and name are made, the shop's own
 * barcodes for variants that came without one, and the sums the reports show.
 */
import type { Names } from './lang.ts';

/** A size scale a shop picks to start a model's sizes from (any size can be typed too). */
export interface SizeScale { id: string; name: Names; sizes: readonly string[] }

export const SIZE_SCALES: readonly SizeScale[] = [
  { id: 'letters', name: { ar: 'مقاسات حرفية', en: 'Letter sizes', ku: 'قەبارەی پیتی' }, sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] },
  { id: 'shoesMen', name: { ar: 'أحذية رجالية', en: 'Men’s shoes', ku: 'پێڵاوی پیاوان' }, sizes: ['39', '40', '41', '42', '43', '44', '45', '46'] },
  { id: 'shoesWomen', name: { ar: 'أحذية نسائية', en: 'Women’s shoes', ku: 'پێڵاوی ئافرەتان' }, sizes: ['35', '36', '37', '38', '39', '40', '41'] },
  { id: 'shoesKids', name: { ar: 'أحذية أطفال', en: 'Children’s shoes', ku: 'پێڵاوی منداڵان' }, sizes: ['24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34'] },
  { id: 'waist', name: { ar: 'مقاس الخصر', en: 'Waist', ku: 'قەبارەی کەمەر' }, sizes: ['28', '29', '30', '31', '32', '33', '34', '36', '38', '40', '42'] },
  { id: 'kidsAge', name: { ar: 'أعمار الأطفال', en: 'Children’s ages', ku: 'تەمەنی منداڵان' }, sizes: ['0-3M', '3-6M', '6-12M', '1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '8Y', '10Y', '12Y', '14Y'] },
  { id: 'numeric', name: { ar: 'مقاسات رقمية', en: 'Numbered sizes', ku: 'قەبارەی ژمارەیی' }, sizes: ['36', '38', '40', '42', '44', '46', '48', '50', '52', '54'] },
  { id: 'oneSize', name: { ar: 'مقاس واحد', en: 'One size', ku: 'یەک قەبارە' }, sizes: ['ONE'] }
];

export const MAX_MODEL_SIZES = 30;
export const MAX_MODEL_COLORS = 30;
/** a model makes at most this many variants at once (sizes × colours) */
export const MAX_MODEL_VARIANTS = 300;
/** a size as it is typed: letters, digits and a few signs, at most 12 */
export const SIZE_TEXT = /^[\p{L}\p{N}][\p{L}\p{N}./\- ]{0,11}$/u;
/** a colour's short code: what goes into a variant's code */
export const COLOR_CODE = /^[A-Z0-9]{1,6}$/;

/** A size cleaned the one way (trimmed, inner spaces single, Latin letters upper case), or null when it can't be one. */
export function cleanSize(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/\s+/g, ' ').toUpperCase();
  return SIZE_TEXT.test(s) ? s : null;
}

/** The sizes of a model as given, cleaned, each once, in the order given; null when one of them can't be a size. */
export function cleanSizes(list: readonly unknown[]): string[] | null {
  const out: string[] = [];
  for (const v of list) {
    const s = cleanSize(v);
    if (!s) return null;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** A variant's code: the model's, then the size, then the colour's code ("SH-0012-XL-BLK"); spaces and slashes become dashes. */
export function variantCode(modelCode: string, size: string, colorCode: string | null): string {
  const part = (s: string) => s.replace(/[\s/.]+/g, '-');
  return [modelCode, part(size), ...(colorCode ? [colorCode] : [])].join('-');
}

/** A variant's name in each language: the model's, then the size and colour ("Polo shirt · XL · Black"). */
export function variantNames(model: Names, size: string, color: Names | null): Names {
  const one = (lang: keyof Names) => [model[lang], size, ...(color ? [color[lang]] : [])].join(' · ');
  return { ar: one('ar'), en: one('en'), ku: one('ku') };
}

/** The EAN-13 check digit of twelve digits. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/**
 * A barcode the shop gives a variant that came without one: EAN-13 in the 04 range GS1 keeps for numbers used inside
 * one company (never 2…, which shop scales print), then ten digits of the shop's own count and the check digit.
 */
export function internalBarcode(n: number): string {
  if (!Number.isSafeInteger(n) || n < 1 || n > 9_999_999_999) throw new RangeError('internal barcode number out of range');
  const first12 = `04${String(n).padStart(10, '0')}`;
  return `${first12}${ean13CheckDigit(first12)}`;
}

/** Of what a model had to sell (what was sold plus what is still on hand), how much was sold, in hundredths of a percent. */
export function sellThroughBp(soldMilli: number, onHandMilli: number): number | null {
  const had = soldMilli + Math.max(0, onHandMilli);
  if (had <= 0) return null;
  return Math.round((Math.max(0, soldMilli) * 10_000) / had);
}

/** A grid's cells in the order a shop reads them: sizes in the model's order, each across its colours in theirs. */
export function gridOrder<T extends { size: string; colorId: string | null }>(cells: readonly T[], sizes: readonly string[], colorIds: readonly (string | null)[]): T[] {
  const s = (x: T) => { const i = sizes.indexOf(x.size); return i < 0 ? sizes.length : i; };
  const c = (x: T) => { const i = colorIds.indexOf(x.colorId); return i < 0 ? colorIds.length : i; };
  return [...cells].sort((a, b) => s(a) - s(b) || c(a) - c(b));
}
