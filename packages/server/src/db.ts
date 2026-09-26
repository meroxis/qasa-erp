import { DatabaseSync } from 'node:sqlite';
import { IRAQI_UNIFIED_CHART, STARTER_SUB_ACCOUNTS } from '@qasa/core';

export type Db = DatabaseSync;

const MIGRATIONS: string[] = [
  // 1 — accounting core
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE accounts (
    code TEXT PRIMARY KEY CHECK (code GLOB '[1-4]*' AND code NOT GLOB '*[^0-9]*'),
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_ku TEXT NOT NULL,
    system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE entries (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('journal', 'receipt', 'payment', 'reversal')),
    number TEXT UNIQUE,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    party TEXT,
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    rate_x100 INTEGER NOT NULL CHECK (rate_x100 > 0),
    status TEXT NOT NULL CHECK (status IN ('draft', 'checked', 'approved')),
    cash_account TEXT REFERENCES accounts(code),
    reverses_id TEXT REFERENCES entries(id),
    reversed_by_id TEXT REFERENCES entries(id),
    prepared_by TEXT NOT NULL,
    prepared_at TEXT NOT NULL,
    checked_by TEXT,
    checked_at TEXT,
    approved_by TEXT,
    approved_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX entries_date ON entries(date);
  CREATE INDEX entries_status ON entries(status);

  CREATE TABLE entry_lines (
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,
    account_code TEXT NOT NULL REFERENCES accounts(code),
    debit INTEGER NOT NULL CHECK (debit >= 0),
    credit INTEGER NOT NULL CHECK (credit >= 0),
    base_debit INTEGER NOT NULL CHECK (base_debit >= 0),
    base_credit INTEGER NOT NULL CHECK (base_credit >= 0),
    description TEXT,
    PRIMARY KEY (entry_id, line_no)
  );
  CREATE INDEX entry_lines_account ON entry_lines(account_code);

  CREATE TABLE sequences (
    key TEXT PRIMARY KEY,
    next INTEGER NOT NULL
  );

  CREATE TABLE locked_periods (
    period TEXT PRIMARY KEY,
    locked_by TEXT NOT NULL,
    locked_at TEXT NOT NULL
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    details TEXT
  );

  -- Posted (approved) entries are permanent: they can only be corrected by a reversal entry.
  CREATE TRIGGER posted_lines_no_insert BEFORE INSERT ON entry_lines
  WHEN (SELECT status FROM entries WHERE id = NEW.entry_id) = 'approved'
  BEGIN SELECT RAISE(ABORT, 'posted_entry_is_permanent'); END;

  CREATE TRIGGER posted_lines_no_update BEFORE UPDATE ON entry_lines
  WHEN (SELECT status FROM entries WHERE id = OLD.entry_id) = 'approved'
  BEGIN SELECT RAISE(ABORT, 'posted_entry_is_permanent'); END;

  CREATE TRIGGER posted_lines_no_delete BEFORE DELETE ON entry_lines
  WHEN (SELECT status FROM entries WHERE id = OLD.entry_id) = 'approved'
  BEGIN SELECT RAISE(ABORT, 'posted_entry_is_permanent'); END;

  CREATE TRIGGER posted_entries_no_delete BEFORE DELETE ON entries
  WHEN OLD.status = 'approved'
  BEGIN SELECT RAISE(ABORT, 'posted_entry_is_permanent'); END;

  CREATE TRIGGER posted_entries_no_edit BEFORE UPDATE ON entries
  WHEN OLD.status = 'approved' AND (
    NEW.status IS NOT OLD.status OR NEW.type IS NOT OLD.type OR NEW.number IS NOT OLD.number OR
    NEW.date IS NOT OLD.date OR NEW.description IS NOT OLD.description OR NEW.party IS NOT OLD.party OR
    NEW.currency IS NOT OLD.currency OR NEW.rate_x100 IS NOT OLD.rate_x100 OR NEW.cash_account IS NOT OLD.cash_account OR
    NEW.approved_by IS NOT OLD.approved_by OR NEW.approved_at IS NOT OLD.approved_at
  )
  BEGIN SELECT RAISE(ABORT, 'posted_entry_is_permanent'); END;

  -- The audit log is append-only.
  CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log_is_append_only'); END;
  CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log_is_append_only'); END;
  `
];

export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') {
    // WAL + FULL sync: a committed voucher survives a power cut (generator switch-over).
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
  }
  migrate(db);
  seedChartIfEmpty(db);
  return db;
}

function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version]!;
    transaction(db, () => {
      db.exec(sql);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
    });
    version += 1;
  }
}

function seedChartIfEmpty(db: Db): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n;
  if (count > 0) return;
  const now = new Date().toISOString();
  const insert = db.prepare('INSERT INTO accounts (code, name_ar, name_en, name_ku, system, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  transaction(db, () => {
    for (const a of IRAQI_UNIFIED_CHART) insert.run(a.code, a.name.ar, a.name.en, a.name.ku, 1, now);
    for (const a of STARTER_SUB_ACCOUNTS) insert.run(a.code, a.name.ar, a.name.en, a.name.ku, 0, now);
    const setting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    setting.run('company_name', JSON.stringify({ ar: '', en: '', ku: '' }));
    setting.run('default_rate_x100', '142000');
    setting.run('fiscal_year_start', '01-01');
  });
}

let depth = 0;

/** Runs `fn` in a transaction. Nested calls join the outer transaction. */
export function transaction<T>(db: Db, fn: () => T): T {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth += 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    depth -= 1;
  }
}
