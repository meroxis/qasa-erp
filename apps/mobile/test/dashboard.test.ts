import { describe, expect, it } from 'vitest';
import type { Brief } from '../src/api';
import { cashRows, debtors, receivablesOf } from '../src/owner/dashboard';

// The owner's dashboard on the phone (phone app 1.1): the safes and banks, who owes the most (or, from an office before
// 1.1, the late customers), and what customers owe in all.

const names = (en: string) => ({ ar: en, en, ku: en });
const base: Brief = {
  date: '2026-11-15',
  sales: { today: 250_000, invoices: 4, sameDayLastWeek: 180_000, month: 3_200_000 },
  receivables: 1_900_000,
  lateCustomers: [
    { partyId: 'p-late', code: 'C9', name: 'North Market', phone: '', balance: 400_000, oldestDays: 45, usd: 0 },
    { partyId: 'p-old', code: 'C8', name: 'Grand Store', phone: '', balance: 300_000, oldestDays: 92, usd: 0 }
  ],
  lowStock: [],
  approvals: { waitingCheck: 0, waitingApproval: 0 }
};

describe('the owner\'s dashboard', () => {
  it('lists each safe and bank, the largest in dinars first, five until "Show all"', () => {
    const accounts = ['1811', '1812', '1813', '1831', '1832', '1833', '1834'].map((code, i) => ({ code, name: names(`Safe ${code}`), balance: { IQD: (i + 1) * 100_000, USD: code === '1812' ? 50_000 : 0 }, base: (i + 1) * 100_000 }));
    const b: Brief = { ...base, cash: { accounts, total: { IQD: 2_800_000, USD: 50_000 }, base: 2_800_000 } };
    const top = cashRows(b);
    expect(top.rows.map((r) => r.code)).toEqual(['1834', '1833', '1832', '1831', '1813']);
    expect(top.more).toBe(2);
    const all = cashRows(b, true);
    expect(all.rows).toHaveLength(7);
    expect(all.more).toBe(0);
    expect(all.rows.find((r) => r.code === '1812')).toMatchObject({ iqd: 200_000, usd: 50_000, name: { en: 'Safe 1812' } });
    // an office that leaves the money out (whoever may not read the books): no rows
    expect(cashRows(base)).toEqual({ rows: [], more: 0 });
  });

  it('shows who owes the most from an office that says so, in dinars and dollars', () => {
    const b: Brief = {
      ...base,
      topDebtors: [
        { partyId: 'p-1', code: 'C1', name: 'City Pharmacy', phone: '', balance: 1_000_000, oldestDays: 12, usd: 20_000, owed: { IQD: 700_000, USD: 20_000 } },
        { partyId: 'p-2', code: 'C2', name: 'Blue Kitchen', phone: '', balance: 600_000, oldestDays: 3, usd: 0 }
      ],
      receivablesOwed: { IQD: 1_600_000, USD: 20_000 }
    };
    expect(debtors(b)).toEqual({
      kind: 'top',
      rows: [{ partyId: 'p-1', name: 'City Pharmacy', iqd: 700_000, usd: 20_000, days: 12 }, { partyId: 'p-2', name: 'Blue Kitchen', iqd: 600_000, usd: 0, days: 3 }]
    });
    expect(receivablesOf(b)).toEqual({ IQD: 1_600_000, USD: 20_000 });
    // none owes: an empty list, not the late customers
    expect(debtors({ ...b, topDebtors: [] })).toEqual({ kind: 'top', rows: [] });
  });

  it('falls back to the late customers, and dinars only, from an office before phone app 1.1', () => {
    expect(debtors(base)).toEqual({
      kind: 'late',
      rows: [{ partyId: 'p-late', name: 'North Market', iqd: 400_000, usd: 0, days: 45 }, { partyId: 'p-old', name: 'Grand Store', iqd: 300_000, usd: 0, days: 92 }]
    });
    expect(receivablesOf(base)).toEqual({ IQD: 1_900_000, USD: 0 });
    const many = { ...base, lateCustomers: Array.from({ length: 8 }, (_, i) => ({ ...base.lateCustomers[0]!, partyId: `p-${i}` })) };
    expect(debtors(many).rows).toHaveLength(5);
  });
});
