import type { BusinessType } from '@qasa/core';
import type { Permission } from './api.ts';
import type { Key } from './i18n.ts';

/**
 * Every page the menu, the home screen's tiles and the search (Ctrl+K) know about, in one place.
 * - `business`: shown only when the company does that (Settings → Business type)
 * - `adminOnly` / `permission`: shown only to someone who may use it (the server refuses the rest anyway)
 * - `tile: false`: in the menu but not a tile on the home screen
 */
export interface NavItem {
  key: Key;
  icon: string;
  path?: string;
  match?: string[];
  adminOnly?: boolean;
  permission?: Permission;
  business?: BusinessType;
  tile?: boolean;
}
export interface NavGroup { group: Key; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    group: 'gOverview',
    items: [
      { key: 'home', icon: 'home', path: '', match: ['', 'home'], tile: false },
      { key: 'br_title', icon: 'sun', path: 'brief', match: ['brief'] }
    ]
  },
  {
    group: 'gSales',
    items: [
      { key: 'pos_title', icon: 'wallet', path: 'pos', match: ['pos', 'pos-shift'], permission: 'sales' },
      { key: 'qt_title', icon: 'doc', path: 'quotes', match: ['quotes', 'quote', 'new-quote', 'edit-quote'] },
      { key: 'invoices', icon: 'invoice', path: 'sales', match: ['sales', 'new-invoice:sale'] },
      { key: 'customers', icon: 'contact', path: 'customers', match: ['customers'] },
      { key: 'salesReturns', icon: 'undo', path: 'sales-returns', match: ['sales-returns'] },
      { key: 'installments', icon: 'cal', path: 'installments', match: ['installments', 'installment', 'new-installment', 'guarantors', 'installments-aging'] },
      { key: 'pl_title', icon: 'trend', path: 'pipeline', match: ['pipeline'] }
    ]
  },
  {
    group: 'gPurchases',
    items: [
      { key: 'po_title', icon: 'clipboard', path: 'purchase-orders', match: ['purchase-orders', 'purchase-order', 'new-purchase-order', 'edit-purchase-order'] },
      { key: 'purchaseInvoices', icon: 'cart', path: 'purchases', match: ['purchases', 'new-invoice:purchase'] },
      { key: 'suppliers', icon: 'truck', path: 'suppliers', match: ['suppliers'] },
      { key: 'purchaseReturns', icon: 'undo', path: 'purchase-returns', match: ['purchase-returns'] }
    ]
  },
  {
    group: 'gStock',
    items: [
      { key: 'items', icon: 'box', path: 'items', match: ['items', 'item'] },
      { key: 'stockDocs', icon: 'swap', path: 'stock-docs', match: ['stock-docs', 'stock-doc', 'new-stock-doc', 'edit-stock-doc'] },
      { key: 'adj_title', icon: 'tag', path: 'stock-adjustments', match: ['stock-adjustments', 'stock-adjustment', 'new-stock-adjustment', 'edit-stock-adjustment', 'stock-count'] }
    ]
  },
  {
    // the industry features (Pro and Business), only those the company does
    group: 'gIndustry',
    items: [
      { key: 're_title', icon: 'building', path: 'real-estate', match: ['real-estate', 'real-estate-project'], business: 'realEstate' },
      { key: 'mob_nav', icon: 'phone', path: 'mobile', match: ['mobile', 'repair'], business: 'mobileShop' },
      { key: 'pt_title', icon: 'gear', path: 'car-parts', match: ['car-parts'], business: 'autoParts' },
      { key: 'ew_jobs', icon: 'tool', path: 'works', match: ['works', 'job'], business: 'engineeringWorks' },
      { key: 'sl_title', icon: 'sun', path: 'solar', match: ['solar', 'solar-system'], business: 'electricalSolar' },
      { key: 'gen_title', icon: 'zap', path: 'generators', match: ['generators', 'gen-run'], business: 'generators' }
    ]
  },
  {
    group: 'gAccounting',
    items: [
      { key: 'vouchers', icon: 'receipt', path: 'entries', match: ['entries', 'entry', 'new', 'edit'] },
      { key: 'bk_title', icon: 'bank', path: 'banking', match: ['banking', 'cheque', 'bank-statement'] },
      { key: 'fa_title', icon: 'layers', path: 'fixed-assets', match: ['fixed-assets', 'fixed-asset'], adminOnly: true },
      { key: 'br_expenses', icon: 'wallet', path: 'expenses', match: ['expenses'] },
      { key: 'fx_title', icon: 'dollar', path: 'rates', match: ['rates'] },
      { key: 'accounts', icon: 'tree', path: 'accounts', match: ['accounts'] },
      { key: 'statement', icon: 'doc', path: 'statement', match: ['statement'], tile: false }
    ]
  },
  { group: 'gPeople', items: [{ key: 'pay_title', icon: 'users', path: 'payroll', match: ['payroll', 'payroll-run'], adminOnly: true }] },
  {
    group: 'gReports',
    items: [
      { key: 'br_reports', icon: 'chart', path: 'reports-more/sales-items', match: ['reports-more'] },
      { key: 'trialBalance', icon: 'scale', path: 'trial-balance', match: ['trial-balance'] },
      { key: 'finalAccounts', icon: 'book', path: 'final-accounts', match: ['final-accounts'] }
    ]
  },
  {
    group: 'gSystem',
    items: [
      // everyone: Language and display is each person's own; the company sections show to admins only
      { key: 'settings', icon: 'sliders', path: 'settings', match: ['settings'] },
      { key: 'bizType', icon: 'building', path: 'business-type', match: ['business-type'], adminOnly: true },
      { key: 'co_title', icon: 'building', path: 'companies', match: ['companies'], adminOnly: true, tile: false },
      { key: 'md_title', icon: 'download', path: 'import', match: ['import'], adminOnly: true },
      { key: 'wa_nav', icon: 'globe', path: 'website-api', match: ['website-api'], adminOnly: true },
      { key: 'bn_title', icon: 'branch', path: 'branches', match: ['branches'], adminOnly: true },
      { key: 'users', icon: 'users', path: 'users', match: ['users'], adminOnly: true },
      { key: 'planLicense', icon: 'star', path: 'plans', match: ['plans'], adminOnly: true }
    ]
  }
];

/** Who is looking: decides which pages they see. */
export interface NavViewer { admin: boolean; permissions: readonly Permission[]; businessTypes: readonly BusinessType[] }

export function canSee(item: NavItem, v: NavViewer): boolean {
  if (item.adminOnly && !v.admin) return false;
  if (item.permission && !v.admin && !v.permissions.includes(item.permission)) return false;
  if (item.business && !v.businessTypes.includes(item.business)) return false;
  return true;
}

export const visibleItems = (items: readonly NavItem[], v: NavViewer): NavItem[] => items.filter((item) => canSee(item, v));

/** Every page that has a path, once (for favourites and the search). */
export function allPages(v: NavViewer): (NavItem & { group: Key })[] {
  return NAV.flatMap((g) => visibleItems(g.items, v).filter((i) => i.path !== undefined).map((i) => ({ ...i, group: g.group })));
}

export function findPage(key: string): NavItem | undefined {
  for (const g of NAV) for (const i of g.items) if (i.key === key) return i;
  return undefined;
}

// ——— per-person menu choices, kept on this PC ———

const read = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* not available */ }
};

export const FAVOURITES_EVENT = 'qasa-favourites';

/** The pages a person pinned (★), by page key. */
export function favourites(user: string): string[] {
  try {
    const v = JSON.parse(read(`qasa.fav.${user || 'owner'}`) ?? 'null') as unknown;
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  } catch { /* fall through */ }
  return ['pos_title', 'invoices', 'br_title'];
}

export function toggleFavourite(user: string, key: string): void {
  const list = favourites(user);
  const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  write(`qasa.fav.${user || 'owner'}`, JSON.stringify(next));
  window.dispatchEvent(new Event(FAVOURITES_EVENT));
}

export const navCollapsed = (): boolean => read('qasa.nav.collapsed') === '1';
export const setNavCollapsed = (v: boolean) => write('qasa.nav.collapsed', v ? '1' : '0');

/** Pages and records opened from the search, newest first. */
export interface Recent { kind: 'page' | 'party' | 'item' | 'invoice' | 'entry'; label: string; sub?: string; path: string; icon: string }
export function recents(): Recent[] {
  try {
    const v = JSON.parse(read('qasa.recent') ?? '[]') as unknown;
    return Array.isArray(v) ? (v as Recent[]).slice(0, 8) : [];
  } catch {
    return [];
  }
}
export function addRecent(r: Recent): void {
  write('qasa.recent', JSON.stringify([r, ...recents().filter((x) => x.path !== r.path)].slice(0, 8)));
}
