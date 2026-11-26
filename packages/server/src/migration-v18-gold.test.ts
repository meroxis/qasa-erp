import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, schemaVersion, SCHEMA_VERSION, type Db, type SqlValue } from './db.ts';
import { MYSQL_TABLES, tableColumns, V18_MYSQL_STEPS, V19_MYSQL_STEPS, V21_MYSQL_STEPS } from './schema-mysql.ts';

// Version 18 (gold shops): the gold pieces' terms, the day's gold board, gold documents, old gold and suppliers' gold,
// on a company file and on a server database. It adds no column to an older table.
const onServer = !!process.env.QASA_TEST_DB;
const GOLD = ['gold_items', 'gold_prices', 'gold_suppliers', 'gold_docs', 'gold_doc_lines', 'gold_scrap_moves', 'gold_supplier_moves'];

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qasa-v18-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(onServer)('a company file from schema 17 opened by schema 18', () => {
  it('gets the gold tables, empty, and keeps what it had', () => {
    const file = join(dir, 'books.sqlite');
    const old = new DatabaseSync(file);
    migrate(old as unknown as Db, 17);
    old.prepare(`INSERT INTO items (id, code, name_ar, name_en, name_ku, unit, sale_price, sale_currency, created_at) VALUES ('i-old', 'OLD', 'a', 'b', 'c', 'piece', 1000, 'IQD', '2026-11-01T08:00:00Z')`).run();
    expect(old.prepare("SELECT name FROM sqlite_master WHERE name = 'gold_items'").get()).toBeUndefined();
    old.close();
    const db = openDatabase(file);
    try {
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
      expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(18);
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'gold_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
      expect(tables).toEqual([...GOLD].sort());
      for (const table of GOLD) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
      expect(db.prepare("SELECT code FROM items WHERE id = 'i-old'").get()).toEqual({ code: 'OLD' });
    } finally {
      db.close();
    }
  });
});

describe('version 18 on a server database', () => {
  it('has the gold tables in the server schema, each after the tables it points at', () => {
    const names = MYSQL_TABLES.map((t) => t.name);
    for (const table of GOLD) expect(MYSQL_TABLES.find((x) => x.name === table)?.since, table).toBe(18);
    expect(names.indexOf('gold_items')).toBeGreaterThan(names.indexOf('items'));
    expect(names.indexOf('gold_doc_lines')).toBeGreaterThan(names.indexOf('gold_docs'));
    // (version 18's columns on older tables are the till's: migration-v18.test.ts)
    expect(tableColumns('gold_items').columns).toEqual(['item_id', 'weight_mg', 'karat', 'making_kind', 'making_amount', 'created_at', 'updated_at']);
  });

  it('runs on a server at version 17: the gold tables are made, nothing else, then the version is written', () => {
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
    for (const table of GOLD) expect(made).toContain(table);
    const v18 = new Set(MYSQL_TABLES.filter((t) => (t.since ?? 0) >= 18).map((t) => t.name));
    expect(made.filter((n) => !v18.has(n!))).toEqual([]);
    expect(ran.filter((s) => s.startsWith('ALTER TABLE'))).toEqual([...V18_MYSQL_STEPS, ...V19_MYSQL_STEPS, ...V21_MYSQL_STEPS].map((x) => x.sql));
  });
});
