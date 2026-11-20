import type { CurrencyCode, UnitCode } from '@qasa/core';

/**
 * The till on this PC (2.0, supermarkets): which named till it is, the baskets held on it, the customer screen it
 * feeds and the cash drawer it opens. All of it is this PC's own (localStorage, in this browser), never the company's.
 */

const TILL_KEY = 'qasa.pos.till';
const HELD_KEY = 'qasa.pos.held';
const SCALE_KEY = 'qasa.pos.scale';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null): void {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* not available */ }
}

/** The named till this PC is (its id), or '' for none (a register typed by name, as before 2.0). */
export const thisTill = (): string => read(TILL_KEY) ?? '';
export const setThisTill = (id: string): void => write(TILL_KEY, id || null);

/* ---------- held baskets ---------- */

/** A line of a held basket: the item by id (re-read from the till's list when it comes back), as it was in the cart. */
export interface HeldLine { itemId: string; qtyMilli: number; unit: UnitCode | null; unitPrice: number; batchId?: string }

export interface HeldBasket {
  id: string;
  /** the shift it belongs to: a basket is never resumed on another shift */
  shiftId: string;
  /** when it was held */
  at: string;
  currency: CurrencyCode;
  rateText: string;
  partyId: string;
  discount: number;
  lines: HeldLine[];
  /** what it came to, to tell the baskets apart */
  total: number;
}

/** At most this many baskets wait on a till; each at most 300 lines. */
export const HELD_MAX = 20;

function allHeld(): HeldBasket[] {
  try {
    const list = JSON.parse(read(HELD_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? (list as HeldBasket[]).filter((b) => b && typeof b.id === 'string' && typeof b.shiftId === 'string' && Array.isArray(b.lines)) : [];
  } catch {
    return [];
  }
}

/** The baskets held on a shift, oldest first. */
export const heldOn = (shiftId: string): HeldBasket[] => allHeld().filter((b) => b.shiftId === shiftId);

/**
 * Holds a basket; answers false when the till already holds HELD_MAX (or the basket is empty). Baskets of other
 * shifts (closed, or another cashier's on this PC) are kept as they are: each shift clears its own at closing.
 */
export function holdBasket(basket: Omit<HeldBasket, 'id' | 'at'>, now = new Date()): HeldBasket | null {
  if (!basket.lines.length) return null;
  const mine = heldOn(basket.shiftId);
  if (mine.length >= HELD_MAX) return null;
  const held: HeldBasket = { ...basket, lines: basket.lines.slice(0, 300), id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: now.toISOString() };
  write(HELD_KEY, JSON.stringify([...allHeld(), held]));
  return held;
}

/** Takes a held basket back (it leaves the list), or null when it is gone. */
export function takeHeld(shiftId: string, id: string): HeldBasket | null {
  const list = allHeld();
  const found = list.find((b) => b.id === id && b.shiftId === shiftId) ?? null;
  if (found) write(HELD_KEY, JSON.stringify(list.filter((b) => b !== found)));
  return found;
}

/** The shift was closed: its held baskets go (the cashier was warned first). Answers how many there were. */
export function clearHeld(shiftId: string): number {
  const list = allHeld();
  const left = list.filter((b) => b.shiftId !== shiftId);
  write(HELD_KEY, JSON.stringify(left));
  return list.length - left.length;
}

/* ---------- scale labels that carry a price (cached for the offline till) ---------- */

export const scalePrefixesKept = (): string[] => {
  try { const v = JSON.parse(read(SCALE_KEY) ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
};
export const keepScalePrefixes = (list: string[]): void => write(SCALE_KEY, JSON.stringify(list));

/* ---------- the customer screen ---------- */

export const CUSTOMER_CHANNEL = 'qasa-customer-display';

/** What the customer screen shows: words already in the till's language, amounts already written out. */
export interface CustomerScreenState {
  dir: 'rtl' | 'ltr';
  lang: string;
  company: string;
  welcome: string;
  lines: { name: string; qty: string; amount: string; offer?: string | undefined }[];
  totalLabel: string;
  total: string;
  /** 2.0: what offers saved on this basket, the customer's points, and that the cashier is taking the payment now */
  saved?: { label: string; value: string } | undefined;
  points?: { label: string; value: string } | undefined;
  paying?: boolean | undefined;
  /** "Paid" and "Change", once the cashier types what was handed over */
  paid?: { label: string; value: string } | undefined;
  change?: { label: string; value: string } | undefined;
  /** a short line after the sale (Thank you) */
  done?: string | undefined;
}

let channel: BroadcastChannel | null = null;
/** Sends the till's state to the customer screen(s) open in this browser (a second window of the same page). */
export function showOnCustomerScreen(state: CustomerScreenState): void {
  if (typeof BroadcastChannel === 'undefined') return;
  channel ??= new BroadcastChannel(CUSTOMER_CHANNEL);
  try { channel.postMessage(state); } catch { /* the screen is gone */ }
}

interface TillBridge { openDrawer(): Promise<unknown>; customerDisplay(open: boolean): Promise<unknown> }
const bridge = (): TillBridge | undefined =>
  typeof window !== 'undefined' ? (window as unknown as { qasaDesktop?: { till?: TillBridge } }).qasaDesktop?.till : undefined;

/** Whether this is the Windows app (the drawer can be opened, the customer screen goes to the second screen). */
export const inWindowsTill = (): boolean => !!bridge();

/** Opens the customer screen: on Windows on the second screen; in a browser, a window the cashier moves there. */
export async function openCustomerScreen(): Promise<boolean> {
  const b = bridge();
  if (b) return (await b.customerDisplay(true).catch(() => false)) === true;
  const w = window.open(`${location.pathname}#/customer-display`, 'qasa-customer-display', 'popup,width=900,height=600');
  return !!w;
}

export type DrawerStatus = 'opened' | 'no_printer' | 'failed' | 'refused' | 'busy' | 'not_here';

/** Opens the cash drawer through this PC's receipt printer (Windows app only). */
export async function kickDrawer(): Promise<DrawerStatus> {
  const b = bridge();
  if (!b) return 'not_here';
  const out = await b.openDrawer().catch(() => null) as { status?: unknown } | null;
  const s = out?.status;
  return s === 'opened' || s === 'no_printer' || s === 'failed' || s === 'refused' || s === 'busy' ? s : 'failed';
}
