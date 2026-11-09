import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase, SCHEMA_VERSION, schemaVersion, UPDATE_COPIES_KEPT, updateCopies, type Db, type SqlValue } from './db.ts';

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

const errorOf = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
};

describe('books from a newer Qasa ERP', () => {
  // WAL is how this app keeps its files; a copy from elsewhere (a restored backup) may be in rollback mode
  it.each(['wal', 'delete'])('a company file (journal mode %s) is refused, closed and left exactly as it was', (mode) => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-newer-'));
    try {
      const file = join(dir, 'qasa.sqlite');
      const db = openDatabase(file);
      db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION + 1);
      db.exec(`PRAGMA journal_mode = ${mode}`);
      db.close();
      const before = sha256(file);

      expect(errorOf(() => openDatabase(file))).toMatchObject({ status: 409, code: 'database_newer', details: { version: SCHEMA_VERSION + 1, app: SCHEMA_VERSION } });
      expect(sha256(file)).toBe(before);
      // the refused file isn't held open: it can be moved or deleted (Windows locks open files)
      rmSync(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a newer file whose last change is still in its write-ahead log (a crash) keeps file and log as they were', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-newer-wal-'));
    try {
      const file = join(dir, 'qasa.sqlite');
      const crashed = join(dir, 'crashed.sqlite');
      const db = openDatabase(file);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.exec('PRAGMA wal_autocheckpoint = 0');
      db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION + 1);
      // copied while still open, as a crash leaves them: the file says this version, only the log says newer
      copyFileSync(file, crashed);
      copyFileSync(`${file}-wal`, `${crashed}-wal`);
      db.close();
      expect(statSync(`${crashed}-wal`).size).toBeGreaterThan(0);
      const before = [sha256(crashed), sha256(`${crashed}-wal`)];

      expect(errorOf(() => openDatabase(crashed))).toMatchObject({ code: 'database_newer', details: { version: SCHEMA_VERSION + 1 } });
      expect(existsSync(`${crashed}-wal`)).toBe(true);
      expect([sha256(crashed), sha256(`${crashed}-wal`)]).toEqual(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a file of this version with a hot rollback journal (a crash) still opens, rolled back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-hot-'));
    try {
      const file = join(dir, 'qasa.sqlite');
      const crashed = join(dir, 'crashed.sqlite');
      const db = openDatabase(file);
      db.exec('PRAGMA journal_mode = DELETE');
      db.exec('BEGIN IMMEDIATE');
      db.exec('CREATE TABLE unfinished (x)');
      db.exec('INSERT INTO unfinished VALUES (randomblob(100000))');
      // copied mid-transaction, as a crash leaves them: the file plus a hot journal
      copyFileSync(file, crashed);
      copyFileSync(`${file}-journal`, `${crashed}-journal`);
      db.exec('ROLLBACK');
      db.close();

      const reopened = openDatabase(crashed);
      expect(schemaVersion(reopened)).toBe(SCHEMA_VERSION);
      expect(reopened.prepare("SELECT 1 FROM sqlite_master WHERE name = 'unfinished'").get()).toBeUndefined();
      reopened.close();
      expect(existsSync(`${crashed}-journal`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrate refuses them too (on a MariaDB/MySQL server when the suite runs on one)', () => {
    const db = openDatabase(':memory:');
    db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION + 1);
    expect(errorOf(() => migrate(db))).toMatchObject({ code: 'database_newer' });
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION + 1);
    db.close();
  });
});

describe('a server database upgrade cut off half way', () => {
  it('makes only the tables and triggers still missing on the next start, and then records the version', async () => {
    const { MYSQL_TABLES, MYSQL_TRIGGERS } = await import('./schema-mysql.ts');
    const since7 = MYSQL_TABLES.filter((t) => t.since === 7).map((t) => t.name);
    // the server already has every table up to version 6 and the first ten of version 7 (the connection dropped there)
    const existing = new Set([...MYSQL_TABLES.filter((t) => !t.since || t.since < 7).map((t) => t.name), ...since7.slice(0, 10)]);
    const triggers = new Set(MYSQL_TRIGGERS.filter((t) => !t.since || t.since < 7).map((t) => t.name));
    let version = 6;
    const made: string[] = [];
    const fake = {
      dialect: 'mysql' as const,
      close() {},
      exec(sql: string) {
        const table = /^CREATE TABLE (?!IF )(\w+)/.exec(sql.trim())?.[1];
        if (table) {
          if (existing.has(table)) throw new Error(`Table '${table}' already exists`);
          existing.add(table);
          made.push(table);
        }
        const trigger = /CREATE TRIGGER (\w+)/.exec(sql)?.[1];
        if (trigger) {
          if (triggers.has(trigger)) throw new Error(`Trigger '${trigger}' already exists`);
          triggers.add(trigger);
        }
      },
      prepare(sql: string) {
        return {
          run: (...params: unknown[]) => {
            if (/UPDATE schema_version/.test(sql)) version = Number(params[0]);
            return { changes: 1, lastInsertRowid: 0 };
          },
          get: (): Record<string, SqlValue> | undefined => (/schema_version/.test(sql) ? { version } : /VERSION\(\)/.test(sql) ? { v: '10.11.6-MariaDB' } : undefined),
          all: () => /information_schema\.tables/.test(sql) ? [...existing].map((name) => ({ name }))
            : /information_schema\.triggers/.test(sql) ? [...triggers].map((name) => ({ name })) : []
        };
      }
    };
    migrate(fake);
    // the rest of version 7, then every table of the versions after it
    expect(made).toEqual([...since7.slice(10), ...MYSQL_TABLES.filter((t) => (t.since ?? 0) > 7).map((t) => t.name)]);
    expect(version).toBe(SCHEMA_VERSION);
  });
});

describe('a copy before the schema is updated', () => {
  /** A company file left by an older version (one schema version behind), with a voucher still in its write-ahead log. */
  function olderFile(file: string, note: string): void {
    const old = new DatabaseSync(file);
    old.exec('PRAGMA journal_mode = WAL');
    old.exec('PRAGMA wal_autocheckpoint = 0');
    migrate(old as unknown as Db, SCHEMA_VERSION - 1);
    old.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    old.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('company_note', ?)").run(note);
    old.close();
  }
  const at = (h: number) => () => new Date(2026, 10, 9, h, 30, 0);

  it('keeps a consistent copy of the old file beside it, then updates; files already up to date get none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-update-copy-'));
    try {
      const file = join(dir, 'qasa.sqlite');
      olderFile(file, 'Mer books');
      const db = openDatabase(file, { now: at(9) });
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
      db.close();
      const copies = updateCopies(file);
      expect(copies.map((c) => basename(c))).toEqual([`qasa-before-update-v${SCHEMA_VERSION - 1}-20261109-093000.sqlite`]);
      const copy = new DatabaseSync(copies[0]!, { readOnly: true });
      expect((copy.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(SCHEMA_VERSION - 1);
      expect((copy.prepare("SELECT value FROM settings WHERE key = 'company_note'").get() as { value: string }).value).toBe('Mer books');
      copy.close();
      expect(readdirSync(dir).some((n) => n.endsWith('.part'))).toBe(false);

      // up to date: opening again makes no copy; a new company file makes none either
      openDatabase(file, { now: at(10) }).close();
      openDatabase(join(dir, 'new.sqlite'), { now: at(10) }).close();
      expect(readdirSync(dir).filter((n) => n.includes('before-update'))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the newest 3 copies of this company file only, and never touches other files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-update-keep-'));
    try {
      const file = join(dir, 'qasa.sqlite');
      const other = join(dir, 'other-before-update-v1-20200101-000000.sqlite');
      writeFileSync(other, 'another company file copy');
      for (let h = 1; h <= 5; h += 1) {
        rmSync(file, { force: true });
        rmSync(`${file}-wal`, { force: true });
        rmSync(`${file}-shm`, { force: true });
        olderFile(file, `Las books ${h}`);
        openDatabase(file, { now: at(h) }).close();
      }
      expect(UPDATE_COPIES_KEPT).toBe(3);
      expect(updateCopies(file).map((c) => basename(c))).toEqual(
        [5, 4, 3].map((h) => `qasa-before-update-v${SCHEMA_VERSION - 1}-20261109-0${h}3000.sqlite`)
      );
      expect(existsSync(other)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves the file as it was when the copy cannot be made', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-update-fail-'));
    try {
      const file = join(dir, 'qasa.sqlite');
      olderFile(file, 'Raz books');
      // a folder where the copy should go: VACUUM INTO can't write it
      mkdirSync(join(dir, `qasa-before-update-v${SCHEMA_VERSION - 1}-20261109-093000.sqlite.part`));
      const name = `qasa-before-update-v${SCHEMA_VERSION - 1}-20261109-093000.sqlite`;
      expect(existsSync(join(dir, name))).toBe(false);
      // its own error, never taken for a damaged file: the file is fine, only its copy could not be written
      expect(errorOf(() => openDatabase(file, { now: at(9) }))).toMatchObject({ code: 'update_copy_failed', details: { reason: expect.any(String) } });
      const still = new DatabaseSync(file, { readOnly: true });
      expect((still.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(SCHEMA_VERSION - 1);
      still.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
