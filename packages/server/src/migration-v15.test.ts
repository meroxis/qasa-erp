import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, SCHEMA_VERSION, schemaVersion, type Db, type SqlValue } from './db.ts';
import { MYSQL_TABLES, MYSQL_TRIGGERS, pendingMysqlSteps, tableColumns, V15_MYSQL_STEPS } from './schema-mysql.ts';
import { AppError } from './errors.ts';

// tables of the versions after 16 (17 on): made on a server at 14 too, as the newer versions run after this one
const LATER = new Set(MYSQL_TABLES.filter((t) => (t.since ?? 0) > 16).map((t) => t.name));

// Version 15 (1.5): the photo of a paper receipt kept with its voucher (entry_images), and each entry's revision (what an
// approval from the phone is checked against: entry-seen.ts), a company-file upgrade.
const onServer = !!process.env.QASA_TEST_DB;

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qasa-v15-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(onServer)('a company file from schema 14 opened by schema 15', () => {
  it('keeps a copy as it was, then gets the table of receipt photos and its two rules', () => {
    const file = join(dir, 'books.sqlite');
    const old = new DatabaseSync(file);
    migrate(old as unknown as Db, 14);
    old.prepare("INSERT INTO audit_log (at, user, action, entity, entity_id, details) VALUES ('2026-11-01T08:00:00Z', 'Mer', 'login', 'user', 'u1', NULL)").run();
    old.prepare(`INSERT INTO entries (id, type, date, description, currency, rate_x100, status, prepared_by, prepared_at, updated_at)
                 VALUES ('e-old', 'journal', '2026-11-01', 'Before 1.5', 'IQD', 100, 'draft', 'Las', '2026-11-01T08:00:00Z', '2026-11-01T08:00:00Z')`).run();
    expect(old.prepare("SELECT name FROM sqlite_master WHERE name = 'entry_images'").get()).toBeUndefined();
    old.close();
    const db = openDatabase(file);
    try {
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
      expect((db.prepare('PRAGMA table_info(entry_images)').all() as { name: string }[]).map((c) => c.name))
        .toEqual(['entry_id', 'mime', 'data', 'bytes', 'sha256', 'created_by', 'created_at']);
      expect((db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'entry_images' ORDER BY name").all() as { name: string }[]).map((t) => t.name))
        .toEqual(['entry_images_no_delete', 'entry_images_no_update']);
      expect(Number((db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n)).toBeGreaterThan(0);
      // each entry's revision, last in the table; an entry made before it starts at 0
      expect((db.prepare('PRAGMA table_info(entries)').all() as { name: string }[]).map((c) => c.name).at(-1)).toBe('revision');
      expect(db.prepare("SELECT revision FROM entries WHERE id = 'e-old'").get()).toEqual({ revision: 0 });
    } finally {
      db.close();
    }
    // the copy made before the update, beside the file: the books as version 14 left them
    const copies = readdirSync(dir).filter((n) => /^books-before-update-v14-\d{8}-\d{6}\.sqlite$/.test(n));
    expect(copies).toHaveLength(1);
    const copy = new DatabaseSync(join(dir, copies[0]!), { readOnly: true });
    try {
      expect(schemaVersion(copy as unknown as Db)).toBe(14);
      expect(copy.prepare("SELECT name FROM sqlite_master WHERE name = 'entry_images'").get()).toBeUndefined();
    } finally {
      copy.close();
    }
  });

  it('is refused by an app of schema 14, which changes nothing', () => {
    const file = join(dir, 'new.sqlite');
    openDatabase(file).close();
    const db = new DatabaseSync(file) as unknown as Db;
    try {
      let error: unknown;
      try { migrate(db, 14); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'database_newer', details: { version: SCHEMA_VERSION, app: 14 } });
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });
});

describe('version 15 on a server database', () => {
  it('has the table, after the vouchers it points at, and both rules, since 15', () => {
    const names = MYSQL_TABLES.map((t) => t.name);
    const table = MYSQL_TABLES.find((t) => t.name === 'entry_images')!;
    expect(table.since).toBe(15);
    expect(names.indexOf('entry_images')).toBeGreaterThan(names.indexOf('entries'));
    expect(table.sql).toContain('data MEDIUMBLOB NOT NULL');
    expect(table.sql).toContain('FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE');
    const rules = MYSQL_TRIGGERS.filter((t) => t.name.startsWith('entry_images_'));
    expect(rules.map((t) => [t.name, t.since])).toEqual([['entry_images_no_update', 15], ['entry_images_no_delete', 15]]);
    expect(rules[1]!.sql).toContain("(SELECT status FROM entries WHERE id = OLD.entry_id) = 'approved'");
    expect(rules.every((t) => t.sql.includes("MESSAGE_TEXT = 'entry_image_is_permanent'"))).toBe(true);
  });

  it('runs on a server at version 14: the table and its rules are made, then the version is written', () => {
    let version = 14;
    const existing = new Set(MYSQL_TABLES.filter((t) => !t.since || t.since <= 14).map((t) => t.name));
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
    expect(ran.filter((s) => s.startsWith('CREATE TABLE entry_images'))).toHaveLength(1);
    expect(ran.filter((s) => s.startsWith('ALTER TABLE'))).toEqual(['ALTER TABLE entries ADD COLUMN revision INT NOT NULL DEFAULT 0']);
    expect(ran.filter((s) => s.startsWith('CREATE TRIGGER entry_images_'))).toHaveLength(2);
    // nothing else is made again
    expect(ran.filter((s) => s.startsWith('CREATE TABLE ') && !s.startsWith('CREATE TABLE entry_images') && !s.startsWith('CREATE TABLE fuel_') && !LATER.has(s.split(' ')[2]!) && !s.includes('schema_version'))).toEqual([]);
  });

  it('adds the revision once, last in entries as on a company file, and skips it when an upgrade cut off half way made it', () => {
    expect(V15_MYSQL_STEPS.map((x) => x.sql)).toEqual(['ALTER TABLE entries ADD COLUMN revision INT NOT NULL DEFAULT 0']);
    expect(tableColumns('entries').columns.at(-1)).toBe('revision');
    expect(pendingMysqlSteps(V15_MYSQL_STEPS, { columns: new Set(), foreignKeys: new Set() })).toHaveLength(1);
    expect(pendingMysqlSteps(V15_MYSQL_STEPS, { columns: new Set(['entries.revision']), foreignKeys: new Set() })).toEqual([]);
  });
});
