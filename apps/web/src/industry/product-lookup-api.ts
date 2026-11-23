import type { ProductSource } from '@qasa/core';
import { request } from '../api.ts';
import type { ImageMime } from './media-api.ts';

/** Product lookup by barcode (packages/server/src/product-lookup.ts). */

export interface LookupSettings { enabled: boolean; asked: boolean; available: boolean }
export interface NameSuggestion { lang: 'ar' | 'en' | 'ku'; text: string }
export interface ProductLookupResult {
  found: boolean;
  reason?: 'off' | 'own' | 'not_found' | 'busy' | 'unreachable';
  source?: ProductSource;
  names?: NameSuggestion[];
  brand?: string | null;
  quantity?: string | null;
  image?: { mime: ImageMime; data: string } | null;
  licence?: string;
  pageUrl?: string | null;
}
export interface BulkStatus { running: boolean; total: number; done: number; added: number; ended: 'done' | 'stopped' | 'off' | 'unreachable' | null; startedAt: string | null }

export const productLookupApi = {
  settings: () => request<LookupSettings>('GET', '/api/items/lookup/settings'),
  saveSettings: (enabled: boolean) => request<LookupSettings>('PUT', '/api/items/lookup/settings', { enabled }),
  lookup: (barcode: string) => request<ProductLookupResult>('POST', '/api/items/lookup', { barcode }),
  bulk: () => request<BulkStatus>('GET', '/api/items/lookup/bulk'),
  startBulk: () => request<BulkStatus>('POST', '/api/items/lookup/bulk', {}),
  stopBulk: () => request<BulkStatus>('DELETE', '/api/items/lookup/bulk')
};
