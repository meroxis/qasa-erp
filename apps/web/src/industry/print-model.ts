import type { CurrencyCode, EntryType, InvoiceDocKind, Lang, Names, PrintDoc, UnitCode } from '@qasa/core';
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
  /** what the party owed before this paper, in IQD, when known */
  previousBalance: number | null;
  /** where the two balances come from when the design prints them and the page did not fill them in */
  balanceOf?: PrintBalanceOf | null;
  notes: string;
  /** a document's own terms (quotations); the design's terms print when this is empty */
  terms: string;
  /** a posted sale invoice: its verify code */
  verifyInvoiceId: string | null;
  preparedBy: string;
  /** a till's cash sale: the cash handed over and the change given back, printed under the total */
  tender?: { paid: number; change: number } | null;
}

/**
 * The party whose balance a paper prints, and how to find the paper in the party's statement: a posted paper by its
 * entry or invoice (the balance before it and after it); one not posted yet by what it will change (rawEffect: its
 * debit less its credit on the party, in IQD); neither (a quotation) prints the balance as it stands.
 */
export interface PrintBalanceOf {
  partyId: string;
  /** the paper's date: the statement is read up to it */
  date: string;
  /** the paper's own entries (an invoice: its entry and those of the money taken with it) */
  entryIds?: readonly string[];
  invoiceId?: string | null;
  rawEffect?: number;
}

/** What balancesAround reads of a party's statement (api.partyStatement). */
export interface StatementForBalance {
  party: { type: string };
  closing: number;
  lines: readonly { entryId: string; invoiceId: string | null; debit: number; credit: number; balance: number }[];
}

/**
 * The party's balance before a paper and after it, from the statement read up to the paper's date. Balances are in the
 * party's own direction (what a customer owes, what a supplier is owed), as on the statement. Papers entered later on
 * the same day are left out: "after" is the balance right after this paper, not the day's last.
 */
export function balancesAround(st: StatementForBalance, of: Pick<PrintBalanceOf, 'entryIds' | 'invoiceId' | 'rawEffect'>): { previous: number | null; after: number } {
  const sign = st.party.type === 'customer' ? 1 : -1;
  const mine = (l: StatementForBalance['lines'][number]) => !!of.entryIds?.includes(l.entryId) || (!!of.invoiceId && l.invoiceId === of.invoiceId);
  const first = st.lines.findIndex(mine);
  if (first >= 0) {
    let last = first;
    for (let i = first; i < st.lines.length; i++) if (mine(st.lines[i]!)) last = i;
    const start = st.lines[first]!;
    return { previous: start.balance - sign * (start.debit - start.credit), after: st.lines[last]!.balance };
  }
  if (typeof of.rawEffect === 'number') return { previous: st.closing, after: st.closing + sign * of.rawEffect };
  return { previous: null, after: st.closing };
}

/**
 * The words for the party's balance after a paper, by the kind of paper: what is left on a voucher ("Remaining
 * balance"), the account as it stands on a quotation (which changes nothing), and the balance after the invoice on
 * every other paper. The paper prints them and the designer names its option by them.
 */
export function balanceLabelKey(doc: PrintDoc): 'pd_h_remainingBalance' | 'pd_h_currentBalance' | 'pd_h_balance' {
  return doc === 'voucher' ? 'pd_h_remainingBalance' : doc === 'quote' ? 'pd_h_currentBalance' : 'pd_h_balance';
}

/** The title of a till's receipt: the same on the standard receipt, on a designed one and in the designer's preview. */
export const POS_TITLE = 'pos_receipt';

const docOfInvoice = (kind: InvoiceDocKind): PrintDoc => (kind === 'sale' ? 'sale' : kind === 'purchase' ? 'purchase' : 'return');

export function invoiceModel(v: InvoiceView, extra: { barcodes?: Map<string, string>; partyBalance?: number | null; pos?: boolean } = {}): PrintModel {
  const saleSide = v.kind === 'sale' || v.kind === 'sale_return';
  return {
    doc: extra.pos ? 'pos' : docOfInvoice(v.kind),
    // a till's receipt is headed "Sales receipt" (وەسڵی فرۆشتن), as the standard receipt and the designer's preview are
    titleKey: extra.pos ? POS_TITLE : v.kind,
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
      unit: l.lineUnit ?? l.unit, qtyMilli: l.lineUnit && l.unitQtyMilli !== null ? l.unitQtyMilli : l.qtyMilli, unitPrice: l.unitPrice, amount: l.amount
    })),
    accountLines: [],
    subtotal: v.subtotal,
    discount: v.discount,
    total: v.total,
    baseTotal: v.baseTotal,
    partyBalance: extra.partyBalance ?? null,
    previousBalance: null,
    balanceOf: v.partyId && v.status === 'posted' ? { partyId: v.partyId, date: v.date, invoiceId: v.id, entryIds: [v.entryId, ...(v.payments ?? []).map((p) => p.entryId)].filter((id): id is string => !!id) } : null,
    notes: v.notes,
    terms: '',
    verifyInvoiceId: v.kind === 'sale' && v.status === 'posted' ? v.id : null,
    preparedBy: v.createdBy,
    tender: v.tender ?? null
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
    previousBalance: null,
    // a quotation changes nobody's balance: the customer's balance as it stands on the quotation's date
    balanceOf: x.party && x.status !== 'cancelled' ? { partyId: x.party.id, date: x.date } : null,
    notes: x.notes,
    terms: x.terms,
    verifyInvoiceId: null,
    preparedBy: x.createdBy
  };
}

const VOUCHER_TYPES: readonly EntryType[] = ['receipt', 'payment'] as EntryType[];

/** The customer or supplier a voucher is about: the first of its lines that names one, with what the voucher changes on them. */
export function entryParty(e: Pick<EntryView, 'lines'>): { partyId: string; name: string | null; rawEffect: number } | null {
  const line = e.lines.find((l) => l.partyId);
  if (!line?.partyId) return null;
  const rawEffect = e.lines.filter((l) => l.partyId === line.partyId).reduce((sum, l) => sum + l.baseDebit - l.baseCredit, 0);
  return { partyId: line.partyId, name: line.partyName, rawEffect };
}

/** Whether a line's note only repeats the paper's own (the same words, whatever the spaces around them). */
const sameNote = (line: string | null | undefined, paper: string | null | undefined): boolean => !!line && line.trim() === (paper ?? '').trim();

export function entryModel(e: EntryView): PrintModel {
  const about = entryParty(e);
  const partyName = e.party || about?.name || null;
  return {
    doc: 'voucher',
    titleKey: e.type === 'closing' ? 'closingEntry' : e.type,
    number: e.number,
    date: e.date,
    validUntil: null,
    status: e.status === 'approved' ? 'final' : 'draft',
    partyRole: 'party',
    party: partyName ? { name: partyName, code: null, phone: null, address: null } : null,
    currency: e.currency,
    rateX100: e.rateX100,
    lines: [],
    // a voucher's lines carry the voucher's own note unless a line was given one of its own: the note prints once, at
    // the foot (PrintModel.notes), and a line keeps only a note that says something else
    accountLines: e.lines.map((l) => ({
      accountCode: l.accountCode, accountName: l.accountName, description: sameNote(l.description, e.description) ? '' : l.description, debit: l.debit, credit: l.credit
    })),
    subtotal: e.total,
    discount: 0,
    total: e.total,
    baseTotal: e.baseTotal,
    partyBalance: null,
    previousBalance: null,
    // approved: found in the statement by its entry; before that: what it will change once approved
    balanceOf: about ? { partyId: about.partyId, date: e.date, entryIds: [e.id], rawEffect: about.rawEffect } : null,
    notes: e.description,
    terms: '',
    verifyInvoiceId: null,
    preparedBy: e.preparedBy
  };
}

/** Receipt and payment vouchers print with the voucher design; other journal entries too (one design for vouchers). */
export const isVoucherType = (t: EntryType) => VOUCHER_TYPES.includes(t);

/** The note on the sample voucher (a voucher's note is what its preparer typed: in the language being previewed). */
const SAMPLE_NOTE: Names = { ar: 'دفعة عن الفاتورة INV-2026-0128', en: 'Payment for invoice INV-2026-0128', ku: 'پارەدان بۆ پسوولەی INV-2026-0128' };

/** The designer's sample paper, in the language being previewed. */
export function sampleModel(doc: PrintDoc, lang: Lang = 'ar'): PrintModel {
  const names = (ar: string, en: string, ku: string): Names => ({ ar, en, ku });
  if (doc === 'voucher') {
    const sale = sampleModel('sale', lang);
    // A receipt in dollars with a note, so every switch of the designer changes the preview: "Notes" shows the note,
    // "Exchange rate" the rate the dollars were taken at, "Equivalent" the same money in dinars. $850.00 at 1,420
    // is 1,207,000 dinars, taken off what the customer owed.
    return {
      ...sale, doc, titleKey: 'receipt', number: 'RV-2026-0042', lines: [], partyRole: 'party',
      currency: 'USD', rateX100: 142_000, notes: SAMPLE_NOTE[lang],
      // as entryModel builds a real voucher: the party by name only
      party: sale.party && { name: sale.party.name, code: null, phone: null, address: null },
      accountLines: [
        { accountCode: '1811', accountName: names('الصندوق الرئيسي', 'Main safe', 'قاسەی سەرەکی'), description: '', debit: 85_000, credit: 0 },
        { accountCode: '1611', accountName: names('العملاء', 'Customers', 'کڕیاران'), description: '', debit: 0, credit: 85_000 }
      ],
      subtotal: 85_000, discount: 0, total: 85_000, baseTotal: 1_207_000, verifyInvoiceId: null,
      previousBalance: 1_645_000, partyBalance: 438_000
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
    titleKey: doc === 'quote' ? 'qt_quotation' : doc === 'return' ? 'sale_return' : purchase ? 'purchase' : doc === 'pos' ? POS_TITLE : 'sale',
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
    previousBalance: 250_000,
    notes: '',
    terms: '',
    verifyInvoiceId: doc === 'sale' || doc === 'pos' ? 'sample' : null,
    preparedBy: 'Mer'
  };
}
