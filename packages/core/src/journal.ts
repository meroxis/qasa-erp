import { isIsoDate } from './dates.ts';
import { isCurrency, isMinorAmount, toBaseBalanced, type CurrencyCode } from './money.ts';

/** receipt = سند قبض · payment = سند صرف · journal = قيد يومية · reversal = قيد عكسي · sale/purchase = posted by an invoice */
export type EntryType = 'journal' | 'receipt' | 'payment' | 'reversal' | 'sale' | 'purchase';

/**
 * Approval chain used on Iraqi vouchers:
 * draft (المنظم prepares) → checked (المدقق checks) → approved (المصادق approves = posted).
 * Only approved entries affect balances and reports. Approved entries are never
 * edited or deleted; they are corrected with a reversal entry.
 */
export type EntryStatus = 'draft' | 'checked' | 'approved';

export const NUMBER_PREFIX: Record<EntryType, string> = {
  receipt: 'RV',
  payment: 'PV',
  journal: 'JV',
  reversal: 'RJ',
  sale: 'INV',
  purchase: 'PI'
};

export interface LineInput {
  accountCode: string;
  /** Amounts in the entry currency's minor units; exactly one side is > 0. */
  debit: number;
  credit: number;
  description?: string;
  /** Customer or supplier this line belongs to (for their balance and statement). */
  partyId?: string;
  /**
   * Exact IQD amounts for lines whose value is already known in IQD (e.g. cost of goods sold on a USD invoice).
   * When given, the line is not converted with the rate.
   */
  baseDebit?: number;
  baseCredit?: number;
}

export interface EntryInput {
  type: EntryType;
  date: string;
  description: string;
  party?: string;
  currency: CurrencyCode;
  /** IQD per 1 USD × 100; ignored (stored as 100) for IQD entries. */
  rateX100: number;
  lines: LineInput[];
}

export interface LineWithBase extends Omit<LineInput, 'baseDebit' | 'baseCredit'> {
  baseDebit: number;
  baseCredit: number;
}

export type EntryError =
  | { code: 'date_invalid' }
  | { code: 'period_locked'; period: string }
  | { code: 'currency_invalid' }
  | { code: 'rate_invalid' }
  | { code: 'description_required' }
  | { code: 'too_few_lines' }
  | { code: 'line_amount_invalid'; line: number }
  | { code: 'line_both_sides'; line: number }
  | { code: 'line_zero'; line: number }
  | { code: 'account_unknown'; line: number; accountCode: string }
  | { code: 'account_not_postable'; line: number; accountCode: string }
  | { code: 'not_balanced'; debit: number; credit: number };

export interface EntryContext {
  accountExists(code: string): boolean;
  isPostable(code: string): boolean;
  isPeriodLocked(isoDate: string): boolean;
}

export function validateEntry(input: EntryInput, ctx: EntryContext): EntryError[] {
  const errors: EntryError[] = [];
  if (!isIsoDate(input.date)) errors.push({ code: 'date_invalid' });
  else if (ctx.isPeriodLocked(input.date)) errors.push({ code: 'period_locked', period: input.date.slice(0, 7) });
  if (!isCurrency(input.currency)) errors.push({ code: 'currency_invalid' });
  if (input.currency === 'USD' && (!isMinorAmount(input.rateX100) || input.rateX100 <= 0)) errors.push({ code: 'rate_invalid' });
  if (!input.description || !input.description.trim()) errors.push({ code: 'description_required' });
  if (!Array.isArray(input.lines) || input.lines.length < 2) {
    errors.push({ code: 'too_few_lines' });
    return errors;
  }
  let debit = 0;
  let credit = 0;
  input.lines.forEach((line, i) => {
    const n = i + 1;
    if (!isMinorAmount(line.debit) || !isMinorAmount(line.credit) || line.debit < 0 || line.credit < 0) {
      errors.push({ code: 'line_amount_invalid', line: n });
      return;
    }
    if (line.debit > 0 && line.credit > 0) errors.push({ code: 'line_both_sides', line: n });
    if (line.debit === 0 && line.credit === 0) errors.push({ code: 'line_zero', line: n });
    if (!ctx.accountExists(line.accountCode)) errors.push({ code: 'account_unknown', line: n, accountCode: line.accountCode });
    else if (!ctx.isPostable(line.accountCode)) errors.push({ code: 'account_not_postable', line: n, accountCode: line.accountCode });
    debit += line.debit;
    credit += line.credit;
  });
  if (debit !== credit) errors.push({ code: 'not_balanced', debit, credit });
  return errors;
}

/** Adds base-currency (IQD) amounts to each line, keeping the base totals balanced. */
export function withBaseAmounts(input: Pick<EntryInput, 'currency' | 'rateX100' | 'lines'>): LineWithBase[] {
  const rate = input.currency === 'IQD' ? 100 : input.rateX100;
  const convert = input.lines.map((l, i) => (l.baseDebit === undefined || l.baseCredit === undefined ? i : -1)).filter((i) => i >= 0);
  const debits = toBaseBalanced(convert.map((i) => input.lines[i]!.debit), input.currency, rate);
  const credits = toBaseBalanced(convert.map((i) => input.lines[i]!.credit), input.currency, rate);
  return input.lines.map((l, i) => {
    const { baseDebit: explicitDebit, baseCredit: explicitCredit, ...rest } = l;
    const k = convert.indexOf(i);
    return k >= 0
      ? { ...rest, baseDebit: debits[k] ?? 0, baseCredit: credits[k] ?? 0 }
      : { ...rest, baseDebit: explicitDebit ?? 0, baseCredit: explicitCredit ?? 0 };
  });
}

export interface VoucherInput {
  kind: 'receipt' | 'payment';
  date: string;
  /** The safe (قاصة) or bank account the money goes into / out of. */
  cashAccountCode: string;
  party?: string;
  description: string;
  currency: CurrencyCode;
  rateX100: number;
  /** Counter accounts: credited on a receipt voucher, debited on a payment voucher. */
  items: { accountCode: string; amount: number; description?: string; partyId?: string }[];
}

/**
 * Receipt voucher (سند قبض): Dr cash/bank total, Cr each item.
 * Payment voucher (سند صرف): Dr each item, Cr cash/bank total.
 */
export function voucherToEntry(v: VoucherInput): EntryInput {
  const total = v.items.reduce((s, it) => s + (isMinorAmount(it.amount) ? it.amount : 0), 0);
  const cashLine: LineInput = v.kind === 'receipt'
    ? { accountCode: v.cashAccountCode, debit: total, credit: 0, description: v.description }
    : { accountCode: v.cashAccountCode, debit: 0, credit: total, description: v.description };
  const itemLines: LineInput[] = v.items.map((it) => (v.kind === 'receipt'
    ? { accountCode: it.accountCode, debit: 0, credit: it.amount, description: it.description ?? v.description, ...(it.partyId ? { partyId: it.partyId } : {}) }
    : { accountCode: it.accountCode, debit: it.amount, credit: 0, description: it.description ?? v.description, ...(it.partyId ? { partyId: it.partyId } : {}) }));
  const entry: EntryInput = {
    type: v.kind,
    date: v.date,
    description: v.description,
    currency: v.currency,
    rateX100: v.currency === 'IQD' ? 100 : v.rateX100,
    lines: v.kind === 'receipt' ? [cashLine, ...itemLines] : [...itemLines, cashLine]
  };
  if (v.party) entry.party = v.party;
  return entry;
}

/** Lines of the reversal entry: every debit becomes a credit and vice versa. */
export function reverseLines(lines: (LineInput | LineWithBase)[]): LineInput[] {
  return lines.map((l) => ({
    accountCode: l.accountCode,
    debit: l.credit,
    credit: l.debit,
    ...(l.description ? { description: l.description } : {}),
    ...(l.partyId ? { partyId: l.partyId } : {}),
    ...(l.baseDebit !== undefined && l.baseCredit !== undefined ? { baseDebit: l.baseCredit, baseCredit: l.baseDebit } : {})
  }));
}

export type EntryAction = 'check' | 'approve' | 'return' | 'edit' | 'delete' | 'reverse';

/** Which actions are allowed in each status. */
export function allowedActions(status: EntryStatus, opts: { reversed: boolean; isReversal: boolean; fromInvoice?: boolean }): EntryAction[] {
  // Invoice postings are cancelled from the invoice, which also returns the stock.
  if (opts.fromInvoice) return [];
  if (status === 'draft') return ['edit', 'delete', 'check'];
  if (status === 'checked') return ['approve', 'return'];
  return opts.reversed || opts.isReversal ? [] : ['reverse'];
}

export function entryNumber(type: EntryType, year: number, seq: number): string {
  return `${NUMBER_PREFIX[type]}-${year}-${String(seq).padStart(4, '0')}`;
}
