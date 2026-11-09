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
  /** A line of a year-end closing entry (or of its reversal): left out of that year's own result. */
  closing?: boolean;
}

export interface TrialBalanceRow {
  code: string;
  /** Balance brought forward: every posted line dated before From, as one Dr or Cr figure. */
  openingDebit: number;
  openingCredit: number;
  /** Movement inside the period (From to To). */
  debit: number;
  credit: number;
  /** Balance at To (opening + movement), as one Dr or Cr figure. */
  closingDebit: number;
  closingCredit: number;
  /** Closing balance on the account's normal side (debit accounts: debit − credit), opening included. */
  balance: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  openingDebitTotal: number;
  openingCreditTotal: number;
  /** Movement totals of the period. */
  totalDebit: number;
  totalCredit: number;
  /** Closing balances presented in two columns, as Iraqi trial balances usually are. */
  balanceDebitTotal: number;
  balanceCreditTotal: number;
}

const split = (net: number) => (net > 0 ? { dr: net, cr: 0 } : { dr: 0, cr: 0 - net });

/** The code a period whose From is later than its To is refused with. */
export const DATE_RANGE_REVERSED = 'date_range_reversed';

/** A period whose From is later than its To (ISO dates; an open end never is). */
export function isReversedRange(from: string | undefined, to: string | undefined): boolean {
  return !!from && !!to && from > to;
}

/** A report asked for with From later than To: its figures would mean nothing, so none are made. */
export class DateRangeError extends Error {
  readonly code = DATE_RANGE_REVERSED;
  constructor(readonly from: string, readonly to: string) {
    super(`From (${from}) is later than To (${to})`);
    this.name = 'DateRangeError';
  }
}

/**
 * Trial balance (ميزان المراجعة) of postable accounts in the six-column layout: opening (lines before `from`),
 * movement (lines from `from` to `to`) and closing balance (lines up to `to`), each as debit and credit.
 * Without `from` every line up to `to` is movement and the opening is empty. A closed year's closing entry is dated
 * on its last day, so the next year opens with revenue and expense accounts at zero and the result in the reserves.
 * Throws DateRangeError when `from` is later than `to`.
 */
export function trialBalance(lines: PostedLine[], opts: { from?: string; to?: string } = {}): TrialBalance {
  if (isReversedRange(opts.from, opts.to)) throw new DateRangeError(opts.from!, opts.to!);
  const sums = new Map<string, { opening: number; debit: number; credit: number }>();
  for (const l of lines) {
    if (opts.to && l.date > opts.to) continue;
    const s = sums.get(l.accountCode) ?? { opening: 0, debit: 0, credit: 0 };
    if (opts.from && l.date < opts.from) s.opening += l.debit - l.credit;
    else {
      s.debit += l.debit;
      s.credit += l.credit;
    }
    sums.set(l.accountCode, s);
  }
  const rows: TrialBalanceRow[] = [...sums.entries()]
    .map(([code, s]) => {
      const opening = split(s.opening);
      const net = s.opening + s.debit - s.credit;
      const closing = split(net);
      return {
        code,
        openingDebit: opening.dr, openingCredit: opening.cr,
        debit: s.debit, credit: s.credit,
        closingDebit: closing.dr, closingCredit: closing.cr,
        balance: natureOf(code) === 'debit' ? net : 0 - net
      };
    })
    .filter((r) => r.openingDebit !== 0 || r.openingCredit !== 0 || r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => (a.code < b.code ? -1 : 1));
  const total = (key: keyof Omit<TrialBalanceRow, 'code'>) => rows.reduce((s, r) => s + r[key], 0);
  return {
    rows,
    openingDebitTotal: total('openingDebit'),
    openingCreditTotal: total('openingCredit'),
    totalDebit: total('debit'),
    totalCredit: total('credit'),
    balanceDebitTotal: total('closingDebit'),
    balanceCreditTotal: total('closingCredit')
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
