import { isIsoDate } from './dates.ts';
import { isCurrency, isMinorAmount, type CurrencyCode } from './money.ts';
import { lineAmount } from './inventory.ts';

/** sale = فاتورة مبيعات · purchase = فاتورة شراء */
export type InvoiceKind = 'sale' | 'purchase';
/** cash = نقدي (paid now into/out of a safe or bank) · credit = آجل (customer/supplier owes) */
export type PaymentMode = 'cash' | 'credit';
export type InvoiceStatus = 'draft' | 'posted' | 'cancelled';
/** sale_return = مردودات المبيعات · purchase_return = مردودات المشتريات; always made from a posted invoice */
export type ReturnKind = 'sale_return' | 'purchase_return';
/** Every kind of document kept in the invoices list. */
export type InvoiceDocKind = InvoiceKind | ReturnKind;

export function returnKindOf(kind: InvoiceKind): ReturnKind {
  return kind === 'sale' ? 'sale_return' : 'purchase_return';
}

export interface InvoiceLineInput {
  itemId: string;
  qtyMilli: number;
  /** Price per unit in the invoice currency's minor units (sale price or purchase cost). */
  unitPrice: number;
  description?: string;
}

export interface InvoiceInput {
  kind: InvoiceKind;
  date: string;
  partyId?: string;
  warehouseId: string;
  currency: CurrencyCode;
  rateX100: number;
  payment: PaymentMode;
  /** The safe or bank account for cash invoices. */
  cashAccountCode?: string;
  /** Discount on the whole invoice, in the invoice currency's minor units. */
  discount: number;
  notes?: string;
  lines: InvoiceLineInput[];
}

export interface InvoiceTotals {
  lineAmounts: number[];
  subtotal: number;
  discount: number;
  total: number;
}

export function invoiceTotals(lines: Pick<InvoiceLineInput, 'qtyMilli' | 'unitPrice'>[], discount: number): InvoiceTotals {
  const lineAmounts = lines.map((l) => lineAmount(l.qtyMilli, l.unitPrice));
  const subtotal = lineAmounts.reduce((s, a) => s + a, 0);
  return { lineAmounts, subtotal, discount, total: subtotal - discount };
}

export type InvoiceError =
  | { code: 'date_invalid' }
  | { code: 'currency_invalid' }
  | { code: 'rate_invalid' }
  | { code: 'party_required' }
  | { code: 'cash_account_invalid' }
  | { code: 'lines_required' }
  | { code: 'line_qty_invalid'; line: number }
  | { code: 'line_price_invalid'; line: number }
  | { code: 'discount_invalid' };

/** Checks that need no database. Items, stock, parties and period locks are checked by the server. */
export function validateInvoice(input: InvoiceInput): InvoiceError[] {
  const errors: InvoiceError[] = [];
  if (!isIsoDate(input.date)) errors.push({ code: 'date_invalid' });
  if (!isCurrency(input.currency)) errors.push({ code: 'currency_invalid' });
  if (input.currency === 'USD' && (!isMinorAmount(input.rateX100) || input.rateX100 <= 0)) errors.push({ code: 'rate_invalid' });
  if (input.payment === 'credit' && !input.partyId) errors.push({ code: 'party_required' });
  if (input.payment === 'cash' && (!input.cashAccountCode || !input.cashAccountCode.startsWith('18'))) errors.push({ code: 'cash_account_invalid' });
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    errors.push({ code: 'lines_required' });
    return errors;
  }
  input.lines.forEach((l, i) => {
    if (!isMinorAmount(l.qtyMilli) || l.qtyMilli <= 0) errors.push({ code: 'line_qty_invalid', line: i + 1 });
    if (!isMinorAmount(l.unitPrice) || l.unitPrice < 0) errors.push({ code: 'line_price_invalid', line: i + 1 });
  });
  const totals = invoiceTotals(input.lines, 0);
  if (!isMinorAmount(input.discount) || input.discount < 0 || input.discount > totals.subtotal) errors.push({ code: 'discount_invalid' });
  return errors;
}
