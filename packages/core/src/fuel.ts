/**
 * Petrol stations: the arithmetic of a shift's meter readings, of the tanks and of what their fuel costs. Each nozzle's
 * meter only counts up; at a shift change the attendant's opening and closing readings give the litres sold (closing −
 * opening, or across the meter's maximum when it rolled over to zero), and the litres at the fuel's price per litre give
 * the money the shift should hand in. Readings and litres are kept in millilitres (a meter shows litres to two or three
 * decimals), prices and costs in whole dinars, so everything stays a whole number.
 */

/** The three shifts of a station's day. */
export const FUEL_SHIFTS = ['morning', 'evening', 'night'] as const;
export type FuelShift = (typeof FUEL_SHIFTS)[number];

export function isFuelShift(value: unknown): value is FuelShift {
  return typeof value === 'string' && (FUEL_SHIFTS as readonly string[]).includes(value);
}

/** The highest reading a meter may show, in millilitres (a 10-digit litre counter). */
export const METER_MAX_MILLI = 9_999_999_999_999;

/** A nozzle's meter maximum when none is set: six litre digits and two decimals (999999.99), then it starts at zero. */
export const DEFAULT_METER_MAX_MILLI = 999_999_990;

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
  // (exact for any litres and price: the product can pass what a double holds)
  return mulDiv(milli, pricePerLitre, 1000);
}

export interface NozzleReading {
  nozzleId: string;
  fuelTypeId: string;
  /** the price per litre the shift sells this nozzle's fuel at */
  price: number;
  openingMilli: number;
  /** null while the closing reading has not been written */
  closingMilli: number | null;
  /** the meter passed its maximum and started again at zero during the shift (ticked by the person on the sheet) */
  rollover?: boolean | undefined;
  /** the meter's maximum reading (DEFAULT_METER_MAX_MILLI when not given) */
  meterMaxMilli?: number | undefined;
  /** the most litres a rollover may come to (the capacity of the tank the nozzle draws from); no limit when not given */
  limitMilli?: number | undefined;
}

export type ReadingProblem = 'closing_missing' | 'closing_below_opening' | 'reading_invalid' | 'rollover_not_needed' | 'rollover_implausible';
type ReadingFields = Pick<NozzleReading, 'openingMilli' | 'closingMilli' | 'rollover' | 'meterMaxMilli' | 'limitMilli'>;

/**
 * What is wrong with one nozzle's readings, or null. A meter is never wound back, so closing below opening is refused,
 * unless the person said the meter rolled over (passed its maximum and started again at zero) and the litres that makes
 * (maximum − opening + closing) are no more than the limit (the tank's capacity): a mistyped reading does not pass as a
 * rollover. A rollover ticked on a meter that did not go back is refused too.
 */
export function readingProblem(r: ReadingFields): ReadingProblem | null {
  const max = r.meterMaxMilli ?? DEFAULT_METER_MAX_MILLI;
  if (!Number.isSafeInteger(max) || max <= 0 || max > METER_MAX_MILLI) return 'reading_invalid';
  const ok = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= max;
  if (!ok(r.openingMilli)) return 'reading_invalid';
  if (r.closingMilli === null) return 'closing_missing';
  if (!ok(r.closingMilli)) return 'reading_invalid';
  if (r.rollover) {
    if (r.closingMilli >= r.openingMilli) return 'rollover_not_needed';
    if (r.limitMilli !== undefined && max - r.openingMilli + r.closingMilli > r.limitMilli) return 'rollover_implausible';
    return null;
  }
  if (r.closingMilli < r.openingMilli) return 'closing_below_opening';
  return null;
}

/** The millilitres a nozzle sold: closing − opening, or maximum − opening + closing across a rollover (0 while wrong). */
export function soldMilli(r: ReadingFields): number {
  if (readingProblem(r) !== null) return 0;
  return r.rollover ? (r.meterMaxMilli ?? DEFAULT_METER_MAX_MILLI) - r.openingMilli + r.closingMilli! : r.closingMilli! - r.openingMilli;
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
    const milli = soldMilli(r);
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

// ——— tanks: calibration charts, average cost and dips ———

/** One row of a tank's calibration chart: the dip in millimetres (a stick read in cm to one decimal) and the litres it means. */
export interface ChartRow { mm: number; milli: number }

export const CHART_MAX_ROWS = 500;
/** The deepest dip a chart may name: 10 metres. */
export const DIP_MAX_MM = 10_000;

export type ChartProblem = 'chart_too_short' | 'chart_too_long' | 'chart_row_invalid' | 'chart_not_rising' | 'chart_over_capacity';

/**
 * What is wrong with a calibration chart, or null: at least two rows, the dips rising row by row, the litres never
 * going down, every number whole and none of the litres over the tank's capacity.
 */
export function chartProblem(rows: readonly ChartRow[], capacityMilli: number): ChartProblem | null {
  if (rows.length < 2) return 'chart_too_short';
  if (rows.length > CHART_MAX_ROWS) return 'chart_too_long';
  for (const r of rows) {
    if (!Number.isSafeInteger(r.mm) || r.mm < 0 || r.mm > DIP_MAX_MM || !Number.isSafeInteger(r.milli) || r.milli < 0) return 'chart_row_invalid';
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.mm <= rows[i - 1]!.mm || rows[i]!.milli < rows[i - 1]!.milli) return 'chart_not_rising';
  }
  if (rows.some((r) => r.milli > capacityMilli)) return 'chart_over_capacity';
  return null;
}

/**
 * The litres a dip means by the tank's chart, read straight between the two rows around it (to the nearest
 * millilitre); null when the dip is outside the chart (below its first row or above its last).
 */
export function dipLitres(rows: readonly ChartRow[], mm: number): number | null {
  if (!rows.length || !Number.isSafeInteger(mm)) return null;
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  if (mm < first.mm || mm > last.mm) return null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.mm === mm) return r.milli;
    const next = rows[i + 1];
    if (next && mm > r.mm && mm < next.mm) return r.milli + mulDiv(next.milli - r.milli, mm - r.mm, next.mm - r.mm);
  }
  return null;
}

/** A tank's book stock: the litres it should hold and what they cost (dinars). */
export interface TankStock { milli: number; value: number }

/** a × b / c to the nearest whole number (half away from zero), exact for any safe integers. */
export function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) return 0;
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  const negative = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return Number(negative ? -q : q);
}

/** A tank's average cost per litre in dinars (rounded), or `fallback` (the last delivery's price) when it holds nothing. */
export function averageCost(stock: TankStock, fallback: number): number {
  return stock.milli > 0 && stock.value > 0 ? mulDiv(stock.value, 1000, stock.milli) : fallback;
}

/**
 * What `milli` litres taken out of a tank cost at its moving average (the whole value when the whole stock is taken).
 * When the book holds nothing (or nothing of value) they cost the fallback price per litre (the last delivery's).
 */
export function tankCostOut(stock: TankStock, milli: number, fallback: number): number {
  if (milli <= 0) return 0;
  if (stock.milli > 0 && stock.value > 0) return milli === stock.milli ? stock.value : mulDiv(milli, stock.value, stock.milli);
  return fuelAmount(milli, fallback);
}

/** A dip set against the book: above zero the tank holds more than the book says (a gain), below zero less (a loss). */
export function dipVariance(measuredMilli: number, bookMilli: number): number {
  return measuredMilli - bookMilli;
}

/**
 * Whether a dip's difference is within the station's tolerance (basis points of the book litres: 50 = 0.5%), the
 * normal evaporation and temperature of a tank. It is posted all the same; the page says it is within the normal.
 */
export function withinTolerance(varianceMilli: number, bookMilli: number, toleranceBp: number): boolean {
  return Math.abs(varianceMilli) * 10_000 <= toleranceBp * Math.abs(bookMilli);
}

/** A dip typed in centimetres ("152.5", "١٥٢٫٥") as millimetres; null when it is not one (at most one decimal). */
export function parseDipCm(text: string): number | null {
  const milli = parseMeter(text);
  if (milli === null || milli % 100 !== 0) return null;
  const mm = milli / 100;
  return mm <= DIP_MAX_MM ? mm : null;
}
