import type { CurrencyCode, Names } from '@qasa/core';
import { qs, request, type EntryView } from '../api.ts';

/** Banking: safes, banks and e-wallets, transfers, cheques (every plan) and bank reconciliation (Pro). */

export const WALLET_KINDS = ['bank', 'zaincash', 'fib', 'qi', 'asiahawala', 'wallet'] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];
export type MoneyKind = 'safe' | WalletKind;
type Money = Record<CurrencyCode, number>;

export interface MoneyAccountView {
  code: string;
  name: Names;
  kind: MoneyKind;
  currency: CurrencyCode | null;
  /** approved entries only, per currency, debit positive */
  balance: Money;
  base: number;
  /** entries touching it that wait for approval */
  pending: number;
}

export type ChequeDirection = 'received' | 'issued';
export type ChequeStatus = 'in_hand' | 'deposited' | 'cleared' | 'bounced' | 'cancelled' | 'pending';
export type ChequeAction = 'deposit' | 'clear' | 'bounce' | 'cancel';
interface EntryRef { id: string; number: string | null; status: string }

export interface ChequeView {
  id: string;
  direction: ChequeDirection;
  number: string;
  bank: string;
  party: { id: string; name: string; phone: string | null };
  currency: CurrencyCode;
  amount: number;
  issueDate: string;
  dueDate: string;
  daysToDue: number;
  status: ChequeStatus;
  bankAccount: { code: string; name: Names } | null;
  entry: EntryRef | null;
  clearEntry: EntryRef | null;
  bounceEntry: EntryRef | null;
  notes: string;
  createdBy: string;
  createdAt: string;
  actions: ChequeAction[];
}

export interface ChequeSummary {
  inHand: Money;
  inHandCount: number;
  issuedPending: Money;
  issuedPendingCount: number;
  dueToday: number;
  dueThisWeek: number;
  overdue: number;
}

export interface ChequeInput {
  direction: ChequeDirection;
  number: string;
  bank: string;
  partyId: string;
  currency: CurrencyCode;
  rateX100?: number;
  amount: number;
  issueDate: string;
  dueDate: string;
  bankAccount?: string;
  notes?: string;
}

export interface ChequeFilters {
  direction?: ChequeDirection;
  status?: ChequeStatus | 'open';
  due?: 'today' | 'week' | 'overdue';
  q?: string;
}

export interface StatementLineInput { date: string; description: string; reference?: string; amount: number }

export interface StatementLineView {
  seq: number;
  date: string;
  description: string;
  reference: string;
  amount: number;
  entry: { id: string; number: string | null; date: string; status: string } | null;
}

export interface BookLine { entryId: string; number: string | null; date: string; description: string; amount: number; matched: boolean }

export interface StatementView {
  id: string;
  account: { code: string; name: Names };
  currency: CurrencyCode;
  from: string;
  to: string;
  opening: number;
  closing: number;
  status: 'open' | 'reconciled';
  lines: StatementLineView[];
  book: BookLine[];
  bookBalance: number;
  difference: number;
  unmatchedLines: number;
  unmatchedLinesSum: number;
  unmatchedBook: number;
  unmatchedBookSum: number;
  canReconcile: boolean;
  createdBy: string;
  createdAt: string;
}

export interface StatementSummary { id: string; accountCode: string; from: string; to: string; closing: number; status: 'open' | 'reconciled'; lines: number; matched: number }

export const bankingApi = {
  accounts: () => request<{ accounts: MoneyAccountView[]; reconciliation: boolean }>('GET', '/api/banking/accounts'),
  addAccount: (body: { name: Names; kind: WalletKind; currency: CurrencyCode | null }) => request<MoneyAccountView>('POST', '/api/banking/accounts', body),
  setAccount: (code: string, body: { kind: MoneyKind; currency: CurrencyCode | null }) => request<MoneyAccountView>('PUT', `/api/banking/accounts/${encodeURIComponent(code)}`, body),
  transfer: (body: { date: string; from: string; to: string; currency: CurrencyCode; rateX100?: number; amount: number; charge?: number; chargeAccount?: string; description?: string }) =>
    request<EntryView>('POST', '/api/banking/transfers', body),

  cheques: (f: ChequeFilters = {}) => request<ChequeView[]>('GET', '/api/banking/cheques' + qs({ direction: f.direction, status: f.status, due: f.due, q: f.q })),
  cheque: (id: string) => request<ChequeView>('GET', `/api/banking/cheques/${encodeURIComponent(id)}`),
  chequeSummary: () => request<ChequeSummary>('GET', '/api/banking/cheques/summary'),
  addCheque: (body: ChequeInput) => request<ChequeView>('POST', '/api/banking/cheques', body),
  deposit: (id: string, body: { bankAccount: string; date?: string }) => request<ChequeView>('POST', `/api/banking/cheques/${encodeURIComponent(id)}/deposit`, body),
  clear: (id: string, body: { date: string; bankAccount?: string; rateX100?: number }) => request<ChequeView>('POST', `/api/banking/cheques/${encodeURIComponent(id)}/clear`, body),
  bounce: (id: string, body: { date: string; fee?: number; feeAccount?: string; reason?: string }) => request<ChequeView>('POST', `/api/banking/cheques/${encodeURIComponent(id)}/bounce`, body),
  cancelCheque: (id: string, body: { date?: string; reason?: string }) => request<ChequeView>('POST', `/api/banking/cheques/${encodeURIComponent(id)}/cancel`, body),

  statements: (accountCode?: string) => request<StatementSummary[]>('GET', '/api/banking/statements' + qs({ accountCode })),
  statement: (id: string) => request<StatementView>('GET', `/api/banking/statements/${encodeURIComponent(id)}`),
  addStatement: (body: { accountCode: string; currency: CurrencyCode; from: string; to: string; opening: number; closing: number; lines: StatementLineInput[] }) =>
    request<StatementView>('POST', '/api/banking/statements', body),
  autoMatch: (id: string) => request<{ matched: number; statement: StatementView }>('POST', `/api/banking/statements/${encodeURIComponent(id)}/auto-match`),
  match: (id: string, seq: number, entryId: string | null) => request<StatementView>('POST', `/api/banking/statements/${encodeURIComponent(id)}/lines/${seq}/match`, { entryId }),
  voucherFromLine: (id: string, seq: number, body: { accountCode: string; partyId?: string; description?: string; rateX100?: number }) =>
    request<StatementView>('POST', `/api/banking/statements/${encodeURIComponent(id)}/lines/${seq}/voucher`, body),
  reconcile: (id: string) => request<StatementView>('POST', `/api/banking/statements/${encodeURIComponent(id)}/reconcile`),
  deleteStatement: (id: string) => request<void>('DELETE', `/api/banking/statements/${encodeURIComponent(id)}`)
};
