import { describe, expect, it } from 'vitest';
import {
  allocateDiscount,
  costOut,
  formatQty,
  invoiceTotals,
  lineAmount,
  parseQty,
  remainingShare,
  reverseLines,
  validateInvoice,
  withBaseAmounts,
  type InvoiceInput
} from './index.ts';

describe('quantities', () => {
  it('parses and formats quantities with up to 3 decimals', () => {
    expect(parseQty('2.5')).toBe(2500);
    expect(parseQty('١٢')).toBe(12000);
    expect(parseQty('1.2345')).toBeNull();
    expect(formatQty(2500)).toBe('2.5');
    expect(formatQty(12000)).toBe('12');
    expect(formatQty(1_234_500, 'eastern')).toBe('١٬٢٣٤٫٥');
  });

  it('computes line amounts', () => {
    expect(lineAmount(2000, 823_600)).toBe(1_647_200);
    expect(lineAmount(2500, 1_000)).toBe(2_500);
  });
});

describe('average cost', () => {
  it('caps cumulative fractional shares and leaves the exact remainder', () => {
    let taken = 0;
    const parts = [250, 250, 250, 250].map((qty, i) => {
      const amount = remainingShare(2, taken, qty, i * 250, 1000);
      taken += amount;
      return amount;
    });
    expect(parts).toEqual([1, 0, 1, 0]);
    expect(taken).toBe(2);
    expect(remainingShare(43, 28, 1, 2, 3)).toBe(15);
    expect(remainingShare(Number.MAX_SAFE_INTEGER, 0, 1000, 0, 1000)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('takes cost in proportion and empties the value with the last unit', () => {
    expect(costOut(3000, 1000, 1000)).toBe(333);
    expect(costOut(2000, 667, 2000)).toBe(667);
    expect(costOut(0, 0, 1000)).toBe(0);
  });

  it('splits an invoice discount without losing a dinar', () => {
    const shares = allocateDiscount([1_647_200, 1_079_200, 908_800], 35_200);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(35_200);
    expect(allocateDiscount([100, 0], 0)).toEqual([0, 0]);
  });
});

describe('invoices', () => {
  const base: InvoiceInput = {
    kind: 'sale', date: '2026-09-26', warehouseId: 'w', currency: 'IQD', rateX100: 100,
    payment: 'cash', cashAccountCode: '1811', discount: 35_200,
    lines: [
      { itemId: 'ac', qtyMilli: 2000, unitPrice: 823_600 },
      { itemId: 'pv', qtyMilli: 8000, unitPrice: 134_900 },
      { itemId: 'inv', qtyMilli: 1000, unitPrice: 908_800 }
    ]
  };

  it('totals the concept invoice to 3,600,000 IQD', () => {
    const totals = invoiceTotals(base.lines, base.discount);
    expect(totals.subtotal).toBe(3_635_200);
    expect(totals.total).toBe(3_600_000);
    expect(validateInvoice(base)).toEqual([]);
  });

  it('requires a customer for credit sales and a safe for cash sales', () => {
    expect(validateInvoice({ ...base, payment: 'credit' }).map((e) => e.code)).toContain('party_required');
    expect(validateInvoice({ ...base, cashAccountCode: '1611' }).map((e) => e.code)).toContain('cash_account_invalid');
    expect(validateInvoice({ ...base, discount: 9_999_999 }).map((e) => e.code)).toContain('discount_invalid');
    expect(validateInvoice({ ...base, lines: [{ itemId: 'x', qtyMilli: 0, unitPrice: 1 }], discount: 0 }).map((e) => e.code)).toContain('line_qty_invalid');
  });
});

describe('fixed IQD lines', () => {
  it('keeps explicit IQD amounts and converts the rest', () => {
    const lines = withBaseAmounts({
      currency: 'USD', rateX100: 142_000,
      lines: [
        { accountCode: '1611', debit: 2_535_00, credit: 0 },
        { accountCode: '42', debit: 0, credit: 2_535_00 },
        { accountCode: '35', debit: 2_000_00, credit: 0, baseDebit: 2_840_123, baseCredit: 0 },
        { accountCode: '1371', debit: 0, credit: 2_000_00, baseDebit: 0, baseCredit: 2_840_123 }
      ]
    });
    expect(lines.map((l) => [l.baseDebit, l.baseCredit])).toEqual([[3_599_700, 0], [0, 3_599_700], [2_840_123, 0], [0, 2_840_123]]);
    expect(reverseLines([lines[2]!])[0]).toMatchObject({ debit: 0, credit: 2_000_00, baseDebit: 0, baseCredit: 2_840_123 });
  });
});
