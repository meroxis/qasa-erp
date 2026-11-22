import type { CurrencyCode, Lang, Names, OfferKind, UnitCode } from '@qasa/core';
import { qs, request } from '../api.ts';
import { sendOnce } from './send-once.ts';

/**
 * The market extras (2.0): delivery orders, debt reminders, price checkers and suppliers who deliver every day. Server
 * side in packages/server/src/delivery.ts, debt-reminders.ts, price-checker.ts and daily-suppliers.ts.
 */

// ——— delivery ———

export const DELIVERY_STATUSES = ['new', 'preparing', 'out', 'delivered', 'cancelled'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type DeliveryPayment = 'cod' | 'account';

export interface DeliveryLineInput { itemId: string; qtyMilli?: number; unitPrice: number; unit?: UnitCode; unitQtyMilli?: number }
export interface DeliveryOrderInput {
  partyId?: string | null; customerName: string; phone?: string; address: string; area?: string; notes?: string; lang?: Lang | null;
  warehouseId: string; payment: DeliveryPayment; fee: number; driverId?: string | null; lines: DeliveryLineInput[];
}
export interface DeliveryLine { lineNo: number; itemId: string; itemCode: string; itemName: Names; unit: UnitCode | null; qtyMilli: number; unitQtyMilli: number | null; unitPrice: number; amount: number; discount: number }
export interface DeliveryOrderSummary {
  id: string; number: string; status: DeliveryStatus; partyId: string | null; customerName: string; phone: string; address: string; area: string; notes: string;
  lang: Lang | null; warehouseId: string; payment: DeliveryPayment; fee: number; driverId: string | null; driverName: string | null;
  invoiceId: string | null; invoiceNumber: string | null; cancelReason: string | null; createdBy: string; createdAt: string; outAt: string | null; deliveredAt: string | null;
  subtotal: number; offerDiscount: number; total: number; next: DeliveryStatus[]; lineCount: number;
}
export interface DeliveryOrder extends Omit<DeliveryOrderSummary, 'lineCount'> { lines: DeliveryLine[] }
export interface DeliveryPreview { subtotal: number; offerDiscount: number; fee: number; total: number; byLine: Record<number, number> }
export interface Driver { id: string; name: string; phone: string; userId: string | null; cashAccount: string | null; active: boolean; holding: number }
export interface DriverInput { name: string; phone?: string; userId?: string | null; cashAccount?: string | null; active?: boolean }
export interface Handover { id: string; driverId: string; driverName: string; amount: number; entryId: string; entryNumber: string; entryStatus: string; createdBy: string; createdAt: string }

export const deliveryApi = {
  orders: (f: { status?: DeliveryStatus | 'open'; from?: string; to?: string; driverId?: string } = {}) =>
    request<{ available: boolean; orders: DeliveryOrderSummary[] }>('GET', '/api/delivery/orders' + qs(f)),
  order: (id: string) => request<DeliveryOrder>('GET', `/api/delivery/orders/${id}`),
  // what books money or stock goes with a key held until the server answers (send-once.ts): a second tap, or a retry
  // after the link dropped, is answered with the first one and books nothing twice
  create: (input: DeliveryOrderInput) => sendOnce<DeliveryOrder>('POST', '/api/delivery/orders', input),
  update: (id: string, input: DeliveryOrderInput) => request<DeliveryOrder>('PUT', `/api/delivery/orders/${id}`, input),
  remove: (id: string) => request<void>('DELETE', `/api/delivery/orders/${id}`),
  status: (id: string, body: { status: DeliveryStatus; driverId?: string | null; reason?: string }) => request<DeliveryOrder>('POST', `/api/delivery/orders/${id}/status`, body),
  preview: (body: { warehouseId: string; fee: number; lines: DeliveryLineInput[] }) => request<DeliveryPreview>('POST', '/api/delivery/preview', body),
  drivers: (all = false) => request<Driver[]>('GET', '/api/delivery/drivers' + qs({ all: all ? '1' : undefined })),
  addDriver: (input: DriverInput) => request<Driver>('POST', '/api/delivery/drivers', input),
  updateDriver: (id: string, input: DriverInput) => request<Driver>('PUT', `/api/delivery/drivers/${id}`, input),
  handovers: (driverId?: string) => request<Handover[]>('GET', '/api/delivery/handovers' + qs({ driverId })),
  handOver: (body: { driverId: string; amount: number; cashAccountCode: string; note?: string }) => sendOnce<Handover>('POST', '/api/delivery/handovers', body),
  cancelHandover: (id: string) => sendOnce<{ cancelled: true; reversalId: string | null }>('POST', `/api/delivery/handovers/${id}/cancel`, {})
};

// ——— debt reminders ———

export interface ReminderRow {
  partyId: string; code: string; name: string; phone: string; lang: Lang | null; balance: number; owed: Record<CurrencyCode, number>;
  oldestDays: number; lastRemindedAt: string | null; reminders: number;
}
export interface ReminderLog { id: string; partyId: string; amount: number; currency: CurrencyCode; days: number; lang: Lang; createdBy: string; createdAt: string }

export const remindersApi = {
  list: (f: { minDays?: string; minAmount?: string } = {}) => request<{ rows: ReminderRow[] }>('GET', '/api/debt-reminders' + qs(f)),
  log: (body: { partyId: string; amount: number; currency: CurrencyCode; days: number; lang: Lang }) => request<ReminderLog>('POST', '/api/debt-reminders', body),
  ofParty: (partyId: string) => request<ReminderLog[]>('GET', `/api/parties/${partyId}/reminders`)
};

// ——— price checkers ———

export interface PriceCheckerDevice { id: string; name: string; warehouseId: string | null; createdBy: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null }
export interface CheckerOffer {
  names: Names; kind: OfferKind; endsOn: string | null;
  buyMilli: number | null; getMilli: number | null; getPercent: number | null; bundleMilli: number | null; bundlePrice: number | null; price: number | null; percentOff: number | null;
}
export interface PriceCheck { found: boolean; name?: Names; unit?: UnitCode; price?: number; currency?: CurrencyCode; image?: string | null; offers?: CheckerOffer[] }
export interface SlideOffer extends CheckerOffer { items: { name: Names; price: number; currency: CurrencyCode; unit: UnitCode; image: string | null }[] }

export const priceCheckerApi = {
  devices: () => request<{ available: boolean; devices: PriceCheckerDevice[] }>('GET', '/api/price-checker/devices'),
  add: (body: { name: string; warehouseId?: string | null }) => request<{ device: PriceCheckerDevice; token: string }>('POST', '/api/price-checker/devices', body),
  revoke: (id: string) => request<PriceCheckerDevice>('POST', `/api/price-checker/devices/${id}/revoke`, {})
};

export const PRICE_CHECKER_HEADER = 'x-qasa-price-checker';

/**
 * The two lookups of a price checker screen: with its device token, never a session (the page has none). A plain
 * fetch, so the app's sign-in, busy bar and outbox stay out of it.
 */
export async function deviceGet<T>(path: string, token: string, fetcher: typeof fetch = fetch): Promise<T> {
  const res = await fetcher(path, { headers: { [PRICE_CHECKER_HEADER]: token }, credentials: 'omit', cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error(`price checker ${res.status}`), { status: res.status });
  return (await res.json()) as T;
}

// ——— daily-delivery suppliers ———

export interface DailyItem {
  itemId: string; code: string; name: Names; unit: UnitCode; sort: number; unitCost?: number | null;
  lastReceivedMilli: number | null; lastReturnedMilli: number | null; returnableMilli: number; lastDate: string | null;
}
export interface DailySheet { partyId: string; partyName: string; balance: number; date: string; items: DailyItem[]; doneToday: boolean }
export interface DailySupplierRow { partyId: string; name: string; items: number; balance: number; doneToday: boolean }
export interface DailyReceipt {
  id: string; partyId: string; date: string; warehouseId: string; purchaseId: string | null; purchaseNumber: string | null;
  returns: { id: string; number: string | null; total?: number }[]; received?: number; returned?: number; createdBy: string; createdAt: string;
  lines: { itemId: string; receivedMilli: number; returnedMilli: number; unitCost?: number }[];
}
export interface DailyLineInput { itemId: string; receivedMilli: number; returnedMilli: number; unitCost?: number }

export const dailyApi = {
  suppliers: () => request<DailySupplierRow[]>('GET', '/api/daily-suppliers'),
  sheet: (partyId: string, date?: string) => request<DailySheet>('GET', `/api/daily-suppliers/${partyId}/sheet` + qs({ date })),
  setItems: (partyId: string, items: { itemId: string; unitCost?: number | null | undefined }[]) => request<DailySheet>('PUT', `/api/daily-suppliers/${partyId}/items`, { items }),
  receipts: (partyId: string) => request<DailyReceipt[]>('GET', `/api/daily-suppliers/${partyId}/receipts`),
  /** again: the supplier came a second time that day (the server refuses a second sheet otherwise: ds_sheet_exists) */
  save: (body: { partyId: string; date: string; warehouseId: string; notes?: string; again?: boolean; lines: DailyLineInput[] }) => sendOnce<DailyReceipt>('POST', '/api/daily-suppliers/receipts', body)
};
