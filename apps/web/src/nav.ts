import type { BusinessType } from '@qasa/core';
import type { Permission } from './api.ts';
import type { Key } from './i18n.ts';
import { ACTIONS, PRO_ACTIONS, may, mayAny, routeAction, type Action } from './may.ts';

// every action names a permission the server has
void ({ ...ACTIONS, ...PRO_ACTIONS } satisfies Record<Action, { needs: Permission }>);

/**
 * Every page the menu, the home screen's tiles and the search (Ctrl+K) know about, in one place.
 * - `business`: shown only when the company does that (Settings → Business type)
 * - `adminOnly` / `permission`: shown only to someone who may use it (the server refuses the rest anyway)
 * - `companyBooks`: a report of the company's own books (every posted line); not for a user limited to branches
 * - `books`: the journal; with the company's books, not for someone the server refuses them to (a cashier, 1.4)
 * - `ownWith`: a journal page that still opens for such a person who has this permission, with their own records only
 *   (the vouchers a sales person prepared with "Receive payment": the server sends them those and no other)
 * - `ownKey`: what such a page is called for that person ("My vouchers", not "Vouchers & entries")
 * - `work`: what the page is for, as actions the server checks (may.ts). Someone who may read the books still reads the
 *   page without them (an accountant, a stock keeper, a viewer); someone who may not (a cashier) gets the page only
 *   when one of these is theirs to do: its figures are not sent to them and every button on it would be refused
 * - `tile: false`: in the menu but not a tile on the home screen
 * - `till`: the point of sale: shown only when the company uses it (1.5.2, core pos-use.ts: a business that sells at a
 *   counter, or Settings → Sales and point of sale → Use the point of sale) and to a person with the Point of sale role
 *   (`permission: 'pos'`, an admin always); the sales role alone does not show it. A shift's X or Z report (pos-shift)
 *   is not the till's page: whoever the server lets read the shift opens it (the books' people every shift, a cashier
 *   their own, linked from the end-of-day close too)
 */
export interface NavItem {
  key: Key;
  icon: string;
  path?: string;
  match?: string[];
  adminOnly?: boolean;
  companyBooks?: boolean;
  books?: boolean;
  ownWith?: Permission;
  ownKey?: Key;
  work?: readonly Action[];
  permission?: Permission;
  business?: BusinessType;
  tile?: boolean;
  till?: boolean;
}
/** A group of the menu: its heading, the line icon beside the heading, and its pages in order. */
export interface NavGroup { group: Key; icon: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    group: 'gOverview',
    icon: 'layers',
    items: [
      { key: 'home', icon: 'home', path: '', match: ['', 'home'], tile: false },
      { key: 'br_title', icon: 'sun', path: 'brief', match: ['brief'] },
      { key: 'dc_title', icon: 'check', path: 'day-close', match: ['day-close'] }
    ]
  },
  {
    group: 'gSales',
    icon: 'trend',
    items: [
      { key: 'pos_title', icon: 'wallet', path: 'pos', match: ['pos'], permission: 'pos', till: true },
      { key: 'qt_title', icon: 'doc', path: 'quotes', match: ['quotes', 'quote', 'new-quote', 'edit-quote'], work: ['quote'] },
      { key: 'invoices', icon: 'invoice', path: 'sales', match: ['sales', 'new-invoice:sale'], work: ['sale'] },
      { key: 'customers', icon: 'contact', path: 'customers', match: ['customers'], work: ['customer'] },
      { key: 'salesReturns', icon: 'undo', path: 'sales-returns', match: ['sales-returns'], work: ['sale'] },
      { key: 'installments', icon: 'cal', path: 'installments', match: ['installments', 'installment', 'new-installment', 'guarantors', 'installments-aging'] },
      { key: 'pl_title', icon: 'trend', path: 'pipeline', match: ['pipeline'] },
      { key: 'of_title', icon: 'tag', path: 'offers', match: ['offers'] },
      // 2.0, market extras: delivery orders and the WhatsApp reminders of customers who owe
      { key: 'mx_deliveryTitle', icon: 'truck', path: 'delivery', match: ['delivery'] },
      { key: 'mx_rmTitle', icon: 'mail', path: 'debt-reminders', match: ['debt-reminders'] }
    ]
  },
  {
    group: 'gPurchases',
    icon: 'cart',
    items: [
      { key: 'po_title', icon: 'clipboard', path: 'purchase-orders', match: ['purchase-orders', 'purchase-order', 'new-purchase-order', 'edit-purchase-order'], work: ['purchaseOrder'] },
      { key: 'purchaseInvoices', icon: 'cart', path: 'purchases', match: ['purchases', 'new-invoice:purchase'], work: ['purchase'] },
      { key: 'suppliers', icon: 'truck', path: 'suppliers', match: ['suppliers'], work: ['supplier'] },
      { key: 'purchaseReturns', icon: 'undo', path: 'purchase-returns', match: ['purchase-returns'], work: ['purchase'] },
      // goods on consignment (1.7): the shop's costs and what it owes its suppliers, for those who keep the books
      { key: 'cg_title', icon: 'truck', path: 'consignment', match: ['consignment'], books: true },
      // 2.0: bread, milk and eggs that come every day, and what goes back unsold
      { key: 'mx_dsTitle', icon: 'cal', path: 'daily-suppliers', match: ['daily-suppliers'] }
    ]
  },
  {
    group: 'gStock',
    icon: 'box',
    items: [
      { key: 'items', icon: 'box', path: 'items', match: ['items', 'item'] },
      { key: 'stockDocs', icon: 'swap', path: 'stock-docs', match: ['stock-docs', 'stock-doc', 'new-stock-doc', 'edit-stock-doc'], work: ['stockDoc'] },
      { key: 'lb_title', icon: 'tag', path: 'labels', match: ['labels'] },
      { key: 'ex_title', icon: 'clock', path: 'expiry', match: ['expiry'] },
      // 2.0: the price checker screens near the shelves (the admin adds and revokes them)
      { key: 'mx_pcTitle', icon: 'scale', path: 'price-checkers', match: ['price-checkers'], adminOnly: true },
      { key: 'adj_title', icon: 'tag', path: 'stock-adjustments', match: ['stock-adjustments', 'stock-adjustment', 'new-stock-adjustment', 'edit-stock-adjustment', 'stock-count'], work: ['adjustment'] }
    ]
  },
  {
    // the industry features (Pro and Business), only those the company does
    group: 'gIndustry',
    icon: 'tool',
    items: [
      { key: 're_title', icon: 'building', path: 'real-estate', match: ['real-estate', 'real-estate-project'], business: 'realEstate' },
      { key: 'mob_nav', icon: 'phone', path: 'mobile', match: ['mobile', 'repair'], business: 'mobileShop' },
      { key: 'pt_title', icon: 'gear', path: 'car-parts', match: ['car-parts'], business: 'autoParts' },
      { key: 'ew_jobs', icon: 'tool', path: 'works', match: ['works', 'job'], business: 'engineeringWorks' },
      { key: 'sl_title', icon: 'sun', path: 'solar', match: ['solar', 'solar-system'], business: 'electricalSolar' },
      { key: 'gen_title', icon: 'zap', path: 'generators', match: ['generators', 'gen-run'], business: 'generators' },
      { key: 'phm_title', icon: 'pill', path: 'pharmacy', match: ['pharmacy'], business: 'pharmacy' },
      { key: 'ps_title', icon: 'fuel', path: 'petrol', match: ['petrol', 'fuel-shift'], business: 'petrolStation' },
      { key: 'gd_title', icon: 'gem', path: 'gold', match: ['gold', 'gold-slip'], business: 'goldShop' },
      { key: 'ws_title', icon: 'truck', path: 'wholesale', match: ['wholesale'], business: 'wholesale' },
      { key: 'cw_title', icon: 'shirt', path: 'clothing', match: ['clothing', 'clothing-model'], business: 'clothingShop' }
    ]
  },
  {
    group: 'gAccounting',
    icon: 'book',
    items: [
      { key: 'vouchers', icon: 'receipt', path: 'entries', match: ['entries', 'entry', 'new', 'edit'], books: true, ownWith: 'sales', ownKey: 's14_myVouchers' },
      { key: 'bk_title', icon: 'bank', path: 'banking', match: ['banking', 'cheque', 'bank-statement'], work: ['banking', 'moneyAccount'] },
      { key: 'fa_title', icon: 'layers', path: 'fixed-assets', match: ['fixed-assets', 'fixed-asset'], adminOnly: true },
      // the expenses are payment vouchers, whoever prepared them: with the books
      { key: 'br_expenses', icon: 'wallet', path: 'expenses', match: ['expenses'], books: true },
      { key: 'fx_title', icon: 'dollar', path: 'rates', match: ['rates'] },
      { key: 'accounts', icon: 'tree', path: 'accounts', match: ['accounts'], work: ['account', 'voucher'] },
      { key: 'statement', icon: 'doc', path: 'statement', match: ['statement'], tile: false, companyBooks: true }
    ]
  },
  { group: 'gPeople', icon: 'users', items: [{ key: 'pay_title', icon: 'users', path: 'payroll', match: ['payroll', 'payroll-run'], adminOnly: true }] },
  {
    group: 'gReports',
    icon: 'chart',
    items: [
      { key: 'br_reports', icon: 'chart', path: 'reports-more/sales-items', match: ['reports-more'] },
      { key: 'trialBalance', icon: 'scale', path: 'trial-balance', match: ['trial-balance'], companyBooks: true },
      { key: 'finalAccounts', icon: 'book', path: 'final-accounts', match: ['final-accounts'], companyBooks: true }
    ]
  },
  {
    group: 'gSystem',
    icon: 'gear',
    items: [
      // everyone: Language and display is each person's own; the company sections show to admins only
      { key: 'settings', icon: 'sliders', path: 'settings', match: ['settings'] },
      { key: 'bizType', icon: 'building', path: 'business-type', match: ['business-type'], adminOnly: true },
      { key: 'pd_title', icon: 'printer', path: 'print-design', match: ['print-design'], adminOnly: true },
      { key: 'co_title', icon: 'building', path: 'companies', match: ['companies'], adminOnly: true, tile: false },
      { key: 'md_title', icon: 'download', path: 'import', match: ['import'], adminOnly: true },
      { key: 'wa_nav', icon: 'globe', path: 'website-api', match: ['website-api'], adminOnly: true },
      { key: 'bn_title', icon: 'branch', path: 'branches', match: ['branches'], adminOnly: true },
      { key: 'users', icon: 'users', path: 'users', match: ['users'], adminOnly: true },
      { key: 'planLicense', icon: 'star', path: 'plans', match: ['plans'], adminOnly: true }
    ]
  }
];

/**
 * Who is looking: decides which pages they see. `branchLimited`: limited to some branches; `noBooks`: someone who may
 * not read the books at all, a cashier (1.4). The server says both. `pos`: whether the company uses the point of sale
 * (core posShown); left out, it does (as before 1.5.2).
 */
export interface NavViewer { admin: boolean; permissions: readonly Permission[]; businessTypes: readonly BusinessType[]; branchLimited?: boolean; noBooks?: boolean; pos?: boolean }

/** Whether this person may read the company's own books (the trial balance, final accounts, account statements). */
export const seesCompanyBooks = (v: Pick<NavViewer, 'admin' | 'branchLimited' | 'noBooks'>): boolean => v.admin || (!v.branchLimited && !v.noBooks);

export function canSee(item: NavItem, v: NavViewer): boolean {
  if (item.adminOnly && !v.admin) return false;
  if (item.companyBooks && !seesCompanyBooks(v)) return false;
  if (item.books && v.noBooks && !v.admin && !(item.ownWith && v.permissions.includes(item.ownWith))) return false;
  if (item.permission && !v.admin && !v.permissions.includes(item.permission)) return false;
  if (item.work && v.noBooks && !v.admin && !mayAny(v.permissions, item.work)) return false;
  if (item.business && !v.businessTypes.includes(item.business)) return false;
  if (item.till && v.pos === false) return false;
  return true;
}

/** What the page is called for this person: a cashier's vouchers are "My vouchers", the only ones they are sent. */
export const navLabel = (item: NavItem, v: Pick<NavViewer, 'admin' | 'noBooks'>): Key => (item.ownKey && item.books && v.noBooks && !v.admin ? item.ownKey : item.key);

export const visibleItems = (items: readonly NavItem[], v: NavViewer): NavItem[] => items.filter((item) => canSee(item, v));

/**
 * The routes of the admin-only menu items: App.tsx opens them for admins only (anyone else lands on Home), so a
 * typed or bookmarked link never shows a page whose every action the server would refuse.
 */
export const ADMIN_PAGES: ReadonlySet<string> = new Set(
  NAV.flatMap((g) => g.items).filter((i) => i.adminOnly).flatMap((i) => i.match ?? (i.path !== undefined ? [i.path] : []))
);

/**
 * The routes of the company-books pages: App.tsx opens them only for someone who may read the books (anyone limited to
 * branches lands on Home), so a typed, bookmarked or favourite link never shows a page the server refuses.
 */
export const COMPANY_BOOK_PAGES: ReadonlySet<string> = new Set(
  NAV.flatMap((g) => g.items).filter((i) => i.companyBooks).flatMap((i) => i.match ?? (i.path !== undefined ? [i.path] : []))
);

/**
 * The routes not opened for someone who may not read the books (a cashier, 1.4), whatever else they may do: the voucher
 * editor (theirs come from "Receive payment"), the expenses, a bank statement to reconcile and (1.4.1) a cheque. A
 * typed, bookmarked or favourite link lands on the home page, as the server would refuse the page's data.
 */
export const NO_BOOKS_PAGES: ReadonlySet<string> = new Set(['new', 'edit', 'expenses', 'bank-statement', 'cheque']);

/**
 * Whether an address opens for this person; otherwise App.tsx shows the home page, as it does for the admin pages and
 * the books. Closed: a page of the menu this person is not shown (and every address under it: `match`), and a form
 * that is only one action (a new purchase invoice, a new voucher) when that action is not theirs.
 */
export function pageOpen(page: string, arg: string | undefined, v: NavViewer): boolean {
  if (v.admin) return true;
  const action = routeAction(page, arg);
  if (action && !may(v.permissions, action)) return false;
  const owners = NAV.flatMap((g) => g.items).filter((i) => (i.match ?? []).some((m) => m === page || m === `${page}:${arg ?? ''}`));
  // (a business the company does not do is a matter of Settings → Business type, not of who is signed in, and a till the
  // company does not use of Settings → Sales and point of sale: App.tsx says so on the page)
  return owners.length === 0 || owners.some((i) => canSee(i, { ...v, pos: true, ...(i.business ? { businessTypes: [i.business] } : {}) }));
}

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

/**
 * The pages pinned before a person pins any: the till, the sales invoices and the brief; without the till where the
 * company does not use it (1.5.2), the customers in its place.
 */
export const defaultFavourites = (pos = true): string[] => (pos ? ['pos_title', 'invoices', 'br_title'] : ['invoices', 'customers', 'br_title']);

/** The pages a person pinned (★), by page key. */
export function favourites(user: string, pos = true): string[] {
  try {
    const v = JSON.parse(read(`qasa.fav.${user || 'owner'}`) ?? 'null') as unknown;
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  } catch { /* fall through */ }
  return defaultFavourites(pos);
}

export function toggleFavourite(user: string, key: string, pos = true): void {
  const list = favourites(user, pos);
  const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  write(`qasa.fav.${user || 'owner'}`, JSON.stringify(next));
  window.dispatchEvent(new Event(FAVOURITES_EVENT));
}

export const navCollapsed = (): boolean => read('qasa.nav.collapsed') === '1';
export const setNavCollapsed = (v: boolean) => write('qasa.nav.collapsed', v ? '1' : '0');

/** The group that is open the first time on a page in no group: the one most people work in. */
export const FIRST_OPEN_GROUP: Key = 'gSales';

const openKey = (user: string) => `qasa.nav.open.${user || 'owner'}`;
const isGroup = (g: unknown): g is string => typeof g === 'string' && NAV.some((n) => n.group === g);

/** The groups a person left open in the menu, by group key; null when nothing was remembered yet on this PC. */
export function openGroups(user: string): string[] | null {
  try {
    const v = JSON.parse(read(openKey(user)) ?? 'null') as unknown;
    if (Array.isArray(v)) return [...new Set(v.filter(isGroup))];
  } catch { /* fall through */ }
  return null;
}

export function setOpenGroups(user: string, groups: readonly string[]): void {
  write(openKey(user), JSON.stringify([...new Set(groups.filter(isGroup))]));
}

/**
 * The group to show open: one at a time, so the menu stays short. A page opens its own group and the others close.
 * On a page in no group: the one the person left open (of the several 1.5.0 could keep open, the last), none when they
 * closed it, and Sales the first time.
 */
export function openGroupsWith(remembered: readonly string[] | null, current: string | null): string[] {
  if (current) return [current];
  return remembered ? remembered.slice(-1) : [FIRST_OPEN_GROUP];
}

/** Opening a group closes the others; closing the open one leaves none open. */
export function toggledGroup(open: readonly string[], group: string): string[] {
  return open.includes(group) ? open.filter((g) => g !== group) : [group];
}

/** How long a group opened by a click glows (App.tsx; styles.css: .just-opened, as long). */
export const GROUP_GLOW_MS = 1800;

/**
 * Where the menu's list scrolls to so a group just opened shows: just enough to show its heading and its pages, and
 * its heading at the top when the group is taller than the list. In px down the list: `view` is the part shown (from
 * `top`, `height` high, of `length` in all), `group` where the group lies, `pad` the room kept at both ends (the
 * list's scroll-padding). Null when the group shows already or the list cannot move.
 */
export function revealTop(view: { top: number; height: number; length: number }, group: { top: number; height: number }, pad = 0): number | null {
  const end = group.top + group.height;
  let to: number;
  if (group.height + 2 * pad > view.height || group.top - pad < view.top) to = group.top - pad;
  else if (end + pad > view.top + view.height) to = end + pad - view.height;
  else return null;
  to = Math.round(Math.min(Math.max(to, 0), Math.max(view.length - view.height, 0)));
  return Math.abs(to - view.top) < 1 ? null : to;
}

/**
 * In the menu only the first click of a double click counts (App.tsx: the list's clicks). A group the first click opens
 * closes the one above it and slides into view, so the second click would land on whatever row moved under the pointer
 * and open that page (or another group). Enter and Space click with no count, so the keyboard is never held back.
 */
export function firstClickOnly(e: { detail: number; preventDefault(): void; stopPropagation(): void }): void {
  if (e.detail > 1) {
    e.preventDefault();
    e.stopPropagation();
  }
}

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
/**
 * The recent list as the search offers it to this person: a page they no longer see (the till where the company does
 * not use it, 1.5.2, or a page whose permission was taken away) is left out; records stay (their pages check access).
 */
export function recentsFor(list: readonly Recent[], v: NavViewer): Recent[] {
  const paths = new Set(allPages(v).map((p) => p.path));
  return list.filter((r) => r.kind !== 'page' || paths.has(r.path));
}
export function addRecent(r: Recent): void {
  write('qasa.recent', JSON.stringify([r, ...recents().filter((x) => x.path !== r.path)].slice(0, 8)));
}
