import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from './components.tsx';
import { I18nContext, makeI18n, type Key } from './i18n.ts';
import { canSee, findPage, NO_BOOKS_PAGES, type NavViewer } from './nav.ts';
import type { PartyStatement, PartyView } from './api.ts';
import type { BriefView, DashboardView, DayCloseView } from './industry/brief-api.ts';
import { Brief, briefText } from './pages/Brief.tsx';
import { DayClose, dayCloseRows, dayCloseText } from './pages/DayClose.tsx';
import { Banking } from './pages/Banking.tsx';
import { Home } from './pages/Home.tsx';
import { InvoiceDetail } from './pages/Invoices.tsx';
import { PartyDetail } from './pages/Parties.tsx';

// 1.4: the company's money is the books. The server sends someone who may not read them (a cashier) no balance of a
// safe or a bank, no money in and out, no expenses, and of a supplier's statement the balance alone. The screens leave
// those tiles, columns and pages out, and never show an empty amount or a table with nothing in it.

/** What the server has answered, by the name of the call; anything else never answers. */
const { now, answering } = vi.hoisted(() => {
  const now = { answers: {} as Record<string, unknown> };
  const answering = () => new Proxy({}, {
    get: (_, name: string) => () => (name in now.answers ? Object.assign(Promise.resolve(now.answers[name]), { answer: now.answers[name] }) : new Promise(() => {}))
  });
  return { now, answering };
});
vi.mock('./api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api.ts')>()), api: answering() }));
vi.mock('./industry/brief-api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./industry/brief-api.ts')>()), briefApi: answering(), dayCloseApi: answering() }));
vi.mock('./industry/banking-api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./industry/banking-api.ts')>()), bankingApi: answering() }));
// a page rendered once shows what was loaded: useLoad gives an answer above at once, and nothing for any other call
vi.mock('./components.tsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./components.tsx')>()),
  useLoad: (load: () => Promise<unknown>) => {
    let data: unknown = null;
    try {
      const asked = load() as Promise<unknown> & { answer?: unknown };
      void Promise.resolve(asked).catch(() => {});
      if (asked && 'answer' in asked) data = asked.answer;
    } catch { /* a call that cannot be made here: not loaded */ }
    return { data, error: null, loading: data === null, reload: () => {} };
  }
}));

const i18n = makeI18n('en', 'western', () => {}, () => {});
/** A text as the page prints it. (None of those looked for in a message or an export has a character HTML writes otherwise.) */
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const t = (key: Key) => esc(i18n.t(key));
const render = (node: ReactNode, data: object = {}) => renderToStaticMarkup(
  <I18nContext.Provider value={i18n}>
    <DataContext.Provider value={{ accounts: [], settings: null, plan: null, online: true, reloadAccounts: async () => {}, reloadSettings: async () => {}, reloadPlan: async () => {}, ...data } as never}>
      {node}
    </DataContext.Provider>
  </I18nContext.Provider>
);
const cashierData = { seesBooks: false, seesCost: false, companyBooks: false, permissions: ['sales'] };
const cashier: NavViewer = { admin: false, permissions: ['sales'], businessTypes: [], noBooks: true };
const accountant: NavViewer = { admin: false, permissions: ['entries.prepare'], businessTypes: [] };
const names = (en: string) => ({ ar: en, en, ku: en });

beforeEach(() => { now.answers = {}; });

describe('the menu of someone who may not read the books', () => {
  it('has no expenses page, and a typed link to it or to a bank statement is not opened', () => {
    const expenses = findPage('br_expenses')!;
    expect(canSee(expenses, cashier)).toBe(false);
    expect(canSee(expenses, accountant)).toBe(true);
    expect(canSee(expenses, { ...cashier, admin: true })).toBe(true);
    for (const page of ['expenses', 'bank-statement', 'new', 'edit']) expect(NO_BOOKS_PAGES.has(page), page).toBe(true);
    // the pages they keep: the brief and the day close. The banks and cheques are not theirs to work on (nav.ts `work`):
    // the till still lists the safes by name
    for (const key of ['br_title', 'dc_title'] as const) expect(canSee(findPage(key)!, cashier), key).toBe(true);
    expect(canSee(findPage('bk_title')!, cashier)).toBe(false);
    expect(canSee(findPage('bk_title')!, accountant)).toBe(true);
    for (const page of ['brief', 'day-close', 'banking', 'entries', 'entry']) expect(NO_BOOKS_PAGES.has(page), page).toBe(false);
  });
});

describe('the Daily Brief and the home page without the company\'s money', () => {
  const brief = (extra: Partial<BriefView> = {}): BriefView => ({
    date: '2026-11-14', company: names('Mer Store'), sales: { today: 120_000, invoices: 4, sameDayLastWeek: 100_000, month: 900_000 },
    topItems: [], lateCustomers: [], receivables: 310_000, installments: { overdue: [], dueTomorrow: [], overdueTotal: { IQD: 0, USD: 0 } },
    lowStock: [], approvals: { waitingCheck: 0, waitingApproval: 0 }, ownerPhone: '', ...extra
  });
  const money: Partial<BriefView> = {
    cash: { accounts: [{ code: '1811', name: names('Main safe'), balance: { IQD: 640_000, USD: 0 }, base: 640_000 }], total: { IQD: 640_000, USD: 0 }, base: 640_000 },
    flow: { in: 150_000, out: 40_000 }
  };

  it('shows the sales and leaves out the cash and the money in and out when they were not sent', () => {
    now.answers = { brief: brief() };
    const page = render(<Brief />, cashierData);
    expect(page).toContain('120,000');
    expect(page).toContain(t('br_salesMonth'));
    for (const key of ['br_cashNow', 'br_cashByAccount', 'br_moneyIn'] as const) expect(page, key).not.toContain(t(key));
    const text = briefText(i18n, brief());
    expect(text).toContain('120,000');
    for (const key of ['br_cashNow', 'br_moneyIn', 'br_moneyOut'] as const) expect(text, key).not.toContain(t(key));
    expect(text).not.toMatch(/undefined|NaN/);

    now.answers = { brief: brief(money) };
    const full = render(<Brief />);
    for (const key of ['br_cashNow', 'br_cashByAccount', 'br_moneyIn'] as const) expect(full, key).toContain(t(key));
    expect(full).toContain('640,000');
    expect(briefText(i18n, brief(money))).toContain('640,000');
  });

  it('has no cash tile and no expenses button on the home page', () => {
    const dashboard = (extra: Partial<DashboardView> = {}): DashboardView => ({ date: '2026-11-14', salesMonth: 900_000, salesLastMonth: 800_000, receivables: 310_000, payables: 55_000, months: [], ...extra });
    now.answers = { dashboard: dashboard(), entries: [], invoices: [], parties: [] };
    const home = render(<Home viewer={cashier} user="Raz" favourites={[]} />, cashierData);
    expect(home).toContain('900,000');
    expect(home).toContain(t('receivables'));
    expect(home).not.toContain(t('cashAndBanks'));
    expect(home).not.toContain(t('br_newExpense'));

    now.answers = { dashboard: dashboard({ cash: { total: { IQD: 640_000, USD: 0 }, base: 640_000 } }), entries: [], invoices: [], parties: [] };
    const owner = render(<Home viewer={{ ...accountant, admin: true }} user="Mer" favourites={[]} />, { permissions: ['admin'] });
    expect(owner).toContain(t('cashAndBanks'));
    expect(owner).toContain('640,000');
    expect(owner).toContain(t('br_newExpense'));
  });
});

describe('the end-of-day close without the expenses and the money in and out', () => {
  const day = (extra: Partial<DayCloseView> = {}): DayCloseView => ({
    date: '2026-11-14', company: names('Mer Store'),
    sales: { gross: 245_000, invoices: 7, returns: 0, returnsCount: 0, net: 245_000 },
    methods: [{ method: 'cash', amount: 245_000, invoices: 7 }], refunds: [],
    registers: [{
      shiftId: 's1', number: 'POS-2026-0001', register: 'Counter 1', openedBy: 'Raz', status: 'closed', openedAt: '2026-11-14T05:00:00Z', closedAt: '2026-11-14T15:00:00Z',
      sales: { IQD: 245_000, USD: 0 }, count: 7, expected: { IQD: 295_000, USD: 0 }, counted: { IQD: 293_000, USD: 0 }, difference: { IQD: -2_000, USD: 0 }
    }],
    drawers: { expected: { IQD: 295_000, USD: 0 }, counted: { IQD: 293_000, USD: 0 }, difference: { IQD: -2_000, USD: 0 } },
    debts: { collected: 30_000, collectedRows: [{ partyId: 'p1', code: 'C-0001', name: 'Las', amount: 30_000 }], added: 0, addedRows: [] },
    lowStock: { count: 0, top: [] }, topItems: [], ownerPhone: '', ...extra
  });
  const money: Partial<DayCloseView> = {
    expenses: { rows: [{ entryId: 'e1', number: 'PV-1', date: '2026-11-14', status: 'approved', description: 'Rent', cashAccountCode: '1811', accountCode: '33', category: 'rent', currency: 'IQD', amount: 77_000, base: 77_000 }], total: 77_000 },
    flow: { in: 275_000, out: 77_000 }
  };

  it('keeps the sales, the registers, the drawers and the debts, on the page, in the message and in the export', () => {
    now.answers = { get: day() };
    const page = render(<DayClose />, cashierData);
    for (const amount of ['245,000', '295,000', '293,000', '30,000']) expect(page, amount).toContain(amount);
    expect(page).toContain('Counter 1');
    for (const key of ['dc_expenses', 'dc_moneyIn'] as const) expect(page, key).not.toContain(t(key));
    const text = dayCloseText(i18n, day());
    expect(text).toContain('245,000');
    expect(text).toContain(t('dc_debtsCollected'));
    expect(text).not.toContain(t('dc_expenses'));
    expect(text).not.toMatch(/undefined|NaN/);
    const sections = dayCloseRows(i18n, day()).map((r) => r[0]);
    expect(sections).toContain(t('dc_registers'));
    for (const key of ['dc_expenses', 'dc_moneyIn', 'dc_moneyOut'] as const) expect(sections, key).not.toContain(t(key));

    now.answers = { get: day(money) };
    const full = render(<DayClose />);
    for (const key of ['dc_expenses', 'dc_moneyIn'] as const) expect(full, key).toContain(t(key));
    expect(full).toContain('77,000');
    expect(dayCloseText(i18n, day(money))).toContain(t('dc_expenses'));
    expect(dayCloseRows(i18n, day(money)).map((r) => r[0])).toEqual(expect.arrayContaining([t('dc_expenses'), t('dc_moneyIn'), t('dc_moneyOut')]));
  });
});

describe('the safes and banks without what they hold', () => {
  const safe = (extra: object = {}) => ({ code: '1811', name: names('Main safe'), kind: 'safe', currency: null, pending: 0, ...extra });

  it('lists them by name, with no totals, no amount columns and no reconciliation tab', () => {
    now.answers = { accounts: { accounts: [safe()], reconciliation: true } };
    const page = render(<Banking />, cashierData);
    expect(page).toContain('Main safe');
    expect(page).not.toContain(t('bk_totalCash'));
    expect(page).not.toContain('>USD<');
    expect(page).not.toContain(t('bk_tabReconcile'));
    // a typed link to the reconciliation tab shows the list, not statements the server refuses
    expect(render(<Banking tab="reconcile" />, cashierData)).toContain('Main safe');

    now.answers = { accounts: { accounts: [safe({ balance: { IQD: 640_000, USD: 0 }, base: 640_000 })], reconciliation: true } };
    const full = render(<Banking />);
    expect(full).toContain(t('bk_totalCash'));
    expect(full).toContain('>USD<');
    expect(full).toContain('640,000');
    expect(full).toContain(t('bk_tabReconcile'));
  });
});

describe('a statement for someone who may not read the books', () => {
  const party = (over: Partial<PartyView>): PartyView => ({
    id: 'p1', type: 'supplier', code: 'S-0001', name: 'Las', phone: '', address: '', accountCode: '2611', creditLimit: null, notes: '', active: true,
    balance: 450_000, hasEntries: true, balances: { IQD: 450_000, USD: 0 }, ...over
  });
  const line = (over: object) => ({ entryId: 'e1', invoiceId: null, number: 'RV-1', date: '2026-11-10', description: 'Receipt', debit: 0, credit: 20_000, balance: 80_000, ...over });

  it('says of a supplier that the movements are in the books: the balance, no empty table, no export of nothing', () => {
    // as the server sends it: no opening, no totals, no lines
    now.answers = { partyStatement: { party: party({}), currency: null, closing: 450_000, lines: [] } as PartyStatement, invoices: [] };
    const page = render(<PartyDetail id="p1" />, cashierData);
    expect(page).toContain('Las');
    expect(page).toContain('450,000');
    expect(page).toContain(t('s14_statementInBooks'));
    for (const key of ['noData', 'opening', 'closing', 'exportExcel', 'debit'] as const) expect(page, key).not.toContain(`>${t(key)}<`);
    expect(page).not.toContain('type="date"');

    // someone who reads the books gets the statement as before, also one with no movements
    now.answers = { partyStatement: { party: party({}), currency: null, opening: 0, closing: 450_000, totalDebit: 0, totalCredit: 450_000, lines: [] } as PartyStatement, invoices: [] };
    const full = render(<PartyDetail id="p1" />);
    expect(full).not.toContain(t('s14_statementInBooks'));
    for (const key of ['noData', 'opening', 'closing', 'exportExcel'] as const) expect(full, key).toContain(`>${t(key)}<`);
  });

  it('opens an invoice from a customer\'s statement, and a voucher only for someone who may read the journal', () => {
    const statement: PartyStatement = {
      party: party({ type: 'customer', code: 'C-0001', name: 'Raz', accountCode: '1611', balance: 80_000, balances: { IQD: 80_000, USD: 0 } }),
      currency: null, opening: 0, closing: 80_000, totalDebit: 100_000, totalCredit: 20_000,
      lines: [line({ entryId: 'e0', invoiceId: 'i1', number: 'S-1', description: 'Sale', debit: 100_000, credit: 0, balance: 100_000 }), line({})]
    };
    now.answers = { partyStatement: statement, invoices: [] };
    const clickable = (html: string) => (html.match(/<tr class="click"/g) ?? []).length;
    const mine = render(<PartyDetail id="p1" />, cashierData);
    expect(mine).toContain('RV-1');
    expect(mine).not.toContain(t('s14_statementInBooks'));
    expect(clickable(mine)).toBe(1);
    expect(clickable(render(<PartyDetail id="p1" />))).toBe(2);
  });
});

describe('a purchase invoice for someone who may not read the books', () => {
  const line = { lineNo: 1, itemId: 'i1', itemCode: 'A-1', itemName: names('Cable'), unit: 'piece', trackStock: true, description: '', qtyMilli: 3000,
    sourceLine: null, returnedQtyMilli: 0, lineUnit: null, unitFactorMilli: null, unitQtyMilli: null, batchNo: null, expiry: null, batchId: null };
  const head = {
    id: 'v1', kind: 'purchase', status: 'posted', number: 'PI-2026-0007', date: '2026-11-10', partyId: 'p1', partyCode: 'S-0001', partyName: 'Raz', partyPhone: null, partyAddress: null,
    warehouseId: 'w1', warehouseCode: 'M', warehouseName: names('Main'), currency: 'USD', rateX100: 142_000, payment: 'credit', cashAccountCode: null, cashAccountName: null, notes: '',
    returnOf: null, returnOfNumber: null, returns: [], createdBy: 'Mer', createdAt: '2026-11-10T09:00:00Z', entryId: 'e1', entryNumber: 'JV-1', cancelEntryId: null, cancelEntryNumber: null,
    postedBy: 'Mer', postedAt: '2026-11-10T09:01:00Z', cancelledBy: null, cancelledAt: null, actions: [], installmentContract: null
  };

  it('shows what was bought and from whom, with no amount, no empty total, and nothing to print, send or pay', () => {
    // as the server sends it: the lines without their prices, the invoice without its totals
    now.answers = { invoice: { ...head, lines: [line] } };
    const page = render(<InvoiceDetail id="v1" />, { ...cashierData, settings: { companyName: names('Company'), defaultRateX100: 142_000, postingAccounts: {} } });
    expect(page).toContain('PI-2026-0007');
    expect(page).toContain('Raz');
    expect(page).toContain('Cable');
    expect(page).not.toMatch(/undefined|NaN/);
    for (const key of ['unitPrice', 'subtotal', 'totalDue', 'inWords', 'print', 's14_paySupplier'] as const) expect(page, key).not.toContain(`>${t(key)}<`);
    expect(page).not.toContain('class="totals"');
  });

  it('keeps the amounts, the totals and Print for someone who reads the books', () => {
    now.answers = { invoice: { ...head, discount: 0, subtotal: 30_000, total: 30_000, baseTotal: 426_000, lines: [{ ...line, unitPrice: 10_000, amount: 30_000, cost: 142_000, returnedAmount: 0 }] } };
    const page = render(<InvoiceDetail id="v1" />, { settings: { companyName: names('Company'), defaultRateX100: 142_000, postingAccounts: {} }, permissions: ['admin'] });
    expect(page).toContain('class="totals"');
    expect(page).toContain(`>${t('totalDue')}<`);
    expect(page).toContain(t('print'));
    expect(page).not.toMatch(/undefined|NaN/);
  });
});
