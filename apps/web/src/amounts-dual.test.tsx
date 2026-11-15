import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LTR_ISOLATE_END, LTR_ISOLATE_START, stripBidiIsolates, type AmountsShow, type Lang } from '@qasa/core';
import { DataContext } from './components.tsx';
import { I18nContext, makeI18n } from './i18n.ts';
import { AMOUNTS_TEXT } from './i18n/amounts.ts';
import { Amount, amountTextOf, boardRate, DualContext, DualNote, DualRateHint, dualRateTitle, dualText, OwedTotal, paperRateX100, rateReader, type DualRate, type DualSource } from './Amount.tsx';
import type { BriefView, DashboardView, DayCloseView } from './industry/brief-api.ts';
import type { NavViewer } from './nav.ts';
import { compact, Home } from './pages/Home.tsx';
import { briefText } from './pages/Brief.tsx';
import { dayCloseText } from './pages/DayClose.tsx';
import { Parties } from './pages/Parties.tsx';
import { MoreReports } from './pages/MoreReports.tsx';
import { AmountsShowSetting } from './pages/Settings.tsx';
import { TillEquivalent } from './pages/Pos.tsx';

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

  it('reads each day\'s rate once and writes every day it read, the day a lookup fell back to as well', async () => {
    const written = new Map<string, DualRate | null>();
    const asked: string[] = [];
    const read = rateReader(async (d) => {
      asked.push(d);
      return d >= '2026-11-01' ? { source: 'board', date: '2026-11-14', rateX100: 131_000 } : { source: 'default', date: null, rateX100: 142_000 };
    }, (d, r) => { written.set(d, r); });
    // an invoice dated before every rate on the board: today's rate stands in, and today is known too
    read('2026-10-01', '2026-11-15');
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(written.get('2026-10-01')).toEqual({ rateX100: 131_000, date: '2026-11-14', today: true });
    expect(written.get('2026-11-15')).toEqual({ rateX100: 131_000, date: '2026-11-14', today: false });
    read('2026-11-15', '2026-11-15');
    read('2026-10-01', '2026-11-15');
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(asked).toEqual(['2026-10-01', '2026-11-15']);
    // no rate on the board at all: null, written for both days
    const none = new Map<string, DualRate | null>();
    const empty = rateReader(async () => ({ source: 'default', date: null, rateX100: 142_000 }), (d, r) => { none.set(d, r); });
    empty('2026-10-01', '2026-11-15');
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect([...none]).toEqual([['2026-11-15', null], ['2026-10-01', null]]);
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
    // a server from before 1.5 sends no choice: dinar only
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
    const screen = new Map<string, DualRate | null>();
    rateReader(board, (d, r) => { screen.set(d, r); })('2026-10-01', '2026-11-15');
    await tick();
    expect(screen.get('2026-10-01')?.rateX100).toBe(await paperRateX100(board, '2026-10-01', '2026-11-15', 142_000));
    // no rate on the board at all, or the board cannot be read: the paper keeps the usual rate (the screen shows no ≈)
    expect(await paperRateX100(async () => ({ source: 'default', date: null, rateX100: 142_000 }), '2026-10-01', '2026-11-15', 142_000)).toBe(142_000);
    expect(await paperRateX100(() => Promise.reject(new Error('offline')), '2026-10-01', '2026-11-15', 142_000)).toBe(142_000);
  });

  it('does not keep a failed rate request: it asks again after a short pause; a real "no rate" stays known', async () => {
    const written = new Map<string, DualRate | null>();
    let fail = true;
    const asked: string[] = [];
    const read = rateReader(async (d) => {
      asked.push(d);
      if (fail) throw new Error('offline');
      return board(d);
    }, (d, r) => { written.set(d, r); }, { retryMs: 100 });
    read('2026-11-15', '2026-11-15');
    await tick();
    // the failure is no answer: nothing written (the amount stays "being read", not "no rate")
    expect(written.has('2026-11-15')).toBe(false);
    // within the pause a render does not ask again
    read('2026-11-15', '2026-11-15');
    await tick();
    expect(asked).toEqual(['2026-11-15']);
    fail = false;
    await new Promise((resolve) => { setTimeout(resolve, 250); });
    expect(written.get('2026-11-15')).toEqual({ rateX100: 131_000, date: '2026-11-14', today: false });
    // a board with no rate: null, asked once and kept
    const none = new Map<string, DualRate | null>();
    const calls: string[] = [];
    const empty = rateReader(async (d) => { calls.push(d); return { source: 'default', date: null, rateX100: 142_000 }; }, (d, r) => { none.set(d, r); }, { retryMs: 5 });
    empty('2026-11-15', '2026-11-15');
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    empty('2026-11-15', '2026-11-15');
    await tick();
    expect(none.get('2026-11-15')).toBe(null);
    expect(calls).toEqual(['2026-11-15']);
    // a reader no longer in use stops asking
    let alive = true;
    const tries: string[] = [];
    const gone = rateReader(async (d) => { tries.push(d); throw new Error('offline'); }, () => {}, { retryMs: 5, alive: () => alive });
    gone('2026-11-15', '2026-11-15');
    await tick();
    alive = false;
    await new Promise((resolve) => { setTimeout(resolve, 40); });
    expect(tries).toEqual(['2026-11-15']);
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
