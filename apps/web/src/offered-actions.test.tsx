import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { permissionsOf, ROLES, seesBooks, seesCost, type Role } from '../../../packages/server/src/auth.ts';
import { DataContext } from './components.tsx';
import { I18nContext, makeI18n, type Key } from './i18n.ts';
import { ACTIONS, may, needs, PRO_ACTIONS, routeAction, type Action } from './may.ts';
import { allPages, canSee, findPage, NAV, navLabel, pageOpen, type NavViewer } from './nav.ts';
import { Accounts } from './pages/Accounts.tsx';
import { Banking } from './pages/Banking.tsx';
import { Entries } from './pages/Entries.tsx';
import { Expenses } from './pages/Expenses.tsx';
import { Brief } from './pages/Brief.tsx';
import { CarParts } from './pages/CarParts.tsx';
import { EngineeringWorks } from './pages/EngineeringWorks.tsx';
import { Generators } from './pages/Generators.tsx';
import { firstStepsFor, Home } from './pages/Home.tsx';
import { Guarantors, Installments } from './pages/Installments.tsx';
import { Invoices } from './pages/Invoices.tsx';
import { Items } from './pages/Items.tsx';
import { MobileShop } from './pages/MobileShop.tsx';
import { Parties } from './pages/Parties.tsx';
import { Pharmacy } from './pages/Pharmacy.tsx';
import { Pipeline } from './pages/Pipeline.tsx';
import { PurchaseOrders } from './pages/PurchaseOrders.tsx';
import { Quotes } from './pages/Quotes.tsx';
import { Rates } from './pages/Rates.tsx';
import { RealEstate } from './pages/RealEstate.tsx';
import { Solar } from './pages/Solar.tsx';
import { StockAdjustments } from './pages/StockAdjustments.tsx';
import { StockDocs } from './pages/StockDocs.tsx';

// A menu row, a tile or a button is offered only when the server would accept its action from the person signed in.
// Each role is taken from the server's own table (auth.ts): its permissions, and whether it reads the books. The pages
// are rendered as each role, and every button named below shows exactly when `may` says the action is theirs; a
// server test (packages/server/src/offered-actions.test.ts) holds `may` to what the server really answers.

// An industry page offers its buttons once its summary says the plan has the feature. The summary is the page's own
// state (or, for the generators, its first load): `seed` puts one there before the page is rendered, as if it had
// arrived. `at` is which useState of the render takes it (the page's own come first, in the order it calls them).
const seed = vi.hoisted(() => ({ at: -1, value: null as unknown, n: 0, summary: null as unknown }));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: (initial: unknown) => react.useState(seed.n++ === seed.at ? seed.value : initial) };
});
// nothing else is loaded: the buttons looked for are the ones a page shows before and after its list arrives
vi.mock('./components.tsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./components.tsx')>()),
  useLoad: (load: () => unknown) => ({ data: seed.summary && String(load).includes('.summary(') ? seed.summary : null, error: null, loading: true, reload: () => {} })
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
const render = (node: ReactNode, p: Person, screen: { state?: [number, unknown]; summary?: unknown; plan?: object } = {}) => {
  Object.assign(seed, { at: screen.state?.[0] ?? -1, value: screen.state?.[1] ?? null, n: 0, summary: screen.summary ?? null });
  return renderToStaticMarkup(
  <I18nContext.Provider value={i18n}>
    <DataContext.Provider value={{
      accounts: [account], settings: { defaultRateX100: 142_000, postingAccounts: { cash: '1811' }, companyName: { ar: 'شركة', en: 'Company', ku: 'کۆمپانیا' }, businessTypes: [] }, plan: screen.plan ?? null, online: true,
      reloadAccounts: async () => {}, reloadSettings: async () => {}, reloadPlan: async () => {}, ...p.data
    } as never}>
      {node}
    </DataContext.Provider>
  </I18nContext.Provider>
  );
};

// the summaries of the industry pages, as their servers send them for a plan that has the feature
const money = { IQD: 0, USD: 0 };
/** A record that answers the same for every key (a count per status, per stage). */
const each = <T,>(value: T) => new Proxy({}, { get: () => value }) as Record<string, T>;
const SUMMARY = {
  realEstate: { available: true, projects: 0, counts: { available: 0, reserved: 0, sold: 0, total: 0 }, availableValue: money, soldValue: money, expiredReservations: 0 },
  pipeline: { available: true, open: 0, openValue: money, byStage: each({ count: 0, value: money }), late: 0, month: { won: 0, lost: 0, winRate: null, wonValue: money }, owners: [] },
  works: { available: true, open: 0, byStatus: each(0), inProgress: money, toCollect: money, overdue: 0, month: { jobs: 0, revenue: 0, costs: 0, profit: 0 } },
  installments: { available: true, active: 0, outstanding: money, dueThisWeek: { contracts: 0, amount: money }, overdue: { contracts: 0, amount: money }, collectedThisMonth: money },
  mobile: { available: true, serials: each(0), repairs: each(0), lateRepairs: 0, underWarranty: 0 },
  solar: { available: true, openJobs: { solar: 0, electrical: 0 }, month: { systems: 0, kwp: 0 }, visitsDueThisWeek: 0, visitsOverdue: 0, warrantiesExpiring: 0 },
  generators: { available: true, subscribers: each(0), ampsX10: each(0), period: '2026-11', billed: 0, collected: 0, outstanding: 0, owing: 0, areas: [], routes: [], collectors: [] }
};

interface Screen {
  name: string;
  node: (p: Person) => ReactNode;
  offers: [Key | `#${string}`, Action][];
  /** the page's summary: which of its useState calls holds it, and what arrived */
  state?: [number, unknown];
  /** the same for a page that loads its summary */
  summary?: unknown;
  plan?: object;
}
const has = (p: Person, permission: string) => p.viewer.admin || p.viewer.permissions.includes(permission as never);

/** A page, and the buttons on it with the action each one does. */
const SCREENS: Screen[] = [
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
  { name: 'Dollar rate', node: () => <Rates revaluation={false} />, offers: [['fx_saveRate', 'rate']] },
  // (without a number yet the brief is sent by the one who can set it: the others copy or print it)
  { name: 'Daily brief', node: () => <Brief />, offers: [['br_ownerPhone', 'briefSettings'], ['br_sendWhatsApp', 'briefSettings']] },
  // the industry pages: the permission of each is in may.ts PRO_ACTIONS, beside the Pro route it mirrors
  { name: 'Real estate', node: () => <RealEstate />, state: [0, SUMMARY.realEstate], offers: [['re_newProject', 'reProject']] },
  { name: 'Sales pipeline', node: () => <Pipeline />, state: [5, SUMMARY.pipeline], offers: [['pl_new', 'deal']] },
  { name: 'Job orders', node: () => <EngineeringWorks />, state: [5, SUMMARY.works], offers: [['ew_new', 'job']] },
  { name: 'Instalments', node: () => <Installments />, state: [2, SUMMARY.installments], offers: [['#new-installment', 'installment']] },
  { name: 'Guarantors', node: () => <Guarantors />, offers: [['newGuarantor', 'guarantor']] },
  { name: 'Phones', node: () => <MobileShop tab="devices" />, state: [0, SUMMARY.mobile], offers: [['mob_register', 'mobSerial'], ['mob_assign', 'mobAssign'], ['mob_tradeIn', 'mobTradeIn']] },
  { name: 'Repairs', node: () => <MobileShop tab="repairs" />, state: [0, SUMMARY.mobile], offers: [['mob_newRepair', 'mobRepair']] },
  { name: 'Solar', node: () => <Solar tab="home" />, state: [0, SUMMARY.solar], offers: [['#solar/new', 'solarSystem'], ['#solar/electrical', 'solarSystem']] },
  { name: 'Solar maintenance', node: () => <Solar tab="maintenance" />, state: [0, SUMMARY.solar], offers: [['sl_newPlan', 'solarSystem'], ['sl_newVisit', 'solarSystem']] },
  { name: 'Generator subscribers', node: () => <Generators tab="subscribers" />, summary: SUMMARY.generators, offers: [['gen_add', 'genSubscriber'], ['gen_addMany', 'genSubscriber']] },
  { name: 'Generator months', node: () => <Generators tab="months" />, summary: SUMMARY.generators, offers: [['gen_billMonth', 'genRun'], ['gen_settings', 'genRun']] },
  { name: 'Car parts', node: () => <CarParts />, plan: { features: ['autoParts'] }, offers: [['pt_import', 'partData']] },
  { name: 'Pharmacy', node: (p) => <Pharmacy admin={p.viewer.admin} sales={has(p, 'sales')} />, plan: { features: ['pharmacy'] }, offers: [['ph_addMedicine', 'medicine'], ['ph_controlledLog', 'controlled']] }
];

describe('buttons, role by role', () => {
  it('shows an admin every button looked for here (so a missing one below is a hidden one, not a renamed one)', () => {
    for (const screen of SCREENS) {
      const html = render(screen.node(of('admin')), of('admin'), screen);
      for (const [key] of screen.offers) expect(html, `${screen.name}: ${key}`).toContain(label(key));
    }
  });

  for (const p of PEOPLE) {
    it(`offers ${p.role} no button whose action the server refuses, and every one it accepts`, () => {
      for (const screen of SCREENS) {
        const html = render(screen.node(p), p, screen);
        for (const [key, action] of screen.offers) {
          expect(html.includes(label(key)), `${p.role} on ${screen.name}: ${key} (${needs(action)})`).toBe(may(p.viewer.permissions, action));
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

describe('the industry pages', () => {
  it('asks of each button a permission the server has, and names the Pro route it mirrors', () => {
    const permissions = new Set<string>(ROLES.flatMap((r) => permissionsOf([r])));
    for (const [action, spec] of Object.entries(PRO_ACTIONS)) {
      expect(permissions.has(spec.needs), `${action}: ${spec.needs}`).toBe(true);
      expect(spec.route, action).toMatch(/^(POST|PUT|DELETE) \/api\/(real-estate|installments|guarantors|pipeline|mobile|parts|works|solar|generators|pharmacy)(\/|$)/);
      // (none is also an action of the core: the server test sends those, and cannot send these)
      expect(action in ACTIONS, action).toBe(false);
    }
  });

  it('gives a viewer, an accountant, a stock keeper and a buyer no button of the sales work on them', () => {
    const sales = (Object.keys(PRO_ACTIONS) as (keyof typeof PRO_ACTIONS)[]).filter((a) => PRO_ACTIONS[a].needs === 'sales');
    expect(sales.length).toBeGreaterThan(5);
    for (const role of ['viewer', 'preparer', 'checker', 'approver', 'storekeeper', 'purchasing'] as const) {
      for (const action of sales) expect(may(of(role).viewer.permissions, action), `${role}: ${action}`).toBe(false);
      // setting up projects and billing a generator month are an admin's
      for (const action of ['reProject', 'genRun'] as const) expect(may(of(role).viewer.permissions, action), `${role}: ${action}`).toBe(false);
    }
    expect(may(of('storekeeper').viewer.permissions, 'mobSerial')).toBe(true);
    expect(may(of('storekeeper').viewer.permissions, 'partData')).toBe(true);
    expect(may(of('storekeeper').viewer.permissions, 'medicine')).toBe(true);
    expect(may(of('purchasing').viewer.permissions, 'mobTradeIn')).toBe(true);
    expect(may(of('sales').viewer.permissions, 'mobTradeIn')).toBe(false);
  });
});

// Where the Pro module is in the checkout (it is a private repository: absent from the public one), the table is held
// to the module's own rules, read as text: the permission its `rules` name for the route, an admin for a change they
// do not list.
describe.skipIf(!existsSync('pro/src/realestate/api.ts'))('the industry pages against the Pro module', () => {
  const FOLDER: Record<string, string> = { 'real-estate': 'realestate', guarantors: 'installments', parts: 'parts' };
  it('asks the permission the Pro route asks', () => {
    for (const [action, spec] of Object.entries(PRO_ACTIONS)) {
      const [method, path] = spec.route.split(' ') as [string, string];
      const feature = path.split('/')[2]!;
      const source = readFileSync(`pro/src/${FOLDER[feature] ?? feature}/api.ts`, 'utf8');
      const quoted = (s: string) => s.replace(/[/:.-]/g, '\\$&');
      expect(source, `${action}: ${spec.route} is a route`).toMatch(new RegExp(`method: '${method}', path: '${quoted(path)}'`));
      const rule = new RegExp(`'${quoted(spec.route)}': ('?)([A-Za-z.]+)\\1`).exec(source);
      expect(rule ? rule[2]!.toLowerCase() : 'admin', `${action}: ${spec.route}`).toBe(spec.needs);
    }
  });
});

describe('the first steps on the home page', () => {
  const fresh = { named: false, parties: 0, items: 0, sales: 0, users: 1 };
  const links = (role: Role) => firstStepsFor(of(role).viewer.permissions, fresh).map((s) => s.link);

  it('shows each person only the steps whose page opens for them', () => {
    expect(links('admin')).toEqual(['settings/company', 'import', 'new-invoice/sale', 'users']);
    expect(links('sales')).toEqual(['customers', 'new-invoice/sale']);
    expect(links('storekeeper')).toEqual(['items']);
    for (const p of PEOPLE) {
      for (const link of links(p.role)) {
        const [page, arg] = link.split('/');
        expect(pageOpen(page!, arg, p.viewer), `${p.role}: ${link}`).toBe(true);
        // (the company's details are a section of Settings that only an admin is shown)
        if (page === 'settings') expect(p.viewer.admin, p.role).toBe(true);
      }
    }
  });

  it('has no step, and so no card, for someone who can do none of them', () => {
    for (const role of ['viewer', 'preparer', 'checker', 'approver', 'purchasing'] as const) expect(links(role), role).toEqual([]);
  });

  it('counts a step done from the company\'s own books', () => {
    const steps = firstStepsFor(['admin'], { named: true, parties: 2, items: 0, sales: 0, users: 3 });
    expect(steps.map((s) => s.done)).toEqual([true, true, false, true]);
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
      for (const [page, arg] of [['new-invoice', 'sale'], ['new-invoice', 'purchase'], ['new-quote'], ['pos'], ['new-purchase-order'], ['new-stock-doc'], ['new-stock-adjustment'], ['stock-count'], ['new'], ['edit'],
        ['new-installment'], ['solar', 'new'], ['solar', 'electrical']] as [string, string?][]) {
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
