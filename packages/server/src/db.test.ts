import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase, SCHEMA_VERSION, schemaVersion } from './db.ts';

const errorOf = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
};

describe('books from a newer Qasa ERP', () => {
  it('a company file is refused, closed and left exactly as it was', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-newer-'));
    try {
      const file = join(dir, 'qasa.sqlite');
      const db = openDatabase(file);
      db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION + 1);
      db.close();
      const hash = () => createHash('sha256').update(readFileSync(file)).digest('hex');
      const before = hash();

      expect(errorOf(() => openDatabase(file))).toMatchObject({ status: 409, code: 'database_newer', details: { version: SCHEMA_VERSION + 1, app: SCHEMA_VERSION } });
      expect(hash()).toBe(before);
      // the refused file isn't held open: it can be moved or deleted (Windows locks open files)
      rmSync(file);
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
