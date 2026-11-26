import type { Names, RsOrderKind, RsStation, RsTicketMode } from '@qasa/core';
import { qs, request, type InvoiceView } from '../api.ts';
import type { ShiftView } from './pos-api.ts';
import { sendOnce } from './send-once.ts';

/** Restaurants and cafés (2.1, Starter, Pro and Business): server side in packages/server/src/restaurant.ts. */

export interface AreaView { id: string; name: Names; family: boolean; sort: number; active: boolean }
export interface TableView { id: string; areaId: string; name: string; seats: number; sort: number; active: boolean }
export interface OrderLineView {
  id: string; lineNo: number; itemId: string; code: string; name: Names; qtyMilli: number; unitPrice: number; amount: number; note: string | null;
  ticket: number | null; sentAt: string | null; voided: { at: string; by: string; reason: string } | null; paidMilli: number; unpaidMilli: number; addedBy: string;
  /** where it is made (once sent), when the kitchen said it is ready, when it went to the table */
  station: RsStation | null; readyAt: string | null; servedAt: string | null;
}
export interface OrderSummary {
  id: string; number: string; kind: RsOrderKind; tableId: string | null; tableName: string | null; areaId: string | null; areaName: Names | null;
  guests: number | null; partyId: string | null; partyName: string | null; phone: string | null; address: string | null; notes: string | null;
  status: 'open' | 'closed' | 'cancelled'; warehouseId: string; openedBy: string; openedAt: string; closedAt: string | null; closedBy: string | null;
  billPrintedAt: string | null; tickets: number; cancelReason: string | null; total: number; paid: number; unpaid: number; unsent: number; ready: number; lineCount?: number;
}
export interface OrderView extends OrderSummary {
  lines: OrderLineView[];
  sales: { invoiceId: string; number: string | null; status: string; total: number }[];
}
export interface FloorView {
  available: boolean;
  areas: (AreaView & { tables: (TableView & { order: OrderSummary | null })[] })[];
  orders: OrderSummary[];
}
export interface TicketView {
  orderId: string; number: string; ticket: number; kind: RsOrderKind; tableName: string | null; areaName: Names | null; guests: number | null;
  /** printed on that station's printer (print kind of the same name) */
  station: RsStation;
  by: string; at: string; notes: string | null; type: 'order' | 'cancel';
  lines: { itemId: string; code: string; name: Names; qtyMilli: number; note: string | null; reason?: string }[];
}
export interface PayInput {
  shiftId: string; lines?: { lineId: string; qtyMilli: number }[]; discount?: number; partyId?: string;
  payments?: { method: 'cash' | 'account'; amount: number }[]; tendered?: number;
}
export interface PayResult { order: OrderView; invoice: InvoiceView; shift: ShiftView; rounding: number; tickets: TicketView[] }
export interface KitchenSettings { tickets: RsTicketMode; stations: { categoryId: string; station: RsStation }[] }
export interface KitchenTicketView {
  orderId: string; number: string; kind: RsOrderKind; tableName: string | null; areaName: Names | null; guests: number | null; notes: string | null;
  ticket: number; station: RsStation; sentAt: string; by: string; readyAt: string | null;
  lines: { id: string; code: string; name: Names; qtyMilli: number; note: string | null; voided: boolean; served: boolean }[];
}
export interface KitchenView { cooking: KitchenTicketView[]; done: KitchenTicketView[]; tickets: RsTicketMode }
export interface RecipePartView { ingredientId: string; code: string; name: Names; unit: string; qtyMilli: number; stockMilli: number; cost?: number | null }
export interface RecipeView { itemId: string; code: string; name: Names; unit: string; salePrice: number; saleCurrency: string; parts: RecipePartView[]; cost?: number | null }

const o = (id: string) => `/api/restaurant/orders/${encodeURIComponent(id)}`;

export const restaurantApi = {
  info: () => request<{ available: boolean; areas: AreaView[]; tables: TableView[]; kitchen: KitchenSettings }>('GET', '/api/restaurant'),
  saveKitchen: (body: KitchenSettings) => request<KitchenSettings>('PUT', '/api/restaurant/kitchen-settings', body),
  kitchen: (station: RsStation | 'all') => request<KitchenView>('GET', '/api/restaurant/kitchen' + qs(station === 'all' ? {} : { station })),
  ready: (id: string, ticket: number, station: RsStation, ready: boolean) => request<{ ok: true }>('POST', `${o(id)}/ready`, { ticket, station, ready }),
  served: (id: string) => request<OrderView>('POST', `${o(id)}/served`, {}),
  recipes: () => request<RecipeView[]>('GET', '/api/restaurant/recipes'),
  saveRecipe: (itemId: string, parts: { ingredientId: string; qtyMilli: number }[]) =>
    request<{ recipe: RecipeView | null }>('PUT', `/api/restaurant/recipes/${encodeURIComponent(itemId)}`, { parts }),
  floor: () => request<FloorView>('GET', '/api/restaurant/floor'),
  quickRoom: (tables: number, family: number) => request<{ areas: AreaView[]; tables: TableView[] }>('POST', '/api/restaurant/room', { tables, family }),
  saveArea: (id: string | null, body: { name: Names; family?: boolean; active?: boolean; sort?: number }) =>
    request<AreaView>(id ? 'PUT' : 'POST', id ? `/api/restaurant/areas/${encodeURIComponent(id)}` : '/api/restaurant/areas', body),
  saveTable: (id: string | null, body: { areaId: string; name: string; seats?: number; active?: boolean; sort?: number }) =>
    request<TableView>(id ? 'PUT' : 'POST', id ? `/api/restaurant/tables/${encodeURIComponent(id)}` : '/api/restaurant/tables', body),
  orders: (f: { status?: 'open' | 'closed' | 'cancelled'; from?: string; to?: string } = {}) => request<{ orders: OrderSummary[] }>('GET', '/api/restaurant/orders' + qs(f)),
  order: (id: string) => request<OrderView>('GET', o(id)),
  /** a new order: sent once, so a lost answer never opens a second order */
  open: (body: { kind: RsOrderKind; tableId?: string; guests?: number; partyId?: string; phone?: string; address?: string; notes?: string }) =>
    sendOnce<OrderView>('POST', '/api/restaurant/orders', body),
  update: (id: string, body: { guests?: number | null; partyId?: string | null; phone?: string | null; address?: string | null; notes?: string | null }) =>
    request<OrderView>('PUT', o(id), body),
  /** dishes added: sent once, so a lost answer never adds them twice */
  add: (id: string, lines: { itemId: string; qtyMilli: number; note?: string }[]) => sendOnce<OrderView>('POST', `${o(id)}/lines`, { lines }),
  changeLine: (id: string, lineId: string, body: { qtyMilli?: number; note?: string | null }) => request<OrderView>('PUT', `${o(id)}/lines/${encodeURIComponent(lineId)}`, body),
  removeLine: (id: string, lineId: string) => request<OrderView>('DELETE', `${o(id)}/lines/${encodeURIComponent(lineId)}`),
  voidLine: (id: string, lineId: string, body: { reason: string; qtyMilli?: number }) =>
    request<{ order: OrderView; ticket: TicketView }>('POST', `${o(id)}/lines/${encodeURIComponent(lineId)}/void`, body),
  send: (id: string) => request<{ order: OrderView; tickets: TicketView[] }>('POST', `${o(id)}/send`, {}),
  ticket: (id: string, ticket: number) => request<{ tickets: TicketView[] }>('GET', `${o(id)}/ticket` + qs({ n: String(ticket) })),
  bill: (id: string) => request<OrderView>('POST', `${o(id)}/bill`, {}),
  move: (id: string, tableId: string) => request<OrderView>('POST', `${o(id)}/move`, { tableId }),
  merge: (id: string, intoId: string) => request<OrderView>('POST', `${o(id)}/merge`, { intoId }),
  cancel: (id: string, reason: string) => request<OrderView>('POST', `${o(id)}/cancel`, { reason }),
  reopen: (id: string) => request<OrderView>('POST', `${o(id)}/reopen`, {}),
  /** money: sent once with a key, so a lost answer sent again is the same sale, never a second one */
  pay: (id: string, body: PayInput) => sendOnce<PayResult>('POST', `${o(id)}/pay`, body)
};
