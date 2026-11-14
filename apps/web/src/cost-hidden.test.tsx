import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { amountInWords } from '@qasa/core';
import { DataContext } from './components.tsx';
import { I18nContext, makeI18n } from './i18n.ts';
import { allPages, canSee, findPage, seesCompanyBooks, type NavViewer } from './nav.ts';
import type { AccountView, InvoiceSummary } from './api.ts';
import { InvoicesTable } from './pages/Parties.tsx';
import { MoreReports } from './pages/MoreReports.tsx';
import { Accounts } from './pages/Accounts.tsx';
import { Entries } from './pages/Entries.tsx';

// 1.4: the server sends a cashier no cost, no profit and no books. The screens leave those columns, tiles and pages out
// rather than show an empty amount.

vi.mock('./api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api.ts')>()), api: new Proxy({}, { get: () => () => new Promise(() => {}) }) }));
vi.mock('./industry/brief-api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./industry/brief-api.ts')>()), briefApi: new Proxy({}, { get: () => () => new Promise(() => {}) })
}));

const i18n = makeI18n('en', 'western', () => {}, () => {});
const account = (code: string, balance?: number): AccountView => ({
  code, name: { ar: code, en: `Account ${code}`, ku: code }, parentCode: null, postable: true, system: true, nature: 'debit', hasEntries: true,
  ...(balance === undefined ? {} : { balance })
} as AccountView);
const render = (node: ReactNode, data: object = {}) => renderToStaticMarkup(
  <I18nContext.Provider value={i18n}>
    <DataContext.Provider value={{ accounts: [], settings: null, plan: null, online: true, reloadAccounts: async () => {}, reloadSettings: async () => {}, reloadPlan: async () => {}, ...data } as never}>
      {node}
    </DataContext.Provider>
  </I18nContext.Provider>
);

describe('the menu of someone who may not read the books', () => {
  const cashier: NavViewer = { admin: false, permissions: ['sales'], businessTypes: [], noBooks: true };
  const accountant: NavViewer = { admin: false, permissions: ['entries.prepare'], businessTypes: [] };
  const keys = (v: NavViewer) => allPages(v).map((p) => p.key);

  it('has no trial balance, final accounts or account statement', () => {
    for (const key of ['trialBalance', 'finalAccounts', 'statement'] as const) {
      expect(canSee(findPage(key)!, cashier), key).toBe(false);
      expect(canSee(findPage(key)!, accountant), key).toBe(true);
      expect(canSee(findPage(key)!, { ...cashier, admin: true }), key).toBe(true);
    }
    expect(seesCompanyBooks(cashier)).toBe(false);
    expect(seesCompanyBooks(accountant)).toBe(true);
  });

  it('has the vouchers page for a sales person (the vouchers they prepared with "Receive payment"), not for someone who makes none', () => {
    const vouchers = findPage('vouchers')!;
    expect(canSee(vouchers, cashier)).toBe(true);
    expect(canSee(vouchers, { ...cashier, permissions: [] })).toBe(false);
    expect(canSee(vouchers, accountant)).toBe(true);
  });

  it('keeps what a cashier works with, and not the purchases: those are for whoever buys or reads the books', () => {
    for (const key of ['pos_title', 'invoices', 'customers', 'items', 'br_reports', 'br_title', 'dc_title'] as const) expect(keys(cashier)).toContain(key);
    for (const key of ['purchaseInvoices', 'suppliers'] as const) {
      expect(keys(cashier)).not.toContain(key);
      expect(keys(accountant)).toContain(key);
    }
  });
});

describe('the vouchers page of someone who may not read the books', () => {
  it('is their own vouchers: "Receive payment" and no voucher editor; the whole journal for someone who keeps the books', () => {
    const mine = render(<Entries />, { seesBooks: false, permissions: ['sales'] });
    expect(mine).toContain('Only the vouchers you prepared are listed here');
    expect(mine).toContain('Receive payment');
    for (const link of ['new/receipt', 'new/payment', 'new/journal']) expect(mine).not.toContain(link);
    const all = render(<Entries />, { seesBooks: true, permissions: ['entries.prepare'] });
    expect(all).not.toContain('Only the vouchers you prepared');
    for (const link of ['new/receipt', 'new/payment', 'new/journal']) expect(all).toContain(link);
  });
});

describe('screens without the fields the server left out', () => {
  it('prints an amount that was not sent as nothing, never as NaN', () => {
    expect(i18n.money(undefined as never, 'IQD')).toBe('');
    expect(i18n.money(Number.NaN, 'USD')).toBe('');
    expect(i18n.money(0, 'IQD')).toContain('0');
    // (a purchase invoice printed by someone who gets it without its money)
    expect(amountInWords(undefined as never, 'IQD', 'ar')).toBe('');
    expect(amountInWords(1_000, 'IQD', 'en')).not.toBe('');
  });

  it('lists purchase invoices without a total column when none has a total', () => {
    const invoice = (extra: object) => ({
      id: 'i1', kind: 'purchase', status: 'posted', number: 'P-1', date: '2026-11-01', partyId: 'p', partyCode: 'S1', partyName: 'Las', warehouseId: 'w',
      currency: 'IQD', rateX100: 100, payment: 'credit', cashAccountCode: null, notes: '', returnOf: null, createdBy: 'Mer', createdAt: '', ...extra
    } as unknown as InvoiceSummary);
    const total = i18n.t('totalDue');
    expect(render(<InvoicesTable invoices={[invoice({})]} />)).not.toContain(total);
    const priced = render(<InvoicesTable invoices={[invoice({ subtotal: 5_000, discount: 0, total: 5_000, baseTotal: 5_000 })]} />);
    expect(priced).toContain(total);
    expect(priced).toContain('5,000');
  });

  it('offers no profit report, no stock valuation and no ageing of what suppliers are owed, and falls back to sales by item when one is asked for', () => {
    for (const tab of ['profit', 'supplier-aging', 'stock-value'] as const) {
      const cashier = render(<MoreReports tab={tab} />, { seesBooks: false });
      expect(cashier).not.toContain(i18n.t('br_rProfit'));
      expect(cashier).not.toContain(i18n.t('br_rStockValue'));
      expect(cashier).not.toContain(i18n.t('br_rSupplierAging'));
      expect(cashier).toContain(i18n.t('br_rSalesItems'));
      expect(cashier).toContain(`aria-pressed="true">${i18n.t('br_rSalesItems')}<`);
      // what customers owe, by age, stays for the people who sell
      expect(cashier).toContain(`>${i18n.t('br_rAging')}<`);
    }
    expect(render(<MoreReports tab="aging" />, { seesBooks: false })).toContain(`aria-pressed="true">${i18n.t('br_rAging')}<`);
    const owner = render(<MoreReports tab="supplier-aging" />);
    expect(owner).toContain(i18n.t('br_rProfit'));
    expect(owner).toContain(i18n.t('br_rStockValue'));
    expect(owner).toContain(`aria-pressed="true">${i18n.t('br_rSupplierAging')}<`);
  });

  it('shows the chart of accounts without a balance column', () => {
    const balance = `>${i18n.t('balance')}<`;
    const cashier = render(<Accounts />, { accounts: [account('18')], seesBooks: false, companyBooks: false });
    expect(cashier).toContain('Account 18');
    expect(cashier).not.toContain(balance);
    expect(render(<Accounts />, { accounts: [account('18', 75_000)] })).toContain(balance);
  });
});
