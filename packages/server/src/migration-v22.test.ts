import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db } from './db.ts';
import { migrate, openDatabase, SCHEMA_VERSION } from './db.ts';
import { MYSQL_TABLES, tableColumns } from './schema-mysql.ts';

// Version 22 (2.1): restaurants and cafés (restaurant.ts): the room's areas and tables, orders and their lines, and
// what each till sale paid of which line. New tables only, the same on a MariaDB or MySQL server.
const onServer = !!process.env.QASA_TEST_DB;
const RS_TABLES = ['rs_areas', 'rs_tables', 'rs_orders', 'rs_order_lines', 'rs_paid'];

describe.skipIf(onServer)('version 22', () => {
  it('is the current version', () => { expect(SCHEMA_VERSION).toBe(22); });

  it('comes on top of a 2.0 company file (version 21) and keeps its data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-v22-'));
    const file = join(dir, 'company.sqlite');
    try {
      const raw = new DatabaseSync(file);
      raw.exec('PRAGMA foreign_keys = ON');
      migrate(raw as unknown as Db, 21);
      expect(raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rs_orders'").get()).toBeUndefined();
      raw.prepare("INSERT INTO items (id, code, name_ar, name_en, name_ku, unit, sale_price, sale_currency, track_stock, active, created_at) VALUES ('i1', 'TEA', 'شاي', 'Tea', 'چا', 'piece', 1000, 'IQD', 0, 1, '2026-11-01T00:00:00Z')").run();
      raw.close();
      const db = openDatabase(file);
      try {
        expect(Number((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version)).toBe(22);
        for (const t of RS_TABLES) expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), t).toBeTruthy();
        expect(db.prepare("SELECT code FROM items WHERE id = 'i1'").get()).toEqual({ code: 'TEA' });
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a server gets the same tables and columns, from version 22', () => {
    const db = openDatabase(':memory:');
    try {
      for (const t of RS_TABLES) {
        const mine = MYSQL_TABLES.find((m) => m.name === t);
        expect(mine?.since, t).toBe(22);
        const sqlite = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
        expect(tableColumns(t).columns, t).toEqual(sqlite);
      }
    } finally {
      db.close();
    }
  });
});
