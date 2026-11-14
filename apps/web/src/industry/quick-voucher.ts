import { toBase, toWesternDigits, type CurrencyCode } from '@qasa/core';
import type { EntryView, Permission, VoucherApprovalState } from '../api.ts';

/**
 * 1.4, "Receive payment" and "Pay supplier": what the short form works out before it asks the server (which decides
 * everything again: who may, the amounts, and whether the voucher is posted or waits).
 */

export type QuickKind = 'receipt' | 'payment';

/** What the form opens with. */
export interface QuickVoucherPreset {
  /** the customer or supplier (left out on the vouchers list: chosen in the form) */
  partyId?: string;
  /** an invoice the money is for: its number goes in the note, what is still open on it and its currency in the amount */
  invoice?: { number: string | null; total: number; currency: CurrencyCode; rateX100: number };
  /**
   * a voucher of this user's that was not posted (it was rejected, or still waits), to correct and send again: the
   * form opens with what it said, and saving takes the old one back as the new one is made
   */
  again?: { id: string; amount: number; currency: CurrencyCode; rateX100: number; cashAccountCode: string | null; date: string; note: string };
}

/**
 * Whether the dollar rate is filled from the rate board for the form's date, as the header and the voucher screen do.
 * A dollar invoice keeps its own rate, and a voucher sent again the rate it had.
 */
export function boardRateFills(preset: QuickVoucherPreset): boolean {
  return preset.invoice?.currency !== 'USD' && preset.again?.currency !== 'USD';
}

/**
 * The amount after the currency buttons are pressed: kept for the same currency, emptied for the other one. The number
 * is in the currency's smallest unit, so 250,000 dinars read as dollars would be $2,500.00: the amount is typed again.
 */
export function amountAfterCurrency(amount: number | null, from: CurrencyCode, to: CurrencyCode): number | null {
  return from === to ? amount : null;
}

/**
 * The note of a voucher made for an invoice. The invoice's number is put in as it is written on the invoice, whatever
 * digits the user reads in: the note is saved, and other people read, print and search it.
 */
export function invoiceNote(t: (key: 's14_forInvoice', vars: Record<string, string>) => string, number: string): string {
  return t('s14_forInvoice', { n: '{n}' }).replace('{n}', number);
}

/**
 * What is still open on a credit invoice, to start the amount from: its total less what was paid online and less the
 * goods already returned on it (never below zero). Money given back in cash for a return is not told apart here, so
 * the figure can only be too low, never above what the invoice still carries; it is a start, typed over freely.
 */
export function invoiceOpen(v: { total: number; paidOnline?: number; lines: readonly { returnedAmount: number }[] }): number {
  const returned = v.lines.reduce((sum, l) => sum + (l.returnedAmount || 0), 0);
  const open = v.total - (v.paidOnline ?? 0) - returned;
  return Number.isFinite(open) && open > 0 ? open : 0;
}

/**
 * The line under the balances when the voucher will not be posted as it is saved: "Remaining after" is then what the
 * balance becomes once it is approved, not now. With "Vouchers need approval" on it waits; off, it is a draft for the
 * usual checking and approval. Nothing when it is posted at once (or the server has not answered).
 */
export function quickNotice(approval: VoucherApprovalState | null): 's14_willWait' | 's14_willDraft' | null {
  if (!approval) return null;
  // a server that does not say: only the waiting it always told
  if (approval.postsAtOnce === undefined) return approval.on && !approval.mayApprove ? 's14_willWait' : null;
  if (approval.postsAtOnce) return null;
  return approval.on ? 's14_willWait' : 's14_willDraft';
}

/**
 * Whether the person signed in takes this voucher back themselves: a receipt or payment they prepared, of a kind they
 * may prepare, still a draft (it waits, was rejected, or nobody checked it yet). Someone who has the usual Delete uses
 * that. The server decides again: its own preparer, and not approved.
 */
export function mayWithdrawOwn(
  entry: Pick<EntryView, 'type' | 'status' | 'actions' | 'preparedById'>, userKey: string | undefined, permissions: readonly Permission[] | undefined
): boolean {
  if (entry.type !== 'receipt' && entry.type !== 'payment') return false;
  if (entry.status !== 'draft' || entry.actions.includes('delete')) return false;
  return !!entry.preparedById && userKey === `user:${entry.preparedById}` && mayQuickVoucher(entry.type, permissions);
}

/**
 * The short form opened again with what a voucher said, to correct it and send it again. Null when it is not one the
 * short form makes (one customer or supplier, one amount, a safe or bank).
 */
export function againPreset(
  e: Pick<EntryView, 'id' | 'type' | 'lines' | 'total' | 'currency' | 'rateX100' | 'cashAccountCode' | 'date' | 'description' | 'party'>
): QuickVoucherPreset | null {
  if (e.type !== 'receipt' && e.type !== 'payment') return null;
  const parties = [...new Set(e.lines.map((l) => l.partyId).filter((id): id is string => !!id))];
  if (parties.length !== 1 || e.total <= 0) return null;
  return {
    partyId: parties[0]!,
    again: {
      id: e.id, amount: e.total, currency: e.currency, rateX100: e.rateX100, cashAccountCode: e.cashAccountCode, date: e.date,
      // the server writes the party's name when no note was typed
      note: e.description === e.party ? '' : e.description
    }
  };
}

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
