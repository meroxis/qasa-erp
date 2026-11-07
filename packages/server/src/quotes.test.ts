import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { writeSetting } from './settings.ts';
import { quotesApi } from './quotes.ts';

let db: Db;
let app: FastifyInstance;
let customerId: string;
let acId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const post = (url: string, body: unknown = {}, h: Record<string, string> = headers) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const put = (url: string, body: unknown = {}) => app.inject({ method: 'PUT', url, payload: body as object, headers });
const get = (url: string, h: Record<string, string> = headers) => app.inject({ url, headers: h });

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  customerId = (await post('/api/parties', { type: 'customer', name: 'Sanos Company', phone: '0750 123 4567' })).json().id;
  acId = (await post('/api/items', { code: 'AC-18', name: { ar: 'مكيف 18 ألف وحدة', en: 'AC 18,000 BTU', ku: 'سپلیتی ١٨ هەزار' }, unit: 'piece', salePrice: 823_600, saleCurrency: 'IQD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

const quote = (extra: object = {}) => ({
  date: '2026-11-01', validUntil: '2026-11-15', partyId: customerId, currency: 'IQD', discount: 100_000, terms: 'Half on order, half on delivery',
  lines: [
    { itemId: acId, description: '', qtyMilli: 2000, unitPrice: 800_000 },
    { description: 'Installation and copper piping', qtyMilli: 2000, unitPrice: 75_000 }
  ],
  ...extra
});

async function created(extra: object = {}) {
  const res = await post('/api/quotes', quote(extra));
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

describe('quotations', () => {
  it('numbers a quote, totals it and names item lines after the item', async () => {
    const q = await created();
    expect(q).toMatchObject({ number: 'QT-2026-0001', status: 'draft', subtotal: 1_750_000, discount: 100_000, total: 1_650_000 });
    expect(q.lines[0]).toMatchObject({ itemCode: 'AC-18', description: 'مكيف 18 ألف وحدة', amount: 1_600_000 });
    expect(q.actions).toEqual(expect.arrayContaining(['edit', 'send', 'accept', 'reject', 'cancel', 'duplicate']));
    expect((await created()).number).toBe('QT-2026-0002');
  });

  it('checks what it is given', async () => {
    const bad = await post('/api/quotes', quote({
      partyId: null, customerName: '', validUntil: '2026-10-01', discount: 9_000_000,
      lines: [{ description: '', qtyMilli: 0, unitPrice: -1 }]
    }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details).toEqual(expect.arrayContaining([
      { code: 'qt_customer_required' }, { code: 'qt_valid_until_invalid' }, { code: 'qt_line_description_required', line: 1 },
      { code: 'line_qty_invalid', line: 1 }, { code: 'line_price_invalid', line: 1 }
    ]));
    expect((await post('/api/quotes', quote({ lines: [] }))).json().details).toEqual([{ code: 'qt_lines_required' }]);
    expect((await post('/api/quotes', quote({ discount: 2_000_000 }))).json().details).toEqual([{ code: 'discount_invalid' }]);
  });

  it('goes from draft to sent to accepted, and is edited only before', async () => {
    const q = await created();
    const sent = (await post(`/api/quotes/${q.id}/status`, { action: 'send' })).json();
    expect(sent.status).toBe('sent');
    expect((await put(`/api/quotes/${q.id}`, quote({ discount: 0 }))).json().total).toBe(1_750_000);
    const accepted = (await post(`/api/quotes/${q.id}/status`, { action: 'accept' })).json();
    expect(accepted).toMatchObject({ status: 'accepted' });
    expect(accepted.actions).toEqual(expect.arrayContaining(['convert', 'reopen', 'cancel']));
    expect(accepted.actions).not.toContain('edit');
    expect((await put(`/api/quotes/${q.id}`, quote())).json().error).toBe('action_not_allowed');
    expect((await post(`/api/quotes/${q.id}/status`, { action: 'send' })).json().error).toBe('action_not_allowed');
  });

  it('flags a draft or sent quote past its validity date', async () => {
    await created({ date: '2020-01-01', validUntil: '2020-01-10' });
    const [q] = (await get('/api/quotes')).json();
    expect(q.expired).toBe(true);
    expect((await get('/api/quotes/summary')).json()).toMatchObject({ open: 1, expired: 1 });
  });

  it('becomes a draft sale invoice: item lines on their items, free lines on the quote service item', async () => {
    const q = await created();
    await post(`/api/quotes/${q.id}/status`, { action: 'accept' });
    const res = await post(`/api/quotes/${q.id}/convert`, { date: '2026-11-03' });
    expect(res.statusCode, res.body).toBe(200);
    const done = res.json();
    expect(done.status).toBe('invoiced');
    const invoice = (await get(`/api/invoices/${done.invoice.id}`)).json();
    expect(invoice).toMatchObject({ kind: 'sale', status: 'draft', partyId: customerId, discount: 100_000, total: 1_650_000, notes: q.number });
    expect(invoice.lines).toHaveLength(2);
    expect(invoice.lines[0]).toMatchObject({ itemId: acId, qtyMilli: 2000, unitPrice: 800_000 });
    const service = (await get('/api/items?q=QT-SERVICE')).json()[0];
    expect(service).toMatchObject({ code: 'QT-SERVICE', unit: 'service' });
    expect(invoice.lines[1]).toMatchObject({ itemId: service.id, description: 'Installation and copper piping' });
    // nothing is posted until the invoice itself is
    expect((await get(`/api/parties/${customerId}`)).json().balance).toBe(0);
    // a second conversion is refused
    expect((await post(`/api/quotes/${q.id}/convert`, { date: '2026-11-03' })).json().error).toBe('action_not_allowed');
  });

  it('turns a prospect into a customer when invoicing', async () => {
    const q = await created({ partyId: null, customerName: 'Hawre Jalal' });
    expect(q.party).toBeNull();
    expect(q.customerName).toBe('Hawre Jalal');
    await post(`/api/quotes/${q.id}/status`, { action: 'accept' });
    const done = (await post(`/api/quotes/${q.id}/convert`, { date: '2026-11-03', customer: { phone: '0770 111 2233' } })).json();
    expect(done.party).toMatchObject({ name: 'Hawre Jalal', phone: '0770 111 2233' });
    const invoice = (await get(`/api/invoices/${done.invoice.id}`)).json();
    expect(invoice.partyId).toBe(done.party.id);
  });

  it('is accepted again when its invoice is cancelled, and can be invoiced anew', async () => {
    const q = await created({ discount: 0, lines: [{ description: 'Maintenance visit', qtyMilli: 1000, unitPrice: 150_000 }] });
    await post(`/api/quotes/${q.id}/status`, { action: 'accept' });
    const first = (await post(`/api/quotes/${q.id}/convert`, { date: '2026-11-03' })).json();
    const posted = await post(`/api/invoices/${first.invoice.id}/post`);
    expect(posted.statusCode, posted.body).toBe(200);
    expect((await post(`/api/invoices/${first.invoice.id}/cancel`)).statusCode).toBe(200);
    const again = (await get(`/api/quotes/${q.id}`)).json();
    expect(again).toMatchObject({ status: 'accepted', invoice: null });
    const second = (await post(`/api/quotes/${q.id}/convert`, { date: '2026-11-04' })).json();
    expect(second.invoice.id).not.toBe(first.invoice.id);
  });

  it('converts a USD quote at the rate given, and refuses an invoice dated before the quote', async () => {
    const q = await created({ currency: 'USD', discount: 0, lines: [{ description: 'Design work', qtyMilli: 1000, unitPrice: 50_000 }] });
    await post(`/api/quotes/${q.id}/status`, { action: 'accept' });
    expect((await post(`/api/quotes/${q.id}/convert`, { date: '2026-10-01' })).json().details).toEqual([{ code: 'qt_invoice_before_quote' }]);
    const done = (await post(`/api/quotes/${q.id}/convert`, { date: '2026-11-02', rateX100: 142_000 })).json();
    expect((await get(`/api/invoices/${done.invoice.id}`)).json()).toMatchObject({ currency: 'USD', rateX100: 142_000, total: 50_000 });
  });

  it('duplicates a quote as a new draft dated today, with the same lines and validity length', async () => {
    const q = await created();
    await post(`/api/quotes/${q.id}/status`, { action: 'reject' });
    const copy = (await post(`/api/quotes/${q.id}/duplicate`)).json();
    expect(copy).toMatchObject({ status: 'draft', total: q.total, number: 'QT-' + copy.date.slice(0, 4) + '-' + (copy.date.startsWith('2026') ? '0002' : '0001') });
    expect(copy.lines.map((l: { description: string }) => l.description)).toEqual(q.lines.map((l: { description: string }) => l.description));
    expect(Date.parse(copy.validUntil) - Date.parse(copy.date)).toBe(14 * 86_400_000);
  });

  it('cancels, and a cancelled quote does nothing more but duplicate', async () => {
    const q = await created();
    const cancelled = (await post(`/api/quotes/${q.id}/status`, { action: 'cancel', reason: 'Customer bought elsewhere' })).json();
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.actions).toEqual(['duplicate']);
    expect((await get('/api/quotes?status=open')).json()).toHaveLength(0);
  });

  it('needs the sales permission to change quotes; looking is open to signed-in users', async () => {
    writeSetting(db, 'trial_started', new Date().toISOString().slice(0, 10)); // more than one user is Pro
    const owner = (await get('/api/users')).json()[0].id;
    await post(`/api/users/${owner}/password`, { password: 'owner-pass-1' });
    await post('/api/users', { username: 'sara', name: 'Sara', roles: ['sales'], password: 'sara-pass-1' });
    await post('/api/users', { username: 'dana', name: 'Dana', roles: ['viewer'], password: 'dana-pass-1' });
    const q = await created();
    expect((await app.inject({ method: 'PUT', url: '/api/auth/signin', payload: { on: true }, headers })).statusCode).toBe(200);
    const signIn = async (username: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: `${username}-pass-1` }, headers: { 'x-qasa-client': '1' } });
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    };
    const sara = await signIn('sara');
    const dana = await signIn('dana');
    const seen = (await get(`/api/quotes/${q.id}`, dana)).json();
    expect(seen.number).toBe(q.number);
    expect(seen.actions).toEqual([]);
    expect((await post(`/api/quotes/${q.id}/status`, { action: 'send' }, dana)).statusCode).toBe(403);
    expect((await post('/api/quotes', quote(), dana)).statusCode).toBe(403);
    expect((await post(`/api/quotes/${q.id}/status`, { action: 'send' }, sara)).statusCode).toBe(200);
    expect((await get('/api/quotes')).statusCode).toBe(401);
  });
});
