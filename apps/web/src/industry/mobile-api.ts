import type { CurrencyCode, Lang, Names } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Mobile shops (Pro module): phones by IMEI or serial, trade-ins and repair orders. Missing (404) in builds without Pro. */

export type SerialStatus = 'in_stock' | 'sold' | 'returned' | 'defective';
export type Grade = 'new' | 'used';
export type RepairStatus = 'received' | 'diagnosing' | 'waiting_parts' | 'repairing' | 'ready' | 'delivered' | 'cancelled';
export const OPEN_REPAIR: readonly RepairStatus[] = ['received', 'diagnosing', 'waiting_parts', 'repairing', 'ready'];
export type RepairAction = 'edit' | 'status' | 'deliver' | 'cancel';

export interface SerialView {
  id: string;
  serial: string;
  item: { id: string; code: string; name: Names };
  grade: Grade;
  status: SerialStatus;
  purchaseInvoice: { id: string; number: string | null } | null;
  fromParty: { id: string; name: string } | null;
  /** IQD */
  cost: number | null;
  saleInvoice: { id: string; number: string | null; date: string } | null;
  party: { id: string; name: string; phone: string } | null;
  soldAt: string | null;
  warrantyUntil: string | null;
  warrantyActive: boolean;
  notes: string;
  createdBy: string;
  createdAt: string;
}

export interface RepairView {
  id: string;
  number: string;
  date: string;
  party: { id: string; code: string; name: string; phone: string };
  device: string;
  serial: string;
  problem: string;
  accessories: string;
  passcodeGiven: boolean;
  technician: string;
  status: RepairStatus;
  currency: CurrencyCode;
  estimate: number;
  promisedDate: string | null;
  late: boolean;
  invoice: { id: string; number: string | null; total: number } | null;
  warranty: { serialId: string; warrantyUntil: string | null; active: boolean } | null;
  notes: string;
  createdBy: string;
  createdAt: string;
  deliveredAt: string | null;
  actions: RepairAction[];
}

export interface MobileSummary {
  available: boolean;
  serials: Record<SerialStatus, number>;
  repairs: Record<RepairStatus, number>;
  lateRepairs: number;
  underWarranty: number;
}

export interface SerialLookup { serial: string; device: SerialView | null; repairs: RepairView[] }

export interface RepairInput {
  date: string;
  partyId: string;
  device: string;
  serial?: string;
  problem: string;
  accessories?: string;
  passcodeGiven?: boolean;
  technician?: string;
  currency: CurrencyCode;
  estimate: number;
  promisedDate?: string;
  notes?: string;
}

export type RepairFilter = RepairStatus | 'open' | 'late';

export const mobileApi = {
  summary: () => request<MobileSummary>('GET', '/api/mobile/summary'),
  serials: (f: { q?: string; itemId?: string; status?: SerialStatus } = {}) => request<SerialView[]>('GET', '/api/mobile/serials' + qs(f)),
  lookup: (serial: string) => request<SerialLookup>('GET', '/api/mobile/lookup' + qs({ serial })),
  register: (body: { itemId: string; serials: string[]; grade?: Grade; purchaseInvoiceId?: string; cost?: number; notes?: string }) =>
    request<SerialView[]>('POST', '/api/mobile/serials', body),
  setStatus: (id: string, status: SerialStatus, reason?: string) =>
    request<SerialView>('POST', `/api/mobile/serials/${id}/status`, reason ? { status, reason } : { status }),
  tradeIn: (body: {
    date: string; itemId: string; serial: string; partyId: string; currency: CurrencyCode; rateX100?: number; price: number; cashAccountCode: string; notes?: string; lang: Lang;
  }) => request<{ serial: SerialView; invoiceId: string }>('POST', '/api/mobile/trade-in', body),
  invoiceSerials: (invoiceId: string) => request<SerialView[]>('GET', `/api/mobile/invoices/${invoiceId}/serials`),
  assign: (invoiceId: string, serials: string[], warrantyMonths: number) =>
    request<SerialView[]>('POST', `/api/mobile/sales/${invoiceId}/serials`, { serials, warrantyMonths }),
  repairs: (f: { status?: RepairFilter; q?: string; partyId?: string } = {}) => request<RepairView[]>('GET', '/api/mobile/repairs' + qs(f)),
  repair: (id: string) => request<RepairView>('GET', `/api/mobile/repairs/${id}`),
  createRepair: (input: RepairInput) => request<RepairView>('POST', '/api/mobile/repairs', input),
  updateRepair: (id: string, patch: Partial<Omit<RepairInput, 'date' | 'partyId' | 'currency'>>) => request<RepairView>('PUT', `/api/mobile/repairs/${id}`, patch),
  repairStatus: (id: string, status: RepairStatus) => request<RepairView>('POST', `/api/mobile/repairs/${id}/status`, { status }),
  deliver: (id: string, body: { date: string; amount: number; payment: 'cash' | 'credit'; cashAccountCode?: string; rateX100?: number; lang: Lang }) =>
    request<RepairView>('POST', `/api/mobile/repairs/${id}/deliver`, body),
  cancelRepair: (id: string, reason: string) => request<RepairView>('POST', `/api/mobile/repairs/${id}/cancel`, reason ? { reason } : {})
};
