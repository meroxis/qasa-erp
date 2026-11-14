import { toBase, toWesternDigits, type CurrencyCode } from '@qasa/core';
import type { EntryView, Permission } from '../api.ts';

/**
 * 1.4, "Receive payment" and "Pay supplier": what the short form works out before it asks the server (which decides
 * everything again: who may, the amounts, and whether the voucher is posted or waits).
 */

export type QuickKind = 'receipt' | 'payment';

/** "1420", "1,420.50" or "١٤٢٠" as dinars per dollar × 100; null when it is not a rate. */
export function parseRateText(text: string): number | null {
  const s = toWesternDigits(text).replace(/[,٬\s]/g, '').replace('٫', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const value = Math.round(Number(s) * 100);
  return value > 0 ? value : null;
}

/** The amount in dinars at the voucher's rate (a party's balance is kept in dinars); null while it can't be worked out. */
export function amountInIqd(amount: number | null, currency: CurrencyCode, rateX100: number | null): number | null {
  if (amount === null || amount <= 0) return null;
  if (currency === 'IQD') return amount;
  return rateX100 ? toBase(amount, 'USD', rateX100) : null;
}

/**
 * What is left on the party's account once the voucher is posted: a receipt lowers what a customer owes, a payment
 * what we owe a supplier (both balances are kept in the party's own direction). Below zero: paid more than was owed.
 */
export function balanceAfter(balance: number, amount: number | null, currency: CurrencyCode, rateX100: number | null): number | null {
  const iqd = amountInIqd(amount, currency, rateX100);
  return iqd === null ? null : balance - iqd;
}

/** Who sees the button: sales people receive, purchasing pays, and whoever prepares vouchers does both. */
export function mayQuickVoucher(kind: QuickKind, permissions: readonly Permission[] | undefined): boolean {
  if (!permissions) return false;
  return permissions.includes('entries.prepare') || permissions.includes(kind === 'receipt' ? 'sales' : 'purchases');
}

/** How the voucher came back: posted (numbered), waiting for approval, or a draft for the usual checking and approval. */
export function quickOutcome(entry: Pick<EntryView, 'status' | 'approval'>): 'posted' | 'waiting' | 'draft' {
  if (entry.status === 'approved') return 'posted';
  return entry.approval?.state === 'waiting' ? 'waiting' : 'draft';
}
