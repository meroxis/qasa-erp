import type { Lang, Names } from '@qasa/core';
import { qs, request, type EntryView } from '../api.ts';

/** The dollar rate board (every plan): the day's rate, its history, and revaluing dollar balances. */

export interface FxRateView { date: string; rateX100: number; source: string | null; createdBy: string; createdAt: string }
export interface FxRateOn { date: string | null; rateX100: number; source: 'board' | 'default' }

export interface FxRevaluationRow {
  accountCode: string;
  accountName: Names;
  partyId: string | null;
  partyName: string | null;
  /** dollar balance in cents, debit positive */
  usd: number;
  carried: number;
  revalued: number;
  difference: number;
  mixed: boolean;
}

export interface FxRevaluation {
  date: string;
  rateX100: number;
  rateSource: 'board' | 'default' | 'given';
  rows: FxRevaluationRow[];
  gains: number;
  losses: number;
  net: number;
}

export const fxApi = {
  rates: (f: { days?: number; to?: string } = {}) =>
    request<FxRateView[]>('GET', '/api/fx/rates' + qs({ days: f.days ? String(f.days) : undefined, to: f.to })),
  /** The rate for a day (the latest on or before it, else the company's default): for prefilling invoices and vouchers. */
  rateOn: (date?: string) => request<FxRateOn>('GET', '/api/fx/rate' + qs({ date })),
  setRate: (body: { date?: string; rateX100: number; source?: string }) => request<FxRateView>('POST', '/api/fx/rates', body),
  deleteRate: (date: string) => request<void>('DELETE', `/api/fx/rates/${date}`),
  revaluation: (f: { date?: string; rateX100?: number } = {}) =>
    request<FxRevaluation>('GET', '/api/fx/revaluation' + qs({ date: f.date, rateX100: f.rateX100 ? String(f.rateX100) : undefined })),
  postRevaluation: (body: { date: string; rateX100?: number; gainAccount?: string; lossAccount?: string; lang: Lang }) =>
    request<EntryView>('POST', '/api/fx/revaluation', body)
};
