import { describe, expect, it } from 'vitest';
import {
  IRAQI_UNIFIED_CHART,
  STARTER_SUB_ACCOUNTS,
  accountStatement,
  allowedActions,
  amountInWords,
  buildAccounts,
  findParentCode,
  formatAmount,
  isIsoDate,
  natureOf,
  normalizeForSearch,
  parseAmount,
  reverseLines,
  rollupBalances,
  toBase,
  toBaseBalanced,
  trialBalance,
  validateEntry,
  validateNewAccountCode,
  voucherToEntry,
  withBaseAmounts,
  type EntryContext,
  type PostedLine
} from './index.ts';

describe('money', () => {
  it('converts USD cents to IQD with the rate stored ×100', () => {
    expect(toBase(100_00, 'USD', 1420_00)).toBe(142_000);
    expect(toBase(1_50, 'USD', 1310_50)).toBe(1_966); // 1.50 × 1310.50 = 1965.75 → 1966
    expect(toBase(5_000, 'IQD', 1420_00)).toBe(5_000);
  });

  it('keeps base totals balanced when rounding several lines', () => {
    const lines = [33_33, 33_33, 33_34];
    const base = toBaseBalanced(lines, 'USD', 1310_50);
    expect(base.reduce((a, b) => a + b, 0)).toBe(toBase(100_00, 'USD', 1310_50));
  });

  it('parses Western and Eastern digits', () => {
    expect(parseAmount('1,250,000', 'IQD')).toBe(1_250_000);
    expect(parseAmount('١٬٢٥٠٬٠٠٠', 'IQD')).toBe(1_250_000);
    expect(parseAmount('12.5', 'USD')).toBe(12_50);
    expect(parseAmount('12.555', 'USD')).toBeNull();
    expect(parseAmount('1.5', 'IQD')).toBeNull();
    expect(parseAmount('abc', 'IQD')).toBeNull();
  });

  it('formats amounts', () => {
    expect(formatAmount(3_600_000, 'IQD')).toBe('3,600,000');
    expect(formatAmount(253_512, 'USD')).toBe('2,535.12');
    expect(formatAmount(3_600_000, 'IQD', 'eastern')).toBe('٣٬٦٠٠٬٠٠٠');
  });
});

describe('amount in words', () => {
  it('writes Iraqi dinars in 3 languages', () => {
    expect(amountInWords(3_600_000, 'IQD', 'ar')).toBe('فقط ثلاثة ملايين وستمائة ألف دينار عراقي لا غير');
    expect(amountInWords(3_600_000, 'IQD', 'en')).toBe('Only three million six hundred thousand Iraqi dinars');
    expect(amountInWords(3_600_000, 'IQD', 'ku')).toBe('تەنها سێ ملیۆن و شەشسەد هەزار دیناری عێراقی');
  });
  it('handles 200,000 and cents', () => {
    expect(amountInWords(200_000, 'IQD', 'ar')).toBe('فقط مائتا ألف دينار عراقي لا غير');
    expect(amountInWords(2_535_50, 'USD', 'en')).toBe('Only two thousand five hundred thirty-five US dollars and fifty cents');
  });
});

describe('dates and search', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-09-26')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('26/09/2026')).toBe(false);
  });
  it('matches Arabic-keyboard and Kurdish-keyboard spellings', () => {
    expect(normalizeForSearch('علي')).toBe(normalizeForSearch('علی'));
    expect(normalizeForSearch('كاروان')).toBe(normalizeForSearch('کاروان'));
  });
});

describe('chart of accounts', () => {
  const accounts = buildAccounts([...IRAQI_UNIFIED_CHART, ...STARTER_SUB_ACCOUNTS].map((a) => ({ ...a, system: true })));
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  it('has the four classes and every account has names in 3 languages', () => {
    expect(accounts.filter((a) => a.parentCode === null).map((a) => a.code)).toEqual(['1', '2', '3', '4']);
    for (const a of accounts) {
      expect(a.name.ar && a.name.en && a.name.ku, a.code).toBeTruthy();
    }
  });

  it('derives parents, nature and postable flags', () => {
    expect(byCode.get('1811')?.parentCode).toBe('181');
    expect(byCode.get('181')?.postable).toBe(false);
    expect(byCode.get('1811')?.postable).toBe(true);
    expect(byCode.get('31')?.postable).toBe(true);
    expect(natureOf('1811')).toBe('debit');
    expect(natureOf('231')).toBe('credit');
    expect(natureOf('42')).toBe('credit');
    expect(findParentCode('18111', accounts.map((a) => a.code))).toBe('1811');
  });

  it('validates new sub-account codes', () => {
    const ctx = { exists: (c: string) => byCode.has(c), hasEntries: (c: string) => c === '31' };
    expect(validateNewAccountCode('1812', '181', ctx)).toBeNull();
    expect(validateNewAccountCode('1811', '181', ctx)).toBe('code_exists');
    expect(validateNewAccountCode('1911', '181', ctx)).toBe('not_under_parent');
    expect(validateNewAccountCode('311', '31', ctx)).toBe('parent_has_entries');
    expect(validateNewAccountCode('18A', '18', ctx)).toBe('code_format');
  });
});

describe('journal', () => {
  const ctx: EntryContext = {
    accountExists: (c) => ['1811', '1612', '181', '31', '1831'].includes(c),
    isPostable: (c) => c !== '181',
    isPeriodLocked: (d) => d < '2026-09-01'
  };

  it('turns a receipt voucher into a balanced entry', () => {
    const entry = voucherToEntry({
      kind: 'receipt', date: '2026-09-26', cashAccountCode: '1811', party: 'Rebaz Salar',
      description: 'Installment 6 of 12', currency: 'IQD', rateX100: 0,
      items: [{ accountCode: '1612', amount: 375_000 }]
    });
    expect(entry.lines).toEqual([
      { accountCode: '1811', debit: 375_000, credit: 0, description: 'Installment 6 of 12' },
      { accountCode: '1612', debit: 0, credit: 375_000, description: 'Installment 6 of 12' }
    ]);
    expect(validateEntry(entry, ctx)).toEqual([]);
  });

  it('puts the cash side on credit for a payment voucher', () => {
    const entry = voucherToEntry({
      kind: 'payment', date: '2026-09-26', cashAccountCode: '1831', description: 'September salaries',
      currency: 'IQD', rateX100: 100, items: [{ accountCode: '31', amount: 8_295_000 }]
    });
    expect(entry.lines[1]).toMatchObject({ accountCode: '1831', debit: 0, credit: 8_295_000 });
  });

  it('rejects unbalanced, zero, locked and non-postable entries', () => {
    const errors = validateEntry({
      type: 'journal', date: '2026-08-15', description: 'x', currency: 'IQD', rateX100: 100,
      lines: [
        { accountCode: '181', debit: 100, credit: 0 },
        { accountCode: '31', debit: 0, credit: 90 },
        { accountCode: '1811', debit: 0, credit: 0 }
      ]
    }, ctx);
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('period_locked');
    expect(codes).toContain('account_not_postable');
    expect(codes).toContain('line_zero');
    expect(codes).toContain('not_balanced');
  });

  it('converts USD entries to IQD and keeps them balanced', () => {
    const lines = withBaseAmounts({
      currency: 'USD', rateX100: 1310_50,
      lines: [
        { accountCode: '1811', debit: 100_00, credit: 0 },
        { accountCode: '1612', debit: 0, credit: 33_33 },
        { accountCode: '1612', debit: 0, credit: 33_33 },
        { accountCode: '1612', debit: 0, credit: 33_34 }
      ]
    });
    const d = lines.reduce((s, l) => s + l.baseDebit, 0);
    const c = lines.reduce((s, l) => s + l.baseCredit, 0);
    expect(d).toBe(c);
    expect(d).toBe(131_050);
  });

  it('reverses lines and limits actions by status', () => {
    expect(reverseLines([{ accountCode: '1811', debit: 5, credit: 0 }])).toEqual([{ accountCode: '1811', debit: 0, credit: 5 }]);
    expect(allowedActions('draft', { reversed: false, isReversal: false })).toContain('delete');
    expect(allowedActions('approved', { reversed: false, isReversal: false })).toEqual(['reverse']);
    expect(allowedActions('approved', { reversed: true, isReversal: false })).toEqual([]);
  });
});

describe('reports', () => {
  const lines: PostedLine[] = [
    { entryId: 'a', number: 'JV-2026-0001', date: '2026-01-01', accountCode: '1811', debit: 1_000_000, credit: 0, description: 'Opening' },
    { entryId: 'a', number: 'JV-2026-0001', date: '2026-01-01', accountCode: '21', debit: 0, credit: 1_000_000, description: 'Opening' },
    { entryId: 'b', number: 'PV-2026-0001', date: '2026-02-10', accountCode: '33', debit: 250_000, credit: 0, description: 'Rent' },
    { entryId: 'b', number: 'PV-2026-0001', date: '2026-02-10', accountCode: '1811', debit: 0, credit: 250_000, description: 'Rent' }
  ];

  it('builds a balanced trial balance', () => {
    const tb = trialBalance(lines);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.balanceDebitTotal).toBe(tb.balanceCreditTotal);
    expect(tb.rows.find((r) => r.code === '1811')?.balance).toBe(750_000);
  });

  it('builds an account statement with opening balance and running balance', () => {
    const st = accountStatement('181', lines, { from: '2026-02-01' });
    expect(st.opening).toBe(1_000_000);
    expect(st.rows.map((r) => r.balance)).toEqual([750_000]);
    expect(st.closing).toBe(750_000);
  });

  it('rolls balances up the tree', () => {
    const balances = rollupBalances([{ code: '1' }, { code: '18' }, { code: '2' }, { code: '3' }], lines);
    expect(balances.get('18')).toBe(750_000);
    expect(balances.get('2')).toBe(1_000_000);
    expect(balances.get('3')).toBe(250_000);
  });
});
