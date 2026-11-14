import { describe, expect, it } from 'vitest';
import { SALES14_TEXT } from '../i18n/sales14.ts';
import { STORE_TEXT } from '../i18n/store.ts';
import { makeI18n } from '../i18n.ts';
import { approvalStateOf } from './VoucherApproval.tsx';
import { amountInIqd, balanceAfter, mayQuickVoucher, parseRateText, quickOutcome } from './quick-voucher.ts';
import { chosenMethod, creditNeedsCustomer, salePayments } from '../pages/pos-logic.ts';

describe('receive payment: the balance before and what is left after', () => {
  it('takes a dinar amount off the balance as it is typed', () => {
    expect(balanceAfter(250_000, 100_000, 'IQD', 100)).toBe(150_000);
    expect(balanceAfter(250_000, 250_000, 'IQD', 100)).toBe(0);
    // more than was owed: below zero, and the form says so
    expect(balanceAfter(250_000, 300_000, 'IQD', 100)).toBe(-50_000);
  });

  it('converts dollars at the voucher\'s rate, and waits for an amount and a rate', () => {
    // 100.00 USD at 1,420 dinars per dollar
    expect(amountInIqd(10_000, 'USD', 142_000)).toBe(142_000);
    expect(balanceAfter(500_000, 10_000, 'USD', 142_000)).toBe(358_000);
    expect(balanceAfter(500_000, 10_000, 'USD', null)).toBeNull();
    expect(balanceAfter(500_000, null, 'IQD', 100)).toBeNull();
    expect(balanceAfter(500_000, 0, 'IQD', 100)).toBeNull();
    expect(balanceAfter(500_000, -5, 'IQD', 100)).toBeNull();
  });

  it('reads a rate typed with commas or Arabic digits, and nothing else', () => {
    expect(parseRateText('1,420')).toBe(142_000);
    expect(parseRateText('١٤٢٠٫٥')).toBe(142_050);
    expect(parseRateText('0')).toBeNull();
    expect(parseRateText('abc')).toBeNull();
    expect(parseRateText('')).toBeNull();
  });

  it('shows the button to sales people (receive), purchasing (pay) and whoever prepares vouchers', () => {
    expect(mayQuickVoucher('receipt', ['sales'])).toBe(true);
    expect(mayQuickVoucher('payment', ['sales'])).toBe(false);
    expect(mayQuickVoucher('payment', ['purchases'])).toBe(true);
    expect(mayQuickVoucher('receipt', ['entries.prepare'])).toBe(true);
    expect(mayQuickVoucher('receipt', ['stock'])).toBe(false);
    expect(mayQuickVoucher('receipt', undefined)).toBe(false);
  });

  it('tells a posted voucher from one that waits and from a draft', () => {
    expect(quickOutcome({ status: 'approved', approval: null })).toBe('posted');
    const waiting = { state: 'waiting' as const, requestedBy: 'Las', requestedAt: '', decidedBy: null, decidedAt: null, reason: null };
    expect(quickOutcome({ status: 'draft', approval: waiting })).toBe('waiting');
    expect(quickOutcome({ status: 'draft', approval: null })).toBe('draft');
    expect(quickOutcome({ status: 'draft' })).toBe('draft');
  });
});

describe('a voucher sent for approval', () => {
  const approval = (state: 'waiting' | 'rejected' | 'approved') => ({ state, requestedBy: 'Las', requestedAt: '', decidedBy: null, decidedAt: null, reason: null });
  it('shows as waiting or rejected only until it is posted', () => {
    expect(approvalStateOf({ status: 'draft', approval: approval('waiting') })).toBe('waiting');
    expect(approvalStateOf({ status: 'draft', approval: approval('rejected') })).toBe('rejected');
    expect(approvalStateOf({ status: 'approved', approval: approval('approved') })).toBeNull();
    expect(approvalStateOf({ status: 'draft', approval: null })).toBeNull();
    expect(approvalStateOf({ status: 'checked' })).toBeNull();
  });
});

describe('the till: cash or credit, one of them', () => {
  it('sends nothing for cash, and one part for anything else', () => {
    expect(salePayments('cash', 30_000)).toBeUndefined();
    expect(salePayments('account', 30_000)).toEqual([{ method: 'account', amount: 30_000 }]);
    expect(salePayments('fib', 30_000)).toEqual([{ method: 'fib', amount: 30_000 }]);
    // points paid it all: nothing is left to put anywhere
    expect(salePayments('account', 0)).toBeUndefined();
  });

  it('falls back to cash when what was picked is no longer offered (offline: no credit)', () => {
    expect(chosenMethod('account', ['cash', 'account'])).toBe('account');
    expect(chosenMethod('account', ['cash'])).toBe('cash');
    expect(chosenMethod('fib', ['cash', 'account'])).toBe('cash');
  });

  it('asks for a customer on credit only', () => {
    expect(creditNeedsCustomer('account', '')).toBe(true);
    expect(creditNeedsCustomer('account', 'p1')).toBe(false);
    expect(creditNeedsCustomer('cash', '')).toBe(false);
  });
});

describe('the texts', () => {
  it('has every text in Arabic, English and Kurdish', () => {
    for (const [key, text] of Object.entries(SALES14_TEXT)) {
      expect(text, key).toHaveLength(3);
      for (const one of text) expect(one.trim(), key).not.toBe('');
    }
  });

  it('calls the credit choice «قەرز» in Kurdish, on the invoice, at the till and in the reports', () => {
    const ku = makeI18n('ku', 'western', () => {}, () => {});
    expect(ku.t('payCredit')).toBe('قەرز');
    expect(ku.t('pay_account')).toBe('قەرز');
    expect(STORE_TEXT.pay_account[2]).toBe('قەرز');
    // the accounting side of an entry keeps its own word
    expect(ku.t('credit')).toBe('قەرزدەر');
  });
});
