import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { formatQty, htmlLang, normalizeForSearch, parseAmount, parseQty, formatAmount, stripBidiIsolates, type CurrencyCode, type EntryStatus, type EntryType, type InvoiceStatus, type Lang } from '@qasa/core';
import { ApiError, onBusyChange, type AccountView, type Permission, type PlanStatus, type Settings } from './api.ts';
import { isKey, useI18n, type I18n, type Key } from './i18n.ts';

/* ---------- shared data ---------- */

export interface AppData {
  accounts: AccountView[];
  settings: Settings | null;
  /** null until loaded; treat as Free */
  plan: PlanStatus | null;
  online: boolean;
  /** false for someone limited to branches: no links to the trial balance, final accounts or account statements */
  companyBooks?: boolean;
  /**
   * 1.4: false for someone the server sends no cost to (purchase prices, average cost, stock value, a sale's cost), and
   * for someone it sends neither the books nor profit to (a cashier): those columns and tiles are not shown
   */
  seesCost?: boolean;
  seesBooks?: boolean;
  /** what the person signed in may change (the server refuses the rest anyway): buttons they can't use stay hidden */
  permissions?: readonly Permission[];
  /** who is signed in, for what the app remembers per person on this PC (their usual way of saving an invoice) */
  userKey?: string;
  reloadAccounts(): Promise<void>;
  reloadSettings(): Promise<void>;
  reloadPlan(): Promise<void>;
}

export const DataContext = createContext<AppData | null>(null);

/** How the app looks on this PC (Settings → Language and display), next to the language in I18n. */
export type Theme = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';
export interface Display { theme: Theme; density: Density; setTheme(theme: Theme): void; setDensity(density: Density): void }
export const DisplayContext = createContext<Display>({ theme: 'system', density: 'comfortable', setTheme: () => {}, setDensity: () => {} });
export const useDisplay = () => useContext(DisplayContext);
export const isTheme = (v: string): v is Theme => v === 'light' || v === 'dark' || v === 'system';
export const isDensity = (v: string): v is Density => v === 'comfortable' || v === 'compact';

/** A detail page says which list it belongs to (a purchase invoice is under Purchases), for the title band and the pane. */
export interface PageNav { key: Key; group: Key; title?: Key }
export const PageNavContext = createContext<(nav: PageNav | null) => void>(() => {});
export function usePageNav(nav: PageNav | null): void {
  const set = useContext(PageNavContext);
  const key = nav ? `${nav.group}/${nav.key}/${nav.title ?? ''}` : '';
  useEffect(() => { set(nav); }, [set, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useData(): AppData {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('DataContext missing');
  return ctx;
}

/** Loads data for a page and re-runs when `deps` change. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: unknown; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error: unknown) => alive && setState({ data: null, error, loading: false })
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

/* ---------- toast ---------- */

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    window.clearTimeout(timer.current);
    setMessage(m);
    timer.current = window.setTimeout(() => setMessage(''), 2800);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && <div className="toast" role="status">{message}</div>}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ---------- errors ---------- */

interface Detail { code?: string; line?: number; accountCode?: string; period?: string; available?: number; field?: string }

export function errorMessages(error: unknown, i18n: I18n): string[] {
  const { t } = i18n;
  if (error instanceof ApiError) {
    if (error.code === 'validation' && Array.isArray(error.details)) {
      const messages = (error.details as Detail[]).map((d) => {
        // a message for the field when there is one ("err_account_invalid_gain"), else the code's own
        const byField = d.field ? `err_${d.code ?? 'internal'}_${d.field}` : '';
        const key = byField && isKey(byField) ? byField : 'err_' + (d.code ?? 'internal');
        return isKey(key) ? t(key, { n: d.line ?? '', c: d.accountCode ?? '', p: d.period ?? '', a: d.available === undefined ? '' : formatQty(d.available) }) : t('err_internal');
      });
      return [...new Set(messages)];
    }
    // plan limits have a message per limit ("err_plan_limit_warehouses"), with a general one to fall back on
    const limit = error.code === 'plan_limit' ? (error.details as { limit?: string } | null)?.limit : undefined;
    const key = limit && isKey(`err_plan_limit_${limit}`) ? `err_plan_limit_${limit}` : 'err_' + error.code;
    // a sign-in refused for the plan's number of users says how many the plan allows
    const max = error.code === 'plan_user_limit' ? (error.details as { max?: unknown } | null)?.max : undefined;
    const message = isKey(key) ? (typeof max === 'number' ? t(key, { n: i18n.int(max) }) : t(key)) : t('err_internal');
    // a refusal that names the open documents holding it back (a unit or a base unit in use) lists them, so they can be found
    const drafts = (error.details as { drafts?: unknown } | null)?.drafts;
    if (Array.isArray(drafts) && drafts.length) {
      const named = (drafts as { type?: unknown; number?: unknown; date?: unknown }[]).map((d) => {
        const kind = `odoc_${String(d.type)}`;
        const label = typeof d.number === 'string' && d.number ? d.number : typeof d.date === 'string' ? i18n.date(d.date) : '';
        return [isKey(kind) ? t(kind) : '', label].filter(Boolean).join(' ');
      });
      return [message, t('err_open_docs', { d: named.join(i18n.lang === 'en' ? ', ' : '، ') })];
    }
    return [message];
  }
  return [t('err_internal')];
}

/** Each language by its own name, so anyone finds theirs whatever the screen is in now. */
export const LANGUAGE_NAMES: readonly [Lang, string][] = [['ar', 'عربي'], ['en', 'English'], ['ku', 'کوردی']];

/**
 * The language buttons (عربي / English / کوردی). They change the language the same way Settings does: the whole app
 * at once, remembered on this PC, and in the Windows app its menus too (setLang tells qasaDesktop).
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t, lang, setLang } = useI18n();
  return (
    <div className={'track' + (className ? ' ' + className : '')} role="group" aria-label={t('language')}>
      {LANGUAGE_NAMES.map(([l, label]) => (
        <button key={l} type="button" lang={htmlLang(l)} aria-pressed={lang === l} onClick={() => setLang(l)}>{label}</button>
      ))}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const i18n = useI18n();
  if (!error) return null;
  const messages = errorMessages(error, i18n);
  return (
    <div className="alert bad" role="alert">
      {messages.length === 1 ? messages[0] : <ul>{messages.map((m) => <li key={m}>{m}</li>)}</ul>}
    </div>
  );
}

/* ---------- small pieces ---------- */

export function StatusChip({ status, reversed }: { status: EntryStatus; reversed?: boolean }) {
  const { t } = useI18n();
  if (reversed) return <span className="chip bad">{t('reversedTag')}</span>;
  const cls = status === 'approved' ? 'ok' : status === 'checked' ? 'info' : 'warn';
  return <span className={'chip ' + cls}>{t(status)}</span>;
}

export function InvoiceStatusChip({ status }: { status: InvoiceStatus }) {
  const { t } = useI18n();
  const cls = status === 'posted' ? 'ok' : status === 'cancelled' ? 'bad' : 'warn';
  return <span className={'chip ' + cls}>{t(status === 'draft' ? 'draft' : status)}</span>;
}

export function typeName(type: EntryType, i18n: I18n): string {
  // "closing" alone is the closing balance of a statement
  return type === 'closing' ? i18n.t('closingEntry') : i18n.t(type);
}

export function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id}>
        <h3 id={id}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5M10 21v-6h4v6',
  receipt: 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1ZM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11',
  tree: 'M21 12h-8M21 6H8M21 18h-8M3 6v4c0 1.1.9 2 2 2h3M3 10v6c0 1.1.9 2 2 2h3',
  chart: 'M3 3v18h18M18 17V9M13 17V5M8 17v-3',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4',
  invoice: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  cal: 'M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5M16 2v4M8 2v4M3 10h5M17.5 17.5 16 16.3V14M22 16a6 6 0 1 1-12 0 6 6 0 0 1 12 0',
  trend: 'm22 7-8.5 8.5-5-5L2 17M16 7h6v6',
  box: 'm7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.3 7l8.7 5 8.7-5M12 22V12',
  idcard: 'M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM11 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0M6.17 15a3 3 0 0 1 5.66 0M16 10h2M16 14h2',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  sliders: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4',
  plus: 'M5 12h14M12 5v14',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  printer: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  chevron: 'm9 18 6-6-6-6',
  undo: 'M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z',
  cart: 'M8 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2M19 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12',
  truck: 'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0M19 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2zM9 7h7M9 11h5',
  swap: 'M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16',
  star: 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z',
  mail: 'M22 6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2zM22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7',
  contact: 'M16 2v2M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M8 2v2M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  chevronDown: 'm6 9 6 6 6-6',
  search: 'm21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
  globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10',
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  contrast: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 18a6 6 0 0 0 0-12z',
  rows: 'M3 5h18M3 12h18M3 19h18',
  building: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18ZM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4',
  bank: 'M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3 3 8h18Z',
  clipboard: 'M9 4h6v3H9zM8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M9 12h6M9 16h4',
  layers: 'm12 3 9 5-9 5-9-5ZM3 13l9 5 9-5',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9ZM8 8h.01',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z',
  // a capsule, drawn in-house
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7ZM7.5 10.5l6 6',
  wallet: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
  key: 'm15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4M21 2l-9.6 9.6M13 15.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM11 18h2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  tool: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z',
  dollar: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  scale: 'M12 3v18M7 21h10M3 7h18M6 7l-3 7a3 3 0 0 0 6 0ZM18 7l-3 7a3 3 0 0 0 6 0Z',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 9a9 9 0 0 1-9 9',
  panel: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM9 3v18',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 6v6l4 2',
  circle: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  // closer rows (the compact density), drawn in-house beside "rows"
  rowsDense: 'M3 4.5h18M3 9.5h18M3 14.5h18M3 19.5h18'
};

/**
 * What an empty list shows: what the page is for and the one thing to do next (and importing from Excel where it fits),
 * instead of an empty table.
 */
export function EmptyState({ icon = 'inbox', title, text, action, secondary, compact }: {
  icon?: string;
  title: string;
  text?: string;
  action?: { label: string; href?: string; onClick?: () => void; icon?: string };
  secondary?: { label: string; href?: string; onClick?: () => void; icon?: string };
  compact?: boolean;
}) {
  const button = (a: NonNullable<typeof action>, primary: boolean) => {
    const cls = 'btn' + (primary ? ' primary' : '');
    const inner = <>{a.icon && <Icon name={a.icon} size={16} />}{a.label}</>;
    return a.href ? <a className={cls} href={a.href}>{inner}</a> : <button type="button" className={cls} onClick={a.onClick}>{inner}</button>;
  };
  return (
    <div className={'empty-state' + (compact ? ' compact' : '')} role="status">
      <span className="empty-ico" aria-hidden="true"><Icon name={icon} size={compact ? 22 : 28} /></span>
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {(action || secondary) && (
        <div className="empty-actions">
          {action && button(action, true)}
          {secondary && button(secondary, false)}
        </div>
      )}
    </div>
  );
}

/** A line icon; className "flip" mirrors a directional one (chevron, sign out) in Arabic and Kurdish. */
export function Icon({ name, size = 18, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect x="1" y="1" width="26" height="26" rx="7" fill="#F2A33A" />
      <circle cx="14" cy="13.5" r="6.5" fill="none" stroke="#0F1E3D" strokeWidth="2.6" />
      <path d="M18.3 17.8 22 21.5" stroke="#0F1E3D" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M14 4.8v2.2M5.3 13.5h2.2M20.5 13.5h2.2" stroke="#0F1E3D" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- account picker ---------- */

export function AccountCombo({ value, onChange, filter, invalid, ariaLabel, includeParents }: {
  value: string;
  onChange(code: string): void;
  filter?: (a: AccountView) => boolean;
  /** Also offer parent (non-postable) accounts — used for reports. */
  includeParents?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  const i18n = useI18n();
  const { accounts } = useData();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const options = useMemo(() => accounts.filter((a) => (includeParents || a.postable) && (!filter || filter(a))), [accounts, filter, includeParents]);
  const selected = accounts.find((a) => a.code === value);
  const label = selected ? `${selected.code} — ${i18n.name(selected.name)}` : '';
  const matches = useMemo(() => {
    const q = normalizeForSearch(query);
    if (!q) return options.slice(0, 80);
    return options.filter((a) => a.code.startsWith(q) || [a.name.ar, a.name.en, a.name.ku].some((n) => normalizeForSearch(n).includes(q))).slice(0, 80);
  }, [options, query]);

  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="combo">
      <input
        className={'input' + (invalid ? ' invalid' : '')}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel ?? i18n.t('account')}
        placeholder={i18n.t('chooseAccount')}
        value={open ? query : label}
        onFocus={() => { setOpen(true); setQuery(''); setActive(0); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); pick(matches[active]!.code); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul className="combo-list" id={listId} role="listbox">
          {matches.length === 0 && <li className="muted">{i18n.t('noMatch')}</li>}
          {matches.map((a, i) => (
            <li key={a.code} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(a.code); }} onMouseEnter={() => setActive(i)}>
              <span className="code">{a.code}</span>
              <span>{i18n.name(a.name)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- search picker (customers, suppliers, items) ---------- */

export interface PickOption {
  id: string;
  code: string;
  label: string;
  /** Extra text shown on the right, e.g. stock or balance. */
  hint?: string;
  /** Extra words to search, e.g. names in the other languages, phone, barcode. */
  search?: string;
}

/**
 * Adding someone new from inside a picker (industry/PartyPicker.tsx): a "+" in the box, and a row in the list that
 * adds what was typed. `label` names that row ("Add “Mer” as a new customer"; with nothing typed, "Add a new customer").
 */
export interface ComboAdd { title: string; label(typed: string): string; onAdd(typed: string): void }

/** The id of the list's "add what I typed" row: never an option's own id. */
export const COMBO_ADD_ROW = '\u0000add';

/**
 * The rows of a picker's list for what was typed: the options that match (at most 80), the "none" choice first while
 * nothing is typed, and with `canAdd` the row that adds a new one: first (so Enter picks it) when the typed text
 * matches nobody, last otherwise, and left out when an option has exactly that name.
 */
export function comboRows(options: readonly PickOption[], query: string, opts: { emptyLabel?: string | undefined; canAdd?: boolean | undefined; addLabel?: ((typed: string) => string) | undefined } = {}): PickOption[] {
  const q = normalizeForSearch(query);
  const found = q ? options.filter((o) => normalizeForSearch(`${o.code} ${o.label} ${o.search ?? ''}`).includes(q)) : options;
  const list = found.slice(0, 80);
  const rows = opts.emptyLabel !== undefined && !q ? [{ id: '', code: '', label: opts.emptyLabel }, ...list] : [...list];
  if (!opts.canAdd) return rows;
  const typed = query.trim();
  if (q && found.some((o) => normalizeForSearch(o.label) === q)) return rows;
  const add: PickOption = { id: COMBO_ADD_ROW, code: '', label: opts.addLabel ? opts.addLabel(typed) : typed };
  return q && found.length === 0 ? [add] : [...rows, add];
}

export function SearchCombo({ value, options, onChange, placeholder, ariaLabel, invalid, emptyLabel, add, inputRef }: {
  value: string;
  options: PickOption[];
  onChange(id: string): void;
  placeholder: string;
  ariaLabel?: string;
  invalid?: boolean;
  /** When set, the list starts with a "none" choice with this label. */
  emptyLabel?: string;
  /** When set, someone new can be added from the picker itself. */
  add?: ComboAdd | undefined;
  /** The box itself, for a page that puts the cursor in it. */
  inputRef?: RefObject<HTMLInputElement | null> | undefined;
}) {
  const i18n = useI18n();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selected = options.find((o) => o.id === value);
  const matches = useMemo(
    () => comboRows(options, query, { emptyLabel, canAdd: !!add, addLabel: add?.label }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options, query, emptyLabel, !!add]
  );

  const pick = (id: string) => {
    if (id === COMBO_ADD_ROW) {
      const typed = query.trim();
      setOpen(false);
      setQuery('');
      add?.onAdd(typed);
      return;
    }
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className={'combo' + (add ? ' can-add' : '')}>
      <input
        ref={inputRef}
        className={'input' + (invalid ? ' invalid' : '')}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel ?? placeholder}
        placeholder={selected ? '' : emptyLabel ?? placeholder}
        value={open ? query : selected ? `${selected.code} — ${selected.label}` : ''}
        onFocus={() => { setOpen(true); setQuery(''); setActive(0); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)); }
          // with an "add" row at the end, Up from the first row reaches it
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i === 0 && add ? matches.length - 1 : Math.max(i - 1, 0))); }
          else if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); pick(matches[active]!.id); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {add && (
        // not a tab stop of its own (Tab goes on to the next field): from the keyboard, the list's "add" row does the same
        <button type="button" className="combo-add" tabIndex={-1} title={add.title} aria-label={add.title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { const typed = open ? query.trim() : ''; setOpen(false); setQuery(''); add.onAdd(typed); }}>
          <Icon name="plus" size={16} />
        </button>
      )}
      {open && (
        <ul className="combo-list" id={listId} role="listbox">
          {matches.length === 0 && <li className="muted">{i18n.t('noMatch')}</li>}
          {matches.map((o, i) => (
            <li key={o.id || 'none'} role="option" aria-selected={i === active} className={o.id === COMBO_ADD_ROW ? 'combo-add-row' : undefined}
              onMouseDown={(e) => { e.preventDefault(); pick(o.id); }} onMouseEnter={() => setActive(i)}>
              {o.id === COMBO_ADD_ROW && <Icon name="plus" size={15} />}
              {o.code && <span className="code">{o.code}</span>}
              <span style={{ flex: 1 }}>{o.label}</span>
              {o.hint && <span className="muted small num">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- split button ---------- */

export interface SplitChoice { key: string; label: string; hint?: string; icon?: string }

/**
 * A primary button with a menu of its other ways: the main part does `current`, the arrow opens the list of all of
 * them (the current one ticked). Picking one from the list does it at once; the page remembers it as the main one.
 */
export function SplitButton({ choices, current, onRun, disabled, busyLabel, menuLabel, shortcut, note }: {
  choices: readonly SplitChoice[];
  current: string;
  onRun(key: string): void;
  disabled?: boolean;
  /** shown on the main part while it works */
  busyLabel?: string | undefined;
  menuLabel: string;
  /** the key that presses the main part (shown beside its label, e.g. "F9") */
  shortcut?: string | undefined;
  /** a line under the list (e.g. that the main button remembers the last choice) */
  note?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); arrow.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1);
      items[next]?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    box.current?.querySelector<HTMLButtonElement>('.menu-item[aria-checked="true"], .menu-item')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const main = choices.find((c) => c.key === current) ?? choices[0];
  if (!main) return null;
  return (
    <div className="split-btn menu-anchor" ref={box}>
      <button type="button" className="btn primary split-main" disabled={disabled} title={main.hint} aria-keyshortcuts={shortcut} onClick={() => onRun(main.key)}>
        <Icon name={main.icon ?? 'check'} size={16} />
        <span>{disabled && busyLabel ? busyLabel : main.label}</span>
        {shortcut && <kbd className="ltr">{shortcut}</kbd>}
      </button>
      {choices.length > 1 && (
        <button ref={arrow} type="button" className="btn primary split-arrow" disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
          aria-label={menuLabel} title={menuLabel} onClick={() => setOpen(!open)}>
          <Icon name="chevronDown" size={14} />
        </button>
      )}
      {open && (
        <div className="menu up" id={menuId} role="menu" aria-label={menuLabel}>
          {choices.map((c) => (
            <button key={c.key} type="button" className="menu-item" role="menuitemradio" aria-checked={c.key === main.key}
              onClick={() => { setOpen(false); onRun(c.key); }}>
              <Icon name={c.key === main.key ? 'check' : c.icon ?? 'circle'} size={16} />
              <span className="split-item"><span>{c.label}</span>{c.hint && <span className="muted small">{c.hint}</span>}</span>
            </button>
          ))}
          {note && <><div className="menu-sep" /><div className="muted small split-note">{note}</div></>}
        </div>
      )}
    </div>
  );
}

/* ---------- quantity input ---------- */

/** Quantity with up to 3 decimals (2.5 kg); reports thousandths or null. */
export function QtyInput({ value, onChange, ariaLabel }: { value: number | null; onChange(value: number | null): void; ariaLabel?: string }) {
  const [text, setText] = useState(value === null ? '' : formatQty(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === null ? '' : formatQty(value));
  }, [value, focused]);
  const invalid = text.trim() !== '' && parseQty(text) === null;
  return (
    <input
      className={'input amount' + (invalid ? ' invalid' : '')}
      inputMode="decimal"
      aria-label={ariaLabel}
      aria-invalid={invalid}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.trim() === '' ? null : parseQty(e.target.value));
      }}
    />
  );
}

/* ---------- amount input ---------- */

/** Text input for money that accepts 1,250,000 or ١٬٢٥٠٬٠٠٠; reports the value in minor units (or null). */
export function AmountInput({ value, currency, onChange, ariaLabel }: {
  value: number | null;
  currency: CurrencyCode;
  onChange(value: number | null): void;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value === null ? '' : formatAmount(value, currency));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === null ? '' : formatAmount(value, currency));
  }, [value, currency, focused]);
  const parsed = text.trim() === '' ? null : parseAmount(text, currency);
  const invalid = text.trim() !== '' && parsed === null;
  return (
    <input
      className={'input amount' + (invalid ? ' invalid' : '')}
      inputMode="decimal"
      aria-label={ariaLabel}
      aria-invalid={invalid}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); if (parsed !== null) setText(formatAmount(parsed, currency)); }}
      onChange={(e) => {
        setText(e.target.value);
        const v = e.target.value.trim() === '' ? null : parseAmount(e.target.value, currency);
        onChange(v);
      }}
    />
  );
}

/* ---------- CSV export (opens in Excel with Arabic/Kurdish intact) ---------- */

/**
 * One CSV cell. Text that starts like a formula (= + - @, a tab or a line break) gets a leading apostrophe, so a name
 * typed by a shop customer or read from someone's sheet ("=HYPERLINK(…)") shows as text in Excel instead of running;
 * plain numbers ("-5000", "1,250.50") stay numbers. Quoted when it holds a quote, a comma or a line break.
 */
export function csvCell(cell: string | number): string {
  // isolate marks only steer on-screen direction; Excel would keep them and read "-5000" as text
  let s = stripBidiIsolates(String(cell));
  if (typeof cell === 'string' && /^[=+\-@\t\r]/.test(s) && !/^[-+]?\d[\d,]*(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  // (an amount the server did not send, 1.4, is an empty cell)
  const csv = rows.map((r) => r.map((cell) => (cell === undefined || cell === null ? '' : csvCell(cell))).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * A thin bar along the top while the app waits on the server. It appears only when a wait passes 400 ms, so quick
 * clicks don't flicker; long reports, saves and backups show that the app is working rather than frozen.
 */
export function BusyBar() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onBusyChange((n) => {
      if (n > 0 && !timer) timer = setTimeout(() => { timer = undefined; setShow(true); }, 400);
      if (n === 0) { if (timer) clearTimeout(timer); timer = undefined; setShow(false); }
    });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return show ? <div className="busy-bar" role="progressbar" aria-busy="true" aria-label="…" /> : null;
}
