import type { Answer, OfficeLink } from './link';

/** The office's answers the app reads (the same shapes as the desktop app's API). */
export type Names = { ar: string; en: string; ku: string };
export type Currency = 'IQD' | 'USD';

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
export interface Party { id: string; code: string; name: string; phone: string; type: string; active: boolean }

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

export function officeApi(link: OfficeLink) {
  return {
    settings: async () => ok(await link.request<Settings>('GET', '/api/settings')),
    warehouses: async () => ok(await link.request<Warehouse[]>('GET', '/api/warehouses')),
    items: async (text: string) => ok(await link.request<Item[]>('GET', '/api/items' + q({ q: text, active: 'true' }))),
    item: async (id: string) => ok(await link.request<ItemDetail>('GET', `/api/items/${id}`)),
    /** car parts: shelf, brand, wholesale price (absent without the feature: null) */
    part: async (id: string): Promise<PartHit | null> => {
      const a = await link.request<PartHit>('GET', `/api/parts/${id}`);
      return a.s === 200 ? a.b : null;
    },
    image: async (id: string): Promise<string | null> => {
      const a = await link.request<{ mime: string; data: string }>('GET', `/api/items/${id}/image`);
      return a.s === 200 ? `data:${a.b.mime};base64,${a.b.data}` : null;
    },
    setImage: async (id: string, base64: string) => ok(await link.request('PUT', `/api/items/${id}/image`, { data: base64 })),
    customers: async (text: string) => ok(await link.request<Party[]>('GET', '/api/parties' + q({ type: 'customer', q: text }))),
    createItem: async (input: { name: Names; barcode?: string; unit: string; salePrice: number; saleCurrency: Currency }) =>
      ok(await link.request<Item>('POST', '/api/items', input)),
    draftSale: async (input: unknown) => ok(await link.request<{ id: string }>('POST', '/api/invoices', input)),
    sendCount: async (input: unknown) => ok(await link.request<{ id: string }>('count', undefined, input))
  };
}

export type OfficeApi = ReturnType<typeof officeApi>;

/** The item a scanned code means: the same barcode or code, else nothing. */
export function exactMatch(items: Item[], code: string): Item | null {
  const c = code.trim().toLowerCase();
  return items.find((i) => i.barcode.toLowerCase() === c) ?? items.find((i) => i.code.toLowerCase() === c) ?? null;
}
