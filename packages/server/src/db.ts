import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_POSTING_ACCOUNTS, IRAQI_UNIFIED_CHART, STARTER_SUB_ACCOUNTS } from '@qasa/core';

export type Db = DatabaseSync;

interface Migration {
  sql: string;
  /** Rebuilds an existing table: runs with foreign keys off, then checks them. */
  rebuild?: boolean;
}

const V1 =
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
  `;

const V2 =
  // 2 — customers & suppliers, items, warehouses, stock, invoices
  `
  -- entries: allow invoice postings ('sale', 'purchase')
  CREATE TABLE entries_v2 (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('journal', 'receipt', 'payment', 'reversal', 'sale', 'purchase')),
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
  INSERT INTO entries_v2 SELECT id, type, number, date, description, party, currency, rate_x100, status, cash_account,
    reverses_id, reversed_by_id, prepared_by, prepared_at, checked_by, checked_at, approved_by, approved_at, updated_at FROM entries;
  DROP TABLE entries;
  ALTER TABLE entries_v2 RENAME TO entries;
  CREATE INDEX entries_date ON entries(date);
  CREATE INDEX entries_status ON entries(status);

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

  -- customers (الزبائن) and suppliers (المجهزون)
  CREATE TABLE parties (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('customer', 'supplier')),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    account_code TEXT NOT NULL REFERENCES accounts(code),
    credit_limit INTEGER CHECK (credit_limit IS NULL OR credit_limit >= 0),
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  ALTER TABLE entry_lines ADD COLUMN party_id TEXT REFERENCES parties(id);
  CREATE INDEX entry_lines_party ON entry_lines(party_id);

  CREATE TABLE warehouses (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_ku TEXT NOT NULL,
    account_code TEXT NOT NULL REFERENCES accounts(code),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    barcode TEXT,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_ku TEXT NOT NULL,
    unit TEXT NOT NULL,
    sale_price INTEGER NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
    sale_currency TEXT NOT NULL CHECK (sale_currency IN ('IQD', 'USD')),
    track_stock INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX items_barcode ON items(barcode) WHERE barcode IS NOT NULL AND barcode <> '';

  CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('sale', 'purchase')),
    status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
    number TEXT UNIQUE,
    date TEXT NOT NULL,
    party_id TEXT REFERENCES parties(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    rate_x100 INTEGER NOT NULL CHECK (rate_x100 > 0),
    payment TEXT NOT NULL CHECK (payment IN ('cash', 'credit')),
    cash_account TEXT REFERENCES accounts(code),
    discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
    subtotal INTEGER NOT NULL,
    total INTEGER NOT NULL,
    notes TEXT,
    entry_id TEXT REFERENCES entries(id),
    cancel_entry_id TEXT REFERENCES entries(id),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    posted_by TEXT,
    posted_at TEXT,
    cancelled_by TEXT,
    cancelled_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX invoices_date ON invoices(date);

  CREATE TABLE invoice_lines (
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,
    item_id TEXT NOT NULL REFERENCES items(id),
    description TEXT,
    qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
    amount INTEGER NOT NULL,
    cost INTEGER,
    PRIMARY KEY (invoice_id, line_no)
  );

  -- every stock change, in quantity and IQD value; never edited or deleted
  CREATE TABLE stock_moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL REFERENCES items(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    date TEXT NOT NULL,
    qty_milli INTEGER NOT NULL,
    value INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX stock_moves_item ON stock_moves(item_id, warehouse_id);
  CREATE TRIGGER stock_moves_no_update BEFORE UPDATE ON stock_moves BEGIN SELECT RAISE(ABORT, 'stock_moves_are_permanent'); END;
  CREATE TRIGGER stock_moves_no_delete BEFORE DELETE ON stock_moves BEGIN SELECT RAISE(ABORT, 'stock_moves_are_permanent'); END;

  -- posted invoices are permanent; they can only be cancelled (which reverses their entry and stock)
  CREATE TRIGGER posted_invoice_lines_no_insert BEFORE INSERT ON invoice_lines
  WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) <> 'draft'
  BEGIN SELECT RAISE(ABORT, 'posted_invoice_is_permanent'); END;
  CREATE TRIGGER posted_invoice_lines_no_update BEFORE UPDATE ON invoice_lines
  WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'draft'
  BEGIN SELECT RAISE(ABORT, 'posted_invoice_is_permanent'); END;
  CREATE TRIGGER posted_invoice_lines_no_delete BEFORE DELETE ON invoice_lines
  WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'draft'
  BEGIN SELECT RAISE(ABORT, 'posted_invoice_is_permanent'); END;
  CREATE TRIGGER posted_invoices_no_delete BEFORE DELETE ON invoices
  WHEN OLD.status <> 'draft'
  BEGIN SELECT RAISE(ABORT, 'posted_invoice_is_permanent'); END;
  CREATE TRIGGER posted_invoices_no_edit BEFORE UPDATE ON invoices
  WHEN OLD.status = 'cancelled' OR (OLD.status = 'posted' AND (
    NEW.number IS NOT OLD.number OR NEW.date IS NOT OLD.date OR NEW.party_id IS NOT OLD.party_id OR
    NEW.warehouse_id IS NOT OLD.warehouse_id OR NEW.currency IS NOT OLD.currency OR NEW.rate_x100 IS NOT OLD.rate_x100 OR
    NEW.payment IS NOT OLD.payment OR NEW.cash_account IS NOT OLD.cash_account OR NEW.discount IS NOT OLD.discount OR
    NEW.subtotal IS NOT OLD.subtotal OR NEW.total IS NOT OLD.total OR NEW.entry_id IS NOT OLD.entry_id OR
    NEW.status NOT IN ('posted', 'cancelled')
  ))
  BEGIN SELECT RAISE(ABORT, 'posted_invoice_is_permanent'); END;
  `;

const V3 =
  // 3 — sales and purchase returns, opening stock, transfers between warehouses
  `
  -- entries: allow the postings of returns and stock documents
  CREATE TABLE entries_v3 (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('journal', 'receipt', 'payment', 'reversal', 'sale', 'purchase', 'sale_return', 'purchase_return', 'opening_stock', 'transfer')),
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
  INSERT INTO entries_v3 SELECT id, type, number, date, description, party, currency, rate_x100, status, cash_account,
    reverses_id, reversed_by_id, prepared_by, prepared_at, checked_by, checked_at, approved_by, approved_at, updated_at FROM entries;
  DROP TABLE entries;
  ALTER TABLE entries_v3 RENAME TO entries;
  CREATE INDEX entries_date ON entries(date);
  CREATE INDEX entries_status ON entries(status);

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

  -- invoices: returns (مردودات), each tied to the invoice it returns goods from
  CREATE TABLE invoices_v3 (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('sale', 'purchase', 'sale_return', 'purchase_return')),
    status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
    number TEXT UNIQUE,
    date TEXT NOT NULL,
    party_id TEXT REFERENCES parties(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    rate_x100 INTEGER NOT NULL CHECK (rate_x100 > 0),
    payment TEXT NOT NULL CHECK (payment IN ('cash', 'credit')),
    cash_account TEXT REFERENCES accounts(code),
    discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
    subtotal INTEGER NOT NULL,
    total INTEGER NOT NULL,
    notes TEXT,
    return_of TEXT REFERENCES invoices(id),
    entry_id TEXT REFERENCES entries(id),
    cancel_entry_id TEXT REFERENCES entries(id),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    posted_by TEXT,
    posted_at TEXT,
    cancelled_by TEXT,
    cancelled_at TEXT,
    updated_at TEXT NOT NULL,
    CHECK ((kind IN ('sale_return', 'purchase_return')) = (return_of IS NOT NULL))
  );
  INSERT INTO invoices_v3 SELECT id, kind, status, number, date, party_id, warehouse_id, currency, rate_x100, payment, cash_account,
    discount, subtotal, total, notes, NULL, entry_id, cancel_entry_id, created_by, created_at, posted_by, posted_at, cancelled_by, cancelled_at, updated_at FROM invoices;
  DROP TABLE invoices;
  ALTER TABLE invoices_v3 RENAME TO invoices;
  CREATE INDEX invoices_date ON invoices(date);
  CREATE INDEX invoices_return_of ON invoices(return_of);

  CREATE TRIGGER posted_invoices_no_delete BEFORE DELETE ON invoices
  WHEN OLD.status <> 'draft'
  BEGIN SELECT RAISE(ABORT, 'posted_invoice_is_permanent'); END;
  CREATE TRIGGER posted_invoices_no_edit BEFORE UPDATE ON invoices
  WHEN OLD.status = 'cancelled' OR (OLD.status = 'posted' AND (
    NEW.number IS NOT OLD.number OR NEW.date IS NOT OLD.date OR NEW.party_id IS NOT OLD.party_id OR
    NEW.warehouse_id IS NOT OLD.warehouse_id OR NEW.currency IS NOT OLD.currency OR NEW.rate_x100 IS NOT OLD.rate_x100 OR
    NEW.payment IS NOT OLD.payment OR NEW.cash_account IS NOT OLD.cash_account OR NEW.discount IS NOT OLD.discount OR
    NEW.subtotal IS NOT OLD.subtotal OR NEW.total IS NOT OLD.total OR NEW.entry_id IS NOT OLD.entry_id OR
    NEW.return_of IS NOT OLD.return_of OR NEW.status NOT IN ('posted', 'cancelled')
  ))
  BEGIN SELECT RAISE(ABORT, 'posted_invoice_is_permanent'); END;

  -- the line of the original invoice that a return line gives back
  ALTER TABLE invoice_lines ADD COLUMN source_line INTEGER;
  -- a return line's part of the original invoice's discount, so partial returns add up exactly
  ALTER TABLE invoice_lines ADD COLUMN discount_share INTEGER;

  -- stock documents: opening stock (بضاعة أول المدة) and transfers between warehouses (مناقلة)
  CREATE TABLE stock_docs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('opening', 'transfer')),
    status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
    number TEXT UNIQUE,
    date TEXT NOT NULL,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    to_warehouse_id TEXT REFERENCES warehouses(id),
    counter_account TEXT REFERENCES accounts(code),
    notes TEXT,
    total_value INTEGER NOT NULL DEFAULT 0,
    entry_id TEXT REFERENCES entries(id),
    cancel_entry_id TEXT REFERENCES entries(id),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    posted_by TEXT,
    posted_at TEXT,
    cancelled_by TEXT,
    cancelled_at TEXT,
    updated_at TEXT NOT NULL,
    CHECK (kind <> 'transfer' OR (to_warehouse_id IS NOT NULL AND to_warehouse_id <> warehouse_id))
  );
  CREATE INDEX stock_docs_date ON stock_docs(date);

  CREATE TABLE stock_doc_lines (
    doc_id TEXT NOT NULL REFERENCES stock_docs(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,
    item_id TEXT NOT NULL REFERENCES items(id),
    qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
    -- opening stock: IQD per unit, as entered
    unit_cost INTEGER CHECK (unit_cost IS NULL OR unit_cost >= 0),
    -- IQD value that moved, set when posted
    value INTEGER,
    PRIMARY KEY (doc_id, line_no)
  );

  CREATE TRIGGER posted_stock_doc_lines_no_insert BEFORE INSERT ON stock_doc_lines
  WHEN (SELECT status FROM stock_docs WHERE id = NEW.doc_id) <> 'draft'
  BEGIN SELECT RAISE(ABORT, 'posted_document_is_permanent'); END;
  CREATE TRIGGER posted_stock_doc_lines_no_update BEFORE UPDATE ON stock_doc_lines
  WHEN (SELECT status FROM stock_docs WHERE id = OLD.doc_id) <> 'draft' AND (
    NEW.item_id IS NOT OLD.item_id OR NEW.qty_milli IS NOT OLD.qty_milli OR NEW.unit_cost IS NOT OLD.unit_cost OR
    (OLD.value IS NOT NULL AND NEW.value IS NOT OLD.value)
  )
  BEGIN SELECT RAISE(ABORT, 'posted_document_is_permanent'); END;
  CREATE TRIGGER posted_stock_doc_lines_no_delete BEFORE DELETE ON stock_doc_lines
  WHEN (SELECT status FROM stock_docs WHERE id = OLD.doc_id) <> 'draft'
  BEGIN SELECT RAISE(ABORT, 'posted_document_is_permanent'); END;
  CREATE TRIGGER posted_stock_docs_no_delete BEFORE DELETE ON stock_docs
  WHEN OLD.status <> 'draft'
  BEGIN SELECT RAISE(ABORT, 'posted_document_is_permanent'); END;
  CREATE TRIGGER posted_stock_docs_no_edit BEFORE UPDATE ON stock_docs
  WHEN OLD.status = 'cancelled' OR (OLD.status = 'posted' AND (
    NEW.number IS NOT OLD.number OR NEW.date IS NOT OLD.date OR NEW.warehouse_id IS NOT OLD.warehouse_id OR
    NEW.to_warehouse_id IS NOT OLD.to_warehouse_id OR NEW.counter_account IS NOT OLD.counter_account OR
    NEW.total_value IS NOT OLD.total_value OR NEW.entry_id IS NOT OLD.entry_id OR NEW.status NOT IN ('posted', 'cancelled')
  ))
  BEGIN SELECT RAISE(ABORT, 'posted_document_is_permanent'); END;
  `;

const V4 =
  // 4 — users, sign-in and roles
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    -- the name printed on vouchers ("prepared by")
    name TEXT NOT NULL,
    -- scrypt hash; NULL until a password is set (then the user cannot sign in)
    password_hash TEXT,
    -- JSON array of roles
    roles TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  -- only a hash of each session token is kept; the token itself lives in the signed-in browser's cookie
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    device TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  -- who prepared and who checked a voucher, for "separate duties"
  ALTER TABLE entries ADD COLUMN prepared_by_id TEXT REFERENCES users(id);
  ALTER TABLE entries ADD COLUMN checked_by_id TEXT REFERENCES users(id);
  `;

const MIGRATIONS: Migration[] = [{ sql: V1 }, { sql: V2, rebuild: true }, { sql: V3, rebuild: true }, { sql: V4 }];

/** The schema version this build writes. */
export const SCHEMA_VERSION = MIGRATIONS.length;

export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') {
    // WAL + FULL sync: a committed voucher survives a power cut (generator switch-over).
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
  }
  initDatabase(db);
  return db;
}

/** Brings any database (a file, or the in-browser demo) to the current schema and fills in the defaults. */
export function initDatabase(db: Db): void {
  migrate(db);
  ensureDefaults(db);
}

export function schemaVersion(db: Db): number {
  return (db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined)?.version ?? 0;
}

/** Applies pending migrations, optionally stopping at `target` (used by the upgrade test). */
export function migrate(db: Db, target = MIGRATIONS.length): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  if (!db.prepare('SELECT version FROM schema_version').get()) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  let version = schemaVersion(db);
  while (version < target) {
    const migration = MIGRATIONS[version]!;
    const next = version + 1;
    if (migration.rebuild) {
      // SQLite's documented way to change a table: foreign keys off, rebuild, verify, foreign keys on.
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('PRAGMA legacy_alter_table = ON');
      try {
        transaction(db, () => {
          db.exec(migration.sql);
          const broken = db.prepare('PRAGMA foreign_key_check').all();
          if (broken.length) throw new Error(`Migration ${next} broke foreign keys: ${JSON.stringify(broken.slice(0, 3))}`);
          db.prepare('UPDATE schema_version SET version = ?').run(next);
        });
      } finally {
        db.exec('PRAGMA legacy_alter_table = OFF');
        db.exec('PRAGMA foreign_keys = ON');
      }
    } else {
      transaction(db, () => {
        db.exec(migration.sql);
        db.prepare('UPDATE schema_version SET version = ?').run(next);
      });
    }
    version = next;
  }
}

function hasLines(db: Db, code: string): boolean {
  return !!db.prepare('SELECT 1 FROM entry_lines WHERE account_code = ? LIMIT 1').get(code);
}

function accountExists(db: Db, code: string): boolean {
  return !!db.prepare('SELECT 1 FROM accounts WHERE code = ?').get(code);
}

function hasChildren(db: Db, code: string): boolean {
  return !!db.prepare("SELECT 1 FROM accounts WHERE code LIKE ? || '%' AND code <> ? LIMIT 1").get(code, code);
}

/** Creates the chart, settings and default warehouse on a new database, and fills in anything a newer version needs. Safe to run every time. */
function ensureDefaults(db: Db): void {
  const now = new Date().toISOString();
  const insertAccount = db.prepare('INSERT INTO accounts (code, name_ar, name_en, name_ku, system, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  transaction(db, () => {
    const empty = (db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n === 0;
    if (empty) {
      for (const a of IRAQI_UNIFIED_CHART) insertAccount.run(a.code, a.name.ar, a.name.en, a.name.ku, 1, now);
    }
    for (const a of STARTER_SUB_ACCOUNTS) {
      if (accountExists(db, a.code)) continue;
      const parent = a.code.slice(0, -1);
      // Never split an account that already holds entries — its lines would end up on a parent account.
      if (!accountExists(db, parent) || hasLines(db, parent)) continue;
      insertAccount.run(a.code, a.name.ar, a.name.en, a.name.ku, 0, now);
    }

    const setting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    setting.run('company_name', JSON.stringify({ ar: '', en: '', ku: '' }));
    setting.run('default_rate_x100', '142000');
    setting.run('fiscal_year_start', '01-01');
    const postable = (code: string, fallback: string) => (accountExists(db, code) && !hasChildren(db, code) ? code : fallback);
    setting.run('posting_accounts', JSON.stringify({
      customers: postable(DEFAULT_POSTING_ACCOUNTS.customers, '161'),
      suppliers: postable(DEFAULT_POSTING_ACCOUNTS.suppliers, '261'),
      sales: DEFAULT_POSTING_ACCOUNTS.sales,
      costOfSales: DEFAULT_POSTING_ACCOUNTS.costOfSales,
      cash: postable(DEFAULT_POSTING_ACCOUNTS.cash, '181')
    }));

    // the owner: the one user a company starts with; the app opens as this user until sign-in is switched on
    if ((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 0) {
      db.prepare("INSERT INTO users (id, username, name, password_hash, roles, active, created_at) VALUES (?, 'admin', 'Admin', NULL, '[\"admin\"]', 1, ?)")
        .run(randomUUID(), now);
    }

    const warehouses = (db.prepare('SELECT COUNT(*) AS n FROM warehouses').get() as { n: number }).n;
    if (warehouses === 0) {
      const account = accountExists(db, '1371') && !hasChildren(db, '1371') ? '1371' : '137';
      db.prepare('INSERT INTO warehouses (id, code, name_ar, name_en, name_ku, account_code, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
        .run(randomUUID(), 'MAIN', 'المخزن الرئيسي', 'Main warehouse', 'کۆگای سەرەکی', account, now);
    }
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

/** Returns the next number of a named counter (1, 2, 3 …). Call inside a transaction. */
export function nextSequence(db: Db, key: string): number {
  const row = db.prepare('SELECT next FROM sequences WHERE key = ?').get(key) as { next: number } | undefined;
  const seq = row?.next ?? 1;
  if (row) db.prepare('UPDATE sequences SET next = ? WHERE key = ?').run(seq + 1, key);
  else db.prepare('INSERT INTO sequences (key, next) VALUES (?, ?)').run(key, seq + 1);
  return seq;
}
