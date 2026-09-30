/** Dates are stored as ISO calendar dates: "YYYY-MM-DD". */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** "2026-09-26" → "2026-09" (the accounting period / month). */
export function periodOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

/** "2026-09-26" → "26/09/2026", the usual Iraqi display order. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "2026-09-26" + 5 → "2026-10-01" (negative days go back). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The fiscal year named after the calendar year it starts in, for a start day "MM-DD" (the company setting):
 * with "01-01", 2026 is 2026-01-01 … 2026-12-31; with "07-01", 2026 is 2026-07-01 … 2027-06-30.
 */
export function fiscalYear(year: number, start: string): { from: string; to: string } {
  return { from: `${year}-${start}`, to: addDays(`${year + 1}-${start}`, -1) };
}

/** The fiscal year a day falls in (see fiscalYear). */
export function fiscalYearOf(isoDate: string, start: string): number {
  const year = yearOf(isoDate);
  return isoDate.slice(5) >= start ? year : year - 1;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const utc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number) as [number, number, number]; return Date.UTC(y, m - 1, d); };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

export const MONTHS = {
  ar: ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ku: ['کانوونی دووەم', 'شوبات', 'ئازار', 'نیسان', 'ئایار', 'حوزەیران', 'تەمموز', 'ئاب', 'ئەیلوول', 'تشرینی یەکەم', 'تشرینی دووەم', 'کانوونی یەکەم']
} as const;
