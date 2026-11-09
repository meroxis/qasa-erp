import { addDays, isIsoDate } from './dates.ts';
import { toWesternDigits } from './money.ts';

/**
 * Batches and expiry dates. An item can keep its stock per batch number (track_batches) and ask for an expiry date on
 * the way in (track_expiry). Batches hold quantity only: the value stays the item's average cost per warehouse.
 * What goes out comes from the earliest expiry first (FEFO), unless a batch is picked by hand.
 */

/** What may happen to a batch past its expiry date at the counter: refused (block) or sold after a confirmation (warn). */
export type ExpiredSalesPolicy = 'block' | 'warn';
export const EXPIRED_SALES_POLICIES: readonly ExpiredSalesPolicy[] = ['block', 'warn'];
export const DEFAULT_NEAR_EXPIRY_DAYS = 90;
export const MAX_BATCH_NO = 40;

export interface BatchStock {
  id: string;
  /** null: no expiry (stock from before tracking, or an item without expiry dates) */
  expiry: string | null;
  createdAt: string;
  /** on hand in this warehouse, thousandths */
  qtyMilli: number;
}

export type FefoResult =
  | { ok: true; picks: { id: string; qtyMilli: number }[]; usedExpired: boolean }
  | { ok: false; code: 'batch_insufficient' | 'batch_expired'; availableMilli: number };

/** A batch is expired on the day after its expiry date: one expiring today can still be sold today. */
export const isExpired = (expiry: string | null, date: string): boolean => expiry !== null && expiry < date;

/** FEFO order: earliest expiry first, no expiry last, then the older batch first. */
export function fefoOrder<T extends Pick<BatchStock, 'expiry' | 'createdAt' | 'id'>>(batches: readonly T[]): T[] {
  return [...batches].sort((a, b) => {
    if (a.expiry !== b.expiry) {
      if (a.expiry === null) return 1;
      if (b.expiry === null) return -1;
      return a.expiry < b.expiry ? -1 : 1;
    }
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Takes `needMilli` from the batches, earliest expiry first. Expired batches (expiry before `date`) are skipped under
 * 'block', and under 'warn' unless `allowExpired`; even then good batches go first. A write-off or a return to the
 * supplier may always take expired stock: the server asks for those with 'warn' and `allowExpired`.
 */
export function pickFefo(batches: readonly BatchStock[], needMilli: number, date: string, policy: ExpiredSalesPolicy, allowExpired: boolean): FefoResult {
  const usable = fefoOrder(batches.filter((b) => b.qtyMilli > 0));
  const good = usable.filter((b) => !isExpired(b.expiry, date));
  const expired = usable.filter((b) => isExpired(b.expiry, date));
  const mayUseExpired = allowExpired && policy === 'warn';
  const order = mayUseExpired ? [...good, ...expired] : good;
  const picks: { id: string; qtyMilli: number }[] = [];
  let rest = needMilli;
  let usedExpired = false;
  for (const b of order) {
    if (rest <= 0) break;
    const take = Math.min(rest, b.qtyMilli);
    picks.push({ id: b.id, qtyMilli: take });
    if (isExpired(b.expiry, date)) usedExpired = true;
    rest -= take;
  }
  if (rest > 0) {
    const goodTotal = good.reduce((s, b) => s + b.qtyMilli, 0);
    const all = goodTotal + expired.reduce((s, b) => s + b.qtyMilli, 0);
    // enough stock, but some of it is past its date: say so, rather than "not enough"
    if (!mayUseExpired && all >= needMilli) return { ok: false, code: 'batch_expired', availableMilli: goodTotal };
    return { ok: false, code: 'batch_insufficient', availableMilli: mayUseExpired ? all : goodTotal };
  }
  return { ok: true, picks, usedExpired };
}

/**
 * Where a return puts the quantity back: into the batches the original line took, the last taken first, less what
 * earlier returns already put back into each (`alreadyBack`).
 */
export function returnToBatches(taken: readonly { id: string; qtyMilli: number }[], alreadyBack: ReadonlyMap<string, number>, qtyMilli: number): { id: string; qtyMilli: number }[] {
  const back = new Map(alreadyBack);
  const out: { id: string; qtyMilli: number }[] = [];
  let rest = qtyMilli;
  for (const t of [...taken].reverse()) {
    if (rest <= 0) break;
    const done = back.get(t.id) ?? 0;
    const room = t.qtyMilli - done;
    if (room <= 0) {
      back.set(t.id, done - t.qtyMilli);
      continue;
    }
    back.set(t.id, 0);
    const put = Math.min(rest, room);
    out.push({ id: t.id, qtyMilli: put });
    rest -= put;
  }
  return out;
}

/** expired: past its date · near: within `nearDays` of it · ok · null: no expiry. */
export function expiryState(expiry: string | null, today: string, nearDays: number): 'expired' | 'near' | 'ok' | null {
  if (!expiry) return null;
  if (expiry < today) return 'expired';
  return expiry <= addDays(today, nearDays) ? 'near' : 'ok';
}

/** A batch number as kept: Western digits, NFKC, spaces collapsed, at most MAX_BATCH_NO characters; '' when empty. */
export function normalizeBatchNo(text: string | null | undefined): string {
  if (!text) return '';
  return toWesternDigits(text.normalize('NFKC'))
    // control characters never belong in a batch number (printed on labels and reports)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_BATCH_NO);
}

/** An expiry date as kept: an ISO calendar date, or null. */
export function normalizeExpiry(value: string | null | undefined): string | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  const western = toWesternDigits(value.trim());
  return isIsoDate(western) ? western : 'invalid';
}
