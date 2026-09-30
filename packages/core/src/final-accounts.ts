import { natureOf } from './accounts.ts';
import type { PostedLine } from './reports.ts';

/**
 * Final accounts (الحسابات الختامية) in the order of the Iraqi Unified Accounting System:
 * the trading account, the current operations account, the profit and loss account and the balance sheet.
 * Everything is in IQD (base currency) and built from posted entries only.
 */

/** One row of an account section: a group of the chart (with its sub-accounts), or a subtotal. */
export interface FinalRow {
  /** Stable id; the app shows it by name ("fa_<id>"). */
  id: string;
  kind: 'line' | 'subtotal';
  /** A line adds to the result (revenue, +1) or is taken away from it (cost, −1); subtotals are +1. */
  sign: 1 | -1;
  /** Chart groups summed into a line (e.g. ["42"]). */
  groups: string[];
  /** Positive = adds to the result, negative = takes away (a loss or an expense shown as a positive number). */
  amount: number;
  /** Postable accounts behind a line, with their amounts on the same footing. */
  details: { code: string; amount: number }[];
}

export interface FinalSection {
  id: 'trading' | 'operations' | 'profitLoss';
  rows: FinalRow[];
}

export interface BalanceGroup {
  /** Two-digit chart group ("11", "26" …) */
  code: string;
  amount: number;
  details: { code: string; amount: number }[];
}

export interface FinalAccounts {
  from: string;
  to: string;
  sections: FinalSection[];
  /** Net profit (loss when negative) of the period. */
  netResult: number;
  balanceSheet: {
    assets: BalanceGroup[];
    liabilities: BalanceGroup[];
    /** Profit or loss of everything before `from` that has not been closed into reserves. */
    priorResult: number;
    /** The period's result not yet closed into reserves: netResult, or 0 once the year-end closing moved it. */
    currentResult: number;
    totalAssets: number;
    totalLiabilities: number;
  };
}

type Step =
  | { id: string; add: string[] } // revenue groups: credit − debit
  | { id: string; less: string[] } // expense groups: debit − credit, taken away
  | { id: string; subtotal: true };

const SECTIONS: { id: FinalSection['id']; steps: Step[] }[] = [
  {
    id: 'trading',
    steps: [
      { id: 'sales42', add: ['42'] },
      { id: 'costOfSales35', less: ['35'] },
      { id: 'grossTrading', subtotal: true }
    ]
  },
  {
    id: 'operations',
    steps: [
      { id: 'production41', add: ['41'] },
      { id: 'services43', add: ['43'] },
      { id: 'workForOthers44', add: ['44'] },
      { id: 'ownAssets45', add: ['45'] },
      { id: 'productionValue', subtotal: true },
      { id: 'commodity32', less: ['32'] },
      { id: 'service33', less: ['33'] },
      { id: 'contracts34', less: ['34'] },
      { id: 'grossValueAdded', subtotal: true },
      { id: 'depreciation37', less: ['37'] },
      { id: 'netValueAdded', subtotal: true },
      { id: 'subsidies47', add: ['47'] },
      { id: 'wages31', less: ['31'] },
      { id: 'interestRent36', less: ['36'] },
      { id: 'operatingSurplus', subtotal: true }
    ]
  },
  {
    id: 'profitLoss',
    steps: [
      { id: 'interestIncome46', add: ['46'] },
      { id: 'transferRevenue48', add: ['48'] },
      { id: 'otherRevenue49', add: ['49', '4'] }, // '4': any revenue account outside 41–49
      { id: 'transferExpenses38', less: ['38'] },
      { id: 'otherExpenses39', less: ['39', '3'] }, // '3': any expense account outside 31–39
      { id: 'netResult', subtotal: true }
    ]
  }
];

/** The listed groups, most specific first, so "3" only catches what no two-digit group took. */
const RESULT_GROUPS = SECTIONS.flatMap((s) => s.steps.flatMap((st) => ('add' in st ? st.add : 'less' in st ? st.less : [])))
  .sort((a, b) => b.length - a.length);

function groupOf(code: string, groups: string[]): string | undefined {
  return groups.find((g) => code.startsWith(g));
}

/** Net movement per postable account (debit − credit) over the lines that pass `keep`. */
function netByAccount(lines: PostedLine[], keep: (l: PostedLine) => boolean): Map<string, number> {
  const net = new Map<string, number>();
  for (const l of lines) {
    if (!keep(l)) continue;
    net.set(l.accountCode, (net.get(l.accountCode) ?? 0) + l.debit - l.credit);
  }
  return net;
}

function sorted(details: Map<string, number>): { code: string; amount: number }[] {
  return [...details.entries()].filter(([, v]) => v !== 0).map(([code, amount]) => ({ code, amount })).sort((a, b) => (a.code < b.code ? -1 : 1));
}

/** Profit (+) or loss (−) of revenue (4) and expense (3) accounts in `net`. */
function resultOf(net: Map<string, number>): number {
  let result = 0;
  for (const [code, value] of net) if (code.startsWith('3') || code.startsWith('4')) result -= value;
  return result;
}

export function finalAccounts(lines: PostedLine[], opts: { from: string; to: string }): FinalAccounts {
  const { from, to } = opts;
  // the year-end closing entry empties the revenue and expense accounts; the year's own result leaves it out
  const period = netByAccount(lines, (l) => l.date >= from && l.date <= to && !l.closing);

  // each postable result account belongs to exactly one line
  const byGroup = new Map<string, Map<string, number>>();
  for (const [code, value] of period) {
    if (!code.startsWith('3') && !code.startsWith('4')) continue;
    const group = groupOf(code, RESULT_GROUPS);
    if (!group) continue;
    const m = byGroup.get(group) ?? new Map<string, number>();
    m.set(code, value);
    byGroup.set(group, m);
  }

  let running = 0;
  const sections: FinalSection[] = SECTIONS.map((section) => ({
    id: section.id,
    rows: section.steps.map((step): FinalRow => {
      if ('subtotal' in step) return { id: step.id, kind: 'subtotal', sign: 1, groups: [], amount: running, details: [] };
      const groups = 'add' in step ? step.add : step.less;
      // revenue lines show credit − debit; expense lines show debit − credit (a positive cost)
      const sign = 'add' in step ? -1 : 1;
      const details = new Map<string, number>();
      for (const g of groups) for (const [code, value] of byGroup.get(g) ?? []) details.set(code, sign * value);
      const amount = [...details.values()].reduce((s, v) => s + v, 0);
      running += 'add' in step ? amount : -amount;
      return { id: step.id, kind: 'line', sign: 'add' in step ? 1 : -1, groups, amount, details: sorted(details) };
    })
  }));
  const netResult = running;

  // balance sheet at `to`: every posted line up to that day
  const cumulative = netByAccount(lines, (l) => l.date <= to);
  const before = netByAccount(lines, (l) => l.date < from);
  const side = (cls: '1' | '2'): BalanceGroup[] => {
    const groups = new Map<string, Map<string, number>>();
    for (const [code, value] of cumulative) {
      if (!code.startsWith(cls)) continue;
      const g = code.slice(0, 2);
      const m = groups.get(g) ?? new Map<string, number>();
      m.set(code, natureOf(code) === 'debit' ? value : -value);
      groups.set(g, m);
    }
    return [...groups.entries()]
      .map(([code, m]) => ({ code, amount: [...m.values()].reduce((s, v) => s + v, 0), details: sorted(m) }))
      .filter((g) => g.amount !== 0 || g.details.length > 0)
      .sort((a, b) => (a.code < b.code ? -1 : 1));
  };
  const assets = side('1');
  const liabilities = side('2');
  // closings count here: a closed year's result is in the reserves (class 2), no longer in revenue and expenses
  const priorResult = resultOf(before);
  const currentResult = resultOf(netByAccount(lines, (l) => l.date >= from && l.date <= to));
  const totalAssets = assets.reduce((s, g) => s + g.amount, 0);
  const totalLiabilities = liabilities.reduce((s, g) => s + g.amount, 0) + priorResult + currentResult;

  return { from, to, sections, netResult, balanceSheet: { assets, liabilities, priorResult, currentResult, totalAssets, totalLiabilities } };
}
