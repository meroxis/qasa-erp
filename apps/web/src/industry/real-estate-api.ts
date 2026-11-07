import type { CurrencyCode, Lang } from '@qasa/core';
import { qs, request, type GuarantorInput, type Money2 } from '../api.ts';

/** Real estate (Business, Pro module). Missing (404) in builds without Pro. */

export type UnitKind = 'apartment' | 'villa' | 'house' | 'shop' | 'office' | 'land';
export type UnitStatus = 'available' | 'reserved' | 'sold';
export type UnitAction = 'edit' | 'delete' | 'reserve' | 'release' | 'sell';
export const UNIT_KINDS: readonly UnitKind[] = ['apartment', 'villa', 'house', 'shop', 'office', 'land'];

export interface UnitCounts { available: number; reserved: number; sold: number; total: number }

export interface ReProjectView {
  id: string; code: string; name: string; city: string; address: string; currency: CurrencyCode; itemId: string; active: boolean; notes: string;
  counts: UnitCounts; availableValue: number; reservedValue: number; soldValue: number; expiredReservations: number; createdAt: string;
}

export interface ReUnitView {
  id: string; projectId: string; building: string; code: string; floor: number; kind: UnitKind; bedrooms: number; areaX100: number; price: number;
  view: string; notes: string; status: UnitStatus;
  party: { id: string; name: string; phone: string } | null;
  reservedUntil: string | null; expired: boolean;
  invoice: { id: string; number: string | null; status: string; total: number } | null;
  contract: { id: string; number: string; status: string } | null;
  actions: UnitAction[];
}

export interface ReProjectDetail extends ReProjectView { units: ReUnitView[]; actions: ('edit' | 'addUnits')[] }

export interface ReSummary { available: boolean; projects: number; counts: UnitCounts; availableValue: Money2; soldValue: Money2; expiredReservations: number }

export interface ReProjectInput { code: string; name: string; city?: string; address?: string; currency: CurrencyCode; notes?: string }
export interface ReProjectUpdate { name: string; city?: string; address?: string; notes?: string; active?: boolean }
export interface ReUnitInput {
  building?: string; code: string; floor: number; kind: UnitKind; bedrooms: number; areaX100: number; price: number; view?: string; notes?: string;
}
export interface ReSellInput {
  date: string; partyId: string; price?: number; payment: 'cash' | 'installments'; cashAccountCode?: string; rateX100?: number;
  downPayment?: number; months?: number; firstDue?: string; guarantorId?: string; guarantor?: GuarantorInput; notes?: string; lang: Lang;
}

export const realEstateApi = {
  summary: () => request<ReSummary>('GET', '/api/real-estate/summary'),
  projects: () => request<ReProjectView[]>('GET', '/api/real-estate/projects'),
  project: (id: string) => request<ReProjectDetail>('GET', `/api/real-estate/projects/${id}`),
  createProject: (input: ReProjectInput) => request<ReProjectDetail>('POST', '/api/real-estate/projects', input),
  updateProject: (id: string, input: ReProjectUpdate) => request<ReProjectDetail>('PUT', `/api/real-estate/projects/${id}`, input),
  addUnits: (projectId: string, units: ReUnitInput[]) => request<ReUnitView[]>('POST', `/api/real-estate/projects/${projectId}/units`, { units }),
  units: (f: { projectId?: string; status?: UnitStatus; partyId?: string } = {}) => request<ReUnitView[]>('GET', '/api/real-estate/units' + qs(f)),
  unit: (id: string) => request<ReUnitView>('GET', `/api/real-estate/units/${id}`),
  updateUnit: (id: string, input: ReUnitInput) => request<ReUnitView>('PUT', `/api/real-estate/units/${id}`, input),
  deleteUnit: (id: string) => request<void>('DELETE', `/api/real-estate/units/${id}`),
  reserve: (id: string, body: { partyId: string; until?: string; notes?: string }) => request<ReUnitView>('POST', `/api/real-estate/units/${id}/reserve`, body),
  release: (id: string, reason?: string) => request<ReUnitView>('POST', `/api/real-estate/units/${id}/release`, reason ? { reason } : {}),
  sell: (id: string, body: ReSellInput) => request<ReUnitView>('POST', `/api/real-estate/units/${id}/sell`, body)
};
