import type { CurrencyCode, Names, UnitCode } from '@qasa/core';
import type { InvoiceView, ItemView, PartyView } from '../api.ts';
import type { CategoryView } from './categories-api.ts';
import type { PosMethod, SaleInput, ShiftView } from './pos-api.ts';

/**
 * The offline till (1.2), on a PC connected to an office server. While the server can't be reached, the till keeps
 * selling from what it last had from it, kept in this window's memory only (never on disk): the items with their prices,
 * units, barcodes, categories and the stock last known, the customers, the payment methods and the open shift.
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
  methods: PosMethod[] | null;
}

let cache: TillCache | null = null;

export function tillCache(who: string | null): TillCache | null {
  return who && cache?.who === who ? cache : null;
}

/** Keeps what the till just had from the server (memory only), for when it can't be reached. */
export function rememberTill(who: string | null, patch: Partial<Omit<TillCache, 'who'>>): void {
  if (!who) return;
  const base: TillCache = cache?.who === who ? cache : { who, shift: null, items: null, customers: null, categories: null, methods: null };
  cache = { ...base, ...patch };
}

export function forgetTill(): void {
  cache = null;
}

/** The methods the till offers while offline: all of the shift's but on a customer's account. */
export const offlineMethods = (methods: readonly PosMethod[]): PosMethod[] => methods.filter((m) => m !== 'account');

/** Why a sale can't be kept for later, or null. */
export function offlineRefusal(sale: Pick<SaleInput, 'payments'>): 'pos_offline_on_account' | null {
  return (sale.payments ?? []).some((p) => p.method === 'account') ? 'pos_offline_on_account' : null;
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
