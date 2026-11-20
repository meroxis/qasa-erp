import { applyOffers, type CurrencyCode, type Names, type OfferKind, type OfferLine, type OfferResult, type OfferRule } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Offers (1.7, Starter and up): buy X get Y, bundles, special prices and happy hours (server: offers.ts). */
export interface OfferView extends OfferRule {
  active: boolean;
  notes: string;
  /** sales that got it: such an offer is switched off, never deleted */
  used: number;
  createdAt: string;
  updatedAt: string;
}

export type OfferInput = Omit<OfferRule, 'id'> & { notes?: string; active?: boolean };

export interface OfferReportRow { offerId: string; code: string; names: Names; kind: OfferKind; active: boolean; sales: number; given: number; returned: number; net: number }

/** What a sale got from one offer (InvoiceView.offers). */
export interface InvoiceOffer { offerId: string; code: string; names: Names; discount: number; lines: { lineNo: number; qtyMilli: number; discount: number }[] }

export const offersApi = {
  list: () => request<{ available: boolean; offers: OfferView[] }>('GET', '/api/offers'),
  get: (id: string) => request<OfferView>('GET', `/api/offers/${id}`),
  create: (input: OfferInput) => request<OfferView>('POST', '/api/offers', input),
  update: (id: string, input: OfferInput) => request<OfferView>('PUT', `/api/offers/${id}`, input),
  setActive: (id: string, active: boolean) => request<OfferView>('POST', `/api/offers/${id}/active`, { active }),
  remove: (id: string) => request<void>('DELETE', `/api/offers/${id}`),
  /** The offers a till selling from this warehouse works with (kept for offline too). */
  till: (warehouseId: string) => request<{ offers: OfferRule[] }>('GET', '/api/offers/till' + qs({ warehouseId })),
  report: (from: string, to: string) => request<{ from: string; to: string; rows: OfferReportRow[]; total: number }>('GET', '/api/offers/report' + qs({ from, to })),
  /** The server's own figure for lines of a sale (the invoice screen shows it before saving). */
  preview: (input: { date?: string; warehouseId: string; currency: CurrencyCode; rateX100?: number; lines: { itemId: string; qtyMilli: number; amount: number }[] }) =>
    request<{ total: number; byLine: Record<number, number>; offers: { offerId: string; discount: number }[] }>('POST', '/api/offers/preview', input)
};

/**
 * The till's own preview of the offers on its cart, as the server works them out (core/offers.ts), from the offers it
 * last had: the server works them out again when the sale is booked, and its figure is the one paid.
 */
export function tillOfferPreview(
  lines: readonly { itemId: string; categoryId: string | null; qtyMilli: number; amount: number }[], rules: readonly OfferRule[],
  sale: { currency: CurrencyCode; rateX100: number; now?: Date }
): OfferResult {
  const now = sale.now ?? new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const offerLines: OfferLine[] = lines.map((l, i) => ({ lineNo: i + 1, itemId: l.itemId, categoryId: l.categoryId, qtyMilli: l.qtyMilli, amount: l.amount }));
  return applyOffers(offerLines, rules, { date, minutes: now.getHours() * 60 + now.getMinutes(), branchId: null, currency: sale.currency, rateX100: sale.currency === 'IQD' ? 100 : sale.rateX100 });
}

/** The name of an offer in the reader's language (or the first one it has). */
export function offerName(names: Names, lang: keyof Names): string {
  return names[lang]?.trim() || names.en?.trim() || names.ar?.trim() || names.ku?.trim() || '';
}
