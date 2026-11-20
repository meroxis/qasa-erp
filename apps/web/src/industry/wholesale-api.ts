import type { CurrencyCode, Names } from '@qasa/core';
import { qs, request } from '../api.ts';

/**
 * Wholesale and distribution (packages/server/src/wholesale.ts): sales reps with their van and cash, routes, the rep's
 * day, sales orders with credit control, van loads and counts, collections and handovers, and the reports. A rep's
 * answers hold only their own; no answer carries cost or stock value.
 */

export type WsOutcome = 'order' | 'no_order' | 'closed' | 'collected';
export type WsOrderStatus = 'draft' | 'approved' | 'delivered' | 'cancelled';
export type WsPolicy = 'off' | 'warn' | 'block';
export type DocState = 'approved' | 'waiting' | 'rejected';

export interface WsSettings { creditPolicy: 'warn' | 'block'; overdueDays: number; overduePolicy: WsPolicy; officeCashAccount: string; vanShortAccount: string }
export interface RepView {
  id: string; userId: string; userName: string; name: string; warehouseId: string; warehouseName: Names; loadWarehouseId: string; cashAccount: string; active: boolean; stops: number;
}
export interface RepInput { userId: string; name: string; warehouseId: string; loadWarehouseId: string; cashAccount: string; active?: boolean }
export interface StopView { id: string; weekday: number; seq: number; partyId: string; partyName: string; partyCode: string; phone: string; address: string }
export interface DayStop extends StopView { visits: WsOutcome[]; balance: number; limit: number | null; overLimit: boolean; overdue: boolean; oldestDays: number }
export interface RepDay { repId: string; date: string; weekday: number; stops: DayStop[] }
export interface CreditState {
  partyId: string; balance: number; limit: number | null; overLimit: boolean; oldestDays: number; overdue: boolean; verdict: 'ok' | 'warn' | 'block'; reasons: ('over_limit' | 'overdue')[];
}
export interface OrderLineView { lineNo: number; itemId: string; itemCode: string; itemName: Names; qtyMilli: number; unit: string | null; unitQtyMilli: number | null; unitPrice: number; amount: number }
export interface OrderView {
  id: string; number: string; repId: string | null; repName: string | null; partyId: string; partyName: string; date: string; warehouseId: string;
  currency: CurrencyCode; rateX100: number; status: WsOrderStatus; total: number; limitCheck: 'ok' | 'warn' | 'override' | null;
  overrideBy: string | null; overrideReason: string | null; approvedBy: string | null; approvedAt: string | null;
  invoiceId: string | null; invoiceNumber: string | null; notes: string; createdBy: string; createdAt: string; lines: OrderLineView[];
  actions: ('edit' | 'approve' | 'deliver' | 'cancel')[];
}
export interface OrderLineInput { itemId: string; qtyMilli?: number; unit?: string; unitQtyMilli?: number; unitPrice: number }
export interface OrderInput {
  partyId: string; date: string; warehouseId?: string; repId?: string | null; currency: CurrencyCode; rateX100: number; notes?: string; lines: OrderLineInput[];
}
export interface VanRow {
  itemId: string; code: string; name: Names; unit: string;
  opening: number; loaded: number; unloaded: number; sold: number; returned: number; other: number; expected: number; counted: number | null;
}
export interface VanDay { repId: string; date: string; status: 'none' | 'open' | 'closed'; adjustmentId: string | null; rows: VanRow[] }
export interface VanMove { id: string; number: string | null; date: string; direction: 'load' | 'unload'; status: string }
export interface StockLine { itemId: string; qtyMilli?: number; unit?: string; unitQtyMilli?: number }
export interface CollectionView {
  id: string; number: string; repId: string; repName: string; partyId: string; partyName: string; date: string; currency: CurrencyCode; rateX100: number;
  amount: number; entryId: string | null; state: DocState; handoverId: string | null; notes: string; createdBy: string;
}
export interface HandoverView {
  id: string; number: string; repId: string; repName: string; date: string; toAccount: string; currency: CurrencyCode; amount: number;
  entryId: string | null; state: DocState; collections: number; createdBy: string; createdAt: string;
}
export interface WsReports {
  from: string; to: string;
  sales: { repId: string | null; repName: string; orders: number; total: number; byWeekday: number[] }[];
  collections: { repId: string; repName: string; IQD: number; USD: number; handedIQD: number; handedUSD: number; count: number }[];
  visits: { repId: string; repName: string; planned: number; done: number; unplanned: number }[];
  credit: { partyId: string; name: string; balance: number; limit: number | null; overLimit: boolean; oldestDays: number; overdue: boolean }[];
}

export const wholesaleApi = {
  settings: () => request<{ available: boolean; settings: WsSettings }>('GET', '/api/wholesale/settings'),
  saveSettings: (patch: Partial<WsSettings>) => request<WsSettings>('PUT', '/api/wholesale/settings', patch),
  reps: () => request<RepView[]>('GET', '/api/wholesale/reps'),
  createRep: (input: RepInput) => request<RepView>('POST', '/api/wholesale/reps', input),
  updateRep: (id: string, input: RepInput) => request<RepView>('PUT', `/api/wholesale/reps/${id}`, input),
  route: (id: string) => request<StopView[]>('GET', `/api/wholesale/reps/${id}/route`),
  setRouteDay: (id: string, weekday: number, partyIds: string[]) => request<StopView[]>('PUT', `/api/wholesale/reps/${id}/route`, { weekday, partyIds }),
  day: (id: string, date?: string) => request<RepDay>('GET', `/api/wholesale/reps/${id}/day` + qs({ date })),
  vanMoves: (id: string) => request<VanMove[]>('GET', `/api/wholesale/reps/${id}/van-moves`),
  moveVan: (id: string, body: { direction: 'load' | 'unload'; date: string; notes?: string; lines: StockLine[] }) =>
    request<{ id: string; number: string | null }>('POST', `/api/wholesale/reps/${id}/van`, body),
  vanDay: (id: string, date?: string) => request<VanDay>('GET', `/api/wholesale/reps/${id}/van-count` + qs({ date })),
  saveVanCount: (id: string, date: string, lines: { itemId: string; countedMilli: number }[]) => request<VanDay>('PUT', `/api/wholesale/reps/${id}/van-count`, { date, lines }),
  closeVanCount: (id: string, date: string) => request<VanDay>('POST', `/api/wholesale/reps/${id}/van-count/close`, { date }),
  orders: (f: { status?: WsOrderStatus; repId?: string; partyId?: string; from?: string; to?: string } = {}) => request<OrderView[]>('GET', '/api/wholesale/orders' + qs(f)),
  order: (id: string) => request<OrderView>('GET', `/api/wholesale/orders/${id}`),
  createOrder: (input: OrderInput) => request<OrderView>('POST', '/api/wholesale/orders', input),
  updateOrder: (id: string, input: OrderInput) => request<OrderView>('PUT', `/api/wholesale/orders/${id}`, input),
  approve: (id: string, override?: { reason: string }) => request<OrderView>('POST', `/api/wholesale/orders/${id}/approve`, override ? { override } : {}),
  deliver: (id: string, override?: { reason: string }) => request<OrderView>('POST', `/api/wholesale/orders/${id}/deliver`, override ? { override } : {}),
  cancel: (id: string, reason?: string) => request<OrderView>('POST', `/api/wholesale/orders/${id}/cancel`, reason ? { reason } : {}),
  credit: (partyId: string, adding?: number) => request<CreditState>('GET', `/api/wholesale/credit/${partyId}` + qs({ adding: adding ? String(adding) : undefined })),
  visit: (body: { repId?: string; partyId: string; date: string; outcome: WsOutcome; notes?: string }) => request<{ id: string }>('POST', '/api/wholesale/visits', body),
  collections: (f: { repId?: string; from?: string; to?: string; open?: '1' } = {}) => request<CollectionView[]>('GET', '/api/wholesale/collections' + qs(f)),
  collect: (body: { repId?: string; partyId: string; date: string; currency: CurrencyCode; rateX100: number; amount: number; notes?: string }) =>
    request<CollectionView>('POST', '/api/wholesale/collections', body),
  handovers: (repId?: string) => request<HandoverView[]>('GET', '/api/wholesale/handovers' + qs({ repId })),
  handOver: (body: { repId: string; date: string; currency: CurrencyCode; rateX100: number; toAccount?: string }) => request<HandoverView>('POST', '/api/wholesale/handovers', body),
  reports: (from?: string, to?: string) => request<WsReports>('GET', '/api/wholesale/reports' + qs({ from, to }))
};
