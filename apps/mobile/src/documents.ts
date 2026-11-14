import type { Currency, Item, Party } from './api';
import { parseNumber } from './i18n';

/**
 * What the phone sends the office, built here from what was picked on the screens: a sale (a draft invoice), an
 * order (a quote), a receipt from a customer (a draft receipt voucher) and counts. Money is in whole minor units
 * (dinars, cents), quantities in thousandths, as the office keeps them; nothing is ever a fraction of a minor unit.
 */

export interface CartLine { item: Item; qty: number }
export interface CountLine { item: Item; qty: number }

/** The most of one thing on a line, and the most money typed (a slip of the thumb must not become a billion). */
export const MAX_QTY = 1_000_000;
export const MAX_AMOUNT = { IQD: 10_000_000_000, USD: 1_000_000_000 } as const;

export const toMilli = (qty: number) => Math.round(qty * 1000);

/** A typed quantity (Arabic-Indic digits too), or null when it isn't one above zero. */
export function readQty(text: string): number | null {
  const n = parseNumber(text.trim());
  return Number.isFinite(n) && n > 0 && n <= MAX_QTY && toMilli(n) > 0 ? toMilli(n) / 1000 : null;
}

/** A typed amount in minor units: dinars whole, dollars to the cent; null when it isn't one above zero. */
export function readAmount(text: string, currency: Currency): number | null {
  const n = parseNumber(text.trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  const decimals = (String(text.trim()).split(/[.٫]/)[1] ?? '').length;
  if (decimals > (currency === 'USD' ? 2 : 0)) return null;
  const minor = Math.round(n * (currency === 'USD' ? 100 : 1));
  return minor > 0 && minor <= MAX_AMOUNT[currency] ? minor : null;
}

/** The same item again adds to its line; a new one goes on top. */
export function addLine(lines: CartLine[], item: Item, qty: number): CartLine[] {
  const existing = lines.find((l) => l.item.id === item.id);
  return existing ? lines.map((l) => (l.item.id === item.id ? { ...l, qty: Math.min(MAX_QTY, toMilli(l.qty + qty) / 1000) } : l)) : [{ item, qty }, ...lines];
}

/** A count line is set, not added: the latest count of an item is the one that counts. */
export const setCount = (lines: CountLine[], item: Item, qty: number): CountLine[] => [{ item, qty }, ...lines.filter((l) => l.item.id !== item.id)];

export const lineAmount = (l: CartLine) => Math.round(l.item.salePrice * l.qty);

/** One sale is in one currency: the first line's. The other currency's lines wait for their own sale. */
export const cartCurrency = (lines: CartLine[]): Currency => lines.at(-1)?.item.saleCurrency ?? lines[0]?.item.saleCurrency ?? 'IQD';
export const linesIn = (lines: CartLine[], currency: Currency) => lines.filter((l) => l.item.saleCurrency === currency);
export const total = (lines: CartLine[]) => lines.reduce((sum, l) => sum + lineAmount(l), 0);

export interface SaleInput {
  lines: CartLine[];
  currency: Currency;
  date: string;
  warehouseId: string;
  customer: Pick<Party, 'id'> | null;
  /** one way for the whole sale, as on the desktop's till and invoice (1.4): paid now in cash, or on credit */
  payment: Payment;
  cashAccount: string;
  rateX100: number;
  notes: string;
}

export type Payment = 'cash' | 'credit';

/** Credit needs a customer: whose account the sale goes on. */
export const paymentReady = (payment: Payment, customer: Pick<Party, 'id'> | null) => payment === 'cash' || !!customer;

/**
 * A draft sale invoice, cash or on credit as a whole (never part of each). Cash goes into the safe, with the customer
 * named when one was chosen; credit goes on the chosen customer's account.
 */
export function saleBody(s: SaleInput) {
  if (!paymentReady(s.payment, s.customer)) throw new Error('credit needs a customer');
  return {
    kind: 'sale' as const, date: s.date, warehouseId: s.warehouseId, currency: s.currency, rateX100: s.currency === 'IQD' ? 100 : s.rateX100,
    payment: s.payment, ...(s.customer ? { partyId: s.customer.id } : {}), ...(s.payment === 'cash' ? { cashAccountCode: s.cashAccount } : {}),
    discount: 0, notes: s.notes.slice(0, 1000),
    lines: s.lines.map((l) => ({ itemId: l.item.id, qtyMilli: toMilli(l.qty), unitPrice: l.item.salePrice }))
  };
}

/** An order for a customer: a quote, which the office turns into an invoice when it is delivered. */
export function orderBody(s: Omit<SaleInput, 'warehouseId' | 'cashAccount' | 'rateX100' | 'payment'> & { customer: Pick<Party, 'id'>; names: (i: Item) => string }) {
  return {
    date: s.date, partyId: s.customer.id, currency: s.currency, discount: 0, notes: s.notes.slice(0, 2000),
    lines: s.lines.map((l) => ({ itemId: l.item.id, description: s.names(l.item).slice(0, 500), qtyMilli: toMilli(l.qty), unitPrice: l.item.salePrice }))
  };
}

/**
 * Money received from a customer: a receipt voucher (cash in, the customer's account credited), prepared in the name of the
 * phone's user (POST /api/vouchers, which a Qasa ERP 1.4.1 office already opens to phones). The
 * office decides whether it is in the books at once, by the 1.4.1 rule: with "Vouchers need approval" on, only for a
 * user who may approve vouchers (never under "Separate duties"); everyone else's waits for approval. With the setting
 * off it is a draft, checked and approved on the PC.
 */
export function receiptBody(r: {
  customer: Pick<Party, 'id' | 'name'> & { accountCode: string }; amount: number; currency: Currency; rateX100: number; cashAccount: string;
  date: string; description: string; note: string;
}) {
  return {
    kind: 'receipt' as const, date: r.date, cashAccountCode: r.cashAccount, party: r.customer.name.slice(0, 200),
    description: [r.description, r.note.trim()].filter(Boolean).join(' — ').slice(0, 500), currency: r.currency,
    rateX100: r.currency === 'IQD' ? 100 : r.rateX100,
    items: [{ accountCode: r.customer.accountCode, amount: r.amount, partyId: r.customer.id }]
  };
}

export { receiptPosted } from './outbox';

/** Counted quantities for the warehouse's open count on the PC. */
export const countSessionBody = (lines: CountLine[]) => ({ counts: lines.map((l) => ({ itemId: l.item.id, countedMilli: toMilli(l.qty) })) });

/** A count kept for the admin in Settings → Phones (when no count is open on the PC). */
export const countListBody = (warehouseId: string | null, lines: CountLine[], names: (i: Item) => string) => ({
  warehouseId, lines: lines.map((l) => ({ itemId: l.item.id, code: l.item.code, name: names(l.item), qty: l.qty }))
});
