import type { CurrencyCode, Names, UnitCode } from '@qasa/core';
import { qs, request } from '../api.ts';
import type { BatchReportRow } from './batches-api.ts';

/** The pharmacy pack (Pro). Missing (404) in builds without Pro. */

export const DOSAGE_FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'injection', 'drops', 'cream', 'ointment', 'inhaler', 'suppository', 'sachet', 'spray', 'other'] as const;
export type DosageForm = (typeof DOSAGE_FORMS)[number];

export interface PharmaDetails { genericName: string; form: DosageForm; strength: string; manufacturer: string; rxOnly: boolean; controlled: boolean; shelf: string }
export interface MedicineView extends PharmaDetails {
  itemId: string; code: string; barcode: string; name: Names; unit: UnitCode; price: number; currency: CurrencyCode; active: boolean;
  stockMilli: number; nearestExpiry: string | null; hasDetails: boolean;
}
export interface MedicineDetail extends MedicineView { alternatives: MedicineView[] }
export interface ControlledLine {
  invoiceId: string; invoiceNumber: string | null; date: string; lineNo: number; itemId: string; itemCode: string; itemName: Names; qtyMilli: number; unit: UnitCode;
  batches: string[]; patient: string | null; prescriber: string | null; prescriptionNo: string | null; notes: string | null;
  recordedBy: string | null; recordedAt: string | null; missing: boolean;
}

export const pharmacyApi = {
  status: () => request<{ available: boolean; forms: DosageForm[] }>('GET', '/api/pharmacy'),
  medicines: (f: { q?: string; form?: DosageForm; rx?: '0' | '1'; controlled?: '0' | '1' } = {}) => request<{ items: MedicineView[]; total: number }>('GET', '/api/pharmacy/items' + qs(f)),
  medicine: (itemId: string) => request<MedicineDetail>('GET', `/api/pharmacy/items/${itemId}`),
  save: (itemId: string, body: PharmaDetails) => request<MedicineDetail>('PUT', `/api/pharmacy/items/${itemId}`, body),
  search: (q: string) => request<MedicineView[]>('GET', '/api/pharmacy/search' + qs({ q })),
  alternatives: (generic: string) => request<MedicineView[]>('GET', '/api/pharmacy/alternatives' + qs({ generic })),
  nearExpiry: () => request<BatchReportRow[]>('GET', '/api/pharmacy/near-expiry'),
  controlled: (f: { from?: string; to?: string; missing?: '1' } = {}) => request<ControlledLine[]>('GET', '/api/pharmacy/controlled' + qs(f)),
  record: (invoiceId: string, lineNo: number, body: { patient: string; prescriber?: string; prescriptionNo?: string; notes?: string }) =>
    request<ControlledLine>('PUT', `/api/pharmacy/controlled/${invoiceId}/${lineNo}`, body)
};
