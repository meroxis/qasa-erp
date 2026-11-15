import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LTR_ISOLATE_END, LTR_ISOLATE_START, stripBidiIsolates, type AmountsShow, type Lang } from '@qasa/core';
import { DataContext } from './components.tsx';
import { I18nContext, makeI18n } from './i18n.ts';
import { AMOUNTS_TEXT } from './i18n/amounts.ts';
import { Amount, amountTextOf, boardOf, boardRate, boardReader, DocAmount, DualContext, DualNote, DualRateHint, dualRateTitle, dualText, OwedTotal, paperRateX100, rateFromBoard, type Board, type DualRate, type DualSource } from './Amount.tsx';
import type { EntrySummary, InvoiceSummary, PartyView } from './api.ts';
import type { MoneyAccountView } from './industry/banking-api.ts';
import type { BriefView, DashboardView, DayCloseView } from './industry/brief-api.ts';
import type { PoSummaryView, PoView } from './industry/purchasing-api.ts';
import type { QuoteView } from './industry/quotes-api.ts';
import { QuickVoucherForm } from './industry/QuickVoucher.tsx';
import { formBalance, formBalanceDual } from './industry/quick-voucher.ts';
import type { NavViewer } from './nav.ts';
import { compact, Home } from './pages/Home.tsx';
import { briefText } from './pages/Brief.tsx';
import { dayCloseText } from './pages/DayClose.tsx';
import { InvoicesTable, Parties } from './pages/Parties.tsx';
import { MoreReports } from './pages/MoreReports.tsx';
import { AmountsShowSetting } from './pages/Settings.tsx';
import { TillEquivalent } from './pages/Pos.tsx';
import { EntriesTable } from './pages/Entries.tsx';
import { QuoteDetail, Quotes } from './pages/Quotes.tsx';
import { PurchaseOrderDetail, PurchaseOrders } from './pages/PurchaseOrders.tsx';
import { Banking } from './pages/Banking.tsx';

// Settings → Language and display → "Show amounts in": dinar only (as always), dinar and dollar, dollar and dinar.
// One helper (Amount.tsx) shows every total the same way: the real money, and ≈ its value in the other currency at
// the rate board's rate, in smaller type, with the rate's date in a tooltip.

const { now, answering } = vi.hoisted(() => {
  const now = { answers: {} as Record<string, unknown> };
  const answering = () => new Proxy({}, {
    get: (_, name: string) => () => (name in now.answers ? Object.assign(Promise.resolve(now.answers[name]), { answer: now.answers[name] }) : new Promise(() => {}))
  });
  return { now, answering };
});
vi.mock('./api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api.ts')>()), api: answering() }));
vi.mock('./industry/brief-api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./industry/brief-api.ts')>()), briefApi: answering(), dayCloseApi: answering() }));
vi.mock('./industry/parties-api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./industry/parties-api.ts')>()), partiesApi: answering() }));
vi.mock('./industry/quotes-api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./industry/quotes-api.ts')>()), quotesApi: answering() }));
vi.mock('./industry/purchasing-api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./industry/purchasing-api.ts')>()), purchasingApi: answering() }));
vi.mock('./industry/banking-api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./industry/banking-api.ts')>()), bankingApi: answering() }));
vi.mock('./components.tsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./components.tsx')>()),
  useLoad: (load: () => Promise<unknown>) => {
    let data: unknown = null;
    try {
      const asked = load() as Promise<unknown> & { answer?: unknown };
      void Promise.resolve(asked).catch(() => {});
      if (asked && 'answer' in asked) data = asked.answer;
    } catch { /* not loaded */ }
    return { data, error: null, loading: data === null, reload: () => {} };
  }
}));

const RATE: DualRate = { rateX100: 131000, date: '2026-11-14', today: false };
/** A rate board with 1,310 from 2026-11-01 on, and nothing before. */
const source = (show: AmountsShow, rates: 'board' | 'none' = 'board', canSet = true): DualSource => ({
  show, canSet,
  rate: (date) => (rates === 'none' ? null : !date || date >= '2026-11-01' ? RATE : { ...RATE, today: true })
});
const i18nOf = (lang: Lang) => makeI18n(lang, 'western', () => {}, () => {});
const plain = (html: string) => stripBidiIsolates(html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, '\'').replace(/&quot;/g, '"')).replace(/\s+/g, ' ');
const render = (node: ReactNode, opts: { lang?: Lang; dual?: DualSource; data?: object } = {}) => renderToStaticMarkup(
  <I18nContext.Provider value={i18nOf(opts.lang ?? 'en')}>
    <DataContext.Provider value={{ accounts: [], settings: null, plan: null, online: true, reloadAccounts: async () => {}, reloadSettings: async () => {}, reloadPlan: async () => {}, ...opts.data } as never}>
      {opts.dual ? <DualContext.Provider value={opts.dual}>{node}</DualContext.Provider> : node}
    </DataContext.Provider>
  </I18nContext.Provider>
);

beforeEach(() => { now.answers = {}; });

describe('the texts', () => {
  it('has every text in Arabic, English and Kurdish, with the app\'s Kurdish words for dinar, dollar and the rate', () => {
    for (const [key, texts] of Object.entries(AMOUNTS_TEXT)) {
      expect(texts, key).toHaveLength(3);
      for (const s of texts) expect(s.trim().length, key).toBeGreaterThan(0);
    }
    expect(AMOUNTS_TEXT.am_iqdUsd[2]).toBe('دینار و دۆلار');
    expect(AMOUNTS_TEXT.am_setRate[2]).toContain('نرخی دۆلار');
    for (const key of ['am_rateOn', 'am_rateToday'] as const) for (const s of AMOUNTS_TEXT[key]) { expect(s).toContain('{d}'); expect(s).toContain('{r}'); }
  });
});

describe('the helper', () => {
  const en = i18nOf('en');
  it('writes the second figure with ≈, in the app\'s money format', () => {
    expect(dualText(en, { IQD: 1_000_000, USD: 0 }, 'iqd_usd', RATE)).toEqual({ first: '1,000,000 IQD', second: '≈ $763.36' });
    expect(dualText(en, { IQD: 1_000_000, USD: 0 }, 'usd_iqd', RATE)).toEqual({ first: '≈ $763.36', second: '1,000,000 IQD' });
    expect(dualText(en, { IQD: 655_000, USD: 50_000 }, 'iqd_usd', RATE)).toEqual({ first: '655,000 IQD + $500.00', second: '≈ $1,000.00' });
    expect(dualText(en, { IQD: 1_000_000, USD: 0 }, 'iqd', RATE)).toEqual({ first: '1,000,000 IQD', second: null });
  });

  it('shows only the stored currency without a rate', () => {
    expect(dualText(en, { IQD: 1_000_000, USD: 0 }, 'iqd_usd', null)).toEqual({ first: '1,000,000 IQD', second: null });
    expect(dualText(en, { IQD: 1_000_000, USD: 0 }, 'usd_iqd', undefined)).toEqual({ first: '1,000,000 IQD', second: null });
  });

  it('keeps a negative amount\'s sign with its digits, and "$" on the left, in Arabic and Kurdish', () => {
    for (const lang of ['ar', 'ku'] as const) {
      const i18n = i18nOf(lang);
      const { first, second } = dualText(i18n, { IQD: -1_000_000, USD: 0 }, 'iqd_usd', RATE);
      // the minus sign of the dinars stays left of the digits; the dollars are one left-to-right run after the ≈
      expect(first).toBe(`${LTR_ISOLATE_START}-1,000,000${LTR_ISOLATE_END} د.ع`);
      expect(second).toBe(`≈ ${LTR_ISOLATE_START}$-763.36${LTR_ISOLATE_END}`);
    }
    expect(dualText(en, { IQD: -1_000_000, USD: 0 }, 'iqd_usd', RATE).second).toBe('≈ $-763.36');
  });

  it('says the rate and its date in the tooltip, and when the latest rate stands in for a date without one', () => {
    expect(dualRateTitle(en, RATE)).toBe('At the dollar rate of 14/11/2026: $1 = 1,310 IQD');
    expect(dualRateTitle(en, { ...RATE, today: true })).toContain('No rate was entered for that date');
    expect(dualRateTitle(i18nOf('ku'), RATE)).toBe('بە نرخی دۆلاری ڕۆژی 14/11/2026: 1 دۆلار = 1,310 دینار');
  });

  it('is plain text with dinar only (nothing changes on any screen), and two lines with the rate in a tooltip otherwise', () => {
    expect(render(<Amount value={1_000_000} />)).toBe('1,000,000 IQD');
    expect(render(<Amount value={1_000_000} />, { dual: source('iqd') })).toBe('1,000,000 IQD');
    const two = render(<Amount value={1_000_000} />, { dual: source('iqd_usd') });
    expect(two).toContain('<span class="dual-first"><span class="dual-part">1,000,000 IQD</span></span>');
    expect(two).toContain('<span class="dual-second" title="At the dollar rate of 14/11/2026: $1 = 1,310 IQD">≈ $763.36</span>');
    expect(render(<Amount value={-250_000} parens />, { dual: source('iqd_usd') })).toContain('(≈ $190.84)');
    expect(render(<Amount value={-250_000} parens />)).toBe('(250,000 IQD)');
    // real dollars are shown as they are and converted once
    expect(plain(render(<Amount value={50_000} currency="USD" />, { dual: source('usd_iqd') }))).toBe(' $500.00 ≈ 655,000 IQD ');
  });

  it('gives those who may enter a rate a quiet hint when there is none, and nobody else', () => {
    expect(render(<DualRateHint />, { dual: source('iqd_usd', 'none') })).toContain('href="#/rates"');
    expect(render(<DualRateHint />, { dual: source('iqd_usd', 'none', false) })).toBe('');
    expect(render(<DualRateHint />, { dual: source('iqd_usd') })).toBe('');
    expect(render(<DualRateHint />, { dual: source('iqd', 'none') })).toBe('');
  });

  it('adds the other currency under the till\'s total as a hint only', () => {
    expect(render(<TillEquivalent total={1_310_000} currency="IQD" />, { dual: source('iqd') })).toBe('');
    expect(render(<TillEquivalent total={1_310_000} currency="IQD" />, { dual: source('iqd_usd') })).toContain('≈ $1,000.00');
    expect(render(<TillEquivalent total={50_000} currency="USD" />, { dual: source('usd_iqd') })).toContain('≈ 655,000 IQD');
    expect(render(<TillEquivalent total={1_310_000} currency="IQD" />, { dual: source('iqd_usd', 'none') })).toBe('');
  });

  it('converts a dollar sale at the rate the cashier typed for it (the rate it is booked at), and says so', () => {
    const html = render(<TillEquivalent total={50_000} currency="USD" rateX100={142_000} />, { dual: source('iqd_usd') });
    expect(html).toContain('≈ 710,000 IQD');
    expect(html).toContain('title="At this sale’s rate: $1 = 1,420 IQD"');
    // with the field empty, the board's rate, as before; even without a board rate the sale's own rate is enough
    expect(render(<TillEquivalent total={50_000} currency="USD" rateX100={0} />, { dual: source('iqd_usd') })).toContain('≈ 655,000 IQD');
    expect(render(<TillEquivalent total={50_000} currency="USD" rateX100={142_000} />, { dual: source('iqd_usd', 'none') })).toContain('≈ 710,000 IQD');
    expect(render(<TillEquivalent total={50_000} currency="USD" rateX100={142_000} />, { dual: source('iqd') })).toBe('');
  });

  it('a total owed: the real dinars and dollars converted once; the book-rate total as before with dinar only or no rate', () => {
    // a customer owes 1,310,000 IQD and $1,400 booked at 1,420 (1,988,000): 3,298,000 IQD at the book rates
    const owed = { IQD: 1_310_000, USD: 140_000 };
    expect(render(<OwedTotal owed={owed} book={3_298_000} />)).toBe('3,298,000 IQD');
    expect(render(<OwedTotal owed={owed} book={3_298_000} />, { dual: source('iqd') })).toBe('3,298,000 IQD');
    expect(render(<OwedTotal owed={owed} book={3_298_000} />, { dual: source('iqd_usd', 'none') })).toBe('3,298,000 IQD');
    // 1,310,000 IQD is $1,000 at 1,310: the whole is $2,400, never 3,298,000 / 1,310 = $2,517.56
    expect(plain(render(<OwedTotal owed={owed} book={3_298_000} />, { dual: source('iqd_usd') }))).toBe(' 1,310,000 IQD + $1,400.00 ≈ $2,400.00 ');
    expect(plain(render(<OwedTotal owed={owed} book={3_298_000} />, { dual: source('usd_iqd') }))).toBe(' $1,400.00 + 1,310,000 IQD ≈ 3,144,000 IQD ');
    // a server that does not send the real split: the book total alone, never converted
    expect(render(<OwedTotal owed={undefined} book={3_298_000} />, { dual: source('iqd_usd') })).toBe('3,298,000 IQD');
  });

  it('reads the rate board once, and works out each day from it, the day a lookup falls back to (today) as well', async () => {
    const boards: Board[] = [];
    let reads = 0;
    const read = boardReader(async () => { reads += 1; return [{ date: '2026-11-14', rateX100: 131_000, source: null }]; }, (b) => { boards.push(b); });
    read();
    read();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    read();
    expect(reads).toBe(1);
    expect(boards).toEqual([[{ date: '2026-11-14', rateX100: 131_000 }]]);
    // an invoice dated before every rate on the board: today's rate stands in, and today is known too
    expect(rateFromBoard(boards[0]!, '2026-10-01', '2026-11-15')).toEqual({ rateX100: 131_000, date: '2026-11-14', today: true });
    expect(rateFromBoard(boards[0]!, '2026-11-15', '2026-11-15')).toEqual({ rateX100: 131_000, date: '2026-11-14', today: false });
    // no rate on the board at all: null for every day
    for (const day of ['2026-10-01', '2026-11-15']) expect(rateFromBoard(boardOf([]), day, '2026-11-15')).toBe(null);
  });

  it('carries the ≈ figures into the copied and sent brief and end of day, and nothing new with dinar only', () => {
    const en = i18nOf('en');
    const b = {
      date: '2026-11-14', company: { ar: '', en: 'Mer Shop', ku: '' }, sales: { today: 1_310_000, invoices: 2, sameDayLastWeek: 0, month: 2_620_000 },
      cash: { accounts: [], total: { IQD: 655_000, USD: 50_000 }, base: 1_365_000 }, flow: { in: 655_000, out: 131_000 },
      topItems: [], receivables: 3_298_000, receivablesOwed: { IQD: 1_310_000, USD: 140_000 },
      lateCustomers: [{ partyId: 'p', code: 'C1', name: 'Las', phone: '', balance: 3_298_000, oldestDays: 40, buckets: [0, 3_298_000, 0, 0], owed: { IQD: 1_310_000, USD: 140_000 } }],
      installments: { overdue: [], dueTomorrow: [], overdueTotal: { IQD: 0, USD: 0 } }, lowStock: [], approvals: { waitingCheck: 0, waitingApproval: 0 }, ownerPhone: ''
    } as BriefView;
    const plainText = briefText(en, b);
    expect(plainText).toContain('Sales today: 1,310,000 IQD');
    expect(plainText).toContain('Las — 3,298,000 IQD');
    expect(plainText).not.toContain('≈');
    expect(briefText(en, b, amountTextOf(en, source('iqd')))).toBe(plainText);
    const both = briefText(en, b, amountTextOf(en, source('iqd_usd')));
    expect(both).toContain('Sales today: 1,310,000 IQD (≈ $1,000.00)');
    expect(both).toContain('655,000 IQD + $500.00 (≈ $1,000.00)');
    expect(both).toContain('Money out today: 131,000 IQD (≈ $100.00)');
    expect(both).toContain('Las — 1,310,000 IQD + $1,400.00 (≈ $2,400.00)');
    const c = {
      date: '2026-11-14', company: { ar: '', en: '', ku: '' }, sales: { gross: 1_441_000, invoices: 3, returns: 131_000, returnsCount: 1, net: 1_310_000 },
      methods: [], refunds: [], registers: [], drawers: null, debts: { collected: 262_000, collectedRows: [], added: 0, addedRows: [] },
      lowStock: { count: 0, top: [] }, topItems: [], ownerPhone: ''
    } as DayCloseView;
    expect(dayCloseText(en, c)).not.toContain('≈');
    expect(dayCloseText(en, c, amountTextOf(en, source('iqd')))).toBe(dayCloseText(en, c));
    const day = dayCloseText(en, c, amountTextOf(en, source('iqd_usd')));
    expect(day).toContain('1,310,000 IQD (≈ $1,000.00)');
    expect(day).toContain('Returns: 131,000 IQD (≈ $100.00)');
    expect(day).toContain('262,000 IQD (≈ $200.00)');
  });

  it('says under the brief what the ≈ figures are, only when they show', () => {
    expect(render(<DualNote />)).toBe('');
    expect(render(<DualNote />, { dual: source('iqd') })).toBe('');
    expect(render(<DualNote />, { dual: source('iqd_usd', 'none') })).toBe('');
    expect(render(<DualNote />, { dual: source('iqd_usd') })).toContain('Figures marked ≈ are in the other currency');
    for (const s of AMOUNTS_TEXT.am_rateSale) expect(s).toContain('{r}');
  });
});

describe('the setting', () => {
  it('offers the three choices, the company\'s own chosen', () => {
    const html = render(<AmountsShowSetting />, { data: { settings: { companyName: { ar: '', en: '', ku: '' }, defaultRateX100: 131000, fiscalYearStart: '01-01', businessTypes: [], amountsShow: 'usd_iqd' } } });
    for (const label of ['Dinar only', 'Dinar and dollar', 'Dollar and dinar', 'Show amounts in']) expect(html).toContain(label);
    expect(html).toMatch(/aria-checked="true"[^>]*>(?:(?!aria-checked).)*Dollar and dinar/);
    // a server from before 1.4.2 sends no choice: dinar only
    const old = render(<AmountsShowSetting />, { data: { settings: { companyName: { ar: '', en: '', ku: '' }, defaultRateX100: 131000, fiscalYearStart: '01-01', businessTypes: [] } } });
    expect(old).toMatch(/aria-checked="true"[^>]*>(?:(?!aria-checked).)*Dinar only/);
  });
});

describe('the home page and a report in the three choices', () => {
  const admin: NavViewer = { admin: true, permissions: ['admin'], businessTypes: [] };
  const dashboard: DashboardView = {
    // customers owe 371,000 IQD and $200 booked at 1,420 (284,000): 655,000 IQD at the book rates
    date: '2026-11-14', salesMonth: 1_310_000, salesLastMonth: 1_000_000, receivables: 655_000, payables: 262_000,
    receivablesOwed: { IQD: 371_000, USD: 20_000 }, payablesOwed: { IQD: 262_000, USD: 0 },
    cash: { total: { IQD: 655_000, USD: 50_000 }, base: 1_310_000 },
    months: [{ month: '2026-10', sales: 1_000_000 }, { month: '2026-11', sales: 1_310_000 }]
  };
  const home = (show: AmountsShow | null, lang: Lang = 'en') => {
    now.answers = { dashboard, entries: [], invoices: [], parties: [] };
    return render(<Home viewer={admin} user="Mer" favourites={[]} />, { lang, data: { permissions: ['admin'] }, ...(show ? { dual: source(show) } : {}) });
  };

  it('dinar only: the home page is as before', () => {
    const before = home(null);
    expect(home('iqd')).toBe(before);
    expect(before).toContain('1,310,000 IQD');
    expect(before).toContain('655,000 IQD + $500.00');
    expect(before).not.toContain('≈');
    // the receivables tile: the book-rate total, as before (not its dinars and dollars)
    expect(plain(before)).toContain('Owed by customers 655,000 IQD');
    // the chart's dinar labels keep their rounding: 2,500 → 3K (the one decimal is for the ≈ dollars only)
    expect(compact(2_500)).toBe('3K');
    expect(compact(2_500, true)).toBe('2.5K');
    expect(compact(1_310_000)).toBe('1.31M');
  });

  it('a server that does not send the real split: the receivables tile keeps the book total and gets no ≈', () => {
    now.answers = { dashboard: { ...dashboard, receivablesOwed: undefined, payablesOwed: undefined }, entries: [], invoices: [], parties: [] };
    const html = plain(render(<Home viewer={admin} user="Mer" favourites={[]} />, { data: { permissions: ['admin'] }, dual: source('iqd_usd') }));
    expect(html).toContain('Owed by customers 655,000 IQD');
    expect(html).not.toContain('655,000 IQD ≈');
  });

  it('dollar and dinar: the chart puts the ≈ dollars on top and the dinars under them, as the tiles do', () => {
    const html = home('usd_iqd');
    expect(plain(html)).toContain('≈ $1K 1.31M');
    expect(html).toContain('<span class="small num" style="font-weight:600">≈ $1K</span>');
  });

  it('dinar and dollar: each tile also in dollars; the cash keeps its real dollars and adds the whole', () => {
    const html = plain(home('iqd_usd'));
    expect(html).toContain('1,310,000 IQD ≈ $1,000.00'); // sales this month
    // receivables: the real dinars and dollars, each dollar converted once ($200 + 371,000 / 1,310), never the
    // book-rate 655,000 converted again (≈ $500.00)
    expect(html).toContain('371,000 IQD + $200.00 ≈ $483.21');
    expect(html).not.toContain('≈ $500.00');
    expect(html).toContain('262,000 IQD ≈ $200.00'); // payables
    expect(html).toContain('655,000 IQD + $500.00 ≈ $1,000.00'); // cash: real dinars and dollars, then the whole
    // the chart's bars: October's sales at the rate the board had then (none: the latest, said in the tooltip)
    expect(html).toContain('≈ $1K');
    expect(home('iqd_usd')).toContain('No rate was entered for that date');
  });

  it('dollar and dinar: the dollars first', () => {
    const html = plain(home('usd_iqd'));
    expect(html).toContain('≈ $1,000.00 1,310,000 IQD');
    expect(html).toContain('$500.00 + 655,000 IQD ≈ 1,310,000 IQD');
  });

  it('reads right in Kurdish and Arabic', () => {
    const ku = home('iqd_usd', 'ku');
    expect(ku).toContain(`≈ ${LTR_ISOLATE_START}$1,000.00${LTR_ISOLATE_END}`);
    expect(ku).toContain('1,310,000 د.ع');
    expect(home('iqd_usd', 'ar')).toContain(`≈ ${LTR_ISOLATE_START}$483.21${LTR_ISOLATE_END}`);
    // the chart's ≈ label is built by the same helper: the sign, a space, then the isolated amount
    expect(ku).toContain(`≈ ${LTR_ISOLATE_START}$1K${LTR_ISOLATE_END}`);
  });

  it('customers: the footer\'s book-rate total stays one dinar figure; the line above carries the real dinars, dollars and ≈', () => {
    now.answers = {
      list: [{ id: 'p1', type: 'customer', code: 'C1', name: 'Las', phone: '', address: '', accountCode: '1611', creditLimit: null, notes: '', active: true, balance: 3_298_000, hasEntries: true, balances: { IQD: 1_310_000, USD: 140_000 }, lang: null }],
      totals: { type: 'customer', owed: { IQD: 1_310_000, USD: 140_000 }, advance: { IQD: 0, USD: 0 }, owing: 1, advanced: 0 }
    };
    const page = (dual: DualSource) => plain(render(<Parties type="customer" />, { data: { permissions: ['admin'] }, dual }));
    const both = page(source('iqd_usd'));
    expect(both).toContain('Total in IQD at the book rates (dollars converted) 3,298,000 IQD');
    expect(both).not.toContain('3,298,000 IQD ≈');
    expect(both).not.toContain('$2,517.56');
    expect(both).toContain('1,310,000 IQD + $1,400.00 ≈ $2,400.00');
    expect(page(source('usd_iqd'))).toContain('Total in IQD at the book rates (dollars converted) 3,298,000 IQD');
    // without a rate, those who may enter one are told why only dinars show
    expect(page(source('iqd_usd', 'none'))).toContain('Enter today’s dollar rate to see amounts in dollars too');
  });

  it('shows only dinars and a hint to set the rate when the board has no rate', () => {
    now.answers = { dashboard, entries: [], invoices: [], parties: [] };
    const html = render(<Home viewer={admin} user="Mer" favourites={[]} />, { data: { permissions: ['admin'] }, dual: source('iqd_usd', 'none') });
    expect(html).not.toContain('≈');
    expect(html).toContain('Enter today’s dollar rate to see amounts in dollars too');
  });

  it('the profit report: its totals row in both currencies, at the rate of the period\'s last day', () => {
    now.answers = {
      salesByItem: { from: '2026-11-01', to: '2026-11-14', rows: [
        { itemId: 'i1', code: 'IT-1', name: { ar: 'سمنت', en: 'Cement', ku: 'چیمەنتۆ' }, qtyMilli: 10_000, sales: 1_310_000, cost: 1_048_000, profit: 262_000 }
      ] }
    };
    const report = (show: AmountsShow | null) => plain(render(<MoreReports tab="profit" />, { data: { seesBooks: true }, ...(show ? { dual: source(show) } : {}) }));
    const before = report(null);
    expect(report('iqd')).toBe(before);
    expect(before).not.toContain('≈');
    const both = report('iqd_usd');
    expect(both).toContain('Totals 1,310,000 IQD ≈ $1,000.00 1,048,000 IQD ≈ $800.00 262,000 IQD ≈ $200.00');
    // the rows keep one figure each; the totals carry the second (and the note under the report says what ≈ is)
    expect(both).toContain('Figures marked ≈ are in the other currency');
    expect(both.split('≈').length - 1).toBe(3 + 1);
    expect(report('usd_iqd')).toContain('Totals ≈ $1,000.00 1,310,000 IQD ≈ $800.00 1,048,000 IQD ≈ $200.00 262,000 IQD');
  });
});

describe('after the second review', () => {
  // the board: 1,310 entered on 2026-11-14 and nothing before 2026-11-01; the company's usual rate is 1,420
  const board = async (d: string) => (d >= '2026-11-01' ? { source: 'board', date: '2026-11-14', rateX100: 131_000 } : { source: 'default', date: null, rateX100: 142_000 });
  const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });

  it('a paper dated before the first rate on the board uses the same rate as the screen (today\'s), not the usual rate', async () => {
    expect(await boardRate(board, '2026-10-01', '2026-11-15')).toEqual({ rateX100: 131_000, date: '2026-11-14', today: true });
    expect(await paperRateX100(board, '2026-10-01', '2026-11-15', 142_000)).toBe(131_000);
    // the screen: the same board read whole (1,310 entered on 2026-11-14)
    const screen = rateFromBoard(boardOf([{ date: '2026-11-14', rateX100: 131_000 }]), '2026-10-01', '2026-11-15');
    expect(screen?.rateX100).toBe(await paperRateX100(board, '2026-10-01', '2026-11-15', 142_000));
    // no rate on the board at all, or the board cannot be read: the paper keeps the usual rate (the screen shows no ≈)
    expect(await paperRateX100(async () => ({ source: 'default', date: null, rateX100: 142_000 }), '2026-10-01', '2026-11-15', 142_000)).toBe(142_000);
    expect(await paperRateX100(() => Promise.reject(new Error('offline')), '2026-10-01', '2026-11-15', 142_000)).toBe(142_000);
  });

  it('does not keep a failed read of the rate board: it reads again after a short pause; a board with no rate stays known', async () => {
    const written: Board[] = [];
    let fail = true;
    let reads = 0;
    const read = boardReader(async () => {
      reads += 1;
      if (fail) throw new Error('offline');
      return [{ date: '2026-11-14', rateX100: 131_000 }];
    }, (b) => { written.push(b); }, { retryMs: 100 });
    read();
    await tick();
    // the failure is no answer: nothing written (the amounts stay "being read", not "no rate")
    expect(written).toEqual([]);
    // within the pause a render does not ask again
    read();
    await tick();
    expect(reads).toBe(1);
    fail = false;
    await new Promise((resolve) => { setTimeout(resolve, 250); });
    expect(written).toEqual([[{ date: '2026-11-14', rateX100: 131_000 }]]);
    expect(rateFromBoard(written[0]!, '2026-11-15', '2026-11-15')).toEqual({ rateX100: 131_000, date: '2026-11-14', today: false });
    // a board with no rate: read once and kept (every day has no rate)
    const none: Board[] = [];
    let calls = 0;
    const empty = boardReader(async () => { calls += 1; return []; }, (b) => { none.push(b); }, { retryMs: 5 });
    empty();
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    empty();
    await tick();
    expect(none).toEqual([[]]);
    expect(calls).toBe(1);
    // a reader no longer in use stops asking
    let alive = true;
    let tries = 0;
    const gone = boardReader(async () => { tries += 1; throw new Error('offline'); }, () => {}, { retryMs: 5, alive: () => alive });
    gone();
    await tick();
    alive = false;
    await new Promise((resolve) => { setTimeout(resolve, 40); });
    expect(tries).toBe(1);
  });

  it('the ageing report: each row from its real dinars and dollars, then the ≈ whole, like its totals row', () => {
    now.answers = { aging: { date: '2026-11-14', type: 'customer', rows: [
      { partyId: 'p1', code: 'C1', name: 'Las', phone: '', balance: 3_298_000, oldestDays: 40, buckets: [0, 3_298_000, 0, 0], owed: { IQD: 1_310_000, USD: 140_000 } },
      { partyId: 'p2', code: 'C2', name: 'Raz', phone: '', balance: 262_000, oldestDays: 10, buckets: [262_000, 0, 0, 0], owed: { IQD: 262_000, USD: 0 } }
    ] } };
    const report = (show: AmountsShow | null) => plain(render(<MoreReports tab="aging" />, { data: { seesBooks: true }, ...(show ? { dual: source(show) } : {}) }));
    const both = report('iqd_usd');
    expect(both).toContain('1,310,000 IQD + $1,400.00 ≈ $2,400.00');
    expect(both).toContain('262,000 IQD ≈ $200.00');
    // the row's book-rate figure is not converted again
    expect(both).not.toContain('3,298,000 IQD ≈');
    // the totals row: 1,572,000 IQD + $1,400 ≈ $2,600
    expect(both).toContain('1,572,000 IQD + $1,400.00 ≈ $2,600.00');
    // dinar only: the rows' book-rate totals, as before
    const before = report(null);
    expect(report('iqd')).toBe(before);
    expect(before).toContain('3,298,000 IQD');
    expect(before).not.toContain('≈');
    expect(before).not.toContain('$1,400.00');
  });

  it('against an office server that keeps no such choice: the choice can\'t be changed, and a note says why', () => {
    const company = { companyName: { ar: '', en: '', ku: '' }, defaultRateX100: 131000, fiscalYearStart: '01-01', businessTypes: [] };
    const old = render(<AmountsShowSetting />, { data: { settings: company } });
    expect(old).toMatch(/aria-checked="true"[^>]*>(?:(?!aria-checked).)*Dinar only/);
    expect(old).toContain('aria-disabled="true"');
    expect(old).toContain('Update Qasa ERP on the office server PC to change this');
    for (const lang of ['ar', 'ku'] as const) expect(render(<AmountsShowSetting />, { lang, data: { settings: company } })).toContain(AMOUNTS_TEXT.am_oldServer[lang === 'ar' ? 0 : 2]);
    const current = render(<AmountsShowSetting />, { data: { settings: { ...company, amountsShow: 'iqd' } } });
    expect(current).not.toContain('aria-disabled="true"');
    expect(current).not.toContain('Update Qasa ERP');
  });

  it('the dashboard, the brief and the end of day convert at the rate of the server\'s day, not the browser\'s', () => {
    const asked: (string | undefined)[] = [];
    const spy: DualSource = { show: 'iqd_usd', canSet: true, rate: (date) => { asked.push(date); return RATE; } };
    const admin: NavViewer = { admin: true, permissions: ['admin'], businessTypes: [] };
    // the server's day is 2026-10-20 (the dashboard is as of it), whatever this PC's clock says
    now.answers = { dashboard: {
      date: '2026-10-20', salesMonth: 1_310_000, salesLastMonth: 0, receivables: 262_000, payables: 0, receivablesOwed: { IQD: 262_000, USD: 0 },
      payablesOwed: { IQD: 0, USD: 0 }, cash: { total: { IQD: 655_000, USD: 0 }, base: 655_000 }, months: [{ month: '2026-10', sales: 1_310_000 }]
    } as DashboardView, entries: [], invoices: [], parties: [] };
    render(<Home viewer={admin} user="Mer" favourites={[]} />, { data: { permissions: ['admin'] }, dual: spy });
    expect(asked.length).toBeGreaterThan(0);
    expect(new Set(asked)).toEqual(new Set(['2026-10-20']));
    for (const node of [<DualNote date="2026-10-20" />, <DualRateHint date="2026-10-20" />]) {
      asked.length = 0;
      render(node, { dual: spy });
      expect(asked).toEqual(['2026-10-20']);
    }
  });
});

describe('the lists and the money screens that showed dinars only', () => {
  const en = i18nOf('en');
  const admin = { permissions: ['admin'] };
  /** The page as text, with dinar only (no source: the app's default), or in one of the three choices. */
  const shown = (node: ReactNode, show: AmountsShow | null, data: object = admin) => plain(render(node, { data, ...(show ? { dual: source(show) } : {}) }));
  /** The days whose rate a page asked for. */
  const daysAsked = (node: ReactNode, data: object = admin) => {
    const asked = new Set<string | undefined>();
    render(node, { data, dual: { show: 'iqd_usd', canSet: true, rate: (date) => { asked.add(date); return RATE; } } });
    return asked;
  };

  it('a document\'s amount: a dinar amount as the company chose, a dollar one as it is (its dinars are on the document), nothing when not sent', () => {
    expect(render(<DocAmount value={1_310_000} currency="IQD" date="2026-11-14" />)).toBe('1,310,000 IQD');
    expect(render(<DocAmount value={1_310_000} currency="IQD" date="2026-11-14" />, { dual: source('iqd') })).toBe('1,310,000 IQD');
    expect(plain(render(<DocAmount value={1_310_000} currency="IQD" date="2026-11-14" />, { dual: source('iqd_usd') }))).toBe(' 1,310,000 IQD ≈ $1,000.00 ');
    expect(plain(render(<DocAmount value={1_310_000} currency="IQD" date="2026-11-14" />, { dual: source('usd_iqd') }))).toBe(' ≈ $1,000.00 1,310,000 IQD ');
    expect(render(<DocAmount value={50_000} currency="USD" date="2026-11-14" />, { dual: source('usd_iqd') })).toBe('$500.00');
    expect(render(<DocAmount value={undefined} currency="IQD" />, { dual: source('iqd_usd') })).toBe('');
    // a document dated before the first rate on the board: the latest rate, and the tooltip says so
    expect(render(<DocAmount value={1_310_000} currency="IQD" date="2026-10-20" />, { dual: source('iqd_usd') })).toContain('No rate was entered for that date');
  });

  const invoice = (over: Partial<InvoiceSummary> = {}): InvoiceSummary => ({
    id: 'v1', kind: 'sale', status: 'posted', number: 'INV-2026-0001', date: '2026-11-14', partyId: 'p1', partyCode: 'C1', partyName: 'Las',
    warehouseId: 'w1', currency: 'IQD', rateX100: 100, payment: 'credit', cashAccountCode: null, discount: 0, subtotal: 1_310_000,
    total: 1_310_000, baseTotal: 1_310_000, notes: '', returnOf: null, createdBy: 'Mer', createdAt: '', ...over
  });

  it('the sales and purchase lists: a dinar invoice\'s total due with ≈ at the rate of its date, a dollar one as it is', () => {
    const list = [invoice(), invoice({ id: 'v2', number: 'INV-2026-0002', currency: 'USD', rateX100: 142_000, subtotal: 50_000, total: 50_000, baseTotal: 710_000 })];
    const before = shown(<InvoicesTable invoices={list} />, null);
    expect(shown(<InvoicesTable invoices={list} />, 'iqd')).toBe(before);
    expect(before).toContain('1,310,000 IQD');
    expect(before).toContain('$500.00');
    expect(before).not.toContain('≈');
    const both = shown(<InvoicesTable invoices={list} />, 'iqd_usd');
    expect(both).toContain('1,310,000 IQD ≈ $1,000.00');
    expect(both).toContain('$500.00');
    expect(both).not.toContain('$500.00 ≈');
    expect(shown(<InvoicesTable invoices={list} />, 'usd_iqd')).toContain('≈ $1,000.00 1,310,000 IQD');
    // each at the rate of its own date, as on the invoice's page
    expect(daysAsked(<InvoicesTable invoices={[invoice({ date: '2026-10-20' }), invoice({ id: 'v3', date: '2026-11-03' })]} />)).toEqual(new Set(['2026-10-20', '2026-11-03']));
    // purchases sent without their money (to someone who may not read the books): no total column, as before
    const unpriced = render(<InvoicesTable invoices={[{ ...invoice({ kind: 'purchase' }), total: undefined } as unknown as InvoiceSummary]} />, { dual: source('iqd_usd') });
    expect(unpriced).not.toContain(en.t('totalDue'));
    expect(unpriced).not.toContain('≈');
  });

  const entry = (over: Partial<EntrySummary> = {}): EntrySummary => ({
    id: 'e1', type: 'receipt', number: 'RV-2026-0001', date: '2026-11-14', description: 'Payment for INV-2026-0001', party: 'Raz', currency: 'IQD',
    rateX100: 100, status: 'approved', cashAccountCode: '1811', reversesId: null, reversedById: null, preparedBy: 'Mer', preparedAt: '',
    checkedBy: null, checkedAt: null, approvedBy: 'Mer', approvedAt: '', total: 262_000, baseTotal: 262_000, ...over
  });

  it('the vouchers list: a dinar voucher\'s amount with ≈ at the rate of its date, a dollar one as it is', () => {
    const list = [entry(), entry({ id: 'e2', type: 'payment', number: 'PV-2026-0001', currency: 'USD', rateX100: 131_000, total: 10_000, baseTotal: 13_100 })];
    const before = shown(<EntriesTable entries={list} />, null);
    expect(shown(<EntriesTable entries={list} />, 'iqd')).toBe(before);
    expect(before).toContain('262,000 IQD');
    expect(before).not.toContain('≈');
    const both = shown(<EntriesTable entries={list} />, 'iqd_usd');
    expect(both).toContain('262,000 IQD ≈ $200.00');
    expect(both).toContain('$100.00');
    expect(both).not.toContain('$100.00 ≈');
    expect(daysAsked(<EntriesTable entries={[entry({ date: '2026-10-20' })]} />)).toEqual(new Set(['2026-10-20']));
  });

  const quote = {
    id: 'q1', number: 'QT-2026-0001', date: '2026-11-14', validUntil: '2026-11-29', party: { id: 'p1', code: 'C1', name: 'Las', phone: '', address: '' },
    customerName: 'Las', currency: 'IQD', subtotal: 1_310_000, discount: 0, total: 1_310_000, status: 'sent', expired: false, invoice: null,
    lines: [{ seq: 1, itemId: null, itemCode: null, description: 'Cement', qtyMilli: 1000, unitPrice: 1_310_000, amount: 1_310_000 }],
    notes: '', terms: '', createdBy: 'Mer', createdAt: '', actions: []
  } as QuoteView;

  it('quotations: the list\'s total and the quotation\'s total due, like an invoice\'s', () => {
    now.answers = { list: [quote, { ...quote, id: 'q2', number: 'QT-2026-0002', currency: 'USD', subtotal: 50_000, total: 50_000 }] };
    const before = shown(<Quotes />, null);
    expect(before).toContain('1,310,000 IQD');
    expect(before).not.toContain('≈');
    const list = shown(<Quotes />, 'iqd_usd');
    expect(list).toContain('1,310,000 IQD ≈ $1,000.00');
    expect(list).not.toContain('$500.00 ≈');
    now.answers = { get: quote };
    expect(shown(<QuoteDetail id="q1" />, null)).not.toContain('≈');
    expect(shown(<QuoteDetail id="q1" />, 'iqd_usd')).toContain(`${en.t('totalDue')} 1,310,000 IQD ≈ $1,000.00`);
    expect(daysAsked(<QuoteDetail id="q1" />)).toEqual(new Set(['2026-11-14']));
  });

  const order = {
    id: 'o1', number: 'PO-2026-0001', date: '2026-11-14', party: { id: 's1', code: 'S1', name: 'Raz', phone: null, address: null }, warehouse: null,
    currency: 'IQD', expectedDate: null, status: 'sent', overdue: false, notes: '', total: 1_310_000,
    lines: [{ seq: 1, itemId: 'i1', itemCode: 'IT-1', itemName: { ar: 'سمنت', en: 'Cement', ku: 'چیمەنتۆ' }, unit: 'piece', qtyMilli: 1000, unitPrice: 1_310_000, amount: 1_310_000, receivedMilli: 0, remainingMilli: 1000, lineUnit: null, unitFactorMilli: null, unitQtyMilli: null }],
    receipts: [], createdBy: 'Mer', createdAt: '', actions: []
  } as PoView;

  it('purchase orders: the list\'s total, and the order\'s total on the screen; the printed order keeps its own currency only', () => {
    const summary = (o: PoView): PoSummaryView => ({ id: o.id, number: o.number, date: o.date, partyId: o.party.id, partyName: o.party.name, currency: o.currency, expectedDate: null, status: o.status, overdue: false, total: o.total });
    now.answers = { list: [summary(order), summary({ ...order, id: 'o2', number: 'PO-2026-0002', currency: 'USD', total: 50_000 })] };
    const before = shown(<PurchaseOrders />, null);
    expect(before).toContain('1,310,000 IQD');
    expect(before).not.toContain('≈');
    const list = shown(<PurchaseOrders />, 'iqd_usd');
    expect(list).toContain('1,310,000 IQD ≈ $1,000.00');
    expect(list).not.toContain('$500.00 ≈');
    now.answers = { get: order };
    expect(shown(<PurchaseOrderDetail id="o1" />, null)).not.toContain('≈');
    const html = render(<PurchaseOrderDetail id="o1" />, { data: admin, dual: source('iqd_usd') });
    // on the screen with ≈; on paper (print-only) the dinars alone, as an order always printed
    expect(html).toMatch(/<span class="no-print"><span class="dual">(?:(?!<\/strong>).)*≈ \$1,000\.00(?:(?!<\/strong>).)*<\/span><span class="print-only">1,310,000 IQD<\/span><\/strong>/);
    expect(daysAsked(<PurchaseOrderDetail id="o1" />)).toEqual(new Set(['2026-11-14']));
  });

  it('safes and banks: the total in dinars at the booked rates as before; with a rate, the real dinars and dollars and their whole, as on the home page', () => {
    const accounts: MoneyAccountView[] = [
      { code: '1811', name: { ar: 'القاصة', en: 'Main safe', ku: 'قاسە' }, kind: 'safe', currency: null, balance: { IQD: 655_000, USD: 0 }, base: 655_000, pending: 0 },
      // $500 booked at 1,420
      { code: '1821', name: { ar: 'المصرف', en: 'Bank', ku: 'بانک' }, kind: 'bank', currency: 'USD', balance: { IQD: 0, USD: 50_000 }, base: 710_000, pending: 0 }
    ];
    now.answers = { accounts: { accounts, reconciliation: false } };
    const total = en.t('total');
    const inBase = en.t('bk_inBase');
    const before = shown(<Banking />, null);
    expect(shown(<Banking />, 'iqd')).toBe(before);
    expect(before).toContain(`${total} 1,365,000 IQD ${inBase}`);
    expect(before).not.toContain('≈');
    const both = shown(<Banking />, 'iqd_usd');
    // each dollar converted once ($500 + 655,000 / 1,310), never the book-rate 1,365,000 converted again ($1,041.98)
    expect(both).toContain(`${total} 655,000 IQD + $500.00 ≈ $1,000.00`);
    expect(both).not.toContain('$1,041.98');
    expect(both).not.toContain(inBase);
    expect(shown(<Banking />, 'usd_iqd')).toContain(`${total} $500.00 + 655,000 IQD ≈ 1,310,000 IQD`);
    // no rate on the board: the book total and what it is, as before
    expect(plain(render(<Banking />, { data: admin, dual: source('iqd_usd', 'none') }))).toContain(`${total} 1,365,000 IQD ${inBase}`);
  });

  it('receive payment: the balance before and what is left after with ≈, as in the customers list; never dollars shown at the book rates', () => {
    const party = (balances: { IQD: number; USD: number }, balance: number): PartyView => ({
      id: 'p1', type: 'customer', code: 'C1', name: 'Las', phone: '', address: '', accountCode: '1611', creditLimit: null, notes: '', active: true,
      hasEntries: true, balance, balances
    });
    // for an invoice with 262,000 IQD open on it
    const form = (show: AmountsShow | null) => shown(
      <QuickVoucherForm kind="receipt" preset={{ partyId: 'p1', invoice: { id: 'v1', number: 'INV-2026-0001', open: 262_000, currency: 'IQD', rateX100: 100 } }} onClose={() => {}} onDone={() => {}} />,
      show
    );
    const [beforeLabel, afterLabel] = [en.t('s14_balanceBefore'), en.t('s14_balanceAfter')];
    now.answers = { party: party({ IQD: 1_310_000, USD: 0 }, 1_310_000) };
    const plainForm = form(null);
    expect(form('iqd')).toBe(plainForm);
    expect(plainForm).toContain(`${beforeLabel} 1,310,000 IQD ${afterLabel} 1,048,000 IQD`);
    expect(form('iqd_usd')).toContain(`${beforeLabel} 1,310,000 IQD ≈ $1,000.00 ${afterLabel} 1,048,000 IQD ≈ $800.00`);
    expect(form('usd_iqd')).toContain(`${beforeLabel} ≈ $1,000.00 1,310,000 IQD`);
    // owes $1,400 only, booked at 1,420: the form in dinars shows 1,988,000 IQD at the book rates, never "≈ $1,517.56"
    now.answers = { party: party({ IQD: 0, USD: 140_000 }, 1_988_000) };
    const dollars = form('iqd_usd');
    expect(dollars).toContain(`${beforeLabel} 1,988,000 IQD`);
    expect(dollars).not.toContain('≈');

    const rule = (p: PartyView, currency: 'IQD' | 'USD') => formBalanceDual(p, formBalance(p, currency));
    expect(rule(party({ IQD: 1_310_000, USD: 0 }, 1_310_000), 'IQD')).toBe(true);
    // dinars and dollars on the same side: the dinars alone (the dollars beside them, as they are)
    expect(rule(party({ IQD: 1_310_000, USD: 140_000 }, 3_298_000), 'IQD')).toBe(true);
    expect(rule(party({ IQD: 1_310_000, USD: 140_000 }, 3_298_000), 'USD')).toBe(false);
    // a dollar invoice paid partly in dinars: the one position in IQD, converted as the customers list does
    expect(rule(party({ IQD: -1_000_000, USD: 140_000 }, 988_000), 'IQD')).toBe(true);
    expect(rule(party({ IQD: 0, USD: 140_000 }, 1_988_000), 'IQD')).toBe(false);
    expect(rule(party({ IQD: 0, USD: 140_000 }, 1_988_000), 'USD')).toBe(false);
    // a server that sends only the total
    expect(formBalanceDual({}, { currency: 'IQD' })).toBe(true);
  });
});
