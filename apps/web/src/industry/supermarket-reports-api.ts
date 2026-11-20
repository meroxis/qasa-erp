import type { Names } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Slow sellers and dead stock (slow-stock.ts) and the shelf labels to reprint (shelf-labels.ts), 1.7. */

export type SlowMode = 'dead' | 'slow';

export interface SlowStockRowView {
  itemId: string; code: string; barcode: string; name: Names; unit: string;
  categoryId: string | null; categoryName: Names | null;
  qtyMilli: number;
  /** what it cost at average cost: absent for someone who may not read the books */
  value?: number;
  soldMilli: number; lastSale: string | null; idleDays: number; coverDays: number | null; firstIn: string | null;
}

export interface SlowStockView {
  date: string; days: number; mode: SlowMode; coverDays: number;
  rows: SlowStockRowView[];
  total: { items: number; qtyMilli: number; value?: number };
}

export interface SlowStockQuery {
  date?: string; days: number; mode: SlowMode; coverDays: number;
  warehouseId?: string; categoryId?: string; includeNew?: boolean;
}

export interface ShelfFlagView {
  itemId: string;
  /** null: the item's own unit */
  unit: string | null;
  code: string; barcode: string; name: Names; categoryId: string | null;
  /** what the label on the shelf shows; null: a new item (or its currency changed) */
  oldPrice: number | null;
  newPrice: number; currency: 'IQD' | 'USD'; changedAt: string; changedBy: string;
}

export const supermarketReportsApi = {
  slowStock: (q: SlowStockQuery) => request<SlowStockView>('GET', '/api/brief/reports/slow-stock' + qs({
    date: q.date, days: String(q.days), mode: q.mode, coverDays: String(q.coverDays), warehouseId: q.warehouseId, categoryId: q.categoryId,
    includeNew: q.includeNew ? 'true' : undefined
  })),
  shelfFlags: (categoryId?: string) => request<{ rows: ShelfFlagView[]; count: number }>('GET', '/api/shelf-labels' + qs({ categoryId })),
  shelfPrinted: (rows: readonly Pick<ShelfFlagView, 'itemId' | 'unit' | 'changedAt'>[]) =>
    request<{ cleared: number }>('POST', '/api/shelf-labels/printed', { rows: rows.map((r) => ({ itemId: r.itemId, unit: r.unit, changedAt: r.changedAt })) })
};
