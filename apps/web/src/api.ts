import type {
  LicenseInfo, LicenseState, PlanResolution,
  CurrencyCode, EntryAction, EntryStatus, EntryType, InvoiceDocKind, InvoiceInput, InvoiceKind, InvoiceStatus, Names, Nature, PaymentMode, PostingAccounts, UnitCode
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
  stockDocId: string | null;
}

export interface Settings {
  companyName: Names;
  defaultRateX100: number;
  fiscalYearStart: string;
  postingAccounts: PostingAccounts;
}

export interface PlanStatus extends PlanResolution {
  /** The activated license, also after it ended. */
  license: (LicenseInfo & { state: LicenseState }) | null;
  trialAvailable: boolean;
  trialStarted: string | null;
  usage: { warehouses: number; salesThisMonth: number };
  nudge: boolean;
}

export interface NamedAmount { code: string; name: Names; amount: number }

export interface FinalAccountsReport {
  from: string;
  to: string;
  sections: { id: 'trading' | 'operations' | 'profitLoss'; rows: { id: string; kind: 'line' | 'subtotal'; sign: 1 | -1; groups: string[]; amount: number; details: NamedAmount[] }[] }[];
  netResult: number;
  balanceSheet: {
    assets: (NamedAmount & { details: NamedAmount[] })[];
    liabilities: (NamedAmount & { details: NamedAmount[] })[];
    priorResult: number;
    currentResult: number;
    totalAssets: number;
    totalLiabilities: number;
  };
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
  kind: InvoiceDocKind;
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
  returnOf: string | null;
  createdBy: string;
  createdAt: string;
}

export type InvoiceAction = 'edit' | 'delete' | 'post' | 'cancel' | 'return';

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
    sourceLine: number | null; returnedQtyMilli: number;
  }[];
  actions: InvoiceAction[];
  returnOfNumber: string | null;
  returns: { id: string; kind: InvoiceDocKind; number: string | null; date: string; status: InvoiceStatus; total: number }[];
}

export type Role = 'admin' | 'preparer' | 'checker' | 'approver' | 'sales' | 'purchasing' | 'storekeeper' | 'viewer';
export const ROLES: Role[] = ['admin', 'preparer', 'checker', 'approver', 'sales', 'purchasing', 'storekeeper', 'viewer'];
export type Permission = 'admin' | 'entries.prepare' | 'entries.check' | 'entries.approve' | 'sales' | 'purchases' | 'stock';

export interface Me {
  signInRequired: boolean;
  separateDuties: boolean;
  demo: boolean;
  user: { id: string | null; name: string; username: string; roles: Role[]; permissions: Permission[] } | null;
}

export interface UserView {
  id: string;
  username: string;
  name: string;
  roles: Role[];
  active: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ReturnInput {
  date: string;
  payment: PaymentMode;
  cashAccountCode?: string;
  notes?: string;
  lines: { lineNo: number; qtyMilli: number }[];
}

export type StockDocKind = 'opening' | 'transfer';
export type StockDocAction = 'edit' | 'delete' | 'post' | 'cancel';

export interface StockDocSummary {
  id: string;
  kind: StockDocKind;
  status: InvoiceStatus;
  number: string | null;
  date: string;
  warehouseId: string;
  warehouseName: Names;
  toWarehouseId: string | null;
  toWarehouseName: Names | null;
  totalValue: number;
  notes: string;
  createdBy: string;
}

export interface StockDocView extends StockDocSummary {
  counterAccountCode: string | null;
  counterAccountName: Names | null;
  entryId: string | null;
  entryNumber: string | null;
  cancelEntryId: string | null;
  cancelEntryNumber: string | null;
  postedBy: string | null;
  postedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  lines: { lineNo: number; itemId: string; itemCode: string; itemName: Names; unit: UnitCode; qtyMilli: number; unitCost: number | null; value: number | null }[];
  actions: StockDocAction[];
}

export interface StockDocInput {
  kind: StockDocKind;
  date: string;
  warehouseId: string;
  toWarehouseId?: string;
  counterAccountCode?: string;
  notes?: string;
  lines: { itemId: string; qtyMilli: number; unitCost?: number }[];
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

/** Fired when the server says nobody is signed in (a session ended); the app shows the sign-in page. */
export const SIGNED_OUT_EVENT = 'qasa:signed-out';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  // marks requests as coming from the app itself; the server refuses changes without it once sign-in is on
  const headers: Record<string, string> = { 'x-qasa-client': '1' };
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
  if (res.status === 401 && data?.error === 'unauthorized') window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
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
  finalAccounts: (from: string, to: string) => request<FinalAccountsReport>('GET', '/api/reports/final-accounts' + qs({ from, to })),
  statement: (account: string, from?: string, to?: string) => request<StatementReport>('GET', '/api/reports/statement' + qs({ account, from, to })),
  periods: () => request<{ period: string; lockedBy: string; lockedAt: string }[]>('GET', '/api/periods'),
  lockPeriod: (period: string) => request<unknown>('POST', `/api/periods/${period}/lock`, {}),
  unlockPeriod: (period: string) => request<unknown>('DELETE', `/api/periods/${period}/lock`),
  audit: (limit = 100) => request<AuditRow[]>('GET', `/api/audit?limit=${limit}`),

  me: () => request<Me>('GET', '/api/auth/me'),
  login: (username: string, password: string) => request<Me>('POST', '/api/auth/login', { username, password }),
  logout: () => request<{ ok: boolean }>('POST', '/api/auth/logout', {}),
  changePassword: (current: string | undefined, password: string) => request<{ ok: boolean }>('POST', '/api/auth/password', { ...(current ? { current } : {}), password }),
  setSignIn: (on: boolean) => request<Me>('PUT', '/api/auth/signin', { on }),
  setSeparateDuties: (on: boolean) => request<Me>('PUT', '/api/auth/separate-duties', { on }),
  users: () => request<UserView[]>('GET', '/api/users'),
  createUser: (input: { username: string; name: string; roles: Role[]; password?: string }) => request<UserView>('POST', '/api/users', input),
  updateUser: (id: string, input: { username: string; name: string; roles: Role[]; active: boolean }) => request<UserView>('PUT', `/api/users/${id}`, input),
  setUserPassword: (id: string, password: string) => request<UserView>('POST', `/api/users/${id}/password`, { password }),

  plan: () => request<PlanStatus>('GET', '/api/plan'),
  activateLicense: (key: string) => request<PlanStatus>('POST', '/api/plan/license', { key }),
  removeLicense: () => request<PlanStatus>('DELETE', '/api/plan/license'),
  startTrial: () => request<PlanStatus>('POST', '/api/plan/trial', {}),

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

  invoices: (f: { kind?: InvoiceDocKind; status?: string; partyId?: string; q?: string; from?: string; to?: string } = {}) => request<InvoiceSummary[]>('GET', '/api/invoices' + qs(f)),
  invoice: (id: string) => request<InvoiceView>('GET', `/api/invoices/${id}`),
  createInvoice: (input: InvoiceInput) => request<InvoiceView>('POST', '/api/invoices', input),
  updateInvoice: (id: string, input: InvoiceInput) => request<InvoiceView>('PUT', `/api/invoices/${id}`, input),
  deleteInvoice: (id: string) => request<void>('DELETE', `/api/invoices/${id}`),
  postInvoice: (id: string) => request<InvoiceView>('POST', `/api/invoices/${id}/post`, {}),
  cancelInvoice: (id: string, date: string) => request<InvoiceView>('POST', `/api/invoices/${id}/cancel`, { date }),
  createReturn: (id: string, input: ReturnInput) => request<InvoiceView>('POST', `/api/invoices/${id}/returns`, input),

  stockDocs: (f: { kind?: StockDocKind; status?: string } = {}) => request<StockDocSummary[]>('GET', '/api/stock-docs' + qs(f)),
  stockDoc: (id: string) => request<StockDocView>('GET', `/api/stock-docs/${id}`),
  createStockDoc: (input: StockDocInput) => request<StockDocView>('POST', '/api/stock-docs', input),
  updateStockDoc: (id: string, input: StockDocInput) => request<StockDocView>('PUT', `/api/stock-docs/${id}`, input),
  deleteStockDoc: (id: string) => request<void>('DELETE', `/api/stock-docs/${id}`),
  postStockDoc: (id: string) => request<StockDocView>('POST', `/api/stock-docs/${id}/post`, {}),
  cancelStockDoc: (id: string, date: string) => request<StockDocView>('POST', `/api/stock-docs/${id}/cancel`, { date })
};
