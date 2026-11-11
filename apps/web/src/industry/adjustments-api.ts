import type { Lang, Names, UnitCode } from '@qasa/core';
import { qs, request } from '../api.ts';
import type { CountChange, CountSessionView } from './count-session.ts';

/** Stock adjustments (every plan): damaged, lost, expired, used, issued to a job, and stock-count differences. */

export const ADJUSTMENT_REASONS = ['damaged', 'lost', 'expired', 'count', 'internal_use', 'job', 'other'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];
export type AdjustmentStatus = 'draft' | 'posted' | 'cancelled';
export type AdjustmentAction = 'edit' | 'delete' | 'post' | 'cancel';

export interface AdjustmentAccounts {
  damaged: string; lost: string; expired: string; internal_use: string; job: string; other: string; count: string; gain: string;
}

/** qtyMilli: + in, − out, base units; or (1.1) unit + unitQtyMilli (signed the same way), with unitCost per that unit. */
/** batches (1.1): a line going out may be pinned to one batch (batchId); a line coming in names its batch and expiry date. */
export interface AdjustmentLineInput { itemId: string; qtyMilli: number; unitCost?: number; unit?: UnitCode; unitQtyMilli?: number; batchNo?: string; expiry?: string; batchId?: string }

export interface AdjustmentInput {
  date: string;
  warehouseId: string;
  reason: AdjustmentReason;
  accountCode?: string;
  jobId?: string;
  notes?: string;
  lines: AdjustmentLineInput[];
}

export interface AdjustmentLineView {
  seq: number; itemId: string; itemCode: string; itemName: Names; unit: UnitCode;
  qtyMilli: number; unitCost: number | null;
  /** IQD that moved (out negative), once posted */
  value: number | null;
  stockMilli: number;
  lineUnit: UnitCode | null; unitFactorMilli: number | null; unitQtyMilli: number | null;
  batchNo?: string | null; expiry?: string | null; batchId?: string | null;
}

export interface AdjustmentSummary {
  id: string; number: string | null; date: string; status: AdjustmentStatus; reason: AdjustmentReason;
  warehouseId: string; warehouseName: Names; lineCount: number; valueOut: number; valueIn: number;
  job: { id: string; number: string; title: string } | null; notes: string; createdBy: string;
}

export interface AdjustmentView extends AdjustmentSummary {
  accountCode: string; accountName: Names | null; gainAccountCode: string;
  entry: { id: string; number: string | null } | null;
  reversal: { id: string; number: string | null } | null;
  createdAt: string;
  lines: AdjustmentLineView[];
  actions: AdjustmentAction[];
  /** 1.1: made by a count limited to some categories and brands */
  countScope?: CountScope | null;
}

/** units (1.1): the item's other units and factors, to show the stock in boxes and strips (counts stay in base units). */
export interface CountSheetRow {
  itemId: string; code: string; barcode: string; name: Names; unit: UnitCode; stockMilli: number; units?: { unit: UnitCode; factorMilli: number }[];
  /** 1.1: for a count limited to some categories and brands */
  categoryId?: string | null; brandId?: string | null;
}
/** 1.1: the categories (their subcategories with them) and brands a count is limited to. */
export interface CountScope { categoryIds: string[]; brandIds: string[] }

export interface CountInput {
  date: string;
  warehouseId: string;
  notes?: string;
  full?: boolean;
  /** unitCost (IQD per unit) prices a surplus of an item the books show none of, so its average cost is unknown */
  counts: { itemId?: string; code?: string; countedMilli: number; unitCost?: number }[];
}

/**
 * The counted lines sent to POST /api/adjustments/count: a unit cost goes only with an item counted above the books
 * (only a surplus needs one; a shortage leaves at the average cost).
 */
export function countLines(counted: ReadonlyMap<string, number>, costs: ReadonlyMap<string, number>, books: ReadonlyMap<string, number>): CountInput['counts'] {
  return [...counted].map(([itemId, countedMilli]) => {
    const cost = costs.get(itemId);
    return countedMilli > (books.get(itemId) ?? 0) && cost !== undefined ? { itemId, countedMilli, unitCost: cost } : { itemId, countedMilli };
  });
}

export interface CountResult { adjustment: AdjustmentView | null; unknown: { row: number; code: string }[]; counted: number; differences: number }

export const adjustmentsApi = {
  list: (f: { status?: AdjustmentStatus; warehouseId?: string; reason?: AdjustmentReason } = {}) => request<AdjustmentSummary[]>('GET', '/api/adjustments' + qs(f)),
  get: (id: string) => request<AdjustmentView>('GET', `/api/adjustments/${encodeURIComponent(id)}`),
  create: (body: AdjustmentInput) => request<AdjustmentView>('POST', '/api/adjustments', body),
  update: (id: string, body: AdjustmentInput) => request<AdjustmentView>('PUT', `/api/adjustments/${encodeURIComponent(id)}`, body),
  remove: (id: string) => request<void>('DELETE', `/api/adjustments/${encodeURIComponent(id)}`),
  /** lang: the language of the words written into the entry (the person's own; the server defaults to Arabic) */
  post: (id: string, lang: Lang) => request<AdjustmentView>('POST', `/api/adjustments/${encodeURIComponent(id)}/post`, { lang }),
  cancel: (id: string, date?: string) => request<AdjustmentView>('POST', `/api/adjustments/${encodeURIComponent(id)}/cancel`, date ? { date } : {}),
  settings: () => request<{ accounts: AdjustmentAccounts; defaults: AdjustmentAccounts }>('GET', '/api/adjustments/settings'),
  saveSettings: (patch: Partial<AdjustmentAccounts>) => request<{ accounts: AdjustmentAccounts; defaults: AdjustmentAccounts }>('PUT', '/api/adjustments/settings', patch),
  countSheet: (warehouseId: string) => request<CountSheetRow[]>('GET', '/api/adjustments/count-sheet' + qs({ warehouseId })),
  count: (body: CountInput) => request<CountResult>('POST', '/api/adjustments/count', body),
  /** A count saved as it is typed (count-session.ts): the warehouse's open count, or null. */
  openCount: (warehouseId: string) => request<CountSessionView | null>('GET', '/api/adjustments/counts/open' + qs({ warehouseId })),
  startCount: (body: { warehouseId: string; date: string; notes?: string; full?: boolean; scope?: CountScope }) => request<CountSessionView>('POST', '/api/adjustments/counts', body),
  saveCount: (id: string, body: { date: string; notes: string; full: boolean; counts: CountChange[] }) =>
    request<CountSessionView>('PUT', `/api/adjustments/counts/${encodeURIComponent(id)}`, { ...body, notes: body.notes.slice(0, 500) }),
  finishCount: (id: string) => request<CountResult & { session: CountSessionView }>('POST', `/api/adjustments/counts/${encodeURIComponent(id)}/finish`, {}),
  discardCount: (id: string) => request<void>('DELETE', `/api/adjustments/counts/${encodeURIComponent(id)}`)
};

/** Reads pasted or imported count lines: "code,qty", "code;qty", "code<TAB>qty" or "code qty"; a header row is skipped. */
export function parseCountText(text: string): { code: string; countedMilli: number }[] | { badRow: number } {
  const out: { code: string; countedMilli: number }[] = [];
  const rows = text.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!.trim();
    if (!raw) continue;
    const parts = raw.split(/[,;\t]|\s+/).map((p) => p.trim().replace(/^"|"$/g, '')).filter(Boolean);
    const code = parts[0] ?? '';
    // Eastern Arabic digits too (٠١٢٣٤٥٦٧٨٩ and ۰۱۲۳۴۵۶۷۸۹)
    const qtyText = (parts[parts.length - 1] ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
    const qty = Number(qtyText);
    if (parts.length < 2 || !Number.isFinite(qty) || qty < 0) {
      if (out.length === 0 && i === rows.findIndex((r) => r.trim())) continue; // a header line
      return { badRow: i + 1 };
    }
    out.push({ code, countedMilli: Math.round(qty * 1000) });
  }
  return out;
}
