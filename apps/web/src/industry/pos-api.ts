import type { CurrencyCode, Names, UnitCode } from '@qasa/core';
import { qs, request, type InvoiceView } from '../api.ts';

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
  methods?: Partial<Record<PosMethod, Money2>>;
  expected: Money2;
  counted: Money2 | null;
  difference: Money2 | null;
  notes: string;
  actions: ('sell' | 'close')[];
}

export interface ShiftSaleView { invoiceId: string; number: string | null; createdAt: string; partyName: string | null; currency: CurrencyCode; total: number; status: string }

export interface ShiftReport extends ShiftView {
  invoices: ShiftSaleView[];
  items: { itemId: string; code: string; name: Names; qtyMilli: number; amount: Money2 }[];
}

export interface OpenShiftInput { register: string; cashAccountCode: string; warehouseId: string; openingCash: number; notes?: string }
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
  /** qtyMilli in base units, or unit + unitQtyMilli: the quantity in one of the item's units, priced per that unit */
  lines: (({ itemId: string; qtyMilli: number; unitPrice: number } | { itemId: string; unit: UnitCode; unitQtyMilli: number; unitPrice: number }) & { batchId?: string })[];
}

/** How a customer pays at the counter (1.1). */
export type PosMethod = 'cash' | 'card' | 'fib' | 'zaincash' | 'qi' | 'account';
export type PosAccounts = Partial<Record<'card' | 'fib' | 'zaincash' | 'qi', string>>;

export const posApi = {
  current: () => request<{ shift: ShiftView | null }>('GET', '/api/pos/current'),
  /** the methods the counter offers (cash and on account always; the others once they have an account) */
  paymentAccounts: () => request<{ accounts: PosAccounts; methods: PosMethod[] }>('GET', '/api/pos/payment-accounts'),
  setPaymentAccounts: (accounts: PosAccounts) => request<{ accounts: PosAccounts; methods: PosMethod[] }>('PUT', '/api/pos/payment-accounts', accounts),
  shifts: (f: { status?: 'open' | 'closed'; limit?: string } = {}) => request<ShiftView[]>('GET', '/api/pos/shifts' + qs(f)),
  shift: (id: string) => request<ShiftReport>('GET', `/api/pos/shifts/${id}`),
  open: (input: OpenShiftInput) => request<ShiftView>('POST', '/api/pos/shifts', input),
  sell: (shiftId: string, input: SaleInput) => request<{ invoice: InvoiceView; shift: ShiftView }>('POST', `/api/pos/shifts/${shiftId}/sales`, input),
  close: (shiftId: string, body: { countedCash: number; countedUsd?: number; notes?: string }) => request<ShiftView>('POST', `/api/pos/shifts/${shiftId}/close`, body)
};
