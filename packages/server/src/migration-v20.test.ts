import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildApp } from './app.ts';
import type { Db } from './db.ts';
import { COMPANY_TABLES, migrate, openDatabase, SCHEMA_VERSION } from './db.ts';
import { MYSQL_TABLES, tableColumns } from './schema-mysql.ts';

// Version 20 (2.0): the answers of the open product databases kept a while, and where an item's picture came from.
// Version 19 is the schema 2.0 was reviewed with: it stays as it was, and a 2.0 company file gets 20 on top of it.
const V20_TABLES = ['product_lookups', 'item_image_sources'];
const onServer = !!process.env.QASA_TEST_DB;

describe.skipIf(onServer)('version 20', () => {
  it('is the current version', () => { expect(SCHEMA_VERSION).toBe(20); });

  it('a 2.0 company file (version 19) gets the two tables, empty, and keeps its items and their pictures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-v20-'));
    const file = join(dir, 'company.sqlite');
    try {
      const raw = new DatabaseSync(file);
      raw.exec('PRAGMA foreign_keys = ON');
      migrate(raw as unknown as Db, 19);
      expect(Number((raw.prepare('SELECT version FROM schema_version').get() as { version: number }).version)).toBe(19);
      for (const t of V20_TABLES) expect(raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), t).toBeUndefined();
      raw.close();

      const db = openDatabase(file);
      try {
        expect(Number((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version)).toBe(20);
        for (const t of V20_TABLES) expect(Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n), t).toBe(0);
        const app = buildApp(db);
        const headers = { 'x-qasa-client': '1' };
        const item = (await app.inject({ method: 'POST', url: '/api/items', headers, payload: { name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2750, saleCurrency: 'IQD', trackStock: false } })).json() as { id: string };
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        const put = await app.inject({ method: 'PUT', url: `/api/items/${item.id}/image`, headers, payload: { data: png.toString('base64') } });
        expect(put.statusCode, put.body).toBe(200);
        // deleting the item takes its picture and the picture's source with it
        db.prepare('INSERT INTO item_image_sources (item_id, source, licence, url, created_at) VALUES (?, ?, ?, ?, ?)').run(item.id, 'openfoodfacts', 'CC BY-SA 3.0', 'https://world.openfoodfacts.org/product/5449000000996', new Date().toISOString());
        const gone = await app.inject({ method: 'DELETE', url: `/api/items/${item.id}`, headers });
        expect(gone.statusCode, gone.body).toBe(204);
        expect(Number((db.prepare('SELECT COUNT(*) AS n FROM item_image_sources').get() as { n: number }).n)).toBe(0);
        await app.close();
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs again over a file that has its tables already (a build made while it was written)', () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec('PRAGMA foreign_keys = ON');
    migrate(raw as unknown as Db, 19);
    raw.exec('CREATE TABLE product_lookups (barcode TEXT PRIMARY KEY, found INTEGER NOT NULL DEFAULT 0 CHECK (found IN (0, 1)), source TEXT, name TEXT, name_ar TEXT, name_en TEXT, name_ku TEXT, brand TEXT, quantity TEXT, image_url TEXT, image_small_url TEXT, page_url TEXT, looked_at TEXT NOT NULL)');
    migrate(raw as unknown as Db);
    expect(Number((raw.prepare('SELECT version FROM schema_version').get() as { version: number }).version)).toBe(20);
    expect(Number((raw.prepare('SELECT COUNT(*) AS n FROM item_image_sources').get() as { n: number }).n)).toBe(0);
    raw.close();
  });

  it('has the same tables and columns in the server schema, after the tables they point at', () => {
    const db = openDatabase(':memory:');
    try {
      for (const name of V20_TABLES) {
        expect(MYSQL_TABLES.find((x) => x.name === name)?.since, name).toBe(20);
        const sqlite = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
        expect([...tableColumns(name).columns], name).toEqual(sqlite);
      }
      expect(tableColumns('product_lookups').primaryKey).toEqual(['barcode']);
      expect(tableColumns('item_image_sources').primaryKey).toEqual(['item_id']);
      expect(COMPANY_TABLES.indexOf('item_image_sources')).toBeGreaterThan(COMPANY_TABLES.indexOf('items'));
      // nothing of version 19 moved to 20, and nothing else is marked 20
      expect(MYSQL_TABLES.filter((x) => x.since === 20).map((x) => x.name).sort()).toEqual([...V20_TABLES].sort());
    } finally {
      db.close();
    }
  });
});
