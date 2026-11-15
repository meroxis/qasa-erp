import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, SCHEMA_VERSION, schemaVersion, type Db, type SqlValue } from './db.ts';
import { MYSQL_TABLES, pendingMysqlSteps, V14_MYSQL_STEPS } from './schema-mysql.ts';
import { AppError } from './errors.ts';

// Version 14: an index on the audit log for the sign-in check's known places (auth.ts, knownPlaces).
const onServer = !!process.env.QASA_TEST_DB;
const KNOWN_PLACES = "SELECT id, details FROM audit_log WHERE entity = 'user' AND entity_id = ? AND action = 'login' AND id < ? AND at >= ? ORDER BY id DESC LIMIT 500";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qasa-v14-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(onServer)('a company file from schema 13 opened by schema 14', () => {
  it('keeps its audit log and reads an account\'s sign-ins through the new index', () => {
    const file = join(dir, 'books.sqlite');
    const old = new DatabaseSync(file);
    migrate(old as unknown as Db, 13);
    old.prepare("INSERT INTO audit_log (at, user, action, entity, entity_id, details) VALUES ('2026-11-01T08:00:00Z', 'Mer', 'login', 'user', 'u1', '{\"source\":\"net:10.0.0.7\"}')").run();
    expect(old.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'audit_log_user_login'").get()).toBeUndefined();
    old.close();
    const db = openDatabase(file);
    try {
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
      expect((db.prepare('PRAGMA index_info(audit_log_user_login)').all() as { name: string }[]).map((c) => c.name)).toEqual(['entity', 'entity_id', 'action', 'id']);
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${KNOWN_PLACES}`).all('u1', Number.MAX_SAFE_INTEGER, '2026-08-01') as { detail: string }[]).map((p) => p.detail).join(' | ');
      expect(plan).toContain('audit_log_user_login');
      expect(plan).not.toMatch(/SCAN audit_log(?! USING)/);
      expect(db.prepare(KNOWN_PLACES).all('u1', Number.MAX_SAFE_INTEGER, '2026-08-01').map((r) => ({ ...r }))).toEqual([{ id: 1, details: '{"source":"net:10.0.0.7"}' }]);
    } finally {
      db.close();
    }
  });

  it('a new company file has the index too', () => {
    const db = openDatabase(join(dir, 'new.sqlite'));
    try {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'audit_log_user_login'").get()).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('is refused by an app of schema 13, which changes nothing', () => {
    const file = join(dir, 'new.sqlite');
    openDatabase(file).close();
    const db = new DatabaseSync(file) as unknown as Db;
    try {
      let error: unknown;
      try { migrate(db, 13); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'database_newer', details: { version: SCHEMA_VERSION, app: 13 } });
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });
});

describe('version 14 on a server database', () => {
  it('a fresh server schema has the same index, by prefixes of the TEXT columns', () => {
    const table = MYSQL_TABLES.find((t) => t.name === 'audit_log')!;
    expect(table.sql).toContain('INDEX audit_log_user_login (entity(32), entity_id(64), action(32), id)');
    expect(V14_MYSQL_STEPS.map((s) => s.sql)).toEqual(['ALTER TABLE audit_log ADD INDEX audit_log_user_login (entity(32), entity_id(64), action(32), id)']);
  });

  it('adds the index once: a second start finds it there and skips it', () => {
    const none = { columns: new Set<string>(), foreignKeys: new Set<string>() };
    expect(pendingMysqlSteps(V14_MYSQL_STEPS, none)).toEqual(V14_MYSQL_STEPS.map((s) => s.sql));
    expect(pendingMysqlSteps(V14_MYSQL_STEPS, { ...none, indexes: new Set(['audit_log.PRIMARY', 'sessions.sessions_user']) })).toEqual(V14_MYSQL_STEPS.map((s) => s.sql));
    expect(pendingMysqlSteps(V14_MYSQL_STEPS, { ...none, indexes: new Set(['audit_log.audit_log_user_login']) })).toEqual([]);
  });

  for (const made of [false, true]) {
    it(`runs on a server at version 13${made ? ' that has the index already (an upgrade cut off half way)' : ''}, then writes the version`, () => {
      let version = 13;
      const existing = new Set(MYSQL_TABLES.filter((t) => !t.since || t.since <= 13).map((t) => t.name));
      const ran: string[] = [];
      const fake: Db = {
        dialect: 'mysql',
        close() {},
        exec(sql: string) { ran.push(sql.trim().split('\n')[0]!.replace(/\s+/g, ' ')); },
        prepare(sql: string) {
          return {
            run: (...p: unknown[]) => { if (/UPDATE schema_version/.test(sql)) version = Number(p[0]); return { changes: 1, lastInsertRowid: 0 }; },
            get: (): Record<string, SqlValue> | undefined => (/schema_version/.test(sql) ? { version } : /VERSION\(\)/.test(sql) ? { v: '11.4.2-MariaDB' } : undefined),
            all: (): Record<string, SqlValue>[] => /information_schema\.tables/.test(sql) ? [...existing].map((name) => ({ name }))
              : /information_schema\.statistics/.test(sql) ? [{ t: 'audit_log', i: 'PRIMARY' }, ...(made ? [{ t: 'audit_log', i: 'audit_log_user_login' }] : [])] : []
          };
        }
      };
      migrate(fake);
      expect(version).toBe(SCHEMA_VERSION);
      expect(ran.filter((s) => s.startsWith('ALTER TABLE audit_log'))).toEqual(made ? [] : V14_MYSQL_STEPS.map((s) => s.sql));
    });
  }
});
