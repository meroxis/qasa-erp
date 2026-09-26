import type { CurrencyCode, EntryAction, EntryStatus, EntryType, Names, Nature } from '@qasa/core';

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
}

export interface Settings {
  companyName: Names;
  defaultRateX100: number;
  fiscalYearStart: string;
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
  lines: { accountCode: string; debit: number; credit: number; description?: string }[];
}

export interface VoucherInput {
  kind: 'receipt' | 'payment';
  date: string;
  cashAccountCode: string;
  party?: string;
  description: string;
  currency: CurrencyCode;
  rateX100: number;
  items: { accountCode: string; amount: number; description?: string }[];
}

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
  audit: (limit = 100) => request<AuditRow[]>('GET', `/api/audit?limit=${limit}`)
};
