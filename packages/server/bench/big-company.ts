/**
 * A big company, to see what gets slow after a year or more of work (a developer's tool, never shipped):
 *
 *   node --experimental-strip-types packages/server/bench/big-company.ts seed  /tmp/big.sqlite   # builds it once
 *   node --experimental-strip-types packages/server/bench/big-company.ts measure /tmp/big.sqlite # times the screens
 *
 * QASA_BIG_ITEMS (100000), QASA_BIG_SALES (100000 sales of QASA_BIG_LINES = 5 lines), QASA_BIG_CUSTOMERS (2000).
 * Everything goes through the app's own functions (items, purchases, sales are posted as the app posts them), so
 * stock, cost and the books are what a real shop's would be. Measuring goes through the API, as the app's screens do.
 */
import { existsSync, rmSync, statSync } from 'node:fs';
import { openDatabase, type Db } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { createItem, listWarehouses } from '../src/items.ts';
import { createParty } from '../src/parties.ts';
import { createInvoice, postInvoice } from '../src/invoices.ts';

const [mode = 'measure', file = '/tmp/qasa-big.sqlite'] = process.argv.slice(2);
const ITEMS = Number(process.env.QASA_BIG_ITEMS ?? 100_000);
const SALES = Number(process.env.QASA_BIG_SALES ?? 100_000);
const LINES = Number(process.env.QASA_BIG_LINES ?? 5);
const CUSTOMERS = Number(process.env.QASA_BIG_CUSTOMERS ?? 2_000);
const user = 'Bench';

/** a repeatable random number, so two runs build the same company */
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
const dayOf = (n: number) => new Date(Date.UTC(2025, 10, 26) + n * 86_400_000).toISOString().slice(0, 10);

function step(label: string, total: number, each: (i: number) => void): void {
  const t0 = performance.now();
  let last = t0;
  for (let i = 0; i < total; i++) {
    each(i);
    const now = performance.now();
    if (now - last > 10_000) {
      const rate = (i + 1) / ((now - t0) / 1000);
      console.log(`  ${label}: ${i + 1}/${total}, ${rate.toFixed(0)}/s, about ${((total - i - 1) / rate / 60).toFixed(1)} min left`);
      last = now;
    }
  }
  console.log(`${label}: ${total} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

function seedCompany(db: Db): void {
  const warehouse = listWarehouses(db)[0]!.id;
  const items: string[] = [];
  const prices = new Map<string, number>();
  step('items', ITEMS, (i) => {
    const price = 250 * (2 + Math.floor(rnd() * 400));
    const made = createItem(db, {
      barcode: `62${String(i).padStart(11, '0')}`,
      name: { ar: `مادة رقم ${i}`, en: `Item number ${i}`, ku: `کاڵای ژمارە ${i}` },
      unit: 'piece', salePrice: price, saleCurrency: 'IQD', purchasePrice: Math.round(price * 0.8), purchaseCurrency: 'IQD'
    }, user);
    items.push(made.id);
    prices.set(made.id, price);
  });
  const supplier = createParty(db, 'supplier', { name: 'Big supplier' }, user).id;
  const customers: string[] = [];
  step('customers', CUSTOMERS, (i) => customers.push(createParty(db, 'customer', { name: `Customer ${i}`, phone: `0750${String(i).padStart(7, '0')}` }, user).id));
  // a year's stock, bought in at the start: 200 items to a purchase invoice
  const per = 200;
  step('purchases', Math.ceil(items.length / per), (n) => {
    const lines = items.slice(n * per, (n + 1) * per).map((itemId) => ({ itemId, qtyMilli: 10_000_000, unitPrice: Math.round(prices.get(itemId)! * 0.8) }));
    const inv = createInvoice(db, { kind: 'purchase', date: dayOf(0), partyId: supplier, warehouseId: warehouse, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0, lines }, user);
    postInvoice(db, inv.id, user);
  });
  // a year of sales: most items sell now and then, a few hundred sell every day
  const popular = items.slice(0, Math.min(500, items.length));
  step('sales', SALES, (n) => {
    const lines = Array.from({ length: LINES }, () => {
      const itemId = rnd() < 0.6 ? pick(popular) : pick(items);
      return { itemId, qtyMilli: 1000 * (1 + Math.floor(rnd() * 3)), unitPrice: prices.get(itemId)! };
    });
    const credit = rnd() < 0.2;
    const inv = createInvoice(db, {
      kind: 'sale', date: dayOf(1 + Math.floor((n / SALES) * 364)), warehouseId: warehouse, currency: 'IQD', rateX100: 100, discount: 0, lines,
      ...(credit ? { payment: 'credit', partyId: pick(customers) } : { payment: 'cash', cashAccountCode: '1811' })
    }, user);
    postInvoice(db, inv.id, user);
  });
}

async function measure(db: Db): Promise<void> {
  const app = buildApp(db);
  const headers = { 'x-qasa-client': '1' };
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  console.log(`company: ${count('SELECT COUNT(*) AS n FROM items')} items, ${count("SELECT COUNT(*) AS n FROM invoices WHERE kind = 'sale'")} sales, ${count('SELECT COUNT(*) AS n FROM invoice_lines')} invoice lines, ${count('SELECT COUNT(*) AS n FROM entries')} entries`);
  const today = dayOf(364);
  const month = today.slice(0, 7);
  const anyItem = db.prepare('SELECT id, barcode FROM items ORDER BY rowid DESC LIMIT 1').get() as { id: string; barcode: string };
  const anyCustomer = db.prepare("SELECT id FROM parties WHERE type = 'customer' LIMIT 1 OFFSET 7").get() as { id: string } | undefined;
  const checks: [string, string][] = [
    ['till/invoice: all active items (what the till loads)', '/api/items?active=true'],
    ['items page: search by name', '/api/items?q=number%2098765'],
    ['scan a barcode', `/api/items?barcode=${anyItem.barcode}`],
    ['one item', `/api/items/${anyItem.id}`],
    ['invoices list', '/api/invoices'],
    ['customers list', '/api/parties?type=customer'],
    ['customer balances', '/api/parties/totals?type=customer'],
    ...(anyCustomer ? [['customer statement', `/api/parties/${anyCustomer.id}/statement`] as [string, string]] : []),
    ['journal entries', '/api/entries'],
    ['trial balance', '/api/reports/trial-balance'],
    ['final accounts (year)', `/api/reports/final-accounts?from=${dayOf(0)}&to=${today}`],
    ['cash account statement', '/api/reports/statement?account=1811'],
    ['brief (home)', `/api/brief?date=${today}`],
    ['dashboard', `/api/brief/dashboard?date=${today}`],
    ['day close', `/api/brief/day-close?date=${today}`],
    ['sales by item (month)', `/api/brief/reports/sales-by-item?from=${month}-01&to=${today}`],
    ['sales by customer (month)', `/api/brief/reports/sales-by-customer?from=${month}-01&to=${today}`],
    ['stock value', '/api/brief/reports/stock-value'],
    ['slow stock', '/api/brief/reports/slow-stock'],
    ['aging (customers)', '/api/brief/reports/aging?type=customer'],
    ['reorder list', '/api/stock/reorder']
  ];
  console.log('\nscreen | ms (best of 3) | response size');
  for (const [label, url] of checks) {
    let best = Infinity;
    let size = 0;
    let status = 0;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const res = await app.inject({ method: 'GET', url, headers });
      best = Math.min(best, performance.now() - t0);
      size = res.body.length;
      status = res.statusCode;
    }
    console.log(`${label} | ${best.toFixed(0)} | ${(size / 1024).toFixed(0)} KB${status !== 200 ? ` (status ${status})` : ''}`);
  }
  // a sale at the till, as the till makes it
  const warehouse = listWarehouses(db)[0]!.id;
  const shift = await app.inject({ method: 'POST', url: '/api/pos/shifts', headers, payload: { register: `Bench ${Date.now()}`, cashAccountCode: '1811', warehouseId: warehouse, openingCash: 0 } });
  const shiftId = shift.json().id as string | undefined;
  if (shiftId) {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const res = await app.inject({ method: 'POST', url: `/api/pos/shifts/${shiftId}/sales`, headers, payload: { currency: 'IQD', discount: 0, lines: [{ itemId: anyItem.id, qtyMilli: 1000, unitPrice: 500 }] } });
      times.push(performance.now() - t0);
      if (res.statusCode !== 200 && res.statusCode !== 201) { console.log(`till sale: status ${res.statusCode} ${res.body.slice(0, 200)}`); break; }
    }
    console.log(`till sale (one line) | ${Math.min(...times).toFixed(0)} | median ${times.sort((a, b) => a - b)[Math.floor(times.length / 2)]!.toFixed(0)}`);
  } else {
    console.log(`till: no shift (${shift.statusCode} ${shift.body.slice(0, 160)})`);
  }
  // a backup, as the Windows app makes it (VACUUM INTO, apps/desktop/src/company-api.ts)
  const target = `${file}.backup`;
  if (existsSync(target)) rmSync(target);
  const t0 = performance.now();
  db.exec(`VACUUM INTO '${target}'`);
  console.log(`backup | ${(performance.now() - t0).toFixed(0)} | ${(statSync(target).size / 1024 / 1024).toFixed(1)} MB`);
  rmSync(target);
  await app.close();
}

if (mode === 'seed') {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) rmSync(f);
  const db = openDatabase(file);
  const t0 = performance.now();
  seedCompany(db);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  console.log(`seeded in ${((performance.now() - t0) / 60000).toFixed(1)} min: ${file}`);
} else {
  const t0 = performance.now();
  const db = openDatabase(file);
  console.log(`opened in ${(performance.now() - t0).toFixed(0)} ms`);
  await measure(db);
  db.close();
}
