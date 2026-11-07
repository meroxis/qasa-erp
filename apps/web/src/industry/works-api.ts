import type { CurrencyCode, Lang } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Engineering works (Pro module): job orders, quotes, deposits, costs and billing. Missing (404) in builds without Pro. */

export type JobCategory = 'welding' | 'steel' | 'aluminium' | 'mdf' | 'openings' | 'electrical' | 'solar' | 'general';
export type JobStatus = 'quote' | 'measuring' | 'approved' | 'fabricating' | 'installing' | 'done' | 'invoiced' | 'cancelled';
export type LineUnit = 'm2' | 'm' | 'piece' | 'kg' | 'set' | 'lump';
export type CostCategory = 'materials' | 'labour' | 'subcontract' | 'transport' | 'other';
export type JobAction = 'edit' | 'editLines' | 'deposit' | 'invoice' | 'cancel' | 'costs';

export const JOB_CATEGORIES: readonly JobCategory[] = ['welding', 'steel', 'aluminium', 'mdf', 'openings', 'electrical', 'solar', 'general'];
export const JOB_FLOW: readonly JobStatus[] = ['quote', 'measuring', 'approved', 'fabricating', 'installing', 'done'];
export const LINE_UNITS: readonly LineUnit[] = ['m2', 'm', 'piece', 'kg', 'set', 'lump'];
export const COST_CATEGORIES: readonly CostCategory[] = ['materials', 'labour', 'subcontract', 'transport', 'other'];

export interface JobLineInput { description: string; unit: LineUnit; qtyMilli: number; unitPrice: number }
export interface JobLineView extends JobLineInput { seq: number; amount: number }

export interface JobSummaryView {
  id: string; number: string; date: string;
  party: { id: string; code: string; name: string; phone: string };
  title: string; category: JobCategory; site: string; currency: CurrencyCode; status: JobStatus; dueDate: string | null; assignedTo: string;
  subtotal: number; discount: number; total: number; paid: number; remaining: number;
  /** IQD */
  costs: number; revenue: number | null; profit: number | null;
  invoice: { id: string; number: string | null } | null;
  overdue: boolean;
}

export interface JobView extends JobSummaryView {
  party: JobSummaryView['party'] & { address: string };
  notes: string;
  lines: JobLineView[];
  receipts: { entryId: string; number: string | null; date: string; amount: number; reversed: boolean; by: string }[];
  costLines: {
    id: string; category: CostCategory; amount: number; description: string; createdBy: string; createdAt: string;
    document: { kind: 'invoice' | 'entry'; id: string; number: string | null; date: string };
  }[];
  createdBy: string; createdAt: string;
  actions: JobAction[];
  moves: JobStatus[];
}

export interface JobInput {
  date: string; partyId: string; title: string; category: JobCategory; site?: string; currency: CurrencyCode;
  dueDate?: string | null; assignedTo?: string; notes?: string; discount?: number; lines?: JobLineInput[];
}

export interface LinkableDocView { kind: 'invoice' | 'entry'; id: string; number: string | null; date: string; party: string; description: string; amount: number; free: number }

export interface WorksSummaryView {
  available: boolean;
  open: number;
  byStatus: Record<JobStatus, number>;
  inProgress: { IQD: number; USD: number };
  toCollect: { IQD: number; USD: number };
  overdue: number;
  month: { jobs: number; revenue: number; costs: number; profit: number };
}

export type JobFilter = JobStatus | 'open' | 'overdue';

export const worksApi = {
  summary: () => request<WorksSummaryView>('GET', '/api/works/summary'),
  jobs: (f: { status?: JobFilter; category?: JobCategory; partyId?: string; q?: string } = {}) => request<JobSummaryView[]>('GET', '/api/works/jobs' + qs(f)),
  job: (id: string) => request<JobView>('GET', `/api/works/jobs/${id}`),
  create: (input: JobInput) => request<JobView>('POST', '/api/works/jobs', input),
  update: (id: string, patch: Partial<JobInput>) => request<JobView>('PUT', `/api/works/jobs/${id}`, patch),
  move: (id: string, status: JobStatus) => request<JobView>('POST', `/api/works/jobs/${id}/move`, { status }),
  cancel: (id: string, reason: string) => request<JobView>('POST', `/api/works/jobs/${id}/cancel`, reason ? { reason } : {}),
  deposit: (id: string, body: { date: string; amount: number; cashAccountCode: string; rateX100?: number; lang: Lang }) =>
    request<JobView>('POST', `/api/works/jobs/${id}/deposit`, body),
  invoice: (id: string, body: { date: string; rateX100?: number }) => request<JobView>('POST', `/api/works/jobs/${id}/invoice`, body),
  linkable: (kind: 'invoice' | 'entry', q?: string) => request<LinkableDocView[]>('GET', '/api/works/linkable' + qs({ kind, q })),
  addCost: (id: string, body: { category: CostCategory; invoiceId?: string; entryId?: string; amount?: number; description?: string }) =>
    request<JobView>('POST', `/api/works/jobs/${id}/costs`, body),
  removeCost: (id: string, costId: string) => request<JobView>('DELETE', `/api/works/jobs/${id}/costs/${costId}`)
};
