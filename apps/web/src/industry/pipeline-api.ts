import type { CurrencyCode } from '@qasa/core';
import { qs, request } from '../api.ts';

/** The sales pipeline (Pro module): leads and deals. Missing (404) in builds without Pro. */

export type Stage = 'lead' | 'contacted' | 'quoted' | 'negotiating' | 'won' | 'lost';
export type DealAction = 'edit' | 'move' | 'win' | 'lose' | 'reopen' | 'delete';
export const STAGES: readonly Stage[] = ['lead', 'contacted', 'quoted', 'negotiating', 'won', 'lost'];
export const OPEN_STAGES: readonly Stage[] = ['lead', 'contacted', 'quoted', 'negotiating'];

type Money = { IQD: number; USD: number };

export interface DealInput {
  title: string; partyId?: string | null; contactName?: string; phone?: string; source?: string; currency: CurrencyCode; value?: number;
  expectedDate?: string | null; nextStep?: string; nextDate?: string | null; owner?: string; quoteId?: string | null; notes?: string; stage?: Stage;
}
export interface DealView {
  id: string; title: string; party: { id: string; code: string; name: string; phone: string } | null; name: string; contactName: string; phone: string;
  source: string; stage: Stage; currency: CurrencyCode; value: number; expectedDate: string | null; nextStep: string; nextDate: string | null; late: boolean;
  owner: string; quote: { id: string; number: string; status: string; total: number | null } | null; lostReason: string; notes: string;
  createdBy: string; createdAt: string; updatedAt: string; closedAt: string | null; actions: DealAction[];
}
export interface PipelineSummaryView {
  available: boolean; open: number; openValue: Money; byStage: Record<Stage, { count: number; value: Money }>; late: number;
  month: { won: number; lost: number; winRate: number | null; wonValue: Money }; owners: string[];
}

export const pipelineApi = {
  summary: () => request<PipelineSummaryView>('GET', '/api/pipeline/summary'),
  deals: (f: { stage?: Stage | 'open'; owner?: string; q?: string } = {}) => request<DealView[]>('GET', '/api/pipeline/deals' + qs(f)),
  deal: (id: string) => request<DealView>('GET', `/api/pipeline/deals/${id}`),
  create: (input: DealInput) => request<DealView>('POST', '/api/pipeline/deals', input),
  update: (id: string, patch: Partial<Omit<DealInput, 'stage'>>) => request<DealView>('PUT', `/api/pipeline/deals/${id}`, patch),
  move: (id: string, stage: Stage) => request<DealView>('POST', `/api/pipeline/deals/${id}/move`, { stage }),
  won: (id: string, body: { date?: string; value?: number } = {}) => request<DealView>('POST', `/api/pipeline/deals/${id}/won`, body),
  lost: (id: string, reason: string) => request<DealView>('POST', `/api/pipeline/deals/${id}/lost`, { reason }),
  reopen: (id: string) => request<DealView>('POST', `/api/pipeline/deals/${id}/reopen`, {}),
  remove: (id: string) => request<void>('DELETE', `/api/pipeline/deals/${id}`)
};
