import type { Names } from '@qasa/core';
import { qs, request } from '../api.ts';

/** The owner's dashboard, the Daily Brief, the management reports and quick expenses. Amounts in IQD unless said. */
export type Money2 = { IQD: number; USD: number };

export interface CashAccountView { code: string; name: Names; balance: Money2; base: number }
export interface ItemSalesView { itemId: string; code: string; name: Names; qtyMilli: number; sales: number; cost: number; profit: number }
export interface CustomerSalesView { partyId: string | null; code: string; name: string; invoices: number; sales: number }
export interface AgingRowView {
  partyId: string; code: string; name: string; phone: string; balance: number; oldestDays: number; buckets: [number, number, number, number];
}
export interface InstallmentDueView {
  contractId: string; number: string; partyId: string; party: string; phone: string; currency: 'IQD' | 'USD';
  amount: number; dueDate: string; daysLate: number;
}
export interface LowStockView { itemId: string; code: string; name: Names; qtyMilli: number; reorderMilli: number | null; soldMilli: number }

export interface BriefView {
  date: string;
  company: Names;
  sales: { today: number; invoices: number; sameDayLastWeek: number; month: number };
  cash: { accounts: CashAccountView[]; total: Money2; base: number };
  flow: { in: number; out: number };
  topItems: ItemSalesView[];
  lateCustomers: AgingRowView[];
  receivables: number;
  installments: { overdue: InstallmentDueView[]; dueTomorrow: InstallmentDueView[]; overdueTotal: Money2 };
  lowStock: LowStockView[];
  approvals: { waitingCheck: number; waitingApproval: number };
  ownerPhone: string;
}

export interface DashboardView {
  date: string;
  salesMonth: number;
  salesLastMonth: number;
  profitMonth: { revenue: number; expenses: number; profit: number };
  cash: { total: Money2; base: number };
  receivables: number;
  payables: number;
  months: { month: string; sales: number; profit: number }[];
}

export const EXPENSE_CATEGORIES = ['rent', 'power', 'fuel', 'salaries', 'internet', 'maintenance', 'transport', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface BriefSettings { ownerPhone: string; expenseAccounts: Record<ExpenseCategory, string> }

export interface ExpenseRowView {
  entryId: string; number: string | null; date: string; status: 'draft' | 'checked' | 'approved'; description: string; cashAccountCode: string | null;
  accountCode: string; category: ExpenseCategory | null; currency: 'IQD' | 'USD'; amount: number; base: number;
}

export interface StockValueView {
  date: string;
  warehouses: { warehouseId: string; warehouseCode: string; warehouseName: Names; items: number; qtyMilli: number; value: number }[];
  items: { warehouseId: string; itemId: string; code: string; name: Names; qtyMilli: number; value: number }[];
}

type Period = { from?: string | undefined; to?: string | undefined };

export const briefApi = {
  brief: (date?: string) => request<BriefView>('GET', '/api/brief' + qs({ date })),
  dashboard: (date?: string) => request<DashboardView>('GET', '/api/brief/dashboard' + qs({ date })),
  settings: () => request<BriefSettings>('GET', '/api/brief/settings'),
  saveSettings: (patch: { ownerPhone?: string; expenseAccounts?: Partial<Record<ExpenseCategory, string>> }) => request<BriefSettings>('PUT', '/api/brief/settings', patch),
  expenses: (month?: string) => request<{ rows: ExpenseRowView[]; byCategory: Partial<Record<ExpenseCategory, number>>; total: number }>('GET', '/api/brief/expenses' + qs({ month })),
  salesByItem: (p: Period) => request<{ from: string; to: string; rows: ItemSalesView[] }>('GET', '/api/brief/reports/sales-by-item' + qs(p)),
  salesByCustomer: (p: Period) => request<{ from: string; to: string; rows: CustomerSalesView[] }>('GET', '/api/brief/reports/sales-by-customer' + qs(p)),
  aging: (type: 'customer' | 'supplier', date?: string) => request<{ date: string; type: string; rows: AgingRowView[] }>('GET', '/api/brief/reports/aging' + qs({ type, date })),
  stockValue: (date?: string) => request<StockValueView>('GET', '/api/brief/reports/stock-value' + qs({ date }))
};
