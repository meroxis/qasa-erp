import type { Answer, OfficeLink } from './link';
import type { Me } from './roles';

/** The office's answers the app reads (the same shapes as the desktop app's API). */
export type Names = { ar: string; en: string; ku: string };
export type Currency = 'IQD' | 'USD';
export type Money = Record<Currency, number>;

export interface Item {
  id: string; code: string; barcode: string; name: Names; unit: string;
  salePrice: number; saleCurrency: Currency; qtyMilli: number; active?: boolean;
}

export interface ItemDetail extends Item {
  stock: { warehouseId: string; warehouseCode: string; warehouseName: Names; qtyMilli: number }[];
}

export interface PartHit extends Item { wholesalePrice: number | null; shelf: string; brand: string; origin: string }

export interface Settings {
  companyName: Names;
  defaultRateX100: number;
  postingAccounts: { cash: string };
}

export interface Warehouse { id: string; code: string; name: Names; active: boolean }

export interface Party {
  id: string; code: string; name: string; phone: string; type: string; active: boolean;
  /** the receivables account the customer's lines go to */
  accountCode?: string;
  /** what the customer owes, in IQD at the book rates (the office's own total) */
  balance?: number;
  /** the same per currency, each in its own */
  balances?: Money;
  creditLimit?: number | null;
}

export interface StatementLine {
  entryId: string; invoiceId: string | null; number: string; date: string; description: string;
  debit: number; credit: number; balance: number; currency: Currency; amount: number;
}

export interface Statement {
  party: Party; from: string | null; to: string | null; currency: Currency | null;
  opening: number; lines: StatementLine[]; totalDebit: number; totalCredit: number; closing: number;
}

/** The day's figures (GET /api/brief): what the owner's phone shows on its home screen. */
export interface Brief {
  date: string;
  sales: { today: number; invoices: number; sameDayLastWeek: number; month: number };
  cash: { accounts: { code: string; name: Names; balance: Money; base: number }[]; total: Money; base: number };
  flow: { in: number; out: number };
  receivables: number;
  lateCustomers: { partyId: string; code: string; name: string; phone: string; balance: number; oldestDays: number; usd: number }[];
  lowStock: { itemId: string; code: string; name: Names; qtyMilli: number; reorderMilli: number | null }[];
  approvals: { waitingCheck: number; waitingApproval: number };
}

export interface CountSession {
  id: string; warehouseId: string; date: string; status: 'open' | 'done' | 'discarded';
  lines: { itemId: string; countedMilli: number; bookMilli: number }[];
}

/** A refusal from the office (status and its error code), for the screens to explain. */
export class OfficeError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details: unknown) {
    super(code);
  }
}

function ok<T>(answer: Answer<T>): T {
  if (answer.s >= 200 && answer.s < 300) return answer.b;
  const body = answer.b as { error?: string; details?: unknown } | null;
  throw new OfficeError(answer.s, body?.error ?? 'error', body?.details ?? null);
}

const q = (params: Record<string, string>) => '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
/** Ids from the office go into paths only as they are: letters, digits, dashes, underscores. */
const safeId = (id: string) => {
  if (!/^[\w-]{1,64}$/.test(id)) throw new OfficeError(400, 'validation', null);
  return id;
};

export function officeApi(link: OfficeLink) {
  return {
    me: async () => ok(await link.request<Me>('GET', '/api/auth/me')),
    settings: async () => ok(await link.request<Settings>('GET', '/api/settings')),
    brief: async () => ok(await link.request<Brief>('GET', '/api/brief')),
    warehouses: async () => ok(await link.request<Warehouse[]>('GET', '/api/warehouses')),
    items: async (text: string) => ok(await link.request<Item[]>('GET', '/api/items' + q({ q: text, active: 'true' }))),
    item: async (id: string) => ok(await link.request<ItemDetail>('GET', `/api/items/${safeId(id)}`)),
    /** car parts: shelf, brand, wholesale price (absent without the feature: null) */
    part: async (id: string): Promise<PartHit | null> => {
      const a = await link.request<PartHit>('GET', `/api/parts/${safeId(id)}`);
      return a.s === 200 ? a.b : null;
    },
    image: async (id: string): Promise<string | null> => {
      const a = await link.request<{ mime: string; data: string }>('GET', `/api/items/${safeId(id)}/image`);
      return a.s === 200 && /^image\/(jpeg|png|webp)$/.test(a.b.mime) ? `data:${a.b.mime};base64,${a.b.data}` : null;
    },
    setImage: async (id: string, base64: string) => ok(await link.request('PUT', `/api/items/${safeId(id)}/image`, { data: base64 })),
    customers: async (text: string) => ok(await link.request<Party[]>('GET', '/api/parties' + q({ type: 'customer', q: text }))),
    customer: async (id: string) => ok(await link.request<Party>('GET', `/api/parties/${safeId(id)}`)),
    statement: async (id: string, from?: string) => ok(await link.request<Statement>('GET', `/api/parties/${safeId(id)}/statement${from ? q({ from }) : ''}`)),
    createItem: async (input: { name: Names; barcode?: string; unit: string; salePrice: number; saleCurrency: Currency }) =>
      ok(await link.request<Item>('POST', '/api/items', input)),
    openCount: async (warehouseId: string) => ok(await link.request<CountSession | null>('GET', '/api/adjustments/counts/open' + q({ warehouseId: safeId(warehouseId) }))),
    // ——— the changes the outbox sends, each with its own key ———
    draftSale: async (input: unknown, key?: string) => ok(await link.request<{ id: string }>('POST', '/api/invoices', input, key)),
    order: async (input: unknown, key?: string) => ok(await link.request<{ id: string }>('POST', '/api/quotes', input, key)),
    receipt: async (input: unknown, key?: string) => ok(await link.request<{ id: string }>('POST', '/api/vouchers', input, key)),
    sendCount: async (input: unknown, key?: string) => ok(await link.request<{ id: string }>('count', undefined, input, key)),
    countInto: async (countId: string, input: unknown, key?: string) => ok(await link.request<{ id: string }>('PUT', `/api/adjustments/counts/${safeId(countId)}`, input, key))
  };
}

export type OfficeApi = ReturnType<typeof officeApi>;

/** The item a scanned code means: the same barcode or code, else nothing. */
export function exactMatch(items: Item[], code: string): Item | null {
  const c = code.trim().toLowerCase();
  return items.find((i) => i.barcode.toLowerCase() === c) ?? items.find((i) => i.code.toLowerCase() === c) ?? null;
}

/** Today in the phone's own time zone, as the office's dates are written (YYYY-MM-DD). */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
