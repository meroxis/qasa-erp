import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';

// Round four of the review before 2.0: goods on consignment end exact, whatever happened to them on the way.
//
// Random histories of two items on consignment in two warehouses, with three suppliers, in dinars and in dollars:
// terms changed (another supplier or currency when the shelf is empty, another agreed cost at any time), receipts at
// different rates, goods sent back to the supplier, sales (also two lines of one item), customers' returns, returns
// cancelled, sales cancelled, transfers, receipts and returns to the supplier cancelled, settlements. After every
// step the supplier's side of the stock is the stock (quantity and dinars, item by item, warehouse by warehouse), a
// dinar row is worth its dinars, and a supplier with none of its goods in a warehouse has no dinars and no dollars
// left on it there once that shelf is empty. At the end everything is sold, and every supplier ends with nothing on
// hand, no book value, and is owed exactly what it delivered less what went back: to the dinar and to the cent.
//
// The seeds are fixed. More: QASA_CONSIGNMENT_SEEDS=150 npx vitest run packages/server/src/consignment-random.test.ts

// (on a database server, QASA_TEST_DB, four seeds: the same SQL, a fraction of the time)
const SEEDS = Number(process.env.QASA_CONSIGNMENT_SEEDS ?? '') || (process.env.QASA_TEST_DB ? 4 : 30);
const STEPS = 70;
const DAY = '2026-11-20';

let db: Db;
let app: FastifyInstance;
let clock: number;

const headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const call = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => {
  clock += 1_000;
  vi.setSystemTime(clock);
  return app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body as object }) });
};
async function must(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const r = await call(method, url, body);
  expect(r.statusCode, `${method} ${url}: ${r.body}`).toBeLessThan(300);
  return r.json();
}

function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

beforeEach(() => {
  resetLoginThrottle();
  clock = Date.parse(`${DAY}T06:00:00Z`);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  db = openDatabase(':memory:');
  app = buildApp(db);
});
afterEach(async () => {
  await app.close();
  db.close();
  vi.useRealTimers();
});

interface Group { item: string; warehouse: string; supplier: string; currency: string; q: number; v: number; c: number }
const groups = (): Group[] => (db.prepare(`SELECT item_id AS item, warehouse_id AS warehouse, supplier_id AS supplier, currency, SUM(qty_milli) AS q, SUM(value) AS v, SUM(ccy_value) AS c
  FROM consignment_moves GROUP BY item_id, warehouse_id, supplier_id, currency`).all() as unknown as Group[]).map((g) => ({ ...g, q: Number(g.q), v: Number(g.v), c: Number(g.c) }));
const stockOf = (item: string, warehouse: string) => {
  const r = db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q, COALESCE(SUM(value), 0) AS v FROM stock_moves WHERE item_id = ? AND warehouse_id = ?').get(item, warehouse) as { q: number; v: number };
  return { q: Number(r.q), v: Number(r.v) };
};

type Kind = 'terms' | 'newSupplier' | 'receipt' | 'sendBack' | 'sale' | 'customerReturn' | 'returnCancel' | 'saleCancel' | 'transfer' | 'docCancel' | 'settle';

async function history(seed: number, done: Map<Kind, number>): Promise<void> {
  const rnd = random(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
  const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  await must('POST', '/api/plan/trial', {});
  const w1 = (await must('GET', '/api/warehouses'))[0].id as string;
  const w2 = (await must('POST', '/api/warehouses', { code: 'W2', name: { ar: 'مخزن ٢', en: 'Second store', ku: 'کۆگای ٢' } })).id as string;
  const warehouses = [w1, w2];
  const suppliers: string[] = [];
  for (const name of ['First Bakery', 'Second Bakery', 'Third Bakery']) suppliers.push((await must('POST', '/api/parties', { type: 'supplier', name })).id);
  const customer = (await must('POST', '/api/parties', { type: 'customer', name: 'Bazaar' })).id as string;
  const items: string[] = [];
  for (const code of ['SAMOON', 'LABAN']) items.push((await must('POST', '/api/items', { code, name: { ar: code, en: code, ku: code }, unit: 'piece', salePrice: 2_000, saleCurrency: 'IQD' })).id);

  const terms = new Map<string, { supplier: string; currency: 'IQD' | 'USD' }>();
  const sales: { id: string; item: string; qty: number[]; cancelled?: boolean }[] = [];
  const returns: { id: string; cancelled?: boolean }[] = [];
  const docs: { id: string; cancelled?: boolean }[] = [];
  const tick = (kind: Kind) => done.set(kind, (done.get(kind) ?? 0) + 1);
  /** a quantity in halves of a unit, so shares never divide evenly */
  const some = (most: number) => Math.min(most, between(1, 12) * 500);

  const setTerms = async (item: string) => {
    const had = terms.get(item);
    const want = { supplier: pick(suppliers), currency: pick(['IQD', 'USD'] as const) };
    const cost = (currency: 'IQD' | 'USD') => (currency === 'IQD' ? between(5, 14) * 77 : between(40, 130));
    let r = await call('PUT', `/api/consignment/items/${item}`, { supplierId: want.supplier, currency: want.currency, unitCost: cost(want.currency) });
    if (r.statusCode < 300) { terms.set(item, want); return r; }
    // goods of the present supplier are on the shelf: only the agreed cost changes
    if (had) r = await call('PUT', `/api/consignment/items/${item}`, { supplierId: had.supplier, currency: had.currency, unitCost: cost(had.currency) });
    return r;
  };
  for (const item of items) expect((await setTerms(item)).statusCode).toBeLessThan(300);

  const sell = async (item: string, warehouse: string, quantities: number[]) => {
    const draft = await must('POST', '/api/invoices', {
      kind: 'sale', date: DAY, partyId: customer, warehouseId: warehouse, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: quantities.map((qtyMilli) => ({ itemId: item, qtyMilli, unitPrice: 2_000 }))
    });
    const r = await call('POST', `/api/invoices/${draft.id}/post`, {});
    if (r.statusCode < 300) sales.push({ id: draft.id, item, qty: quantities });
    return r;
  };

  const check = (where: string, end = false) => {
    const all = groups();
    // a dinar row is worth its dinars
    expect(Number((db.prepare("SELECT COUNT(*) AS n FROM consignment_moves WHERE currency = 'IQD' AND ccy_value <> value").get() as { n: number }).n), `${where}: dinar rows`).toBe(0);
    for (const item of items) for (const warehouse of warehouses) {
      const mine = all.filter((g) => g.item === item && g.warehouse === warehouse);
      const s = stockOf(item, warehouse);
      // the suppliers' side of the stock is the stock
      expect({ q: mine.reduce((t, g) => t + g.q, 0), v: mine.reduce((t, g) => t + g.v, 0) }, `${where}: the stock of ${item === items[0] ? 'item 1' : 'item 2'}`).toEqual(s);
      for (const g of mine) {
        expect(g.q, `${where}: quantity`).toBeGreaterThanOrEqual(0);
        // nothing of anybody's on this shelf: nobody has dinars or dollars left on it
        if (s.q === 0 || end) expect({ q: g.q, v: g.v, c: g.c }, `${where}: a supplier with no goods (${g.currency})`).toEqual({ q: 0, v: 0, c: 0 });
        // a supplier with none of its goods here has no dinars and no dollars on it. (Only the item's present
        // supplier may carry dinars with no goods, while an earlier supplier's unit is still on the shelf: what the
        // shelf's one average put on that unit beyond what it is carried at; it goes out with it. Never dollars.)
        const present = terms.get(item)!;
        if (g.q === 0 && !(g.supplier === present.supplier && g.currency === present.currency) && (g.v !== 0 || g.c !== 0)) {
          // (what happened on that shelf, for whoever reads the failure)
          const rows = (db.prepare('SELECT supplier_id, currency, kind, source_type, qty_milli, value, ccy_value FROM consignment_moves WHERE item_id = ? AND warehouse_id = ? ORDER BY created_at').all(item, warehouse) as
            { supplier_id: string; currency: string; kind: string; source_type: string; qty_milli: number; value: number; ccy_value: number }[])
            .map((r) => `${suppliers.indexOf(r.supplier_id) + 1}${r.currency} ${r.source_type} ${r.qty_milli} ${r.value} ${r.ccy_value}`).join(' | ');
          expect({ v: g.v, c: g.c }, `${where}: an earlier supplier with no goods (supplier ${suppliers.indexOf(g.supplier) + 1} ${g.currency}; present ${suppliers.indexOf(present.supplier) + 1} ${present.currency}): ${rows}`).toEqual({ v: 0, c: 0 });
        }
        if (g.q === 0 && g.currency === 'USD') expect(g.c, `${where}: dollars on a supplier with no goods`).toBe(0);
      }
    }
  };

  const kinds: [Kind, number][] = [['terms', 6], ['newSupplier', 7], ['receipt', 14], ['sendBack', 6], ['sale', 20], ['customerReturn', 14], ['returnCancel', 8], ['saleCancel', 6], ['transfer', 8], ['docCancel', 4], ['settle', 4]];
  const weight = kinds.reduce((s, [, w]) => s + w, 0);

  for (let step = 0; step < STEPS; step++) {
    let at = rnd() * weight;
    const kind = kinds.find(([, w]) => (at -= w) < 0)![0];
    const item = pick(items);
    const warehouse = pick(warehouses);
    const t = terms.get(item)!;
    const has = stockOf(item, warehouse).q;
    let res: { statusCode: number; body: string; json(): any } | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (kind === 'terms') res = await setTerms(item);
    else if (kind === 'newSupplier') {
      // the shelves are sold empty, and the item goes to another supplier (or the other currency): what customers
      // bring back afterwards is the earlier supplier's, on a shelf that now takes the new one's goods
      for (const w of warehouses) {
        const left = stockOf(item, w).q;
        if (left > 0) expect((await sell(item, w, [left])).statusCode).toBeLessThan(300);
      }
      const others = suppliers.filter((x) => x !== t.supplier);
      const next = { supplier: pick(others), currency: pick(['IQD', 'USD'] as const) };
      res = await call('PUT', `/api/consignment/items/${item}`, { supplierId: next.supplier, currency: next.currency, unitCost: next.currency === 'IQD' ? between(5, 14) * 77 : between(40, 130) });
      if (res.statusCode < 300) terms.set(item, next);
    } else if (kind === 'receipt' || kind === 'sendBack') {
      if (kind === 'sendBack' && has <= 0) continue;
      const draft = await call('POST', '/api/consignment/docs', {
        kind: kind === 'receipt' ? 'receipt' : 'return', date: DAY, supplierId: t.supplier, warehouseId: warehouse,
        ...(t.currency === 'USD' ? { rateX100: between(1_300, 1_550) * 100 } : {}),
        lines: [{ itemId: item, qtyMilli: kind === 'receipt' ? some(6_000) : some(has), ...(kind === 'receipt' && rnd() < 0.3 ? { unitCost: t.currency === 'IQD' ? between(5, 14) * 77 : between(40, 130) } : {}) }]
      });
      res = draft;
      if (draft.statusCode < 300) {
        res = await call('POST', `/api/consignment/docs/${draft.json().id}/post`, { lang: 'en' });
        if (res.statusCode < 300) docs.push({ id: draft.json().id });
      }
    } else if (kind === 'sale') {
      if (has <= 0) continue;
      const first = some(has);
      const second = rnd() < 0.3 && has - first > 0 ? some(has - first) : 0;
      res = await sell(item, warehouse, second ? [first, second] : [first]);
    } else if (kind === 'customerReturn') {
      const live = sales.filter((s) => !s.cancelled);
      if (!live.length) continue;
      const sale = pick(live);
      const lineNo = between(1, sale.qty.length);
      res = await call('POST', `/api/invoices/${sale.id}/returns`, { date: DAY, payment: 'credit', lines: [{ lineNo, qtyMilli: some(sale.qty[lineNo - 1]!) }] });
      if (res.statusCode < 300) returns.push({ id: res.json().id });
    } else if (kind === 'returnCancel') {
      const live = returns.filter((r) => !r.cancelled);
      if (!live.length) continue;
      const ret = pick(live);
      res = await call('POST', `/api/invoices/${ret.id}/cancel`, {});
      if (res.statusCode < 300) ret.cancelled = true;
    } else if (kind === 'saleCancel') {
      const live = sales.filter((s) => !s.cancelled);
      if (!live.length) continue;
      const sale = pick(live);
      res = await call('POST', `/api/invoices/${sale.id}/cancel`, {});
      if (res.statusCode < 300) sale.cancelled = true;
    } else if (kind === 'transfer') {
      if (has <= 0) continue;
      const draft = await must('POST', '/api/stock-docs', { kind: 'transfer', date: DAY, warehouseId: warehouse, toWarehouseId: warehouse === w1 ? w2 : w1, lines: [{ itemId: item, qtyMilli: some(has) }] });
      res = await call('POST', `/api/stock-docs/${draft.id}/post`, {});
    } else if (kind === 'docCancel') {
      const live = docs.filter((d) => !d.cancelled);
      if (!live.length) continue;
      const doc = pick(live);
      res = await call('POST', `/api/consignment/docs/${doc.id}/cancel`, {});
      if (res.statusCode < 300) doc.cancelled = true;
    } else {
      // what one of the item's suppliers is owed so far, in its currency (refused when nothing is owed yet)
      res = await call('POST', '/api/consignment/settlements', { supplierId: t.supplier, currency: t.currency, date: DAY, ...(t.currency === 'USD' ? { rateX100: 145_000 } : {}) });
    }
    expect(res.statusCode, `seed ${seed} step ${step} ${kind}: ${res.body}`).toBeLessThan(500);
    if (res.statusCode < 300) tick(kind);
    check(`seed ${seed} step ${step} (${kind} → ${res.statusCode})`);
  }

  // the end: everything on every shelf is sold
  for (const item of items) for (const warehouse of warehouses) {
    const left = stockOf(item, warehouse).q;
    if (left > 0) expect((await sell(item, warehouse, [left])).statusCode, `seed ${seed}: selling out`).toBeLessThan(300);
  }
  check(`seed ${seed} at the end`, true);
  // each supplier is owed, in its currency, exactly what it delivered less what went back to it (settled or not)
  const owed = db.prepare(`SELECT supplier_id, currency, SUM(CASE WHEN kind = 'sold' THEN -ccy_value ELSE 0 END) AS sold, SUM(CASE WHEN kind IN ('received', 'returned') THEN ccy_value ELSE 0 END) AS kept
                           FROM consignment_moves GROUP BY supplier_id, currency`).all() as { supplier_id: string; currency: string; sold: number; kept: number }[];
  for (const o of owed) expect(Number(o.sold), `seed ${seed}: owed to a supplier in ${o.currency}`).toBe(Number(o.kept));
}

describe('goods on consignment, random histories', () => {
  const done = new Map<Kind, number>();
  // one seed again, as it was: QASA_CONSIGNMENT_SEED=11
  const only = Number(process.env.QASA_CONSIGNMENT_SEED ?? '') || 0;
  for (let seed = only || 1; seed <= (only || SEEDS); seed++) {
    it(`seed ${seed}: ${STEPS} random steps end exact, in dinars and in dollars`, async () => {
      await history(seed, done);
    }, 120_000);
  }
  it.skipIf(!!only)('went through every kind of step', () => {
    for (const kind of ['terms', 'newSupplier', 'receipt', 'sendBack', 'sale', 'customerReturn', 'returnCancel', 'saleCancel', 'transfer', 'docCancel', 'settle'] as const) {
      expect(done.get(kind) ?? 0, kind).toBeGreaterThan(0);
    }
  });
});
