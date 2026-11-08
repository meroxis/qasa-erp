import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import type { InvoiceView } from './invoices.ts';

let db: Db;
let app: FastifyInstance;
let warehouse: string;
let item: string;
let customer: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload, headers });
const get = (url: string) => app.inject({ method: 'GET', url, headers });
const NOW = '2026-11-01T08:00:00.000Z';

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouse = (await get('/api/warehouses')).json()[0].id;
  item = (await post('/api/items', { name: { ar: 'خدمة', en: 'Service', ku: 'خزمەتگوزاری' }, unit: 'service', salePrice: 1_000_000, saleCurrency: 'IQD' })).json().id;
  customer = (await post('/api/parties', { type: 'customer', name: 'Raz' })).json().id;
});
afterEach(async () => { await app.close(); db.close(); });

async function postedSale(): Promise<InvoiceView> {
  const draft = await post('/api/invoices', {
    kind: 'sale', date: '2026-11-01', warehouseId: warehouse, partyId: customer, currency: 'IQD', rateX100: 100, payment: 'cash',
    cashAccountCode: '1811', discount: 0, lines: [{ itemId: item, qtyMilli: 1000, unitPrice: 1_000_000 }]
  });
  expect(draft.statusCode, draft.body).toBe(201);
  const res = await post(`/api/invoices/${draft.json().id}/post`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as InvoiceView;
}

describe('a sale that sold a property unit', () => {
  it('is undone by cancelling it, never by a return that would leave the unit sold', async () => {
    const sale = await postedSale();
    db.prepare(`INSERT INTO re_projects (id, code, name, currency, item_id, created_at, updated_at) VALUES ('p1', 'P1', 'Tower', 'IQD', ?, ?, ?)`).run(item, NOW, NOW);
    db.prepare(`INSERT INTO re_units (id, project_id, code, kind, price, status, party_id, invoice_id, created_at, updated_at)
                VALUES ('u1', 'p1', 'A-1', 'apartment', 1000000, 'sold', ?, ?, ?, ?)`).run(customer, sale.id, NOW, NOW);
    const res = await post(`/api/invoices/${sale.id}/returns`, { date: '2026-11-02', payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error).toBe('invoice_has_unit');
    expect((db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE kind = 'sale_return'").get() as { n: number }).n).toBe(0);
  });

  it('still lets an ordinary sale be returned', async () => {
    const sale = await postedSale();
    const res = await post(`/api/invoices/${sale.id}/returns`, { date: '2026-11-02', payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    expect(res.statusCode, res.body).toBe(201);
  });
});

describe('cancelling a sale that took serial numbers', () => {
  it('puts its phones back in stock with no customer or warranty, and leaves other sales alone', async () => {
    const sale = await postedSale();
    const other = await postedSale();
    const serial = db.prepare(`INSERT INTO serials (id, item_id, serial, grade, status, sale_invoice_id, party_id, sold_at, warranty_until, created_by, created_at, updated_at)
                               VALUES (?, ?, ?, 'new', 'sold', ?, ?, '2026-11-01', '2027-11-01', 'Mer', ?, ?)`);
    serial.run('s1', item, 'IMEI0001', sale.id, customer, NOW, NOW);
    serial.run('s2', item, 'IMEI0002', other.id, customer, NOW, NOW);
    const res = await post(`/api/invoices/${sale.id}/cancel`, { date: '2026-11-02' });
    expect(res.statusCode, res.body).toBe(200);
    const row = (id: string) => db.prepare('SELECT status, sale_invoice_id, party_id, sold_at, warranty_until FROM serials WHERE id = ?').get(id);
    expect(row('s1')).toEqual({ status: 'in_stock', sale_invoice_id: null, party_id: null, sold_at: null, warranty_until: null });
    expect(row('s2')).toMatchObject({ status: 'sold', sale_invoice_id: other.id, party_id: customer });
  });

  it("leaves a job bill's equipment linked to it, so the job shows it waiting for the next bill", async () => {
    const bill = await postedSale();
    db.prepare(`INSERT INTO jobs (id, number, date, party_id, title, category, currency, status, invoice_id, created_by, created_at, updated_at)
                VALUES ('j1', 'JOB-1', '2026-11-01', ?, 'Roof system', 'solar', 'IQD', 'invoiced', ?, 'Mer', ?, ?)`).run(customer, bill.id, NOW, NOW);
    db.prepare(`INSERT INTO serials (id, item_id, serial, grade, status, sale_invoice_id, party_id, sold_at, warranty_until, created_by, created_at, updated_at)
                VALUES ('s3', ?, 'INV0009', 'new', 'sold', ?, ?, '2026-11-01', '2028-11-01', 'Mer', ?, ?)`).run(item, bill.id, customer, NOW, NOW);
    expect((await post(`/api/invoices/${bill.id}/cancel`, { date: '2026-11-02' })).statusCode).toBe(200);
    expect(db.prepare('SELECT status, sale_invoice_id FROM serials WHERE id = ?').get('s3')).toEqual({ status: 'sold', sale_invoice_id: bill.id });
  });
});
