import { describe, expect, it } from 'vitest';
import { guessStatementColumns, parseStatementAmount, parseStatementDate, rowsToStatement, splitPasted } from './bank-statement.ts';

describe('reading a bank statement', () => {
  it('finds the columns from Arabic, English and Kurdish headers', () => {
    expect(guessStatementColumns(['التاريخ', 'البيان', 'رقم المرجع', 'مدين', 'دائن', 'الرصيد'])).toEqual({ date: 0, description: 1, reference: 2, out: 3, in: 4 });
    expect(guessStatementColumns(['Value Date', 'Narrative', 'Ref No.', 'Amount'])).toEqual({ date: 0, description: 1, reference: 2, amount: 3 });
    expect(guessStatementColumns(['بەروار', 'ڕوونکردنەوە', 'بڕ'])).toEqual({ date: 0, description: 1, amount: 2 });
  });

  it('reads dates the way Iraqi banks print them, and Excel day numbers', () => {
    expect(parseStatementDate('2026-03-05')).toBe('2026-03-05');
    expect(parseStatementDate('05/03/2026')).toBe('2026-03-05');
    expect(parseStatementDate('٠٥/٠٣/٢٠٢٦')).toBe('2026-03-05');
    expect(parseStatementDate('5-3-26')).toBe('2026-03-05');
    expect(parseStatementDate('46086')).toBe('2026-03-05');
    expect(parseStatementDate('31/02/2026')).toBeNull();
    expect(parseStatementDate('Opening balance')).toBeNull();
  });

  it('reads signed amounts in every common form', () => {
    expect(parseStatementAmount('1,250,000', 'IQD')).toBe(1_250_000);
    expect(parseStatementAmount('-1,250,000', 'IQD')).toBe(-1_250_000);
    expect(parseStatementAmount('(1,250)', 'IQD')).toBe(-1_250);
    expect(parseStatementAmount('1,250-', 'IQD')).toBe(-1_250);
    expect(parseStatementAmount('1,250.50 DR', 'USD')).toBe(-125_050);
    expect(parseStatementAmount('١٬٠٠٠', 'IQD')).toBe(1_000);
    expect(parseStatementAmount('abc', 'IQD')).toBeNull();
  });

  it('turns rows into lines with separate in/out columns, skipping totals and blanks', () => {
    const rows = [
      ['التاريخ', 'البيان', 'المرجع', 'مدين', 'دائن'],
      ['01/03/2026', 'Opening balance', '', '', ''],
      ['02/03/2026', 'إيداع نقدي', '5501', '', '1,000,000'],
      ['04/03/2026', 'سحب صراف', '', '300,000', ''],
      ['', 'المجموع', '', '300,000', '1,000,000']
    ];
    const map = guessStatementColumns(rows[0]!);
    const parsed = rowsToStatement(rows, map, 'IQD', true);
    expect(parsed.lines).toEqual([
      { date: '2026-03-02', description: 'إيداع نقدي', reference: '5501', amount: 1_000_000 },
      { date: '2026-03-04', description: 'سحب صراف', amount: -300_000 }
    ]);
    expect(parsed.skipped).toBe(2);
  });

  it('splits text pasted from Excel by tabs', () => {
    expect(splitPasted('a\tb\r\n1\t2\n', () => [])).toEqual([['a', 'b'], ['1', '2']]);
    expect(splitPasted('a,b', () => [['csv']])).toEqual([['csv']]);
  });
});
