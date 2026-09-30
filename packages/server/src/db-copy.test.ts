import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { copyCompany, CopyError } from './db-copy.ts';
import { COMPANY_TABLES, isMysql, migrate, openDatabase, type Db } from './db.ts';
import { seedDemo } from './demo-data.ts';
import { reverseEntry } from './journal.ts';
import { MYSQL_TRIGGERS, tableColumns } from './schema-mysql.ts';

// With QASA_TEST_DB set, openDatabase gives a server database: then these copy from the server to a file.
const onServer = !!process.env.QASA_TEST_DB;

function company(): Db {
  const db = openDatabase(':memory:');
  seedDemo(db);
  // a reversal and the entry it reverses point at each other: the copy must not trip over that
  const posted = db.prepare("SELECT id FROM entries WHERE status = 'approved' AND type = 'journal' LIMIT 1").get() as { id: string };
  reverseEntry(db, posted.id, 'Mer Las');
  return db;
}

function emptyFile(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

const rowsOf = (db: Db, table: string) => {
  const { primaryKey } = tableColumns(table);
  return db.prepare(`SELECT * FROM ${table} ORDER BY ${primaryKey.map((c) => `"${c}"`).join(', ')}`).all();
};

describe('copyCompany', () => {
  it('copies every row of every table, and the copy keeps the rules', () => {
    const from = company();
    const to = emptyFile();
    const summary = copyCompany(from, to);

    expect(summary.tables.entries).toBeGreaterThan(5);
    for (const table of COMPANY_TABLES) expect(rowsOf(to, table), table).toEqual(rowsOf(from, table));

    // the triggers and foreign keys are back on
    const triggers = (db: Db) => isMysql(db)
      ? MYSQL_TRIGGERS.map((t) => t.name).sort()
      : (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
    expect(triggers(to)).toEqual(triggers(from));
    expect((to.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(() => to.prepare("UPDATE entries SET description = 'changed' WHERE status = 'approved'").run()).toThrow(/posted_entry_is_permanent/);
    expect(() => to.prepare("DELETE FROM audit_log").run()).toThrow(/audit_log_is_append_only/);
  });

  it('never copies into a database that has a company already', () => {
    const from = company();
    const to = emptyFile();
    copyCompany(from, to);
    expect(() => copyCompany(from, to)).toThrow(CopyError);
    try {
      copyCompany(from, to);
    } catch (error) {
      expect((error as CopyError).code).toBe('target_not_empty');
    }
  });

  it('refuses a target at another schema version', () => {
    const from = company();
    const to = new DatabaseSync(':memory:');
    migrate(to, 3);
    expect(() => copyCompany(from, to)).toThrow('schema_differs');
  });

  // (the bad row is made with an SQLite switch)
  it.skipIf(onServer)('rolls back and puts the rules back when the copy fails', () => {
    const from = company();
    const to = emptyFile();
    // a row the target refuses (an account code the chart rules out) stops the copy half-way
    from.prepare('PRAGMA ignore_check_constraints = ON').run();
    from.prepare("INSERT INTO accounts (code, name_ar, name_en, name_ku, \"system\", created_at) VALUES ('9x', 'a', 'b', 'c', 0, 'now')").run();
    expect(() => copyCompany(from, to)).toThrow();
    for (const table of COMPANY_TABLES) expect(rowsOf(to, table), table).toEqual([]);
    expect((to.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'").get() as { n: number }).n).toBeGreaterThan(10);
    expect((to.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
  });
});
