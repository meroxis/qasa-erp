import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, schemaVersion, SCHEMA_VERSION, type Db, type SqlValue } from './db.ts';
import { MYSQL_TABLES, tableColumns, V17_MYSQL_STEPS } from './schema-mysql.ts';

// Version 17 (supermarket): the tills, offers, consignment goods and the shelf labels to reprint, with the columns it adds
// to older tables, on a company file and on a server database.
const onServer = !!process.env.QASA_TEST_DB;
const CONSIGNMENT = ['consignment_items', 'consignment_docs', 'consignment_doc_lines', 'consignment_settlements', 'consignment_moves'];

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qasa-v17-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(onServer)('a company file from schema 16 opened by schema 17', () => {
  it('gets the shelf labels table, empty: items made before it have no label to reprint', () => {
    const file = join(dir, 'books.sqlite');
    const old = new DatabaseSync(file);
    migrate(old as unknown as Db, 16);
    old.prepare(`INSERT INTO items (id, code, name_ar, name_en, name_ku, unit, sale_price, sale_currency, created_at) VALUES ('i-old', 'OLD', 'a', 'b', 'c', 'piece', 1000, 'IQD', '2026-11-01T08:00:00Z')`).run();
    expect(old.prepare("SELECT name FROM sqlite_master WHERE name = 'shelf_label_flags'").get()).toBeUndefined();
    old.close();
    const db = openDatabase(file);
    try {
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
      expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(17);
      expect(db.prepare('SELECT COUNT(*) AS n FROM shelf_label_flags').get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT code FROM items WHERE id = 'i-old'").get()).toEqual({ code: 'OLD' });
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'consignment_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
      expect(tables).toEqual([...CONSIGNMENT].sort());
      expect(db.prepare('SELECT COUNT(*) AS n FROM pos_tills').get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
});

describe('version 17 on a server database', () => {
  it('has the table in the server schema after items, with the same columns', () => {
    const names = MYSQL_TABLES.map((t) => t.name);
    expect(MYSQL_TABLES.find((t) => t.name === 'shelf_label_flags')?.since).toBe(17);
    expect(names.indexOf('shelf_label_flags')).toBeGreaterThan(names.indexOf('items'));
    for (const table of CONSIGNMENT) expect(MYSQL_TABLES.find((x) => x.name === table)?.since, table).toBe(17);
    expect(names.indexOf('consignment_doc_lines')).toBeGreaterThan(names.indexOf('consignment_docs'));
    expect(names.indexOf('consignment_moves')).toBeGreaterThan(names.indexOf('consignment_settlements'));
    expect(names.indexOf('pos_tills')).toBeLessThan(names.indexOf('pos_shifts'));
    // the columns version 17 adds to older tables are each a step of their own
    for (const step of V17_MYSQL_STEPS) expect(step.sql).toMatch(/^ALTER TABLE /);
    expect(tableColumns('shelf_label_flags').columns).toEqual(['item_id', 'unit', 'old_price', 'new_price', 'currency', 'changed_at', 'changed_by']);
  });

  it('runs on a server at version 16: the version 17 tables are made, nothing else, then the version is written', () => {
    let version = 16;
    const existing = new Set(MYSQL_TABLES.filter((t) => !t.since || t.since <= 16).map((t) => t.name));
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
    // (other version 17 tables may be made beside it; nothing older is made again)
    for (const table of ['shelf_label_flags', 'pos_tills', ...CONSIGNMENT]) expect(made).toContain(table);
    const v17 = new Set(MYSQL_TABLES.filter((t) => (t.since ?? 0) >= 17).map((t) => t.name));
    expect(made.filter((n) => !v17.has(n!))).toEqual([]);
    // no column is added but version 17's own
    const steps = V17_MYSQL_STEPS.map((x) => x.sql);
    expect(ran.filter((s) => s.startsWith('ALTER TABLE') && !steps.includes(s))).toEqual([]);
  });
});
