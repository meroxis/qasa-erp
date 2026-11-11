import { describe, expect, it } from 'vitest';
import { makeI18n } from '../i18n.ts';
import type { DayCloseView } from '../industry/brief-api.ts';
import { dayCloseRows, dayCloseText, differenceOf, methodLabel } from './DayClose.tsx';

const noop = () => {};
const en = makeI18n('en', 'western', noop, noop);
const ar = makeI18n('ar', 'western', noop, noop);
const ku = makeI18n('ku', 'eastern', noop, noop);

/** A day at a shop run by Mer: two registers (one closed 2,000 short, one still open), a return, an expense. */
const day: DayCloseView = {
  date: '2026-11-11',
  company: { ar: 'متجر مير', en: 'Mer Store', ku: 'دوکانی مێر' },
  sales: { gross: 245_000, invoices: 7, returns: 20_000, returnsCount: 1, net: 225_000 },
  methods: [
    { method: 'cash', amount: 85_000, invoices: 4 },
    { method: 'credit', amount: 70_000, invoices: 2 },
    { method: 'bank', amount: 50_000, invoices: 1 },
    { method: 'card', amount: 25_000, invoices: 1 },
    { method: 'loyalty', amount: 15_000, invoices: 1 }
  ],
  refunds: [{ method: 'credit', amount: 20_000 }],
  registers: [
    { shiftId: 's1', number: 'POS-2026-0001', register: 'Counter 1', openedBy: 'Las', status: 'closed', openedAt: '2026-11-11T05:00:00Z', closedAt: '2026-11-11T15:00:00Z',
      sales: { IQD: 60_000, USD: 0 }, count: 3, expected: { IQD: 75_000, USD: 0 }, counted: { IQD: 73_000, USD: 0 }, difference: { IQD: -2_000, USD: 0 } },
    { shiftId: 's2', number: 'POS-2026-0002', register: 'Counter 2', openedBy: 'Raz', status: 'open', openedAt: '2026-11-11T09:00:00Z', closedAt: null,
      sales: { IQD: 10_000, USD: 0 }, count: 1, expected: { IQD: 10_000, USD: 0 }, counted: null, difference: null }
  ],
  drawers: { expected: { IQD: 75_000, USD: 0 }, counted: { IQD: 73_000, USD: 0 }, difference: { IQD: -2_000, USD: 0 } },
  expenses: { rows: [{ entryId: 'e1', number: 'PV-2026-0004', date: '2026-11-11', status: 'approved', description: 'Generator fuel', cashAccountCode: '1811', accountCode: '32', category: 'fuel', currency: 'IQD', amount: 7_500, base: 7_500 }], total: 7_500 },
  debts: { collected: 12_000, collectedRows: [{ partyId: 'p1', code: 'C0001', name: 'Las', amount: 12_000 }], added: 30_000, addedRows: [{ partyId: 'p1', code: 'C0001', name: 'Las', amount: 30_000 }] },
  flow: { in: 135_000, out: 7_500 },
  lowStock: { count: 3, top: [] },
  topItems: [{ itemId: 'i1', code: 'TEA', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, qtyMilli: 20_000, sales: 200_000, cost: 80_000, profit: 120_000 }],
  ownerPhone: '0750 123 4567'
};

describe('the end-of-day close on the screen', () => {
  it('names every payment method in the three languages', () => {
    const methods = ['cash', 'bank', 'card', 'fib', 'zaincash', 'qi', 'credit', 'loyalty'] as const;
    for (const i18n of [en, ar, ku]) for (const m of methods) expect(methodLabel(i18n, m)).toBeTruthy();
    expect(methodLabel(en, 'credit')).toBe('On account');
    expect(methodLabel(ar, 'loyalty')).toBe('نقاط الولاء');
    expect(methodLabel(ku, 'bank')).toBe('بۆ بانک');
  });

  it('calls a drawer short, over or matching', () => {
    expect(differenceOf({ IQD: -2_000, USD: 0 }).key).toBe('dc_short');
    expect(differenceOf({ IQD: 500, USD: 0 }).key).toBe('dc_over');
    expect(differenceOf({ IQD: 0, USD: 0 }).key).toBe('dc_balanced');
    // dollars decide only when the dinars match
    expect(differenceOf({ IQD: 0, USD: -100 }).key).toBe('dc_short');
  });

  it('writes the WhatsApp message in the reader\'s language with the day\'s figures', () => {
    const text = dayCloseText(en, day);
    expect(text).toContain('*End of day — Mer Store*');
    expect(text).toContain('11/11/2026');
    expect(text).toContain('Net sales: 225,000 IQD (7 invoices)');
    expect(text).toContain('Returns: 20,000 IQD');
    expect(text).toContain('• Cash: 85,000 IQD');
    expect(text).toContain('• Loyalty points: 15,000 IQD');
    expect(text).toContain('Difference: -2,000 IQD (Short)');
    expect(text).toContain('Still open: 1');
    expect(text).toContain('3 items at their reorder level or out');
    const arabic = dayCloseText(ar, day);
    expect(arabic).toContain('إغلاق اليوم — متجر مير');
    expect(arabic).toContain('نقص');
    // Kurdish with Eastern digits keeps the amounts in Eastern digits
    expect(dayCloseText(ku, day)).toContain('داخستنی ڕۆژ — دوکانی مێر');
    expect(dayCloseText(ku, day)).toMatch(/[٠-٩]/);
  });

  it('exports plain numbers Excel can add up, with the returns and the refunds as negatives', () => {
    const rows = dayCloseRows(en, day);
    expect(rows[0]).toEqual(['Section', 'Item', 'Count', 'Amount']);
    expect(rows).toContainEqual(['Sales', 'Net sales', '', 225_000]);
    expect(rows).toContainEqual(['Sales', 'Returns', 1, -20_000]);
    expect(rows).toContainEqual(['Sales by payment method', 'Card', 1, 25_000]);
    expect(rows).toContainEqual(['Paid back to customers', 'On account', '', -20_000]);
    expect(rows).toContainEqual(['Registers', 'Counter 1 (POS-2026-0001) — Difference IQD', '', -2_000]);
    expect(rows).toContainEqual(['Registers', 'Counter 2 (POS-2026-0002) — Still open', '', '']);
    expect(rows).toContainEqual(['The day’s expenses', 'PV-2026-0004 — Generator fuel', '', 7_500]);
    expect(rows).toContainEqual(['Best sellers', 'TEA — Tea', 20, 200_000]);
    // every amount is a number or empty: nothing formatted ("225,000 IQD") that Excel would read as text
    for (const r of rows.slice(1)) expect(typeof r[3] === 'number' || r[3] === '').toBe(true);
  });
});
