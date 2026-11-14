import type { Names, UnitCode } from '@qasa/core';
import { qs, request } from '../api.ts';
import type { AdjustmentView } from './adjustments-api.ts';

/** Batches and expiry dates (every plan). */

export type ExpiryState = 'expired' | 'near' | 'ok' | null;

export interface BatchReportRow {
  itemId: string; itemCode: string; itemName: Names; unit: UnitCode;
  batchId: string; batch: string; expiry: string | null;
  warehouseId: string; warehouseCode: string; warehouseName: Names;
  /** value: absent for someone who may not see cost (1.4) */
  qtyMilli: number; value?: number; daysLeft: number | null; state: ExpiryState;
}

export interface BatchSettingsView { nearExpiryDays: number; expiredSales: 'block' | 'warn'; defaultTrackExpiry: boolean }

export const batchesApi = {
  /** The batches of an item with stock (in one warehouse, or each of them). */
  ofItem: (itemId: string, warehouseId?: string) => request<BatchReportRow[]>('GET', '/api/batches' + qs({ itemId, ...(warehouseId ? { warehouseId } : {}) })),
  report: (f: { state?: 'expired' | 'near' | 'all'; warehouseId?: string; itemId?: string }) =>
    request<{ date: string; nearExpiryDays: number; rows: BatchReportRow[] }>('GET', '/api/batches/report' + qs(f)),
  update: (id: string, body: { number?: string; expiry?: string | null }) => request<unknown>('PUT', `/api/batches/${id}`, body),
  writeOff: (body: { warehouseId: string; rows: { batchId: string; qtyMilli: number }[]; notes?: string }) => request<AdjustmentView>('POST', '/api/batches/write-off', body),
  settings: () => request<BatchSettingsView>('GET', '/api/batches/settings'),
  saveSettings: (body: Partial<BatchSettingsView>) => request<BatchSettingsView>('PUT', '/api/batches/settings', body)
};
