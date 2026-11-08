import type { Lang, Names } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Fixed assets and monthly straight-line depreciation (every plan). Amounts in IQD minor units. */

export type AssetCategory = 'land' | 'buildings' | 'machinery' | 'vehicles' | 'tools' | 'furniture' | 'computers';
export type AssetAction = 'edit' | 'editAll' | 'delete' | 'dispose' | 'undispose';
export interface AccountRef { code: string; name: Names }
export interface EntryRef { id: string; number: string | null; status: string }

export interface AssetView {
  id: string;
  code: string;
  name: string;
  category: AssetCategory | null;
  assetAccount: AccountRef;
  accumAccount: AccountRef;
  expenseAccount: AccountRef;
  acquired: string;
  cost: number;
  salvage: number;
  lifeMonths: number;
  openingAccum: number;
  accumulated: number;
  bookValue: number;
  monthly: number;
  depreciated: boolean;
  startMonth: string;
  endMonth: string;
  location: string;
  status: 'active' | 'disposed';
  disposedOn: string | null;
  disposal: { date: string; proceeds: number; proceedsAccount: string | null; gain: number; entry: EntryRef } | null;
  notes: string;
  actions: AssetAction[];
}

export interface ScheduleRow { period: string; amount: number; accumulated: number; bookValue: number; state: 'run' | 'planned' | 'opening' }
export interface AssetDetail extends AssetView { schedule: ScheduleRow[] }

export interface RunLineView { assetId: string; code: string; name: string; category: AssetCategory | null; amount: number }
export interface RunView {
  id: string;
  period: string;
  status: 'posted';
  entry: EntryRef | null;
  total: number;
  lines: RunLineView[];
  createdBy: string;
  createdAt: string;
  /** cancel: the entry is still a draft (deleted); reverse: the entry is approved (a reversal entry is made) */
  actions: ('cancel' | 'reverse')[];
}
export interface PreviewView { period: string; date: string; total: number; lines: RunLineView[]; alreadyRun: boolean }
export interface AssetsSummary { count: number; active: number; cost: number; accumulated: number; bookValue: number; lastRun: string | null; nextPeriod: string }
export interface AssetDefaults {
  categories: { id: AssetCategory; account: string; accountPostable: boolean; lifeMonths: number }[];
  accumAccount: string;
  expenseAccount: string;
  gainAccount: string;
  lossAccount: string;
}

export interface AssetInput {
  name: string;
  /** computers and furniture share account 116: the category tells them apart */
  category?: AssetCategory;
  assetAccount: string;
  accumAccount: string;
  expenseAccount: string;
  acquired: string;
  cost: number;
  salvage?: number;
  lifeMonths: number;
  openingAccum?: number;
  location?: string;
  notes?: string;
}

export interface DisposeInput { date: string; proceeds?: number; proceedsAccount?: string; gainAccount?: string; lossAccount?: string; lang: Lang }

export const assetsApi = {
  summary: () => request<AssetsSummary>('GET', '/api/assets/summary'),
  defaults: () => request<AssetDefaults>('GET', '/api/assets/defaults'),
  list: (f: { status?: 'active' | 'disposed'; q?: string } = {}) => request<AssetView[]>('GET', '/api/assets' + qs(f)),
  get: (id: string) => request<AssetDetail>('GET', `/api/assets/${id}`),
  create: (body: AssetInput) => request<AssetDetail>('POST', '/api/assets', body),
  update: (id: string, body: Partial<AssetInput>) => request<AssetDetail>('PUT', `/api/assets/${id}`, body),
  remove: (id: string) => request<void>('DELETE', `/api/assets/${id}`),
  dispose: (id: string, body: DisposeInput) => request<AssetDetail>('POST', `/api/assets/${id}/dispose`, body),
  /** a draft disposal entry is deleted; an approved one is reversed on `date` (else today) */
  undispose: (id: string, body: { date?: string } = {}) => request<AssetDetail>('POST', `/api/assets/${id}/undispose`, body),
  runs: () => request<RunView[]>('GET', '/api/assets/depreciation'),
  run: (id: string) => request<RunView>('GET', `/api/assets/depreciation/${id}`),
  preview: (period: string) => request<PreviewView>('GET', '/api/assets/depreciation/preview' + qs({ period })),
  runMonth: (period: string, lang: Lang) => request<RunView>('POST', '/api/assets/depreciation', { period, lang }),
  cancelRun: (id: string) => request<void>('POST', `/api/assets/depreciation/${id}/cancel`),
  /** takes back a month whose entry is approved: a reversal entry on `date` (else today), and the month can run again */
  reverseRun: (id: string, body: { date?: string } = {}) => request<void>('POST', `/api/assets/depreciation/${id}/reverse`, body)
};
