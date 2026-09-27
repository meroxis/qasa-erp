import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatQty, normalizeForSearch, parseAmount, parseQty, formatAmount, type CurrencyCode, type EntryStatus, type EntryType, type InvoiceStatus } from '@qasa/core';
import { ApiError, type AccountView, type PlanStatus, type Settings } from './api.ts';
import { isKey, useI18n, type I18n } from './i18n.ts';

/* ---------- shared data ---------- */

export interface AppData {
  accounts: AccountView[];
  settings: Settings | null;
  /** null until loaded; treat as Free */
  plan: PlanStatus | null;
  online: boolean;
  reloadAccounts(): Promise<void>;
  reloadSettings(): Promise<void>;
  reloadPlan(): Promise<void>;
}

export const DataContext = createContext<AppData | null>(null);

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

interface Detail { code?: string; line?: number; accountCode?: string; period?: string; available?: number }

export function errorMessages(error: unknown, i18n: I18n): string[] {
  const { t } = i18n;
  if (error instanceof ApiError) {
    if (error.code === 'validation' && Array.isArray(error.details)) {
      const messages = (error.details as Detail[]).map((d) => {
        const key = 'err_' + (d.code ?? 'internal');
        return isKey(key) ? t(key, { n: d.line ?? '', c: d.accountCode ?? '', p: d.period ?? '', a: d.available === undefined ? '' : formatQty(d.available) }) : t('err_internal');
      });
      return [...new Set(messages)];
    }
    // plan limits have a message per limit ("err_plan_limit_warehouses"), with a general one to fall back on
    const limit = error.code === 'plan_limit' ? (error.details as { limit?: string } | null)?.limit : undefined;
    const key = limit && isKey(`err_plan_limit_${limit}`) ? `err_plan_limit_${limit}` : 'err_' + error.code;
    return [isKey(key) ? t(key) : t('err_internal')];
  }
  return [t('err_internal')];
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
  return i18n.t(type);
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
  contact: 'M16 2v2M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M8 2v2M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

export function SearchCombo({ value, options, onChange, placeholder, ariaLabel, invalid, emptyLabel }: {
  value: string;
  options: PickOption[];
  onChange(id: string): void;
  placeholder: string;
  ariaLabel?: string;
  invalid?: boolean;
  /** When set, the list starts with a "none" choice with this label. */
  emptyLabel?: string;
}) {
  const i18n = useI18n();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selected = options.find((o) => o.id === value);
  const matches = useMemo(() => {
    const q = normalizeForSearch(query);
    const found = q ? options.filter((o) => normalizeForSearch(`${o.code} ${o.label} ${o.search ?? ''}`).includes(q)) : options;
    const list = found.slice(0, 80);
    return emptyLabel !== undefined && !q ? [{ id: '', code: '', label: emptyLabel }, ...list] : list;
  }, [options, query, emptyLabel]);

  const pick = (id: string) => {
    onChange(id);
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
        aria-label={ariaLabel ?? placeholder}
        placeholder={selected ? '' : emptyLabel ?? placeholder}
        value={open ? query : selected ? `${selected.code} — ${selected.label}` : ''}
        onFocus={() => { setOpen(true); setQuery(''); setActive(0); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); pick(matches[active]!.id); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul className="combo-list" id={listId} role="listbox">
          {matches.length === 0 && <li className="muted">{i18n.t('noMatch')}</li>}
          {matches.map((o, i) => (
            <li key={o.id || 'none'} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(o.id); }} onMouseEnter={() => setActive(i)}>
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

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = rows.map((r) => r.map((cell) => {
    const s = String(cell);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
