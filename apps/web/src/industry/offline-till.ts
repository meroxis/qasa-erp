import type { CurrencyCode, Names, UnitCode } from '@qasa/core';
import { isNetworkError, type InvoiceView, type ItemView, type PartyView, type SendOptions } from '../api.ts';
import type { CategoryView } from './categories-api.ts';
import { holdKey, SALE_TIMEOUT_MS, type HeldKey } from './outbox.ts';
import type { PosMethod, SaleInput, ShiftView } from './pos-api.ts';

/**
 * The offline till (1.2), on a PC connected to an office server. While the server can't be reached, the till keeps
 * selling from what it last had from it, kept in this window's memory only (never on disk): the items with their prices,
 * units, barcodes, categories and the stock last known, the customers and the open shift.
 *
 * The rules (docs/offline-till.md):
 * - cash, card and wallet sales go on; each is kept on this PC (the outbox) and sent when the link is back, once;
 * - a sale on a customer's account (credit) needs the live credit-limit check: online only;
 * - opening and closing a shift, returns and anything else stay online only; a shift can't be closed while sales of
 *   it still wait on this PC;
 * - stock is checked against the last known stock: a sale beyond it is not blocked but said, and the office server
 *   checks it when the sale arrives; a sale it refuses stays in the list for a person, never dropped;
 * - the receipt carries a temporary reference per register (OFF-<register>-0001); the sale gets its invoice number
 *   when it is booked, and both find it afterwards.
 */

export interface TillCache {
  /** whose it is (a user id, or the owner's name without sign-in): another person never sells from it */
  who: string;
  shift: ShiftView | null;
  items: ItemView[] | null;
  customers: PartyView[] | null;
  categories: CategoryView[] | null;
}

let cache: TillCache | null = null;

export function tillCache(who: string | null): TillCache | null {
  return who && cache?.who === who ? cache : null;
}

/** Keeps what the till just had from the server (memory only), for when it can't be reached. */
export function rememberTill(who: string | null, patch: Partial<Omit<TillCache, 'who'>>): void {
  if (!who) return;
  const base: TillCache = cache?.who === who ? cache : { who, shift: null, items: null, customers: null, categories: null };
  cache = { ...base, ...patch };
}

export function forgetTill(): void {
  cache = null;
}

/**
 * Why a sale can't be kept for later, or null: a part on a customer's account (the live credit-limit check), or
 * loyalty points used (the customer's live balance). Both need the server's answer at the till.
 */
export function offlineRefusal(sale: Pick<SaleInput, 'payments' | 'loyaltyPoints'>): 'pos_offline_on_account' | 'pos_offline_loyalty' | null {
  if ((sale.payments ?? []).some((p) => p.method === 'account')) return 'pos_offline_on_account';
  return sale.loyaltyPoints ? 'pos_offline_loyalty' : null;
}

export interface TillLine { item: ItemView; qtyMilli: number; unit: UnitCode | null; unitPrice: number }

/** A line's quantity in its item's base unit (thousandths). */
export function baseQtyOf(line: Pick<TillLine, 'item' | 'qtyMilli' | 'unit'>): number {
  if (!line.unit || line.unit === line.item.unit) return line.qtyMilli;
  const factor = line.item.units.find((u) => u.unit === line.unit)?.factorMilli ?? 1000;
  return Math.round((line.qtyMilli * factor) / 1000);
}

export interface ShortLine { itemId: string; code: string; name: Names; wantMilli: number; haveMilli: number }

/** The items of a sale beyond the stock last known (the server decides when the sale arrives). */
export function shortStock(lines: readonly Pick<TillLine, 'item' | 'qtyMilli' | 'unit'>[]): ShortLine[] {
  const want = new Map<string, { item: ItemView; milli: number }>();
  for (const l of lines) {
    if (!l.item.trackStock) continue;
    const w = want.get(l.item.id) ?? { item: l.item, milli: 0 };
    w.milli += baseQtyOf(l);
    want.set(l.item.id, w);
  }
  return [...want.values()].filter((w) => w.milli > w.item.qtyMilli)
    .map((w) => ({ itemId: w.item.id, code: w.item.code, name: w.item.name, wantMilli: w.milli, haveMilli: w.item.qtyMilli }));
}

/** The stock last known, less what a sale kept on this PC took. */
export function takeFromStock(items: readonly ItemView[], lines: readonly Pick<TillLine, 'item' | 'qtyMilli' | 'unit'>[]): ItemView[] {
  const taken = new Map<string, number>();
  for (const l of lines) if (l.item.trackStock) taken.set(l.item.id, (taken.get(l.item.id) ?? 0) + baseQtyOf(l));
  return items.map((it) => (taken.has(it.id) ? { ...it, qtyMilli: it.qtyMilli - taken.get(it.id)! } : it));
}

const lineTotal = (l: Pick<TillLine, 'qtyMilli' | 'unitPrice'>) => Math.round((l.qtyMilli * l.unitPrice) / 1000);
const blank: Names = { ar: '', en: '', ku: '' };

/**
 * The receipt of a sale kept on this PC: shaped as the invoice the server will make, numbered with the temporary
 * reference (its invoice number follows when it is booked).
 */
export function offlineReceipt(input: {
  key: string; reference: string; soldAt: string; soldOn: string; shift: Pick<ShiftView, 'warehouseId' | 'cashAccountCode'>; cashier: string;
  lines: readonly TillLine[]; currency: CurrencyCode; rateX100: number; discount: number;
  party: Pick<PartyView, 'id' | 'code' | 'name' | 'phone' | 'address'> | null; payments: readonly { method: PosMethod; amount: number }[];
}): InvoiceView {
  const subtotal = input.lines.reduce((s, l) => s + lineTotal(l), 0);
  const total = Math.max(0, subtotal - input.discount);
  const factorOf = (l: TillLine) => (l.unit && l.unit !== l.item.unit ? l.item.units.find((u) => u.unit === l.unit)?.factorMilli ?? null : null);
  return {
    id: input.key, kind: 'sale', status: 'posted', number: input.reference, date: input.soldOn,
    partyId: input.party?.id ?? null, partyCode: input.party?.code ?? null, partyName: input.party?.name ?? null,
    warehouseId: input.shift.warehouseId, currency: input.currency, rateX100: input.currency === 'IQD' ? 100 : input.rateX100,
    payment: 'cash', cashAccountCode: input.shift.cashAccountCode, discount: input.discount, subtotal, total,
    baseTotal: input.currency === 'IQD' ? total : Math.round((total * input.rateX100) / 100), notes: '', returnOf: null,
    createdBy: input.cashier, createdAt: input.soldAt,
    partyPhone: input.party?.phone ?? null, partyAddress: input.party?.address ?? null, warehouseCode: '', warehouseName: blank, cashAccountName: null,
    entryId: null, entryNumber: null, cancelEntryId: null, cancelEntryNumber: null, postedBy: input.cashier, postedAt: input.soldAt,
    cancelledBy: null, cancelledAt: null,
    lines: input.lines.map((l, i) => ({
      lineNo: i + 1, itemId: l.item.id, itemCode: l.item.code, itemName: l.item.name, unit: l.item.unit, trackStock: l.item.trackStock,
      description: '', qtyMilli: baseQtyOf(l), unitPrice: l.unitPrice, amount: lineTotal(l), cost: null, sourceLine: null,
      returnedQtyMilli: 0, returnedAmount: 0, lineUnit: l.unit, unitFactorMilli: factorOf(l), unitQtyMilli: l.unit ? l.qtyMilli : null,
      batchNo: null, expiry: null, batchId: null
    })),
    actions: [], returnOfNumber: null, returns: [], installmentContract: null,
    payments: input.payments.map((p, i) => ({
      id: `${input.key}-${i}`, kind: 'pos', method: p.method, accountCode: '', amount: p.amount, currency: input.currency,
      reference: null, source: null, entryId: null, entryNumber: null, entryStatus: null, createdAt: input.soldAt
    })),
    offlineRef: input.reference
  };
}

/** How a Pay ended: booked (the server's answer), kept on this PC, or sent with no answer back (it may be booked). */
export type TillPay<R> =
  | { kind: 'sold'; result: R }
  | { kind: 'kept' }
  /** `error`: why it could not be kept on this PC either (null: a sale that can't be kept, on a customer's account) */
  | { kind: 'unsure'; error: unknown };

/**
 * One Pay of a till sale. Without an outbox (a browser, the office server PC itself) as before 1.2: no key, the till
 * waits for the answer. On a PC with an outbox the sale is sent with the key held for it (holdKey), the same on every
 * Pay of the same sale until one is confirmed, so a try whose answer was lost is answered by the server from the first
 * and booked once. A sale that can be kept on the PC gives up after SALE_TIMEOUT_MS and is kept (sent later with that
 * key). One that can't (a part on a customer's account) waits for the server's answer, as before 1.2; if the link goes
 * anyway, or keeping fails, the result is unknown ('unsure'), never reported as not booked: Pay again finds it.
 * `hold` is told the key every time it changes (the page keeps it with the cart, and drops it when the cart is cleared).
 */
export async function payTillSale<R>(input: {
  sale: SaleInput;
  /** an outbox on this PC: the key held for the sale being paid (null: none yet), and whether to keep it at once */
  outbox: { held: HeldKey | null; hold(held: HeldKey): void; keepFirst: boolean } | null;
  send(body: SaleInput, options: SendOptions): Promise<R>;
  /** keeps it on this PC with this key (throws when it can't) */
  keep(body: SaleInput, key: string): Promise<void>;
  /** stock past its expiry date: true when the cashier confirmed selling it (the company allows it) */
  askExpired(error: unknown): Promise<boolean>;
}): Promise<TillPay<R>> {
  const { allowExpired: _asked, ...sale } = input.sale;
  const box = input.outbox;
  if (!box) {
    try {
      return { kind: 'sold', result: await input.send(sale, {}) };
    } catch (e) {
      if (!(await input.askExpired(e))) throw e;
      return { kind: 'sold', result: await input.send({ ...sale, allowExpired: true }, {}) };
    }
  }
  let held = holdKey(box.held, sale);
  const hold = (next: HeldKey) => { held = next; box.hold(next); };
  hold(held);
  const body = (): SaleInput => (held.allowExpired ? { ...sale, allowExpired: true } : sale);
  // offline, or this person's earlier sales still wait (they go first): kept here, nothing sent now
  if (box.keepFirst) {
    await input.keep(body(), held.key);
    return { kind: 'kept' };
  }
  const canKeep = !offlineRefusal(sale);
  const options: SendOptions = { key: held.key, ...(canKeep ? { timeoutMs: SALE_TIMEOUT_MS } : {}) };
  const lost = async (): Promise<TillPay<R>> => {
    hold({ ...held, lost: true });
    if (!canKeep) return { kind: 'unsure', error: null };
    try {
      await input.keep(body(), held.key);
      return { kind: 'kept' };
    } catch (e) {
      return { kind: 'unsure', error: e };
    }
  };
  try {
    return { kind: 'sold', result: await input.send(body(), options) };
  } catch (e) {
    if (isNetworkError(e)) return lost();
    if (held.allowExpired || !(await input.askExpired(e))) throw e;
  }
  // confirmed: from now on this sale goes with it, also on the next Pay (the server compares the whole body)
  hold({ ...held, allowExpired: true });
  try {
    return { kind: 'sold', result: await input.send(body(), options) };
  } catch (e) {
    if (isNetworkError(e)) return lost();
    throw e;
  }
}
