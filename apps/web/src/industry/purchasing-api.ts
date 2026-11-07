import type { CurrencyCode, Names } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Purchase orders (أوامر الشراء): written to a supplier, received into draft purchase invoices. */

export type PoStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';
export type PoAction = 'edit' | 'send' | 'receive' | 'cancel' | 'reopen';
export type PoMove = 'send' | 'cancel' | 'reopen';
export const PO_STATUSES: readonly PoStatus[] = ['draft', 'sent', 'partial', 'received', 'cancelled'];

export interface PoLineInput { itemId: string; qtyMilli: number; unitPrice: number }
export interface PoInput {
  date: string;
  partyId: string;
  warehouseId?: string | null;
  currency: CurrencyCode;
  expectedDate?: string | null;
  notes?: string;
  lines: PoLineInput[];
}
export interface PoLineView {
  seq: number; itemId: string; itemCode: string; itemName: Names; unit: string;
  qtyMilli: number; unitPrice: number; amount: number; receivedMilli: number; remainingMilli: number;
}
export interface PoReceiptView { invoiceId: string; number: string | null; date: string; status: 'draft' | 'posted' | 'cancelled'; total: number }
export interface PoView {
  id: string; number: string; date: string;
  party: { id: string; code: string; name: string; phone: string | null; address: string | null };
  warehouse: { id: string; code: string; name: Names } | null;
  currency: CurrencyCode; expectedDate: string | null; status: PoStatus; overdue: boolean; notes: string; total: number;
  lines: PoLineView[]; receipts: PoReceiptView[]; createdBy: string; createdAt: string; actions: PoAction[];
}
export interface PoSummaryView {
  id: string; number: string; date: string; partyId: string; partyName: string; currency: CurrencyCode;
  expectedDate: string | null; status: PoStatus; overdue: boolean; total: number;
}
export interface PoTiles { draft: number; open: number; partial: number; overdue: number }
export interface ReorderLine {
  itemId: string; itemCode: string; itemName: Names; unit: string;
  onHandMilli: number; reorderMilli: number | null; onOrderMilli: number; suggestMilli: number; lastPrice: number | null;
}
export interface ReorderGroup { party: { id: string; name: string } | null; currency: CurrencyCode; lines: ReorderLine[] }

export const purchasingApi = {
  list: (f: { status?: PoStatus | 'open'; partyId?: string; q?: string } = {}) => request<PoSummaryView[]>('GET', '/api/purchase-orders' + qs(f)),
  summary: () => request<PoTiles>('GET', '/api/purchase-orders/summary'),
  suggest: () => request<ReorderGroup[]>('GET', '/api/purchase-orders/suggest'),
  get: (id: string) => request<PoView>('GET', `/api/purchase-orders/${id}`),
  create: (input: PoInput) => request<PoView>('POST', '/api/purchase-orders', input),
  update: (id: string, input: PoInput) => request<PoView>('PUT', `/api/purchase-orders/${id}`, input),
  move: (id: string, action: PoMove, reason?: string) => request<PoView>('POST', `/api/purchase-orders/${id}/status`, { action, ...(reason ? { reason } : {}) }),
  receive: (id: string, input: { date: string; warehouseId?: string | null; rateX100?: number }) =>
    request<{ order: PoView; invoiceId: string }>('POST', `/api/purchase-orders/${id}/receive`, input)
};
