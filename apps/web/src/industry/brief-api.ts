import type { Names } from '@qasa/core';
import { qs, request } from '../api.ts';
import type { ChequeCounts, ChequesAheadView } from './ChequesAhead.tsx';

/** The owner's dashboard, the Daily Brief, the management reports and quick expenses. Amounts in IQD unless said. */
export type Money2 = { IQD: number; USD: number };

export interface CashAccountView { code: string; name: Names; balance: Money2; base: number }
/** cost and profit: absent for someone who may not read the books (1.4) */
export interface ItemSalesView { itemId: string; code: string; name: Names; qtyMilli: number; sales: number; cost?: number; profit?: number }
export interface SalesFiguresView { qtyMilli: number; sales: number; cost?: number; profit?: number }
/** A category (its subcategories in children, total with them) or a brand; id null: items with none. */
export interface GroupSalesView extends SalesFiguresView { id: string | null; code: string; name: Names | null; children: GroupSalesView[]; total: SalesFiguresView }
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
  /** cash and flow: the company's money, absent for someone who may not read the books (1.4) */
  cash?: { accounts: CashAccountView[]; total: Money2; base: number };
  flow?: { in: number; out: number };
  topItems: ItemSalesView[];
  lateCustomers: AgingRowView[];
  receivables: number;
  installments: { overdue: InstallmentDueView[]; dueTomorrow: InstallmentDueView[]; overdueTotal: Money2 };
  lowStock: LowStockView[];
  approvals: { waitingCheck: number; waitingApproval: number };
  /** older servers leave it out */
  cheques?: ChequesAheadView;
  ownerPhone: string;
  /** 1.1: batches past their expiry date or near it (null: no item tracks expiry; older servers leave it out) */
  expiry?: { expired: number; near: number; days: number; top: { itemId: string; itemName: Names; batch: string; expiry: string | null; qtyMilli: number; state: string | null }[] } | null;
}

export interface DashboardView {
  date: string;
  salesMonth: number;
  salesLastMonth: number;
  /** null when one branch is shown: profit is only known for the whole company */
  profitMonth?: { revenue: number; expenses: number; profit: number } | null;
  /** absent for someone who may not read the books (1.4) */
  cash?: { total: Money2; base: number };
  receivables: number;
  payables: number;
  months: { month: string; sales: number; profit?: number | null }[];
  cheques?: ChequeCounts;
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

/** A month's expenses by account; the kind only when one kind alone uses the account (else null: shown by account name). */
export interface ExpenseAccountTotal { accountCode: string; name: Names; category: ExpenseCategory | null; amount: number }

export const briefApi = {
  brief: (date?: string) => request<BriefView>('GET', '/api/brief' + qs({ date })),
  dashboard: (date?: string) => request<DashboardView>('GET', '/api/brief/dashboard' + qs({ date })),
  settings: () => request<BriefSettings>('GET', '/api/brief/settings'),
  saveSettings: (patch: { ownerPhone?: string; expenseAccounts?: Partial<Record<ExpenseCategory, string>> }) => request<BriefSettings>('PUT', '/api/brief/settings', patch),
  expenses: (month?: string) => request<{ rows: ExpenseRowView[]; byCategory: Partial<Record<ExpenseCategory, number>>; byAccount: ExpenseAccountTotal[]; total: number }>('GET', '/api/brief/expenses' + qs({ month })),
  salesByItem: (p: Period) => request<{ from: string; to: string; rows: ItemSalesView[] }>('GET', '/api/brief/reports/sales-by-item' + qs(p)),
  salesByGroup: (by: 'category' | 'brand', p: Period) =>
    request<{ from: string; to: string; by: string; rows: GroupSalesView[]; total: SalesFiguresView }>('GET', '/api/brief/reports/sales-by-group' + qs({ by, ...p })),
  salesByCustomer: (p: Period) => request<{ from: string; to: string; rows: CustomerSalesView[] }>('GET', '/api/brief/reports/sales-by-customer' + qs(p)),
  aging: (type: 'customer' | 'supplier', date?: string) => request<{ date: string; type: string; rows: AgingRowView[] }>('GET', '/api/brief/reports/aging' + qs({ type, date })),
  stockValue: (date?: string) => request<StockValueView>('GET', '/api/brief/reports/stock-value' + qs({ date }))
};

/** How a sale was paid, on the end-of-day close. */
export type DayMethod = 'cash' | 'bank' | 'card' | 'fib' | 'zaincash' | 'qi' | 'credit' | 'loyalty';

export interface DayRegisterView {
  shiftId: string; number: string; register: string; openedBy: string; status: 'open' | 'closed'; openedAt: string; closedAt: string | null;
  sales: Money2; count: number; expected: Money2; counted: Money2 | null; difference: Money2 | null;
}
export interface DayDebtRowView { partyId: string; code: string; name: string; amount: number }

/** The end-of-day close (GET /api/brief/day-close). Amounts in IQD unless they are Money2. */
export interface DayCloseView {
  date: string;
  company: Names;
  sales: { gross: number; invoices: number; returns: number; returnsCount: number; net: number };
  methods: { method: DayMethod; amount: number; invoices: number }[];
  refunds: { method: DayMethod; amount: number }[];
  registers: DayRegisterView[];
  drawers: { expected: Money2; counted: Money2; difference: Money2 } | null;
  /** expenses and flow: absent for someone who may not read the books (1.4); the registers and drawers stay */
  expenses?: { rows: ExpenseRowView[]; total: number };
  debts: { collected: number; collectedRows: DayDebtRowView[]; added: number; addedRows: DayDebtRowView[] };
  flow?: { in: number; out: number };
  lowStock: { count: number; top: LowStockView[] };
  topItems: ItemSalesView[];
  ownerPhone: string;
}

export const dayCloseApi = {
  get: (date?: string) => request<DayCloseView>('GET', '/api/brief/day-close' + qs({ date }))
};
