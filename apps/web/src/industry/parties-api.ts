import type { CurrencyCode } from '@qasa/core';
import { qs, request, type PartyType, type PartyView } from '../api.ts';

/**
 * 1.4, Customers and Suppliers: what each one owes in plain words, the total above the list, "only those who owe" and
 * the biggest debt first. The server filters, sorts and totals (packages/server/src/parties.ts).
 */

export type PartySort = 'code' | 'debt';

/** Each currency's own amounts: dinars in dinars, dollars in cents. */
export type PartyAmounts = Record<CurrencyCode, number>;

export interface PartyTotals {
  type: PartyType;
  /** in the type's own direction: what customers owe us, or what we owe suppliers */
  owed: PartyAmounts;
  /** the other way: what customers paid ahead, or what was paid ahead to suppliers */
  advance: PartyAmounts;
  owing: number;
  advanced: number;
}

export const partiesApi = {
  list: (f: { type: PartyType; q?: string; owing?: boolean; sort?: PartySort }) =>
    request<PartyView[]>('GET', '/api/parties' + qs({ type: f.type, q: f.q || undefined, owing: f.owing ? 'true' : undefined, sort: f.sort === 'debt' ? 'debt' : undefined })),
  /** null from a server older than 1.4 (an office PC not yet updated): the list still shows, without the line above it */
  totals: (type: PartyType) => request<PartyTotals>('GET', '/api/parties/totals' + qs({ type })).catch(() => null)
};

/** One amount a party owes, or is owed, in one currency. */
export interface OweLine {
  /** 'owes': in the type's own direction (a customer owes us, we owe a supplier); 'advance': the other way */
  side: 'owes' | 'advance';
  amount: number;
  currency: CurrencyCode;
}

/**
 * A party's balance as lines to show: each currency on its own, as the app keeps them (dinars in dinars, dollars in
 * dollars). A server from before 1.1 gives only the IQD total, which is then the one line.
 */
export function oweLines(party: Pick<PartyView, 'balance' | 'balances'>): OweLine[] {
  const own = party.balances;
  const amounts: [CurrencyCode, number][] = own ? [['IQD', own.IQD], ['USD', own.USD]] : [['IQD', party.balance]];
  return amounts.filter(([, n]) => n !== 0).map(([currency, n]) => ({ side: n > 0 ? 'owes' : 'advance', amount: Math.abs(n), currency }));
}

/**
 * The words for a line: who owes whom. For a customer, 'owes' is "Owes us" and 'advance' is "We owe him"; for a
 * supplier it is the other way round.
 */
export function oweWords(type: PartyType, side: OweLine['side']): 's14_owesUs' | 's14_weOwe' {
  return (type === 'customer') === (side === 'owes') ? 's14_owesUs' : 's14_weOwe';
}

/** Money that is ours to collect reads as a warning (amber); money we owe reads as a debt of ours (red for a supplier's, calm blue for an advance). */
export function oweTone(type: PartyType, side: OweLine['side']): 'warn' | 'bad' | 'info' | 'ok' {
  if (type === 'customer') return side === 'owes' ? 'warn' : 'info';
  return side === 'owes' ? 'bad' : 'ok';
}
