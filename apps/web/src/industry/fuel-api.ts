import type { ChartRow, FuelShift, Lang, Names, ShiftCash, ShiftTotals } from '@qasa/core';
import { qs, request } from '../api.ts';

/**
 * Petrol stations (packages/server/src/fuel.ts): fuels, tanks, pumps and nozzles, the shift sheet, tanker deliveries,
 * dips and the reports. Cost fields (cost, profit, value, avgCost, lastCost, costPerLitre) are left out of every answer
 * for someone who may not see cost, so they are optional here.
 */

export interface FuelSettings {
  cashAccount: string; shortAccount: string; overAccount: string; creditAccount: string;
  stockAccount: string; costAccount: string; lossAccount: string; openingAccount: string; dipToleranceBp: number;
}
export interface FuelTypeView { id: string; code: string; name: Names; price: number; revenueAccount: string; active: boolean; sort: number }
export interface NozzleView { id: string; pumpId: string; number: number; fuelTypeId: string; tankId: string; meterMilli: number; meterMaxMilli: number; active: boolean; openShift: string | null }
export interface PumpView { id: string; number: number; active: boolean; nozzles: NozzleView[] }
export interface TankView {
  id: string; code: string; name: string; fuelTypeId: string; capacityMilli: number; chart: ChartRow[] | null; active: boolean; bookMilli: number;
  lastDip: { date: string; measuredMilli: number; varianceMilli: number } | null; inOpenShift: boolean;
  value?: number; avgCost?: number; lastCost?: number;
}
export interface FuelSetupView { available: boolean; types: FuelTypeView[]; tanks: TankView[]; pumps: PumpView[]; settings: FuelSettings }

export interface EntryRef { id: string; number: string | null; status: string }
export interface ReadingView {
  nozzleId: string; fuelTypeId: string; tankId: string; price: number; openingMilli: number; closingMilli: number | null; meterMaxMilli: number; rollover: boolean;
  limitMilli?: number; pumpNumber: number; nozzleNumber: number; cost?: number | null;
}
export type FuelShiftAction = 'save' | 'close' | 'cancel' | 'reverse';
export type FuelShiftStatus = 'open' | 'closed' | 'reversed';
export interface ShiftSummary {
  id: string; number: string; date: string; shift: FuelShift; attendant: string; status: FuelShiftStatus; pumps: number[];
  sales: number | null; credit: number; handed: number | null; difference: number | null; cost?: number | null; profit?: number | null;
  entry: EntryRef | null; reversal: EntryRef | null;
  openedBy: string; openedAt: string; closedBy: string | null; closedAt: string | null; reversedBy: string | null; reversedAt: string | null; reverseReason: string | null;
}
export interface ShiftView extends ShiftSummary { readings: ReadingView[]; totals: ShiftTotals; cash: ShiftCash | null; notes: string; actions: FuelShiftAction[] }
export interface AttendantTotal { attendant: string; shifts: number; sales: number; short: number; over: number }

export type DocStatus = 'posted' | 'reversed';
export interface DeliveryView {
  id: string; number: string; date: string; tankId: string; supplierId: string; supplierName: string; noteNo: string; qtyMilli: number;
  costPerLitre?: number; cost?: number; payment: 'cash' | 'credit'; cashAccount: string | null; status: DocStatus; entry: EntryRef | null; reversal: EntryRef | null;
  notes: string; createdBy: string; reverseReason: string | null; actions: 'reverse'[];
}
export interface DipView {
  id: string; number: string; date: string; tankId: string; dipMm: number | null; measuredMilli: number; bookMilli: number; varianceMilli: number; normal: boolean;
  value?: number; status: DocStatus; entry: EntryRef | null; reversal: EntryRef | null; notes: string; createdBy: string; reverseReason: string | null; actions: 'reverse'[];
}
export interface FuelReport {
  from: string; to: string;
  fuels: { fuelTypeId: string; milli: number; sales: number; cost?: number; profit?: number }[];
  tanks: { tankId: string; openingMilli: number; deliveredMilli: number; soldMilli: number; adjustedMilli: number; closingMilli: number; value?: number }[];
}

export interface SheetBody {
  readings: { nozzleId: string; closingMilli: number | null; rollover?: boolean }[];
  credit?: number;
  handed?: number | null;
  notes?: string;
}
export interface TankBody { code: string; name: string; fuelTypeId: string; capacityMilli: number; chart?: ChartRow[] | null; active?: boolean }
export interface NozzleBody { number: number; tankId: string; meterMilli: number; meterMaxMilli?: number }
export interface DeliveryBody {
  date: string; tankId: string; supplierId: string; noteNo: string; qtyMilli: number; costPerLitre: number; payment: 'cash' | 'credit';
  cashAccount?: string; notes?: string; overCapacity?: boolean; lang: Lang;
}
export interface DipBody { date: string; tankId: string; dipMm?: number; measuredMilli?: number; notes?: string; lang: Lang }
type Period = { from?: string; to?: string; tankId?: string };

export const fuelApi = {
  setup: () => request<FuelSetupView>('GET', '/api/fuel/setup'),
  updateSettings: (body: Partial<FuelSettings>) => request<FuelSettings>('PUT', '/api/fuel/settings', body),
  createType: (body: { code: string; name: Names; price: number; revenueAccount?: string }) => request<FuelTypeView>('POST', '/api/fuel/types', body),
  updateType: (id: string, body: { code: string; name: Names; price: number; revenueAccount?: string; active?: boolean }) => request<FuelTypeView>('PUT', `/api/fuel/types/${id}`, body),
  createTank: (body: TankBody & { openingMilli?: number; openingCost?: number; openingDate?: string; lang?: Lang }) => request<TankView>('POST', '/api/fuel/tanks', body),
  updateTank: (id: string, body: TankBody) => request<TankView>('PUT', `/api/fuel/tanks/${id}`, body),
  createPump: (body: { number: number; nozzles: NozzleBody[] }) => request<PumpView>('POST', '/api/fuel/pumps', body),
  updatePump: (id: string, body: { number: number; active: boolean }) => request<PumpView>('PUT', `/api/fuel/pumps/${id}`, body),
  addNozzle: (pumpId: string, body: NozzleBody) => request<NozzleView>('POST', `/api/fuel/pumps/${pumpId}/nozzles`, body),
  updateNozzle: (id: string, body: { tankId: string; meterMilli?: number; meterMaxMilli?: number; active?: boolean }) => request<NozzleView>('PUT', `/api/fuel/nozzles/${id}`, body),
  shifts: (f: { from?: string; to?: string; attendant?: string; status?: FuelShiftStatus } = {}) => request<ShiftSummary[]>('GET', '/api/fuel/shifts' + qs(f)),
  attendants: (from: string, to: string) => request<AttendantTotal[]>('GET', '/api/fuel/attendants' + qs({ from, to })),
  shift: (id: string) => request<ShiftView>('GET', `/api/fuel/shifts/${id}`),
  open: (body: { date: string; shift: FuelShift; attendant: string; pumpIds: string[] }) => request<ShiftView>('POST', '/api/fuel/shifts', body),
  save: (id: string, body: SheetBody) => request<ShiftView>('PUT', `/api/fuel/shifts/${id}`, body),
  close: (id: string, body: SheetBody & { handed: number; lang: Lang }) => request<ShiftView>('POST', `/api/fuel/shifts/${id}/close`, body),
  cancel: (id: string) => request<void>('DELETE', `/api/fuel/shifts/${id}`),
  reverseShift: (id: string, reason: string) => request<ShiftView>('POST', `/api/fuel/shifts/${id}/reverse`, { reason }),
  deliveries: (f: Period = {}) => request<DeliveryView[]>('GET', '/api/fuel/deliveries' + qs(f)),
  deliver: (body: DeliveryBody) => request<DeliveryView>('POST', '/api/fuel/deliveries', body),
  reverseDelivery: (id: string, reason: string) => request<DeliveryView>('POST', `/api/fuel/deliveries/${id}/reverse`, { reason }),
  dips: (f: Period = {}) => request<DipView[]>('GET', '/api/fuel/dips' + qs(f)),
  dip: (body: DipBody) => request<DipView>('POST', '/api/fuel/dips', body),
  reverseDip: (id: string, reason: string) => request<DipView>('POST', `/api/fuel/dips/${id}/reverse`, { reason }),
  report: (from: string, to: string) => request<FuelReport>('GET', '/api/fuel/reports' + qs({ from, to }))
};
