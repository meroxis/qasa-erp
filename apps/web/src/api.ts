import type {
  CurrencyCode, EntryAction, EntryStatus, EntryType, InvoiceInput, InvoiceKind, InvoiceStatus, Names, Nature, PaymentMode, PostingAccounts, UnitCode
} from '@qasa/core';

export interface AccountView {
  code: string;
  name: Names;
  parentCode: string | null;
  postable: boolean;
  system: boolean;
  nature: Nature;
  balance: number;
  hasEntries: boolean;
}

export interface EntryLineView {
  lineNo: number;
  accountCode: string;
  accountName: Names;
  debit: number;
  credit: number;
  baseDebit: number;
  baseCredit: number;
  description: string;
  partyId: string | null;
  partyName: string | null;
}

export interface EntrySummary {
  id: string;
  type: EntryType;
  number: string | null;
  date: string;
  description: string;
  party: string | null;
  currency: CurrencyCode;
  rateX100: number;
  status: EntryStatus;
  cashAccountCode: string | null;
  reversesId: string | null;
  reversedById: string | null;
  preparedBy: string;
  preparedAt: string;
  checkedBy: string | null;
  checkedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  total: number;
  baseTotal: number;
}

export interface EntryView extends EntrySummary {
  lines: EntryLineView[];
  actions: EntryAction[];
  invoiceId: string | null;
}

export interface Settings {
  companyName: Names;
  defaultRateX100: number;
  fiscalYearStart: string;
  postingAccounts: PostingAccounts;
}

export interface TrialBalanceReport {
  rows: { code: string; name: Names; debit: number; credit: number; balance: number }[];
  totalDebit: number;
  totalCredit: number;
  balanceDebitTotal: number;
  balanceCreditTotal: number;
}

export interface StatementReport {
  accountCode: string;
  name: Names;
  opening: number;
  closing: number;
  totalDebit: number;
  totalCredit: number;
  rows: { entryId: string; number: string; date: string; accountCode: string; accountName: Names; debit: number; credit: number; description: string; balance: number }[];
}

export interface AuditRow {
  id: number;
  at: string;
  user: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: unknown;
}

export interface JournalInput {
  date: string;
  description: string;
  party?: string;
  currency: CurrencyCode;
  rateX100: number;
  lines: { accountCode: string; debit: number; credit: number; description?: string; partyId?: string }[];
}

export interface VoucherInput {
  kind: 'receipt' | 'payment';
  date: string;
  cashAccountCode: string;
  party?: string;
  description: string;
  currency: CurrencyCode;
  rateX100: number;
  items: { accountCode: string; amount: number; description?: string; partyId?: string }[];
}

export type PartyType = 'customer' | 'supplier';

export interface PartyView {
  id: string;
  type: PartyType;
  code: string;
  name: string;
  phone: string;
  address: string;
  accountCode: string;
  creditLimit: number | null;
  notes: string;
  active: boolean;
  /** IQD, in the party's own direction (customer owes us / we owe supplier). */
  balance: number;
  hasEntries: boolean;
}

export interface PartyInput {
  name: string;
  phone?: string;
  address?: string;
  accountCode?: string;
  creditLimit?: number | null;
  notes?: string;
  active?: boolean;
}

export interface PartyStatement {
  party: PartyView;
  opening: number;
  closing: number;
  totalDebit: number;
  totalCredit: number;
  lines: { entryId: string; invoiceId: string | null; number: string; date: string; description: string; debit: number; credit: number; balance: number }[];
}

export interface WarehouseView {
  id: string;
  code: string;
  name: Names;
  accountCode: string;
  active: boolean;
  value: number;
}

export interface ItemView {
  id: string;
  code: string;
  barcode: string;
  name: Names;
  unit: UnitCode;
  salePrice: number;
  saleCurrency: CurrencyCode;
  trackStock: boolean;
  active: boolean;
  qtyMilli: number;
  value: number;
  hasMoves: boolean;
}

export interface ItemInput {
  code?: string;
  barcode?: string;
  name: Names;
  unit: UnitCode;
  salePrice: number;
  saleCurrency: CurrencyCode;
  trackStock?: boolean;
  active?: boolean;
}

export interface ItemDetail extends ItemView {
  stock: { warehouseId: string; warehouseCode: string; warehouseName: Names; qtyMilli: number; value: number }[];
  moves: { id: number; date: string; warehouseCode: string; qtyMilli: number; value: number; sourceType: string; sourceId: string | null; sourceNumber: string | null; balanceQtyMilli: number }[];
}

export interface InvoiceSummary {
  id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  number: string | null;
  date: string;
  partyId: string | null;
  partyCode: string | null;
  partyName: string | null;
  warehouseId: string;
  currency: CurrencyCode;
  rateX100: number;
  payment: PaymentMode;
  cashAccountCode: string | null;
  discount: number;
  subtotal: number;
  total: number;
  baseTotal: number;
  notes: string;
  createdBy: string;
  createdAt: string;
}

export type InvoiceAction = 'edit' | 'delete' | 'post' | 'cancel';

export interface InvoiceView extends InvoiceSummary {
  partyPhone: string | null;
  partyAddress: string | null;
  warehouseCode: string;
  warehouseName: Names;
  cashAccountName: Names | null;
  entryId: string | null;
  entryNumber: string | null;
  cancelEntryId: string | null;
  cancelEntryNumber: string | null;
  postedBy: string | null;
  postedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  lines: {
    lineNo: number; itemId: string; itemCode: string; itemName: Names; unit: UnitCode; trackStock: boolean;
    description: string; qtyMilli: number; unitPrice: number; amount: number; cost: number | null;
  }[];
  actions: InvoiceAction[];
}

export type { InvoiceInput };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, details: unknown) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const USER_KEY = 'qasa.user';

export function currentUser(): string {
  try {
    return localStorage.getItem(USER_KEY) || '';
  } catch {
    return '';
  }
}

export function setCurrentUser(name: string): void {
  try {
    localStorage.setItem(USER_KEY, name);
  } catch {
    // storage unavailable — the name just won't be remembered
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const user = currentUser();
  if (user) headers['x-qasa-user'] = encodeURIComponent(user);
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'network', null);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'internal', data?.details ?? null);
  return data as T;
}

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};

export const api = {
  health: () => request<{ ok: boolean }>('GET', '/api/health'),
  settings: () => request<Settings>('GET', '/api/settings'),
  updateSettings: (patch: Partial<Settings>) => request<Settings>('PUT', '/api/settings', patch),
  accounts: () => request<AccountView[]>('GET', '/api/accounts'),
  createAccount: (input: { parentCode: string; code: string; name: Names }) => request<AccountView>('POST', '/api/accounts', input),
  renameAccount: (code: string, name: Names) => request<AccountView>('PATCH', `/api/accounts/${code}`, { name }),
  deleteAccount: (code: string) => request<void>('DELETE', `/api/accounts/${code}`),
  entries: (f: { type?: string; status?: string; q?: string; from?: string; to?: string } = {}) => request<EntrySummary[]>('GET', '/api/entries' + qs(f)),
  entry: (id: string) => request<EntryView>('GET', `/api/entries/${id}`),
  createJournal: (input: JournalInput) => request<EntryView>('POST', '/api/entries', input),
  updateJournal: (id: string, input: JournalInput) => request<EntryView>('PUT', `/api/entries/${id}`, input),
  createVoucher: (input: VoucherInput) => request<EntryView>('POST', '/api/vouchers', input),
  updateVoucher: (id: string, input: VoucherInput) => request<EntryView>('PUT', `/api/vouchers/${id}`, input),
  deleteEntry: (id: string) => request<void>('DELETE', `/api/entries/${id}`),
  entryAction: (id: string, action: 'check' | 'return' | 'approve') => request<EntryView>('POST', `/api/entries/${id}/${action}`, {}),
  reverse: (id: string, date: string) => request<EntryView>('POST', `/api/entries/${id}/reverse`, { date }),
  trialBalance: (from?: string, to?: string) => request<TrialBalanceReport>('GET', '/api/reports/trial-balance' + qs({ from, to })),
  statement: (account: string, from?: string, to?: string) => request<StatementReport>('GET', '/api/reports/statement' + qs({ account, from, to })),
  periods: () => request<{ period: string; lockedBy: string; lockedAt: string }[]>('GET', '/api/periods'),
  lockPeriod: (period: string) => request<unknown>('POST', `/api/periods/${period}/lock`, {}),
  unlockPeriod: (period: string) => request<unknown>('DELETE', `/api/periods/${period}/lock`),
  audit: (limit = 100) => request<AuditRow[]>('GET', `/api/audit?limit=${limit}`),

  parties: (f: { type?: PartyType; q?: string; active?: string } = {}) => request<PartyView[]>('GET', '/api/parties' + qs(f)),
  party: (id: string) => request<PartyView>('GET', `/api/parties/${id}`),
  createParty: (type: PartyType, input: PartyInput) => request<PartyView>('POST', '/api/parties', { type, ...input }),
  updateParty: (id: string, input: PartyInput) => request<PartyView>('PUT', `/api/parties/${id}`, input),
  deleteParty: (id: string) => request<void>('DELETE', `/api/parties/${id}`),
  partyStatement: (id: string, from?: string, to?: string) => request<PartyStatement>('GET', `/api/parties/${id}/statement` + qs({ from, to })),

  warehouses: () => request<WarehouseView[]>('GET', '/api/warehouses'),
  createWarehouse: (input: { code: string; name: Names }) => request<WarehouseView>('POST', '/api/warehouses', input),
  updateWarehouse: (id: string, input: { name: Names; active?: boolean }) => request<WarehouseView>('PUT', `/api/warehouses/${id}`, input),
  items: (f: { q?: string; warehouseId?: string; active?: string } = {}) => request<ItemView[]>('GET', '/api/items' + qs(f)),
  item: (id: string) => request<ItemDetail>('GET', `/api/items/${id}`),
  createItem: (input: ItemInput) => request<ItemView>('POST', '/api/items', input),
  updateItem: (id: string, input: ItemInput) => request<ItemView>('PUT', `/api/items/${id}`, input),
  deleteItem: (id: string) => request<void>('DELETE', `/api/items/${id}`),

  invoices: (f: { kind?: InvoiceKind; status?: string; partyId?: string; q?: string; from?: string; to?: string } = {}) => request<InvoiceSummary[]>('GET', '/api/invoices' + qs(f)),
  invoice: (id: string) => request<InvoiceView>('GET', `/api/invoices/${id}`),
  createInvoice: (input: InvoiceInput) => request<InvoiceView>('POST', '/api/invoices', input),
  updateInvoice: (id: string, input: InvoiceInput) => request<InvoiceView>('PUT', `/api/invoices/${id}`, input),
  deleteInvoice: (id: string) => request<void>('DELETE', `/api/invoices/${id}`),
  postInvoice: (id: string) => request<InvoiceView>('POST', `/api/invoices/${id}/post`, {}),
  cancelInvoice: (id: string, date: string) => request<InvoiceView>('POST', `/api/invoices/${id}/cancel`, { date })
};
