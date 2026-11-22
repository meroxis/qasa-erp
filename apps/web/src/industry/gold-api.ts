import type { CurrencyCode, GoldKarat, MakingKind, Names } from '@qasa/core';
import { qs, request } from '../api.ts';
import { sendOnce } from './send-once.ts';

/** Gold and jewellery shops (packages/server/src/gold.ts). */

export interface GoldBoardRow { karat: GoldKarat; buyPerGram: number; sellPerGram: number; date: string }
export type GoldBoard = Record<GoldKarat, GoldBoardRow | null>;
export interface GoldBoardView { available: boolean; currency: CurrencyCode; date: string; board: GoldBoard; history: (GoldBoardRow & { createdBy: string })[] }
export interface GoldTerms { weightMg: number; karat: GoldKarat; makingKind: MakingKind; makingAmount: number }
export interface GoldItemView extends GoldTerms {
  itemId: string; code: string; barcode: string | null; name: Names; currency: CurrencyCode; salePrice: number; boardPrice: number | null; onHandMilli: number; fineMg: number;
}
export type GoldDocKind = 'buy' | 'melt' | 'receipt' | 'delivery';
export type GoldDocStatus = 'draft' | 'posted' | 'cancelled';
export interface GoldDocLine { seq: number; itemId: string; code: string; name: Names; weightMg: number; karat: GoldKarat; fineMg: number; making: number; goldValue: number }
export interface GoldDocView {
  id: string; kind: GoldDocKind; number: string | null; date: string; status: GoldDocStatus; partyId: string | null; partyName: string | null; customerName: string | null;
  warehouseId: string | null; cashAccount: string | null; currency: CurrencyCode; rateX100: number; karat: GoldKarat | null; weightMg: number | null;
  pricePerGram: number | null; karatOut: GoldKarat | null; weightOutMg: number | null; amount: number; lines: GoldDocLine[]; entryId: string | null; notes: string | null;
  createdBy: string; createdAt: string;
}
export interface GoldDocInput {
  kind: GoldDocKind; date: string; partyId?: string; customerName?: string; warehouseId?: string; cashAccount?: string; currency?: CurrencyCode; rateX100?: number;
  karat?: GoldKarat; weightMg?: number; pricePerGram?: number; karatOut?: GoldKarat; weightOutMg?: number; lines?: { itemId: string; making?: number }[]; notes?: string;
}
export interface GoldSupplierView { partyId: string; name: string; basisKarat: 21 | 24; fineMg: number; basisMg: number; value: number }
export interface GoldStockRow { karat: GoldKarat; pieces: number; piecesWeightMg: number; piecesValue: number; scrapWeightMg: number; scrapValue: number; fineMg: number }
export interface GoldSlip {
  invoiceId: string; number: string | null; date: string; party: string | null; currency: CurrencyCode; total: number;
  lines: { lineNo: number; itemId: string; code: string; name: Names; qtyMilli: number; weightMg: number; karat: GoldKarat; making: number; perGram: number; amount: number }[];
}

export const goldApi = {
  board: (f: { currency?: CurrencyCode; date?: string } = {}) => request<GoldBoardView>('GET', '/api/gold/board' + qs(f)),
  saveBoard: (body: { date: string; currency: CurrencyCode; prices: { karat: GoldKarat; buyPerGram: number; sellPerGram: number }[] }) =>
    request<{ board: GoldBoard; repriced: number }>('PUT', '/api/gold/board', body),
  items: (q?: string) => request<GoldItemView[]>('GET', '/api/gold/items' + qs(q ? { q } : {})),
  item: (id: string) => request<GoldItemView>('GET', `/api/gold/items/${id}`),
  saveItem: (id: string, terms: GoldTerms) => request<GoldItemView>('PUT', `/api/gold/items/${id}`, terms),
  removeItem: (id: string) => request<void>('DELETE', `/api/gold/items/${id}`),
  stock: () => request<{ byKarat: GoldStockRow[]; fineMg: number; value: number }>('GET', '/api/gold/stock'),
  suppliers: () => request<GoldSupplierView[]>('GET', '/api/gold/suppliers'),
  setBasis: (partyId: string, basisKarat: 21 | 24) => request<unknown>('PUT', `/api/gold/suppliers/${partyId}`, { basisKarat }),
  docs: (f: { kind?: GoldDocKind; status?: GoldDocStatus; partyId?: string } = {}) => request<GoldDocView[]>('GET', '/api/gold/docs' + qs(f)),
  // what books money or stock goes with a key held until the server answers (send-once.ts): a second tap, or a retry
  // after the link dropped, is answered with the first one and books nothing twice
  createDoc: (body: GoldDocInput) => sendOnce<GoldDocView>('POST', '/api/gold/docs', body),
  deleteDoc: (id: string) => request<void>('DELETE', `/api/gold/docs/${id}`),
  postDoc: (id: string, lang: 'ar' | 'en' | 'ku') => sendOnce<GoldDocView>('POST', `/api/gold/docs/${id}/post`, { lang }),
  cancelDoc: (id: string) => sendOnce<GoldDocView>('POST', `/api/gold/docs/${id}/cancel`, {}),
  slip: (invoiceId: string) => request<GoldSlip>('GET', `/api/gold/slip/${invoiceId}`)
};

