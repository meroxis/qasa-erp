import { ltr, parseNumber } from '../i18n';
import type { RateNow, RateRow } from './api';

/**
 * The dollar rate on the phone (phone app 1.1). In Iraq the dollar is quoted per $100 ("146,500"), which is exactly how
 * the office keeps rates (IQD per 1 USD × 100), so the number shown and typed is the number kept, as on the desktop's
 * rate board.
 */

/** The office's own range (fx.ts): 100 to 100,000 dinars a dollar. */
export const RATE_MIN = 10_000;
export const RATE_MAX = 10_000_000;
/** A rate further than this from the last one (in percent) is asked about before it is saved. */
export const BIG_CHANGE_PERCENT = 5;

/** A rate typed with Western, Arabic-Indic or Persian digits and separators: a whole number in range, else null. */
export function readRate(text: string): number | null {
  const n = parseNumber(text.trim());
  return Number.isSafeInteger(n) && n >= RATE_MIN && n <= RATE_MAX ? n : null;
}

/** The rate as the desktop shows it: 146,500. */
export const rateText = (rateX100: number) => ltr(String(Math.round(rateX100)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));

/** How far `next` is from `last`, in percent (no sign). */
export const changePercent = (last: number, next: number) => (last > 0 ? Math.abs(next - last) / last * 100 : 0);

/** Asked first: more than 5 % from the last rate (in whole numbers: no rounding decides it). */
export const isBigChange = (last: number | null | undefined, next: number) => !!last && last > 0 && Math.abs(next - last) * 100 > BIG_CHANGE_PERCENT * last;

/** The percent as the question says it: one decimal at most ("6.2", "12"). */
export const percentText = (last: number, next: number) => String(Math.round(changePercent(last, next) * 10) / 10);

/** The change of the newest rate on the board against the one before it, as the desktop shows it ("▲ 500"); null: none. */
export function changeText(rows: readonly RateRow[]): string | null {
  const [newest, previous] = rows;
  if (!newest || !previous) return null;
  const change = newest.rateX100 - previous.rateX100;
  return `${change > 0 ? '▲ ' : change < 0 ? '▼ ' : ''}${rateText(Math.abs(change))}`;
}

/** What the line under today's rate says: today's, the last rate's day (none entered today yet), or the default rate. */
export function rateStatus(now: RateNow, today: string): { key: 'rateToday' | 'rateLast' | 'rateDefault'; date: string | null } {
  if (now.source === 'default' || !now.date) return { key: 'rateDefault', date: null };
  return now.date === today ? { key: 'rateToday', date: now.date } : { key: 'rateLast', date: now.date };
}

/** The rates of the last `days` days up to today, newest first (the board's list may hold older ones). */
export function lastDays(rows: readonly RateRow[], today: string, days = 7): RateRow[] {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return rows.filter((r) => r.date >= from && r.date <= today);
}
