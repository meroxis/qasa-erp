import type { Lang } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Generator owners (Pro module): subscribers by amps, a monthly run, collections and debts. Missing (404) without Pro. */

export type GenLine = 'normal' | 'golden';
export type SubscriberStatus = 'active' | 'suspended' | 'ended';
export type GenRunStatus = 'draft' | 'posted' | 'cancelled';
export type GenRunAction = 'edit' | 'post' | 'unpost' | 'cancel';

export interface SubscriberInput {
  name: string; phone?: string; area?: string; route?: string;
  /** amps × 10 (2.5 A → 25) */
  ampsX10: number;
  line: GenLine; startDate?: string | null; notes?: string;
}

export interface SubscriberView {
  partyId: string; code: string; partyCode: string; name: string; phone: string; area: string; route: string;
  ampsX10: number; line: GenLine; status: SubscriberStatus; startDate: string | null; notes: string;
  balance: number; lastBill: number; monthsOwed: number;
}

export interface GenBillView { partyId: string; code: string; name: string; area: string; route: string; ampsX10: number; line: GenLine; amount: number }

export interface GenRunSummary {
  id: string; period: string; date: string; priceNormal: number; priceGolden: number; status: GenRunStatus;
  entry: { id: string; number: string | null; status: string } | null;
  totals: { subscribers: number; ampsX10: Record<GenLine, number>; amount: Record<GenLine, number>; total: number };
  actions: GenRunAction[];
}
export interface GenRunView extends GenRunSummary { bills: GenBillView[] }

export interface CollectionView {
  entryId: string; number: string | null; date: string; partyId: string; code: string; name: string; collector: string;
  amount: number; reversed: boolean; balance: number;
}

export interface GenSummary {
  available: boolean;
  subscribers: Record<SubscriberStatus, number>;
  ampsX10: Record<GenLine, number>;
  period: string; billed: number; collected: number; outstanding: number; owing: number;
  areas: string[]; routes: string[]; collectors: string[];
}

export const generatorsApi = {
  summary: () => request<GenSummary>('GET', '/api/generators/summary'),
  settings: () => request<{ revenueAccount: string }>('GET', '/api/generators/settings'),
  updateSettings: (body: { revenueAccount: string }) => request<{ revenueAccount: string }>('PUT', '/api/generators/settings', body),
  subscribers: (f: { q?: string; status?: SubscriberStatus; area?: string; route?: string } = {}) =>
    request<SubscriberView[]>('GET', '/api/generators/subscribers' + qs(f)),
  subscriber: (id: string) => request<SubscriberView>('GET', `/api/generators/subscribers/${id}`),
  createSubscriber: (input: SubscriberInput) => request<SubscriberView>('POST', '/api/generators/subscribers', input),
  createSubscribers: (subscribers: SubscriberInput[]) => request<SubscriberView[]>('POST', '/api/generators/subscribers/bulk', { subscribers }),
  updateSubscriber: (id: string, input: SubscriberInput & { status?: SubscriberStatus }) => request<SubscriberView>('PUT', `/api/generators/subscribers/${id}`, input),
  setStatus: (id: string, status: SubscriberStatus) => request<SubscriberView>('POST', `/api/generators/subscribers/${id}/status`, { status }),
  debts: (f: { minMonths?: number; area?: string; route?: string } = {}) =>
    request<SubscriberView[]>('GET', '/api/generators/debts' + qs({ minMonths: f.minMonths === undefined ? undefined : String(f.minMonths), area: f.area, route: f.route })),
  runs: () => request<GenRunSummary[]>('GET', '/api/generators/runs'),
  run: (id: string) => request<GenRunView>('GET', `/api/generators/runs/${id}`),
  prepareRun: (body: { period: string; date: string; priceNormal: number; priceGolden: number }) => request<GenRunView>('POST', '/api/generators/runs', body),
  updateRun: (id: string, body: { date?: string; priceNormal?: number; priceGolden?: number }) => request<GenRunView>('PUT', `/api/generators/runs/${id}`, body),
  postRun: (id: string, lang: Lang) => request<GenRunView>('POST', `/api/generators/runs/${id}/post`, { lang }),
  unpostRun: (id: string) => request<GenRunView>('POST', `/api/generators/runs/${id}/unpost`, {}),
  cancelRun: (id: string) => request<void>('DELETE', `/api/generators/runs/${id}`),
  collections: (f: { date?: string; from?: string; to?: string; partyId?: string; collector?: string } = {}) =>
    request<CollectionView[]>('GET', '/api/generators/collections' + qs(f)),
  collect: (body: { partyId: string; date: string; amount: number; cashAccountCode: string; collector?: string; lang: Lang }) =>
    request<CollectionView>('POST', '/api/generators/collections', body),
  collectors: (date: string) => request<{ collector: string; receipts: number; amount: number }[]>('GET', '/api/generators/collectors' + qs({ date }))
};

/** Amps for people: 25 → "2.5". */
export const ampsText = (ampsX10: number) => (ampsX10 % 10 === 0 ? String(ampsX10 / 10) : (ampsX10 / 10).toFixed(1));
/** "2.5" or "٢٫٥" → 25; null when it isn't a number of amps. */
export function parseAmps(text: string): number | null {
  const western = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫,]/g, '.').trim();
  if (!/^\d+(\.\d)?$/.test(western)) return null;
  const v = Math.round(Number(western) * 10);
  return v > 0 && v <= 10000 ? v : null;
}
