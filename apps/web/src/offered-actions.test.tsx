import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { permissionsOf, ROLES, seesBooks, seesCost, type Role } from '../../../packages/server/src/auth.ts';
import { DataContext } from './components.tsx';
import { I18nContext, makeI18n, type Key } from './i18n.ts';
import { ACTIONS, may, routeAction, type Action } from './may.ts';
import { allPages, canSee, findPage, NAV, navLabel, pageOpen, type NavViewer } from './nav.ts';
import { Accounts } from './pages/Accounts.tsx';
import { Banking } from './pages/Banking.tsx';
import { Entries } from './pages/Entries.tsx';
import { Expenses } from './pages/Expenses.tsx';
import { Home } from './pages/Home.tsx';
import { Invoices } from './pages/Invoices.tsx';
import { Items } from './pages/Items.tsx';
import { Parties } from './pages/Parties.tsx';
import { PurchaseOrders } from './pages/PurchaseOrders.tsx';
import { Quotes } from './pages/Quotes.tsx';
import { Rates } from './pages/Rates.tsx';
import { StockAdjustments } from './pages/StockAdjustments.tsx';
import { StockDocs } from './pages/StockDocs.tsx';

// A menu row, a tile or a button is offered only when the server would accept its action from the person signed in.
// Each role is taken from the server's own table (auth.ts): its permissions, and whether it reads the books. The pages
// are rendered as each role, and every button named below shows exactly when `may` says the action is theirs; a
// server test (packages/server/src/offered-actions.test.ts) holds `may` to what the server really answers.

// nothing is loaded: the buttons looked for are the ones a page shows before and after its list arrives
vi.mock('./components.tsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./components.tsx')>()),
  useLoad: () => ({ data: null, error: null, loading: true, reload: () => {} })
}));
vi.mock('./pos.css', () => ({}));

const i18n = makeI18n('en', 'western', () => {}, () => {});
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
/** A button's text as the page prints it; '#…' is a link's address instead (a text the page also uses elsewhere). */
const label = (key: Key | `#${string}`) => (key.startsWith('#') ? key.slice(1) : esc(i18n.t(key as Key)));

interface Person { role: Role; viewer: NavViewer; data: object }
const person = (role: Role): Person => {
  const permissions = permissionsOf([role]);
  const actor = { permissions, roles: [role] };
  const books = seesBooks(actor);
  return {
    role,
    viewer: { admin: permissions.includes('admin'), permissions, businessTypes: [], noBooks: !books },
    data: { permissions, seesBooks: books, seesCost: seesCost(actor), companyBooks: books, userKey: `user:${role}` }
  };
};
const PEOPLE = ROLES.map(person);
const of = (role: Role) => PEOPLE.find((p) => p.role === role)!;

const account = { code: '181', name: { ar: 'نقد', en: 'Cash', ku: 'نەقد' }, parentCode: null, postable: false, system: false, nature: 'debit', balance: 0, hasEntries: false };
const render = (node: ReactNode, p: Person) => renderToStaticMarkup(
  <I18nContext.Provider value={i18n}>
    <DataContext.Provider value={{
      accounts: [account], settings: { defaultRateX100: 142_000, postingAccounts: { cash: '1811' }, companyName: { ar: 'شركة', en: 'Company', ku: 'کۆمپانیا' }, businessTypes: [] }, plan: null, online: true,
      reloadAccounts: async () => {}, reloadSettings: async () => {}, reloadPlan: async () => {}, ...p.data
    } as never}>
      {node}
    </DataContext.Provider>
  </I18nContext.Provider>
);

/** A page, and the buttons on it with the action each one does. */
const SCREENS: { name: string; node: (p: Person) => ReactNode; offers: [Key | `#${string}`, Action][] }[] = [
  { name: 'Home', node: (p) => <Home viewer={p.viewer} user="Las" favourites={[]} />, offers: [['newSale', 'sale'], ['newPurchase', 'purchase'], ['newReceipt', 'voucher'], ['newJournal', 'voucher']] },
  { name: 'Items', node: () => <Items />, offers: [['newItem', 'item'], ['newPurchase', 'purchase'], ['importExcel', 'importPage']] },
  { name: 'Customers', node: () => <Parties type="customer" />, offers: [['newCustomer', 'customer'], ['newSale', 'sale']] },
  { name: 'Suppliers', node: () => <Parties type="supplier" />, offers: [['newSupplier', 'supplier'], ['newPurchase', 'purchase']] },
  { name: 'Sale invoices', node: () => <Invoices kind="sale" />, offers: [['newSale', 'sale']] },
  { name: 'Purchase invoices', node: () => <Invoices kind="purchase" />, offers: [['newPurchase', 'purchase']] },
  { name: 'Quotations', node: () => <Quotes />, offers: [['qt_new', 'quote']] },
  { name: 'Purchase orders', node: () => <PurchaseOrders />, offers: [['po_new', 'purchaseOrder']] },
  { name: 'Stock documents', node: () => <StockDocs />, offers: [['#new-stock-doc/opening', 'stockDoc']] },
  { name: 'Stock adjustments', node: () => <StockAdjustments />, offers: [['adj_new', 'adjustment'], ['adj_count', 'adjustment'], ['adj_settings', 'account']] },
  { name: 'Vouchers', node: () => <Entries />, offers: [['newJournal', 'voucher'], ['newPayment', 'voucher']] },
  { name: 'Expenses', node: () => <Expenses />, offers: [['br_saveExpense', 'voucher'], ['br_expenseAccounts', 'account']] },
  { name: 'Safes and banks', node: () => <Banking />, offers: [['bk_addAccount', 'moneyAccount'], ['bk_tabTransfer', 'banking']] },
  { name: 'Cheques', node: () => <Banking tab="cheques" />, offers: [['bk_receive', 'banking'], ['bk_issue', 'banking']] },
  { name: 'Chart of accounts', node: () => <Accounts />, offers: [['addSub', 'account'], ['rename', 'account']] },
  { name: 'Dollar rate', node: () => <Rates revaluation={false} />, offers: [['fx_saveRate', 'rate']] }
];

describe('buttons, role by role', () => {
  it('shows an admin every button looked for here (so a missing one below is a hidden one, not a renamed one)', () => {
    for (const screen of SCREENS) {
      const html = render(screen.node(of('admin')), of('admin'));
      for (const [key] of screen.offers) expect(html, `${screen.name}: ${key}`).toContain(label(key));
    }
  });

  for (const p of PEOPLE) {
    it(`offers ${p.role} no button whose action the server refuses, and every one it accepts`, () => {
      for (const screen of SCREENS) {
        const html = render(screen.node(p), p);
        for (const [key, action] of screen.offers) {
          expect(html.includes(label(key)), `${p.role} on ${screen.name}: ${key} (${ACTIONS[action].needs})`).toBe(may(p.viewer.permissions, action));
        }
      }
    });
  }

  it('gives someone who only sells no tile of what the company owes suppliers', () => {
    expect(render(<Home viewer={of('sales').viewer} user="Las" favourites={[]} />, of('sales'))).not.toContain(label('payables'));
    expect(render(<Home viewer={of('purchasing').viewer} user="Las" favourites={[]} />, of('purchasing'))).toContain(label('payables'));
    expect(render(<Home viewer={of('viewer').viewer} user="Las" favourites={[]} />, of('viewer'))).toContain(label('payables'));
  });
});

describe('the menu, role by role', () => {
  const keys = (p: Person) => allPages(p.viewer).map((i) => i.key);

  it('shows someone who may not read the books only the pages whose work is theirs', () => {
    for (const p of PEOPLE) {
      for (const item of NAV.flatMap((g) => g.items)) {
        if (!item.work || !canSee(item, p.viewer)) continue;
        const theirs = item.work.some((a) => may(p.viewer.permissions, a));
        // read without the work only by someone the server lets read the books
        expect(theirs || !p.viewer.noBooks, `${p.role}: ${item.key}`).toBe(true);
      }
    }
  });

  it('keeps the purchases, the stock adjustments, the banks and the chart of accounts away from someone who only sells', () => {
    const sales = of('sales');
    expect(sales.viewer.noBooks).toBe(true);
    for (const key of ['po_title', 'purchaseInvoices', 'suppliers', 'purchaseReturns', 'stockDocs', 'adj_title', 'bk_title', 'accounts', 'br_expenses'] as const) {
      expect(keys(sales), key).not.toContain(key);
    }
    for (const key of ['pos_title', 'qt_title', 'invoices', 'customers', 'salesReturns', 'items', 'fx_title', 'vouchers', 'br_title', 'dc_title'] as const) {
      expect(keys(sales), key).toContain(key);
    }
  });

  it('lets the roles that read the books read those pages, each with its own buttons only', () => {
    for (const role of ['preparer', 'checker', 'approver', 'purchasing', 'storekeeper', 'viewer'] as const) {
      expect(of(role).viewer.noBooks, role).toBe(false);
      for (const key of ['purchaseInvoices', 'suppliers', 'adj_title', 'bk_title', 'accounts'] as const) expect(keys(of(role)), `${role}: ${key}`).toContain(key);
      // the till is only an action: for those who sell
      expect(keys(of(role)), role).not.toContain('pos_title');
    }
  });

  it('calls a cashier\'s vouchers "My vouchers", and everyone else\'s "Vouchers & entries"', () => {
    const vouchers = findPage('vouchers')!;
    expect(navLabel(vouchers, of('sales').viewer)).toBe('s14_myVouchers');
    for (const role of ['admin', 'preparer', 'viewer', 'storekeeper'] as const) expect(navLabel(vouchers, of(role).viewer), role).toBe('vouchers');
    expect(navLabel(findPage('items')!, of('sales').viewer)).toBe('items');
    expect(new Set(i18n.t('s14_myVouchers')).size).toBeGreaterThan(1);
  });
});

describe('a typed address', () => {
  const open = (role: Role, page: string, arg?: string) => pageOpen(page, arg, of(role).viewer);

  it('lands on the home page when the page is not this person\'s', () => {
    // someone who only sells
    for (const [page, arg] of [['purchases'], ['new-invoice', 'purchase'], ['suppliers'], ['purchase-orders'], ['new-purchase-order'], ['purchase-returns'],
      ['stock-adjustments'], ['new-stock-adjustment'], ['stock-count'], ['stock-docs'], ['new-stock-doc'], ['banking'], ['cheque'], ['accounts'], ['new'], ['edit'], ['users'], ['import']] as [string, string?][]) {
      expect(open('sales', page, arg), `${page}/${arg ?? ''}`).toBe(false);
    }
    for (const [page, arg] of [[''], ['home'], ['sales'], ['new-invoice', 'sale'], ['customers'], ['party'], ['invoice'], ['items'], ['item'], ['rates'], ['pos'], ['quotes'], ['new-quote'],
      ['entries'], ['entry'], ['brief'], ['day-close'], ['settings'], ['labels']] as [string, string?][]) {
      expect(open('sales', page, arg), `${page}/${arg ?? ''}`).toBe(true);
    }
  });

  it('opens a form only for someone who may send it, whatever they may read', () => {
    for (const p of PEOPLE) {
      for (const [page, arg] of [['new-invoice', 'sale'], ['new-invoice', 'purchase'], ['new-quote'], ['pos'], ['new-purchase-order'], ['new-stock-doc'], ['new-stock-adjustment'], ['stock-count'], ['new'], ['edit']] as [string, string?][]) {
        const action = routeAction(page, arg)!;
        expect(open(p.role, page, arg), `${p.role}: ${page}/${arg ?? ''}`).toBe(may(p.viewer.permissions, action));
      }
    }
    // the viewer reads the lists
    for (const page of ['purchases', 'suppliers', 'stock-adjustments', 'banking', 'accounts', 'entries']) expect(open('viewer', page), page).toBe(true);
  });

  it('opens everything for an admin', () => {
    for (const item of NAV.flatMap((g) => g.items)) for (const m of item.match ?? []) {
      const [page, arg] = m.split(':');
      expect(open('admin', page!, arg), m).toBe(true);
    }
  });
});
