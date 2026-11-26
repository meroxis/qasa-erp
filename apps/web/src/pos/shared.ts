import { todayIso } from '@qasa/core';
import { isNetworkError, type ItemView } from '../api.ts';
import type { I18n } from '../i18n.ts';
import { posApi, type Money2 } from '../industry/pos-api.ts';
import { thisTill } from '../industry/till.ts';
import { outboxClient, outboxWho, whoKey } from '../industry/outbox.ts';
import { rememberTill, tillCache } from '../industry/offline-till.ts';
import type { LineUnit } from '../industry/units.ts';

/**
 * What the till's parts share (2.0: the till is split into the files of this folder; pages/Pos.tsx is the page).
 */

export const REGISTER_KEY = 'qasa.pos.register';
export const remembered = () => { try { return localStorage.getItem(REGISTER_KEY) ?? ''; } catch { return ''; } };
export const remember = (v: string) => { try { localStorage.setItem(REGISTER_KEY, v); } catch { /* not available */ } };

/**
 * qtyMilli: in the line's unit (null: the item's base unit); unitPrice: per that unit. batchId: the batch picked by
 * hand ('' automatic); rxSeen: a pharmacy's "prescription seen" tick (a reminder, not sent).
 */
export interface CartLine { item: ItemView; qtyMilli: number; unitPrice: number; unit: LineUnit; batchId?: string; rxSeen?: boolean }
export const lineKey = (l: Pick<CartLine, 'item' | 'unit'>) => `${l.item.id}|${l.unit ?? ''}`;

export const lineTotal = (l: CartLine) => Math.round((l.qtyMilli * l.unitPrice) / 1000);

export function money2(i18n: I18n, m: Money2): string {
  return m.USD ? `${i18n.money(m.IQD, 'IQD')} · ${i18n.money(m.USD, 'USD')}` : i18n.money(m.IQD, 'IQD');
}

/**
 * When a shift opened or closed, as this PC's clock reads it: the date and the time both local (1.4.1; the date was
 * the UTC one, a day behind for a shift opened between midnight and 3 am in Iraq).
 */
export function shiftTime(i18n: Pick<I18n, 'date' | 'digitsOf'>, iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso);
  return `${i18n.date(todayIso(at))} ${i18n.digitsOf(at.toTimeString().slice(0, 5))}`;
}

/** Two letters for an item without a picture. */
export const initials = (s: string) => s.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();

/** Whose the till's memory is: the person signed in now. */
export const tillWho = () => whoKey(outboxWho());

/**
 * What the till had from the server, or (on a PC with an outbox, while the server can't be reached) what it last had:
 * the offline till (industry/offline-till.ts). Anything else fails as before.
 */
export async function fromServerOrTill<T>(load: () => Promise<T>, keep: (v: T) => void, cached: () => T | null | undefined): Promise<T> {
  try {
    const value = await load();
    keep(value);
    return value;
  } catch (e) {
    const kept = outboxClient() && isNetworkError(e) ? cached() : null;
    if (kept) return kept;
    throw e;
  }
}

export const currentShift = () => fromServerOrTill(() => posApi.current(thisTill()), (r) => rememberTill(tillWho(), { shift: r.shift }),
  () => { const shift = tillCache(tillWho())?.shift; return shift ? { shift } : null; });
