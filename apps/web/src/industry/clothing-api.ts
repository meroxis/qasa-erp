import type { CurrencyCode, Names, UnitCode } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Clothing and shoes (2.0, Starter, Pro and Business): server side in packages/server/src/clothing.ts. */

export interface ColorView { id: string; code: string; name: Names; hex: string | null; sort: number; active: boolean }
export interface VariantView {
  itemId: string; code: string; barcode: string | null; size: string; colorId: string | null;
  salePrice: number; saleCurrency: CurrencyCode; active: boolean; onHandMilli: number;
}
export interface ModelSummary {
  id: string; code: string; name: Names; season: string | null; categoryId: string | null; brandId: string | null;
  sizes: string[]; colorIds: string[]; variantCount: number; onHandMilli: number; salePrice: number; saleCurrency: CurrencyCode; active: boolean;
}
export interface ModelView extends ModelSummary {
  unit: UnitCode; purchasePrice?: number | null; purchaseCurrency?: CurrencyCode | null;
  variants: VariantView[];
  stock: { warehouseId: string; byItem: Record<string, number> }[];
}
export interface ModelInput {
  code?: string; name: Names; sizes: string[]; colorIds: string[]; season?: string | null; categoryId?: string | null; brandId?: string | null;
  unit?: UnitCode; salePrice: number; saleCurrency: CurrencyCode; purchasePrice?: number | null; purchaseCurrency?: CurrencyCode | null;
  barcodes?: boolean; sizePrices?: Record<string, number>;
}
export interface ModelUpdate {
  name?: Names; season?: string | null; categoryId?: string | null; brandId?: string | null; active?: boolean; salePrice?: number;
  sizePrices?: Record<string, number>; addSizes?: string[]; addColorIds?: string[]; barcodes?: boolean;
}
export interface GridCell { size: string; colorId: string | null; qtyMilli: number }
export interface GridLine { itemId: string; code: string; name: Names; size: string; colorId: string | null; qtyMilli: number; unitPrice: number; currency: CurrencyCode }
export interface ClothingFigures { soldMilli: number; sales: number; onHandMilli: number; sellThroughBp: number | null }
export interface ClothingReport {
  from: string; to: string;
  models: (ClothingFigures & { modelId: string; code: string; name: Names; season: string | null })[];
  sizes: (ClothingFigures & { size: string })[];
  colors: (ClothingFigures & { colorId: string | null; name: Names | null })[];
}
export interface ExchangeSale {
  discount: number; partyId?: string; notes?: string; rateX100?: number;
  lines: { itemId: string; qtyMilli: number; unitPrice: number }[];
  payments?: { method: string; amount: number }[];
}

export const clothingApi = {
  overview: () => request<{ available: boolean; colors: ColorView[]; seasons: string[] }>('GET', '/api/clothing'),
  colors: () => request<{ colors: ColorView[] }>('GET', '/api/clothing/colors'),
  createColor: (input: { code: string; name: Names; hex?: string | null; sort?: number; active?: boolean }) => request<ColorView>('POST', '/api/clothing/colors', input),
  updateColor: (id: string, input: { code: string; name: Names; hex?: string | null; sort?: number; active?: boolean }) => request<ColorView>('PUT', `/api/clothing/colors/${id}`, input),
  models: (f: { q?: string; season?: string; categoryId?: string; active?: '0' | '1' } = {}) => request<{ models: ModelSummary[] }>('GET', '/api/clothing/models' + qs(f)),
  model: (id: string) => request<ModelView>('GET', `/api/clothing/models/${id}`),
  createModel: (input: ModelInput) => request<ModelView>('POST', '/api/clothing/models', input),
  updateModel: (id: string, input: ModelUpdate) => request<ModelView>('PUT', `/api/clothing/models/${id}`, input),
  deleteModel: (id: string) => request<void>('DELETE', `/api/clothing/models/${id}`),
  lines: (id: string, kind: 'sale' | 'purchase', cells: GridCell[]) => request<{ lines: GridLine[] }>('POST', `/api/clothing/models/${id}/lines`, { kind, cells }),
  invoiceVariants: (invoiceId: string) => request<{ lines: { itemId: string; qtyMilli: number }[] }>('GET', `/api/clothing/invoices/${invoiceId}/variants`),
  exchange: (shiftId: string, input: { invoiceId: string; back: { lineNo: number; qtyMilli: number }[]; sale?: ExchangeSale }) =>
    request<{ returnId: string; saleId: string | null; difference: number }>('POST', `/api/clothing/shifts/${shiftId}/exchange`, input),
  report: (f: { from: string; to: string; season?: string }) => request<ClothingReport>('GET', '/api/clothing/reports' + qs(f))
};
