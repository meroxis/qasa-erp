import { roundHalfUp, toEasternDigits, toWesternDigits, type DigitStyle } from './money.ts';
import type { Names } from './lang.ts';

/** Quantities are whole numbers of thousandths, so 2.5 kg is stored as 2500. */
export const QTY_SCALE = 1000;

export function parseQty(text: string): number | null {
  const s = toWesternDigits(text).replace(/[,٬\s]/g, '').replace('٫', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const [whole = '0', fraction = ''] = s.split('.');
  const milli = Number(whole) * QTY_SCALE + Number(fraction.padEnd(3, '0') || '0');
  return Number.isSafeInteger(milli) ? milli : null;
}

export function formatQty(milli: number, digits: DigitStyle = 'western'): string {
  const negative = milli < 0;
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / QTY_SCALE);
  const fraction = String(abs % QTY_SCALE).padStart(3, '0').replace(/0+$/, '');
  let text = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? '.' + fraction : '');
  if (negative) text = '-' + text;
  return digits === 'eastern' ? toEasternDigits(text).replace('.', '٫') : text;
}

/** Line amount = quantity × unit price, in the price's minor units. */
export function lineAmount(qtyMilli: number, unitPrice: number): number {
  return roundHalfUp((qtyMilli * unitPrice) / QTY_SCALE);
}

/**
 * Weighted-average cost of `outQty` taken from a stock of `stockQty` worth `stockValue` (IQD).
 * Taking the whole stock takes its whole value, so the value never drifts from zero when stock runs out.
 */
export function costOut(stockQty: number, stockValue: number, outQty: number): number {
  if (stockQty <= 0 || outQty <= 0) return 0;
  if (outQty >= stockQty) return stockValue;
  return roundHalfUp((stockValue * outQty) / stockQty);
}

/** Splits `discount` over `amounts` in proportion; the rounding remainder goes to the largest amount. */
export function allocateDiscount(amounts: number[], discount: number): number[] {
  const total = amounts.reduce((s, a) => s + a, 0);
  if (!discount || total <= 0) return amounts.map(() => 0);
  const shares = amounts.map((a) => Math.floor((a * discount) / total));
  let rest = discount - shares.reduce((s, a) => s + a, 0);
  const order = amounts.map((a, i) => [a, i] as const).sort((x, y) => y[0] - x[0]);
  for (let k = 0; rest > 0 && order.length; k = (k + 1) % order.length) {
    const i = order[k]![1];
    shares[i] = (shares[i] ?? 0) + 1;
    rest -= 1;
  }
  return shares;
}

export type UnitCode = 'piece' | 'carton' | 'box' | 'set' | 'kg' | 'm' | 'l' | 'service';

export const UNITS: Record<UnitCode, Names> = {
  piece: { ar: 'قطعة', en: 'piece', ku: 'دانە' },
  carton: { ar: 'كارتون', en: 'carton', ku: 'کارتۆن' },
  box: { ar: 'علبة', en: 'box', ku: 'قوتوو' },
  set: { ar: 'طقم', en: 'set', ku: 'دەست' },
  kg: { ar: 'كغم', en: 'kg', ku: 'کیلۆ' },
  m: { ar: 'متر', en: 'm', ku: 'مەتر' },
  l: { ar: 'لتر', en: 'L', ku: 'لیتر' },
  service: { ar: 'خدمة', en: 'service', ku: 'خزمەتگوزاری' }
};

export function isUnit(value: unknown): value is UnitCode {
  return typeof value === 'string' && value in UNITS;
}
