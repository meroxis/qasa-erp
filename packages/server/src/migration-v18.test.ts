import { describe, expect, it } from 'vitest';
import type { Db, SqlValue } from './db.ts';
import { migrate, openDatabase, SCHEMA_VERSION } from './db.ts';
import { MYSQL_TABLES, tableColumns, V18_MYSQL_STEPS, V19_MYSQL_STEPS, V21_MYSQL_STEPS } from './schema-mysql.ts';

// Version 18 (2.0, the till's rules): supervisors' PINs and approvals, gift vouchers, the customer screen's pictures and
// pairing codes, and the dinar rounding of a till sale's cash.
const V18_TABLES = ['pos_pins', 'pos_approvals', 'gift_vouchers', 'gift_voucher_moves', 'pos_display_images', 'pos_display_codes'];

// what a company file (SQLite) has, read with its own PRAGMA: not a test for a run on a database server, whose
// upgrade is tested in pro/src/mysql/server.test.ts (as migration-v17.test.ts does)
const onServer = !!process.env.QASA_TEST_DB;

describe.skipIf(onServer)('version 18', () => {
  it('makes its tables empty, and a till sale made before it has no rounding', () => {
    const db = openDatabase(':memory:');
    try {
      for (const t of V18_TABLES) expect(Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n), t).toBe(0);
      const cols = (db.prepare('PRAGMA table_info(pos_sales)').all() as { name: string; dflt_value: string | null }[]);
      expect(cols.find((c) => c.name === 'rounding')?.dflt_value).toBe('0');
    } finally {
      db.close();
    }
  });

  it('has the same tables and columns in the server schema', () => {
    const db = openDatabase(':memory:');
    try {
      for (const name of V18_TABLES) {
        const t = MYSQL_TABLES.find((x) => x.name === name);
        expect(t?.since, name).toBe(18);
        const sqlite = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name).sort();
        expect([...tableColumns(name).columns].sort(), name).toEqual(sqlite);
      }
    } finally {
      db.close();
    }
  });

  it('runs on a server at version 17: its tables and the rounding column, nothing else, then the version is written', () => {
    let version = 17;
    const existing = new Set(MYSQL_TABLES.filter((t) => !t.since || t.since <= 17).map((t) => t.name));
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
    } as unknown as Db;
    migrate(fake);
    expect(version).toBe(SCHEMA_VERSION);
    const made = ran.filter((s) => s.startsWith('CREATE TABLE ') && !s.includes('schema_version')).map((s) => s.split(' ')[2]);
    expect(made.sort()).toEqual(MYSQL_TABLES.filter((t) => (t.since ?? 0) >= 18).map((t) => t.name).sort());
    for (const t of V18_TABLES) expect(made).toContain(t);
    expect(ran.filter((s) => s.startsWith('ALTER TABLE'))).toEqual([...V18_MYSQL_STEPS, ...V19_MYSQL_STEPS, ...V21_MYSQL_STEPS].map((x) => x.sql));
  });
});
