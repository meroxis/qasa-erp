import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildApp } from './app.ts';
import type { Db } from './db.ts';
import { migrate, openDatabase, SCHEMA_VERSION, schemaVersion, updateCopies } from './db.ts';
import { AppError } from './errors.ts';
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

// Builds made while 2.0 was being reviewed had part of 19 inside their version 18 (review of the last fixes, finding
// 1): a file such a build left at 18 already has those tables or columns. 19 must not stop on them.
const WHOLESALE_TAKEN_BACK = `
  ALTER TABLE ws_handovers ADD COLUMN cancelled_at TEXT;
  ALTER TABLE ws_handovers ADD COLUMN cancel_entry_id TEXT REFERENCES entries(id);
  ALTER TABLE ws_collections ADD COLUMN cancelled_at TEXT;
  ALTER TABLE ws_collections ADD COLUMN cancel_entry_id TEXT REFERENCES entries(id);`;
const TILL_OF_THE_REVIEW = `
  DROP TABLE pos_approvals;
  CREATE TABLE pos_approvals (
    id TEXT PRIMARY KEY,
    shift_id TEXT NOT NULL REFERENCES pos_shifts(id),
    action TEXT NOT NULL CHECK (action IN ('line_delete', 'void', 'price', 'discount', 'no_sale', 'refund', 'credit_over', 'blind_view', 'offline_sale')),
    approver TEXT NOT NULL,
    approver_id TEXT,
    cashier TEXT NOT NULL,
    cashier_id TEXT,
    subject TEXT,
    amount INTEGER,
    scope TEXT,
    detail TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX pos_approvals_shift ON pos_approvals(shift_id);
  CREATE TABLE pos_pin_tries (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, since TEXT NOT NULL, locked_until TEXT, day_on TEXT, day_n INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE pos_shift_refunds (invoice_id TEXT PRIMARY KEY REFERENCES invoices(id), shift_id TEXT NOT NULL REFERENCES pos_shifts(id), created_at TEXT NOT NULL);
  CREATE INDEX pos_shift_refunds_shift ON pos_shift_refunds(shift_id);
  CREATE TABLE item_price_history (id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id), unit TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL, currency TEXT NOT NULL, changed_at TEXT NOT NULL);
  CREATE INDEX item_price_history_item ON item_price_history(item_id, unit, changed_at);
  ALTER TABLE gift_voucher_moves ADD COLUMN for_voucher_id TEXT;`;
/** What each build's version 18 had beyond the first 2.0 build's (432e989), by the commit that built it. */
const SHAPES_AT_18: Record<string, string> = {
  '432e989 (the first 2.0 build)': '',
  'b940de8 (wholesale take-back in 18)': WHOLESALE_TAKEN_BACK,
  '96313cd (the till of the review in 18)': TILL_OF_THE_REVIEW,
  'ef68e57 (both)': TILL_OF_THE_REVIEW + WHOLESALE_TAKEN_BACK
};

/** Tables with their columns (name, type, not null, default, key) and the indexes, by name: order left aside. */
function shapeOf(db: { prepare(sql: string): { all(...a: unknown[]): unknown[] } }): { tables: Record<string, string[]>; indexes: string[]; order: Record<string, string[]> } {
  const tables: Record<string, string[]> = {};
  const order: Record<string, string[]> = {};
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]) {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[];
    tables[t.name] = cols.map((c) => `${c.name} ${c.type} ${c.notnull} ${String(c.dflt_value)} ${c.pk}`).sort();
    order[t.name] = cols.map((c) => c.name);
  }
  const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((x) => x.name);
  return { tables, indexes, order };
}

describe.skipIf(onServer)('version 19 on a file a build of the review left at 18', () => {
  // (worked out when a test first asks: a suite that is skipped on a database server still has its body read)
  let made: ReturnType<typeof shapeOf> | null = null;
  const freshShape = () => (made ??= (() => { const db = openDatabase(':memory:'); try { return shapeOf(db); } finally { db.close(); } })());

  for (const [build, extra] of Object.entries(SHAPES_AT_18)) {
    it(`${build}: reaches 19 with the tables, columns and indexes of a new file, and what it held stays`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'qasa-v19-shape-'));
      const file = join(dir, 'company.sqlite');
      try {
        const raw = new DatabaseSync(file);
        raw.exec('PRAGMA foreign_keys = ON');
        migrate(raw as unknown as Db, 18);
        if (extra) raw.exec(extra);
        // rows such a build may have written: they stay
        if (extra.includes('pos_pin_tries')) raw.exec("INSERT INTO pos_pin_tries (k, n, since, day_n) VALUES ('all', 2, '2026-11-22T08:00:00.000Z', 2)");
        raw.close();

        const db = openDatabase(file);
        try {
          expect(schemaVersion(db)).toBe(19);
          const got = shapeOf(db);
          expect(got.tables).toEqual(freshShape().tables);
          expect(got.indexes).toEqual(freshShape().indexes);
          // version 18's approvals table is as version 18 made it, column for column
          expect(got.order.pos_approvals).toEqual(freshShape().order.pos_approvals);
          if (extra.includes('pos_pin_tries')) expect(Number((db.prepare("SELECT n FROM pos_pin_tries WHERE k = 'all'").get() as { n: number }).n)).toBe(2);
          expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        } finally {
          db.close();
        }
        // one copy from before the update, as after any update
        expect(updateCopies(file)).toHaveLength(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe.skipIf(onServer)('an update that fails', () => {
  /** A file at 18 that 19 can't be applied to (a table of 19 is there as a view, which nothing can add a column to). */
  function stuckAt18(file: string): void {
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA foreign_keys = ON');
    migrate(raw as unknown as Db, 18);
    raw.exec('ALTER TABLE gift_voucher_moves RENAME TO gvm_kept; CREATE VIEW gift_voucher_moves AS SELECT * FROM gvm_kept;');
    raw.close();
  }

  it('says update_failed with the version (never taken for a damaged file), leaves the file as it was, and keeps no copy of a try that changed nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-v19-fail-'));
    const file = join(dir, 'company.sqlite');
    try {
      stuckAt18(file);
      // the copy from before 2.0 (kept by the first update), and two older ones
      const old = ['company-before-update-v16-20261101-080000.sqlite', 'company-before-update-v15-20261001-080000.sqlite', 'company-before-update-v14-20260901-080000.sqlite'];
      for (const n of old) writeFileSync(join(dir, n), 'copy');
      for (let i = 0; i < 5; i += 1) {
        let error: unknown;
        try { openDatabase(file, { now: () => new Date(2026, 10, 22, 9, i, 0) }).close(); } catch (e) { error = e; }
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe('update_failed');
        expect((error as AppError).details).toMatchObject({ version: 19 });
      }
      // five failed starts: the three older copies are all still there, and no copy of version 18 was left behind
      expect(updateCopies(file).map((f) => basename(f))).toEqual(old);
      const raw = new DatabaseSync(file);
      expect(Number((raw.prepare('SELECT version FROM schema_version').get() as { version: number }).version)).toBe(18);
      raw.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the copy when earlier versions of the same try did go through', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-v19-part-'));
    const file = join(dir, 'company.sqlite');
    try {
      const raw = new DatabaseSync(file);
      raw.exec('PRAGMA foreign_keys = ON');
      migrate(raw as unknown as Db, 17);
      // 18 goes through, 19 does not: one of 19's tables is there already as a view
      raw.exec('CREATE VIEW item_price_history AS SELECT 1 AS id');
      raw.close();
      expect(() => openDatabase(file, { now: () => new Date(2026, 10, 22, 9, 0, 0) })).toThrow(/update_failed/);
      // the file is at 18 now, so the copy of it at 17 is kept
      expect(updateCopies(file).map((f) => basename(f))).toEqual(['company-before-update-v17-20261122-090000.sqlite']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
