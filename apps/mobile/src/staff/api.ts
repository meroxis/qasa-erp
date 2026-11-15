import { ok, q, safeId } from '../answers';
import type { Currency, Item, Names } from '../api';
import type { Lang } from '../i18n';
import type { OfficeLink } from '../link';

/**
 * The office's answers and calls of phone app 1.1's staff features (the same shapes as the desktop app's API). The
 * phone link checks each of them again (pro/src/phone/staff-routes.ts), and so does the office's own API.
 */

/** A safe, bank or wallet, by name (a phone never gets what one holds). */
export interface MoneyAccount { code: string; name: Names; kind?: string; currency?: Currency | null }

/** A voucher as the office answers it (what the screens read of it). */
export interface VoucherAnswer {
  id: string; number?: string | null; status?: string; currency?: Currency; rateX100?: number; total?: number;
  approval?: { state: 'waiting' | 'rejected' | 'approved' } | null;
  image?: { bytes: number; createdBy: string; createdAt: string } | null;
}

export interface InvoiceSummary {
  id: string; kind: string; status: string; number: string | null; date: string; partyId: string | null; partyName: string | null;
  currency: Currency; total: number; payment: 'cash' | 'credit';
}

export interface InvoiceLine {
  lineNo: number; itemId: string; itemCode: string; itemName: Names; unit: string; description: string; qtyMilli: number; unitPrice: number; amount: number;
  lineUnit: string | null; unitFactorMilli: number | null; unitQtyMilli: number | null;
}

export interface InvoiceDetail extends InvoiceSummary {
  partyPhone: string | null; partyAddress: string | null; partyLang: Lang | null;
  rateX100: number; discount: number; subtotal: number; notes: string;
  lines: InvoiceLine[];
  /** a posted credit invoice: what was received for it and what is still open */
  settlement: { currency: Currency; total: number; returned: number; received: number; waiting: number; open: number } | null;
}

/** The address an invoice's QR code holds; `licensed`: the verify page confirms who issued it (a paid plan). */
export interface InvoiceQr { url: string; licensed: boolean }

/** The company's details for its papers (Settings → Printing) and its logo, when it prints one. */
export interface PrintProfile {
  address: string; phone: string; taxNumber: string; footer: string; showLogo: boolean;
  logo: { mime: string; data: string } | null;
}

/** A print design, as far as the phone's PDF follows it. */
export interface PrintDesign { layout: string; accent: string; show?: Record<string, boolean> }
export type PrintDesigns = Partial<Record<string, PrintDesign>>;

/** A stock transfer as the office answers it (a phone never gets its value). */
export interface StockDocAnswer { id: string; kind: string; status: 'draft' | 'posted' | 'cancelled'; number: string | null }

export interface OrderSummary {
  id: string; number: string; date: string; partyId: string; partyName: string; currency: Currency; expectedDate: string | null;
  status: 'draft' | 'sent' | 'partial' | 'received' | 'cancelled'; overdue: boolean;
}

export interface OrderLine {
  seq: number; itemId: string; itemCode: string; itemName: Names; unit: string; qtyMilli: number; receivedMilli: number; remainingMilli: number;
  lineUnit: string | null; unitFactorMilli: number | null; unitQtyMilli: number | null;
}

export interface OrderDetail {
  id: string; number: string; date: string; party: { id: string; name: string; phone: string | null };
  warehouse: { id: string; code: string; name: Names } | null; currency: Currency; expectedDate: string | null;
  status: OrderSummary['status']; overdue: boolean; notes: string; lines: OrderLine[];
  receipts: { invoiceId: string; number: string | null; date: string; status: 'draft' | 'posted' | 'cancelled' }[];
}

/** A scanned barcode: the item, and the unit when it is one of the item's units' barcodes (a box). */
export interface BarcodeHit { item: (Item & { trackStock?: boolean; units?: { unit: string; factorMilli: number }[] }) | null; unit: string | null }

export function staffApi(link: OfficeLink) {
  return {
    moneyAccounts: async () => ok(await link.request<{ accounts: MoneyAccount[] }>('GET', '/api/banking/accounts')).accounts,
    /** a voucher's receipt photo as a data: URL (a JPEG only: anything else is not shown) */
    entryImage: async (id: string): Promise<string | null> => {
      const a = await link.request<{ mime: string; data: string }>('GET', `/api/entries/${safeId(id)}/image`);
      return a.s === 200 && a.b.mime === 'image/jpeg' && /^[A-Za-z0-9+/]+={0,2}$/.test(a.b.data) ? `data:image/jpeg;base64,${a.b.data}` : null;
    },
    customerInvoices: async (partyId: string, from: string) =>
      ok(await link.request<InvoiceSummary[]>('GET', '/api/invoices' + q({ kind: 'sale', status: 'posted', partyId: safeId(partyId), from }))),
    invoice: async (id: string) => ok(await link.request<InvoiceDetail>('GET', `/api/invoices/${safeId(id)}`)),
    /** the invoice's QR code, or null when the office gives none (an older office, an invoice that can't have one) */
    invoiceQr: async (id: string, lang: Lang): Promise<InvoiceQr | null> => {
      const a = await link.request<InvoiceQr>('GET', `/api/verify/invoices/${safeId(id)}` + q({ lang }));
      return a.s === 200 && typeof a.b?.url === 'string' ? { url: a.b.url, licensed: a.b.licensed === true } : null;
    },
    printProfile: async () => ok(await link.request<PrintProfile>('GET', '/api/print-profile')),
    printDesigns: async () => ok(await link.request<PrintDesigns>('GET', '/api/print-designs')),
    itemByBarcode: async (code: string) => ok(await link.request<BarcodeHit>('GET', '/api/items' + q({ barcode: code }))),
    openOrders: async () => ok(await link.request<OrderSummary[]>('GET', '/api/purchase-orders' + q({ status: 'open' }))),
    purchaseOrder: async (id: string) => ok(await link.request<OrderDetail>('GET', `/api/purchase-orders/${safeId(id)}`)),
    // ——— the changes the outbox sends, each with its own key ———
    expense: async (input: unknown, key?: string) => ok(await link.request<VoucherAnswer>('POST', '/api/expenses', input, key)),
    transfer: async (input: unknown, key?: string) => ok(await link.request<StockDocAnswer>('POST', '/api/stock-docs', input, key)),
    /** posts a transfer draft (online only), with its own key, sent again with each try of the same post */
    postTransfer: async (id: string, key: string) => ok(await link.request<StockDocAnswer>('POST', `/api/stock-docs/${safeId(id)}/post`, {}, key)),
    arrival: async (orderId: string, input: unknown, key?: string) =>
      ok(await link.request<{ id: string; status?: string; invoiceId?: string }>('POST', `/api/purchase-orders/${safeId(orderId)}/arrivals`, input, key))
  };
}
