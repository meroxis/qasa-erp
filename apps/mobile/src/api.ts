import { OfficeError, ok, q, safeId } from './answers';
import { NOTHING_FOUND, readLookup, type ItemLookup } from './item-lookup';
import type { OfficeLink } from './link';
import { ownerApi } from './owner/api';
import type { Me } from './roles';
import { staffApi } from './staff/api';
import { waiterApi } from './staff/waiter';

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
  /** left out by the office for whoever may not read the books (cost-view.ts, 1.4), as are flow, cost and profit */
  cash?: { accounts: { code: string; name: Names; balance: Money; base: number }[]; total: Money; base: number };
  flow?: { in: number; out: number };
  receivables: number;
  lateCustomers: { partyId: string; code: string; name: string; phone: string; balance: number; oldestDays: number; usd: number }[];
  /** an office of phone app 1.1 on: the five customers who owe the most, with what they owe in each currency */
  topDebtors?: { partyId: string; code: string; name: string; phone: string; balance: number; oldestDays: number; usd: number; owed?: Money }[];
  /** what customers owe in each currency's own money (an office of 1.4 on) */
  receivablesOwed?: Money;
  lowStock: { itemId: string; code: string; name: Names; qtyMilli: number; reorderMilli: number | null }[];
  approvals: { waitingCheck: number; waitingApproval: number };
}

export interface CountSession {
  id: string; warehouseId: string; date: string; status: 'open' | 'done' | 'discarded';
  lines: { itemId: string; countedMilli: number; bookMilli: number }[];
}

// (a refusal, reading an answer, ids in paths: answers.ts, shared with the calls of phone app 1.1)
export { OfficeError, ok, q, safeId };

/**
 * The office's API as the phone calls it: phone app 1.0's calls, then 1.1's for the owner and the managers
 * (owner/api.ts) and for the staff (staff/api.ts). No call is in two of them (logic.test.ts).
 */
export function officeApi(link: OfficeLink) {
  return { ...coreApi(link), ...ownerApi(link), ...staffApi(link), ...waiterApi(link) };
}

export function coreApi(link: OfficeLink) {
  return {
    me: async () => ok(await link.request<Me>('GET', '/api/auth/me')),
    settings: async () => ok(await link.request<Settings>('GET', '/api/settings')),
    brief: async () => ok(await link.request<Brief>('GET', '/api/brief')),
    warehouses: async () => ok(await link.request<Warehouse[]>('GET', '/api/warehouses')),
    /** `limit`: the first so many by code (an office from before 2.0 sends them all; the link carries a megabyte at most) */
    items: async (text: string, limit?: number) => ok(await link.request<Item[]>('GET', '/api/items' + q({ q: text, active: 'true', ...(limit ? { limit: String(limit) } : {}) }))),
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
    /** `lookupBarcode` (phone app 1.2): the picture is the one the office's lookup of that barcode found; the office credits its source */
    setImage: async (id: string, base64: string, lookupBarcode?: string) =>
      ok(await link.request('PUT', `/api/items/${safeId(id)}/image`, { data: base64, ...(lookupBarcode ? { lookupBarcode } : {}) })),
    /**
     * Phone app 1.2: a new item's names and picture by its barcode, as the office found them (only where the office
     * offers 'itemLookup'). Never an error for the person: no answer, a refusal, the setting off are "nothing found".
     */
    lookupItem: async (barcode: string): Promise<ItemLookup> => {
      try {
        const a = await link.request<unknown>('POST', '/api/items/lookup', { barcode });
        return a.s === 200 ? readLookup(a.b) : NOTHING_FOUND;
      } catch {
        return NOTHING_FOUND;
      }
    },
    customers: async (text: string, limit?: number) => ok(await link.request<Party[]>('GET', '/api/parties' + q({ type: 'customer', q: text, ...(limit ? { limit: String(limit) } : {}) }))),
    customer: async (id: string) => ok(await link.request<Party>('GET', `/api/parties/${safeId(id)}`)),
    statement: async (id: string, from?: string) => ok(await link.request<Statement>('GET', `/api/parties/${safeId(id)}/statement${from ? q({ from }) : ''}`)),
    createItem: async (input: { name: Names; barcode?: string; unit: string; salePrice: number; saleCurrency: Currency }) =>
      ok(await link.request<Item>('POST', '/api/items', input)),
    openCount: async (warehouseId: string) => ok(await link.request<CountSession | null>('GET', '/api/adjustments/counts/open' + q({ warehouseId: safeId(warehouseId) }))),
    // ——— the changes the outbox sends, each with its own key ———
    draftSale: async (input: unknown, key?: string) => ok(await link.request<{ id: string }>('POST', '/api/invoices', input, key)),
    order: async (input: unknown, key?: string) => ok(await link.request<{ id: string }>('POST', '/api/quotes', input, key)),
    // the office decides whether it is in the books at once or waits for approval: the answer's status says which
    receipt: async (input: unknown, key?: string) => ok(await link.request<{ id: string; status?: string }>('POST', '/api/vouchers', input, key)),
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
