import type { CurrencyCode, Lang } from '@qasa/core';
import { qs, request } from '../api.ts';
import type { GuarantorInput } from '../api.ts';
import type { JobView, LineUnit } from './works-api.ts';

/** Electrical & solar (Pro module): system sizing and quotes, selling, installed equipment and warranty, maintenance. Missing (404) without Pro. */

export type BatteryType = 'lithium' | 'gel';
export type VisitKind = 'service' | 'repair' | 'inspection' | 'installation';
export type PlanStatus = 'active' | 'paused' | 'ended';

export interface Load { name: string; watts: number; qty: number; hours: number; nightHours: number }

export interface SizingInput {
  loads?: Load[]; dailyKwh?: number; nightKwh?: number; peakKw?: number; sunHours?: number; efficiency?: number;
  panelWatts: number; inverterKw: number; batteryKwh?: number; batteryType?: BatteryType; autonomyDays?: number; headroom?: number;
}

export interface SizingResult {
  dailyKwh: number; nightKwh: number; peakKw: number; requiredKwp: number; panels: number; installedKwp: number; inverters: number; inverterTotalKw: number;
  batteries: number; batteryTotalKwh: number; usableBatteryKwh: number; expectedDailyKwh: number;
  assumptions: { sunHours: number; efficiency: number; headroom: number; depthOfDischarge: number; autonomyDays: number };
}

export interface QuoteLine { description: string; unit: LineUnit; qtyMilli: number; unitPrice: number; itemId?: string }

export interface SystemInput {
  kind: 'solar' | 'electrical'; date: string; partyId: string; title: string; site?: string; currency: CurrencyCode;
  dueDate?: string | null; assignedTo?: string; notes?: string; discount?: number; lines: QuoteLine[]; sizing?: SizingResult | null;
}

export interface Design {
  kind: 'solar' | 'electrical';
  itemLines: { seq: number; itemId: string; description: string }[];
  sizing: SizingResult | null;
  pending: { itemId: string; serial: string; warrantyMonths: number }[];
}

export interface InstalledEquipment {
  id: string; serial: string; itemId: string; itemCode: string; itemName: { ar: string; en: string; ku: string };
  warrantyUntil: string | null; soldAt: string | null; pending: boolean; warrantyMonths?: number;
}

export interface SystemView { job: JobView; design: Design | null; installed: InstalledEquipment[] }

export interface SellInput {
  date: string; payment: 'cash' | 'credit' | 'installments'; cashAccountCode?: string; rateX100?: number; warehouseId?: string;
  downPayment?: number; months?: number; firstDue?: string; guarantorId?: string; guarantor?: GuarantorInput;
  maintenance?: { everyMonths: number; price: number; firstDate?: string }; lang: Lang;
}

export interface WarrantyRow {
  serial: string; item: { id: string; code: string; name: { ar: string; en: string; ku: string } };
  party: { id: string; name: string; phone: string } | null; soldAt: string | null; warrantyUntil: string | null;
  state: 'active' | 'expiring' | 'expired' | 'none'; invoice: { id: string; number: string | null } | null;
}

export interface PlanInput {
  partyId: string; jobId?: string | null; title: string; site?: string; everyMonths: number; nextDate: string; currency: CurrencyCode; price: number; notes?: string;
}

export interface PlanView {
  id: string; party: { id: string; name: string; phone: string }; job: { id: string; number: string } | null;
  title: string; site: string; everyMonths: number; nextDate: string; currency: CurrencyCode; price: number;
  status: PlanStatus; notes: string; overdue: boolean; dueSoon: boolean; lastVisit: string | null;
}

export interface Charge { amount: number; payment: 'cash' | 'credit'; cashAccountCode?: string; currency?: CurrencyCode; rateX100?: number }

export interface VisitInput {
  planId?: string | null; partyId?: string; date: string; kind: VisitKind; technician?: string; status: 'scheduled' | 'done';
  findings?: string; workDone?: string; charge?: Charge;
}

export interface VisitView {
  id: string; number: string; plan: { id: string; title: string } | null; party: { id: string; name: string; phone: string };
  date: string; kind: VisitKind; technician: string; status: 'scheduled' | 'done' | 'cancelled'; findings: string; workDone: string;
  invoice: { id: string; number: string | null; total: number; currency: CurrencyCode } | null; createdBy: string;
}

export interface SolarSummaryView {
  available: boolean;
  openJobs: { solar: number; electrical: number };
  month: { systems: number; kwp: number };
  visitsDueThisWeek: number;
  visitsOverdue: number;
  warrantiesExpiring: number;
}

export const solarApi = {
  summary: () => request<SolarSummaryView>('GET', '/api/solar/summary'),
  size: (input: SizingInput) => request<SizingResult>('POST', '/api/solar/size', input),
  system: (id: string) => request<SystemView>('GET', `/api/solar/systems/${id}`),
  createSystem: (input: SystemInput) => request<SystemView>('POST', '/api/solar/systems', input),
  registerEquipment: (id: string, entries: { itemId: string; serial: string; warrantyMonths: number }[]) =>
    request<SystemView>('POST', `/api/solar/systems/${id}/equipment`, { entries }),
  removePending: (id: string, serial: string) => request<SystemView>('DELETE', `/api/solar/systems/${id}/equipment/${encodeURIComponent(serial)}`),
  sell: (id: string, input: SellInput) => request<SystemView>('POST', `/api/solar/systems/${id}/sell`, input),
  warranty: (q: string) => request<WarrantyRow[]>('GET', '/api/solar/warranty' + qs({ q })),
  expiring: () => request<WarrantyRow[]>('GET', '/api/solar/warranty' + qs({ expiring: '1' })),
  plans: (f: { due?: boolean; days?: number; partyId?: string; status?: PlanStatus } = {}) =>
    request<PlanView[]>('GET', '/api/solar/plans' + qs({ due: f.due ? '1' : undefined, days: f.days?.toString(), partyId: f.partyId, status: f.status })),
  createPlan: (input: PlanInput) => request<PlanView>('POST', '/api/solar/plans', input),
  updatePlan: (id: string, patch: Partial<PlanInput> & { status?: PlanStatus }) => request<PlanView>('PUT', `/api/solar/plans/${id}`, patch),
  visits: (f: { planId?: string; partyId?: string; status?: string; from?: string; to?: string } = {}) => request<VisitView[]>('GET', '/api/solar/visits' + qs(f)),
  recordVisit: (input: VisitInput) => request<VisitView>('POST', '/api/solar/visits', input),
  completeVisit: (id: string, body: { date?: string; technician?: string; findings?: string; workDone?: string; charge?: Charge; cancel?: boolean }) =>
    request<VisitView>('POST', `/api/solar/visits/${id}/complete`, body)
};
