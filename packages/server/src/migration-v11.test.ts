import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, SCHEMA_VERSION, schemaVersion, updateCopies, type Db, type SqlValue } from './db.ts';
import { buildApp } from './app.ts';
import { MYSQL_TABLES, pendingMysqlSteps, tableColumns, V11_MYSQL_STEPS } from './schema-mysql.ts';
import { AppError } from './errors.ts';

// QASA_TEST_DB runs the suite on a server: these build and open SQLite files themselves
const onServer = !!process.env.QASA_TEST_DB;
const headers = { 'x-qasa-user': encodeURIComponent('Mer') };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qasa-v11-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A version-10 company file with car parts whose brands were typed by hand, in several spellings. */
function version10(file: string): void {
  const db = new DatabaseSync(file);
  migrate(db as unknown as Db, 10);
  const item = db.prepare(`INSERT INTO items (id, code, name_ar, name_en, name_ku, unit, sale_price, sale_currency, track_stock, active, created_at)
                           VALUES (?, ?, ?, ?, ?, 'piece', 1000, 'IQD', 1, 1, '2026-10-01T00:00:00Z')`);
  const part = db.prepare("INSERT INTO part_details (item_id, shelf, brand, origin, reorder_milli, updated_at) VALUES (?, 'A-1', ?, 'japan', ?, '2026-10-01T00:00:00Z')");
  const parts: [string, string | null, number | null][] = [
    ['P1', 'Denso', 5_000], ['P2', 'denso ', null], ['P3', ' DENSO', 2_000], ['P4', 'Mann  Filter', null], ['P5', 'mann filter', null],
    ['P6', 'Mann Filter', null], ['P7', '', null], ['P8', null, 1_000]
  ];
  for (const [code, brand, reorder] of parts) {
    item.run(code, code, code, code, code);
    part.run(code, brand, reorder);
  }
  item.run('PLAIN', 'PLAIN', 'Plain', 'Plain', 'Plain');
  db.close();
}

describe.skipIf(onServer)('a company file from schema 10 opened by schema 11', () => {
  it('moves each car part\'s brand text into one brand list (one brand per name, as most parts wrote it) and its reorder level onto the item', async () => {
    const file = join(dir, 'books.sqlite');
    version10(file);
    const db = openDatabase(file, { now: () => new Date(2026, 10, 11, 9, 0, 0) });
    try {
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
      expect(SCHEMA_VERSION).toBe(11);
      expect(updateCopies(file).map((f) => basename(f))).toEqual(['books-before-update-v10-20261111-090000.sqlite']);
      expect(db.prepare('SELECT name FROM brands ORDER BY sort').all()).toEqual([{ name: 'Denso' }, { name: 'Mann Filter' }]);
      const brandOf = Object.fromEntries((db.prepare('SELECT i.code, b.name FROM items i LEFT JOIN brands b ON b.id = i.brand_id ORDER BY i.code').all() as { code: string; name: string | null }[])
        .map((r) => [r.code, r.name]));
      expect(brandOf).toEqual({ P1: 'Denso', P2: 'Denso', P3: 'Denso', P4: 'Mann Filter', P5: 'Mann Filter', P6: 'Mann Filter', P7: null, P8: null, PLAIN: null });
      expect(db.prepare('SELECT COUNT(*) AS n FROM part_details WHERE brand IS NOT NULL OR reorder_milli IS NOT NULL').get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT code, reorder_milli FROM items WHERE reorder_milli IS NOT NULL ORDER BY code").all())
        .toEqual([{ code: 'P1', reorder_milli: 5_000 }, { code: 'P3', reorder_milli: 2_000 }, { code: 'P8', reorder_milli: 1_000 }]);
      // the categories got their parent and the stock counts their scope, empty
      expect(db.prepare('SELECT COUNT(*) AS n FROM item_categories WHERE parent_id IS NOT NULL').get()).toEqual({ n: 0 });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

      // the items keep their brand through the API
      const app = buildApp(db);
      const p2 = ((await app.inject({ url: '/api/items?q=denso', headers })).json() as { code: string; brandId: string; reorderMilli: number | null }[]);
      expect(p2.map((i) => i.code)).toEqual(['P1', 'P2', 'P3']);
      expect(p2[0]!.reorderMilli).toBe(5_000);
      await app.close();
    } finally {
      db.close();
    }
  });

  it('a schema-11 file is refused by an app that knows schema 10', () => {
    const file = join(dir, 'new.sqlite');
    openDatabase(file).close();
    const db = new DatabaseSync(file) as unknown as Db;
    try {
      let error: unknown;
      try { migrate(db, 10); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'database_newer', details: { version: 11, app: 10 } });
      expect(schemaVersion(db)).toBe(11);
    } finally {
      db.close();
    }
    // and by opening with this app's own check when the file is newer still
    const newer = new DatabaseSync(file);
    newer.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION + 1);
    newer.close();
    expect(() => openDatabase(file)).toThrow(expect.objectContaining({ code: 'database_newer' }));
  });
});

describe('version 11 on a server database', () => {
  it('adds the brands table first, then each column and foreign key once, then moves the part brands', () => {
    let version = 10;
    const existing = new Set(MYSQL_TABLES.filter((t) => !t.since || t.since <= 10).map((t) => t.name));
    const ran: string[] = [];
    const params: unknown[][] = [];
    const fake: Db = {
      dialect: 'mysql',
      close() {},
      exec(sql: string) { ran.push(sql.trim().split('\n')[0]!.replace(/\s+/g, ' ')); },
      prepare(sql: string) {
        return {
          run: (...p: unknown[]) => {
            if (/UPDATE schema_version/.test(sql)) version = Number(p[0]);
            else { ran.push(sql.trim().split('\n')[0]!.replace(/\s+/g, ' ')); params.push(p); }
            return { changes: 1, lastInsertRowid: 0 };
          },
          get: (): Record<string, SqlValue> | undefined => (/schema_version/.test(sql) ? { version } : /VERSION\(\)/.test(sql) ? { v: '8.4.3' } : /MAX\(sort\)/.test(sql) ? { s: 0 } : undefined),
          all: (): Record<string, SqlValue>[] => /information_schema\.tables/.test(sql) ? [...existing].map((name) => ({ name }))
            : /FROM part_details WHERE brand/.test(sql) ? [{ item_id: 'i1', brand: 'Denso' }, { item_id: 'i2', brand: 'DENSO ' }] : []
        };
      }
    };
    migrate(fake);
    expect(version).toBe(SCHEMA_VERSION);
    const created = ran.filter((s) => s.startsWith('CREATE TABLE') && !s.includes('IF NOT EXISTS'));
    expect(created).toEqual(['CREATE TABLE brands (']);
    const alters = ran.filter((s) => s.startsWith('ALTER TABLE'));
    expect(alters).toEqual(V11_MYSQL_STEPS.map((s) => s.sql));
    // one brand for both spellings, both items pointed at it, the texts emptied, in a transaction after the steps
    expect(ran.filter((s) => s.startsWith('INSERT INTO brands'))).toHaveLength(1);
    expect(ran.filter((s) => s.startsWith('UPDATE items SET brand_id'))).toHaveLength(2);
    const start = ran.indexOf('START TRANSACTION');
    expect(start).toBeGreaterThan(ran.lastIndexOf(alters.at(-1)!));
    expect(ran.indexOf('UPDATE part_details SET brand = NULL WHERE brand IS NOT NULL')).toBeGreaterThan(start);
    expect(ran.at(-1)).toBe('COMMIT');
  });

  it('skips what an upgrade cut off half way made already, and adds the columns the fresh server schema has last', () => {
    const done = { columns: new Set(['item_categories.parent_id']), foreignKeys: new Set(['item_categories.parent_id>item_categories']) };
    expect(pendingMysqlSteps(V11_MYSQL_STEPS, done)).toEqual(V11_MYSQL_STEPS.filter((s) => s.column !== 'parent_id').map((s) => s.sql));
    expect(pendingMysqlSteps(V11_MYSQL_STEPS, done)).toHaveLength(V11_MYSQL_STEPS.length - 2);
    for (const table of ['item_categories', 'items', 'stock_counts']) {
      const added = V11_MYSQL_STEPS.filter((s) => s.kind === 'column' && s.table === table).map((s) => (s as { column: string }).column);
      expect(tableColumns(table).columns.slice(-added.length), table).toEqual(added);
    }
    const order = MYSQL_TABLES.map((t) => t.name);
    expect(order.indexOf('brands')).toBeLessThan(order.indexOf('items'));
  });
});
