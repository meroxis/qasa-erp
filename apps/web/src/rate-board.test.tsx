import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { addDays } from '@qasa/core';
import { DataContext } from './components.tsx';
import { I18nContext, makeI18n } from './i18n.ts';
import { boardOf, boardRate, boardSource, DualContext, DualProvider, rateFromBoard, type BoardEntry, type DualRate, type DualSource, type RateOn } from './Amount.tsx';
import type { InvoiceSummary } from './api.ts';
import { InvoicesTable } from './pages/Parties.tsx';
import { fxApi } from './industry/fx-api.ts';

// Dinar and dollar on long lists (1.4.3): the screens read the whole rate board once and work out each date's rate
// from it, by the same rule as asking the server for each date (boardRate), which 1.4.2 did once per date shown.

vi.mock('./industry/fx-api.ts', () => ({
  fxApi: { rates: vi.fn(async () => [] as BoardEntry[]), rateOn: vi.fn(async () => { throw new Error('asked for one day'); }) }
}));

const TODAY = '2026-11-15';
/** The company's usual rate, which the server gives for a day before every rate on the board ('default'). */
const USUAL = 142_000;

/** The server's rateOn (packages/server/src/fx.ts) on a list of rates: the latest entered on or before the day, else the usual rate. */
const serverRateOn = (rates: readonly BoardEntry[]): RateOn => async (day) => {
  const r = [...rates].filter((x) => x.date <= day).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return r ? { source: 'board', date: r.date, rateX100: r.rateX100 } : { source: 'default', date: null, rateX100: USUAL };
};

/** Every day from `from` to `to`. */
const daysFrom = (from: string, to: string) => {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
};

const en = makeI18n('en', 'western', () => {}, () => {});
const render = (node: ReactNode, dual?: DualSource) => renderToStaticMarkup(
  <I18nContext.Provider value={en}>
    <DataContext.Provider value={{ accounts: [], settings: null, plan: null, online: true, reloadAccounts: async () => {}, reloadSettings: async () => {}, reloadPlan: async () => {} } as never}>
      {dual ? <DualContext.Provider value={dual}>{node}</DualContext.Provider> : node}
    </DataContext.Provider>
  </I18nContext.Provider>
);

describe('each date\'s rate from the rate board read once', () => {
  const boards: Record<string, BoardEntry[]> = {
    // a rate now and then, and one entered as 0 (the app can't convert with it: today's stands in after it, as before)
    usual: [{ date: '2026-09-10', rateX100: 128_500 }, { date: '2026-10-01', rateX100: 130_000 }, { date: '2026-10-20', rateX100: 0 }, { date: '2026-11-14', rateX100: 131_000 }],
    empty: [],
    // a rate dated after today (the server's clock was ahead when it was entered)
    ahead: [{ date: '2026-11-01', rateX100: 131_000 }, { date: '2026-11-20', rateX100: 133_000 }],
    // today's latest rate unusable: a day before every rate has none
    unusableToday: [{ date: '2026-10-01', rateX100: 130_000 }, { date: '2026-11-15', rateX100: -5 }]
  };

  it('gives every day the same answer as asking the server for that day (1.4.2\'s way)', async () => {
    for (const [name, rates] of Object.entries(boards)) {
      // newest first, as the server lists them
      const board = boardOf([...rates].reverse());
      for (const day of daysFrom('2026-08-25', '2026-11-25')) {
        expect(rateFromBoard(board, day, TODAY), `${name} ${day}`).toEqual(await boardRate(serverRateOn(rates), day, TODAY));
      }
    }
    // the cases the rule has: on or after a rate, before every rate (today's, marked), after an unusable rate, no rate
    const usual = boardOf(boards.usual!);
    expect(rateFromBoard(usual, '2026-10-05', TODAY)).toEqual({ rateX100: 130_000, date: '2026-10-01', today: false });
    expect(rateFromBoard(usual, '2026-09-01', TODAY)).toEqual({ rateX100: 131_000, date: '2026-11-14', today: true });
    expect(rateFromBoard(usual, '2026-10-25', TODAY)).toEqual({ rateX100: 131_000, date: '2026-11-14', today: true });
    expect(rateFromBoard(boardOf([]), TODAY, TODAY)).toBe(null);
  });

  it('shows a list of 500 invoices over 300 days with the same figures as asking for each date', async () => {
    // a rate every 9 days from March, one of them entered as 0; invoices from January, before every rate
    const rates: BoardEntry[] = daysFrom('2026-03-01', TODAY).filter((_, i) => i % 9 === 0).map((date, i) => ({ date, rateX100: i === 7 ? 0 : 129_000 + i * 25 }));
    const invoices: InvoiceSummary[] = Array.from({ length: 500 }, (_, i) => ({
      id: `v${i}`, kind: 'sale', status: 'posted', number: `INV-2026-${String(i + 1).padStart(4, '0')}`, date: addDays(TODAY, -(i % 300)),
      partyId: 'p1', partyCode: 'C1', partyName: i % 3 ? 'Las' : 'Raz', warehouseId: 'w1', currency: i % 10 === 9 ? 'USD' : 'IQD',
      rateX100: i % 10 === 9 ? 131_000 : 100, payment: 'credit', cashAccountCode: null, discount: 0, subtotal: 1_000 * (i + 1) * 131,
      total: 1_000 * (i + 1) * 131, baseTotal: 1_000 * (i + 1) * 131, notes: '', returnOf: null, createdBy: 'Mer', createdAt: ''
    }));
    expect(new Set(invoices.map((v) => v.date)).size).toBe(300);
    // as 1.4.2 showed them: each date's rate asked of the server
    const asked = new Map<string, DualRate | null>();
    for (const day of new Set([...invoices.map((v) => v.date), TODAY])) asked.set(day, await boardRate(serverRateOn(rates), day, TODAY));
    for (const show of ['iqd_usd', 'usd_iqd'] as const) {
      const before = render(<InvoicesTable invoices={invoices} />, { show, canSet: true, rate: (date) => asked.get(date || TODAY) });
      let asks = 0;
      const now = render(<InvoicesTable invoices={invoices} />, boardSource(show, true, boardOf([...rates].reverse()), () => { asks += 1; }, () => TODAY));
      expect(now).toBe(before);
      expect(asks).toBe(0);
      // (every dinar invoice has its ≈ line: the board has a rate for today)
      expect(now.split('dual-second').length - 1).toBe(450);
    }
  });

  it('answers a day the same on every call, reads the board while it has none, and asks nothing with dinar only', () => {
    const board = boardOf(boards.usual!);
    const read = boardSource('iqd_usd', true, board, () => { throw new Error('read again'); }, () => TODAY);
    expect(read.rate('2026-10-05')).toBe(read.rate('2026-10-05'));
    expect(read.rate()).toEqual({ rateX100: 131_000, date: '2026-11-14', today: false });
    // a day the server would refuse (not written as one): no rate shown, nothing asked
    expect(read.rate('15/11/2026')).toBe(undefined);
    let asks = 0;
    const waiting = boardSource('iqd_usd', true, null, () => { asks += 1; }, () => TODAY);
    expect(waiting.rate('2026-10-05')).toBe(undefined);
    expect(waiting.rate()).toBe(undefined);
    expect(asks).toBe(2);
    expect(boardSource('iqd', true, null, () => { asks += 1; }).rate('2026-10-05')).toBe(null);
    expect(asks).toBe(2);
  });

  it('the app\'s source asks the server for the whole board once for a long list, never one date at a time', () => {
    const invoices = Array.from({ length: 120 }, (_, i) => ({
      id: `v${i}`, kind: 'sale', status: 'posted', number: `INV-${i}`, date: addDays(TODAY, -i), partyId: 'p1', partyCode: 'C1', partyName: 'Las',
      warehouseId: 'w1', currency: 'IQD', rateX100: 100, payment: 'credit', cashAccountCode: null, discount: 0, subtotal: 131_000, total: 131_000,
      baseTotal: 131_000, notes: '', returnOf: null, createdBy: 'Mer', createdAt: ''
    }) as InvoiceSummary);
    const shown = (show: 'iqd' | 'iqd_usd') => render(<DualProvider show={show} canSet watch=""><InvoicesTable invoices={invoices} /></DualProvider>);
    vi.mocked(fxApi.rates).mockClear();
    shown('iqd');
    expect(fxApi.rates).not.toHaveBeenCalled();
    shown('iqd_usd');
    expect(fxApi.rates).toHaveBeenCalledTimes(1);
    // every rate entered, also one dated after the server's today
    expect(fxApi.rates).toHaveBeenCalledWith({ to: '9999-12-31' });
    expect(fxApi.rateOn).not.toHaveBeenCalled();
  });
});
