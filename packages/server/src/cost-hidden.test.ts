import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { apiRoutes } from './routes.ts';

// 1.4: what things cost, what the stock is worth and what a sale earns are for those who buy, keep the stock or keep
// the books. A cashier (a user with the sales role only) gets none of it from any route they can read: this walks
// every GET route of the API as each kind of user.

let db: Db;
let app: FastifyInstance;
type Headers = Record<string, string>;
const owner: Headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
let admin: Headers = owner;
let cashier: Headers;
let keeper: Headers;
let buyer: Headers;
let accountant: Headers;
let viewer: Headers;

const post = (url: string, body: unknown = {}, h: Headers = admin) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const put = (url: string, body: unknown = {}, h: Headers = admin) => app.inject({ method: 'PUT', url, payload: body as object, headers: h });
const get = (url: string, h: Headers = admin) => app.inject({ url, headers: h });

async function made(res: Promise<{ statusCode: number; body: string; json(): any }>, status = 201): Promise<any> {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r.json();
}

async function signIn(username: string, password: string): Promise<Headers> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: { 'x-qasa-client': '1' } });
  expect(res.statusCode, res.body).toBe(200);
  return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
}

const one = (text: string) => ({ ar: text, en: text, ku: text });

// prices no sale price or total of this company happens to equal: found in an answer, they were sent
const OPENING_COST = 1_519;
const TEA_PURCHASE_PRICE = 1_537;
const TEA_BOUGHT_AT = 1_713;
const SYRUP_PURCHASE_PRICE = 3_011;
const SYRUP_BOUGHT_AT = 3_037;
const ORDERED_AT = 1_651;
const CUP_BOUGHT_AT = 733;
/** Those, and what the server worked out from them (the cost of each line sold, the value of the stock). */
const secrets = new Set<number>([OPENING_COST, TEA_PURCHASE_PRICE, TEA_BOUGHT_AT, SYRUP_PURCHASE_PRICE, SYRUP_BOUGHT_AT, ORDERED_AT, CUP_BOUGHT_AT]);

/** What stands in for the ":id" of each route, the query a route needs, and more addresses than one per route. */
const ids: Record<string, string> = {};
const QUERY: Record<string, string> = {};
const EXTRA: string[] = [];
/** Addresses the checks below name. */
const at: Record<string, string> = {};
/** Routes whose record this company has none of (cheques, bank statements, fixed assets, item pictures): 404 for everyone. */
const NO_RECORD = new Set(['/api/banking/cheques/:id', '/api/banking/statements/:id', '/api/assets/depreciation/:id', '/api/assets/:id', '/api/items/:id/image']);

beforeAll(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  await made(post('/api/plan/trial'), 200);
  const today = todayIso();
  const month = today.slice(0, 7);
  const warehouseId = (await get('/api/warehouses')).json()[0].id as string;
  const storeId = (await made(post('/api/warehouses', { code: 'W2', name: one('Store') }))).id as string;
  const customerId = (await made(post('/api/parties', { type: 'customer', name: 'Raz', accountCode: '1612' }))).id as string;
  const supplierId = (await made(post('/api/parties', { type: 'supplier', name: 'Las' }))).id as string;
  const categoryId = (await made(post('/api/item-categories', { name: one('Drinks'), reorderMilli: 900_000 }))).id as string;
  const brandId = (await made(post('/api/brands', { name: 'Chai' }))).id as string;
  const teaId = (await made(post('/api/items', {
    code: 'TEA', barcode: '6260000000017', name: one('Tea'), unit: 'piece', salePrice: 2_500, saleCurrency: 'IQD',
    purchasePrice: TEA_PURCHASE_PRICE, purchaseCurrency: 'IQD', reorderMilli: 500_000, categoryId, brandId,
    units: [{ unit: 'box', factorMilli: 12_000, barcode: '6260000000024', salePrice: 28_000 }]
  }))).id as string;
  const medId = (await made(post('/api/items', {
    code: 'MED', name: one('Syrup'), unit: 'piece', salePrice: 4_000, saleCurrency: 'IQD', purchasePrice: SYRUP_PURCHASE_PRICE, purchaseCurrency: 'IQD',
    trackBatches: true, trackExpiry: true, categoryId
  }))).id as string;

  // stock comes in: opening stock, a purchase (with a batch), a transfer to the second warehouse, a purchase return
  const invoice = (kind: string, partyId: string, lines: object[], extra: object = {}) =>
    ({ kind, date: today, partyId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0, lines, ...extra });
  const opening = await made(post('/api/stock-docs', { kind: 'opening', date: today, warehouseId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 60_000, unitCost: OPENING_COST }] }));
  await made(post(`/api/stock-docs/${opening.id}/post`), 200);
  const purchase = await made(post('/api/invoices', invoice('purchase', supplierId, [
    { itemId: teaId, qtyMilli: 40_000, unitPrice: TEA_BOUGHT_AT }, { itemId: medId, qtyMilli: 30_000, unitPrice: SYRUP_BOUGHT_AT, batchNo: 'B-1', expiry: addDays(today, 20) }
  ])));
  await made(post(`/api/invoices/${purchase.id}/post`), 200);
  const transfer = await made(post('/api/stock-docs', { kind: 'transfer', date: today, warehouseId, toWarehouseId: storeId, lines: [{ itemId: teaId, qtyMilli: 5_000 }] }));
  await made(post(`/api/stock-docs/${transfer.id}/post`), 200);
  const purchaseReturn = await made(post(`/api/invoices/${purchase.id}/returns`, { date: today, payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 1_000 }] }));

  // stock goes out: a sale, a return of part of it, a draft, a till shift with a sale, a quotation
  const sale = await made(post('/api/invoices', invoice('sale', customerId, [{ itemId: teaId, qtyMilli: 10_000, unitPrice: 2_500 }, { itemId: medId, qtyMilli: 2_000, unitPrice: 4_000 }])));
  await made(post(`/api/invoices/${sale.id}/post`), 200);
  const saleReturn = await made(post(`/api/invoices/${sale.id}/returns`, { date: today, payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 1_000 }] }));
  const draftSale = await made(post('/api/invoices', invoice('sale', customerId, [{ itemId: teaId, qtyMilli: 1_000, unitPrice: 2_500 }])));
  const closedShift = await made(post('/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 50_000 }));
  const tillSale = await made(post(`/api/pos/shifts/${closedShift.id}/sales`, { currency: 'IQD', lines: [{ itemId: teaId, qtyMilli: 3_000, unitPrice: 2_500 }] }));
  await made(post(`/api/pos/shifts/${closedShift.id}/close`, { countedCash: 57_500 }), 200);
  // an item bought and sold out: the list of what to order names it, with the last price paid
  const cupId = (await made(post('/api/items', { code: 'CUP', name: one('Cup'), unit: 'piece', salePrice: 1_250, saleCurrency: 'IQD' }))).id as string;
  const cups = await made(post('/api/invoices', invoice('purchase', supplierId, [{ itemId: cupId, qtyMilli: 2_000, unitPrice: CUP_BOUGHT_AT }])));
  await made(post(`/api/invoices/${cups.id}/post`), 200);
  const cupsSold = await made(post('/api/invoices', invoice('sale', customerId, [{ itemId: cupId, qtyMilli: 2_000, unitPrice: 1_250 }])));
  await made(post(`/api/invoices/${cupsSold.id}/post`), 200);
  const quote = await made(post('/api/quotes', { date: today, partyId: customerId, currency: 'IQD', lines: [{ itemId: teaId, description: 'Tea', qtyMilli: 5_000, unitPrice: 2_400 }] }));

  // the stock is corrected and counted, an order waits at the supplier, a wholesale price is set
  const adjustment = await made(post('/api/adjustments', { date: today, warehouseId, reason: 'damaged', lines: [{ itemId: teaId, qtyMilli: -2_000 }] }));
  await made(post(`/api/adjustments/${adjustment.id}/post`), 200);
  const count = await made(post('/api/adjustments/counts', { date: today, warehouseId: storeId, full: true }));
  await made(put(`/api/adjustments/counts/${count.id}`, { counts: [{ itemId: teaId, countedMilli: 4_000 }] }), 200);
  const order = await made(post('/api/purchase-orders', { date: today, partyId: supplierId, warehouseId, currency: 'IQD', lines: [{ itemId: teaId, qtyMilli: 100_000, unitPrice: ORDERED_AT }] }));
  await made(post(`/api/purchase-orders/${order.id}/status`, { action: 'send' }), 200);
  await made(put(`/api/prices/item/${teaId}`, { wholesale: 2_200 }), 200);
  await made(put(`/api/prices/party/${customerId}`, { list: 'wholesale' }), 200);
  const entryId = (db.prepare('SELECT entry_id FROM invoices WHERE id = ?').get(sale.id) as { entry_id: string }).entry_id;

  // what the server worked out: the cost of every line sold or returned, the value of every stock movement and of the stock
  for (const r of db.prepare('SELECT cost AS n FROM invoice_lines WHERE cost IS NOT NULL').all() as { n: number }[]) secrets.add(Math.abs(Number(r.n)));
  for (const r of db.prepare('SELECT value AS n FROM stock_moves').all() as { n: number }[]) secrets.add(Math.abs(Number(r.n)));
  for (const r of db.prepare('SELECT SUM(value) AS n FROM stock_moves GROUP BY item_id, warehouse_id').all() as { n: number }[]) secrets.add(Number(r.n));
  secrets.add(Number((db.prepare('SELECT SUM(value) AS n FROM stock_moves').get() as { n: number }).n));
  secrets.delete(0);

  Object.assign(ids, {
    '/api/entries/:id': entryId,
    '/api/parties/:id': customerId, '/api/parties/:id/statement': customerId,
    '/api/items/:id': teaId, '/api/items/:id/image': teaId,
    '/api/invoices/:id': sale.id, '/api/verify/invoices/:id': sale.id,
    '/api/stock-docs/:id': opening.id,
    '/api/pos/shifts/:id': closedShift.id,
    '/api/quotes/:id': quote.id,
    '/api/adjustments/:id': adjustment.id, '/api/adjustments/counts/:id': count.id,
    '/api/purchase-orders/:id': order.id,
    '/api/prices/party/:id': customerId, '/api/prices/item/:id': teaId,
    '/api/loyalty/parties/:id': customerId
  });
  Object.assign(QUERY, {
    '/api/reports/final-accounts': `from=${today.slice(0, 4)}-01-01&to=${today}`,
    '/api/reports/statement': 'account=1811',
    '/api/brief/reports/sales-by-group': 'by=category',
    '/api/brief/reports/aging': 'type=customer',
    '/api/parties/totals': 'type=customer',
    '/api/brief/expenses': `month=${month}`,
    '/api/assets/depreciation/preview': `period=${month}`,
    '/api/adjustments/count-sheet': `warehouseId=${warehouseId}`,
    '/api/adjustments/counts/open': `warehouseId=${storeId}`,
    '/api/prices': `itemId=${teaId}&partyId=${customerId}`,
    '/api/batches': `itemId=${medId}`,
    '/api/batches/report': 'state=all'
  });
  Object.assign(at, {
    scan: '/api/items?barcode=6260000000017', boxScan: '/api/items?barcode=6260000000024', search: `/api/items?q=tea&warehouseId=${warehouseId}`,
    item: `/api/items/${teaId}`, syrup: `/api/items/${medId}`,
    sale: `/api/invoices/${sale.id}`, purchase: `/api/invoices/${purchase.id}`, purchases: '/api/invoices?kind=purchase',
    saleReturn: `/api/invoices/${saleReturn.id}`, purchaseReturn: `/api/invoices/${purchaseReturn.id}`,
    draftSale: `/api/invoices/${draftSale.id}`, tillSale: `/api/invoices/${tillSale.invoice.id}`,
    opening: `/api/stock-docs/${opening.id}`, transfer: `/api/stock-docs/${transfer.id}`,
    adjustment: `/api/adjustments/${adjustment.id}`, count: `/api/adjustments/counts/${count.id}`,
    batches: `/api/batches?itemId=${medId}`, order: `/api/purchase-orders/${order.id}`, entry: `/api/entries/${entryId}`,
    supplierStatement: `/api/parties/${supplierId}/statement`, customerStatement: `/api/parties/${customerId}/statement`,
    warehouseId, customerId, teaId, medId
  });
  // more than one answer of a route: the other documents, the item lists as the till and the screens ask for them
  EXTRA.push(
    at.scan!, at.boxScan!, at.search!, at.syrup!, at.purchase!, at.saleReturn!, at.purchaseReturn!, at.draftSale!, at.tillSale!, at.purchases!, at.transfer!,
    `/api/stock/reorder?warehouseId=${warehouseId}`, '/api/invoices?kind=sale', '/api/invoices?kind=purchase_return',
    '/api/brief/reports/sales-by-group?by=brand', '/api/brief/reports/aging?type=supplier', `/api/parties/${supplierId}`, at.supplierStatement!,
    '/api/reports/statement?account=35', '/api/entries?type=sale', '/api/batches/report?state=near', '/api/parties?type=supplier', '/api/parties/totals?type=supplier'
  );

  // from here on everyone signs in: the admin, a cashier, a storekeeper, a buyer, an accountant and a viewer
  const first = (await get('/api/users')).json()[0] as { id: string; username: string };
  await made(post(`/api/users/${first.id}/password`, { password: 'admin-pass-123' }), 200);
  for (const [username, name, role] of [['raz', 'Raz', 'sales'], ['las', 'Las', 'storekeeper'], ['las2', 'Las', 'purchasing'], ['mer', 'Mer', 'preparer'], ['mer2', 'Mer', 'viewer']] as const) {
    await made(post('/api/users', { username, name, password: `${username}-pass-123`, roles: [role] }));
  }
  await made(put('/api/auth/signin', { on: true }), 200);
  admin = await signIn(first.username, 'admin-pass-123');
  cashier = await signIn('raz', 'raz-pass-123');
  keeper = await signIn('las', 'las-pass-123');
  buyer = await signIn('las2', 'las2-pass-123');
  accountant = await signIn('mer', 'mer-pass-123');
  viewer = await signIn('mer2', 'mer2-pass-123');
});

afterAll(async () => {
  await app.close();
  db.close();
});

/** Every key path of a JSON answer ("[]" for the rows of a list) and every number in it (with where it was found). */
function scan(value: unknown, path = '', out = { paths: new Set<string>(), numbers: new Map<number, string>() }): { paths: Set<string>; numbers: Map<number, string> } {
  if (typeof value === 'number') out.numbers.set(Math.abs(value), path);
  else if (Array.isArray(value)) value.forEach((v) => scan(v, `${path}[]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.paths.add(`${path}.${k}`);
      scan(v, `${path}.${k}`, out);
    }
  }
  return out;
}

interface Answer { route: string; url: string; status: number; paths: Set<string>; numbers: Map<number, string> }

/** Asks every GET route of the API (each with a real record where it takes one), and the extra addresses. */
async function walk(as: Headers): Promise<Answer[]> {
  const routes = apiRoutes(db).filter((r) => r.method === 'GET').map((r) => r.path);
  const asked = routes.map((route) => {
    const params = route.match(/:\w+/g) ?? [];
    // a new route with a record in its address must be given one here, so it is walked with a real answer
    if (params.length && !(route in ids) && !NO_RECORD.has(route)) throw new Error(`no record for ${route}`);
    const url = route.replace(/:\w+/g, ids[route] ?? 'none') + (QUERY[route] ? `?${QUERY[route]}` : '');
    return { route, url };
  });
  const answers: Answer[] = [];
  for (const { route, url } of [...asked, ...EXTRA.map((url) => ({ route: url.split('?')[0]!, url }))]) {
    const res = await get(url, as);
    const body = res.statusCode === 200 && String(res.headers['content-type']).includes('json') ? res.json() : null;
    answers.push({ route, url, status: res.statusCode, ...scan(body) });
  }
  return answers;
}

/** A key that names a cost, a value or a profit. */
const COST_KEY = /cost|profit|margin|value|worth|purchaseprice|purchasecurrency|lastprice/i;
/** Keys with such a name that are none: who sees cost, an account code in the settings, what open quotations and loyalty points are worth. */
const NOT_COST = new Set([
  '/api/auth/me .user.seesCost',
  '/api/settings .postingAccounts.costOfSales',
  '/api/quotes/summary .openValue', '/api/quotes/summary .openValue.IQD', '/api/quotes/summary .openValue.USD',
  '/api/loyalty/settings .rules.pointValue', '/api/loyalty/parties/:id .rules.pointValue', '/api/loyalty/parties/:id .worth'
]);

/** The fields that carry cost, by address: [address, key path]. */
const COST_FIELDS = (): [string, string][] => [
  ['/api/items', '[].value'], ['/api/items', '[].purchasePrice'], ['/api/items', '[].purchaseCurrency'],
  [at.search!, '[].value'], [at.scan!, '.item.value'], [at.scan!, '.item.purchasePrice'], [at.boxScan!, '.item.value'],
  [at.item!, '.value'], [at.item!, '.purchasePrice'], [at.item!, '.stock[].value'], [at.item!, '.moves[].value'], [at.syrup!, '.value'],
  ['/api/warehouses', '[].value'],
  ['/api/stock-docs', '[].totalValue'], [at.opening!, '.totalValue'], [at.opening!, '.lines[].unitCost'], [at.opening!, '.lines[].value'], [at.transfer!, '.lines[].value'],
  ['/api/adjustments', '[].valueOut'], ['/api/adjustments', '[].valueIn'], [at.adjustment!, '.valueOut'], [at.adjustment!, '.lines[].unitCost'], [at.adjustment!, '.lines[].value'],
  [at.count!, '.lines[].unitCost'],
  [at.batches!, '[].value'], ['/api/batches/report?state=all', '.rows[].value'],
  [at.sale!, '.lines[].cost'], [at.saleReturn!, '.lines[].cost'], [at.tillSale!, '.lines[].cost'], [at.draftSale!, '.lines[].cost']
];

/** The fields of the books and their reports, by address. */
const BOOKS_FIELDS = (): [string, string][] => [
  ['/api/accounts', '[].balance'],
  ['/api/brief', '.topItems[].cost'], ['/api/brief', '.topItems[].profit'], ['/api/brief', '.expiry.top[].value'],
  ['/api/brief/dashboard', '.profitMonth.profit'], ['/api/brief/dashboard', '.months[].profit'],
  ['/api/brief/reports/sales-by-item', '.rows[].cost'], ['/api/brief/reports/sales-by-item', '.rows[].profit'],
  ['/api/brief/reports/sales-by-group?by=category', '.rows[].profit'], ['/api/brief/reports/sales-by-group?by=category', '.total.cost'], ['/api/brief/reports/sales-by-group?by=brand', '.total.profit'],
  ['/api/brief/reports/stock-value', '.warehouses[].value'], ['/api/brief/reports/stock-value', '.items[].value'],
  ['/api/brief/day-close', '.topItems[].cost'], ['/api/brief/day-close', '.topItems[].profit'],
  [at.purchases!, '[].total'], [at.purchases!, '[].subtotal'], [at.purchase!, '.total'], [at.purchase!, '.lines[].unitPrice'], [at.purchase!, '.lines[].amount'],
  [at.purchaseReturn!, '.total'], [at.purchaseReturn!, '.lines[].unitPrice'],
  ['/api/purchase-orders/suggest', '[].lines[].lastPrice'], ['/api/purchase-orders', '[].total'], [at.order!, '.total'], [at.order!, '.lines[].unitPrice'], [at.order!, '.lines[].amount'],
  [at.supplierStatement!, '.lines[].credit'], [at.supplierStatement!, '.totalCredit'], [at.entry!, '.lines[].debit'], ['/api/reports/trial-balance', '.rows[].balance'], ['/api/reports/final-accounts', '.netResult'], ['/api/year-end', '.years[].result']
];

/**
 * Refused to a user without the books: an entry of the journal (the list answers, with the vouchers that user prepared
 * and no other: below), the company's books, the stock valuation.
 */
const BOOKS_ROUTES = ['/api/entries/', '/api/reports/', '/api/year-end', '/api/fx/revaluation', '/api/assets', '/api/brief/reports/stock-value'];
const ADMIN_ROUTES = ['/api/audit', '/api/auth/recovery-code', '/api/branches', '/api/users'];
const isOneOf = (route: string, list: string[]) => list.some((p) => route === p || route.startsWith(p.endsWith('/') ? p : `${p}/`));

const find = (answers: Answer[], url: string): Answer => {
  const found = answers.find((a) => a.url === url || a.url.split('?')[0] === url);
  if (!found) throw new Error(`not walked: ${url}`);
  return found;
};
const has = (answers: Answer[], [url, path]: [string, string]) => find(answers, url).paths.has(path);
const missing = (answers: Answer[], fields: [string, string][]) => fields.filter((f) => !has(answers, f)).map((f) => f.join(' '));
const present = (answers: Answer[], fields: [string, string][]) => fields.filter((f) => has(answers, f)).map((f) => f.join(' '));
const refused = (answers: Answer[]) => [...new Set(answers.filter((a) => a.status === 403).map((a) => a.route))].sort();
const failed = (answers: Answer[]) => answers.filter((a) => a.status !== 200 && a.status !== 403 && !(a.status === 404 && NO_RECORD.has(a.route))).map((a) => `${a.status} ${a.url}`);

describe('cost, stock value and profit, by who asks', () => {
  it('an admin still gets every field, from every route', async () => {
    const answers = await walk(admin);
    expect(failed(answers)).toEqual([]);
    expect(refused(answers)).toEqual([]);
    expect(missing(answers, [...COST_FIELDS(), ...BOOKS_FIELDS()])).toEqual([]);
    // and the numbers behind them are the ones this test looks for in a cashier's answers
    const numbers = new Set(answers.flatMap((a) => [...a.numbers.keys()]));
    expect([...secrets].filter((n) => !numbers.has(n))).toEqual([]);
  });

  it('a cashier gets no cost, value or profit key from any route, and none of the numbers under another name', async () => {
    const answers = await walk(cashier);
    expect(failed(answers)).toEqual([]);
    // refused: the books and what only an admin reads; everything else answers
    const expected = [...new Set(answers.map((a) => a.route).filter((r) => isOneOf(r, BOOKS_ROUTES) || ADMIN_ROUTES.includes(r)))].sort();
    expect(refused(answers)).toEqual(expected);
    expect(answers.filter((a) => a.status === 200).length).toBeGreaterThan(70);

    const keys = answers.flatMap((a) => [...a.paths].filter((p) => COST_KEY.test(p.split('.').pop()!) && !NOT_COST.has(`${a.route} ${p}`)).map((p) => `${a.url} ${p}`));
    expect(keys).toEqual([]);
    const numbers = answers.flatMap((a) => [...a.numbers].filter(([n]) => secrets.has(n)).map(([n, path]) => `${a.url} ${path} ${n}`));
    expect(numbers).toEqual([]);
    expect(present(answers, COST_FIELDS())).toEqual([]);
    expect(present(answers, BOOKS_FIELDS())).toEqual([]);

    // what a cashier works with is all there: items with their sale prices and stock, the sale with its prices and totals
    expect(has(answers, ['/api/items', '[].salePrice']) && has(answers, ['/api/items', '[].qtyMilli']) && has(answers, [at.item!, '.stock[].qtyMilli'])).toBe(true);
    expect(has(answers, [at.customerStatement!, '.lines[].debit'])).toBe(true);
    // what the customers owe in all, and what the suppliers are owed: balances, as in the two lists, for everyone
    for (const type of ['customer', 'supplier']) {
      expect(find(answers, `/api/parties/totals?type=${type}`).status).toBe(200);
      expect(has(answers, [`/api/parties/totals?type=${type}`, '.owed.IQD'])).toBe(true);
    }
    expect((await get('/api/parties/totals?type=supplier', cashier)).json()).toEqual((await get('/api/parties/totals?type=supplier')).json());
    // the journal's list answers with nothing: this cashier has prepared no voucher, and the rest is not theirs to read
    expect((await get('/api/entries', cashier)).json()).toEqual([]);
    expect((await get('/api/entries?type=sale', cashier)).json()).toEqual([]);
    expect((await get('/api/entries?type=sale')).json().length).toBeGreaterThan(0);
    // a supplier's page opens too: the supplier and the balance owed, without the lines that say what each purchase cost
    expect(find(answers, at.supplierStatement!).status).toBe(200);
    expect(has(answers, [at.supplierStatement!, '.party.name']) && has(answers, [at.supplierStatement!, '.closing'])).toBe(true);
    expect(present(answers, [[at.supplierStatement!, '.totalCredit'], [at.supplierStatement!, '.opening'], [at.supplierStatement!, '.lines[].credit']])).toEqual([]);
    expect(has(answers, [at.sale!, '.total']) && has(answers, [at.sale!, '.lines[].unitPrice']) && has(answers, [at.sale!, '.lines[].amount'])).toBe(true);
    expect(has(answers, ['/api/brief/reports/sales-by-item', '.rows[].sales']) && has(answers, ['/api/brief/day-close', '.topItems[].sales'])).toBe(true);
    // a purchase invoice opens (who may open it is unchanged), without its money
    expect(find(answers, at.purchase!).status).toBe(200);
    expect(has(answers, [at.purchase!, '.lines[].qtyMilli']) && has(answers, [at.purchase!, '.number'])).toBe(true);
  });

  it('a storekeeper and a buyer see cost and the reports, as before', async () => {
    for (const who of [keeper, buyer]) {
      const answers = await walk(who);
      expect(failed(answers)).toEqual([]);
      expect(refused(answers)).toEqual(ADMIN_ROUTES);
      expect(missing(answers, [...COST_FIELDS(), ...BOOKS_FIELDS()])).toEqual([]);
    }
  });

  it('an accountant and a viewer keep the books and the reports, without the cost fields of items and stock', async () => {
    for (const who of [accountant, viewer]) {
      const answers = await walk(who);
      expect(failed(answers)).toEqual([]);
      expect(refused(answers)).toEqual(ADMIN_ROUTES);
      expect(missing(answers, BOOKS_FIELDS())).toEqual([]);
      expect(present(answers, COST_FIELDS())).toEqual([]);
    }
  });

  it('tells the app who sees what', async () => {
    const flags = async (h: Headers) => { const u = (await get('/api/auth/me', h)).json().user; return [u.seesCost, u.seesBooks]; };
    expect(await flags(admin)).toEqual([true, true]);
    expect(await flags(keeper)).toEqual([true, true]);
    expect(await flags(buyer)).toEqual([true, true]);
    expect(await flags(accountant)).toEqual([false, true]);
    expect(await flags(viewer)).toEqual([false, true]);
    expect(await flags(cashier)).toEqual([false, false]);
  });
});

describe('a cashier sells without seeing cost', () => {
  it('the answers to a sale carry no cost, and the server posts the cost of sales from its own stock', async () => {
    const today = todayIso();
    const average = (): number => {
      const s = db.prepare('SELECT SUM(qty_milli) AS q, SUM(value) AS v FROM stock_moves WHERE item_id = ? AND warehouse_id = ?').get(at.teaId!, at.warehouseId!) as { q: number; v: number };
      return Number(s.v) / (Number(s.q) / 1000);
    };
    const account = (await get('/api/settings')).json().postingAccounts.costOfSales as string;
    const costOfSales = () => Number((db.prepare('SELECT COALESCE(SUM(base_debit) - SUM(base_credit), 0) AS v FROM entry_lines WHERE account_code = ?').get(account) as { v: number }).v);
    const lineCosts = (invoiceId: string) => (db.prepare('SELECT cost FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no').all(invoiceId) as { cost: number | null }[]).map((r) => Number(r.cost));

    // an invoice: a cost sent by the client is not read (the line has no such field), the stock's average cost is posted
    const before = average();
    const draft = await post('/api/invoices', {
      kind: 'sale', date: today, partyId: at.customerId, warehouseId: at.warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: [{ itemId: at.teaId, qtyMilli: 4_000, unitPrice: 2_500, cost: 1, unitCost: 1 }]
    }, cashier);
    expect(draft.statusCode, draft.body).toBe(201);
    const posted = await post(`/api/invoices/${draft.json().id}/post`, {}, cashier);
    expect(posted.statusCode, posted.body).toBe(200);
    for (const answer of [draft.json(), posted.json()]) expect([...scan(answer).paths].filter((p) => COST_KEY.test(p.split('.').pop()!))).toEqual([]);
    expect(posted.json()).toMatchObject({ status: 'posted', total: 10_000 });
    expect(lineCosts(draft.json().id)).toEqual([Math.round(before * 4)]);
    expect(lineCosts(draft.json().id)[0]).toBeGreaterThan(6_000);

    // the till: the same, and the cost of sales account grows by exactly the cost of what left the stock
    const shift = await post('/api/pos/shifts', { register: 'Counter 2', cashAccountCode: '1811', warehouseId: at.warehouseId, openingCash: 0 }, cashier);
    expect(shift.statusCode, shift.body).toBe(201);
    const [cosBefore, avg] = [costOfSales(), average()];
    const sold = await post(`/api/pos/shifts/${shift.json().id}/sales`, { currency: 'IQD', lines: [{ itemId: at.teaId, qtyMilli: 2_000, unitPrice: 2_500 }] }, cashier);
    expect(sold.statusCode, sold.body).toBe(201);
    expect([...scan(sold.json()).paths].filter((p) => COST_KEY.test(p.split('.').pop()!))).toEqual([]);
    expect(sold.json().invoice).toMatchObject({ status: 'posted', total: 5_000 });
    expect(lineCosts(sold.json().invoice.id)).toEqual([Math.round(avg * 2)]);
    expect(costOfSales() - cosBefore).toBe(Math.round(avg * 2));

    // a return of it, and the shift's report
    const back = await post(`/api/invoices/${sold.json().invoice.id}/returns`, { date: today, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1_000 }] }, cashier);
    expect(back.statusCode, back.body).toBe(201);
    expect([...scan(back.json()).paths].filter((p) => COST_KEY.test(p.split('.').pop()!))).toEqual([]);
    // (half of what was sold comes back at half of what it cost)
    expect(lineCosts(back.json().id)).toEqual([Math.round(Math.round(avg * 2) / 2)]);
    const report = await get(`/api/pos/shifts/${shift.json().id}`, cashier);
    expect([...scan(report.json()).paths].filter((p) => COST_KEY.test(p.split('.').pop()!))).toEqual([]);

    // the same documents, read by the admin, have their cost
    expect((await get(`/api/invoices/${sold.json().invoice.id}`)).json().lines[0].cost).toBe(Math.round(avg * 2));
  });

  it('reads the vouchers they prepared, with the approval and the reason of a rejection, and nothing else of the journal', async () => {
    const receipt = { kind: 'receipt', partyId: at.customerId, amount: 12_000, currency: 'IQD', cashAccountCode: '1811', date: todayIso() };
    const mine = await made(post('/api/quick-vouchers', receipt, cashier));
    const theirs = await made(post('/api/quick-vouchers', { ...receipt, amount: 9_000 }, accountant));
    expect(mine).toMatchObject({ type: 'receipt', status: 'draft', preparedBy: 'Raz' });

    // their own, by its id: the whole voucher, and no button (they may not change, check or approve it)
    const own = await get(`/api/entries/${mine.id}`, cashier);
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json()).toMatchObject({ id: mine.id, total: 12_000, preparedBy: 'Raz', actions: [] });
    expect(own.json().lines).toHaveLength(2);
    // another person's voucher, an invoice's entry, an entry that does not exist: refused alike
    for (const id of [theirs.id, at.entry!.split('/').pop()!, 'none']) expect((await get(`/api/entries/${id}`, cashier)).statusCode).toBe(403);
    // the list is their own vouchers, whatever is asked for
    const listed = async (query = '') => ((await get(`/api/entries${query}`, cashier)).json() as { id: string }[]).map((e) => e.id);
    expect(await listed()).toEqual([mine.id]);
    expect(await listed('?type=receipt')).toEqual([mine.id]);
    expect(await listed('?type=sale')).toEqual([]);
    expect(await listed('?q=Raz')).toEqual([mine.id]);
    expect(((await get('/api/entries?type=receipt')).json() as { id: string }[]).map((e) => e.id).sort()).toEqual([mine.id, theirs.id].sort());
    // and they change nothing of it, nor anyone else's
    expect((await put(`/api/vouchers/${mine.id}`, {}, cashier)).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/entries/${mine.id}`, headers: cashier })).statusCode).toBe(403);
    for (const action of ['check', 'approve', 'approve-waiting', 'reject']) expect((await post(`/api/entries/${mine.id}/${action}`, { reason: 'x' }, cashier)).statusCode).toBe(403);

    // with "Vouchers need approval": theirs waits; rejected, they read who rejected it and why
    await made(put('/api/voucher-approval', { on: true }), 200);
    const waits = await made(post('/api/quick-vouchers', { ...receipt, amount: 7_000 }, cashier));
    expect(waits.approval).toMatchObject({ state: 'waiting', requestedBy: 'Raz' });
    expect(await listed('?approval=waiting')).toEqual([waits.id]);
    await made(post(`/api/entries/${waits.id}/reject`, { reason: 'Wrong amount' }), 200);
    expect((await get(`/api/entries/${waits.id}`, cashier)).json()).toMatchObject({ status: 'draft', actions: [], approval: { state: 'rejected', reason: 'Wrong amount' } });
    expect(await listed('?approval=rejected')).toEqual([waits.id]);
    expect((await get('/api/entries?approval=rejected', cashier)).json()[0].approval).toMatchObject({ state: 'rejected', reason: 'Wrong amount' });
    // corrected by someone who prepares vouchers, it is that person's: no longer in the cashier's list
    const fixed = await put(`/api/vouchers/${waits.id}`, {
      kind: 'receipt', date: todayIso(), cashAccountCode: '1811', description: 'Receipt', currency: 'IQD', rateX100: 100, items: [{ accountCode: '1612', amount: 7_500, partyId: at.customerId }]
    }, accountant);
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect((await get(`/api/entries/${waits.id}`, cashier)).statusCode).toBe(403);
    expect(await listed()).toEqual([mine.id]);
    await made(put('/api/voucher-approval', { on: false }), 200);

    // the books stay closed, and the receipt printed with the customer's balance reads the statement, which is open
    for (const url of ['/api/reports/trial-balance', '/api/reports/statement?account=1811', '/api/brief/reports/stock-value']) expect((await get(url, cashier)).statusCode).toBe(403);
    for (const url of [`/api/parties/${at.customerId}`, at.customerStatement!, '/api/parties?type=customer&active=true', '/api/voucher-approval', '/api/accounts', '/api/settings']) {
      expect((await get(url, cashier)).statusCode, url).toBe(200);
    }
  });

  it('cannot give an item a purchase price or stock a cost (those need the stock role), and an item change keeps the price', async () => {
    expect((await put(`/api/items/${at.teaId}`, { name: one('Tea'), unit: 'piece', salePrice: 2_500, saleCurrency: 'IQD', purchasePrice: 1 }, cashier)).statusCode).toBe(403);
    expect((await post('/api/stock-docs', { kind: 'opening', date: todayIso(), warehouseId: at.warehouseId, counterAccountCode: '21', lines: [{ itemId: at.teaId, qtyMilli: 1_000, unitCost: 1 }] }, cashier)).statusCode).toBe(403);
    expect((await get(at.item!)).json().purchasePrice).toBe(TEA_PURCHASE_PRICE);
  });
});
