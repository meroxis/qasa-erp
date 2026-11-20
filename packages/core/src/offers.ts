import { allocateDiscount } from './inventory.ts';
import { roundHalfUp, type CurrencyCode } from './money.ts';
import { isIsoDate } from './dates.ts';
import type { Names } from './lang.ts';

/**
 * Offers (1.7, Starter and up): promotions a sale gets by itself, at the till and on a sale invoice.
 *
 * - buyGet: buy `buyMilli` of the offer's goods and get `getMilli` (of the same goods, or of the "get" goods) free or
 *   at `getPercent` % off. The cheapest units are the ones given.
 * - bundle: any `bundleMilli` of the offer's goods for `bundlePrice` (mix and match). The dearest units go in first.
 * - price: a special price for the offer's goods: `price` per base unit, or `percentOff` % off.
 *
 * Quantities are in thousandths of the item's base unit (a carton line counts its pieces). Fixed amounts (a bundle's
 * price, a special price) are in dinars; a dollar sale has them at its rate. Each unit sold takes at most one offer:
 * offers are tried by priority (higher first, then by code), and one marked exclusive applies only when nothing else
 * has, and then alone. `maxPerSale` caps how many times a buyGet or bundle applies, or how much (thousandths) a special
 * price covers. The server works the result out again from the stored offers: the till's figure is only a preview.
 */

export type OfferKind = 'buyGet' | 'bundle' | 'price';
export const OFFER_KINDS: readonly OfferKind[] = ['buyGet', 'bundle', 'price'];

export interface OfferRule {
  id: string;
  code: string;
  names: Names;
  kind: OfferKind;
  priority: number;
  exclusive: boolean;
  maxPerSale: number | null;
  startsOn: string | null;
  endsOn: string | null;
  /** 0 = Sunday … 6 = Saturday; null = every day */
  weekdays: number[] | null;
  /** "HH:MM" (24 h); both or neither. From after To runs past midnight. To is not included. */
  fromTime: string | null;
  toTime: string | null;
  /** null = every branch */
  branchIds: string[] | null;
  /** the goods the offer is on (a buyGet's "buy" side): items and/or categories */
  items: string[];
  categories: string[];
  /** buyGet: the goods given; both empty = the same goods as bought */
  getItems: string[];
  getCategories: string[];
  buyMilli: number | null;
  getMilli: number | null;
  /** 1–100: 100 is free */
  getPercent: number | null;
  bundleMilli: number | null;
  bundlePrice: number | null;
  price: number | null;
  percentOff: number | null;
}

export interface OfferLine {
  lineNo: number;
  itemId: string;
  categoryId: string | null;
  qtyMilli: number;
  /** the line's amount before any discount, in the sale's currency */
  amount: number;
}

export interface OfferContext {
  date: string;
  /** minutes after midnight when the sale is made; null = not known (an offer limited to hours does not apply) */
  minutes: number | null;
  /** the branch of the sale's warehouse (null: none) */
  branchId: string | null;
  currency: CurrencyCode;
  rateX100: number;
}

export interface OfferAllocation { offerId: string; lineNo: number; qtyMilli: number; discount: number }

export interface OfferResult {
  allocations: OfferAllocation[];
  /** discount per line number */
  byLine: Record<number, number>;
  /** discount per offer, in the order they applied */
  offers: { offerId: string; discount: number }[];
  total: number;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function timeMinutes(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

/** Minutes after midnight of a moment, on this computer's clock. */
export function minutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Whether an offer is on for a sale made then and there. */
export function offerActive(rule: OfferRule, ctx: Pick<OfferContext, 'date' | 'minutes' | 'branchId'>): boolean {
  if (rule.startsOn && ctx.date < rule.startsOn) return false;
  if (rule.endsOn && ctx.date > rule.endsOn) return false;
  if (rule.weekdays && rule.weekdays.length && !rule.weekdays.includes(weekdayOf(ctx.date))) return false;
  if (rule.branchIds && rule.branchIds.length && (!ctx.branchId || !rule.branchIds.includes(ctx.branchId))) return false;
  if (rule.fromTime && rule.toTime) {
    if (ctx.minutes === null) return false;
    const from = timeMinutes(rule.fromTime);
    const to = timeMinutes(rule.toTime);
    const m = ctx.minutes;
    if (from < to ? !(m >= from && m < to) : !(m >= from || m < to)) return false;
  }
  return true;
}

/** A dinar amount in the sale's currency. */
function inCurrency(iqd: number, ctx: Pick<OfferContext, 'currency' | 'rateX100'>): number {
  return ctx.currency === 'IQD' ? iqd : roundHalfUp((iqd * 10000) / ctx.rateX100);
}

interface Slot { line: OfferLine; left: number; taken: number }

/** What taking `q` more of a line is worth: shares that add up to the line's amount once all of it is taken. */
function portion(s: Slot, q: number): number {
  const before = roundHalfUp((s.line.amount * s.taken) / s.line.qtyMilli);
  const after = roundHalfUp((s.line.amount * (s.taken + q)) / s.line.qtyMilli);
  return after - before;
}

function matches(line: OfferLine, items: readonly string[], categories: readonly string[]): boolean {
  return items.includes(line.itemId) || (!!line.categoryId && categories.includes(line.categoryId));
}

const unitPrice = (s: Slot) => s.line.amount / s.line.qtyMilli;

/** Takes `qty` from the slots in the order given; null when there isn't enough (nothing is changed then). */
function take(slots: Slot[], qty: number, used: Map<Slot, number>): { slot: Slot; q: number }[] | null {
  const parts: { slot: Slot; q: number }[] = [];
  let need = qty;
  for (const s of slots) {
    const avail = s.left - (used.get(s) ?? 0);
    if (avail <= 0) continue;
    const q = Math.min(avail, need);
    parts.push({ slot: s, q });
    need -= q;
    if (need === 0) break;
  }
  if (need > 0) return null;
  for (const p of parts) used.set(p.slot, (used.get(p.slot) ?? 0) + p.q);
  return parts;
}

/** Commits parts taken: each slot's quantity goes down, and the discount is booked line by line. */
function commit(parts: { slot: Slot; q: number }[], discounts: number[], offerId: string, out: OfferAllocation[]): number {
  let sum = 0;
  parts.forEach((p, i) => {
    const d = discounts[i] ?? 0;
    p.slot.left -= p.q;
    p.slot.taken += p.q;
    if (d > 0 || p.q > 0) out.push({ offerId, lineNo: p.slot.line.lineNo, qtyMilli: p.q, discount: d });
    sum += d;
  });
  return sum;
}

function runRule(rule: OfferRule, slots: Slot[], ctx: OfferContext, out: OfferAllocation[]): number {
  const own = slots.filter((s) => s.left > 0 && matches(s.line, rule.items, rule.categories));
  if (!own.length) return 0;
  const cheapest = (list: Slot[]) => [...list].sort((a, b) => unitPrice(a) - unitPrice(b) || a.line.lineNo - b.line.lineNo);
  const dearest = (list: Slot[]) => [...list].sort((a, b) => unitPrice(b) - unitPrice(a) || a.line.lineNo - b.line.lineNo);
  const max = rule.maxPerSale ?? Number.MAX_SAFE_INTEGER;
  let total = 0;

  if (rule.kind === 'buyGet') {
    const buy = rule.buyMilli ?? 0;
    const get = rule.getMilli ?? 0;
    const pct = rule.getPercent ?? 100;
    if (buy <= 0 || get <= 0) return 0;
    const sameGoods = !rule.getItems.length && !rule.getCategories.length;
    const getPool = sameGoods ? own : slots.filter((s) => s.left > 0 && matches(s.line, rule.getItems, rule.getCategories));
    for (let n = 0; n < max; n++) {
      const used = new Map<Slot, number>();
      const given = take(cheapest(getPool), get, used);
      if (!given) break;
      const bought = take(dearest(own), buy, used);
      if (!bought) break;
      // what is given, at its share of the line, less the percentage
      const discounts = given.map((p) => roundHalfUp((portion(p.slot, p.q) * pct) / 100));
      // (portion() reads `taken`, so the given goods are booked before the bought ones)
      total += commit(given, discounts, rule.id, out);
      total += commit(bought, bought.map(() => 0), rule.id, out);
    }
    return total;
  }

  if (rule.kind === 'bundle') {
    const size = rule.bundleMilli ?? 0;
    if (size <= 0 || rule.bundlePrice === null) return 0;
    const price = inCurrency(rule.bundlePrice, ctx);
    for (let n = 0; n < max; n++) {
      const used = new Map<Slot, number>();
      const parts = take(dearest(own), size, used);
      if (!parts) break;
      // shares worked out on a copy, so a set that is not worth it leaves nothing behind
      const gross = sharesOf(parts);
      const sum = gross.reduce((s, g) => s + g, 0);
      if (sum <= price) break;
      total += commit(parts, allocateDiscount(gross, sum - price), rule.id, out);
    }
    return total;
  }

  // a special price
  let room = max;
  for (const s of own) {
    if (room <= 0) break;
    const q = Math.min(s.left, room);
    const gross = portion(s, q);
    let d = 0;
    if (rule.percentOff !== null) d = roundHalfUp((gross * rule.percentOff) / 100);
    else if (rule.price !== null) d = Math.max(0, gross - roundHalfUp((inCurrency(rule.price, ctx) * q) / 1000));
    if (d <= 0) continue;
    total += commit([{ slot: s, q }], [Math.min(d, gross)], rule.id, out);
    room -= q;
  }
  return total;
}

/** The amounts of parts taken from the same slots in turn (a slot may come twice: its shares follow on). */
function sharesOf(parts: { slot: Slot; q: number }[]): number[] {
  const extra = new Map<Slot, number>();
  return parts.map((p) => {
    const before = extra.get(p.slot) ?? 0;
    const s = { ...p.slot, taken: p.slot.taken + before };
    extra.set(p.slot, before + p.q);
    return portion(s, p.q);
  });
}

export function orderRules(rules: readonly OfferRule[]): OfferRule[] {
  return [...rules].sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code));
}

/** The offers a sale gets: `rules` are every offer that is switched on; those not on now are left out here. */
export function applyOffers(lines: readonly OfferLine[], rules: readonly OfferRule[], ctx: OfferContext): OfferResult {
  const slots: Slot[] = lines.filter((l) => l.qtyMilli > 0 && l.amount > 0).map((line) => ({ line, left: line.qtyMilli, taken: 0 }));
  const allocations: OfferAllocation[] = [];
  const offers: { offerId: string; discount: number }[] = [];
  let anyApplied = false;
  for (const rule of orderRules(rules.filter((r) => offerActive(r, ctx)))) {
    if (rule.exclusive && anyApplied) continue;
    const out: OfferAllocation[] = [];
    const before = slots.map((s) => ({ left: s.left, taken: s.taken }));
    const d = runRule(rule, slots, ctx, out);
    if (d <= 0) {
      // nothing given: the goods it counted stay free for the next offer
      slots.forEach((s, i) => { s.left = before[i]!.left; s.taken = before[i]!.taken; });
      continue;
    }
    allocations.push(...out);
    offers.push({ offerId: rule.id, discount: d });
    anyApplied = true;
    if (rule.exclusive) break;
  }
  const byLine: Record<number, number> = {};
  for (const a of allocations) byLine[a.lineNo] = (byLine[a.lineNo] ?? 0) + a.discount;
  return { allocations, byLine, offers, total: offers.reduce((s, o) => s + o.discount, 0) };
}

/** Each line's offer discount, summed per line and offer (what a sale keeps: invoice_offer_lines). */
export function offerLineRows(result: OfferResult): { lineNo: number; offerId: string; qtyMilli: number; discount: number }[] {
  const map = new Map<string, { lineNo: number; offerId: string; qtyMilli: number; discount: number }>();
  for (const a of result.allocations) {
    const key = `${a.lineNo}|${a.offerId}`;
    const row = map.get(key) ?? { lineNo: a.lineNo, offerId: a.offerId, qtyMilli: 0, discount: 0 };
    row.qtyMilli += a.qtyMilli;
    row.discount += a.discount;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.lineNo - b.lineNo || a.offerId.localeCompare(b.offerId));
}

export type OfferError = { code: string; field?: string };

const posInt = (v: unknown, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= max;

/** Checks an offer as it is saved (the server also checks that its items, categories and branches exist). */
export function offerRuleErrors(r: Omit<OfferRule, 'id'>): OfferError[] {
  const e: OfferError[] = [];
  if (!/^[\p{L}\p{N}_-]{1,24}$/u.test(r.code ?? '')) e.push({ code: 'offer_code_invalid', field: 'code' });
  if (!r.names || !['ar', 'en', 'ku'].some((k) => (r.names[k as keyof Names] ?? '').trim())) e.push({ code: 'offer_name_required', field: 'names' });
  if (!OFFER_KINDS.includes(r.kind)) e.push({ code: 'offer_kind_invalid', field: 'kind' });
  if (!Number.isSafeInteger(r.priority) || r.priority < 0 || r.priority > 1000) e.push({ code: 'offer_priority_invalid', field: 'priority' });
  if (r.maxPerSale !== null && !posInt(r.maxPerSale, 100_000_000)) e.push({ code: 'offer_max_invalid', field: 'maxPerSale' });
  if (r.startsOn !== null && !isIsoDate(r.startsOn)) e.push({ code: 'offer_dates_invalid', field: 'startsOn' });
  if (r.endsOn !== null && !isIsoDate(r.endsOn)) e.push({ code: 'offer_dates_invalid', field: 'endsOn' });
  if (r.startsOn && r.endsOn && isIsoDate(r.startsOn) && isIsoDate(r.endsOn) && r.endsOn < r.startsOn) e.push({ code: 'offer_dates_invalid', field: 'endsOn' });
  if (r.weekdays !== null && (!Array.isArray(r.weekdays) || !r.weekdays.length || r.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) {
    e.push({ code: 'offer_weekdays_invalid', field: 'weekdays' });
  }
  if ((r.fromTime === null) !== (r.toTime === null) || (r.fromTime !== null && (!TIME.test(r.fromTime) || !TIME.test(r.toTime!) || r.fromTime === r.toTime))) {
    e.push({ code: 'offer_hours_invalid', field: 'fromTime' });
  }
  if (!r.items.length && !r.categories.length) e.push({ code: 'offer_goods_required', field: 'items' });
  if (r.kind === 'buyGet') {
    if (!posInt(r.buyMilli, 1_000_000_000)) e.push({ code: 'offer_qty_invalid', field: 'buyMilli' });
    if (!posInt(r.getMilli, 1_000_000_000)) e.push({ code: 'offer_qty_invalid', field: 'getMilli' });
    if (!posInt(r.getPercent, 100)) e.push({ code: 'offer_percent_invalid', field: 'getPercent' });
  } else if (r.kind === 'bundle') {
    if (!posInt(r.bundleMilli, 1_000_000_000)) e.push({ code: 'offer_qty_invalid', field: 'bundleMilli' });
    if (!posInt(r.bundlePrice)) e.push({ code: 'offer_price_invalid', field: 'bundlePrice' });
  } else if (r.kind === 'price') {
    const fixed = r.price !== null;
    const pct = r.percentOff !== null;
    if (fixed === pct) e.push({ code: 'offer_price_or_percent', field: 'price' });
    else if (fixed && !(Number.isSafeInteger(r.price) && r.price! >= 0)) e.push({ code: 'offer_price_invalid', field: 'price' });
    else if (pct && !posInt(r.percentOff, 100)) e.push({ code: 'offer_percent_invalid', field: 'percentOff' });
  }
  return e;
}
