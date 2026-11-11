import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { IRAQI_UNIFIED_CHART, STARTER_SUB_ACCOUNTS } from '@qasa/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, SCHEMA_VERSION, schemaVersion, updateCopies, type Db, type SqlValue } from './db.ts';
import { buildApp } from './app.ts';
import { MYSQL_TABLES, tableColumns, V12_OWNER_TOOLS_MYSQL_STEPS } from './schema-mysql.ts';
import { AppError } from './errors.ts';

// Version 12, the owner tools' part: a customer's language for WhatsApp messages and the loyalty points ledger.
const onServer = !!process.env.QASA_TEST_DB;
const headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qasa-v12-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A version-11 company file with one customer. */
function version11(file: string): void {
  const db = new DatabaseSync(file);
  migrate(db as unknown as Db, 11);
  const account = db.prepare(`INSERT INTO accounts (code, name_ar, name_en, name_ku, system, created_at) VALUES (?, ?, ?, ?, 0, '2026-10-01T00:00:00Z')`);
  for (const a of [...IRAQI_UNIFIED_CHART, ...STARTER_SUB_ACCOUNTS]) account.run(a.code, a.name.ar, a.name.en, a.name.ku);
  db.prepare(`INSERT INTO parties (id, type, code, name, phone, account_code, active, created_at)
              VALUES ('p1', 'customer', 'C-0100', 'Raz', '0770 000 0001', '1611', 1, '2026-10-01T00:00:00Z')`).run();
  db.close();
}

describe.skipIf(onServer)('a company file from schema 11 opened by schema 12', () => {
  it('keeps its customers, who get messages in the app\'s language until one is chosen', async () => {
    const file = join(dir, 'books.sqlite');
    version11(file);
    const db = openDatabase(file, { now: () => new Date(2026, 10, 11, 9, 0, 0) });
    try {
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
      expect(updateCopies(file).map((f) => basename(f))).toEqual(['books-before-update-v11-20261111-090000.sqlite']);
      expect(db.prepare('SELECT name, lang FROM parties').all()).toEqual([{ name: 'Raz', lang: null }]);
      // the loyalty ledger is there, empty, and append-only
      expect(db.prepare('SELECT COUNT(*) AS n FROM loyalty_moves').get()).toEqual({ n: 0 });
      expect((db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'loyalty_moves_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name))
        .toEqual(['loyalty_moves_no_delete', 'loyalty_moves_no_update']);
      const app = buildApp(db);
      expect((await app.inject({ url: '/api/parties/p1', headers })).json()).toMatchObject({ name: 'Raz', lang: null });
      const put = (lang: unknown) => app.inject({ method: 'PUT', url: '/api/parties/p1', headers, payload: { name: 'Raz', phone: '0770 000 0001', lang } as object });
      expect((await put('ku')).json()).toMatchObject({ lang: 'ku' });
      // a change that leaves the language out keeps it; null goes back to the app's language
      expect((await app.inject({ method: 'PUT', url: '/api/parties/p1', headers, payload: { name: 'Raz Ali' } })).json()).toMatchObject({ name: 'Raz Ali', lang: 'ku' });
      expect((await put('fr')).statusCode).toBe(400);
      expect((await put("ku'); DROP TABLE parties; --")).statusCode).toBe(400);
      expect((await put(null)).json()).toMatchObject({ lang: null });
      // a new customer may come with one; the database refuses anything else
      const made = await app.inject({ method: 'POST', url: '/api/parties', headers, payload: { type: 'customer', name: 'Las', lang: 'ar' } });
      expect(made.json()).toMatchObject({ name: 'Las', lang: 'ar' });
      expect(() => db.prepare("UPDATE parties SET lang = 'xx' WHERE id = 'p1'").run()).toThrow();
      await app.close();
    } finally {
      db.close();
    }
  });

  it('is refused by an app of schema 11, which changes nothing', () => {
    const file = join(dir, 'new.sqlite');
    openDatabase(file).close();
    const db = new DatabaseSync(file) as unknown as Db;
    try {
      let error: unknown;
      try { migrate(db, 11); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'database_newer', details: { version: SCHEMA_VERSION, app: 11 } });
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });
});

describe('version 12 (owner tools) on a server database', () => {
  it('adds the customer language last in parties, as the fresh server schema has it', () => {
    const added = V12_OWNER_TOOLS_MYSQL_STEPS.filter((s) => s.kind === 'column' && s.table === 'parties').map((s) => (s as { column: string }).column);
    expect(added).toEqual(['lang']);
    expect(tableColumns('parties').columns.slice(-1)).toEqual(['lang']);
  });

  it('runs its steps once on a server at version 11, then writes the version', () => {
    let version = 11;
    const existing = new Set(MYSQL_TABLES.filter((t) => !t.since || t.since <= 11).map((t) => t.name));
    const ran: string[] = [];
    const fake: Db = {
      dialect: 'mysql',
      close() {},
      exec(sql: string) { ran.push(sql.trim().split('\n')[0]!.replace(/\s+/g, ' ')); },
      prepare(sql: string) {
        return {
          run: (...p: unknown[]) => { if (/UPDATE schema_version/.test(sql)) version = Number(p[0]); return { changes: 1, lastInsertRowid: 0 }; },
          get: (): Record<string, SqlValue> | undefined => (/schema_version/.test(sql) ? { version } : /VERSION\(\)/.test(sql) ? { v: '11.4.2-MariaDB' } : undefined),
          all: (): Record<string, SqlValue>[] => (/information_schema\.tables/.test(sql) ? [...existing].map((name) => ({ name })) : [])
        };
      }
    };
    migrate(fake);
    expect(version).toBe(SCHEMA_VERSION);
    for (const step of V12_OWNER_TOOLS_MYSQL_STEPS) expect(ran.filter((s) => s === step.sql)).toHaveLength(1);
    expect(ran).toContain('CREATE TABLE loyalty_moves (');
    expect(ran.filter((s) => /^CREATE TRIGGER loyalty_moves_no_(update|delete) /.test(s))).toHaveLength(2);
  });
});
