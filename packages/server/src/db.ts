import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { brandKey, DEFAULT_POSTING_ACCOUNTS, IRAQI_UNIFIED_CHART, STARTER_SUB_ACCOUNTS } from '@qasa/core';
import { AppError } from './errors.ts';
import {
  MYSQL_TABLES, MYSQL_TRIGGERS, mysqlCollations, mysqlTableSql, pendingMysqlSteps, V10_MYSQL_STEPS, V11_MYSQL_STEPS, V12_MYSQL_STEPS, type MysqlCollations, type MysqlStep
} from './schema-mysql.ts';

export type SqlParam = null | number | bigint | string | Uint8Array;
export type SqlValue = null | number | bigint | string | Uint8Array;

export interface DbStatement {
  run(...params: SqlParam[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: SqlParam[]): Record<string, SqlValue> | undefined;
  all(...params: SqlParam[]): Record<string, SqlValue>[];
}

/**
 * The company database: an SQLite file (node:sqlite, or sql.js in the website demo) or, with Pro, a MariaDB or
 * MySQL server (dialect 'mysql'). The app's SQL is written to mean the same on both; where the two differ, the
 * helpers below (insertOrKeep, quoteId) and the server schema in schema-mysql.ts give each its own words.
 */
export interface Db {
  exec(sql: string): void;
  prepare(sql: string): DbStatement;
  close(): void;
  readonly dialect?: 'sqlite' | 'mysql';
}

export const isMysql = (db: Db): boolean => db.dialect === 'mysql';

interface Migration {
  sql: string;
  /** Rebuilds an existing table: runs with foreign keys off, then checks them. */
  rebuild?: boolean;
  /**
   * The same change on a MariaDB or MySQL server (versions 1–5 are in schema-mysql.ts): 'tables' when it only adds the
   * tables and triggers schema-mysql.ts marks `since` this version; { tables, steps } when it also changes tables
   * already there (each step skipped when it is done already); else its own statements, one each.
   */
  mysql?: 'tables' | { tables: true; steps: (collations: MysqlCollations) => readonly MysqlStep[] } | ((collations: MysqlCollations) => readonly string[]);
  /**
   * Rows the change moves: after its SQL in the same transaction on SQLite, after its steps on a server. It must be
   * safe to run again (a server upgrade cut off half way runs it on the next start).
   */
  data?: (db: Db) => void;
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

const V5 =
  // 5 — year-end closing: the closing entry (قيد الإقفال) moves each year's result into the reserves
  `
  CREATE TABLE entries_v5 (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('journal', 'receipt', 'payment', 'reversal', 'sale', 'purchase', 'sale_return', 'purchase_return', 'opening_stock', 'transfer', 'closing')),
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
    updated_at TEXT NOT NULL,
    prepared_by_id TEXT REFERENCES users(id),
    checked_by_id TEXT REFERENCES users(id)
  );
  INSERT INTO entries_v5 SELECT id, type, number, date, description, party, currency, rate_x100, status, cash_account,
    reverses_id, reversed_by_id, prepared_by, prepared_at, checked_by, checked_at, approved_by, approved_at, updated_at,
    prepared_by_id, checked_by_id FROM entries;
  DROP TABLE entries;
  ALTER TABLE entries_v5 RENAME TO entries;
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
  `;

const V6 =
  // 6 — installment sales (البيع بالتقسيط): contracts with their schedule and collections, and guarantors (الكفلاء)
  `
  CREATE TABLE guarantors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    -- the national ID card number (رقم البطاقة الوطنية), as the pledge shows it
    id_number TEXT,
    address TEXT,
    -- where the guarantor works (جهة العمل)
    workplace TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  -- a contract schedules what a customer owes: a posted credit sale (invoice_id), or a balance from before Qasa ERP
  CREATE TABLE installment_contracts (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
    date TEXT NOT NULL,
    party_id TEXT NOT NULL REFERENCES parties(id),
    guarantor_id TEXT REFERENCES guarantors(id),
    invoice_id TEXT REFERENCES invoices(id),
    description TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    total INTEGER NOT NULL CHECK (total > 0),
    down_payment INTEGER NOT NULL DEFAULT 0,
    months INTEGER NOT NULL CHECK (months BETWEEN 1 AND 120),
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    cancelled_by TEXT,
    cancelled_at TEXT,
    updated_at TEXT NOT NULL,
    CHECK (down_payment >= 0 AND down_payment < total)
  );
  CREATE INDEX installment_contracts_party ON installment_contracts(party_id);
  CREATE INDEX installment_contracts_invoice ON installment_contracts(invoice_id);

  -- seq 0 is the down payment, then one row a month
  CREATE TABLE installment_schedule (
    contract_id TEXT NOT NULL REFERENCES installment_contracts(id),
    seq INTEGER NOT NULL CHECK (seq >= 0),
    due_date TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    PRIMARY KEY (contract_id, seq)
  );

  -- the receipt vouchers that collected a contract's installments (in the contract's currency)
  CREATE TABLE installment_receipts (
    contract_id TEXT NOT NULL REFERENCES installment_contracts(id),
    entry_id TEXT NOT NULL UNIQUE REFERENCES entries(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_at TEXT NOT NULL,
    PRIMARY KEY (contract_id, entry_id)
  );

  -- a contract's terms, schedule and collections never change; a contract can only be cancelled (its collections stay)
  CREATE TRIGGER installment_contracts_no_delete BEFORE DELETE ON installment_contracts
  BEGIN SELECT RAISE(ABORT, 'installment_contract_is_permanent'); END;
  CREATE TRIGGER installment_contracts_no_edit BEFORE UPDATE ON installment_contracts
  WHEN OLD.status = 'cancelled' OR NEW.number IS NOT OLD.number OR NEW.date IS NOT OLD.date OR NEW.party_id IS NOT OLD.party_id OR
    NEW.invoice_id IS NOT OLD.invoice_id OR NEW.currency IS NOT OLD.currency OR NEW.total IS NOT OLD.total OR
    NEW.down_payment IS NOT OLD.down_payment OR NEW.months IS NOT OLD.months OR NEW.created_by IS NOT OLD.created_by OR
    NEW.created_at IS NOT OLD.created_at
  BEGIN SELECT RAISE(ABORT, 'installment_contract_is_permanent'); END;
  CREATE TRIGGER installment_schedule_no_update BEFORE UPDATE ON installment_schedule
  BEGIN SELECT RAISE(ABORT, 'installment_contract_is_permanent'); END;
  CREATE TRIGGER installment_schedule_no_delete BEFORE DELETE ON installment_schedule
  BEGIN SELECT RAISE(ABORT, 'installment_contract_is_permanent'); END;
  CREATE TRIGGER installment_receipts_no_update BEFORE UPDATE ON installment_receipts
  BEGIN SELECT RAISE(ABORT, 'installment_contract_is_permanent'); END;
  CREATE TRIGGER installment_receipts_no_delete BEFORE DELETE ON installment_receipts
  BEGIN SELECT RAISE(ABORT, 'installment_contract_is_permanent'); END;
  `;

const V7 =
  // 7 — release 1.0: industry features (real estate on Business; mobile shops, car parts, engineering works on Pro),
  // item pictures, quotations, the sales pipeline (Pro), point of sale, payroll (Pro), the dollar rate history, generator
  // owners (Pro)
  `
  CREATE TABLE re_projects (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    city TEXT,
    address TEXT,
    -- units are priced and sold in this currency
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    -- the service item its sale invoices use (made with the project)
    item_id TEXT NOT NULL REFERENCES items(id),
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE re_units (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES re_projects(id),
    -- the building or block within the project ('' when it has one)
    building TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL,
    floor INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL CHECK (kind IN ('apartment', 'villa', 'house', 'shop', 'office', 'land')),
    bedrooms INTEGER NOT NULL DEFAULT 0 CHECK (bedrooms >= 0),
    -- square metres × 100
    area_x100 INTEGER NOT NULL DEFAULT 0 CHECK (area_x100 >= 0),
    -- the asking price, in the project's currency
    price INTEGER NOT NULL CHECK (price >= 0),
    view TEXT,
    status TEXT NOT NULL CHECK (status IN ('available', 'reserved', 'sold')),
    -- the customer it is reserved for or sold to
    party_id TEXT REFERENCES parties(id),
    reserved_until TEXT,
    -- the sale invoice and, when sold by installments, its contract
    invoice_id TEXT REFERENCES invoices(id),
    contract_id TEXT REFERENCES installment_contracts(id),
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, building, code),
    CHECK ((status = 'available') = (party_id IS NULL)),
    CHECK (status = 'sold' OR (invoice_id IS NULL AND contract_id IS NULL))
  );
  CREATE INDEX re_units_project ON re_units(project_id);
  CREATE INDEX re_units_party ON re_units(party_id);

  -- mobile shops (Pro): each phone by its IMEI or serial number, and repair orders
  CREATE TABLE serials (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id),
    -- the IMEI or serial number, upper case without spaces
    serial TEXT NOT NULL UNIQUE,
    grade TEXT NOT NULL CHECK (grade IN ('new', 'used')),
    status TEXT NOT NULL CHECK (status IN ('in_stock', 'sold', 'returned', 'defective')),
    -- where it came from: a purchase invoice, or bought from a customer (trade-in)
    purchase_invoice_id TEXT REFERENCES invoices(id),
    from_party_id TEXT REFERENCES parties(id),
    cost INTEGER,
    -- the sale that took it, and the customer's warranty
    sale_invoice_id TEXT REFERENCES invoices(id),
    party_id TEXT REFERENCES parties(id),
    sold_at TEXT,
    warranty_until TEXT,
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (status <> 'sold' OR sale_invoice_id IS NOT NULL)
  );
  CREATE INDEX serials_item ON serials(item_id);
  CREATE INDEX serials_sale ON serials(sale_invoice_id);
  -- every sale that took a serial, kept when it is sold again (serials.sale_invoice_id is only the latest)
  CREATE TABLE serial_sales (
    id TEXT PRIMARY KEY,
    serial_id TEXT NOT NULL REFERENCES serials(id),
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    warranty_until TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX serial_sales_serial ON serial_sales(serial_id);
  CREATE INDEX serial_sales_invoice ON serial_sales(invoice_id);

  CREATE TABLE repair_orders (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL,
    party_id TEXT NOT NULL REFERENCES parties(id),
    device TEXT NOT NULL,
    serial TEXT,
    problem TEXT NOT NULL,
    -- what the customer left with the device (charger, case, SIM …) and its state on arrival
    accessories TEXT,
    passcode_given INTEGER NOT NULL DEFAULT 0,
    technician TEXT,
    status TEXT NOT NULL CHECK (status IN ('received', 'diagnosing', 'waiting_parts', 'repairing', 'ready', 'delivered', 'cancelled')),
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    estimate INTEGER NOT NULL DEFAULT 0 CHECK (estimate >= 0),
    promised_date TEXT,
    -- the sale invoice that charged the repair, made at delivery
    invoice_id TEXT REFERENCES invoices(id),
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX repair_orders_party ON repair_orders(party_id);

  -- car parts (Pro): shelf, brand and origin, part numbers (OEM and alternatives) and the cars a part fits
  CREATE TABLE part_details (
    item_id TEXT PRIMARY KEY REFERENCES items(id),
    shelf TEXT,
    brand TEXT,
    -- genuine, or the country it was made in
    origin TEXT,
    -- the price for garages and wholesalers, in the item's sale currency
    wholesale_price INTEGER CHECK (wholesale_price IS NULL OR wholesale_price >= 0),
    -- reorder when stock falls to this (thousandths)
    reorder_milli INTEGER CHECK (reorder_milli IS NULL OR reorder_milli >= 0),
    updated_at TEXT NOT NULL
  );

  CREATE TABLE part_numbers (
    item_id TEXT NOT NULL REFERENCES items(id),
    -- as written, and upper case without spaces, dots or dashes for searching
    number TEXT NOT NULL,
    number_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('oem', 'alt')),
    maker TEXT,
    PRIMARY KEY (item_id, number_key)
  );
  CREATE INDEX part_numbers_key ON part_numbers(number_key);

  CREATE TABLE part_fitments (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id),
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    year_from INTEGER,
    year_to INTEGER,
    engine TEXT,
    CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
  );
  CREATE INDEX part_fitments_item ON part_fitments(item_id);
  CREATE INDEX part_fitments_car ON part_fitments(make, model);

  -- engineering works (Pro): job orders for welding, steelwork, aluminium, MDF, doors and windows — the quote and its
  -- measured lines, the job's progress from measuring to installing, deposits, what it cost, and the final sale invoice
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL,
    party_id TEXT NOT NULL REFERENCES parties(id),
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('welding', 'steel', 'aluminium', 'mdf', 'openings', 'electrical', 'solar', 'general')),
    site TEXT,
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    status TEXT NOT NULL CHECK (status IN ('quote', 'measuring', 'approved', 'fabricating', 'installing', 'done', 'invoiced', 'cancelled')),
    -- discount on the quote, in the job's currency
    discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
    due_date TEXT,
    assigned_to TEXT,
    -- the sale invoice that billed it
    invoice_id TEXT REFERENCES invoices(id),
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX jobs_party ON jobs(party_id);

  -- the quote: measured lines (2.40 m × 1.80 m of aluminium, a gate, labour …)
  CREATE TABLE job_lines (
    job_id TEXT NOT NULL REFERENCES jobs(id),
    seq INTEGER NOT NULL,
    description TEXT NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('m2', 'm', 'piece', 'kg', 'set', 'lump')),
    qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
    PRIMARY KEY (job_id, seq)
  );

  -- what a job cost: a posted purchase invoice (materials bought for it) or an approved voucher (wages, transport …)
  CREATE TABLE job_costs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    category TEXT NOT NULL CHECK (category IN ('materials', 'labour', 'subcontract', 'transport', 'other')),
    invoice_id TEXT REFERENCES invoices(id),
    entry_id TEXT REFERENCES entries(id),
    -- in IQD
    amount INTEGER NOT NULL CHECK (amount > 0),
    description TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK ((invoice_id IS NULL) <> (entry_id IS NULL))
  );
  CREATE INDEX job_costs_job ON job_costs(job_id);

  -- deposits (العربون) and payments the customer made on a job: receipt vouchers
  CREATE TABLE job_receipts (
    job_id TEXT NOT NULL REFERENCES jobs(id),
    entry_id TEXT NOT NULL UNIQUE REFERENCES entries(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_at TEXT NOT NULL,
    PRIMARY KEY (job_id, entry_id)
  );

  -- a picture for each item (shown in lists, the parts counter, POS and invoices), kept small (resized before saving)
  CREATE TABLE item_images (
    item_id TEXT PRIMARY KEY REFERENCES items(id),
    mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- quotations (عروض الأسعار): priced offers that become a sale invoice when the customer accepts
  CREATE TABLE quotes (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL,
    valid_until TEXT,
    party_id TEXT REFERENCES parties(id),
    -- for someone not (yet) a customer
    customer_name TEXT,
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
    status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'invoiced', 'cancelled')),
    invoice_id TEXT REFERENCES invoices(id),
    notes TEXT,
    terms TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (party_id IS NOT NULL OR customer_name IS NOT NULL)
  );

  CREATE TABLE quote_lines (
    quote_id TEXT NOT NULL REFERENCES quotes(id),
    seq INTEGER NOT NULL,
    item_id TEXT REFERENCES items(id),
    description TEXT NOT NULL,
    qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
    PRIMARY KEY (quote_id, seq)
  );

  -- the sales pipeline (Pro): leads and deals from first contact to won or lost
  CREATE TABLE deals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    party_id TEXT REFERENCES parties(id),
    contact_name TEXT,
    phone TEXT,
    source TEXT,
    stage TEXT NOT NULL CHECK (stage IN ('lead', 'contacted', 'quoted', 'negotiating', 'won', 'lost')),
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
    expected_date TEXT,
    next_step TEXT,
    next_date TEXT,
    owner TEXT,
    quote_id TEXT REFERENCES quotes(id),
    lost_reason TEXT,
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT
  );

  -- point of sale: a cashier's shift on a register, from opening cash to the counted cash at closing
  CREATE TABLE pos_shifts (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    register TEXT NOT NULL,
    cash_account TEXT NOT NULL REFERENCES accounts(code),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    opened_by TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    opening_cash INTEGER NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
    closed_by TEXT,
    closed_at TEXT,
    -- dinars and dollars are counted apart at closing
    expected_cash INTEGER,
    counted_cash INTEGER,
    expected_usd INTEGER,
    counted_usd INTEGER,
    notes TEXT
  );
  CREATE TABLE pos_sales (
    invoice_id TEXT PRIMARY KEY REFERENCES invoices(id),
    shift_id TEXT NOT NULL REFERENCES pos_shifts(id)
  );
  CREATE INDEX pos_sales_shift ON pos_sales(shift_id);

  -- payroll (Pro): employees, a run per month that posts one journal entry, and advances paid back from salaries
  CREATE TABLE employees (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    job_title TEXT,
    department TEXT,
    phone TEXT,
    id_number TEXT,
    hire_date TEXT,
    end_date TEXT,
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    base_salary INTEGER NOT NULL CHECK (base_salary >= 0),
    -- fixed monthly allowances (transport, food, housing …)
    allowances INTEGER NOT NULL DEFAULT 0 CHECK (allowances >= 0),
    -- in the social security scheme (الضمان الاجتماعي)
    social_security INTEGER NOT NULL DEFAULT 0,
    bank_account TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE payroll_runs (
    id TEXT PRIMARY KEY,
    -- the month, YYYY-MM
    period TEXT NOT NULL,
    date TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
    -- the journal entry it posts (it then follows the preparer, checker and approver), and the payment voucher that paid it
    entry_id TEXT REFERENCES entries(id),
    payment_entry_id TEXT REFERENCES entries(id),
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX payroll_runs_period ON payroll_runs(period);

  CREATE TABLE payroll_lines (
    run_id TEXT NOT NULL REFERENCES payroll_runs(id),
    employee_id TEXT NOT NULL REFERENCES employees(id),
    base INTEGER NOT NULL,
    allowances INTEGER NOT NULL DEFAULT 0,
    overtime INTEGER NOT NULL DEFAULT 0,
    bonus INTEGER NOT NULL DEFAULT 0,
    absence INTEGER NOT NULL DEFAULT 0,
    advance_deduction INTEGER NOT NULL DEFAULT 0,
    social_security INTEGER NOT NULL DEFAULT 0,
    other_deductions INTEGER NOT NULL DEFAULT 0,
    net INTEGER NOT NULL,
    notes TEXT,
    PRIMARY KEY (run_id, employee_id)
  );

  -- an advance (سلفة) paid to an employee by payment voucher, taken back from salaries month by month
  CREATE TABLE employee_advances (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id),
    date TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    monthly INTEGER NOT NULL CHECK (monthly > 0),
    entry_id TEXT REFERENCES entries(id),
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX employee_advances_employee ON employee_advances(employee_id);

  -- the day's dollar rate (سعر الصرف) as the company enters it, kept as a history
  CREATE TABLE fx_rates (
    date TEXT PRIMARY KEY,
    -- IQD per 1 USD × 100
    rate_x100 INTEGER NOT NULL CHECK (rate_x100 > 0),
    source TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- generator owners (المولدات, Pro): subscribers by amps, a billing run each month, and collections
  CREATE TABLE gen_subscribers (
    -- each subscriber is a customer (their balance and statement)
    party_id TEXT PRIMARY KEY REFERENCES parties(id),
    code TEXT NOT NULL UNIQUE,
    -- amps × 10 (2.5 A → 25)
    amps_x10 INTEGER NOT NULL CHECK (amps_x10 > 0),
    -- normal hours, or the 24-hour line (الذهبي)
    line TEXT NOT NULL CHECK (line IN ('normal', 'golden')),
    area TEXT,
    route TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'ended')),
    start_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE gen_runs (
    id TEXT PRIMARY KEY,
    -- the month, YYYY-MM
    period TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL,
    -- the price of one amp for the month, in dinars, per line
    price_normal INTEGER NOT NULL CHECK (price_normal >= 0),
    price_golden INTEGER NOT NULL CHECK (price_golden >= 0),
    status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
    -- the journal entry that bills every subscriber (Dr each customer, Cr generator revenue)
    entry_id TEXT REFERENCES entries(id),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE gen_bills (
    run_id TEXT NOT NULL REFERENCES gen_runs(id),
    party_id TEXT NOT NULL REFERENCES gen_subscribers(party_id),
    amps_x10 INTEGER NOT NULL,
    line TEXT NOT NULL CHECK (line IN ('normal', 'golden')),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (run_id, party_id)
  );

  -- a collector's receipt (وصل الجباية): a receipt voucher posted at once
  CREATE TABLE gen_collections (
    entry_id TEXT PRIMARY KEY REFERENCES entries(id),
    party_id TEXT NOT NULL REFERENCES gen_subscribers(party_id),
    collector TEXT,
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_at TEXT NOT NULL
  );
  CREATE INDEX gen_collections_party ON gen_collections(party_id);

  -- the website API (Pro): keys a website or app uses (only a hash is kept), and the addresses told about changes
  CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    -- the first characters, shown so the owner can tell keys apart
    prefix TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    -- what the key may do, e.g. ["items:read","orders:write"]
    scopes TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  );

  -- orders a website sent, by its own order number, so sending one again never makes a second invoice
  CREATE TABLE webapi_orders (
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (source, external_id)
  );

  -- stock adjustments (damaged, lost, expired, count differences, used in the company or issued to a job): quantities in
  -- (+) or out (−) of a warehouse at cost, posted against an expense or income account
  CREATE TABLE stock_adjustments (
    id TEXT PRIMARY KEY,
    number TEXT UNIQUE,
    date TEXT NOT NULL,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    reason TEXT NOT NULL CHECK (reason IN ('damaged', 'lost', 'expired', 'count', 'internal_use', 'job', 'other')),
    -- the account the value goes to (a loss or expense, or a gain for a count surplus)
    account_code TEXT REFERENCES accounts(code),
    job_id TEXT REFERENCES jobs(id),
    status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
    entry_id TEXT REFERENCES entries(id),
    notes TEXT,
    created_by TEXT NOT NULL,
    -- who prepared the current draft: with separate duties, someone else posts it
    prepared_by_id TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE stock_adjustment_lines (
    adjustment_id TEXT NOT NULL REFERENCES stock_adjustments(id),
    seq INTEGER NOT NULL,
    item_id TEXT NOT NULL REFERENCES items(id),
    -- thousandths; negative takes out, positive adds
    qty_milli INTEGER NOT NULL CHECK (qty_milli <> 0),
    -- IQD per unit for additions (taken out at the weighted average cost)
    unit_cost INTEGER,
    PRIMARY KEY (adjustment_id, seq)
  );

  -- purchase orders: ordered from a supplier, received (fully or in part) into a purchase invoice
  CREATE TABLE purchase_orders (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL,
    party_id TEXT NOT NULL REFERENCES parties(id),
    warehouse_id TEXT REFERENCES warehouses(id),
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    expected_date TEXT,
    status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'partial', 'received', 'cancelled')),
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE purchase_order_lines (
    order_id TEXT NOT NULL REFERENCES purchase_orders(id),
    seq INTEGER NOT NULL,
    item_id TEXT NOT NULL REFERENCES items(id),
    qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
    PRIMARY KEY (order_id, seq)
  );
  -- the purchase invoices that received an order (one order can be received over several)
  CREATE TABLE purchase_order_receipts (
    order_id TEXT NOT NULL REFERENCES purchase_orders(id),
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    PRIMARY KEY (order_id, invoice_id)
  );

  -- which price a customer pays by default: retail (the item's sale price) or wholesale (part_details / item_prices)
  CREATE TABLE party_price_lists (
    party_id TEXT PRIMARY KEY REFERENCES parties(id),
    list TEXT NOT NULL CHECK (list IN ('retail', 'wholesale'))
  );
  CREATE TABLE item_prices (
    item_id TEXT NOT NULL REFERENCES items(id),
    list TEXT NOT NULL CHECK (list IN ('wholesale')),
    price INTEGER NOT NULL CHECK (price >= 0),
    PRIMARY KEY (item_id, list)
  );

  -- fixed assets (الموجودات الثابتة) and their monthly depreciation
  CREATE TABLE fixed_assets (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    -- the category picked on the register (furniture and computers share account 116); NULL: taken from the account
    category TEXT CHECK (category IN ('land', 'buildings', 'machinery', 'vehicles', 'tools', 'furniture', 'computers')),
    -- the asset account (11…), its accumulated depreciation account and the depreciation expense account
    asset_account TEXT NOT NULL REFERENCES accounts(code),
    accum_account TEXT NOT NULL REFERENCES accounts(code),
    expense_account TEXT NOT NULL REFERENCES accounts(code),
    acquired TEXT NOT NULL,
    -- in IQD
    cost INTEGER NOT NULL CHECK (cost > 0),
    salvage INTEGER NOT NULL DEFAULT 0 CHECK (salvage >= 0),
    life_months INTEGER NOT NULL CHECK (life_months > 0),
    method TEXT NOT NULL CHECK (method IN ('straight_line')),
    -- depreciation already taken before Qasa ERP
    opening_accum INTEGER NOT NULL DEFAULT 0 CHECK (opening_accum >= 0),
    location TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'disposed')),
    disposed_on TEXT,
    -- the draft/posted entry that took the asset off the books (cleared when the disposal is taken back)
    disposal_entry_id TEXT REFERENCES entries(id),
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE depreciation_runs (
    id TEXT PRIMARY KEY,
    -- YYYY-MM
    period TEXT NOT NULL UNIQUE,
    entry_id TEXT REFERENCES entries(id),
    status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE depreciation_lines (
    run_id TEXT NOT NULL REFERENCES depreciation_runs(id),
    asset_id TEXT NOT NULL REFERENCES fixed_assets(id),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (run_id, asset_id)
  );

  -- a real estate reservation's deposit (عربون الحجز): a receipt voucher, counted towards the sale
  CREATE TABLE re_deposits (
    -- the receipt voucher that took it (posted at once, as document receipts are)
    entry_id TEXT PRIMARY KEY REFERENCES entries(id),
    unit_id TEXT NOT NULL REFERENCES re_units(id),
    party_id TEXT NOT NULL REFERENCES parties(id),
    -- in the project's currency
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    date TEXT NOT NULL,
    -- what happened to it: kept with the reservation, counted in the sale, paid back, or kept by the company
    status TEXT NOT NULL CHECK (status IN ('held', 'applied', 'refunded', 'forfeited')),
    -- the sale invoice it was counted in
    invoice_id TEXT REFERENCES invoices(id),
    -- the draft payment voucher (refund) or journal entry (forfeit) that closed it, through checking and approval
    close_entry_id TEXT REFERENCES entries(id),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    closed_at TEXT
  );
  CREATE INDEX re_deposits_unit ON re_deposits(unit_id);

  -- banking: cheques received and written (الصكوك) with their life from in hand to cleared or bounced
  CREATE TABLE cheques (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('received', 'issued')),
    number TEXT NOT NULL,
    bank TEXT NOT NULL,
    party_id TEXT NOT NULL REFERENCES parties(id),
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    issue_date TEXT NOT NULL,
    -- the date it may be cashed (post-dated cheques are common)
    due_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('in_hand', 'deposited', 'cleared', 'bounced', 'cancelled', 'pending')),
    -- the bank account it was deposited to or drawn on
    bank_account TEXT REFERENCES accounts(code),
    -- the entries of its life: receiving or writing it, depositing, clearing, bouncing
    entry_id TEXT REFERENCES entries(id),
    clear_entry_id TEXT REFERENCES entries(id),
    bounce_entry_id TEXT REFERENCES entries(id),
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX cheques_due ON cheques(status, due_date);

  -- bank reconciliation: lines of a bank statement brought in from the bank's Excel/CSV, matched to entry lines
  CREATE TABLE bank_statements (
    id TEXT PRIMARY KEY,
    account_code TEXT NOT NULL REFERENCES accounts(code),
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    opening INTEGER NOT NULL,
    closing INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'reconciled')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE bank_statement_lines (
    statement_id TEXT NOT NULL REFERENCES bank_statements(id),
    seq INTEGER NOT NULL,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    reference TEXT,
    -- money in is positive, money out negative, in the account's currency
    amount INTEGER NOT NULL,
    -- the voucher it matches (one entry may match several lines and the other way round only through split, kept simple)
    entry_id TEXT REFERENCES entries(id),
    PRIMARY KEY (statement_id, seq)
  );

  -- branches (Business): a branch groups warehouses and safes/banks, and users can be limited to their branches; an
  -- invoice belongs to its warehouse's branch and a voucher to its safe's, so the documents need no column of their own
  CREATE TABLE branches (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    city TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE branch_warehouses (
    warehouse_id TEXT PRIMARY KEY REFERENCES warehouses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id)
  );
  CREATE TABLE branch_accounts (
    account_code TEXT PRIMARY KEY REFERENCES accounts(code),
    branch_id TEXT NOT NULL REFERENCES branches(id)
  );
  -- a user listed here works only in these branches (not listed: every branch)
  CREATE TABLE user_branches (
    user_id TEXT NOT NULL REFERENCES users(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    PRIMARY KEY (user_id, branch_id)
  );

  -- electrical and solar (Pro): a solar system's design on its job order (sizing, which quote lines are stock items,
  -- equipment waiting for the sale), as JSON
  CREATE TABLE solar_designs (
    job_id TEXT PRIMARY KEY REFERENCES jobs(id),
    design TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- electrical and solar (Pro): maintenance plans (periodic service of an installed system) and the visits made
  CREATE TABLE maint_plans (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL REFERENCES parties(id),
    -- the installation it looks after (a job order), if any
    job_id TEXT REFERENCES jobs(id),
    title TEXT NOT NULL,
    site TEXT,
    every_months INTEGER NOT NULL CHECK (every_months BETWEEN 1 AND 24),
    next_date TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    -- the price of one visit (0 while under warranty or prepaid)
    price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
    status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'ended')),
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX maint_plans_party ON maint_plans(party_id);

  CREATE TABLE maint_visits (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    plan_id TEXT REFERENCES maint_plans(id),
    party_id TEXT NOT NULL REFERENCES parties(id),
    date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('service', 'repair', 'inspection', 'installation')),
    technician TEXT,
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'done', 'cancelled')),
    -- what was found and done (readings: panel output, battery health …)
    findings TEXT,
    work_done TEXT,
    -- the sale invoice that charged it, if it was paid
    invoice_id TEXT REFERENCES invoices(id),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX maint_visits_party ON maint_visits(party_id);

  CREATE TABLE webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    -- e.g. ["stock.changed","price.changed","order.updated"]
    events TEXT NOT NULL,
    -- signs each delivery (HMAC); kept as given, shown once
    secret TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    last_status INTEGER,
    last_delivery_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `;

const V8 =
  // 8 — stock counts saved as they are typed: a count session per warehouse, and each item's book quantity frozen the
  // moment it is first counted (sales during the count don't turn into surpluses)
  `
  CREATE TABLE stock_counts (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    date TEXT NOT NULL,
    notes TEXT,
    -- items not counted count as zero when it is finished
    count_all INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('open', 'done', 'discarded')),
    -- the draft "count" adjustment it made when finished (none when everything agreed)
    adjustment_id TEXT REFERENCES stock_adjustments(id),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX stock_counts_warehouse ON stock_counts(warehouse_id, status);
  CREATE TABLE stock_count_lines (
    count_id TEXT NOT NULL REFERENCES stock_counts(id),
    item_id TEXT NOT NULL REFERENCES items(id),
    -- thousandths, as counted on the shelves
    counted_milli INTEGER NOT NULL CHECK (counted_milli >= 0),
    -- what the books said when the item was first counted: the difference is taken against this
    book_milli INTEGER NOT NULL,
    -- IQD per unit for a surplus of an item without an average cost
    unit_cost INTEGER,
    counted_at TEXT NOT NULL,
    PRIMARY KEY (count_id, item_id)
  );
  `;

const V9 =
  // 9 — the items a count covers, fixed when it starts: with "count all", an item made or switched on again while the
  // shelves are being counted was never on the count sheet, so finishing the count does not take it for a shortage
  `
  CREATE TABLE stock_count_items (
    count_id TEXT NOT NULL REFERENCES stock_counts(id),
    item_id TEXT NOT NULL REFERENCES items(id),
    PRIMARY KEY (count_id, item_id)
  );
  `;

const V10 =
  // 10 — 1.1: units with conversions, item categories, batches and expiry dates, payments kept with an invoice (POS
  // split payments and online payments), the pharmacy pack. Old rows are never rewritten: NULL in a new line column
  // means "the base unit, no batch", which is what every line made before 1.1 was
  `
  CREATE TABLE item_categories (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_ku TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE item_batches (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id),
    -- '' = stock with no number: from before batches were tracked (no expiry), else one batch per expiry date
    number TEXT NOT NULL,
    expiry TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX item_batches_expiry ON item_batches(expiry);
  -- unique per number AND expiry date, so a date typed on the way in is never lost (a numbered batch still keeps one
  -- date: the app checks that)
  CREATE UNIQUE INDEX item_batches_number_expiry ON item_batches(item_id, number, expiry);

  ALTER TABLE items ADD COLUMN category_id TEXT REFERENCES item_categories(id);
  -- the unit picked by default on sale and on purchase lines (NULL = the base unit, items.unit)
  ALTER TABLE items ADD COLUMN sale_unit TEXT;
  ALTER TABLE items ADD COLUMN purchase_unit TEXT;
  -- 0/1: stock kept per batch number; expiry asked on the way in
  ALTER TABLE items ADD COLUMN track_batches INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE items ADD COLUMN track_expiry INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE items ADD COLUMN updated_at TEXT;
  CREATE INDEX items_category ON items(category_id);

  -- the other units an item is bought or sold in; the base unit (items.unit) is never listed here
  CREATE TABLE item_units (
    item_id TEXT NOT NULL REFERENCES items(id),
    unit TEXT NOT NULL,
    -- base units in one of this unit, in thousandths (box = 100 tablets: 100000; a gram of a kg item: 1)
    factor_milli INTEGER NOT NULL CHECK (factor_milli > 0),
    barcode TEXT,
    -- price of one of this unit, in the item's sale currency; NULL = the base price × the factor
    sale_price INTEGER CHECK (sale_price IS NULL OR sale_price >= 0),
    sort INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (item_id, unit)
  );
  CREATE UNIQUE INDEX item_units_barcode ON item_units(barcode);

  -- what a line was typed in. NULL unit = the base unit (every line made before 1.1); qty_milli stays the BASE quantity
  ALTER TABLE invoice_lines ADD COLUMN unit TEXT;
  ALTER TABLE invoice_lines ADD COLUMN unit_factor_milli INTEGER;
  ALTER TABLE invoice_lines ADD COLUMN unit_qty_milli INTEGER;
  -- batches: what came in (purchase) or the batch picked by hand (sale); NULL = automatic (earliest expiry first)
  ALTER TABLE invoice_lines ADD COLUMN batch_no TEXT;
  ALTER TABLE invoice_lines ADD COLUMN expiry TEXT;
  ALTER TABLE invoice_lines ADD COLUMN batch_id TEXT REFERENCES item_batches(id);
  ALTER TABLE stock_doc_lines ADD COLUMN unit TEXT;
  ALTER TABLE stock_doc_lines ADD COLUMN unit_factor_milli INTEGER;
  ALTER TABLE stock_doc_lines ADD COLUMN unit_qty_milli INTEGER;
  ALTER TABLE stock_doc_lines ADD COLUMN batch_no TEXT;
  ALTER TABLE stock_doc_lines ADD COLUMN expiry TEXT;
  ALTER TABLE stock_doc_lines ADD COLUMN batch_id TEXT REFERENCES item_batches(id);
  ALTER TABLE stock_adjustment_lines ADD COLUMN unit TEXT;
  ALTER TABLE stock_adjustment_lines ADD COLUMN unit_factor_milli INTEGER;
  ALTER TABLE stock_adjustment_lines ADD COLUMN unit_qty_milli INTEGER;
  ALTER TABLE stock_adjustment_lines ADD COLUMN batch_no TEXT;
  ALTER TABLE stock_adjustment_lines ADD COLUMN expiry TEXT;
  ALTER TABLE stock_adjustment_lines ADD COLUMN batch_id TEXT REFERENCES item_batches(id);
  ALTER TABLE purchase_order_lines ADD COLUMN unit TEXT;
  ALTER TABLE purchase_order_lines ADD COLUMN unit_factor_milli INTEGER;
  ALTER TABLE purchase_order_lines ADD COLUMN unit_qty_milli INTEGER;

  -- every batch quantity change, beside stock_moves (which keeps the value); never edited or deleted
  CREATE TABLE stock_batch_moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL REFERENCES item_batches(id),
    item_id TEXT NOT NULL REFERENCES items(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    date TEXT NOT NULL,
    qty_milli INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    line_no INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX stock_batch_moves_batch ON stock_batch_moves(batch_id, warehouse_id);
  CREATE INDEX stock_batch_moves_item ON stock_batch_moves(item_id, warehouse_id);
  CREATE INDEX stock_batch_moves_source ON stock_batch_moves(source_type, source_id);
  CREATE TRIGGER stock_batch_moves_no_update BEFORE UPDATE ON stock_batch_moves BEGIN SELECT RAISE(ABORT, 'stock_moves_are_permanent'); END;
  CREATE TRIGGER stock_batch_moves_no_delete BEFORE DELETE ON stock_batch_moves BEGIN SELECT RAISE(ABORT, 'stock_moves_are_permanent'); END;

  -- money taken for an invoice outside its own cash/credit: POS split payments (in the sale's own entry) and online
  -- payments recorded through the website API (a receipt voucher of their own)
  CREATE TABLE invoice_payments (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    kind TEXT NOT NULL CHECK (kind IN ('pos', 'online')),
    method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'fib', 'zaincash', 'qi', 'account', 'other')),
    account_code TEXT NOT NULL REFERENCES accounts(code),
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
    entry_id TEXT REFERENCES entries(id),
    source TEXT,
    reference TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (source, reference)
  );
  CREATE INDEX invoice_payments_invoice ON invoice_payments(invoice_id);

  -- the content hash of an item's picture, so a shop knows when it changed (filled in for old pictures at start-up)
  ALTER TABLE item_images ADD COLUMN sha256 TEXT;

  -- pharmacy (Pro)
  CREATE TABLE pharma_details (
    item_id TEXT PRIMARY KEY REFERENCES items(id),
    generic_name TEXT NOT NULL DEFAULT '',
    -- generic_name through normalizeForSearch: alternatives and search
    generic_key TEXT NOT NULL DEFAULT '',
    form TEXT NOT NULL DEFAULT 'other' CHECK (form IN ('tablet', 'capsule', 'syrup', 'suspension', 'injection', 'drops', 'cream', 'ointment', 'inhaler', 'suppository', 'sachet', 'spray', 'other')),
    strength TEXT NOT NULL DEFAULT '',
    manufacturer TEXT NOT NULL DEFAULT '',
    rx_only INTEGER NOT NULL DEFAULT 0,
    controlled INTEGER NOT NULL DEFAULT 0,
    shelf TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
  CREATE INDEX pharma_details_generic ON pharma_details(generic_key);
  CREATE TABLE pharma_controlled_log (
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    line_no INTEGER NOT NULL,
    patient TEXT NOT NULL,
    prescriber TEXT NOT NULL DEFAULT '',
    prescription_no TEXT NOT NULL DEFAULT '',
    notes TEXT,
    recorded_by TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (invoice_id, line_no)
  );
  `;

const V11 =
  // 11 — 1.1: subcategories (a category's parent; two levels only, which the app checks) and brands. The car-parts
  // brand, typed as text on each part card, moves into the brand list (movePartBrands below): from now on an item's
  // brand is items.brand_id, and part_details.brand stays empty
  `
  CREATE TABLE brands (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE,
    -- as written (a trade name is the same in every language), with an Arabic and a Kurdish spelling when it has one
    name TEXT NOT NULL,
    -- the name without case, spaces or letter forms (brandKey in @qasa/core): one brand per name
    name_key TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL DEFAULT '',
    name_ku TEXT NOT NULL DEFAULT '',
    -- the country of origin, an ISO 3166 two-letter code
    country TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ALTER TABLE item_categories ADD COLUMN parent_id TEXT REFERENCES item_categories(id);
  -- the low-stock level for the category's items that have none of their own (thousandths of each item's base unit)
  ALTER TABLE item_categories ADD COLUMN reorder_milli INTEGER CHECK (reorder_milli IS NULL OR reorder_milli >= 0);
  CREATE INDEX item_categories_parent ON item_categories(parent_id);
  ALTER TABLE items ADD COLUMN brand_id TEXT REFERENCES brands(id);
  -- reorder when stock falls to this (thousandths); NULL: the category's level, or none. Car parts kept theirs in
  -- part_details.reorder_milli, which moves here (movePartBrands below) and stays empty from then on
  ALTER TABLE items ADD COLUMN reorder_milli INTEGER CHECK (reorder_milli IS NULL OR reorder_milli >= 0);
  CREATE INDEX items_brand ON items(brand_id);
  -- a count limited to some categories (their subcategories with them) and brands: JSON {categoryIds, brandIds}; NULL: every item
  ALTER TABLE stock_counts ADD COLUMN scope TEXT;
  `;

/**
 * Version 11's rows: each car part's brand text becomes a brand (one per name whatever its case or spaces, written as
 * most parts had it) and the item points at it. Safe to run again: only texts still there are moved.
 */
export function movePartBrands(db: Db): void {
  const rows = db.prepare('SELECT item_id, brand FROM part_details WHERE brand IS NOT NULL ORDER BY item_id').all() as { item_id: string; brand: string }[];
  if (!rows.length) return;
  const tidy = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  const groups = new Map<string, { items: string[]; spellings: Map<string, number> }>();
  for (const r of rows) {
    const text = tidy(String(r.brand));
    const key = brandKey(text);
    if (!key) continue;
    const g = groups.get(key) ?? { items: [], spellings: new Map<string, number>() };
    g.items.push(r.item_id);
    g.spellings.set(text, (g.spellings.get(text) ?? 0) + 1);
    groups.set(key, g);
  }
  const existing = new Map((db.prepare('SELECT id, name_key FROM brands').all() as { id: string; name_key: string }[]).map((b) => [b.name_key, b.id]));
  let sort = Number((db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM brands').get() as { s: number }).s);
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO brands (id, code, name, name_key, name_ar, name_ku, country, sort, active, created_at, updated_at)
                             VALUES (?, NULL, ?, ?, '', '', NULL, ?, 1, ?, ?)`);
  const point = db.prepare('UPDATE items SET brand_id = ? WHERE id = ? AND brand_id IS NULL');
  // in name order, so the new brands' order follows the alphabet
  for (const key of [...groups.keys()].sort()) {
    const g = groups.get(key)!;
    let id = existing.get(key);
    if (!id) {
      // the spelling most parts used; on a tie the first part's (sort keeps the order of equals)
      const name = [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      id = randomUUID();
      sort += 10;
      insert.run(id, name, key, sort, now, now);
      existing.set(key, id);
    }
    for (const item of g.items) point.run(id, item);
  }
  db.prepare('UPDATE part_details SET brand = NULL WHERE brand IS NOT NULL').run();
}

/** Version 11's other rows: each car part's reorder level becomes its item's (one kept already wins). Safe to run again. */
export function movePartReorder(db: Db): void {
  db.prepare(`UPDATE items SET reorder_milli = (SELECT d.reorder_milli FROM part_details d WHERE d.item_id = items.id)
               WHERE reorder_milli IS NULL AND id IN (SELECT item_id FROM part_details WHERE reorder_milli IS NOT NULL)`).run();
  db.prepare('UPDATE part_details SET reorder_milli = NULL WHERE reorder_milli IS NOT NULL').run();
}

const V12_OWNER_TOOLS =
  // 12 — owner tools (1.2): the language a customer gets their WhatsApp messages in (NULL: the app's language)
  `
  ALTER TABLE parties ADD COLUMN lang TEXT CHECK (lang IS NULL OR lang IN ('ar', 'en', 'ku'));
  `;

/** Version 12: each feature's own block, one after the other. */
const V12 = V12_OWNER_TOOLS;

const MIGRATIONS: Migration[] = [
  { sql: V1 }, { sql: V2, rebuild: true }, { sql: V3, rebuild: true }, { sql: V4 }, { sql: V5, rebuild: true },
  { sql: V6, mysql: 'tables' }, { sql: V7, mysql: 'tables' }, { sql: V8, mysql: 'tables' }, { sql: V9, mysql: 'tables' },
  { sql: V10, mysql: { tables: true, steps: () => V10_MYSQL_STEPS } },
  { sql: V11, mysql: { tables: true, steps: () => V11_MYSQL_STEPS }, data: (db) => { movePartBrands(db); movePartReorder(db); } },
  { sql: V12, mysql: { tables: true, steps: () => V12_MYSQL_STEPS } }
];

/** Server databases began at this version: its schema is in schema-mysql.ts (tables and triggers without `since`). */
const MYSQL_BASE_VERSION = 5;

/** The schema version this build writes. */
export const SCHEMA_VERSION = MIGRATIONS.length;

export function openDatabase(file: string, options: { now?: () => Date } = {}): Db {
  if (file !== ':memory:') refuseNewerFile(file);
  const db: Db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    if (file !== ':memory:') {
      // WAL + FULL sync: a committed voucher survives a power cut (generator switch-over).
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = FULL');
      copyBeforeUpdate(db, file, options.now?.() ?? new Date());
    }
    initDatabase(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/** How many copies made before a schema update are kept next to each company file (the newest). */
export const UPDATE_COPIES_KEPT = 3;

/** The copies made before a schema update of `file`, newest first (their names sort by time). */
export function updateCopies(file: string): string[] {
  const dir = dirname(file);
  const pattern = updateCopyName(file);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => pattern.test(n)).sort((a, b) => updateCopyStamp(b, pattern).localeCompare(updateCopyStamp(a, pattern)) || b.localeCompare(a)).map((n) => join(dir, n));
}

/** <company file name>-before-update-v<old version>-<YYYYMMDD-HHMMSS>[-n].sqlite, beside the company file. */
function updateCopyName(file: string): RegExp {
  const stem = basename(file).replace(/\.sqlite$/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${stem}-before-update-v(\\d{1,4})-(\\d{8}-\\d{6})(?:-\\d{1,3})?\\.sqlite$`);
}

function updateCopyStamp(name: string, pattern: RegExp): string {
  return pattern.exec(name)?.[2] ?? '';
}

/**
 * Before this version changes the schema of an existing company file, a consistent copy of it as it is (SQLite's
 * VACUUM INTO, so work still in the write-ahead log is in it) goes beside it, and only the newest
 * UPDATE_COPIES_KEPT are kept. A new file (no schema yet) and a file already up to date are left alone. When the copy
 * can't be made (a full disk) the schema is not changed: the file opens on a later try, never updated without a copy.
 * That failure is its own error (update_copy_failed), so the app never takes the file for a damaged one.
 */
function copyBeforeUpdate(db: Db, file: string, now: Date): string | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").get()) return null;
  const version = schemaVersion(db);
  if (version === 0 || version >= MIGRATIONS.length) return null;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const stem = `${basename(file).replace(/\.sqlite$/i, '')}-before-update-v${version}-${stamp}`;
  let target = join(dirname(file), `${stem}.sqlite`);
  for (let i = 2; existsSync(target); i += 1) target = join(dirname(file), `${stem}-${i}.sqlite`);
  const part = `${target}.part`;
  try {
    rmSync(part, { force: true });
    db.exec(`VACUUM INTO '${part.replace(/'/g, "''")}'`);
    renameSync(part, target);
  } catch (error) {
    // a part left in the way (even a folder) must not hide why the copy failed
    try { rmSync(part, { force: true }); } catch { /* left for next time */ }
    // the file itself is fine: it is not damaged, there was only no room (or no access) for its copy
    throw new AppError(507, 'update_copy_failed', { reason: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
  }
  // only this company file's own copies are ever removed, the oldest first
  for (const old of updateCopies(file).slice(UPDATE_COPIES_KEPT)) {
    try {
      unlinkSync(old);
    } catch { /* a copy in use stays until next time */ }
  }
  return target;
}

/** Brings any database (a file, or the in-browser demo) to the current schema and fills in the defaults. */
export function initDatabase(db: Db): void {
  migrate(db);
  ensureDefaults(db);
  fillImageHashes(db);
}

export function schemaVersion(db: Db): number {
  return (db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined)?.version ?? 0;
}

/**
 * Books a newer Qasa ERP has already upgraded (the Microsoft Store version can be a release behind the installer, and
 * both use the same data folder): this version doesn't know their tables or rules, so it changes nothing and says so.
 */
function refuseNewer(version: number, app = MIGRATIONS.length): void {
  if (version > app) throw new AppError(409, 'database_newer', { version, app });
}

/**
 * Looks at an existing company file read-only before it is opened for writing. Closing a writable connection would
 * checkpoint changes a newer version left in the write-ahead log (after a crash) into the file; a read-only one reads
 * them but never checkpoints, so refused books stay exactly as they were, -wal file included.
 */
function refuseNewerFile(file: string): void {
  let probe: DatabaseSync;
  try {
    probe = new DatabaseSync(file, { readOnly: true });
  } catch {
    return; // no file yet: a new company
  }
  try {
    if (probe.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").get()) refuseNewer(schemaVersion(probe));
  } catch (error) {
    if (error instanceof AppError) throw error;
    // anything else (a damaged file, a lock): the normal open below decides, as it always did
  } finally {
    probe.close();
  }
}

/** Applies pending migrations, optionally stopping at `target` (used by the upgrade test). */
export function migrate(db: Db, target = MIGRATIONS.length): void {
  if (isMysql(db)) return migrateMysql(db);
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  if (!db.prepare('SELECT version FROM schema_version').get()) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  let version = schemaVersion(db);
  // (a target below the current version is what an older app would do: the upgrade test asks for that)
  refuseNewer(version, Math.min(target, MIGRATIONS.length));
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
          migration.data?.(db);
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
        migration.data?.(db);
        db.prepare('UPDATE schema_version SET version = ?').run(next);
      });
    }
    version = next;
  }
}

/** Tables of a Qasa company (every table but schema_version), in the order their foreign keys allow filling them. */
export const COMPANY_TABLES: readonly string[] = MYSQL_TABLES.map((t) => t.name);

/**
 * A server database starts empty and gets the whole current schema at once; later versions bring their own server
 * SQL. The server commits each CREATE on its own, so the version is written last: a half-made schema is refused
 * next time (database_not_empty) instead of being taken for a company.
 */
function migrateMysql(db: Db, options: { triggers?: boolean } = {}): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INT NOT NULL PRIMARY KEY)');
  let version = schemaVersion(db);
  refuseNewer(version);
  if (version === 0) {
    if (mysqlCompanyTables(db).length) throw new Error('database_not_empty');
    createMysqlSchema(db, options);
    db.prepare('DELETE FROM schema_version').run();
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(MIGRATIONS.length);
    return;
  }
  if (version < MYSQL_BASE_VERSION) throw new Error(`A server database can't be at version ${version}`);
  const collations = mysqlCollations(String((db.prepare('SELECT VERSION() AS v').get() as { v: string }).v));
  while (version < MIGRATIONS.length) {
    const next = version + 1;
    const mysql = MIGRATIONS[version]!.mysql;
    if (!mysql) throw new Error(`Migration ${next} has no MariaDB/MySQL version`);
    if (mysql === 'tables') {
      createSinceObjects(db, next, collations);
    } else if (typeof mysql === 'object') {
      // new tables first (the new columns point at them), then each column and foreign key not there yet
      createSinceObjects(db, next, collations);
      for (const step of pendingMysqlSteps(mysql.steps(collations), mysqlSchemaState(db))) db.exec(step);
    } else {
      for (const step of mysql(collations)) db.exec(step);
    }
    const data = MIGRATIONS[version]!.data;
    if (data) transaction(db, () => data(db));
    version = next;
    db.prepare('UPDATE schema_version SET version = ?').run(version);
  }
}

/**
 * The tables and triggers schema-mysql.ts marks `since` a version. The server commits each CREATE on its own: after an
 * upgrade cut off half way (a dropped connection), the next start finds some of them made already and makes only the
 * rest, instead of failing on "already exists" for good.
 *
 * A table is made as the current schema has it, so an old database (version 6 to 9) may get a table whose key points
 * at a table of a later version (stock_adjustment_lines.batch_id → item_batches, made at 10): the server refuses that
 * (errno 150) unless foreign key checks are off for that one CREATE. The later version then makes the table it points
 * at, and its step for that key finds the key there already.
 */
function createSinceObjects(db: Db, version: number, collations: MysqlCollations): void {
  const tables = new Set((db.prepare('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()').all() as { name: string }[]).map((t) => t.name));
  const triggers = new Set((db.prepare('SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = DATABASE()').all() as { name: string }[]).map((t) => t.name));
  for (const table of MYSQL_TABLES.filter((t) => t.since === version && !tables.has(t.name))) {
    const parents = [...table.sql.matchAll(/REFERENCES (\w+)\(/g)].map((m) => m[1]!);
    const ahead = parents.some((p) => p !== table.name && !tables.has(p));
    if (ahead) db.exec('SET FOREIGN_KEY_CHECKS = 0');
    try {
      db.exec(mysqlTableSql(table.sql, collations));
    } finally {
      if (ahead) db.exec('SET FOREIGN_KEY_CHECKS = 1');
    }
    tables.add(table.name);
  }
  for (const trigger of MYSQL_TRIGGERS.filter((t) => t.since === version && !triggers.has(t.name))) db.exec(trigger.sql);
}

/** The columns and foreign keys a server database has, for the migration steps to skip what is done. */
function mysqlSchemaState(db: Db): { columns: Set<string>; foreignKeys: Set<string> } {
  const columns = new Set((db.prepare('SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE()').all() as { t: string; c: string }[])
    .map((r) => `${r.t}.${r.c}`));
  const foreignKeys = new Set((db.prepare(`SELECT table_name AS t, column_name AS c, referenced_table_name AS p FROM information_schema.key_column_usage
                                           WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL`).all() as { t: string; c: string; p: string }[])
    .map((r) => `${r.t}.${r.c}>${r.p}`));
  return { columns, foreignKeys };
}

/** The company tables already in a server database (a Qasa company, or something else that must not be touched). */
export function mysqlCompanyTables(db: Db): string[] {
  const names = db.prepare('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()').all() as { name: string }[];
  const ours = new Set(COMPANY_TABLES);
  return names.map((t) => t.name).filter((n) => ours.has(n));
}

/** Makes the tables of an empty server database, with or without the triggers (a copy adds them after the rows, see db-copy.ts). */
export function createMysqlSchema(db: Db, options: { triggers?: boolean } = {}): void {
  const version = String((db.prepare('SELECT VERSION() AS v').get() as { v: string }).v);
  const collations = mysqlCollations(version);
  for (const table of MYSQL_TABLES) db.exec(mysqlTableSql(table.sql, collations));
  if (options.triggers !== false) createMysqlTriggers(db);
}

export function createMysqlTriggers(db: Db): void {
  for (const trigger of MYSQL_TRIGGERS) db.exec(trigger.sql);
}

/** Starts a server database with the tables only (no rows, no triggers), ready for copyCompany. */
export function prepareMysqlForCopy(db: Db): void {
  migrateMysql(db, { triggers: false });
}

/** An INSERT that leaves an existing row with the same key alone. Any other error (a missing account, a bad value) still fails. */
export function insertOrKeep(db: Db, table: string, columns: readonly string[], key: string): DbStatement {
  const cols = columns.map(quoteId).join(', ');
  const marks = columns.map(() => '?').join(', ');
  return db.prepare(isMysql(db)
    ? `INSERT INTO ${table} (${cols}) VALUES (${marks}) ON DUPLICATE KEY UPDATE ${quoteId(key)} = ${quoteId(key)}`
    : `INSERT INTO ${table} (${cols}) VALUES (${marks}) ON CONFLICT (${quoteId(key)}) DO NOTHING`);
}

/** A column name that may be a reserved word ("key", "system"): double quotes mean a name in SQLite and in the server session (ANSI_QUOTES). */
export const quoteId = (name: string): string => `"${name}"`;

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
  const insertAccount = db.prepare('INSERT INTO accounts (code, name_ar, name_en, name_ku, "system", created_at) VALUES (?, ?, ?, ?, ?, ?)');
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

    const setting = insertOrKeep(db, 'settings', ['key', 'value'], 'key');
    setting.run('company_name', JSON.stringify({ ar: '', en: '', ku: '' }));
    setting.run('default_rate_x100', '142000');
    setting.run('fiscal_year_start', '01-01');
    const postable = (code: string, fallback: string) => (accountExists(db, code) && !hasChildren(db, code) ? code : fallback);
    setting.run('posting_accounts', JSON.stringify({
      customers: postable(DEFAULT_POSTING_ACCOUNTS.customers, '161'),
      suppliers: postable(DEFAULT_POSTING_ACCOUNTS.suppliers, '261'),
      sales: DEFAULT_POSTING_ACCOUNTS.sales,
      costOfSales: DEFAULT_POSTING_ACCOUNTS.costOfSales,
      cash: postable(DEFAULT_POSTING_ACCOUNTS.cash, '181'),
      yearResult: postable(DEFAULT_POSTING_ACCOUNTS.yearResult, '22')
    }));

    // the owner: the one user a company starts with; the app opens as this user until sign-in is switched on
    if ((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 0) {
      db.prepare("INSERT INTO users (id, username, name, password_hash, roles, active, created_at) VALUES (?, 'admin', 'Admin', NULL, '[\"admin\"]', 1, ?)")
        .run(randomUUID(), now);
    }

    // 1.1: batches and expiry dates (Settings → Stock)
    setting.run('near_expiry_days', '90');
    setting.run('expired_sales', 'block');
    setting.run('default_track_expiry', '0');

    const warehouses = (db.prepare('SELECT COUNT(*) AS n FROM warehouses').get() as { n: number }).n;
    if (warehouses === 0) {
      const account = accountExists(db, '1371') && !hasChildren(db, '1371') ? '1371' : '137';
      db.prepare('INSERT INTO warehouses (id, code, name_ar, name_en, name_ku, account_code, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
        .run(randomUUID(), 'MAIN', 'المخزن الرئيسي', 'Main warehouse', 'کۆگای سەرەکی', account, now);
    }
  });
}

/** Pictures hashed per start-up, so a large picture table never holds the start up for long. */
export const IMAGE_HASHES_PER_START = 50;

/** The SHA-256 (hex) of a picture, or null where hashing is not available (the website demo). */
export function imageSha256(data: Uint8Array): string | null {
  try {
    return createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Fills in the content hash of pictures saved before 1.1 (a shop sees when a picture changed by it), a few each start.
 * Returns how many it filled.
 */
export function fillImageHashes(db: Db, limit = IMAGE_HASHES_PER_START): number {
  const rows = db.prepare('SELECT item_id, data FROM item_images WHERE sha256 IS NULL ORDER BY item_id LIMIT ?').all(limit) as { item_id: string; data: Uint8Array }[];
  if (!rows.length) return 0;
  let filled = 0;
  transaction(db, () => {
    const set = db.prepare('UPDATE item_images SET sha256 = ? WHERE item_id = ? AND sha256 IS NULL');
    for (const r of rows) {
      const hash = imageSha256(r.data);
      if (!hash) return;
      set.run(hash, r.item_id);
      filled += 1;
    }
  });
  return filled;
}

let depth = 0;

/** Runs `fn` in a transaction. Nested calls join the outer transaction. */
export function transaction<T>(db: Db, fn: () => T): T {
  if (depth > 0) return fn();
  db.exec(isMysql(db) ? 'START TRANSACTION' : 'BEGIN IMMEDIATE');
  depth += 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // a lost server connection has rolled back already; the error that stopped the work is the one to report
    }
    throw error;
  } finally {
    depth -= 1;
  }
}

/** Returns the next number of a named counter (1, 2, 3 …). Call inside a transaction. */
export function nextSequence(db: Db, key: string): number {
  const row = db.prepare('SELECT next FROM sequences WHERE "key" = ?').get(key) as { next: number } | undefined;
  const seq = row?.next ?? 1;
  if (row) db.prepare('UPDATE sequences SET next = ? WHERE "key" = ?').run(seq + 1, key);
  else db.prepare('INSERT INTO sequences ("key", next) VALUES (?, ?)').run(key, seq + 1);
  return seq;
}
