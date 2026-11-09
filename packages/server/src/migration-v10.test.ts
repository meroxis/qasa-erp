import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { COMPANY_TABLES, migrate, openDatabase, SCHEMA_VERSION, schemaVersion, updateCopies, type Db, type SqlValue } from './db.ts';
import { buildApp } from './app.ts';
import { pendingMysqlSteps, tableColumns, V10_MYSQL_STEPS, V11_MYSQL_STEPS, MYSQL_TABLES } from './schema-mysql.ts';
import { AppError } from './errors.ts';

// QASA_TEST_DB runs the suite on a server: these build and open SQLite files themselves
const onServer = !!process.env.QASA_TEST_DB;
const headers = { 'x-qasa-user': encodeURIComponent('Mer') };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qasa-v10-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** Books as 1.0.3 kept them: a purchase, a sale, a draft sale, an opening stock document, an adjustment and a picture. */
async function booksOf103(): Promise<{ full: Db; ids: Record<string, string> }> {
  const full = openDatabase(':memory:');
  const app: FastifyInstance = buildApp(full);
  const post = async (url: string, body: unknown = {}) => {
    const r = await app.inject({ method: 'POST', url, payload: body as object, headers });
    expect(r.statusCode, `${url} ${r.body}`).toBeLessThan(300);
    return r.json();
  };
  const warehouseId = (await app.inject({ url: '/api/warehouses', headers })).json()[0].id as string;
  const mer = await post('/api/parties', { type: 'customer', name: 'Mer' });
  const las = await post('/api/parties', { type: 'supplier', name: 'Las' });
  const item = await post('/api/items', { code: 'TEA', barcode: '111', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'box', salePrice: 5_000, saleCurrency: 'IQD' });
  const base = { date: '2026-10-01', warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0 };
  const purchase = await post('/api/invoices', { ...base, kind: 'purchase', partyId: las.id, lines: [{ itemId: item.id, qtyMilli: 10_000, unitPrice: 3_000 }] });
  await post(`/api/invoices/${purchase.id}/post`);
  const sale = await post('/api/invoices', { ...base, kind: 'sale', partyId: mer.id, date: '2026-10-02', lines: [{ itemId: item.id, qtyMilli: 4_000, unitPrice: 5_000 }] });
  await post(`/api/invoices/${sale.id}/post`);
  const draft = await post('/api/invoices', { ...base, kind: 'sale', partyId: mer.id, date: '2026-10-05', lines: [{ itemId: item.id, qtyMilli: 1_000, unitPrice: 5_000 }] });
  const doc = await post('/api/stock-docs', { kind: 'opening', date: '2026-10-03', warehouseId, counterAccountCode: '21', lines: [{ itemId: item.id, qtyMilli: 2_000, unitCost: 3_000 }] });
  await post(`/api/stock-docs/${doc.id}/post`);
  const adj = await post('/api/adjustments', { date: '2026-10-04', warehouseId, reason: 'damaged', lines: [{ itemId: item.id, qtyMilli: -1_000 }] });
  await post(`/api/adjustments/${adj.id}/post`);
  full.prepare("INSERT INTO item_images (item_id, mime, data, updated_at) VALUES (?, 'image/png', ?, '2026-10-01T00:00:00Z')").run(item.id, new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
  await app.close();
  return { full, ids: { item: item.id, purchase: purchase.id, sale: sale.id, draft: draft.id, doc: doc.id, adj: adj.id, mer: mer.id } };
}

const columnsOf = (db: Db, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const tablesOf = (db: Db) => new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));

/** The same books in a version-9 file: every table and column 1.0.3 had, nothing of 1.1. */
function asVersion9(full: Db, file: string): void {
  const old = new DatabaseSync(file);
  migrate(old as unknown as Db, 9);
  old.exec('PRAGMA foreign_keys = OFF');
  const tables = tablesOf(old as unknown as Db);
  // children first: the "posted is permanent" triggers look at the parent, which is not there yet
  for (const table of [...COMPANY_TABLES].reverse()) {
    if (!tables.has(table)) continue;
    const cols = columnsOf(old as unknown as Db, table);
    const where = table === 'settings' ? ` WHERE "key" NOT IN ('near_expiry_days', 'expired_sales', 'default_track_expiry')` : '';
    const rows = full.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM ${table}${where}`).all();
    const insert = old.prepare(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
    for (const r of rows) insert.run(...cols.map((c) => r[c] as SqlValue));
  }
  old.close();
}

/** Every row of every table 1.0.3 had, in its 1.0.3 columns, in key order. */
function snapshot(db: Db, tables: Set<string>, columns: Map<string, string[]>): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const table of COMPANY_TABLES) {
    if (!tables.has(table)) continue;
    const { primaryKey } = tableColumns(table);
    out[table] = db.prepare(`SELECT ${columns.get(table)!.map((c) => `"${c}"`).join(', ')} FROM ${table} ORDER BY ${primaryKey.map((c) => `"${c}"`).join(', ')}`).all();
  }
  return out;
}

describe.skipIf(onServer)('a company file from 1.0.3 (schema 9) opened by 1.1', () => {
  it('is copied first, reaches the current version with every old row as it was, and reads old lines as the base unit with no batch', async () => {
    const { full, ids } = await booksOf103();
    const file = join(dir, 'books.sqlite');
    asVersion9(full, file);
    const v9 = new DatabaseSync(file, { readOnly: true }) as unknown as Db;
    const tables = tablesOf(v9);
    const columns = new Map([...tables].map((t) => [t, columnsOf(v9, t)]));
    const before = snapshot(v9, tables, columns);
    expect(schemaVersion(v9)).toBe(9);
    v9.close();

    const db = openDatabase(file, { now: () => new Date(2026, 10, 9, 8, 0, 0) });
    try {
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
      expect(updateCopies(file).map((f) => basename(f))).toEqual(['books-before-update-v9-20261109-080000.sqlite']);
      const after = snapshot(db, tables, columns);
      // start-up adds the new settings (rows of their own); every row that was there is as it was
      const added = (after.settings as { key: string }[]).filter((r) => !(before.settings as { key: string }[]).some((b) => b.key === r.key)).map((r) => r.key).sort();
      expect(added).toEqual(['default_track_expiry', 'expired_sales', 'near_expiry_days']);
      expect({ ...after, settings: (after.settings as { key: string }[]).filter((r) => !added.includes(r.key)) }).toEqual(before);
      expect(db.prepare('SELECT sha256 FROM item_images').get()).toEqual({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });

      const app = buildApp(db);
      const sale = (await app.inject({ url: `/api/invoices/${ids.sale}`, headers })).json();
      expect(sale.lines[0]).toMatchObject({ qtyMilli: 4_000, lineUnit: null, unitFactorMilli: null, unitQtyMilli: null });
      const item = (await app.inject({ url: `/api/items/${ids.item}`, headers })).json();
      expect(item).toMatchObject({ units: [], saleUnit: null, purchaseUnit: null, qtyMilli: 7_000 });

      // the old books keep working: post the 1.0.3 draft, return from the old sale, cancel the return and the sale
      const call = (url: string, body: object = {}) => app.inject({ method: 'POST', url, payload: body, headers });
      const posted = await call(`/api/invoices/${ids.draft}/post`);
      expect(posted.statusCode, posted.body).toBe(200);
      const ret = await call(`/api/invoices/${ids.sale}/returns`, { date: '2026-11-09', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 1_000 }] });
      expect(ret.statusCode, ret.body).toBe(201);
      expect((await call(`/api/invoices/${ret.json().id}/cancel`, { date: '2026-11-09' })).statusCode).toBe(200);
      const cancelled = await call(`/api/invoices/${ids.sale}/cancel`, { date: '2026-11-09' });
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      expect((await call(`/api/stock-docs/${ids.doc}/cancel`, { date: '2026-11-09' })).statusCode).toBe(200);
      expect((await call(`/api/adjustments/${ids.adj}/cancel`, { date: '2026-11-09' })).statusCode).toBe(200);
      expect((await app.inject({ url: `/api/items/${ids.item}`, headers })).json().qtyMilli).toBe(9_000);
      await app.close();
    } finally {
      db.close();
      full.close();
    }
  });

  it('a 1.1 file is refused by an app that knows version 9 (as 1.0.x does)', () => {
    const file = join(dir, 'new.sqlite');
    openDatabase(file).close();
    const db = new DatabaseSync(file) as unknown as Db;
    try {
      let error: unknown;
      try { migrate(db, 9); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'database_newer', details: { version: SCHEMA_VERSION, app: 9 } });
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });
});

describe('version 10 on a server database', () => {
  it('adds each new column and foreign key once: a second start after an upgrade cut off half way adds only the rest', () => {
    const all = V10_MYSQL_STEPS.map((s) => s.sql);
    const none = pendingMysqlSteps(V10_MYSQL_STEPS, { columns: new Set(), foreignKeys: new Set() });
    expect(none).toEqual(all);
    // half the columns made, and the first foreign key
    const half = V10_MYSQL_STEPS.slice(0, Math.floor(V10_MYSQL_STEPS.length / 2));
    const state = {
      columns: new Set(half.filter((s) => s.kind === 'column').map((s) => `${s.table}.${s.column}`)),
      foreignKeys: new Set(half.filter((s) => s.kind === 'foreignKey').map((s) => `${s.table}.${s.column}>${s.parent}`))
    };
    expect(pendingMysqlSteps(V10_MYSQL_STEPS, state)).toEqual(all.slice(half.length));
    const done = {
      columns: new Set(V10_MYSQL_STEPS.filter((s) => s.kind === 'column').map((s) => `${s.table}.${s.column}`)),
      foreignKeys: new Set(V10_MYSQL_STEPS.filter((s) => s.kind === 'foreignKey').map((s) => `${s.table}.${s.column}>${s.parent}`))
    };
    expect(pendingMysqlSteps(V10_MYSQL_STEPS, done)).toEqual([]);
  });

  it('adds the same columns, in the same order, that the fresh server schema has last', () => {
    for (const table of ['items', 'invoice_lines', 'stock_doc_lines', 'stock_adjustment_lines', 'purchase_order_lines', 'item_images']) {
      const added = V10_MYSQL_STEPS.filter((s) => s.kind === 'column' && s.table === table).map((s) => (s as { column: string }).column);
      const { columns } = tableColumns(table);
      expect(columns.slice(-added.length), table).toEqual(added);
    }
    // the new tables come before what points at them
    const order = MYSQL_TABLES.map((t) => t.name);
    expect(order.indexOf('item_categories')).toBeLessThan(order.indexOf('items'));
    expect(order.indexOf('item_batches')).toBeLessThan(order.indexOf('invoice_lines'));
  });

  it('runs on a server database at version 9: new tables, then only the columns still missing, then the current version', () => {
    let version = 9;
    const existing = new Set(MYSQL_TABLES.filter((t) => !t.since || t.since < 10).map((t) => t.name));
    const columns = new Set(['items.category_id', 'items.sale_unit']);
    const indexes = new Set<string>();
    const ran: string[] = [];
    const fake: Db = {
      dialect: 'mysql',
      close() {},
      exec(sql: string) {
        ran.push(sql.trim().split('\n')[0]!.replace(/\s+/g, ' '));
        // the table made at version 10 comes with the keys of the current schema
        if (/CREATE TABLE item_batches\b/.test(sql)) indexes.add('item_batches.item_batches_number_expiry');
      },
      prepare(sql: string) {
        return {
          run: (...p: unknown[]) => { if (/UPDATE schema_version/.test(sql)) version = Number(p[0]); return { changes: 1, lastInsertRowid: 0 }; },
          get: (): Record<string, SqlValue> | undefined => (/schema_version/.test(sql) ? { version } : /VERSION\(\)/.test(sql) ? { v: '8.4.3' } : undefined),
          all: (): Record<string, SqlValue>[] => /information_schema\.tables/.test(sql) ? [...existing].map((name) => ({ name }))
            : /information_schema\.columns/.test(sql) ? [...columns].map((c) => ({ t: c.split('.')[0]!, c: c.split('.')[1]! }))
              : /information_schema\.statistics/.test(sql) ? [...indexes].map((k) => ({ t: k.split('.')[0]!, i: k.split('.')[1]! })) : []
        };
      }
    };
    migrate(fake);
    expect(version).toBe(SCHEMA_VERSION);
    expect(ran.filter((s) => s.startsWith('CREATE TABLE') && !s.includes('IF NOT EXISTS')).map((s) => /CREATE TABLE (\w+)/.exec(s)![1])).toEqual(MYSQL_TABLES.filter((t) => t.since === 10).map((t) => t.name));
    expect(ran.filter((s) => s.startsWith('CREATE TRIGGER'))).toHaveLength(2);
    const alters = ran.filter((s) => s.startsWith('ALTER TABLE'));
    expect(alters).not.toContain('ALTER TABLE items ADD COLUMN category_id VARCHAR(191)');
    expect(alters[0]).toBe('ALTER TABLE items ADD COLUMN purchase_unit VARCHAR(32)');
    expect(alters).toContain('ALTER TABLE items ADD CONSTRAINT items_category_id_fk FOREIGN KEY (category_id) REFERENCES item_categories(id)');
    expect(alters).toHaveLength(V10_MYSQL_STEPS.length - 2);
  });
});

describe('version 11: stock with no batch number is one batch per expiry date', () => {
  it.skipIf(onServer)('a version-10 file keeps every batch and its stock, and can then hold dated stock with no number apart', async () => {
    const file = join(dir, 'v10.sqlite');
    const old = new DatabaseSync(file);
    migrate(old as unknown as Db, 10);
    old.close();
    // a 1.1 build of version 10: an item with a batch with no number (no date) and a numbered one
    const v10 = openDatabaseAt10(file);
    const itemId = 'item-1';
    v10.prepare("INSERT INTO items (id, code, name_ar, name_en, name_ku, unit, sale_price, sale_currency, track_stock, track_batches, track_expiry, active, created_at) VALUES (?, 'AMOX', 'a', 'Amox', 'k', 'capsule', 250, 'IQD', 1, 1, 1, 1, '2026-10-01T00:00:00Z')").run(itemId);
    v10.prepare("INSERT INTO item_batches (id, item_id, number, expiry, created_at) VALUES ('b-plain', ?, '', NULL, '2026-10-01T00:00:00Z'), ('b-n1', ?, 'N1', '2027-03-31', '2026-10-01T00:00:00Z')").run(itemId, itemId);
    const before = v10.prepare('SELECT * FROM item_batches ORDER BY id').all();
    v10.close();

    const db = openDatabase(file, { now: () => new Date(2026, 10, 9, 9, 0, 0) });
    try {
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
      expect(updateCopies(file).map((f) => basename(f))).toEqual(['v10-before-update-v10-20261109-090000.sqlite']);
      expect(db.prepare('SELECT * FROM item_batches ORDER BY id').all()).toEqual(before);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      // the document lines still point at item_batches
      const fk = db.prepare('PRAGMA foreign_key_list(invoice_lines)').all() as { table: string; from: string }[];
      expect(fk.find((f) => f.from === 'batch_id')?.table).toBe('item_batches');
      const add = db.prepare("INSERT INTO item_batches (id, item_id, number, expiry, created_at) VALUES (?, ?, ?, ?, '2026-11-09T00:00:00Z')");
      add.run('b-d1', itemId, '', '2026-12-31');
      add.run('b-d2', itemId, '', '2028-06-30');
      expect(() => add.run('b-d3', itemId, '', '2026-12-31')).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  it('on a server database at version 10: adds the new key and drops the old one in one step, once', () => {
    expect(V11_MYSQL_STEPS.map((s) => s.sql)).toEqual(['ALTER TABLE item_batches ADD UNIQUE KEY item_batches_number_expiry (item_id, number, expiry), DROP INDEX item_batches_number']);
    expect(pendingMysqlSteps(V11_MYSQL_STEPS, { columns: new Set(), foreignKeys: new Set(), indexes: new Set(['item_batches.item_batches_number']) })).toHaveLength(1);
    expect(pendingMysqlSteps(V11_MYSQL_STEPS, { columns: new Set(), foreignKeys: new Set(), indexes: new Set(['item_batches.item_batches_number_expiry']) })).toEqual([]);
    // a fresh server database gets the new key from the start
    expect(MYSQL_TABLES.find((t) => t.name === 'item_batches')!.sql).toContain('UNIQUE KEY item_batches_number_expiry (item_id, number, expiry)');
  });
});

/** A version-10 file opened without migrating further (as the 1.1 builds before version 11 left it). */
function openDatabaseAt10(file: string): Db {
  const db = new DatabaseSync(file) as unknown as Db;
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}
