import type { CurrencyCode } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Quotations (عروض الأسعار): on every plan, part of the app's own API. */

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'invoiced' | 'cancelled';
export type QuoteAction = 'edit' | 'send' | 'accept' | 'reject' | 'reopen' | 'convert' | 'cancel' | 'duplicate';
export type QuoteMove = 'send' | 'accept' | 'reject' | 'reopen' | 'cancel';
export const QUOTE_STATUSES: readonly QuoteStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'invoiced', 'cancelled'];

export interface QuoteLineInput { itemId?: string | null; description: string; qtyMilli: number; unitPrice: number }
export interface QuoteInput {
  date: string;
  validUntil?: string | null;
  partyId?: string | null;
  customerName?: string | null;
  currency: CurrencyCode;
  discount?: number;
  notes?: string;
  terms?: string;
  lines: QuoteLineInput[];
}
export interface QuoteLineView { seq: number; itemId: string | null; itemCode: string | null; description: string; qtyMilli: number; unitPrice: number; amount: number }
export interface QuoteSummaryView {
  id: string; number: string; date: string; validUntil: string | null;
  party: { id: string; code: string; name: string; phone: string } | null;
  customerName: string; currency: CurrencyCode; subtotal: number; discount: number; total: number; status: QuoteStatus; expired: boolean;
  invoice: { id: string; number: string | null; status: string } | null;
}
export interface QuoteView extends Omit<QuoteSummaryView, 'party'> {
  party: (NonNullable<QuoteSummaryView['party']> & { address: string }) | null;
  lines: QuoteLineView[]; notes: string; terms: string; createdBy: string; createdAt: string; actions: QuoteAction[];
}
export interface QuotesSummaryView { open: number; openValue: { IQD: number; USD: number }; expired: number; acceptedThisMonth: number; quotedThisMonth: number }
export interface ConvertBody { date: string; warehouseId?: string; rateX100?: number; customer?: { name?: string; phone?: string; address?: string } }

export const quotesApi = {
  summary: () => request<QuotesSummaryView>('GET', '/api/quotes/summary'),
  list: (f: { status?: QuoteStatus | 'open'; partyId?: string; q?: string } = {}) => request<QuoteSummaryView[]>('GET', '/api/quotes' + qs(f)),
  get: (id: string) => request<QuoteView>('GET', `/api/quotes/${id}`),
  create: (input: QuoteInput) => request<QuoteView>('POST', '/api/quotes', input),
  update: (id: string, input: QuoteInput) => request<QuoteView>('PUT', `/api/quotes/${id}`, input),
  move: (id: string, action: QuoteMove, reason?: string) => request<QuoteView>('POST', `/api/quotes/${id}/status`, reason ? { action, reason } : { action }),
  duplicate: (id: string) => request<QuoteView>('POST', `/api/quotes/${id}/duplicate`, {}),
  convert: (id: string, body: ConvertBody) => request<QuoteView>('POST', `/api/quotes/${id}/convert`, body)
};
