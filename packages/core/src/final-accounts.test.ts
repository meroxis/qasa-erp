import { describe, expect, it } from 'vitest';
import { finalAccounts } from './final-accounts.ts';
import type { PostedLine } from './reports.ts';

let n = 0;
/** One balanced entry: [account, debit, credit] pairs. */
function entry(date: string, ...lines: [string, number, number][]): PostedLine[] {
  n += 1;
  return lines.map(([accountCode, debit, credit]) => ({ entryId: `e${n}`, number: `JV-${n}`, date, accountCode, debit, credit, description: '' }));
}

const lines: PostedLine[] = [
  ...entry('2025-12-31', ['391', 3, 0], ['1811', 0, 3]), // last year's expense
  ...entry('2026-01-01', ['1811', 100, 0], ['211', 0, 100]), // capital
  ...entry('2026-02-01', ['1371', 60, 0], ['2611', 0, 60]), // purchase on credit
  ...entry('2026-03-01', ['1611', 80, 0], ['421', 0, 80]), // sale on credit
  ...entry('2026-03-01', ['351', 50, 0], ['1371', 0, 50]), // its cost
  ...entry('2026-04-01', ['331', 10, 0], ['1811', 0, 10]), // rent
  ...entry('2026-05-01', ['1811', 5, 0], ['491', 0, 5]), // other revenue
  ...entry('2027-01-05', ['1811', 7, 0], ['421', 0, 7]) // after the period
];

describe('final accounts', () => {
  const fa = finalAccounts(lines, { from: '2026-01-01', to: '2026-12-31' });
  const row = (id: string) => fa.sections.flatMap((s) => s.rows).find((r) => r.id === id)!;

  it('builds the trading, current operations and profit and loss accounts in the unified order', () => {
    expect(row('sales42').amount).toBe(80);
    expect(row('costOfSales35').amount).toBe(50);
    expect(row('grossTrading').amount).toBe(30);
    expect(row('productionValue').amount).toBe(30);
    expect(row('service33')).toMatchObject({ amount: 10, details: [{ code: '331', amount: 10 }] });
    expect(row('grossValueAdded').amount).toBe(20);
    expect(row('operatingSurplus').amount).toBe(20);
    expect(row('otherRevenue49').amount).toBe(5);
    expect(row('netResult').amount).toBe(25);
    expect(fa.netResult).toBe(25);
  });

  it('balances the balance sheet, with last year’s result carried separately', () => {
    const bs = fa.balanceSheet;
    expect(bs.assets.map((g) => [g.code, g.amount])).toEqual([['13', 10], ['16', 80], ['18', 92]]);
    expect(bs.liabilities.map((g) => [g.code, g.amount])).toEqual([['21', 100], ['26', 60]]);
    expect(bs.priorResult).toBe(-3);
    expect(bs.currentResult).toBe(25);
    expect(bs.totalAssets).toBe(182);
    expect(bs.totalLiabilities).toBe(182);
  });

  it('shows a loss as a negative result and never loses an account outside the named groups', () => {
    const odd = [...entry('2026-06-01', ['301', 40, 0], ['1811', 0, 40])];
    const loss = finalAccounts([...lines, ...odd], { from: '2026-01-01', to: '2026-12-31' });
    const other = loss.sections.flatMap((s) => s.rows).find((r) => r.id === 'otherExpenses39')!;
    expect(other.details).toEqual([{ code: '301', amount: 40 }]);
    expect(loss.netResult).toBe(-15);
    expect(loss.balanceSheet.totalAssets).toBe(loss.balanceSheet.totalLiabilities);
  });
});
