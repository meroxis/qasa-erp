import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from './components.tsx';
import { I18nContext, makeI18n, type Key } from './i18n.ts';
import type { BatchReportRow } from './industry/batches-api.ts';
import type { SerialLookup, SerialView } from './industry/mobile-api.ts';
import type { ReorderRow } from './industry/parts-api.ts';
import type { SystemView } from './industry/solar-api.ts';
import type { JobSummaryView, JobView, WorksSummaryView } from './industry/works-api.ts';
import { ReorderList } from './pages/CarParts.tsx';
import { JobDetail, JobsTable, worksTiles } from './pages/EngineeringWorks.tsx';
import { LookupResult } from './pages/MobileShop.tsx';
import { NearExpiry } from './pages/Pharmacy.tsx';
import { SolarSystem } from './pages/Solar.tsx';

// 1.4: the Pro module leaves out of its answers what a person may not see: what a job cost and earned and the documents
// behind that (the books), what a phone or a part was bought for and the value of stock near its expiry date (cost).
// The industry pages leave those tiles, columns and sections out: no empty amount, no "NaN", and the page still opens.

/** What the server has answered, by the name of the call; anything else never answers. */
const { now, answering } = vi.hoisted(() => {
  const now = { answers: {} as Record<string, unknown> };
  const answering = () => new Proxy({}, {
    get: (_, name: string) => () => (name in now.answers ? Object.assign(Promise.resolve(now.answers[name]), { answer: now.answers[name] }) : new Promise(() => {}))
  });
  return { now, answering };
});
vi.mock('./api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api.ts')>()), api: answering() }));
vi.mock('./industry/works-api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./industry/works-api.ts')>()), worksApi: answering() }));
vi.mock('./industry/solar-api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./industry/solar-api.ts')>()), solarApi: answering() }));
vi.mock('./industry/parts-api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./industry/parts-api.ts')>()), partsApi: answering() }));
vi.mock('./industry/pharmacy-api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./industry/pharmacy-api.ts')>()), pharmacyApi: answering() }));
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
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const t = (key: Key) => esc(i18n.t(key));
const render = (node: ReactNode, data: object = {}) => renderToStaticMarkup(
  <I18nContext.Provider value={i18n}>
    <DataContext.Provider value={{ accounts: [], settings: null, plan: null, online: true, reloadAccounts: async () => {}, reloadSettings: async () => {}, reloadPlan: async () => {}, ...data } as never}>
      {node}
    </DataContext.Provider>
  </I18nContext.Provider>
);
const cashier = { seesBooks: false, seesCost: false, companyBooks: false, permissions: ['sales'] };
const names = (en: string) => ({ ar: en, en, ku: en });
/** Nothing a page prints stands for a field that was not sent. */
const clean = (html: string) => {
  expect(html).not.toContain('NaN');
  expect(html).not.toContain('undefined');
  return html;
};

beforeEach(() => { now.answers = {}; });

/** A job as the server answers someone who may not read the books: no costs, no profit, no cost lines. */
const jobSummary = {
  id: 'j1', number: 'JOB-7', date: '2026-11-01', party: { id: 'p1', code: 'C1', name: 'Las', phone: '' },
  title: 'Steel gate', category: 'steel', site: '', currency: 'IQD', status: 'fabricating', dueDate: null, assignedTo: 'Raz',
  subtotal: 900_000, discount: 0, total: 900_000, paid: 300_000, remaining: 600_000, revenue: null, invoice: null, overdue: false
} as JobSummaryView;
const job = {
  ...jobSummary, party: { ...jobSummary.party, address: '' }, notes: '',
  lines: [{ seq: 1, description: 'Gate', unit: 'piece', qtyMilli: 1000, unitPrice: 900_000, amount: 900_000 }],
  receipts: [], createdBy: 'Mer', createdAt: '2026-11-01T08:00:00Z', system: false, actions: ['deposit'], moves: ['installing']
} as JobView;
const withBooks = (j: JobView): JobView => ({
  ...j, costs: 410_000, profit: null,
  costLines: [{ id: 'c1', category: 'materials', amount: 410_000, description: 'Steel', createdBy: 'Mer', createdAt: '', document: { kind: 'invoice', id: 'i9', number: 'P-9', date: '2026-11-02' }, counted: true }]
});
const summary = (month: WorksSummaryView['month']): WorksSummaryView => ({
  available: true, open: 3, byStatus: {} as WorksSummaryView['byStatus'], inProgress: { IQD: 900_000, USD: 0 }, toCollect: { IQD: 600_000, USD: 0 }, overdue: 0, month
});

describe('engineering works without what a job cost and earned', () => {
  it('has no profit tile above the jobs', () => {
    const tiles = worksTiles(i18n, summary({ jobs: 2, revenue: 500_000 }));
    expect(tiles.map((x) => x.label)).not.toContain(i18n.t('ew_tileProfit'));
    expect(tiles).toHaveLength(3);
    clean(JSON.stringify(tiles));
    const owner = worksTiles(i18n, summary({ jobs: 2, revenue: 500_000, costs: 200_000, profit: 300_000 }));
    expect(owner.map((x) => x.label)).toContain(i18n.t('ew_tileProfit'));
    expect(owner.at(-1)!.value).toContain('300,000');
  });

  it('lists the jobs without a profit column', () => {
    const profit = `>${t('ew_profit')}<`;
    const mine = clean(render(<JobsTable jobs={[jobSummary]} />, cashier));
    expect(mine).toContain('JOB-7');
    expect(mine).not.toContain(profit);
    const all = clean(render(<JobsTable jobs={[{ ...jobSummary, costs: 410_000, profit: -20_000 }]} />));
    expect(all).toContain(profit);
    expect(all).toContain('20,000');
  });

  it('opens a job without the cost and profit tiles and without the costs section', () => {
    now.answers = { job };
    const mine = clean(render(<JobDetail id="j1" />, cashier));
    expect(mine).toContain('JOB-7');
    expect(mine).toContain(t('ew_deposits'));
    for (const key of ['ew_costTotal', 'ew_profit', 'ew_costs', 'ew_noCosts', 'ew_addCost', 'ew_profitLater'] as const) expect(mine, key).not.toContain(`>${t(key)}`);
    now.answers = { job: withBooks(job) };
    const all = clean(render(<JobDetail id="j1" />));
    for (const key of ['ew_costTotal', 'ew_profit', 'ew_costs'] as const) expect(all, key).toContain(`>${t(key)}<`);
    expect(all).toContain('410,000');
    expect(all).toContain('P-9');
  });
});

describe('a solar system without what its job cost and earned', () => {
  it('opens', () => {
    const system: SystemView = { job: { ...job, category: 'solar', system: true }, design: null, installed: [] };
    now.answers = { system };
    const html = clean(render(<SolarSystem id="j1" />, cashier));
    expect(html).toContain('JOB-7');
    expect(html).toContain('Las');
  });
});

describe('a phone\'s card without what it was bought for', () => {
  const device = {
    id: 's1', serial: '356938035643809', item: { id: 'it1', code: 'PH-1', name: names('Phone') }, grade: 'new', status: 'in_stock',
    purchaseInvoice: null, fromParty: null, saleInvoice: null, party: null, soldAt: null, warrantyUntil: null, warrantyActive: false,
    notes: '', createdBy: 'Mer', createdAt: ''
  } as SerialView;
  const lookup = (d: SerialView): SerialLookup => ({ serial: d.serial, device: d, repairs: [] });

  it('has no cost line, and one with the amount for someone who sees cost', () => {
    const mine = clean(render(<LookupResult result={lookup(device)} onChanged={() => {}} />, cashier));
    expect(mine).toContain('356938035643809');
    expect(mine).not.toContain(t('mob_cost'));
    expect(clean(render(<LookupResult result={lookup({ ...device, cost: null })} onChanged={() => {}} />))).not.toContain(t('mob_cost'));
    const all = clean(render(<LookupResult result={lookup({ ...device, cost: 650_000 })} onChanged={() => {}} />));
    expect(all).toContain(t('mob_cost'));
    expect(all).toContain('650,000');
  });
});

describe('the list of parts to order without the last price paid', () => {
  const row = {
    id: 'p1', code: 'BRK-1', barcode: '', name: names('Brake pad'), unit: 'piece', active: true, salePrice: 25_000, saleCurrency: 'IQD', wholesalePrice: null,
    shelf: 'A3', brand: '', brandId: null, origin: '', qtyMilli: 1000, numbers: [], reorderMilli: 5000
  } as unknown as ReorderRow;

  it('has no last purchase column, and one for someone who sees cost', () => {
    const column = `>${t('pt_lastPurchase')}<`;
    now.answers = { reorder: [row] };
    const mine = clean(render(<ReorderList onOpen={() => {}} />, cashier));
    expect(mine).toContain('BRK-1');
    expect(mine).not.toContain(column);
    now.answers = { reorder: [{ ...row, lastPurchase: { supplier: 'Raz', date: '2026-10-20', unitPrice: 12_500, currency: 'IQD' } }, { ...row, id: 'p2', code: 'BRK-2', lastPurchase: null }] };
    const all = clean(render(<ReorderList onOpen={() => {}} />));
    expect(all).toContain(column);
    expect(all).toContain('12,500');
  });
});

describe('medicines near their expiry date without the value of the stock', () => {
  const row = {
    itemId: 'm1', itemCode: 'MED-1', itemName: names('Paracetamol'), unit: 'piece', batchId: 'b1', batch: 'L-22', expiry: '2026-12-01',
    warehouseId: 'w1', warehouseCode: 'W1', warehouseName: names('Main'), qtyMilli: 12_000, daysLeft: 17, state: 'near'
  } as BatchReportRow;

  it('has no value column, and one for someone who sees cost', () => {
    now.answers = { nearExpiry: [row] };
    const mine = clean(render(<NearExpiry />, cashier));
    expect(mine).toContain('MED-1');
    now.answers = { nearExpiry: [{ ...row, value: 36_000 }] };
    const all = clean(render(<NearExpiry />));
    expect(all).toContain('36,000');
    expect((all.match(/<th/g) ?? []).length).toBe((mine.match(/<th/g) ?? []).length + 1);
  });
});
