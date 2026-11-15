import type { Money } from '../api';
import type { Key } from '../i18n';
import { lockRequired, type Me } from '../roles';
import type { DayMethod } from './api';

/**
 * The end-of-day close on the phone (phone app 1.1), read only. A phone that keeps no PIN asks for its user's own part
 * only (mine=1: the registers they opened, and their shifts' sales and debts), whatever else that user may read on a PC:
 * the office answers such a phone nothing else (pro/src/phone/owner-routes.ts).
 */

/** Ask with mine=1: every phone the app asks no PIN of. */
export const askMine = (me: Me | null): boolean => !lockRequired(me);

/** The day before or after (YYYY-MM-DD), never after today. */
export function stepDay(date: string, by: -1 | 1, today: string): string {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
  return next > today ? today : next;
}

/** The day before `today`. */
export const yesterdayOf = (today: string) => stepDay(today, -1, today);

/** The desktop's words for how a sale was paid. */
export const METHOD_KEY: Record<DayMethod, Key> = {
  cash: 'payCash', bank: 'dayMBank', card: 'dayMCard', fib: 'dayMFib', zaincash: 'dayMZainCash', qi: 'dayMQi', credit: 'payCredit', loyalty: 'dayMLoyalty'
};

/** A closed drawer counted against what was expected (counted − expected): short, over, or matching. null: not counted yet. */
export function drawerTone(difference: Money | null): { key: 'dayShort' | 'dayOver' | 'dayMatches'; tone: 'bad' | 'warn' | 'ok' } | null {
  if (!difference) return null;
  if (difference.IQD < 0 || difference.USD < 0) return { key: 'dayShort', tone: 'bad' };
  if (difference.IQD > 0 || difference.USD > 0) return { key: 'dayOver', tone: 'warn' };
  return { key: 'dayMatches', tone: 'ok' };
}
