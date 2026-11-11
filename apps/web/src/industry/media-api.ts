import type { CurrencyCode, Lang } from '@qasa/core';
import { request } from '../api.ts';

/** Item pictures and importing from Excel (packages/server/src/media.ts). */

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';
export interface ItemImageView { itemId: string; mime: ImageMime; data: string; updatedAt: string }

export type ImportKind = 'customers' | 'suppliers' | 'items' | 'opening_stock' | 'opening_balances';
export interface ImportOptions {
  date?: string;
  warehouseId?: string;
  counterAccountCode?: string;
  partyType?: 'customer' | 'supplier';
  rateX100?: number;
  /** opening stock and balances: import although the same was imported before for this date */
  again?: boolean;
}
export interface ImportResult {
  kind: ImportKind;
  dryRun: boolean;
  rows: number;
  created: number;
  skipped: { line: number; reason: 'exists' | 'zero' }[];
  documents: { type: 'stock_doc' | 'entry'; id: string; currency?: CurrencyCode }[];
  /** the same opening stock or balances already imported for this date (not cancelled) */
  importedBefore?: { type: 'stock_doc' | 'entry'; id: string; currency?: CurrencyCode }[];
}

export const mediaApi = {
  imageIndex: () => request<{ itemId: string; updatedAt: string }[]>('GET', '/api/item-images'),
  image: (itemId: string) => request<ItemImageView>('GET', `/api/items/${encodeURIComponent(itemId)}/image`),
  setImage: (itemId: string, data: string) =>
    request<{ itemId: string; mime: ImageMime; bytes: number; updatedAt: string }>('PUT', `/api/items/${encodeURIComponent(itemId)}/image`, { data }),
  deleteImage: (itemId: string) => request<void>('DELETE', `/api/items/${encodeURIComponent(itemId)}/image`),
  /** lang: the language of the words written on the documents the import makes (the person's own; Arabic by default) */
  // items have their own route: whoever can make items may import them (the other kinds need an admin)
  import: (kind: ImportKind, rows: Record<string, string>[], dryRun: boolean, options: ImportOptions | undefined, lang: Lang) =>
    kind === 'items'
      ? request<ImportResult>('POST', '/api/import/items', { rows, dryRun, ...(options ? { options } : {}), lang })
      : request<ImportResult>('POST', '/api/import', { kind, rows, dryRun, ...(options ? { options } : {}), lang })
};
