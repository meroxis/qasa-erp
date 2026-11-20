import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';

// Accounting review #9: a till sale rounded down to the dinar step can be returned in full in cash (the rounded cash
// comes back), and a sale whose cash would round to nothing is sold unrounded.
let db: Db; let app: FastifyInstance; let warehouseId: string; let teaId: string;
const h = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const call = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => app.inject({ method, url, headers: h, ...(body === undefined ? {} : { payload: body as object }) });
async function ok(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) { const r = await call(method, url, body); expect(r.statusCode, `${method} ${url}: ${r.body}`).toBeLessThan(300); return r.statusCode === 204 ? null : r.json(); }
const bal = (code: string) => Number((db.prepare(`SELECT COALESCE(SUM(l.base_debit - l.base_credit),0) AS b FROM entry_lines l JOIN entries e ON e.id=l.entry_id WHERE l.account_code=? AND e.status='approved'`).get(code) as { b: number }).b);
const tea = (qty = 1, price = 2_750) => ({ itemId: teaId, qtyMilli: qty * 1000, unitPrice: price });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-20T09:00:00Z'));
  resetLoginThrottle(); db = openDatabase(':memory:'); app = buildApp(db);
  warehouseId = (await ok('GET', '/api/warehouses'))[0].id;
  teaId = (await ok('POST', '/api/items', { code: 'TEA', name: { ar: 'ش', en: 'Tea', ku: 'چ' }, unit: 'piece', salePrice: 2_750, saleCurrency: 'IQD' })).id;
  const doc = await ok('POST', '/api/stock-docs', { kind: 'opening', date: '2026-01-01', warehouseId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 100_000, unitCost: 1_500 }] });
  await ok('POST', `/api/stock-docs/${doc.id}/post`, {});
  await ok('PUT', '/api/pos/rules', { rounding: { step: 500, mode: 'down' } });
});
afterEach(async () => { vi.useRealTimers(); await app.close(); db.close(); });

describe('dinar rounding and returns', () => {
  it('returns a sale rounded down in full, giving back the cash that was taken', async () => {
    const shift = await ok('POST', '/api/pos/shifts', { register: 'C1', cashAccountCode: '1811', warehouseId, openingCash: 0 });
    const sale = await ok('POST', `/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(1)] });
    expect(bal('1811')).toBe(2_500);
    const ret = await call('POST', `/api/invoices/${sale.invoice.id}/returns`, { date: '2026-11-20', payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    expect(ret.statusCode, ret.body).toBeLessThan(300);
    expect(bal('1811')).toBe(0);
  });

  it('does not round a small sale\'s cash to nothing', async () => {
    const shift = await ok('POST', '/api/pos/shifts', { register: 'C1', cashAccountCode: '1811', warehouseId, openingCash: 0 });
    const r = await call('POST', `/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [tea(1, 250)] });
    expect(r.statusCode, r.body).toBeLessThan(300);
    expect(bal('1811')).toBe(250);
  });
});
