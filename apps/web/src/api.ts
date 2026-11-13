import type {
  BusinessType, Lang, LicenseInfo, LicenseState, PlanResolution,
  CurrencyCode, EntryAction, EntryStatus, EntryType, InvoiceDocKind, InvoiceInput, InvoiceKind, InvoiceStatus, Names, Nature, PaymentMode, PostingAccounts, UnitCode
} from '@qasa/core';
import { currentBranchHeader } from './industry/branches-api.ts';

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
  /** What the company does; null until chosen (the app asks at the start). */
  businessTypes: BusinessType[] | null;
}

export interface PlanStatus extends PlanResolution {
  /** The activated license, also after it ended. */
  license: (LicenseInfo & { state: LicenseState }) | null;
  trialAvailable: boolean;
  trialStarted: string | null;
  usage: { warehouses: number; salesThisMonth: number };
  nudge: boolean;
  /** Online activation of the licence on this PC: required in the official app before the licence counts. */
  activation: {
    required: boolean;
    state: 'none' | 'active' | 'needs_activation' | 'stale' | 'revoked' | 'clock';
    checkBy: string | null;
    offlineUntil: string | null;
    lastChecked: string | null;
    revokedReason: string | null;
    /** A key from 0.1.8 never activated: the last day it keeps counting while the app activates it online (null otherwise; left out by older servers). */
    graceUntil?: string | null;
    /** The key counts now under that grace (the state is still needs_activation). */
    inGrace?: boolean;
  };
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
  /** Opening (before From), movement (From to To) and closing balance, each as debit and credit. */
  rows: { code: string; name: Names; openingDebit: number; openingCredit: number; debit: number; credit: number; closingDebit: number; closingCredit: number; balance: number }[];
  openingDebitTotal: number;
  openingCreditTotal: number;
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
  /** 1.1: the same per currency, each in its own (older servers leave it out) */
  balances?: Record<CurrencyCode, number>;
  /** 1.2: the language their WhatsApp messages are written in (null: the app's; older servers leave it out) */
  lang?: Lang | null;
}

export interface PartyInput {
  name: string;
  phone?: string;
  address?: string;
  accountCode?: string;
  creditLimit?: number | null;
  notes?: string;
  active?: boolean;
  lang?: Lang | null;
}

export interface PartyStatement {
  party: PartyView;
  /** 1.1: null = all lines in IQD at the book rates; IQD or USD = that currency's lines only, in it */
  currency?: CurrencyCode | null;
  opening: number;
  closing: number;
  totalDebit: number;
  totalCredit: number;
  lines: {
    entryId: string; invoiceId: string | null; number: string; date: string; description: string; debit: number; credit: number; balance: number;
    currency?: CurrencyCode; amount?: number;
  }[];
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
  /** 1.1: the other units (boxes, strips …), the units sale and purchase lines start in (null: the base unit) */
  units: ItemUnitView[];
  saleUnit: UnitCode | null;
  purchaseUnit: UnitCode | null;
  updatedAt: string | null;
  /** stock kept per batch number; an expiry date asked on the way in */
  trackBatches: boolean;
  trackExpiry: boolean;
  categoryId: string | null;
  /** 1.1: the brand, and the stock level to reorder at (thousandths; null: the category's, or none) */
  brandId: string | null;
  reorderMilli: number | null;
}

/** One of an item's other units: base units in one (thousandths), its barcode and its own price (null: base × factor). */
export interface ItemUnitView { unit: UnitCode; factorMilli: number; barcode: string; salePrice: number | null }

export interface ItemInput {
  code?: string;
  barcode?: string;
  name: Names;
  unit: UnitCode;
  salePrice: number;
  saleCurrency: CurrencyCode;
  trackStock?: boolean;
  active?: boolean;
  units?: { unit: UnitCode; factorMilli: number; barcode?: string; salePrice?: number | null }[];
  saleUnit?: UnitCode | null;
  purchaseUnit?: UnitCode | null;
  trackBatches?: boolean;
  trackExpiry?: boolean;
  categoryId?: string | null;
  brandId?: string | null;
  reorderMilli?: number | null;
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
  /** 1.1: online payments recorded on it (a website order) */
  paidOnline?: number;
}

/** Money taken for an invoice outside its own cash or credit: POS parts and online payments (1.1). */
export interface InvoicePaymentView {
  id: string; kind: 'pos' | 'online'; method: string; accountCode: string; amount: number; currency: CurrencyCode;
  reference: string | null; source: string | null; entryId: string | null; entryNumber: string | null; entryStatus: string | null; createdAt: string;
}

export type InvoiceAction = 'edit' | 'delete' | 'post' | 'cancel' | 'return';

export interface InvoiceView extends InvoiceSummary {
  partyPhone: string | null;
  partyAddress: string | null;
  /** 1.2: the customer's language for WhatsApp messages (null: the app's; older servers leave it out) */
  partyLang?: Lang | null;
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
    sourceLine: number | null; returnedQtyMilli: number; returnedAmount: number;
    /** 1.1: the unit the line was typed in (null: the base unit), its factor then and the quantity typed */
    lineUnit: UnitCode | null; unitFactorMilli: number | null; unitQtyMilli: number | null;
    batchNo: string | null; expiry: string | null; batchId: string | null;
  }[];
  actions: InvoiceAction[];
  returnOfNumber: string | null;
  returns: { id: string; kind: InvoiceDocKind; number: string | null; date: string; status: InvoiceStatus; total: number }[];
  /** the installment contract that schedules this sale (Pro), while it is active */
  installmentContract: { id: string; number: string } | null;
  /** 1.1 (older servers leave it out) */
  payments?: InvoicePaymentView[];
  /** 1.2: a till's sale made offline: the temporary reference printed on its receipt */
  offlineRef?: string;
  /** 1.2 (Pro): the loyalty points it earned and used, and the customer's balance (null: none and points are off) */
  loyalty?: { earned: number; redeemed: number; value: number; balance: number } | null;
}

export type Role = 'admin' | 'preparer' | 'checker' | 'approver' | 'sales' | 'purchasing' | 'storekeeper' | 'viewer';
export const ROLES: Role[] = ['admin', 'preparer', 'checker', 'approver', 'sales', 'purchasing', 'storekeeper', 'viewer'];
export type Permission = 'admin' | 'entries.prepare' | 'entries.check' | 'entries.approve' | 'sales' | 'purchases' | 'stock';

export interface Me {
  signInRequired: boolean;
  separateDuties: boolean;
  demo: boolean;
  /** branchLimited: limited to some branches (never an admin), so the company's own books are not for them */
  user: { id: string | null; name: string; username: string; roles: Role[]; permissions: Permission[]; branchLimited?: boolean } | null;
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
  /** Active, but over the plan's number of users: can't sign in until an admin makes room or the plan grows. */
  overLimit?: boolean;
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
  lines: {
    lineNo: number; itemId: string; itemCode: string; itemName: Names; unit: UnitCode; qtyMilli: number; unitCost: number | null; value: number | null;
    lineUnit: UnitCode | null; unitFactorMilli: number | null; unitQtyMilli: number | null;
    batchNo: string | null; expiry: string | null; batchId: string | null;
  }[];
  actions: StockDocAction[];
}

export interface StockDocInput {
  kind: StockDocKind;
  date: string;
  warehouseId: string;
  toWarehouseId?: string;
  counterAccountCode?: string;
  notes?: string;
  lines: { itemId: string; qtyMilli: number; unitCost?: number; unit?: UnitCode; unitQtyMilli?: number; batchNo?: string; expiry?: string; batchId?: string }[];
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

/** Requests still waiting for the server; the app shows a thin bar when one takes a moment (see BusyBar). */
let inFlight = 0;
const busyListeners = new Set<(n: number) => void>();
export function onBusyChange(fn: (n: number) => void): () => void {
  busyListeners.add(fn);
  return () => { busyListeners.delete(fn); };
}
/** How many requests still wait for the server now (a paper is printed once what it shows has arrived). */
export const pendingRequests = (): number => inFlight;
function setInFlight(n: number) {
  inFlight = n;
  for (const fn of busyListeners) fn(n);
}

export async function request<T>(method: string, url: string, body?: unknown, options: SendOptions = {}): Promise<T> {
  setInFlight(inFlight + 1);
  try {
    return await send<T>(method, url, body, options);
  } finally {
    setInFlight(inFlight - 1);
  }
}

/**
 * 1.2, for what a PC may send again (the outbox): `key` is the request's idempotency key (a UUID v4, the same every
 * time it is sent), `books` the company books it was made for; `timeoutMs` gives up on a server that doesn't answer
 * (a network error, so the till can keep the sale on this PC instead of waiting).
 */
export interface SendOptions { key?: string; books?: string; timeoutMs?: number }

/** A new idempotency key (UUID v4). */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Whether the server answered the last request (any answer, a refusal too) or could not be reached. The office PCs'
 * till keeps its sales on the PC while it can't, and the outbox sends them when it answers again.
 */
let reachable = true;
const linkListeners = new Set<(up: boolean) => void>();
export function serverReachable(): boolean {
  return reachable;
}
export function onLinkChange(fn: (up: boolean) => void): () => void {
  linkListeners.add(fn);
  return () => { linkListeners.delete(fn); };
}
export function setReachable(up: boolean): void {
  if (up === reachable) return;
  reachable = up;
  for (const fn of linkListeners) fn(up);
}

/** A network failure: the server was not reached (or did not answer in time), so it may or may not have the request. */
export const isNetworkError = (error: unknown): boolean => error instanceof ApiError && error.status === 0 && error.code === 'network';

async function send<T>(method: string, url: string, body?: unknown, options: SendOptions = {}): Promise<T> {
  // marks requests as coming from the app itself; the server refuses changes without it once sign-in is on
  // the branch picked in the topbar (for someone working in several), so lists and reports follow it
  const headers: Record<string, string> = { 'x-qasa-client': '1', ...currentBranchHeader() };
  const user = currentUser();
  if (user) headers['x-qasa-user'] = encodeURIComponent(user);
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (options.key) headers['x-qasa-idempotency'] = options.key;
  if (options.books) headers['x-qasa-books'] = options.books;
  let res: Response;
  const abort = options.timeoutMs ? new AbortController() : null;
  const timer = abort ? setTimeout(() => abort.abort(), options.timeoutMs) : null;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), ...(abort ? { signal: abort.signal } : {}) });
  } catch {
    setReachable(false);
    throw new ApiError(0, 'network', null);
  } finally {
    if (timer) clearTimeout(timer);
  }
  setReachable(true);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (res.status === 401 && data?.error === 'unauthorized') window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'internal', data?.details ?? null);
  return data as T;
}

export const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};

/** The office network (Pro module): other PCs work on this company file. Missing (404) in builds without Pro. */
export interface NetworkStatus {
  available: boolean;
  signInRequired: boolean;
  on: boolean;
  port: number;
  addresses: string[];
  hostname: string;
  code: string | null;
  signedIn: number;
  /** The plan includes Qasa Relay (Pro, Business); false on Starter, whose office network stays inside the office. */
  relayAvailable?: boolean;
}

/** Backups (Pro module): a daily checked copy of the company file in a chosen folder. Missing (404) without Pro. */
export interface BackupStatus {
  available: boolean;
  on: boolean;
  folder: string;
  keep: number;
  last: { at: string; file: string; size: number } | null;
  lastError: string | null;
  next: string | null;
  encrypted: boolean;
  /** the folder is synced to a cloud service */
  cloudFolder: boolean;
  /**
   * The default folder is synced to the internet and there is no backup password, so the copies are kept on this PC in
   * `folder` instead: this is the synced folder they go to once a password is set (left out by older servers).
   */
  syncedDefault?: string | null;
  /** syncedDefault, and the admin hasn't been told yet: the bar shows it once. */
  localNotice?: boolean;
  /** Why the last copy failed (lastError) as a code with words of its own ('other': only lastError says). */
  lastErrorCode?: 'settings_unreadable' | 'synced_needs_password' | 'password_unreadable' | 'copy_check' | 'reopen_failed' | 'disk_full' | 'no_access' | 'folder_missing' | 'other' | null;
  /** 1.1: a backup when the app closes and the books changed (off unless turned on), the folder it is also copied to, and why the last one failed */
  onClose?: boolean;
  closeFolder?: string | null;
  closeError?: string | null;
  /** `own: false`: a copy made by another company or on another PC (left out by older servers: treated as this company's). */
  files: { name: string; size: number; at: string; encrypted: boolean; own?: boolean }[];
  /**
   * What needs the admin: the plan has no automatic copies (Free, or a trial that ended) and none was saved for 3 days,
   * they were turned off and none was saved for 3 days, the last one failed, or the last one is over 3 days old.
   */
  notice?: 'plan' | 'off' | 'old' | 'failed' | null;
}

/** Where the company database is (Pro module): the company file, or the company's MariaDB/MySQL server. Missing (404) without Pro. */
export type DatabaseTls = 'verified' | 'ca' | 'pinned' | 'off';
export interface DatabaseStatus {
  kind: 'file' | 'server';
  available: boolean;
  server: { host: string; port: number; database: string; user: string; tls: DatabaseTls; version: string | null; since: string } | null;
  localCopy: string | null;
}
export interface DatabaseInput { host: string; port: number; database: string; user: string; password: string; ca?: string; fingerprint?: string }
export type DatabaseCheck =
  | { step: 'confirm_certificate'; certificate: { fingerprint: string; subject: string; validTo: string } }
  | { step: 'needs_ca'; certificate: { subject: string; issuer: string } }
  | { step: 'ready'; server: { version: string; mariadb: boolean }; tls: DatabaseTls; state: 'empty' | 'company'; company: { name: string; entries: number; version: number } | null; inUse: boolean; broadAccount: boolean };

/** Installment sales (Pro module). Missing (404) in builds without Pro. */
export type ContractState = 'active' | 'overdue' | 'paid' | 'cancelled';
export type InstallmentState = 'paid' | 'overdue' | 'due' | 'upcoming';
export type Money2 = { IQD: number; USD: number };
export interface ScheduleRowView { seq: number; dueDate: string; amount: number; paid: number; state: InstallmentState; daysLate: number }
export interface GuarantorView {
  id: string; name: string; phone: string; idNumber: string; address: string; workplace: string; notes: string;
  contracts: number; exposure: Money2;
}
export interface GuarantorInput { name: string; phone?: string; idNumber?: string; address?: string; workplace?: string; notes?: string }
export interface ContractSummaryView {
  id: string; number: string; date: string; status: ContractState;
  party: { id: string; code: string; name: string; phone: string };
  guarantor: { id: string; name: string; phone: string } | null;
  invoice: { id: string; number: string | null } | null;
  description: string; currency: CurrencyCode; total: number; downPayment: number; months: number;
  paid: number; remaining: number; overdue: number;
  next: { seq: number; dueDate: string; amount: number; daysLate: number } | null;
}
export interface ContractView extends Omit<ContractSummaryView, 'party' | 'guarantor'> {
  party: ContractSummaryView['party'] & { address: string; accountCode: string };
  guarantor: GuarantorView | null;
  notes: string; createdBy: string; createdAt: string; cancelledBy: string | null; cancelledAt: string | null;
  schedule: ScheduleRowView[];
  receipts: { entryId: string; number: string | null; date: string; amount: number; reversed: boolean; by: string }[];
  actions: ('collect' | 'cancel' | 'edit')[];
}
export interface InstallmentTerms { date: string; firstDue: string; total: number; downPayment: number; months: number; currency: CurrencyCode }
export interface ContractInput extends InstallmentTerms {
  partyId: string; invoiceId?: string; description: string; guarantorId?: string; guarantor?: GuarantorInput; notes?: string;
  downPaymentCashAccount?: string; rateX100?: number; lang: Lang;
}
export interface InstallmentsSummaryView {
  available: boolean; active: number; outstanding: Money2;
  dueThisWeek: { contracts: number; amount: Money2 }; overdue: { contracts: number; amount: Money2 }; collectedThisMonth: Money2;
}
export type AgingBucket = 'd30' | 'd60' | 'd90' | 'over90';
export interface AgingView {
  rows: { contract: Pick<ContractSummaryView, 'id' | 'number' | 'party' | 'guarantor' | 'currency'>; buckets: Record<AgingBucket, number>; total: number; oldestDays: number }[];
  totals: Record<CurrencyCode, Record<AgingBucket, number>>;
}

/** Year-end closing: each fiscal year, newest first, with why it can't be closed yet. */
export interface YearEndStatus {
  fiscalYearStart: string;
  years: {
    year: number;
    from: string;
    to: string;
    ended: boolean;
    closing: { entryId: string; number: string | null; by: string | null; at: string | null } | null;
    result: number;
    blockers: { code: string; year?: number; count?: number }[];
  }[];
}

export const api = {
  health: () => request<{ ok: boolean }>('GET', '/api/health'),
  /** the company file's schema version and the one this app writes (Remote support → Copy support details) */
  support: () => request<{ schema: number; app: number }>('GET', '/api/support'),
  yearEnd: () => request<YearEndStatus>('GET', '/api/year-end'),
  closeYear: (year: number) => request<EntryView>('POST', `/api/year-end/${year}/close`, {}),
  reopenYear: (year: number) => request<EntryView>('POST', `/api/year-end/${year}/reopen`, {}),
  network: () => request<NetworkStatus>('GET', '/api/network'),
  setNetwork: (on: boolean) => request<NetworkStatus>('PUT', '/api/network', { on }),
  backup: () => request<BackupStatus>('GET', '/api/backup'),
  setBackup: (patch: { on?: boolean; keep?: number; onClose?: boolean }) => request<BackupStatus>('PUT', '/api/backup', patch),
  chooseCloseFolder: (clear = false) => request<BackupStatus>('POST', '/api/backup/close-folder', clear ? { clear: true } : {}),
  chooseBackupFolder: () => request<BackupStatus>('POST', '/api/backup/folder', {}),
  runBackup: () => request<BackupStatus>('POST', '/api/backup/run', {}),
  /**
   * by name from the list, by the token of a picked file, or (with neither) from a file chosen in Windows' file picker;
   * allowPlain: the admin confirmed an unencrypted copy while the company has a backup password (backup_not_encrypted)
   */
  restoreBackup: (req: { name?: string; pick?: string; password?: string; allowPlain?: boolean } = {}) => request<{ restarting: boolean }>('POST', '/api/backup/restore', req),
  /** The admin read that the copies are kept on this PC (BackupStatus.localNotice). */
  backupLocalNoticeSeen: () => request<BackupStatus>('POST', '/api/backup/local-notice', {}),
  setBackupPassword: (password: string | null) => request<BackupStatus>('PUT', '/api/backup/password', { password }),
  installmentsSummary: () => request<InstallmentsSummaryView>('GET', '/api/installments/summary'),
  installments: (f: { status?: string; partyId?: string; q?: string } = {}) => request<ContractSummaryView[]>('GET', '/api/installments' + qs(f)),
  installment: (id: string) => request<ContractView>('GET', `/api/installments/${id}`),
  previewInstallments: (terms: InstallmentTerms) => request<{ seq: number; dueDate: string; amount: number }[]>('POST', '/api/installments/preview', terms),
  createInstallment: (input: ContractInput) => request<ContractView>('POST', '/api/installments', input),
  updateInstallment: (id: string, patch: { description?: string; guarantorId?: string | null; notes?: string }) => request<ContractView>('PUT', `/api/installments/${id}`, patch),
  collectInstallment: (id: string, body: { date: string; amount: number; cashAccountCode: string; rateX100?: number; lang: Lang }) =>
    request<ContractView>('POST', `/api/installments/${id}/collect`, body),
  cancelInstallment: (id: string, reason: string) => request<ContractView>('POST', `/api/installments/${id}/cancel`, reason ? { reason } : {}),
  installmentsAging: () => request<AgingView>('GET', '/api/installments/aging'),
  guarantors: () => request<GuarantorView[]>('GET', '/api/guarantors'),
  createGuarantor: (input: GuarantorInput) => request<GuarantorView>('POST', '/api/guarantors', input),
  updateGuarantor: (id: string, input: GuarantorInput) => request<GuarantorView>('PUT', `/api/guarantors/${id}`, input),
  deleteGuarantor: (id: string) => request<void>('DELETE', `/api/guarantors/${id}`),
  database: () => request<DatabaseStatus>('GET', '/api/database'),
  checkDatabase: (input: DatabaseInput) => request<DatabaseCheck>('POST', '/api/database/check', input),
  moveDatabase: (input: DatabaseInput, mode: 'copy' | 'use') => request<{ restarting: boolean }>('POST', '/api/database/move', { ...input, mode }),
  leaveDatabase: () => request<{ restarting: boolean }>('POST', '/api/database/leave', {}),
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
  /** options: the idempotency key (and books) of a receipt the PC may send again from its outbox (1.2) */
  createVoucher: (input: VoucherInput, options: SendOptions = {}) => request<EntryView>('POST', '/api/vouchers', input, options),
  updateVoucher: (id: string, input: VoucherInput) => request<EntryView>('PUT', `/api/vouchers/${id}`, input),
  deleteEntry: (id: string) => request<void>('DELETE', `/api/entries/${id}`),
  entryAction: (id: string, action: 'check' | 'return' | 'approve') => request<EntryView>('POST', `/api/entries/${id}/${action}`, {}),
  reverse: (id: string, date: string) => request<EntryView>('POST', `/api/entries/${id}/reverse`, { date }),
  trialBalance: (from?: string, to?: string) => request<TrialBalanceReport>('GET', '/api/reports/trial-balance' + qs({ from, to })),
  finalAccounts: (from: string, to: string) => request<FinalAccountsReport>('GET', '/api/reports/final-accounts' + qs({ from, to })),
  statement: (account: string, from?: string, to?: string, currency?: CurrencyCode) => request<StatementReport>('GET', '/api/reports/statement' + qs({ account, from, to, currency })),
  periods: () => request<{ period: string; lockedBy: string; lockedAt: string }[]>('GET', '/api/periods'),
  lockPeriod: (period: string) => request<unknown>('POST', `/api/periods/${period}/lock`, {}),
  unlockPeriod: (period: string) => request<unknown>('DELETE', `/api/periods/${period}/lock`),
  audit: (limit = 100) => request<AuditRow[]>('GET', `/api/audit?limit=${limit}`),

  me: () => request<Me>('GET', '/api/auth/me'),
  login: (username: string, password: string) => request<Me>('POST', '/api/auth/login', { username, password }),
  logout: () => request<{ ok: boolean }>('POST', '/api/auth/logout', {}),
  changePassword: (current: string | undefined, password: string) => request<{ ok: boolean }>('POST', '/api/auth/password', { ...(current ? { current } : {}), password }),
  /** Switched on: the admin's recovery code comes with it, this once. */
  setSignIn: (on: boolean) => request<Me & { recoveryCode?: string }>('PUT', '/api/auth/signin', { on }),
  /** A new admin recovery code (the one before stops working); used only in the Windows app's File menu. */
  newRecoveryCode: () => request<{ recoveryCode: string }>('POST', '/api/auth/recovery-code', {}),
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
  /** options: the idempotency key of a quick add that may be sent again after an answer that was lost */
  createParty: (type: PartyType, input: PartyInput, options: SendOptions = {}) => request<PartyView>('POST', '/api/parties', { type, ...input }, options),
  updateParty: (id: string, input: PartyInput) => request<PartyView>('PUT', `/api/parties/${id}`, input),
  deleteParty: (id: string) => request<void>('DELETE', `/api/parties/${id}`),
  partyStatement: (id: string, from?: string, to?: string, currency?: CurrencyCode) => request<PartyStatement>('GET', `/api/parties/${id}/statement` + qs({ from, to, currency })),

  warehouses: () => request<WarehouseView[]>('GET', '/api/warehouses'),
  createWarehouse: (input: { code: string; name: Names }) => request<WarehouseView>('POST', '/api/warehouses', input),
  updateWarehouse: (id: string, input: { name: Names; active?: boolean }) => request<WarehouseView>('PUT', `/api/warehouses/${id}`, input),
  items: (f: { q?: string; warehouseId?: string; active?: string; categoryId?: string; brandId?: string } = {}) => request<ItemView[]>('GET', '/api/items' + qs(f)),
  /** A scanned barcode: the item, and the unit when it is one of the item's units' barcodes (null: its own, the base unit). */
  itemByBarcode: (barcode: string, warehouseId?: string) => request<{ item: ItemView | null; unit: UnitCode | null }>('GET', '/api/items' + qs({ barcode, ...(warehouseId ? { warehouseId } : {}) })),
  item: (id: string) => request<ItemDetail>('GET', `/api/items/${id}`),
  createItem: (input: ItemInput) => request<ItemView>('POST', '/api/items', input),
  updateItem: (id: string, input: ItemInput) => request<ItemView>('PUT', `/api/items/${id}`, input),
  deleteItem: (id: string) => request<void>('DELETE', `/api/items/${id}`),

  invoices: (f: { kind?: InvoiceDocKind; status?: string; partyId?: string; q?: string; from?: string; to?: string } = {}) => request<InvoiceSummary[]>('GET', '/api/invoices' + qs(f)),
  invoice: (id: string) => request<InvoiceView>('GET', `/api/invoices/${id}`),
  createInvoice: (input: InvoiceInput) => request<InvoiceView>('POST', '/api/invoices', input),
  updateInvoice: (id: string, input: InvoiceInput) => request<InvoiceView>('PUT', `/api/invoices/${id}`, input),
  deleteInvoice: (id: string) => request<void>('DELETE', `/api/invoices/${id}`),
  postInvoice: (id: string, opts: { allowExpired?: boolean; loyaltyPoints?: number } = {}) =>
    request<InvoiceView>('POST', `/api/invoices/${id}/post`, { ...(opts.allowExpired ? { allowExpired: true } : {}), ...(opts.loyaltyPoints ? { loyaltyPoints: opts.loyaltyPoints } : {}) }),
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
