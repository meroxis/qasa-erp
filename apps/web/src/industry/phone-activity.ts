import type { CurrencyCode } from '@qasa/core';
import { requestQuietly } from '../api.ts';
import type { Key } from '../i18n.ts';

/**
 * Work from phones, told at the office PCs (1.5): what a phone made (a draft sale, an order, a receipt voucher, a
 * count, an expense, a transfer, goods received) as the office lists it for the person signed in (GET
 * /api/phone-activity, Pro: already filtered by what they may open, the amount only for those who see the figures),
 * the header's "From phones" list and its count, and the Windows notifications on this PC.
 */

export type PhoneActivityKind = 'sale' | 'order' | 'receipt' | 'expense' | 'count' | 'transfer' | 'received';

export interface PhoneActivityItem {
  id: number;
  at: string;
  kind: PhoneActivityKind;
  phone: string;
  user: string | null;
  doc: string | null;
  amount?: number;
  currency?: CurrencyCode;
}

export interface PhoneActivityAnswer {
  on: boolean;
  last: number;
  seen: number;
  unseen?: number;
  items?: PhoneActivityItem[];
  waiting: number | null;
}

export const phoneActivityApi = {
  get: (since?: number) => requestQuietly<PhoneActivityAnswer>('GET', '/api/phone-activity' + (since !== undefined ? `?since=${since}` : '')),
  seen: (upTo: number) => requestQuietly<PhoneActivityAnswer>('POST', '/api/phone-activity/seen', { upTo })
};

/** The app's page for what a phone made (as the router names it); '' when there is none to open. */
export function docRoute(item: Pick<PhoneActivityItem, 'kind' | 'doc'>): string {
  if (!item.doc) return item.kind === 'count' ? 'settings/network' : '';
  const id = encodeURIComponent(item.doc);
  switch (item.kind) {
    case 'sale': return `invoice/${id}`;
    case 'order': return `quote/${id}`;
    case 'receipt':
    case 'expense': return `entry/${id}`;
    case 'transfer': return `stock-doc/${id}`;
    case 'received': return `purchase-order/${id}`;
    case 'count': return 'stock-count';
  }
}

export const kindKey = (kind: PhoneActivityKind): Key => `pn_kind_${kind}` as Key;

/** How long to wait before asking again: a little while; longer when the window is hidden, nothing comes, or it failed. */
export function pollDelay(o: { hidden: boolean; on: boolean; failures: number }): number {
  if (o.failures > 0) return Math.min(20_000 * 2 ** Math.min(o.failures, 4), 5 * 60_000);
  if (!o.on) return 5 * 60_000;
  return o.hidden ? 60_000 : 20_000;
}

/** What is new to tell: newer than both what was told already on this PC and what the person has seen; oldest first. */
export function freshItems(items: readonly PhoneActivityItem[], toldUpTo: number, seen: number): PhoneActivityItem[] {
  const from = Math.max(toldUpTo, seen);
  return items.filter((i) => i.id > from).sort((a, b) => a.id - b.id);
}

export interface Notice { title: string; body: string; route: string }

type T = (key: Key, vars?: Record<string, string | number>) => string;
type Money = (amount: number, currency: CurrencyCode) => string;

/** One line of work from a phone: "Mer · Draft sale from a phone · 250,000 IQD" (the phone's name when it has no user). */
export function noticeLine(item: PhoneActivityItem, t: T, money: Money): string {
  const line = t('pn_notice', { who: item.user || item.phone, what: t(kindKey(item.kind)) });
  return item.amount !== undefined && item.currency ? `${line} · ${money(item.amount, item.currency)}` : line;
}

/**
 * The notification for what arrived: one item says who, what and how much, and opens its document; several at once
 * are one notice ("3 new from phones") naming the first of them, which opens the list.
 */
export function noticeFor(fresh: readonly PhoneActivityItem[], t: T, money: Money, int: (n: number) => string): Notice | null {
  if (!fresh.length) return null;
  if (fresh.length === 1) {
    const item = fresh[0]!;
    return { title: noticeLine(item, t, money), body: t('pn_viaPhone', { phone: item.phone }), route: docRoute(item) };
  }
  const newest = [...fresh].sort((a, b) => b.id - a.id);
  const names = newest.slice(0, 3).map((i) => `${i.user || i.phone} · ${t(kindKey(i.kind))}`);
  return { title: t('pn_many', { n: int(fresh.length) }), body: names.join(' — ') + (fresh.length > 3 ? ' …' : ''), route: '' };
}

/**
 * What to tell of an answer: null when it brought no list (nothing changed); otherwise the line told up to now, and
 * the notice for what is new (none the first time on this PC for this person, nor with notifications off here).
 */
export function whatToTell(answer: PhoneActivityAnswer, told: number | null, on: boolean, t: T, money: Money, int: (n: number) => string): { toldUpTo: number; notice: Notice | null } | null {
  if (!answer.items) return null;
  if (told === null) return { toldUpTo: answer.last, notice: null };
  const fresh = freshItems(answer.items, told, answer.seen);
  return { toldUpTo: Math.max(told, answer.last), notice: on ? noticeFor(fresh, t, money, int) : null };
}

/** "Notify me of work from phones" on this PC (Settings → Language and display): on unless switched off here. */
const NOTIFY_KEY = 'qasa.phoneNotify';
export function phoneNotifyOn(): boolean {
  try {
    return localStorage.getItem(NOTIFY_KEY) !== 'off';
  } catch {
    return true;
  }
}
export const PHONE_NOTIFY_EVENT = 'qasa:phone-notify';
export function setPhoneNotify(on: boolean): void {
  try { localStorage.setItem(NOTIFY_KEY, on ? 'on' : 'off'); } catch { /* not kept: on again next time */ }
  window.dispatchEvent(new Event(PHONE_NOTIFY_EVENT));
}

/** What this PC has told the person already (a line of the log), so a restart does not tell it again. */
const toldKey = (userKey: string) => `qasa.phoneTold.${userKey}`;
export function toldUpTo(userKey: string): number | null {
  try {
    const n = Number(localStorage.getItem(toldKey(userKey)) ?? NaN);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}
export function setToldUpTo(userKey: string, id: number): void {
  try { localStorage.setItem(toldKey(userKey), String(id)); } catch { /* told again after a restart, at worst */ }
}

/** The Windows app's notifications (app-preload.ts); null in a browser, where the header's count is the notice. */
export interface DesktopPhoneNotices {
  phoneNotice(title: string, body: string, route: string): Promise<boolean>;
  onPhoneNoticeOpen(listener: (route: string) => void): () => void;
}
export function desktopNotices(): DesktopPhoneNotices | null {
  const d = (window as unknown as { qasaDesktop?: Partial<DesktopPhoneNotices> }).qasaDesktop;
  return d && typeof d.phoneNotice === 'function' && typeof d.onPhoneNoticeOpen === 'function' ? (d as DesktopPhoneNotices) : null;
}
