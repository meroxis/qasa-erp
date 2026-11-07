import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { adjustmentsApi } from './adjustments.ts';

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let stockAccount: string;
let supplierId: string;
let customerId: string;
let pipeId: string;
let cableId: string;

type Headers = Record<string, string>;
const headers: Headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const post = (url: string, body: unknown = {}, h: Headers = headers) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const put = (url: string, body: unknown = {}, h: Headers = headers) => app.inject({ method: 'PUT', url, payload: body as object, headers: h });
const get = (url: string, h: Headers = headers) => app.inject({ method: 'GET', url, headers: h });

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  const wh = (await get('/api/warehouses')).json()[0];
  warehouseId = wh.id;
  stockAccount = (db.prepare('SELECT account_code FROM warehouses WHERE id = ?').get(warehouseId) as { account_code: string }).account_code;
  supplierId = (await post('/api/parties', { type: 'supplier', name: 'RapidNet Ltd' })).json().id;
  customerId = (await post('/api/parties', { type: 'customer', name: 'Sanos Company' })).json().id;
  pipeId = (await post('/api/items', { code: 'PIPE-1', barcode: '6260000000011', name: { ar: 'أنبوب', en: 'Steel pipe', ku: 'بۆری' }, unit: 'piece', salePrice: 30_000, saleCurrency: 'IQD' })).json().id;
  cableId = (await post('/api/items', { code: 'CAB-6', name: { ar: 'كيبل', en: 'Cable 6mm', ku: 'کێبڵ' }, unit: 'piece', salePrice: 5_000, saleCurrency: 'IQD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

/** Two purchases at different prices: 10 pipes at 20,000 then 10 at 26,000 → average 23,000. */
async function stockUp() {
  for (const price of [20_000, 26_000]) {
    const draft = await post('/api/invoices', {
      kind: 'purchase', date: '2026-09-01', partyId: supplierId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: [{ itemId: pipeId, qtyMilli: 10_000, unitPrice: price }]
    });
    expect(draft.statusCode, draft.body).toBe(201);
    expect((await post(`/api/invoices/${draft.json().id}/post`)).statusCode).toBe(200);
  }
}

async function stockOf(itemId: string) {
  const item = (await get(`/api/items/${itemId}`)).json() as { stock: { warehouseId: string; qtyMilli: number; value: number }[] };
  const s = item.stock.find((x) => x.warehouseId === warehouseId);
  return { qty: (s?.qtyMilli ?? 0) / 1000, value: s?.value ?? 0 };
}

async function entryLines(entryId: string) {
  const e = (await get(`/api/entries/${entryId}`)).json() as { status: string; lines: { accountCode: string; debit: number; credit: number }[] };
  return e;
}

async function trialBalance() {
  const tb = (await get('/api/reports/trial-balance')).json() as { rows: { code: string; balance: number }[]; totalDebit: number; totalCredit: number };
  expect(tb.totalDebit).toBe(tb.totalCredit);
  return new Map(tb.rows.map((r) => [r.code, r.balance]));
}

async function draftAndPost(body: object) {
  const draft = await post('/api/adjustments', { date: '2026-09-10', warehouseId, ...body });
  expect(draft.statusCode, draft.body).toBe(201);
  expect(draft.json()).toMatchObject({ status: 'draft', number: null, actions: ['edit', 'delete', 'post'] });
  const posted = await post(`/api/adjustments/${draft.json().id}/post`);
  expect(posted.statusCode, posted.body).toBe(200);
  return posted.json();
}

describe('stock adjustments', () => {
  it('takes damaged goods out at the weighted average cost into losses', async () => {
    await stockUp();
    const adj = await draftAndPost({ reason: 'damaged', notes: 'Bent in the yard', lines: [{ itemId: pipeId, qtyMilli: -3000 }] });
    expect(adj).toMatchObject({ status: 'posted', number: 'ADJ-2026-0001', valueOut: 69_000, valueIn: 0, accountCode: '39', actions: ['cancel'] });
    expect(adj.lines[0]).toMatchObject({ qtyMilli: -3000, value: -69_000, stockMilli: 17_000 });
    expect(await stockOf(pipeId)).toEqual({ qty: 17, value: 391_000 });
    const entry = await entryLines(adj.entry.id);
    expect(entry.status).toBe('approved');
    expect(entry.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: '39', debit: 69_000, credit: 0 }),
      expect.objectContaining({ accountCode: stockAccount, debit: 0, credit: 69_000 })
    ]));
    const tb = await trialBalance();
    expect(tb.get('39')).toBe(69_000);
    // the list shows it with its value
    expect((await get('/api/adjustments')).json()).toMatchObject([{ id: adj.id, number: 'ADJ-2026-0001', reason: 'damaged', valueOut: 69_000, lineCount: 1 }]);
  });

  it('adds goods at a given cost (or the current average) against other revenue', async () => {
    await stockUp();
    const adj = await draftAndPost({ reason: 'other', lines: [{ itemId: pipeId, qtyMilli: 2000, unitCost: 21_000 }, { itemId: pipeId, qtyMilli: 1000 }] });
    // 2 × 21,000 = 42,000; then one at the average of (460,000 + 42,000) / 22 = 22,818.18 → 22,818
    expect(adj.lines.map((l: { value: number }) => l.value)).toEqual([42_000, 22_818]);
    expect(adj.valueIn).toBe(64_818);
    expect(await stockOf(pipeId)).toEqual({ qty: 23, value: 524_818 });
    const entry = await entryLines(adj.entry.id);
    expect(entry.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: stockAccount, debit: 64_818, credit: 0 }),
      expect.objectContaining({ accountCode: '49', debit: 0, credit: 64_818 })
    ]));
    // an item with no stock and no cost cannot come in
    const none = (await post('/api/adjustments', { date: '2026-09-10', warehouseId, reason: 'other', lines: [{ itemId: cableId, qtyMilli: 1000 }] })).json();
    expect((await post(`/api/adjustments/${none.id}/post`)).json()).toMatchObject({ error: 'validation', details: [{ code: 'adj_cost_required', line: 1 }] });
  });

  it('refuses to take out more than is in stock, and checks the input', async () => {
    await stockUp();
    const draft = (await post('/api/adjustments', { date: '2026-09-10', warehouseId, reason: 'lost', lines: [{ itemId: pipeId, qtyMilli: -15_000 }, { itemId: pipeId, qtyMilli: -6000 }] })).json();
    const res = await post(`/api/adjustments/${draft.id}/post`);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation', details: [{ code: 'stock_insufficient', line: 2, available: 5000 }] });
    expect(await stockOf(pipeId)).toEqual({ qty: 20, value: 460_000 });
    expect((await get(`/api/adjustments/${draft.id}`)).json().status).toBe('draft');

    const bad = await post('/api/adjustments', { date: '2026-09-10', warehouseId, reason: 'job', lines: [{ itemId: pipeId, qtyMilli: -1000 }] });
    expect(bad.json().details).toEqual([{ code: 'adj_job_required' }]);
    const zero = await post('/api/adjustments', { date: '2026-09-10', warehouseId, reason: 'lost', lines: [{ itemId: pipeId, qtyMilli: 0 }] });
    expect(zero.json().details).toEqual([{ code: 'line_qty_invalid', line: 1 }]);
    const service = (await post('/api/items', { name: { ar: 'نصب', en: 'Installation', ku: 'دامەزراندن' }, unit: 'service', salePrice: 1, saleCurrency: 'IQD' })).json().id;
    expect((await post('/api/adjustments', { date: '2026-09-10', warehouseId, reason: 'lost', lines: [{ itemId: service, qtyMilli: -1000 }] })).json().details)
      .toEqual([{ code: 'item_not_stock', line: 1 }]);
    expect((await post('/api/adjustments', { date: '2026-09-10', warehouseId, reason: 'lost', accountCode: stockAccount, lines: [{ itemId: pipeId, qtyMilli: -1000 }] })).json().details)
      .toEqual([{ code: 'account_invalid', field: 'accountCode' }]);
  });

  it('uses the account per reason, overridable per document and in the settings', async () => {
    await stockUp();
    expect((await get('/api/adjustments/settings')).json().accounts).toMatchObject({ damaged: '39', internal_use: '32', count: '39', gain: '49' });
    const used = await draftAndPost({ reason: 'internal_use', lines: [{ itemId: pipeId, qtyMilli: -1000 }] });
    expect(used.accountCode).toBe('32');
    const own = await draftAndPost({ reason: 'expired', accountCode: '38', lines: [{ itemId: pipeId, qtyMilli: -1000 }] });
    expect((await entryLines(own.entry.id)).lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '38', debit: 23_000 })]));
    expect((await put('/api/adjustments/settings', { expired: '33' })).json().accounts.expired).toBe('33');
    expect((await put('/api/adjustments/settings', { gain: '9999' })).json()).toMatchObject({ error: 'validation', details: [{ code: 'account_invalid', field: 'gain' }] });
    const next = await draftAndPost({ reason: 'expired', lines: [{ itemId: pipeId, qtyMilli: -1000 }] });
    expect(next.accountCode).toBe('33');
  });

  it('issues materials to a job: the cost is counted on the job, and cancelling takes it off', async () => {
    await stockUp();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO jobs (id, number, date, party_id, title, category, currency, status, created_by, created_at, updated_at)
                VALUES ('job-1', 'JOB-2026-0001', '2026-09-01', ?, 'Gate for Sanos', 'steel', 'IQD', 'fabricating', 'Mer', ?, ?)`).run(customerId, now, now);
    // only outs on a job
    expect((await post('/api/adjustments', { date: '2026-09-10', warehouseId, reason: 'job', jobId: 'job-1', lines: [{ itemId: pipeId, qtyMilli: 1000, unitCost: 1 }] })).json().details)
      .toEqual([{ code: 'adj_job_outs_only', line: 1 }]);
    const adj = await draftAndPost({ reason: 'job', jobId: 'job-1', lines: [{ itemId: pipeId, qtyMilli: -4000 }] });
    expect(adj).toMatchObject({ valueOut: 92_000, accountCode: '32', job: { id: 'job-1', number: 'JOB-2026-0001', title: 'Gate for Sanos' } });
    const costs = db.prepare('SELECT job_id, category, entry_id, amount FROM job_costs').all();
    expect(costs).toEqual([{ job_id: 'job-1', category: 'materials', entry_id: adj.entry.id, amount: 92_000 }]);

    const cancelled = await post(`/api/adjustments/${adj.id}/cancel`, { date: '2026-09-11' });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM job_costs').get()).toEqual({ n: 0 });
  });

  it('cancels with a reversal: the entry is reversed and the stock comes back', async () => {
    await stockUp();
    const adj = await draftAndPost({ reason: 'damaged', lines: [{ itemId: pipeId, qtyMilli: -2000 }] });
    const res = await post(`/api/adjustments/${adj.id}/cancel`, { date: '2026-09-12' });
    expect(res.statusCode, res.body).toBe(200);
    const view = res.json();
    expect(view).toMatchObject({ status: 'cancelled', actions: [] });
    expect(view.reversal?.id).toBeTruthy();
    expect(await stockOf(pipeId)).toEqual({ qty: 20, value: 460_000 });
    expect((await trialBalance()).get('39') ?? 0).toBe(0);
    expect((await post(`/api/adjustments/${adj.id}/cancel`)).statusCode).toBe(409);

    // a surplus that has since been sold cannot be cancelled
    const gained = await draftAndPost({ reason: 'other', lines: [{ itemId: cableId, qtyMilli: 5000, unitCost: 4_000 }] });
    const sale = (await post('/api/invoices', {
      kind: 'sale', date: '2026-09-11', partyId: customerId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: [{ itemId: cableId, qtyMilli: 4000, unitPrice: 5_000 }]
    })).json();
    expect((await post(`/api/invoices/${sale.id}/post`)).statusCode).toBe(200);
    expect((await post(`/api/adjustments/${gained.id}/cancel`, { date: '2026-09-12' })).json())
      .toMatchObject({ error: 'validation', details: [{ code: 'stock_insufficient', line: 1, itemId: cableId, available: 1000 }] });
  });

  it('turns a stock count (by code or barcode) into a draft of the differences', async () => {
    await stockUp();
    const sheet = (await get(`/api/adjustments/count-sheet?warehouseId=${warehouseId}`)).json();
    expect(sheet).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: pipeId, code: 'PIPE-1', stockMilli: 20_000 })]));
    const res = await post('/api/adjustments/count', {
      date: '2026-09-15', warehouseId, full: true,
      counts: [{ code: '6260000000011', countedMilli: 12_000 }, { code: 'pipe-1', countedMilli: 6000 }, { code: 'NOPE', countedMilli: 1000 }]
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = res.json();
    // pipes: 18 counted against 20 → −2; the cable (not counted, full count) has none either way → no line
    expect(result).toMatchObject({ counted: 2, differences: 1, unknown: [{ row: 3, code: 'NOPE' }] });
    expect(result.adjustment).toMatchObject({ reason: 'count', status: 'draft', lines: [{ itemId: pipeId, qtyMilli: -2000 }] });
    const posted = (await post(`/api/adjustments/${result.adjustment.id}/post`)).json();
    expect(posted).toMatchObject({ status: 'posted', valueOut: 46_000 });
    expect(await stockOf(pipeId)).toEqual({ qty: 18, value: 414_000 });

    // nothing to adjust when the count agrees
    expect((await post('/api/adjustments/count', { date: '2026-09-16', warehouseId, counts: [{ itemId: pipeId, countedMilli: 18_000 }] })).json())
      .toMatchObject({ adjustment: null, differences: 0 });
  });

  it('edits and deletes drafts only', async () => {
    await stockUp();
    const draft = (await post('/api/adjustments', { date: '2026-09-10', warehouseId, reason: 'lost', lines: [{ itemId: pipeId, qtyMilli: -1000 }] })).json();
    const edited = await put(`/api/adjustments/${draft.id}`, { date: '2026-09-10', warehouseId, reason: 'damaged', lines: [{ itemId: pipeId, qtyMilli: -2000 }] });
    expect(edited.json()).toMatchObject({ reason: 'damaged', lines: [{ qtyMilli: -2000 }] });
    expect((await app.inject({ method: 'DELETE', url: `/api/adjustments/${draft.id}`, headers })).statusCode).toBe(204);
    expect((await get(`/api/adjustments/${draft.id}`)).statusCode).toBe(404);
    const posted = await draftAndPost({ reason: 'lost', lines: [{ itemId: pipeId, qtyMilli: -1000 }] });
    expect((await app.inject({ method: 'DELETE', url: `/api/adjustments/${posted.id}`, headers })).statusCode).toBe(409);
    expect((await put(`/api/adjustments/${posted.id}`, { date: '2026-09-10', warehouseId, reason: 'lost', lines: [{ itemId: pipeId, qtyMilli: -1 }] })).statusCode).toBe(409);
  });

  it('needs the stock permission to change adjustments, and admin for the settings', async () => {
    await stockUp();
    await post('/api/plan/trial');
    const ownerId = (await get('/api/users')).json()[0].id;
    expect((await post(`/api/users/${ownerId}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
    expect((await post('/api/users', { username: 'sara', name: 'Sara', password: 'sara-pass-123', roles: ['sales'] })).statusCode).toBe(201);
    expect((await post('/api/users', { username: 'karo', name: 'Karo', password: 'karo-pass-123', roles: ['storekeeper'] })).statusCode).toBe(201);
    expect((await put('/api/auth/signin', { on: true })).statusCode).toBe(200);
    const login = async (username: string, password: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: { 'x-qasa-client': '1' } });
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    };
    const sara = await login('sara', 'sara-pass-123');
    const karo = await login('karo', 'karo-pass-123');
    const body = { date: '2026-09-10', warehouseId, reason: 'damaged', lines: [{ itemId: pipeId, qtyMilli: -1000 }] };
    expect((await post('/api/adjustments', body, sara)).statusCode).toBe(403);
    const mine = await post('/api/adjustments', body, karo);
    expect(mine.statusCode, mine.body).toBe(201);
    expect((await post(`/api/adjustments/${mine.json().id}/post`, {}, sara)).statusCode).toBe(403);
    expect((await post(`/api/adjustments/${mine.json().id}/post`, {}, karo)).statusCode).toBe(200);
    expect((await post('/api/adjustments/count', { date: '2026-09-10', warehouseId, counts: [{ itemId: pipeId, countedMilli: 1 }] }, sara)).statusCode).toBe(403);
    expect((await put('/api/adjustments/settings', { damaged: '38' }, karo)).statusCode).toBe(403);
  });
});
