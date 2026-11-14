import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LTR_ISOLATE_END, LTR_ISOLATE_START, stripBidiIsolates, type AmountsShow, type Lang } from '@qasa/core';
import { DataContext } from './components.tsx';
import { I18nContext, makeI18n } from './i18n.ts';
import { AMOUNTS_TEXT } from './i18n/amounts.ts';
import { Amount, DualContext, DualRateHint, dualRateTitle, dualText, type DualRate, type DualSource } from './Amount.tsx';
import type { DashboardView } from './industry/brief-api.ts';
import type { NavViewer } from './nav.ts';
import { Home } from './pages/Home.tsx';
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
    date: '2026-11-14', salesMonth: 1_310_000, salesLastMonth: 1_000_000, receivables: 655_000, payables: 262_000,
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
  });

  it('dinar and dollar: each tile also in dollars; the cash keeps its real dollars and adds the whole', () => {
    const html = plain(home('iqd_usd'));
    expect(html).toContain('1,310,000 IQD ≈ $1,000.00'); // sales this month
    expect(html).toContain('655,000 IQD ≈ $500.00'); // receivables
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
    expect(home('iqd_usd', 'ar')).toContain(`≈ ${LTR_ISOLATE_START}$500.00${LTR_ISOLATE_END}`);
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
    // the rows keep one figure each; the totals carry the second
    expect(both.split('≈').length - 1).toBe(3);
    expect(report('usd_iqd')).toContain('Totals ≈ $1,000.00 1,310,000 IQD ≈ $800.00 1,048,000 IQD ≈ $200.00 262,000 IQD');
  });
});
