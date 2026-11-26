import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nContext, makeI18n } from '../i18n.ts';
import type { CashMoves, ShiftReport, ShiftView } from '../industry/pos-api.ts';
import type { DayCloseView } from '../industry/brief-api.ts';
import { CashMoveList, cashMoveSums, cashMoveType, hasCashMoves } from './CashMoves.tsx';
import { ShiftPaper } from './ShiftReport.tsx';
import { CloseShift } from './CloseShift.tsx';
import { dayCloseRows } from '../pages/DayClose.tsx';
import { tillPart } from '../till-source.ts';

// 2.0: the other cash on a till's safe (a supplier or an expense paid out of the drawer, a debt collected into it):
// on the close dialog, the X/Z report and the day close, in the three languages; nothing of it on a blind close.

const i18nOf = (lang: 'ar' | 'en' | 'ku') => makeI18n(lang, 'western', () => {}, () => {});
const wrap = (node: ReactNode, lang: 'ar' | 'en' | 'ku' = 'en') => renderToStaticMarkup(<I18nContext.Provider value={i18nOf(lang)}>{node}</I18nContext.Provider>);

const moves: CashMoves = {
  in: { IQD: 12_000, USD: 0 }, out: { IQD: 35_000, USD: 2_000 }, count: 4,
  lines: [
    { entryId: 'e1', type: 'purchase', number: 'PI-2026-0007', description: 'Las Trading', currency: 'IQD', amount: -30_000, by: 'Raz', at: '2026-11-22T08:05:00.000Z' },
    { entryId: 'e2', type: 'payment', number: 'PV-2026-0012', description: 'Generator diesel', currency: 'IQD', amount: -5_000, by: 'Raz', at: '2026-11-22T09:10:00.000Z' },
    { entryId: 'e3', type: 'receipt', number: 'RV-2026-0003', description: 'Debt collected', currency: 'IQD', amount: 12_000, by: 'Las', at: '2026-11-22T10:00:00.000Z' },
    { entryId: 'e4', type: 'payment', number: 'PV-2026-0013', description: 'Paid in dollars', currency: 'USD', amount: -2_000, by: 'Mer', at: '2026-11-22T11:00:00.000Z' }
  ]
};
const none: CashMoves = { in: { IQD: 0, USD: 0 }, out: { IQD: 0, USD: 0 }, count: 0, lines: [] };

const shift: ShiftView = {
  id: 's1', number: 'POS-2026-0001', register: 'Counter 1', cashAccountCode: '1811', warehouseId: 'w1', status: 'open', openedBy: 'Raz', openedAt: '2026-11-22T05:00:00.000Z',
  openingCash: 100_000, closedBy: null, closedAt: null, sales: { IQD: 60_000, USD: 0 }, count: 3, refunds: { IQD: 0, USD: 0 }, methods: {},
  expected: { IQD: 137_000, USD: -2_000 }, counted: null, difference: null, notes: '', actions: ['sell', 'close'], cashMoves: moves
};
const report: ShiftReport = { ...shift, invoices: [], items: [] };

describe('the other cash on a till’s safe', () => {
  it('reads as two sums, in and out, each only when there is some', () => {
    const en = i18nOf('en');
    expect(cashMoveSums(en, moves).map((r) => [r.label, r.value])).toEqual([['Other cash in', `+${en.money(12_000, 'IQD')}`], ['Other cash out', `−${en.money(35_000, 'IQD')} · ${en.money(2_000, 'USD')}`]]);
    expect(cashMoveSums(en, { ...moves, in: { IQD: 0, USD: 0 } }).map((r) => r.key)).toEqual(['tu_cashOut']);
    for (const m of [none, undefined, null]) { expect(cashMoveSums(en, m)).toEqual([]); expect(hasCashMoves(m)).toBe(false); }
    expect(hasCashMoves(moves)).toBe(true);
  });

  it('names each kind of document in the three languages (anything else on a safe is a journal entry)', () => {
    for (const lang of ['ar', 'en', 'ku'] as const) {
      const names = ['purchase', 'purchase_return', 'receipt', 'payment', 'reversal', 'journal'].map((type) => cashMoveType(i18nOf(lang), type));
      expect(new Set(names).size, lang).toBe(6);
      expect(cashMoveType(i18nOf(lang), 'something_new'), lang).toBe(cashMoveType(i18nOf(lang), 'journal'));
    }
    expect(cashMoveType(i18nOf('en'), 'payment')).toBe('Payment voucher');
    expect(cashMoveType(i18nOf('ar'), 'receipt')).toBe('سند قبض');
    expect(cashMoveType(i18nOf('ku'), 'purchase')).toBe('پسوولەی کڕین');
  });

  it('lists the documents: what, number, words, who and the signed amount; says how many more there are', () => {
    const html = wrap(<CashMoveList moves={moves} />);
    for (const text of ['Other cash on this safe', 'Purchase invoice', 'PI-2026-0007', 'Generator diesel', 'Las', 'Receipt voucher', 'Counted in the expected cash']) expect(html, text).toContain(text);
    const en = i18nOf('en');
    expect(html).toContain(`−${en.money(30_000, 'IQD')}`);
    expect(html).toContain(`+${en.money(12_000, 'IQD')}`);
    expect(html).toContain(`−${en.money(2_000, 'USD')}`);
    // no link for a cashier; whoever reads the books opens the entry
    expect(html).not.toContain('<a ');
    expect(wrap(<CashMoveList moves={moves} links />)).toContain('entry/e1');
    expect(wrap(<CashMoveList moves={{ ...moves, count: 9 }} />)).toContain('and 5 more');
    expect(wrap(<CashMoveList moves={none} />)).toBe('');
    expect(wrap(<CashMoveList moves={undefined} />)).toBe('');
    expect(wrap(<CashMoveList moves={moves} />, 'ar')).toContain('نقد آخر على هذه القاصة');
    expect(wrap(<CashMoveList moves={moves} />, 'ku')).toContain('نەقدی تر لەسەر ئەم قاسەیە');
  });

  it('is on the X/Z report: the two sums above the expected cash and the documents below', () => {
    const html = wrap(<ShiftPaper r={report} company="Mer Store" />);
    expect(html.indexOf('Other cash out')).toBeGreaterThan(-1);
    expect(html.indexOf('Other cash out')).toBeLessThan(html.indexOf('Expected'));
    expect(html).toContain('PV-2026-0012');
    // an older server, or none: the report as before
    const { cashMoves: _none, ...old } = report;
    const plain = wrap(<ShiftPaper r={old} company="Mer Store" />);
    expect(plain).not.toContain('Other cash');
    expect(wrap(<ShiftPaper r={{ ...report, cashMoves: none }} company="Mer Store" />)).not.toContain('Other cash');
  });

  it('is on the close dialog, and not on a blind close', () => {
    const html = wrap(<CloseShift shift={shift} onCancel={() => {}} onClosed={() => {}} />);
    expect(html).toContain('Other cash in');
    expect(html).toContain('Other cash out');
    expect(html).toContain('RV-2026-0003');
    // blind: the server sends no sums and no lines, and the dialog shows none of the expected cash anyway
    const blind = wrap(<CloseShift shift={{ ...shift, blind: true, expected: { IQD: 0, USD: 0 }, sales: { IQD: 0, USD: 0 }, cashMoves: none }} onCancel={() => {}} onClosed={() => {}} />);
    expect(blind).not.toContain('Other cash');
    expect(blind).not.toContain('PV-2026');
    // even a server that sent them by mistake: a blind dialog draws nothing of them
    expect(wrap(<CloseShift shift={{ ...shift, blind: true }} onCancel={() => {}} onClosed={() => {}} />)).not.toContain('PV-2026');
  });

  it('is on the day close: under its register, as a list, and in the spreadsheet rows', () => {
    const page = tillPart('../pages/DayClose.tsx');
    expect(page).toContain('cashMoveSums(i18n, r.cashMoves)');
    expect(page).toContain("<CashMoveList key={r.shiftId} moves={r.cashMoves} title={t('tu_cashMovesOf'");
    const day = {
      date: '2026-11-22', company: { ar: '', en: '', ku: '' }, sales: { gross: 0, invoices: 0, returns: 0, returnsCount: 0, net: 0 }, methods: [], refunds: [],
      registers: [{ shiftId: 's1', number: 'POS-2026-0001', register: 'Counter 1', openedBy: 'Raz', status: 'open', openedAt: shift.openedAt, closedAt: null, sales: shift.sales, count: 3, expected: shift.expected, counted: null, difference: null, cashMoves: moves }],
      drawers: null, debts: { collected: 0, collectedRows: [], added: 0, addedRows: [] }, lowStock: { count: 0, top: [] }, topItems: [], ownerPhone: ''
    } satisfies DayCloseView;
    const rows = dayCloseRows(i18nOf('en'), day);
    expect(rows).toContainEqual(['Registers', 'Counter 1 (POS-2026-0001) — Purchase invoice · PI-2026-0007 · Las Trading · Raz · IQD', '', -30_000]);
    expect(rows).toContainEqual(['Registers', 'Counter 1 (POS-2026-0001) — Payment voucher · PV-2026-0013 · Paid in dollars · Mer · USD', '', -20]);
  });
});
