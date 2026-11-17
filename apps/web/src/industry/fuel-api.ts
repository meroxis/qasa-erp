import type { FuelShift, Lang, Names, ShiftCash, ShiftTotals } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Petrol stations (prototype, packages/server/src/fuel.ts): fuels, pumps and nozzles, and the shift sheet. */

export interface FuelSettings { cashAccount: string; shortAccount: string; overAccount: string; creditAccount: string }
export interface FuelTypeView { id: string; code: string; name: Names; price: number; revenueAccount: string; active: boolean; sort: number }
export interface NozzleView { id: string; pumpId: string; number: number; fuelTypeId: string; meterMilli: number; active: boolean; openShift: string | null }
export interface PumpView { id: string; number: number; active: boolean; nozzles: NozzleView[] }
export interface FuelSetupView { available: boolean; types: FuelTypeView[]; pumps: PumpView[]; settings: FuelSettings }

export interface ReadingView { nozzleId: string; fuelTypeId: string; price: number; openingMilli: number; closingMilli: number | null; pumpNumber: number; nozzleNumber: number }
export type FuelShiftAction = 'save' | 'close' | 'cancel';
export interface ShiftSummary {
  id: string; number: string; date: string; shift: FuelShift; attendant: string; status: 'open' | 'closed'; pumps: number[];
  sales: number | null; credit: number; handed: number | null; difference: number | null;
  entry: { id: string; number: string | null; status: string } | null;
  openedBy: string; openedAt: string; closedBy: string | null; closedAt: string | null;
}
export interface ShiftView extends ShiftSummary { readings: ReadingView[]; totals: ShiftTotals; cash: ShiftCash | null; notes: string; actions: FuelShiftAction[] }
export interface AttendantTotal { attendant: string; shifts: number; sales: number; short: number; over: number }

export interface SheetBody {
  readings: { nozzleId: string; openingMilli?: number; closingMilli: number | null }[];
  credit?: number;
  handed?: number | null;
  notes?: string;
}

export const fuelApi = {
  setup: () => request<FuelSetupView>('GET', '/api/fuel/setup'),
  updateSettings: (body: Partial<FuelSettings>) => request<FuelSettings>('PUT', '/api/fuel/settings', body),
  updateType: (id: string, body: { code: string; name: Names; price: number; revenueAccount?: string; active?: boolean }) => request<FuelTypeView>('PUT', `/api/fuel/types/${id}`, body),
  shifts: (f: { from?: string; to?: string; attendant?: string; status?: 'open' | 'closed' } = {}) => request<ShiftSummary[]>('GET', '/api/fuel/shifts' + qs(f)),
  attendants: (from: string, to: string) => request<AttendantTotal[]>('GET', '/api/fuel/attendants' + qs({ from, to })),
  shift: (id: string) => request<ShiftView>('GET', `/api/fuel/shifts/${id}`),
  open: (body: { date: string; shift: FuelShift; attendant: string; pumpIds: string[] }) => request<ShiftView>('POST', '/api/fuel/shifts', body),
  save: (id: string, body: SheetBody) => request<ShiftView>('PUT', `/api/fuel/shifts/${id}`, body),
  close: (id: string, body: SheetBody & { handed: number; lang: Lang }) => request<ShiftView>('POST', `/api/fuel/shifts/${id}/close`, body),
  cancel: (id: string) => request<void>('DELETE', `/api/fuel/shifts/${id}`)
};
