import type { CurrencyCode, Names, UnitCode } from '@qasa/core';
import { qs, request, type InvoiceView, type SendOptions } from '../api.ts';

/** Point of sale (every plan): shifts on a register, and cash sales posted at once. */

export type Money2 = { IQD: number; USD: number };

export interface ShiftView {
  id: string;
  number: string;
  register: string;
  cashAccountCode: string;
  warehouseId: string;
  status: 'open' | 'closed';
  openedBy: string;
  openedAt: string;
  openingCash: number;
  closedBy: string | null;
  closedAt: string | null;
  sales: Money2;
  count: number;
  /** cash sales returns paid from the shift's safe while it was open */
  refunds: Money2;
  /** 1.1: the posted sales by how they were paid (older servers leave it out) */
  methods?: Partial<Record<PosMethod | 'loyalty', Money2>>;
  expected: Money2;
  counted: Money2 | null;
  difference: Money2 | null;
  notes: string;
  actions: ('sell' | 'close')[];
  /** 2.0: a cashier who closes blind reads no totals (the server leaves them at zero) */
  blind?: true;
  /** 2.0: the named till the shift is on (older servers leave it out) */
  tillId?: string | null;
  /** 2.0: dollar notes taken for dinar sales (usd in cents) and the dinars they stood for */
  usdTaken?: { usd: number; iqd: number };
}

export interface ShiftSaleView {
  invoiceId: string; number: string | null; createdAt: string; partyName: string | null; currency: CurrencyCode; total: number; status: string;
  /** 1.2: sold while the till was offline: the temporary reference on its receipt */
  offlineRef?: string;
}

export interface ShiftReport extends ShiftView {
  invoices: ShiftSaleView[];
  items: { itemId: string; code: string; name: Names; qtyMilli: number; amount: Money2 }[];
  /** 2.0.0: gift vouchers sold at this till and used on its sales */
  gift?: { soldCount: number; sold: number; used: number };
}

export interface OpenShiftInput { tillId?: string; register: string; cashAccountCode: string; warehouseId: string; openingCash: number; notes?: string }
export interface SaleInput {
  currency: CurrencyCode;
  rateX100?: number;
  partyId?: string;
  discount: number;
  notes?: string;
  /** the cashier confirmed selling stock past its expiry date (only when the company allows it) */
  allowExpired?: boolean;
  /** 1.1: how it was paid, 1–4 parts adding up to the total; none = all cash */
  payments?: { method: PosMethod; amount: number }[];
  /** 1.2 (Pro): loyalty points the customer uses on this sale */
  loyaltyPoints?: number;
  /** 1.4: the cash the customer handed over for a cash sale (kept so a later copy of the receipt prints it and the change) */
  tendered?: number;
  /** 2.0: a dinar sale paid partly in dollar notes: the dollars (cents) and the rate they were taken at */
  usdCash?: { amount: number; rateX100: number };
  /** 2.0: approvals a supervisor gave at this till (pos/rules-api.ts) */
  approvals?: string[];
  /** 2.0: gift vouchers that pay part of the sale */
  vouchers?: { code: string; amount: number }[];
  /** qtyMilli in base units, or unit + unitQtyMilli: the quantity in one of the item's units, priced per that unit */
  lines: (({ itemId: string; qtyMilli: number; unitPrice: number } | { itemId: string; unit: UnitCode; unitQtyMilli: number; unitPrice: number }) & { batchId?: string })[];
}

/** How a customer pays at the counter (1.1). */
export type PosMethod = 'cash' | 'card' | 'fib' | 'zaincash' | 'qi' | 'account';

/** 2.0: a named till (Settings → Sales and point of sale → Tills). */
export interface TillView {
  id: string; name: string; cashAccountCode: string; warehouseId: string; drawer: 'off' | 'cash'; customerDisplay: boolean; active: boolean; openShiftId: string | null;
}
export interface TillInput { name: string; cashAccountCode: string; warehouseId: string; drawer?: 'off' | 'cash'; customerDisplay?: boolean; active?: boolean }
export interface TillSummaryRow {
  tillId: string | null; register: string; shifts: number; sales: Money2; count: number; methods: Record<string, number>; difference: Money2; noSale: number;
}
export type PosAccounts = Partial<Record<'card' | 'fib' | 'zaincash' | 'qi', string>>;

export const tillsApi = {
  list: () => request<{ tills: TillView[]; multiTill: boolean }>('GET', '/api/pos/tills'),
  create: (input: TillInput) => request<TillView>('POST', '/api/pos/tills', input),
  update: (id: string, input: TillInput) => request<TillView>('PUT', `/api/pos/tills/${id}`, input),
  summary: (f: { from?: string; to?: string } = {}) => request<{ from: string; to: string; rows: TillSummaryRow[] }>('GET', '/api/pos/tills/summary' + qs(f)),
  /** the drawer opened with no sale: written to the audit log before the drawer opens */
  drawer: (shiftId: string, reason = '', approvals?: string[]) => request<{ opened: number }>('POST', `/api/pos/shifts/${shiftId}/drawer`, { reason, ...(approvals?.length ? { approvals } : {}) }),
  scale: () => request<{ pricePrefixes: string[]; itemDigits?: 4 | 5 }>('GET', '/api/pos/scale'),
  setScale: (pricePrefixes: string[], itemDigits?: 4 | 5) => request<{ pricePrefixes: string[]; itemDigits?: 4 | 5 }>('PUT', '/api/pos/scale', { pricePrefixes, ...(itemDigits ? { itemDigits } : {}) }),
  paymentAccounts: () => request<{ accounts: PosAccounts; methods: PosMethod[] }>('GET', '/api/pos/payment-accounts'),
  setPaymentAccounts: (accounts: PosAccounts) => request<{ accounts: PosAccounts; methods: PosMethod[] }>('PUT', '/api/pos/payment-accounts', accounts)
};

export const posApi = {
  /** 2.0: on a PC that picked a till, that till's open shift only */
  current: (tillId?: string | null) => request<{ shift: ShiftView | null }>('GET', '/api/pos/current' + (tillId ? qs({ tillId }) : '')),
  shifts: (f: { status?: 'open' | 'closed'; limit?: string } = {}) => request<ShiftView[]>('GET', '/api/pos/shifts' + qs(f)),
  shift: (id: string) => request<ShiftReport>('GET', `/api/pos/shifts/${id}`),
  open: (input: OpenShiftInput) => request<ShiftView>('POST', '/api/pos/shifts', input),
  /** options (1.2): the sale's idempotency key on a PC with an outbox, and how long to wait before keeping it there */
  sell: (shiftId: string, input: SaleInput, options: SendOptions = {}) => request<{ invoice: InvoiceView; shift: ShiftView; rounding?: number }>('POST', `/api/pos/shifts/${shiftId}/sales`, input, options),
  close: (shiftId: string, body: { countedCash: number; countedUsd?: number; notes?: string }) => request<ShiftView>('POST', `/api/pos/shifts/${shiftId}/close`, body),
  /** 2.0.0: a till sale by its receipt number, and a return of it paid back from the shift (till-returns.ts) */
  findSale: (shiftId: string, q: string) => request<InvoiceView>('GET', `/api/pos/shifts/${shiftId}/sale` + qs({ q })),
  giveBack: (shiftId: string, body: { invoiceId: string; lines: { lineNo: number; qtyMilli: number }[]; approvals?: string[] }, options: SendOptions = {}) =>
    request<InvoiceView>('POST', `/api/pos/shifts/${shiftId}/returns`, body, options)
};
