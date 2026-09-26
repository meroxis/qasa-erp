import { natureOf, type Account } from './accounts.ts';

/** A line of an approved (posted) entry, in base currency. */
export interface PostedLine {
  entryId: string;
  number: string;
  date: string;
  accountCode: string;
  debit: number;
  credit: number;
  description: string;
}

export interface TrialBalanceRow {
  code: string;
  debit: number;
  credit: number;
  /** Closing balance on the account's normal side (debit accounts: debit − credit). */
  balance: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  /** Balances presented in two columns, as Iraqi trial balances usually are. */
  balanceDebitTotal: number;
  balanceCreditTotal: number;
}

function inRange(date: string, from?: string, to?: string): boolean {
  return (!from || date >= from) && (!to || date <= to);
}

/** Trial balance (ميزان المراجعة) of postable accounts for the lines dated up to `to` (and from `from`, if given). */
export function trialBalance(lines: PostedLine[], opts: { from?: string; to?: string } = {}): TrialBalance {
  const sums = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
    if (!inRange(l.date, opts.from, opts.to)) continue;
    const s = sums.get(l.accountCode) ?? { debit: 0, credit: 0 };
    s.debit += l.debit;
    s.credit += l.credit;
    sums.set(l.accountCode, s);
  }
  const rows = [...sums.entries()]
    .map(([code, s]) => ({ code, debit: s.debit, credit: s.credit, balance: natureOf(code) === 'debit' ? s.debit - s.credit : s.credit - s.debit }))
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => (a.code < b.code ? -1 : 1));
  let balanceDebitTotal = 0;
  let balanceCreditTotal = 0;
  for (const r of rows) {
    const net = r.debit - r.credit;
    if (net > 0) balanceDebitTotal += net;
    else balanceCreditTotal += -net;
  }
  return {
    rows,
    totalDebit: rows.reduce((s, r) => s + r.debit, 0),
    totalCredit: rows.reduce((s, r) => s + r.credit, 0),
    balanceDebitTotal,
    balanceCreditTotal
  };
}

export interface StatementRow extends PostedLine {
  /** Running balance on the account's normal side. */
  balance: number;
}

export interface AccountStatement {
  accountCode: string;
  opening: number;
  rows: StatementRow[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

/**
 * Account statement (كشف حساب). Includes lines of the account and all its sub-accounts.
 * Lines before `from` are summed into the opening balance.
 */
export function accountStatement(accountCode: string, lines: PostedLine[], opts: { from?: string; to?: string } = {}): AccountStatement {
  const sign = natureOf(accountCode) === 'debit' ? 1 : -1;
  const own = lines
    .filter((l) => l.accountCode.startsWith(accountCode) && (!opts.to || l.date <= opts.to))
    .sort((a, b) => (a.date === b.date ? (a.number < b.number ? -1 : 1) : a.date < b.date ? -1 : 1));
  let opening = 0;
  const rows: StatementRow[] = [];
  let running = 0;
  for (const l of own) {
    const delta = sign * (l.debit - l.credit);
    if (opts.from && l.date < opts.from) {
      opening += delta;
      continue;
    }
    if (rows.length === 0) running = opening;
    running += delta;
    rows.push({ ...l, balance: running });
  }
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  return { accountCode, opening, rows, totalDebit, totalCredit, closing: opening + sign * (totalDebit - totalCredit) };
}

/** Balance of every account including its sub-accounts (for the chart-of-accounts tree). */
export function rollupBalances(accounts: Pick<Account, 'code'>[], lines: PostedLine[]): Map<string, number> {
  const leafNet = new Map<string, number>();
  for (const l of lines) leafNet.set(l.accountCode, (leafNet.get(l.accountCode) ?? 0) + l.debit - l.credit);
  const result = new Map<string, number>();
  for (const a of accounts) {
    let net = 0;
    for (const [code, value] of leafNet) if (code.startsWith(a.code)) net += value;
    result.set(a.code, natureOf(a.code) === 'debit' ? net : -net);
  }
  return result;
}
