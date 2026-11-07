import type { CurrencyCode, Lang } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Payroll (Pro module): employees, monthly runs and advances. Missing (404) in builds without Pro; admins only. */

export interface PayrollAccounts { expense: string; payable: string; advances: string; socialSecurity: string }
export interface PayrollSettings { accounts: PayrollAccounts; socialSecurityBp: number }

export interface EmployeeInput {
  code?: string; name: string; jobTitle?: string; department?: string; phone?: string; idNumber?: string;
  hireDate?: string | null; endDate?: string | null; currency: CurrencyCode; baseSalary: number; allowances?: number;
  socialSecurity?: boolean; bankAccount?: string; active?: boolean; notes?: string;
}

export interface EmployeeView {
  id: string; code: string; name: string; jobTitle: string; department: string; phone: string; idNumber: string;
  hireDate: string | null; endDate: string | null; currency: CurrencyCode; baseSalary: number; allowances: number;
  socialSecurity: boolean; bankAccount: string; active: boolean; notes: string; advanceRemaining: number; hasHistory: boolean;
}

export interface PayLineInput {
  employeeId: string; base?: number; allowances?: number; overtime?: number; bonus?: number; absence?: number;
  advanceDeduction?: number; socialSecurity?: number; otherDeductions?: number; notes?: string;
}

export interface PayLineView {
  employeeId: string; code: string; name: string; jobTitle: string; department: string;
  base: number; allowances: number; overtime: number; bonus: number; absence: number;
  advanceDeduction: number; socialSecurity: number; otherDeductions: number; gross: number; net: number; notes: string;
  advanceRemaining: number;
}

export type RunStatus = 'draft' | 'posted' | 'cancelled';
export type RunAction = 'edit' | 'post' | 'cancel' | 'unpost' | 'pay';
export interface RunTotals {
  gross: number; allowances: number; overtime: number; bonus: number; absence: number;
  advanceDeduction: number; socialSecurity: number; otherDeductions: number; net: number;
}
export interface RunSummary {
  id: string; period: string; date: string; currency: CurrencyCode; status: RunStatus; employees: number; totals: RunTotals;
  entry: { id: string; number: string | null; status: string } | null;
  payment: { id: string; number: string | null; date: string } | null; createdBy: string; createdAt: string;
}
export interface RunView extends RunSummary { notes: string; lines: PayLineView[]; actions: RunAction[] }

export interface AdvanceView {
  id: string; employeeId: string; employeeCode: string; employeeName: string; date: string; currency: CurrencyCode;
  amount: number; monthly: number; taken: number; remaining: number; entry: { id: string; number: string | null } | null;
  reversed: boolean; notes: string; createdBy: string;
}

export interface PayrollSummary {
  available: boolean; employees: number; monthly: { IQD: number; USD: number }; advancesOpen: { IQD: number; USD: number };
  lastRun: RunSummary | null; settings: PayrollSettings;
}

export const payrollApi = {
  summary: () => request<PayrollSummary>('GET', '/api/payroll/summary'),
  settings: () => request<PayrollSettings>('GET', '/api/payroll/settings'),
  updateSettings: (body: { accounts?: Partial<PayrollAccounts>; socialSecurityBp?: number }) => request<PayrollSettings>('PUT', '/api/payroll/settings', body),
  employees: (f: { q?: string; active?: 'true' | 'false' } = {}) => request<EmployeeView[]>('GET', '/api/payroll/employees' + qs(f)),
  employee: (id: string) => request<EmployeeView>('GET', `/api/payroll/employees/${id}`),
  createEmployee: (input: EmployeeInput) => request<EmployeeView>('POST', '/api/payroll/employees', input),
  updateEmployee: (id: string, input: EmployeeInput) => request<EmployeeView>('PUT', `/api/payroll/employees/${id}`, input),
  deleteEmployee: (id: string) => request<void>('DELETE', `/api/payroll/employees/${id}`),
  runs: (f: { period?: string; status?: RunStatus } = {}) => request<RunSummary[]>('GET', '/api/payroll/runs' + qs(f)),
  run: (id: string) => request<RunView>('GET', `/api/payroll/runs/${id}`),
  prepare: (body: { period: string; currency: CurrencyCode; date?: string; notes?: string }) => request<RunView>('POST', '/api/payroll/runs', body),
  updateRun: (id: string, body: { date?: string; notes?: string; lines: PayLineInput[] }) => request<RunView>('PUT', `/api/payroll/runs/${id}`, body),
  post: (id: string, body: { rateX100?: number; lang: Lang }) => request<RunView>('POST', `/api/payroll/runs/${id}/post`, body),
  pay: (id: string, body: { date: string; cashAccountCode: string; rateX100?: number; lang: Lang }) => request<RunView>('POST', `/api/payroll/runs/${id}/pay`, body),
  unpost: (id: string) => request<RunView>('POST', `/api/payroll/runs/${id}/unpost`, {}),
  cancel: (id: string) => request<RunView>('POST', `/api/payroll/runs/${id}/cancel`, {}),
  advances: (f: { employeeId?: string; open?: 'true' | 'false' } = {}) => request<AdvanceView[]>('GET', '/api/payroll/advances' + qs(f)),
  payAdvance: (body: { employeeId: string; date: string; amount: number; monthly: number; cashAccountCode: string; rateX100?: number; notes?: string; lang: Lang }) =>
    request<AdvanceView>('POST', '/api/payroll/advances', body)
};
