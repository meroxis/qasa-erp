import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { todayIso, type Lang } from '@qasa/core';
import type { EntryView, VoucherApprovalState } from '../api.ts';
import { DataContext } from '../components.tsx';
import { SALES14_TEXT } from '../i18n/sales14.ts';
import { STORE_TEXT } from '../i18n/store.ts';
import { I18nContext, makeI18n } from '../i18n.ts';
import { QuickVoucherForm } from './QuickVoucher.tsx';
import { ApprovalNote, approvalStateOf, OwnVoucherButtons } from './VoucherApproval.tsx';
import {
  againPreset, amountAfterCurrency, amountInIqd, balanceAfter, boardRateFills, formBalance, formBalanceAfter, invoiceNote, invoiceOpen, invoicePrefill, mayQuickVoucher, mayWithdrawOwn, parseRateText,
  quickNotice, quickOutcome, type QuickVoucherPreset
} from './quick-voucher.ts';
import { chosenMethod, creditNeedsCustomer, pickAfterLink, salePayments, tillMethods, type TillMethod } from '../pages/pos-logic.ts';

// what the form asks the rate board for (the real hook asks the server from an effect, which a test render never runs)
const board = vi.hoisted(() => ({ asked: [] as { active: boolean; currency: string; date: string }[] }));
vi.mock('./fx-prefill.ts', async (original) => ({
  ...(await original<typeof import('./fx-prefill.ts')>()),
  useRatePrefill: (o: { active: boolean; currency: string; date: string }) => {
    board.asked.push({ active: o.active, currency: o.currency, date: o.date });
    return { typed() {} };
  }
}));
beforeEach(() => { board.asked.length = 0; });

const LANGS: Lang[] = ['ar', 'en', 'ku'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const data = (over: object = {}) => ({
  accounts: [], settings: { defaultRateX100: 142_000, postingAccounts: { cash: '1811' } }, permissions: ['sales'], userKey: 'user:u-las', seesBooks: false, ...over
});
const page = (node: ReactNode, lang: Lang = 'en', over: object = {}) => renderToStaticMarkup(
  <I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>
    <DataContext.Provider value={data(over) as never}>{node}</DataContext.Provider>
  </I18nContext.Provider>
);
const form = (preset: QuickVoucherPreset, lang: Lang = 'en') => page(<QuickVoucherForm kind="receipt" preset={preset} onClose={() => {}} onDone={() => {}} />, lang);

/** A receipt Las made with the short form for the customer Raz, as the server sends it to Las (no buttons of the journal). */
const receiptOf = (over: Partial<EntryView> = {}): EntryView => ({
  id: 'e1', type: 'receipt', number: null, date: '2026-11-10', description: 'For invoice INV-2026-0128', party: 'Raz', currency: 'IQD', rateX100: 100,
  status: 'draft', cashAccountCode: '1812', reversesId: null, reversedById: null, preparedBy: 'Las', preparedById: 'u-las', preparedAt: '',
  checkedBy: null, checkedAt: null, approvedBy: null, approvedAt: null, total: 40_000, baseTotal: 40_000,
  approval: { state: 'rejected', requestedBy: 'Las', requestedAt: '', decidedBy: 'Mer', decidedAt: '', reason: 'Wrong amount' },
  lines: [
    { lineNo: 1, accountCode: '1812', debit: 40_000, credit: 0, baseDebit: 40_000, baseCredit: 0, description: '', partyId: null, partyName: null },
    { lineNo: 2, accountCode: '1612', debit: 0, credit: 40_000, baseDebit: 0, baseCredit: 40_000, description: '', partyId: 'p-raz', partyName: 'Raz' }
  ] as unknown as EntryView['lines'],
  actions: [], invoiceId: null, stockDocId: null, ...over
});

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
  it('offers cash and credit, and nothing else, whatever the company set up', () => {
    expect(tillMethods(false)).toEqual(['cash', 'account']);
    expect(tillMethods(true)).toEqual(['cash']);
  });

  it('sends nothing for cash, and one part for credit', () => {
    expect(salePayments('cash', 30_000)).toBeUndefined();
    expect(salePayments('account', 30_000)).toEqual([{ method: 'account', amount: 30_000 }]);
    // points paid it all: nothing is left to put anywhere
    expect(salePayments('account', 0)).toBeUndefined();
  });

  it('falls back to cash when what was picked is no longer offered (offline: no credit)', () => {
    expect(chosenMethod('account', ['cash', 'account'])).toBe('account');
    expect(chosenMethod('account', tillMethods(true))).toBe('cash');
  });

  it('asks for a customer on credit only', () => {
    expect(creditNeedsCustomer('account', '')).toBe(true);
    expect(creditNeedsCustomer('account', 'p1')).toBe(false);
    expect(creditNeedsCustomer('cash', '')).toBe(false);
  });

  it('credit picked, the link drops: the pick itself becomes cash and does not come back as credit with the link', () => {
    let picked: TillMethod = 'account';
    // the link drops: the till keeps cash as the pick
    picked = pickAfterLink(picked, tillMethods(true));
    expect(picked).toBe('cash');
    // the link returns before Pay: still cash, so the money taken meanwhile is not booked on the customer's account
    picked = pickAfterLink(picked, tillMethods(false));
    expect(picked).toBe('cash');
    expect(salePayments(chosenMethod(picked, tillMethods(false)), 30_000)).toBeUndefined();
    // nothing changes while credit is still offered
    expect(pickAfterLink('account', tillMethods(false))).toBe('account');
    for (const text of SALES14_TEXT.s14_creditDropped) expect(text.trim()).not.toBe('');
  });
});

describe('receive payment: the dollar rate, the currency buttons, the note and the notice', () => {
  it('asks the rate board for the rate of the form\'s date, as the header and the voucher screen do', () => {
    form({ partyId: 'p-raz' });
    expect(board.asked).toEqual([{ active: true, currency: 'IQD', date: todayIso() }]);
    expect(boardRateFills({})).toBe(true);
    expect(boardRateFills({ invoice: { number: 'INV-2026-0128', open: 100_000, currency: 'IQD', rateX100: 100 } })).toBe(true);
  });

  it('keeps a dollar invoice\'s own rate, and the rate of a voucher that is sent again', () => {
    const html = form({ partyId: 'p-raz', invoice: { number: 'INV-2026-0128', open: 10_000, currency: 'USD', rateX100: 131_000 } });
    expect(board.asked).toEqual([{ active: false, currency: 'USD', date: todayIso() }]);
    expect(html).toContain('value="1310"');
    expect(boardRateFills(againPreset(receiptOf({ currency: 'USD', rateX100: 131_000 }))!)).toBe(false);
  });

  it('empties the amount when the other currency is pressed: 250,000 dinars are never read as $2,500.00', () => {
    expect(amountAfterCurrency(250_000, 'IQD', 'USD')).toBeNull();
    expect(amountAfterCurrency(10_000, 'USD', 'IQD')).toBeNull();
    // the same button again changes nothing
    expect(amountAfterCurrency(250_000, 'IQD', 'IQD')).toBe(250_000);
    expect(amountAfterCurrency(null, 'IQD', 'USD')).toBeNull();
  });

  it('writes the invoice number in the note as it is on the invoice, whatever digits the user reads in', () => {
    for (const lang of ['ar', 'ku'] as const) {
      const eastern = makeI18n(lang, 'eastern', () => {}, () => {});
      // (the plain text call turns it into Eastern digits, which would then be saved for everybody)
      expect(eastern.t('s14_forInvoice', { n: 'INV-2026-0128' })).not.toContain('INV-2026-0128');
      const note = invoiceNote(eastern.t, 'INV-2026-0128');
      expect(note).toContain('INV-2026-0128');
      expect(note).toBe(makeI18n(lang, 'western', () => {}, () => {}).t('s14_forInvoice', { n: 'INV-2026-0128' }));
    }
    expect(invoiceNote(makeI18n('en', 'western', () => {}, () => {}).t, 'INV-2026-0128')).toBe('For invoice INV-2026-0128');
  });

  it('starts the amount from what the server says is still to collect on the invoice, whatever else the customer owes', () => {
    const lines = [{ returnedAmount: 0 }, { returnedAmount: 0 }];
    // the invoice's own: 100,000, of which 40,000 was received for it and 25,000 waits for approval
    const settlement = { currency: 'IQD' as const, total: 100_000, returned: 0, received: 40_000, waiting: 25_000, open: 60_000, toCollect: 35_000 };
    expect(invoiceOpen({ total: 100_000, lines, settlement })).toEqual({ open: 35_000, waiting: 25_000 });
    // all received, or all of the rest waiting: nothing to ask for
    expect(invoiceOpen({ total: 100_000, lines, settlement: { ...settlement, received: 100_000, waiting: 0, open: 0, toCollect: 0 } })).toEqual({ open: 0, waiting: 0 });
    expect(invoiceOpen({ total: 100_000, lines, settlement: { ...settlement, waiting: 60_000, toCollect: 0 } })).toEqual({ open: 0, waiting: 60_000 });
    // a server from before: the total less what was paid online and the goods returned, as it was
    expect(invoiceOpen({ total: 100_000, lines })).toEqual({ open: 100_000, waiting: 0 });
    expect(invoiceOpen({ total: 100_000, paidOnline: 40_000, lines: [{ returnedAmount: 25_000 }, { returnedAmount: 0 }] })).toEqual({ open: 35_000, waiting: 0 });
    expect(invoiceOpen({ total: 100_000, paidOnline: 100_000, lines })).toEqual({ open: 0, waiting: 0 });
    expect(invoiceOpen({ total: undefined as unknown as number, lines })).toEqual({ open: 0, waiting: 0 });

    expect(form({ partyId: 'p-raz', invoice: { id: 'inv-1', number: 'INV-2026-0128', open: 60_000, currency: 'IQD', rateX100: 100 } })).toContain('value="60,000"');
  });

  it('says so when nothing is left on the invoice, and why when a voucher for it waits; the amount is then typed', () => {
    for (const lang of LANGS) {
      const m = makeI18n(lang, 'western', () => {}, () => {});
      const settled = form({ partyId: 'p-raz', invoice: { id: 'inv-1', number: 'INV-2026-0128', open: 0, waiting: 0, currency: 'IQD', rateX100: 100 } }, lang);
      expect(settled).toContain(esc(m.t('s14_invoiceSettled')));
      expect(settled).not.toContain('value="0"');
      const waits = form({ partyId: 'p-raz', invoice: { id: 'inv-1', number: 'INV-2026-0128', open: 0, waiting: 60_000, currency: 'IQD', rateX100: 100 } }, lang);
      expect(waits).toContain(esc(m.t('s14_invoiceWaits', { amount: m.money(60_000, 'IQD') })));
      expect(waits).not.toContain(esc(m.t('s14_invoiceSettled')));
      // something is open: neither note
      const open = form({ partyId: 'p-raz', invoice: { id: 'inv-1', number: 'INV-2026-0128', open: 5_000, waiting: 60_000, currency: 'IQD', rateX100: 100 } }, lang);
      expect(open).not.toContain(esc(m.t('s14_invoiceSettled')));
      expect(open).not.toContain(esc(m.t('s14_invoiceWaits', { amount: m.money(60_000, 'IQD') })));
    }
  });

  it('never starts above what the customer still owes in all, by the whole position the customers list uses', () => {
    // 404,700 is open on the invoice; 100,000 was received without naming it, so the customer owes 304,700
    expect(invoicePrefill(404_700, 'IQD', 100, { balance: 304_700 })).toBe(304_700);
    // the customer owes more than this invoice (other invoices): the invoice's own open amount, never more
    expect(invoicePrefill(404_700, 'IQD', 100, { balance: 900_000 })).toBe(404_700);
    // all paid, or paid ahead: nothing is filled, the amount is typed
    expect(invoicePrefill(404_700, 'IQD', 100, { balance: 0 })).toBeNull();
    expect(invoicePrefill(404_700, 'IQD', 100, { balance: -50_000 })).toBeNull();
    expect(invoicePrefill(0, 'IQD', 100, { balance: 900_000 })).toBeNull();
    // a dollar invoice ($500.00 at 1,420): the whole position read at the invoice's rate
    expect(invoicePrefill(50_000, 'USD', 142_000, { balance: 710_000 })).toBe(50_000);
    expect(invoicePrefill(50_000, 'USD', 142_000, { balance: 284_000 })).toBe(20_000);
    // a dollar debt ($500.00) of which 426,000 dinars were paid: the dinar balance alone is below zero and the dollar
    // balance alone is the whole $500.00, and neither is what is owed. The position is 284,000 dinars: a dinar invoice
    // opens with that (it used to open empty), a dollar invoice with $200.00
    const paidInDinars = { balance: 284_000, balances: { IQD: -426_000, USD: 50_000 } };
    expect(invoicePrefill(400_000, 'IQD', 100, paidInDinars)).toBe(284_000);
    expect(invoicePrefill(50_000, 'USD', 142_000, paidInDinars)).toBe(20_000);
  });

  it('shows the balance in the currency chosen in the form when the customer\'s row shows dollars', () => {
    // owes $300.00 and nothing in dinars: the row says $300.00
    const dollars = { balance: 426_000, balances: { IQD: 0, USD: 30_000 } };
    expect(formBalance(dollars, 'USD')).toEqual({ amount: 30_000, currency: 'USD', other: null });
    expect(formBalanceAfter(formBalance(dollars, 'USD'), 10_000, 'USD', 142_000)).toBe(20_000);
    // dinars chosen: the same debt in dinars at the book rates, less the dinars received
    expect(formBalance(dollars, 'IQD')).toEqual({ amount: 426_000, currency: 'IQD', other: null });
    expect(formBalanceAfter(formBalance(dollars, 'IQD'), 100_000, 'IQD', 100)).toBe(326_000);
    // owes in both: the chosen currency's balance, with the other one beside it
    const both = { balance: 926_000, balances: { IQD: 500_000, USD: 30_000 } };
    expect(formBalance(both, 'IQD')).toEqual({ amount: 500_000, currency: 'IQD', other: { amount: 30_000, currency: 'USD' } });
    expect(formBalance(both, 'USD')).toEqual({ amount: 30_000, currency: 'USD', other: { amount: 500_000, currency: 'IQD' } });
    // dinars only, one currency paid in the other, or a server that sends only the total: the whole position in dinars
    expect(formBalance({ balance: 250_000, balances: { IQD: 250_000, USD: 0 } }, 'USD')).toEqual({ amount: 250_000, currency: 'IQD', other: null });
    expect(formBalanceAfter({ amount: 250_000, currency: 'IQD' }, 10_000, 'USD', 142_000)).toBe(108_000);
    expect(formBalance({ balance: 284_000, balances: { IQD: -426_000, USD: 50_000 } }, 'USD')).toEqual({ amount: 284_000, currency: 'IQD', other: null });
    expect(formBalance({ balance: 250_000 }, 'IQD')).toEqual({ amount: 250_000, currency: 'IQD', other: null });
    expect(formBalance({ balance: 0, balances: { IQD: 0, USD: 0 } }, 'USD')).toEqual({ amount: 0, currency: 'IQD', other: null });
    // nothing typed yet, or dollars without a rate against a dinar balance: no figure
    expect(formBalanceAfter({ amount: 30_000, currency: 'USD' }, null, 'USD', 142_000)).toBeNull();
    expect(formBalanceAfter({ amount: 250_000, currency: 'IQD' }, 10_000, 'USD', null)).toBeNull();
  });

  it('says that the balance will not change yet whenever the voucher is not posted as it is saved', () => {
    const state = (over: Partial<VoucherApprovalState>): VoucherApprovalState => ({ on: false, waiting: 0, mayApprove: false, ownAtOnce: false, ...over });
    // the setting off, a sales person: a plain draft
    expect(quickNotice(state({ postsAtOnce: false }))).toBe('s14_willDraft');
    // on: it waits (also for an approver under separate duties)
    expect(quickNotice(state({ on: true, postsAtOnce: false }))).toBe('s14_willWait');
    expect(quickNotice(state({ on: true, mayApprove: true, postsAtOnce: false }))).toBe('s14_willWait');
    // posted at once: nothing to say
    expect(quickNotice(state({ postsAtOnce: true }))).toBeNull();
    expect(quickNotice(state({ on: true, mayApprove: true, ownAtOnce: true, postsAtOnce: true }))).toBeNull();
    // a server that does not say: only the waiting it always told
    expect(quickNotice(state({ on: true }))).toBe('s14_willWait');
    expect(quickNotice(state({}))).toBeNull();
    expect(quickNotice(null)).toBeNull();
  });
});

describe('a dialog opened from a button in a list row', () => {
  it('does not take the row\'s one-line text and hand cursor', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const rule = /\.backdrop\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/white-space:\s*normal/);
    expect(rule).toMatch(/cursor:\s*auto/);
  });
});

describe('whoever prepared a voucher that is not posted', () => {
  it('takes it back themselves when it is their own draft and they have no Delete of the journal', () => {
    expect(mayWithdrawOwn(receiptOf(), 'user:u-las', ['sales'])).toBe(true);
    expect(mayWithdrawOwn(receiptOf({ approval: null }), 'user:u-las', ['sales'])).toBe(true);
    // somebody else's, or nobody is signed in
    expect(mayWithdrawOwn(receiptOf(), 'user:u-mer', ['sales'])).toBe(false);
    expect(mayWithdrawOwn(receiptOf(), 'name:Las', ['sales'])).toBe(false);
    expect(mayWithdrawOwn(receiptOf({ preparedById: null }), 'user:u-las', ['sales'])).toBe(false);
    // posted or checked, a kind they may not prepare, or not a voucher
    expect(mayWithdrawOwn(receiptOf({ status: 'approved' }), 'user:u-las', ['sales'])).toBe(false);
    expect(mayWithdrawOwn(receiptOf({ status: 'checked' }), 'user:u-las', ['sales'])).toBe(false);
    expect(mayWithdrawOwn(receiptOf({ type: 'payment' }), 'user:u-las', ['sales'])).toBe(false);
    expect(mayWithdrawOwn(receiptOf({ type: 'journal' }), 'user:u-las', ['sales', 'entries.prepare'])).toBe(false);
    // someone with the usual Delete uses that
    expect(mayWithdrawOwn(receiptOf({ actions: ['edit', 'delete'] }), 'user:u-las', ['sales', 'entries.prepare'])).toBe(false);
  });

  it('opens the short form again with what the voucher said, and saving names the one it replaces', () => {
    const preset = againPreset(receiptOf())!;
    expect(preset).toEqual({
      partyId: 'p-raz',
      again: { id: 'e1', amount: 40_000, currency: 'IQD', rateX100: 100, cashAccountCode: '1812', date: '2026-11-10', note: 'For invoice INV-2026-0128' }
    });
    // no note was typed: the server wrote the party's name, which is not a note
    expect(againPreset(receiptOf({ description: 'Raz' }))!.again!.note).toBe('');
    // not something the short form makes
    expect(againPreset(receiptOf({ type: 'journal' }))).toBeNull();
    expect(againPreset(receiptOf({ lines: [] }))).toBeNull();
    for (const lang of LANGS) {
      const html = form(preset, lang);
      expect(html).toContain('value="40,000"');
      expect(html).toContain('value="2026-11-10"');
      expect(html).toContain(esc(makeI18n(lang, 'western', () => {}, () => {}).t('s14_againHelp')));
    }
    expect(form({ partyId: 'p-raz' })).not.toContain(esc(makeI18n('en', 'western', () => {}, () => {}).t('s14_againHelp')));
  });

  it('shows the two buttons and says what to do, in the three languages; nothing to somebody else', () => {
    for (const lang of LANGS) {
      const t = makeI18n(lang, 'western', () => {}, () => {}).t;
      const buttons = page(<OwnVoucherButtons entry={receiptOf()} onError={() => {}} onWithdrawn={() => {}} onSentAgain={() => {}} />, lang);
      expect(buttons).toContain(esc(t('s14_withdraw')));
      expect(buttons).toContain(esc(t('s14_sendAgain')));
      expect(page(<ApprovalNote entry={receiptOf()} />, lang)).toContain(esc(t('s14_rejectedOwn')));
      const waiting = receiptOf({ approval: { state: 'waiting', requestedBy: 'Las', requestedAt: '', decidedBy: null, decidedAt: null, reason: null } });
      expect(page(<ApprovalNote entry={waiting} />, lang)).toContain(esc(t('s14_waitingOwn')));
    }
    const other = { userKey: 'user:u-mer' };
    expect(page(<OwnVoucherButtons entry={receiptOf()} onError={() => {}} onWithdrawn={() => {}} onSentAgain={() => {}} />, 'en', other)).toBe('');
    expect(page(<ApprovalNote entry={receiptOf()} />, 'en', other)).not.toContain('withdraw');
    // someone who prepares vouchers keeps the usual words
    const preparer = page(<ApprovalNote entry={receiptOf({ actions: ['edit', 'delete'] })} />, 'en', { permissions: ['entries.prepare'] });
    expect(preparer).toContain('Change it to send it for approval again, or delete it.');
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
    expect(ku.t('credit')).toBe('دائین');
    expect(ku.t('debit')).toBe('مەدین');
    for (const side of [ku.t('debit'), ku.t('credit')]) expect(side).not.toContain('قەرز');
  });
});
