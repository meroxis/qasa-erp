import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase, SCHEMA_VERSION, schemaVersion } from './db.ts';

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
