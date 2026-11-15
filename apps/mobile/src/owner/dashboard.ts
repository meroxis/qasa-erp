import type { Brief, Money, Names } from '../api';

/**
 * The owner's dashboard on the phone (phone app 1.1): the day's and the month's sales, the cash and banks, who owes the
 * most and what runs low, from the office's brief. An office before phone app 1.1 sends no list of who owes the most:
 * the late customers are shown instead, as phone app 1.0 does.
 */

export interface CashRow { code: string; name: Names; iqd: number; usd: number; base: number }

/** How many rows a list shows before "Show all". */
export const TOP = 5;

/** Each safe and bank (the office leaves out those with nothing), the largest in dinars first; the first five unless all. */
export function cashRows(brief: Pick<Brief, 'cash'>, all = false): { rows: CashRow[]; more: number } {
  const accounts = brief.cash?.accounts ?? [];
  const rows = accounts.map((a) => ({ code: a.code, name: a.name, iqd: a.balance.IQD, usd: a.balance.USD, base: a.base }))
    .sort((a, b) => b.base - a.base || a.code.localeCompare(b.code));
  return { rows: all ? rows : rows.slice(0, TOP), more: all ? 0 : Math.max(0, rows.length - TOP) };
}

export interface DebtorRow { partyId: string; name: string; iqd: number; usd: number; days: number }

/** Who owes the most (an office of phone app 1.1 on), else the late customers (phone app 1.0's list): five at most. */
export function debtors(brief: Pick<Brief, 'topDebtors' | 'lateCustomers'>): { kind: 'top' | 'late'; rows: DebtorRow[] } {
  if (Array.isArray(brief.topDebtors)) {
    return {
      kind: 'top',
      rows: brief.topDebtors.slice(0, TOP).map((d) => ({ partyId: d.partyId, name: d.name, iqd: d.owed?.IQD ?? d.balance, usd: d.owed?.USD ?? 0, days: d.oldestDays }))
    };
  }
  return { kind: 'late', rows: brief.lateCustomers.slice(0, TOP).map((c) => ({ partyId: c.partyId, name: c.name, iqd: c.balance, usd: 0, days: c.oldestDays })) };
}

/** What customers owe in all: in each currency's own money when the office says so, else in dinars. */
export function receivablesOf(brief: Pick<Brief, 'receivables' | 'receivablesOwed'>): Money {
  return brief.receivablesOwed ? { IQD: brief.receivablesOwed.IQD, USD: brief.receivablesOwed.USD } : { IQD: brief.receivables, USD: 0 };
}
