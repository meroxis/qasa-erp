import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, SCHEMA_VERSION, schemaVersion, type Db, type SqlValue } from './db.ts';
import { MYSQL_TABLES, V17_MYSQL_STEPS } from './schema-mysql.ts';

// Version 17: goods on consignment (consignment.ts): the items a supplier leaves, the receipts and returns with their
// lines, the settlements, and every move of those goods as the supplier sees it. New tables only.
const onServer = !!process.env.QASA_TEST_DB;
const TABLES = ['consignment_items', 'consignment_docs', 'consignment_doc_lines', 'consignment_settlements', 'consignment_moves'];

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qasa-v17-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(onServer)('a company file from schema 16 opened by schema 17', () => {
  it('gets the consignment tables, keeping what it had', () => {
    const file = join(dir, 'books.sqlite');
    const old = new DatabaseSync(file);
    migrate(old as unknown as Db, 16);
    old.prepare(`INSERT INTO entries (id, type, date, description, currency, rate_x100, status, prepared_by, prepared_at, updated_at)
                 VALUES ('e-old', 'journal', '2026-11-01', 'Before 1.7', 'IQD', 100, 'draft', 'Las', '2026-11-01T08:00:00Z', '2026-11-01T08:00:00Z')`).run();
    expect(old.prepare("SELECT name FROM sqlite_master WHERE name = 'consignment_items'").get()).toBeUndefined();
    old.close();
    const db = openDatabase(file);
    try {
      expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(17);
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'consignment_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
      expect(tables).toEqual([...TABLES].sort());
      expect(db.prepare("SELECT description FROM entries WHERE id = 'e-old'").get()).toEqual({ description: 'Before 1.7' });
    } finally {
      db.close();
    }
  });
});

describe('version 17 on a server database', () => {
  it('has the same tables, made after what they point at, since 17', () => {
    const names = MYSQL_TABLES.map((t) => t.name);
    for (const table of TABLES) expect(MYSQL_TABLES.find((x) => x.name === table)?.since, table).toBe(17);
    expect(names.indexOf('consignment_doc_lines')).toBeGreaterThan(names.indexOf('consignment_docs'));
    expect(names.indexOf('consignment_moves')).toBeGreaterThan(names.indexOf('consignment_settlements'));
    expect(V17_MYSQL_STEPS).toEqual([]);
  });

  it('runs on a server at version 16: the consignment tables are made, nothing else, then the version is written', () => {
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
    expect(made.sort()).toEqual([...TABLES].sort());
    expect(ran.filter((s) => s.startsWith('ALTER TABLE'))).toEqual([]);
  });
});
