import type { CurrencyCode, EntryType, InvoiceDocKind, Names, PrintDoc, UnitCode } from '@qasa/core';
import type { EntryView, InvoiceView } from '../api.ts';
import type { QuoteView } from './quotes-api.ts';

/**
 * What a printed paper says, whatever it came from (an invoice, a quotation, a voucher, a POS sale). The print
 * designer's preview fills one with a sample; the pages fill it from what they show. PrintDocument draws it.
 */

export interface PrintItemLine {
  itemId: string | null;
  code: string | null;
  barcode: string | null;
  /** an item's names, or free text (quotation lines, descriptions) */
  name: Names | string;
  description: string;
  unit: UnitCode | null;
  qtyMilli: number;
  unitPrice: number;
  /** lines have no discount of their own: a discount is on the whole paper (PrintModel.discount) */
  amount: number;
}

export interface PrintAccountLine { accountCode: string; accountName: Names; description: string; debit: number; credit: number }

export interface PrintModel {
  doc: PrintDoc;
  /** a text key of the app: sale, purchase, sale_return, receipt, payment, qt_quotation… */
  titleKey: string;
  number: string | null;
  date: string;
  validUntil: string | null;
  status: 'draft' | 'final' | 'cancelled';
  partyRole: 'customer' | 'supplier' | 'party';
  party: { name: string; code: string | null; phone: string | null; address: string | null } | null;
  currency: CurrencyCode;
  rateX100: number;
  lines: PrintItemLine[];
  accountLines: PrintAccountLine[];
  subtotal: number;
  discount: number;
  total: number;
  /** the total in IQD (for the USD-equivalent line, the other way round on a USD paper) */
  baseTotal: number;
  /** what the party owes after this paper, in IQD, when known */
  partyBalance: number | null;
  notes: string;
  /** a document's own terms (quotations); the design's terms print when this is empty */
  terms: string;
  /** a posted sale invoice: its verify code */
  verifyInvoiceId: string | null;
  preparedBy: string;
}

const docOfInvoice = (kind: InvoiceDocKind): PrintDoc => (kind === 'sale' ? 'sale' : kind === 'purchase' ? 'purchase' : 'return');

export function invoiceModel(v: InvoiceView, extra: { barcodes?: Map<string, string>; partyBalance?: number | null; pos?: boolean } = {}): PrintModel {
  const saleSide = v.kind === 'sale' || v.kind === 'sale_return';
  return {
    doc: extra.pos ? 'pos' : docOfInvoice(v.kind),
    titleKey: v.kind,
    number: v.number,
    date: v.date,
    validUntil: null,
    status: v.status === 'posted' ? 'final' : v.status === 'cancelled' ? 'cancelled' : 'draft',
    partyRole: saleSide ? 'customer' : 'supplier',
    party: v.partyName ? { name: v.partyName, code: v.partyCode, phone: v.partyPhone, address: v.partyAddress } : null,
    currency: v.currency,
    rateX100: v.rateX100,
    lines: v.lines.map((l) => ({
      itemId: l.itemId, code: l.itemCode, barcode: extra.barcodes?.get(l.itemId) ?? null, name: l.itemName, description: l.description,
      unit: l.unit, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, amount: l.amount
    })),
    accountLines: [],
    subtotal: v.subtotal,
    discount: v.discount,
    total: v.total,
    baseTotal: v.baseTotal,
    partyBalance: extra.partyBalance ?? null,
    notes: v.notes,
    terms: '',
    verifyInvoiceId: v.kind === 'sale' && v.status === 'posted' ? v.id : null,
    preparedBy: v.createdBy
  };
}

export function quoteModel(x: QuoteView): PrintModel {
  return {
    doc: 'quote',
    titleKey: 'qt_quotation',
    number: x.number,
    date: x.date,
    validUntil: x.validUntil,
    status: x.status === 'cancelled' ? 'cancelled' : x.status === 'draft' ? 'draft' : 'final',
    partyRole: 'customer',
    party: x.party ? { name: x.party.name, code: x.party.code, phone: x.party.phone || null, address: x.party.address || null }
      : x.customerName ? { name: x.customerName, code: null, phone: null, address: null } : null,
    currency: x.currency,
    rateX100: 100,
    lines: x.lines.map((l) => ({
      itemId: l.itemId, code: l.itemCode, barcode: null, name: l.description, description: '', unit: null,
      qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, amount: l.amount
    })),
    accountLines: [],
    subtotal: x.subtotal,
    discount: x.discount,
    total: x.total,
    baseTotal: x.currency === 'IQD' ? x.total : 0,
    partyBalance: null,
    notes: x.notes,
    terms: x.terms,
    verifyInvoiceId: null,
    preparedBy: x.createdBy
  };
}

const VOUCHER_TYPES: readonly EntryType[] = ['receipt', 'payment'] as EntryType[];

export function entryModel(e: EntryView): PrintModel {
  return {
    doc: 'voucher',
    titleKey: e.type === 'closing' ? 'closingEntry' : e.type,
    number: e.number,
    date: e.date,
    validUntil: null,
    status: e.status === 'approved' ? 'final' : 'draft',
    partyRole: 'party',
    party: e.party ? { name: e.party, code: null, phone: null, address: null } : null,
    currency: e.currency,
    rateX100: e.rateX100,
    lines: [],
    accountLines: e.lines.map((l) => ({ accountCode: l.accountCode, accountName: l.accountName, description: l.description, debit: l.debit, credit: l.credit })),
    subtotal: e.total,
    discount: 0,
    total: e.total,
    baseTotal: e.baseTotal,
    partyBalance: null,
    notes: e.description,
    terms: '',
    verifyInvoiceId: null,
    preparedBy: e.preparedBy
  };
}

/** Receipt and payment vouchers print with the voucher design; other journal entries too (one design for vouchers). */
export const isVoucherType = (t: EntryType) => VOUCHER_TYPES.includes(t);

/** The designer's sample paper, in the language being previewed. */
export function sampleModel(doc: PrintDoc): PrintModel {
  const names = (ar: string, en: string, ku: string): Names => ({ ar, en, ku });
  if (doc === 'voucher') {
    return {
      ...sampleModel('sale'), doc, titleKey: 'receipt', number: 'RV-2026-0042', lines: [], partyRole: 'party',
      accountLines: [
        { accountCode: '1811', accountName: names('الصندوق الرئيسي', 'Main safe', 'سندوقی سەرەکی'), description: '', debit: 1_250_000, credit: 0 },
        { accountCode: '1611', accountName: names('العملاء', 'Customers', 'کڕیاران'), description: '', debit: 0, credit: 1_250_000 }
      ],
      subtotal: 1_250_000, discount: 0, total: 1_250_000, baseTotal: 1_250_000, verifyInvoiceId: null
    };
  }
  const lines: PrintItemLine[] = [
    { itemId: 'a', code: 'P-101', barcode: '6260000000017', name: names('فلتر زيت تويوتا', 'Toyota oil filter', 'فلتەری زەیتی تۆیۆتا'), description: '', unit: 'piece', qtyMilli: 4000, unitPrice: 15_000, amount: 60_000 },
    { itemId: 'b', code: 'P-205', barcode: '6260000000024', name: names('زيت محرك 5W-30 ‏4 لتر', 'Engine oil 5W-30, 4 L', 'زەیتی بزوێنەر 5W-30 ‏4 لیتر'), description: '', unit: 'piece', qtyMilli: 2000, unitPrice: 40_000, amount: 80_000 },
    { itemId: 'c', code: 'S-001', barcode: null, name: names('أجور تبديل', 'Fitting labour', 'کرێی گۆڕین'), description: '', unit: 'service', qtyMilli: 1000, unitPrice: 10_000, amount: 10_000 }
  ];
  const purchase = doc === 'purchase';
  return {
    doc,
    titleKey: doc === 'quote' ? 'qt_quotation' : doc === 'return' ? 'sale_return' : purchase ? 'purchase' : 'sale',
    number: doc === 'quote' ? 'QT-2026-0007' : 'INV-2026-0128',
    date: '2026-11-07',
    validUntil: doc === 'quote' ? '2026-11-21' : null,
    status: 'final',
    partyRole: purchase ? 'supplier' : 'customer',
    // sample parties are named after what they are and where, never after a person
    party: { name: purchase ? 'شركة قطع الغيار الحديثة' : 'كراج الجسر', code: 'C-0012', phone: '0770 123 4567', address: 'أربيل، شارع 60' },
    currency: 'IQD',
    rateX100: 100,
    lines,
    accountLines: [],
    subtotal: 150_000,
    discount: 5_000,
    total: 145_000,
    baseTotal: 145_000,
    partyBalance: 395_000,
    notes: '',
    terms: '',
    verifyInvoiceId: doc === 'sale' || doc === 'pos' ? 'sample' : null,
    preparedBy: 'Mer'
  };
}
