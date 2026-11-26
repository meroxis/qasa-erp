import { ok, safeId } from '../answers';
import type { Names } from '../api';
import type { OfficeLink } from '../link';

/**
 * A restaurant's waiter at the table (phone app 1.3, with an office of Qasa ERP 2.1 that offers 'waiter'): the room
 * (each area's tables, free or with their order), a table's order, dishes added with a note and sent to the kitchen,
 * and what the kitchen made ready taken to the table. Paying, cancelling what the kitchen has, moving and joining
 * tables stay at the till. The office's own API (packages/server/src/restaurant.ts) checks each call, and the phone
 * link (pro/src/phone/staff-routes.ts) checks what a phone may send.
 */

export type RsStation = 'kitchen' | 'grill' | 'bar';

export interface RsLine {
  id: string; lineNo: number; itemId: string; code: string; name: Names; qtyMilli: number; unitPrice: number; amount: number; note: string | null;
  ticket: number | null; voided: { reason: string } | null; station: RsStation | null; readyAt: string | null; servedAt: string | null;
}
export interface RsOrderSummary {
  id: string; number: string; kind: 'table' | 'takeaway' | 'delivery'; tableId: string | null; tableName: string | null; guests: number | null;
  status: 'open' | 'closed' | 'cancelled'; total: number; paid: number; unpaid: number; unsent: number; ready: number; openedAt: string;
  billPrintedAt: string | null;
}
export interface RsOrder extends RsOrderSummary { lines: RsLine[] }
export interface RsTable { id: string; name: string; seats: number; order: RsOrderSummary | null }
export interface RsFloor {
  available: boolean;
  areas: { id: string; name: Names; family: boolean; tables: RsTable[] }[];
  orders: RsOrderSummary[];
}

/** At most this many dishes on one request, and characters in a dish's note ("no onion"), as the office takes. */
export const RS_MAX_ADD = 50;
export const RS_MAX_NOTE = 120;
export const RS_MAX_GUESTS = 99;

/** A dish picked on the phone, not on the order yet. */
export interface DishDraft { itemId: string; name: Names; qtyMilli: number; note: string }

/** A dish picked again: one more of it (the same dish with a note stays a line of its own). */
export function addDish(list: readonly DishDraft[], item: { id: string; name: Names }): DishDraft[] {
  const same = list.findIndex((d) => d.itemId === item.id && !d.note.trim());
  if (same >= 0) return list.map((d, i) => (i === same ? { ...d, qtyMilli: d.qtyMilli + 1000 } : d));
  return [...list, { itemId: item.id, name: item.name, qtyMilli: 1000, note: '' }];
}

/** A picked dish's number changed: none takes it off. */
export function setDishCount(list: readonly DishDraft[], index: number, count: number): DishDraft[] {
  if (count <= 0) return list.filter((_, i) => i !== index);
  return list.map((d, i) => (i === index ? { ...d, qtyMilli: Math.min(count, 999) * 1000 } : d));
}

/** What the office is sent for the picked dishes (a note only when there is one, at most 120 characters). */
export function dishesBody(list: readonly DishDraft[]): { lines: { itemId: string; qtyMilli: number; note?: string }[] } {
  return {
    lines: list.slice(0, RS_MAX_ADD).map((d) => {
      const note = d.note.trim().slice(0, RS_MAX_NOTE);
      return { itemId: d.itemId, qtyMilli: d.qtyMilli, ...(note ? { note } : {}) };
    })
  };
}

/** Where a dish is: picked here, on the order but not sent, cooking, ready to take, at the table, or cancelled. */
export type LineState = 'unsent' | 'cooking' | 'ready' | 'served' | 'cancelled';
export function lineState(l: Pick<RsLine, 'voided' | 'ticket' | 'readyAt' | 'servedAt'>): LineState {
  if (l.voided) return 'cancelled';
  if (l.ticket === null) return 'unsent';
  if (l.servedAt) return 'served';
  if (l.readyAt) return 'ready';
  return 'cooking';
}

/** Minutes a table has been eating (never below none). */
export const minutesSince = (iso: string, now: number): number => Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));

export function waiterApi(link: OfficeLink) {
  const order = (id: string) => `/api/restaurant/orders/${safeId(id)}`;
  return {
    rsFloor: async () => ok(await link.request<RsFloor>('GET', '/api/restaurant/floor')),
    rsOrder: async (id: string) => ok(await link.request<RsOrder>('GET', order(id))),
    /** a table's new order (or one to take away), with its key: a lost answer sent again opens one order */
    rsOpen: async (body: { kind: 'table' | 'takeaway'; tableId?: string; guests?: number }, key: string) =>
      ok(await link.request<RsOrder>('POST', '/api/restaurant/orders', body, key)),
    /** dishes onto the order, with their key: sent again, they are added once */
    rsAdd: async (id: string, dishes: readonly DishDraft[], key: string) => ok(await link.request<RsOrder>('POST', `${order(id)}/lines`, dishesBody(dishes), key)),
    rsChangeLine: async (id: string, lineId: string, qtyMilli: number) => ok(await link.request<RsOrder>('PUT', `${order(id)}/lines/${safeId(lineId)}`, { qtyMilli })),
    rsRemoveLine: async (id: string, lineId: string) => ok(await link.request<RsOrder>('DELETE', `${order(id)}/lines/${safeId(lineId)}`)),
    rsSend: async (id: string) => ok(await link.request<{ order: RsOrder }>('POST', `${order(id)}/send`, {})).order,
    rsServed: async (id: string) => ok(await link.request<RsOrder>('POST', `${order(id)}/served`, {}))
  };
}
