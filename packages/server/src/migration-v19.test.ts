import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildApp } from './app.ts';
import type { Db } from './db.ts';
import { migrate, openDatabase, SCHEMA_VERSION } from './db.ts';
import { MYSQL_TABLES, tableColumns, V19_MYSQL_STEPS } from './schema-mysql.ts';

// Version 19 (2.0): what the reviews added after version 18 was first built. A company file opened once by that
// first build is at 18 already: it must still get these (review of the fixes, finding 1).
const V19_TABLES = ['till_approvals', 'pos_pin_tries', 'pos_shift_refunds', 'item_price_history'];
const V19_COLUMNS: [string, string][] = [['gift_voucher_moves', 'for_voucher_id'], ['ws_handovers', 'cancelled_at'], ['ws_handovers', 'cancel_entry_id'], ['ws_collections', 'cancelled_at'], ['ws_collections', 'cancel_entry_id']];
const onServer = !!process.env.QASA_TEST_DB;

describe.skipIf(onServer)('version 19', () => {
  it('is the current version', () => { expect(SCHEMA_VERSION).toBe(19); });

  it('a file left at 18 by the first 2.0 build gets the tables and columns of 19, and its till works', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-v19-'));
    const file = join(dir, 'company.sqlite');
    try {
      // the file as that build left it: version 18, without anything of 19
      const raw = new DatabaseSync(file);
      raw.exec('PRAGMA foreign_keys = ON');
      migrate(raw as unknown as Db, 18);
      expect(Number((raw.prepare('SELECT version FROM schema_version').get() as { version: number }).version)).toBe(18);
      for (const t of V19_TABLES) expect(raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), t).toBeUndefined();
      for (const [t, c] of V19_COLUMNS) expect((raw.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((x) => x.name), `${t}.${c}`).not.toContain(c);
      raw.close();

      const db = openDatabase(file);
      try {
        expect(Number((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version)).toBe(19);
        for (const t of V19_TABLES) expect(Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n), t).toBe(0);
        for (const [t, c] of V19_COLUMNS) expect((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((x) => x.name), `${t}.${c}`).toContain(c);
        // what answered 500 on such a file: the till's shift, a sale, its close, and a price change
        const app = buildApp(db);
        const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object, headers: { 'x-qasa-client': '1' } });
        const item = (await post('/api/items', { name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2750, saleCurrency: 'IQD', trackStock: false })).json() as { id: string };
        expect(item.id).toBeTruthy();
        const wh = (await app.inject({ method: 'GET', url: '/api/warehouses' })).json() as { id: string }[];
        const opened = await post('/api/pos/shifts', { register: 'A', cashAccountCode: '1811', warehouseId: wh[0]!.id, openingCash: 0 });
        expect(opened.statusCode, opened.body).toBe(201);
        const shift = opened.json() as { id: string };
        expect((await app.inject({ method: 'GET', url: '/api/pos/current' })).statusCode).toBe(200);
        const sale = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: item.id, qtyMilli: 2000, unitPrice: 2750 }] });
        expect(sale.statusCode, sale.body).toBe(201);
        const priced = await app.inject({ method: 'PUT', url: `/api/items/${item.id}`, payload: { name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 3000, saleCurrency: 'IQD', trackStock: false }, headers: { 'x-qasa-client': '1' } });
        expect(priced.statusCode, priced.body).toBe(200);
        const closed = await post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 5500 });
        expect(closed.statusCode, closed.body).toBe(200);
        await app.close();
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has the same tables and columns in the server schema, the new columns last as on a company file', () => {
    const db = openDatabase(':memory:');
    try {
      for (const name of V19_TABLES) {
        expect(MYSQL_TABLES.find((x) => x.name === name)?.since, name).toBe(19);
        const sqlite = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
        expect([...tableColumns(name).columns], name).toEqual(sqlite);
      }
      for (const [t] of V19_COLUMNS) {
        const sqlite = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
        expect([...tableColumns(t).columns], t).toEqual(sqlite);
      }
      expect(V19_MYSQL_STEPS.filter((s) => s.kind === 'column').map((s) => `${s.table}.${(s as { column: string }).column}`)).toEqual(V19_COLUMNS.map(([t, c]) => `${t}.${c}`));
    } finally {
      db.close();
    }
  });
});
