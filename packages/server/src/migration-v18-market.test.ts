import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, schemaVersion, SCHEMA_VERSION, type Db, type SqlValue } from './db.ts';
import { MYSQL_TABLES, tableColumns, V18_MYSQL_STEPS, V19_MYSQL_STEPS } from './schema-mysql.ts';

// Version 18 (market extras): delivery orders, debt reminders, price checker devices and daily-delivery suppliers, on
// a company file and on a server database. New tables only: no column is added to an older table.
const onServer = !!process.env.QASA_TEST_DB;
const MARKET = ['delivery_drivers', 'delivery_orders', 'delivery_order_lines', 'delivery_handovers', 'party_reminders', 'price_checker_devices',
  'daily_supplier_items', 'daily_receipts', 'daily_receipt_lines', 'daily_receipt_returns'];

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qasa-v18-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(onServer)('a company file from schema 17 opened by schema 18', () => {
  it('gets the market extras’ tables, empty, and keeps what it had', () => {
    const file = join(dir, 'books.sqlite');
    const old = new DatabaseSync(file);
    migrate(old as unknown as Db, 17);
    old.prepare(`INSERT INTO items (id, code, name_ar, name_en, name_ku, unit, sale_price, sale_currency, created_at) VALUES ('i-old', 'OLD', 'a', 'b', 'c', 'piece', 1000, 'IQD', '2026-11-01T08:00:00Z')`).run();
    expect(old.prepare("SELECT name FROM sqlite_master WHERE name = 'delivery_orders'").get()).toBeUndefined();
    old.close();
    const db = openDatabase(file);
    try {
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
      expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(18);
      for (const table of MARKET) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
      expect(db.prepare("SELECT code FROM items WHERE id = 'i-old'").get()).toEqual({ code: 'OLD' });
    } finally {
      db.close();
    }
  });
});

describe('version 18 on a server database', () => {
  it('has the tables in the server schema, each after the tables it points to, with the same columns', () => {
    const names = MYSQL_TABLES.map((t) => t.name);
    for (const table of MARKET) expect(MYSQL_TABLES.find((x) => x.name === table)?.since, table).toBe(18);
    expect(names.indexOf('delivery_orders')).toBeGreaterThan(names.indexOf('delivery_drivers'));
    expect(names.indexOf('delivery_order_lines')).toBeGreaterThan(names.indexOf('delivery_orders'));
    expect(names.indexOf('delivery_handovers')).toBeGreaterThan(names.indexOf('delivery_drivers'));
    expect(names.indexOf('daily_receipt_lines')).toBeGreaterThan(names.indexOf('daily_receipts'));
    expect(names.indexOf('daily_receipt_returns')).toBeGreaterThan(names.indexOf('daily_receipts'));
    // (version 18's columns on older tables are the till's: migration-v18.test.ts)
    expect(tableColumns('price_checker_devices').columns).toEqual(['id', 'name', 'token_hash', 'warehouse_id', 'created_by', 'created_at', 'last_seen_at', 'revoked_at']);
  });

  it('runs on a server at version 17: the version 18 tables are made, nothing else, then the version is written', () => {
    let version = 17;
    const existing = new Set(MYSQL_TABLES.filter((t) => !t.since || t.since <= 17).map((t) => t.name));
    const ran: string[] = [];
    const fake: Db = {
      dialect: 'mysql',
      close() {},
      exec(sql: string) { ran.push(sql.trim().split('\n')[0]!.replace(/\s+/g, ' ')); },
      prepare(sql: string) {
        return {
          run: (...p: unknown[]) => { if (/UPDATE schema_version/.test(sql)) version = Number(p[0]); return { changes: 1, lastInsertRowid: 0 }; },
          get: (): Record<string, SqlValue> | undefined => (/schema_version/.test(sql) ? { version } : /VERSION\(\)/.test(sql) ? { v: '11.4.2-MariaDB' } : undefined),
          all: (): Record<string, SqlValue>[] => /information_schema\.tables/.test(sql) ? [...existing].map((name) => ({ name })) : []
        };
      }
    };
    migrate(fake);
    expect(version).toBe(SCHEMA_VERSION);
    const made = ran.filter((s) => s.startsWith('CREATE TABLE ') && !s.includes('schema_version')).map((s) => s.split(' ')[2]);
    for (const table of MARKET) expect(made).toContain(table);
    const v18 = new Set(MYSQL_TABLES.filter((t) => (t.since ?? 0) >= 18).map((t) => t.name));
    expect(made.filter((n) => !v18.has(n!))).toEqual([]);
    expect(ran.filter((s) => s.startsWith('ALTER TABLE'))).toEqual([...V18_MYSQL_STEPS, ...V19_MYSQL_STEPS].map((x) => x.sql));
  });
});
