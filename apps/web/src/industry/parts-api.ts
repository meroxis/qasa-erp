import type { CurrencyCode, Names, UnitCode } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Car parts (Pro module). Missing (404) in builds without Pro. */

export type PartNumberKind = 'oem' | 'alt';
export type PartMatch = 'number' | 'interchange' | 'barcode' | 'code' | 'brand' | 'name';

export interface PartDetails { shelf: string; brand: string; origin: string; wholesalePrice: number | null; reorderMilli: number | null }
export interface PartNumber { number: string; kind: PartNumberKind; maker: string }
export interface Fitment { id?: string; make: string; model: string; yearFrom: number | null; yearTo: number | null; engine: string }

export interface PartHit {
  id: string; code: string; barcode: string; name: Names; unit: UnitCode; active: boolean;
  salePrice: number; saleCurrency: CurrencyCode; wholesalePrice: number | null;
  shelf: string; brand: string; origin: string; qtyMilli: number; numbers: PartNumber[]; match: PartMatch;
}

export interface PartView extends Omit<PartHit, 'match'> {
  reorderMilli: number | null;
  fitments: (Fitment & { id: string })[];
  stock: { warehouseId: string; warehouseCode: string; warehouseName: Names; qtyMilli: number }[];
  interchangeable: PartHit[];
}

export interface ReorderRow extends Omit<PartHit, 'match'> {
  reorderMilli: number;
  lastPurchase: { supplier: string; date: string; unitPrice: number; currency: CurrencyCode } | null;
}

export interface PartInput { details: PartDetails; numbers: PartNumber[]; fitments: Fitment[] }
export interface VehicleOptions { makes: string[]; models: string[]; years: { min: number; max: number } | null }
export type PartImportKind = 'numbers' | 'fitments';
export interface PartImportReport { kind: PartImportKind; rows: number; added: number; skipped: number; parts: number; applied: boolean }

/** Suggestions for where a part was made; any text is allowed. */
export const PART_ORIGINS = ['genuine', 'oem', 'japan', 'korea', 'china', 'taiwan', 'turkey', 'germany', 'other'] as const;

export const partsApi = {
  search: (q: string, limit?: number) => request<PartHit[]>('GET', '/api/parts/search' + qs({ q, limit: limit === undefined ? undefined : String(limit) })),
  vehicles: (make?: string) => request<VehicleOptions>('GET', '/api/parts/vehicles' + qs({ make })),
  byVehicle: (f: { make: string; model?: string; year?: number; engine?: string; q?: string }) =>
    request<PartHit[]>('GET', '/api/parts/by-vehicle' + qs({ make: f.make, model: f.model, year: f.year === undefined ? undefined : String(f.year), engine: f.engine, q: f.q })),
  reorder: () => request<ReorderRow[]>('GET', '/api/parts/reorder'),
  part: (id: string) => request<PartView>('GET', `/api/parts/${id}`),
  save: (id: string, input: PartInput) => request<PartView>('PUT', `/api/parts/${id}`, input),
  import: (kind: PartImportKind, text: string, dryRun: boolean) => request<PartImportReport>('POST', '/api/parts/import', { kind, text, dryRun })
};
