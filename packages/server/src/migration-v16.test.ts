import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, SCHEMA_VERSION, schemaVersion, type Db, type SqlValue } from './db.ts';
import { MYSQL_TABLES, tableColumns, V16_MYSQL_STEPS, V17_MYSQL_STEPS, V18_MYSQL_STEPS } from './schema-mysql.ts';

// Version 16: petrol stations (fuel.ts): fuels, tanks, pumps and nozzles, shifts and their readings, tanker deliveries,
// dips and each tank's moves. New tables only, on a company file and on a server database alike.
const onServer = !!process.env.QASA_TEST_DB;
const FUEL_TABLES = ['fuel_types', 'fuel_tanks', 'fuel_pumps', 'fuel_nozzles', 'fuel_shifts', 'fuel_readings', 'fuel_deliveries', 'fuel_dips', 'fuel_moves'];

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qasa-v16-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(onServer)('a company file from schema 15 opened by schema 16', () => {
  it('gets the petrol station\'s tables, keeping what it had', () => {
    const file = join(dir, 'books.sqlite');
    const old = new DatabaseSync(file);
    migrate(old as unknown as Db, 15);
    old.prepare(`INSERT INTO entries (id, type, date, description, currency, rate_x100, status, prepared_by, prepared_at, updated_at)
                 VALUES ('e-old', 'journal', '2026-11-01', 'Before 1.6', 'IQD', 100, 'draft', 'Las', '2026-11-01T08:00:00Z', '2026-11-01T08:00:00Z')`).run();
    expect(old.prepare("SELECT name FROM sqlite_master WHERE name = 'fuel_tanks'").get()).toBeUndefined();
    old.close();
    const db = openDatabase(file);
    try {
      expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(16);
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'fuel_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
      expect(tables).toEqual([...FUEL_TABLES].sort());
      expect((db.prepare('PRAGMA table_info(fuel_nozzles)').all() as { name: string }[]).map((c) => c.name))
        .toEqual(['id', 'pump_id', 'number', 'fuel_type_id', 'tank_id', 'meter_milli', 'meter_max_milli', 'active', 'created_at']);
      expect(db.prepare("SELECT description FROM entries WHERE id = 'e-old'").get()).toEqual({ description: 'Before 1.6' });
      // a reading may now be below the opening one (a meter that rolled over), but never below zero
      const readingSql = String((db.prepare("SELECT sql FROM sqlite_master WHERE name = 'fuel_readings'").get() as { sql: string }).sql);
      expect(readingSql).toContain('closing_milli IS NULL OR closing_milli >= 0');
      expect(readingSql).not.toContain('closing_milli >= opening_milli');
    } finally {
      db.close();
    }
  });
});

describe('version 16 on a server database', () => {
  it('has the same tables, made after what they point at, since 16, with nothing added to older tables', () => {
    const names = MYSQL_TABLES.map((t) => t.name);
    for (const table of FUEL_TABLES) {
      const t = MYSQL_TABLES.find((x) => x.name === table);
      expect(t?.since, table).toBe(16);
    }
    expect(names.indexOf('fuel_tanks')).toBeGreaterThan(names.indexOf('fuel_types'));
    expect(names.indexOf('fuel_nozzles')).toBeGreaterThan(names.indexOf('fuel_tanks'));
    expect(names.indexOf('fuel_deliveries')).toBeGreaterThan(names.indexOf('parties'));
    expect(names.indexOf('fuel_readings')).toBeGreaterThan(names.indexOf('fuel_shifts'));
    expect(V16_MYSQL_STEPS).toEqual([]);
    expect(tableColumns('fuel_readings').columns).toEqual(['shift_id', 'nozzle_id', 'fuel_type_id', 'tank_id', 'price', 'opening_milli', 'closing_milli', 'meter_max_milli', 'rollover', 'cost']);
  });

  it('runs on a server at version 15: the fuel tables are made, nothing else, then the version is written', () => {
    let version = 15;
    const existing = new Set(MYSQL_TABLES.filter((t) => !t.since || t.since <= 15).map((t) => t.name));
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
    // (the tables of later versions, 17 on, are made after these: migrate runs every version)
    const later = new Set(MYSQL_TABLES.filter((t) => (t.since ?? 0) > 16).map((t) => t.name));
    const made = ran.filter((s) => s.startsWith('CREATE TABLE ') && !s.includes('schema_version')).map((s) => s.split(' ')[2]).filter((n) => !later.has(n!));
    expect(made.sort()).toEqual([...FUEL_TABLES].sort());
    const laterAlters = [...V17_MYSQL_STEPS, ...V18_MYSQL_STEPS].map((x) => x.sql);
    expect(ran.filter((s) => s.startsWith('ALTER TABLE') && !laterAlters.includes(s))).toEqual([]);
  });
});
