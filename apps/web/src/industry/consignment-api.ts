import type { CurrencyCode, Names, UnitCode } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Goods on consignment (sale-or-return; Starter, Pro and Business): server side in packages/server/src/consignment.ts. */

export type ConsignmentDocKind = 'receipt' | 'return';
export type ConsignmentDocStatus = 'draft' | 'posted' | 'cancelled';
export type ConsignmentDocAction = 'edit' | 'delete' | 'post' | 'cancel';
export type SettlementState = 'draft' | 'checked' | 'approved' | 'reversed' | 'none';

export interface ConsignmentSupplier { supplierId: string; supplierName: string; items: number; unsettled: Record<CurrencyCode, number> }

export interface ConsignmentItem {
  itemId: string; itemCode: string; itemName: Names; unit: UnitCode; supplierId: string; supplierName: string;
  currency: CurrencyCode; unitCost: number; active: boolean; onHandMilli: number; onHandValue: number;
}

export interface ConsignmentLineInput { itemId: string; qtyMilli: number; unitCost?: number; batchNo?: string; expiry?: string; batchId?: string }
export interface ConsignmentDocInput {
  kind: ConsignmentDocKind; date: string; supplierId: string; warehouseId: string; rateX100?: number; notes?: string; lines: ConsignmentLineInput[];
}

export interface ConsignmentDocLine {
  seq: number; itemId: string; itemCode: string; itemName: Names; unit: UnitCode; qtyMilli: number; unitCost: number | null;
  batchNo: string | null; expiry: string | null; amount: number | null; value: number | null;
}

export interface ConsignmentDocSummary {
  id: string; kind: ConsignmentDocKind; number: string | null; date: string; status: ConsignmentDocStatus; supplierId: string; supplierName: string;
  warehouseId: string; currency: CurrencyCode; lineCount: number;
}

export interface ConsignmentDoc extends Omit<ConsignmentDocSummary, 'lineCount'> {
  warehouseName: Names; rateX100: number; entryId: string | null; notes: string | null; total: number; actions: ConsignmentDocAction[]; lines: ConsignmentDocLine[];
}

export interface SettlementLine { itemId: string; itemCode: string; itemName: Names; unit: UnitCode; qtyMilli: number; amount: number; value: number }
export interface SettlementPreview { supplierId: string; currency: CurrencyCode; date: string; amount: number; value: number; lines: SettlementLine[] }
export interface Settlement {
  id: string; number: string; date: string; supplierId: string; supplierName: string; currency: CurrencyCode; rateX100: number; amount: number; value: number;
  status: 'open' | 'cancelled'; entryState: SettlementState; entryId: string | null; cancelEntryId: string | null; notes: string | null;
  createdBy: string; createdAt: string; lines?: SettlementLine[];
}

export interface StatementItem {
  itemId: string; itemCode: string; itemName: Names; unit: UnitCode; currency: CurrencyCode; unitCost: number;
  receivedMilli: number; returnedMilli: number; soldMilli: number; onHandMilli: number;
  receivedAmount: number; returnedAmount: number; soldAmount: number; onHandAmount: number;
}
export interface StatementTotals { received: number; returned: number; sold: number; onHand: number; settled: number; waiting: number; unsettled: number }
export interface ConsignmentStatement {
  supplierId: string; supplierName: string; from: string | null; to: string; items: StatementItem[];
  totals: Record<CurrencyCode, StatementTotals>; paid: number; balance: number; settlements: Settlement[];
}

export const consignmentApi = {
  overview: () => request<{ available: boolean; suppliers: ConsignmentSupplier[] }>('GET', '/api/consignment'),
  items: (f: { supplierId?: string; all?: '1' } = {}) => request<ConsignmentItem[]>('GET', '/api/consignment/items' + qs(f)),
  setItem: (itemId: string, body: { supplierId: string; currency: CurrencyCode; unitCost: number }) => request<ConsignmentItem>('PUT', `/api/consignment/items/${itemId}`, body),
  endItem: (itemId: string) => request<ConsignmentItem>('POST', `/api/consignment/items/${itemId}/end`, {}),
  docs: (f: { supplierId?: string; kind?: ConsignmentDocKind; status?: ConsignmentDocStatus } = {}) => request<ConsignmentDocSummary[]>('GET', '/api/consignment/docs' + qs(f)),
  doc: (id: string) => request<ConsignmentDoc>('GET', `/api/consignment/docs/${id}`),
  createDoc: (body: ConsignmentDocInput) => request<ConsignmentDoc>('POST', '/api/consignment/docs', body),
  updateDoc: (id: string, body: ConsignmentDocInput) => request<ConsignmentDoc>('PUT', `/api/consignment/docs/${id}`, body),
  deleteDoc: (id: string) => request<void>('DELETE', `/api/consignment/docs/${id}`),
  postDoc: (id: string, lang: 'ar' | 'en' | 'ku') => request<ConsignmentDoc>('POST', `/api/consignment/docs/${id}/post`, { lang }),
  cancelDoc: (id: string) => request<ConsignmentDoc>('POST', `/api/consignment/docs/${id}/cancel`, {}),
  settlements: (f: { supplierId?: string } = {}) => request<Settlement[]>('GET', '/api/consignment/settlements' + qs(f)),
  preview: (f: { supplierId: string; currency: CurrencyCode; date: string }) => request<SettlementPreview>('GET', '/api/consignment/settlements/preview' + qs(f)),
  settle: (body: { supplierId: string; currency: CurrencyCode; date: string; rateX100?: number; notes?: string; lang: 'ar' | 'en' | 'ku' }) =>
    request<Settlement>('POST', '/api/consignment/settlements', body),
  cancelSettlement: (id: string) => request<Settlement>('POST', `/api/consignment/settlements/${id}/cancel`, {}),
  statement: (supplierId: string, f: { from?: string; to?: string } = {}) => request<ConsignmentStatement>('GET', `/api/consignment/statement/${supplierId}` + qs(f))
};
