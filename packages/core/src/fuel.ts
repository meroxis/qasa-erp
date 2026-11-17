/**
 * Petrol stations (prototype): the arithmetic of a shift's meter readings. Each nozzle's meter only counts up; at a
 * shift change the attendant's opening and closing readings give the litres sold (closing − opening), and the litres at
 * the fuel's price per litre give the money the shift should hand in. Readings are kept in millilitres (a meter shows
 * litres to two or three decimals) and prices in whole dinars per litre, so everything stays a whole number.
 */

/** The three shifts of a station's day. */
export const FUEL_SHIFTS = ['morning', 'evening', 'night'] as const;
export type FuelShift = (typeof FUEL_SHIFTS)[number];

export function isFuelShift(value: unknown): value is FuelShift {
  return typeof value === 'string' && (FUEL_SHIFTS as readonly string[]).includes(value);
}

/** The highest reading a meter may show, in millilitres (a 10-digit litre counter). */
export const METER_MAX_MILLI = 9_999_999_999_999;

/** A meter reading typed by a person ("123456.78", "١٢٣٤٥٦٫٧٨", "123,456.5") as millilitres; null when it is not one. */
export function parseMeter(text: string): number | null {
  const western = text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/[,٬\s]/g, '');
  const m = /^(\d{1,10})(?:\.(\d{1,3}))?$/.exec(western);
  if (!m) return null;
  const milli = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
  return Number.isSafeInteger(milli) && milli <= METER_MAX_MILLI ? milli : null;
}

/** Millilitres for people: 1234500 → "1234.5" (up to three decimals, no trailing zeros). */
export function meterText(milli: number): string {
  const whole = Math.trunc(milli / 1000);
  const frac = String(Math.abs(milli % 1000)).padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** The money for `milli` millilitres at `pricePerLitre` dinars, to whole dinars (half up). */
export function fuelAmount(milli: number, pricePerLitre: number): number {
  return Math.floor((milli * pricePerLitre + 500) / 1000);
}

export interface NozzleReading {
  nozzleId: string;
  fuelTypeId: string;
  /** the price per litre the shift sells this nozzle's fuel at */
  price: number;
  openingMilli: number;
  /** null while the closing reading has not been written */
  closingMilli: number | null;
}

export type ReadingProblem = 'closing_missing' | 'closing_below_opening' | 'reading_invalid';

/** What is wrong with one nozzle's readings, or null. A meter is never wound back, so closing below opening is refused. */
export function readingProblem(r: Pick<NozzleReading, 'openingMilli' | 'closingMilli'>): ReadingProblem | null {
  const ok = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= METER_MAX_MILLI;
  if (!ok(r.openingMilli)) return 'reading_invalid';
  if (r.closingMilli === null) return 'closing_missing';
  if (!ok(r.closingMilli)) return 'reading_invalid';
  if (r.closingMilli < r.openingMilli) return 'closing_below_opening';
  return null;
}

export interface FuelLine { nozzleId: string; fuelTypeId: string; price: number; milli: number; amount: number }
export interface FuelTotal { fuelTypeId: string; price: number; milli: number; amount: number }

export interface ShiftTotals {
  lines: FuelLine[];
  /** one row per fuel type (and price), in the order they first appear */
  byFuel: FuelTotal[];
  milli: number;
  /** what the litres sold come to */
  sales: number;
}

/**
 * The litres and money of a shift's readings. A nozzle without its closing reading (or with a wrong one) counts as
 * nothing sold yet; the sheet says which ones are missing.
 */
export function shiftTotals(readings: readonly NozzleReading[]): ShiftTotals {
  const lines: FuelLine[] = [];
  const byFuel = new Map<string, FuelTotal>();
  for (const r of readings) {
    const milli = readingProblem(r) === null ? r.closingMilli! - r.openingMilli : 0;
    const amount = fuelAmount(milli, r.price);
    lines.push({ nozzleId: r.nozzleId, fuelTypeId: r.fuelTypeId, price: r.price, milli, amount });
    const key = `${r.fuelTypeId}@${r.price}`;
    const t = byFuel.get(key) ?? { fuelTypeId: r.fuelTypeId, price: r.price, milli: 0, amount: 0 };
    t.milli += milli;
    t.amount += amount;
    byFuel.set(key, t);
  }
  return {
    lines,
    byFuel: [...byFuel.values()],
    milli: lines.reduce((s, l) => s + l.milli, 0),
    sales: lines.reduce((s, l) => s + l.amount, 0)
  };
}

export interface ShiftCash {
  sales: number;
  /** sold on credit or for coupons: not cash in the drawer */
  credit: number;
  /** the cash the attendant should hand in: sales − credit */
  expected: number;
  handed: number;
  /** handed − expected: below zero a shortage, above zero cash over */
  difference: number;
  result: 'exact' | 'short' | 'over';
}

/** Expected cash against the cash handed in. */
export function shiftCash(sales: number, credit: number, handed: number): ShiftCash {
  const expected = sales - credit;
  const difference = handed - expected;
  return { sales, credit, expected, handed, difference, result: difference === 0 ? 'exact' : difference < 0 ? 'short' : 'over' };
}
