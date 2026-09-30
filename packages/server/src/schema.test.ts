import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPANY_TABLES, initDatabase, type Db } from './db.ts';
import { MYSQL_TABLES, MYSQL_TRIGGERS, mysqlCollations, mysqlTableSql } from './schema-mysql.ts';

/** A server table's columns as written: name, NOT NULL, and whether it is (part of) the primary key. */
function serverColumns(sql: string): { name: string; notnull: boolean; pk: boolean }[] {
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
  const lines = body.split('\n').map((l) => l.trim().replace(/,$/, '')).filter(Boolean);
  const primary = lines.find((l) => l.startsWith('PRIMARY KEY ('));
  const pkColumns = primary ? primary.slice(primary.indexOf('(') + 1, primary.indexOf(')')).split(',').map((c) => c.trim()) : [];
  return lines
    .filter((l) => !/^(CHECK|INDEX|UNIQUE KEY|PRIMARY KEY|FOREIGN KEY)\b/.test(l))
    .map((l) => {
      const name = /^"?(\w+)"?/.exec(l)![1]!;
      return { name, notnull: /NOT NULL/.test(l), pk: /PRIMARY KEY/.test(l) || pkColumns.includes(name) };
    });
}

function serverForeignKeys(sql: string): string[] {
  return [...sql.matchAll(/FOREIGN KEY \((\w+)\) REFERENCES (\w+)\((\w+)\)( ON DELETE CASCADE)?/g)]
    .map((m) => `${m[1]}->${m[2]}.${m[3]}${m[4] ? ' cascade' : ''}`)
    .sort();
}

describe('the MariaDB/MySQL schema matches the SQLite one', () => {
  // always SQLite, also when the suite runs on a database server (pro/src/mysql/server.test.ts checks the server side)
  const db: Db = new DatabaseSync(':memory:');
  initDatabase(db);
  const sqliteTables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('schema_version', 'sqlite_sequence')").all() as { name: string }[])
    .map((t) => t.name);

  it('has the same tables', () => {
    expect([...COMPANY_TABLES].sort()).toEqual([...sqliteTables].sort());
  });

  for (const table of MYSQL_TABLES) {
    it(`${table.name}: same columns in the same order, NOT NULL and primary key alike`, () => {
      const sqlite = (db.prepare(`PRAGMA table_info(${table.name})`).all() as { name: string; notnull: number; pk: number }[])
        .map((c) => ({ name: c.name, notnull: c.notnull === 1 || c.pk > 0, pk: c.pk > 0 }));
      const server = serverColumns(table.sql).map((c) => ({ ...c, notnull: c.notnull || c.pk }));
      expect(server).toEqual(sqlite);
    });

    it(`${table.name}: same foreign keys`, () => {
      const sqlite = (db.prepare(`PRAGMA foreign_key_list(${table.name})`).all() as { from: string; table: string; to: string; on_delete: string }[])
        .map((f) => `${f.from}->${f.table}.${f.to}${f.on_delete === 'CASCADE' ? ' cascade' : ''}`)
        .sort();
      expect(serverForeignKeys(table.sql)).toEqual(sqlite);
    });
  }

  it('has the same triggers', () => {
    const sqlite = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[]).map((t) => t.name).sort();
    expect(MYSQL_TRIGGERS.map((t) => t.name).sort()).toEqual(sqlite);
  });

  it('writes each table with the server\'s own no-pad collations', () => {
    const maria = mysqlTableSql(MYSQL_TABLES.find((t) => t.name === 'users')!.sql, mysqlCollations('11.4.5-MariaDB'));
    expect(maria).toContain('COLLATE utf8mb4_general_nopad_ci');
    expect(maria).toMatch(/COLLATE=utf8mb4_nopad_bin$/);
    const mysql = mysqlTableSql(MYSQL_TABLES[0]!.sql, mysqlCollations('8.4.3'));
    expect(mysql).toMatch(/COLLATE=utf8mb4_0900_bin$/);
  });
});

describe('the server SQL means the same on SQLite and on a MariaDB/MySQL server', () => {
  // db.ts holds the SQLite migrations, which only ever run on SQLite; everything else runs on both
  const dir = import.meta.dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.includes('.test.') && f !== 'db.ts' && f !== 'schema-mysql.ts');
  const statements = files.flatMap((f) => {
    const source = readFileSync(join(dir, f), 'utf8');
    return [...source.matchAll(/\.(?:prepare|exec)\(\s*(['"`])([\s\S]*?)\1/g)].map((m) => ({ where: f, sql: m[2]! }));
  });

  it('finds the statements', () => {
    expect(statements.length).toBeGreaterThan(100);
  });

  const rules: [string, RegExp, string[]?][] = [
    ['INSERT OR IGNORE / OR REPLACE (use insertOrKeep)', /\bOR\s+(IGNORE|REPLACE)\b/i],
    ['ON CONFLICT (SQLite only)', /\bON\s+CONFLICT\b/i],
    ['numbered parameters like ?1', /\?\d/],
    ['IS / IS NOT with a parameter', /\bIS\s+(NOT\s+)?\?/i],
    ['GLOB', /\bGLOB\b/i],
    ['SQLite date functions', /\b(strftime|julianday|datetime)\s*\(/i],
    ['a bare reserved column name (write "key", "system")', /(?<!")\b(key|system)\b(?!")/],
    ['two-argument MAX/MIN (use CASE)', /\b(MAX|MIN)\s*\([^()]*,[^()]*\)/i],
    // db-copy.ts switches SQLite's foreign keys in its SQLite branch only
    ['PRAGMA', /\bPRAGMA\b/i, ['db-copy.ts']],
    ['RETURNING', /\bRETURNING\b/i]
  ];
  for (const [label, pattern, allowed = []] of rules) {
    it(`uses no ${label}`, () => {
      expect(statements.filter((s) => pattern.test(s.sql) && !allowed.includes(s.where)).map((s) => `${s.where}: ${s.sql.slice(0, 120)}`)).toEqual([]);
    });
  }
});
