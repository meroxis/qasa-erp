import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_POSTING_ACCOUNTS, IRAQI_UNIFIED_CHART, STARTER_SUB_ACCOUNTS } from '@qasa/core';
import { AppError } from './errors.ts';
import { MYSQL_TABLES, MYSQL_TRIGGERS, mysqlCollations, mysqlTableSql, type MysqlCollations } from './schema-mysql.ts';

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
   * tables and triggers schema-mysql.ts marks `since` this version, else its own statements, one each.
   */
  mysql?: 'tables' | ((collations: MysqlCollations) => readonly string[]);
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

const MIGRATIONS: Migration[] = [
  { sql: V1 }, { sql: V2, rebuild: true }, { sql: V3, rebuild: true }, { sql: V4 }, { sql: V5, rebuild: true },
  { sql: V6, mysql: 'tables' }, { sql: V7, mysql: 'tables' }
];

/** Server databases began at this version: its schema is in schema-mysql.ts (tables and triggers without `since`). */
const MYSQL_BASE_VERSION = 5;

/** The schema version this build writes. */
export const SCHEMA_VERSION = MIGRATIONS.length;

export function openDatabase(file: string): Db {
  if (file !== ':memory:') refuseNewerFile(file);
  const db: Db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    if (file !== ':memory:') {
      // WAL + FULL sync: a committed voucher survives a power cut (generator switch-over).
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = FULL');
    }
    initDatabase(db);
  } catch (error) {
    db.close();
    throw error;
  }
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

/**
 * Books a newer Qasa ERP has already upgraded (the Microsoft Store version can be a release behind the installer, and
 * both use the same data folder): this version doesn't know their tables or rules, so it changes nothing and says so.
 */
function refuseNewer(version: number): void {
  if (version > MIGRATIONS.length) throw new AppError(409, 'database_newer', { version, app: MIGRATIONS.length });
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
  refuseNewer(version);
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
      for (const table of MYSQL_TABLES.filter((t) => t.since === next)) db.exec(mysqlTableSql(table.sql, collations));
      for (const trigger of MYSQL_TRIGGERS.filter((t) => t.since === next)) db.exec(trigger.sql);
    } else {
      for (const step of mysql(collations)) db.exec(step);
    }
    version = next;
    db.prepare('UPDATE schema_version SET version = ?').run(version);
  }
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
