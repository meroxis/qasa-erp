/**
 * The company database on a MariaDB or MySQL server: the same tables, columns and rules as the SQLite schema in
 * db.ts, at the current schema version. The SQLite schema grew by migrations; a server database starts at the current
 * version. A table or trigger added later says since which version (`since`), so a server database at an older
 * version gets just those (a migration's `mysql: 'tables'`); other changes bring their own server SQL. schema.test.ts
 * checks that both keep the same tables, columns and triggers.
 *
 * Differences from SQLite, each keeping SQLite's behaviour:
 * - text is compared byte for byte (a binary, no-pad collation), as SQLite does; user names ignore case (NOCASE);
 * - the session runs with ANSI_QUOTES and PIPES_AS_CONCAT, so "key" and 'a' || 'b' mean what they mean in SQLite;
 * - foreign keys are table clauses (the server ignores column REFERENCES), and a trigger's WHEN becomes an IF
 *   that SIGNALs the same message RAISE(ABORT) gives, so errorResponse maps both alike.
 */

const ID = 'VARCHAR(191)';
const WHEN = 'VARCHAR(40)';
const WORD = 'VARCHAR(32)';

/** Collations: byte-for-byte text as in SQLite, and a case-insensitive one for user names. */
export interface MysqlCollations { bin: string; ci: string }

/** MariaDB and MySQL name their no-pad (trailing spaces count, as in SQLite) collations differently. */
export function mysqlCollations(serverVersion: string): MysqlCollations {
  return /mariadb/i.test(serverVersion)
    ? { bin: 'utf8mb4_nopad_bin', ci: 'utf8mb4_general_nopad_ci' }
    : { bin: 'utf8mb4_0900_bin', ci: 'utf8mb4_0900_ai_ci' };
}

/** The tables in an order where each one's foreign keys point at tables made before it. */
/** Tables and triggers without `since` are those of version 5, when server databases began. */
export interface MysqlObject { name: string; sql: string; since?: number }

export const MYSQL_TABLES: readonly MysqlObject[] = [
  {
    name: 'settings',
    sql: `CREATE TABLE settings (
      "key" ${ID} NOT NULL PRIMARY KEY,
      value MEDIUMTEXT NOT NULL
    )`
  },
  {
    name: 'accounts',
    sql: `CREATE TABLE accounts (
      code ${ID} NOT NULL PRIMARY KEY,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ku TEXT NOT NULL,
      "system" INT NOT NULL DEFAULT 0,
      created_at ${WHEN} NOT NULL,
      CHECK (code REGEXP '^[1-4][0-9]*$')
    )`
  },
  {
    name: 'users',
    sql: `CREATE TABLE users (
      id ${ID} NOT NULL PRIMARY KEY,
      username VARCHAR(64) COLLATE {ci} NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT,
      roles TEXT NOT NULL,
      active INT NOT NULL DEFAULT 1,
      created_at ${WHEN} NOT NULL,
      last_login_at ${WHEN}
    )`
  },
  {
    name: 'sessions',
    sql: `CREATE TABLE sessions (
      token_hash ${ID} NOT NULL PRIMARY KEY,
      user_id ${ID} NOT NULL,
      created_at ${WHEN} NOT NULL,
      last_seen_at ${WHEN} NOT NULL,
      expires_at ${WHEN} NOT NULL,
      device TEXT,
      INDEX sessions_user (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  },
  {
    name: 'parties',
    sql: `CREATE TABLE parties (
      id ${ID} NOT NULL PRIMARY KEY,
      type ${WORD} NOT NULL CHECK (type IN ('customer', 'supplier')),
      code ${ID} NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      account_code ${ID} NOT NULL,
      credit_limit BIGINT CHECK (credit_limit IS NULL OR credit_limit >= 0),
      notes TEXT,
      active INT NOT NULL DEFAULT 1,
      created_at ${WHEN} NOT NULL,
      FOREIGN KEY (account_code) REFERENCES accounts(code)
    )`
  },
  {
    name: 'warehouses',
    sql: `CREATE TABLE warehouses (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${ID} NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ku TEXT NOT NULL,
      account_code ${ID} NOT NULL,
      active INT NOT NULL DEFAULT 1,
      created_at ${WHEN} NOT NULL,
      FOREIGN KEY (account_code) REFERENCES accounts(code)
    )`
  },
  {
    // SQLite's barcode index skips NULL and ''; the app stores no barcode as NULL, which a UNIQUE key allows many of
    name: 'items',
    sql: `CREATE TABLE items (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${ID} NOT NULL UNIQUE,
      barcode ${ID},
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ku TEXT NOT NULL,
      unit ${WORD} NOT NULL,
      sale_price BIGINT NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
      sale_currency ${WORD} NOT NULL CHECK (sale_currency IN ('IQD', 'USD')),
      track_stock INT NOT NULL DEFAULT 1,
      active INT NOT NULL DEFAULT 1,
      created_at ${WHEN} NOT NULL,
      UNIQUE KEY items_barcode (barcode)
    )`
  },
  {
    name: 'entries',
    sql: `CREATE TABLE entries (
      id ${ID} NOT NULL PRIMARY KEY,
      type ${WORD} NOT NULL CHECK (type IN ('journal', 'receipt', 'payment', 'reversal', 'sale', 'purchase', 'sale_return', 'purchase_return', 'opening_stock', 'transfer', 'closing')),
      number ${ID} UNIQUE,
      date ${WHEN} NOT NULL,
      description TEXT NOT NULL,
      party TEXT,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      rate_x100 BIGINT NOT NULL CHECK (rate_x100 > 0),
      status ${WORD} NOT NULL CHECK (status IN ('draft', 'checked', 'approved')),
      cash_account ${ID},
      reverses_id ${ID},
      reversed_by_id ${ID},
      prepared_by TEXT NOT NULL,
      prepared_at ${WHEN} NOT NULL,
      checked_by TEXT,
      checked_at ${WHEN},
      approved_by TEXT,
      approved_at ${WHEN},
      updated_at ${WHEN} NOT NULL,
      prepared_by_id ${ID},
      checked_by_id ${ID},
      INDEX entries_date (date),
      INDEX entries_status (status),
      FOREIGN KEY (cash_account) REFERENCES accounts(code),
      FOREIGN KEY (reverses_id) REFERENCES entries(id),
      FOREIGN KEY (reversed_by_id) REFERENCES entries(id),
      FOREIGN KEY (prepared_by_id) REFERENCES users(id),
      FOREIGN KEY (checked_by_id) REFERENCES users(id)
    )`
  },
  {
    name: 'entry_lines',
    sql: `CREATE TABLE entry_lines (
      entry_id ${ID} NOT NULL,
      line_no INT NOT NULL,
      account_code ${ID} NOT NULL,
      debit BIGINT NOT NULL CHECK (debit >= 0),
      credit BIGINT NOT NULL CHECK (credit >= 0),
      base_debit BIGINT NOT NULL CHECK (base_debit >= 0),
      base_credit BIGINT NOT NULL CHECK (base_credit >= 0),
      description TEXT,
      party_id ${ID},
      PRIMARY KEY (entry_id, line_no),
      INDEX entry_lines_account (account_code),
      INDEX entry_lines_party (party_id),
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
      FOREIGN KEY (account_code) REFERENCES accounts(code),
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )`
  },
  {
    name: 'sequences',
    sql: `CREATE TABLE sequences (
      "key" ${ID} NOT NULL PRIMARY KEY,
      next BIGINT NOT NULL
    )`
  },
  {
    name: 'locked_periods',
    sql: `CREATE TABLE locked_periods (
      period ${ID} NOT NULL PRIMARY KEY,
      locked_by TEXT NOT NULL,
      locked_at ${WHEN} NOT NULL
    )`
  },
  {
    name: 'audit_log',
    sql: `CREATE TABLE audit_log (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      at ${WHEN} NOT NULL,
      user TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      details MEDIUMTEXT
    )`
  },
  {
    name: 'invoices',
    sql: `CREATE TABLE invoices (
      id ${ID} NOT NULL PRIMARY KEY,
      kind ${WORD} NOT NULL CHECK (kind IN ('sale', 'purchase', 'sale_return', 'purchase_return')),
      status ${WORD} NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
      number ${ID} UNIQUE,
      date ${WHEN} NOT NULL,
      party_id ${ID},
      warehouse_id ${ID} NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      rate_x100 BIGINT NOT NULL CHECK (rate_x100 > 0),
      payment ${WORD} NOT NULL CHECK (payment IN ('cash', 'credit')),
      cash_account ${ID},
      discount BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
      subtotal BIGINT NOT NULL,
      total BIGINT NOT NULL,
      notes TEXT,
      return_of ${ID},
      entry_id ${ID},
      cancel_entry_id ${ID},
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      posted_by TEXT,
      posted_at ${WHEN},
      cancelled_by TEXT,
      cancelled_at ${WHEN},
      updated_at ${WHEN} NOT NULL,
      CHECK ((kind IN ('sale_return', 'purchase_return')) = (return_of IS NOT NULL)),
      INDEX invoices_date (date),
      INDEX invoices_return_of (return_of),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (cash_account) REFERENCES accounts(code),
      FOREIGN KEY (return_of) REFERENCES invoices(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (cancel_entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'invoice_lines',
    sql: `CREATE TABLE invoice_lines (
      invoice_id ${ID} NOT NULL,
      line_no INT NOT NULL,
      item_id ${ID} NOT NULL,
      description TEXT,
      qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
      unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
      amount BIGINT NOT NULL,
      cost BIGINT,
      source_line INT,
      discount_share BIGINT,
      PRIMARY KEY (invoice_id, line_no),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'stock_moves',
    sql: `CREATE TABLE stock_moves (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      item_id ${ID} NOT NULL,
      warehouse_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      qty_milli BIGINT NOT NULL,
      value BIGINT NOT NULL,
      source_type ${WORD} NOT NULL,
      source_id ${ID},
      created_at ${WHEN} NOT NULL,
      INDEX stock_moves_item (item_id, warehouse_id),
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    )`
  },
  {
    name: 'stock_docs',
    sql: `CREATE TABLE stock_docs (
      id ${ID} NOT NULL PRIMARY KEY,
      kind ${WORD} NOT NULL CHECK (kind IN ('opening', 'transfer')),
      status ${WORD} NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
      number ${ID} UNIQUE,
      date ${WHEN} NOT NULL,
      warehouse_id ${ID} NOT NULL,
      to_warehouse_id ${ID},
      counter_account ${ID},
      notes TEXT,
      total_value BIGINT NOT NULL DEFAULT 0,
      entry_id ${ID},
      cancel_entry_id ${ID},
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      posted_by TEXT,
      posted_at ${WHEN},
      cancelled_by TEXT,
      cancelled_at ${WHEN},
      updated_at ${WHEN} NOT NULL,
      CHECK (kind <> 'transfer' OR (to_warehouse_id IS NOT NULL AND to_warehouse_id <> warehouse_id)),
      INDEX stock_docs_date (date),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (counter_account) REFERENCES accounts(code),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (cancel_entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'stock_doc_lines',
    sql: `CREATE TABLE stock_doc_lines (
      doc_id ${ID} NOT NULL,
      line_no INT NOT NULL,
      item_id ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
      unit_cost BIGINT CHECK (unit_cost IS NULL OR unit_cost >= 0),
      value BIGINT,
      PRIMARY KEY (doc_id, line_no),
      FOREIGN KEY (doc_id) REFERENCES stock_docs(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'guarantors',
    since: 6,
    sql: `CREATE TABLE guarantors (
      id ${ID} NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      id_number TEXT,
      address TEXT,
      workplace TEXT,
      notes TEXT,
      created_at ${WHEN} NOT NULL
    )`
  },
  {
    name: 'installment_contracts',
    since: 6,
    sql: `CREATE TABLE installment_contracts (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      status ${WORD} NOT NULL CHECK (status IN ('active', 'cancelled')),
      date ${WHEN} NOT NULL,
      party_id ${ID} NOT NULL,
      guarantor_id ${ID},
      invoice_id ${ID},
      description TEXT NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      total BIGINT NOT NULL CHECK (total > 0),
      down_payment BIGINT NOT NULL DEFAULT 0,
      months INT NOT NULL CHECK (months BETWEEN 1 AND 120),
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      cancelled_by TEXT,
      cancelled_at ${WHEN},
      updated_at ${WHEN} NOT NULL,
      CHECK (down_payment >= 0 AND down_payment < total),
      INDEX installment_contracts_party (party_id),
      INDEX installment_contracts_invoice (invoice_id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (guarantor_id) REFERENCES guarantors(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    name: 'installment_schedule',
    since: 6,
    sql: `CREATE TABLE installment_schedule (
      contract_id ${ID} NOT NULL,
      seq INT NOT NULL CHECK (seq >= 0),
      due_date ${WHEN} NOT NULL,
      amount BIGINT NOT NULL CHECK (amount > 0),
      PRIMARY KEY (contract_id, seq),
      FOREIGN KEY (contract_id) REFERENCES installment_contracts(id)
    )`
  },
  {
    name: 'installment_receipts',
    since: 6,
    sql: `CREATE TABLE installment_receipts (
      contract_id ${ID} NOT NULL,
      entry_id ${ID} NOT NULL UNIQUE,
      amount BIGINT NOT NULL CHECK (amount > 0),
      created_at ${WHEN} NOT NULL,
      PRIMARY KEY (contract_id, entry_id),
      FOREIGN KEY (contract_id) REFERENCES installment_contracts(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id)
    )`
  }
];

const refuse = (message: string) => `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${message}'`;
const trigger = (name: string, timing: string, table: string, condition: string | null, message: string, since?: number): MysqlObject => ({
  name,
  ...(since ? { since } : {}),
  sql: `CREATE TRIGGER ${name} ${timing} ON ${table} FOR EACH ROW ` +
    (condition ? `BEGIN IF ${condition} THEN ${refuse(message)}; END IF; END` : `BEGIN ${refuse(message)}; END`)
});
/** SQLite's `a IS NOT b`: differs, NULLs included. */
const changed = (...columns: string[]) => columns.map((c) => `NOT (NEW.${c} <=> OLD.${c})`).join(' OR ');

/** The rules the database itself enforces: posted vouchers, invoices, stock documents and moves, and the audit log never change. */
export const MYSQL_TRIGGERS: readonly MysqlObject[] = [
  trigger('posted_lines_no_insert', 'BEFORE INSERT', 'entry_lines', `(SELECT status FROM entries WHERE id = NEW.entry_id) = 'approved'`, 'posted_entry_is_permanent'),
  trigger('posted_lines_no_update', 'BEFORE UPDATE', 'entry_lines', `(SELECT status FROM entries WHERE id = OLD.entry_id) = 'approved'`, 'posted_entry_is_permanent'),
  trigger('posted_lines_no_delete', 'BEFORE DELETE', 'entry_lines', `(SELECT status FROM entries WHERE id = OLD.entry_id) = 'approved'`, 'posted_entry_is_permanent'),
  trigger('posted_entries_no_delete', 'BEFORE DELETE', 'entries', `OLD.status = 'approved'`, 'posted_entry_is_permanent'),
  trigger('posted_entries_no_edit', 'BEFORE UPDATE', 'entries',
    `OLD.status = 'approved' AND (${changed('status', 'type', 'number', 'date', 'description', 'party', 'currency', 'rate_x100', 'cash_account', 'approved_by', 'approved_at')})`,
    'posted_entry_is_permanent'),
  trigger('audit_no_update', 'BEFORE UPDATE', 'audit_log', null, 'audit_log_is_append_only'),
  trigger('audit_no_delete', 'BEFORE DELETE', 'audit_log', null, 'audit_log_is_append_only'),
  trigger('stock_moves_no_update', 'BEFORE UPDATE', 'stock_moves', null, 'stock_moves_are_permanent'),
  trigger('stock_moves_no_delete', 'BEFORE DELETE', 'stock_moves', null, 'stock_moves_are_permanent'),
  trigger('posted_invoice_lines_no_insert', 'BEFORE INSERT', 'invoice_lines', `(SELECT status FROM invoices WHERE id = NEW.invoice_id) <> 'draft'`, 'posted_invoice_is_permanent'),
  trigger('posted_invoice_lines_no_update', 'BEFORE UPDATE', 'invoice_lines', `(SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'draft'`, 'posted_invoice_is_permanent'),
  trigger('posted_invoice_lines_no_delete', 'BEFORE DELETE', 'invoice_lines', `(SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'draft'`, 'posted_invoice_is_permanent'),
  trigger('posted_invoices_no_delete', 'BEFORE DELETE', 'invoices', `OLD.status <> 'draft'`, 'posted_invoice_is_permanent'),
  trigger('posted_invoices_no_edit', 'BEFORE UPDATE', 'invoices',
    `OLD.status = 'cancelled' OR (OLD.status = 'posted' AND (${changed('number', 'date', 'party_id', 'warehouse_id', 'currency', 'rate_x100', 'payment', 'cash_account', 'discount', 'subtotal', 'total', 'entry_id', 'return_of')} OR NEW.status NOT IN ('posted', 'cancelled')))`,
    'posted_invoice_is_permanent'),
  trigger('posted_stock_doc_lines_no_insert', 'BEFORE INSERT', 'stock_doc_lines', `(SELECT status FROM stock_docs WHERE id = NEW.doc_id) <> 'draft'`, 'posted_document_is_permanent'),
  trigger('posted_stock_doc_lines_no_update', 'BEFORE UPDATE', 'stock_doc_lines',
    `(SELECT status FROM stock_docs WHERE id = OLD.doc_id) <> 'draft' AND (${changed('item_id', 'qty_milli', 'unit_cost')} OR (OLD.value IS NOT NULL AND NOT (NEW.value <=> OLD.value)))`,
    'posted_document_is_permanent'),
  trigger('posted_stock_doc_lines_no_delete', 'BEFORE DELETE', 'stock_doc_lines', `(SELECT status FROM stock_docs WHERE id = OLD.doc_id) <> 'draft'`, 'posted_document_is_permanent'),
  trigger('posted_stock_docs_no_delete', 'BEFORE DELETE', 'stock_docs', `OLD.status <> 'draft'`, 'posted_document_is_permanent'),
  trigger('posted_stock_docs_no_edit', 'BEFORE UPDATE', 'stock_docs',
    `OLD.status = 'cancelled' OR (OLD.status = 'posted' AND (${changed('number', 'date', 'warehouse_id', 'to_warehouse_id', 'counter_account', 'total_value', 'entry_id')} OR NEW.status NOT IN ('posted', 'cancelled')))`,
    'posted_document_is_permanent'),
  // 6: a contract's terms, schedule and collections never change; a contract can only be cancelled (its collections stay)
  trigger('installment_contracts_no_delete', 'BEFORE DELETE', 'installment_contracts', null, 'installment_contract_is_permanent', 6),
  trigger('installment_contracts_no_edit', 'BEFORE UPDATE', 'installment_contracts',
    `OLD.status = 'cancelled' OR ${changed('number', 'date', 'party_id', 'invoice_id', 'currency', 'total', 'down_payment', 'months', 'created_by', 'created_at')}`,
    'installment_contract_is_permanent', 6),
  trigger('installment_schedule_no_update', 'BEFORE UPDATE', 'installment_schedule', null, 'installment_contract_is_permanent', 6),
  trigger('installment_schedule_no_delete', 'BEFORE DELETE', 'installment_schedule', null, 'installment_contract_is_permanent', 6),
  trigger('installment_receipts_no_update', 'BEFORE UPDATE', 'installment_receipts', null, 'installment_contract_is_permanent', 6),
  trigger('installment_receipts_no_delete', 'BEFORE DELETE', 'installment_receipts', null, 'installment_contract_is_permanent', 6)
];

/** A table's columns as its CREATE statement lists them, with the primary key's. */
export function tableColumns(name: string): { columns: string[]; primaryKey: string[] } {
  const table = MYSQL_TABLES.find((t) => t.name === name);
  if (!table) throw new Error(`Unknown table ${name}`);
  const body = table.sql.slice(table.sql.indexOf('(') + 1, table.sql.lastIndexOf(')'));
  const lines = body.split('\n').map((l) => l.trim().replace(/,$/, '')).filter(Boolean);
  const columns: string[] = [];
  let primaryKey: string[] = [];
  for (const line of lines) {
    const composite = /^PRIMARY KEY \(([^)]+)\)/.exec(line);
    if (composite) primaryKey = composite[1]!.split(',').map((c) => c.trim());
    if (/^(CHECK|INDEX|UNIQUE KEY|PRIMARY KEY|FOREIGN KEY)\b/.test(line)) continue;
    const column = /^"?(\w+)"?/.exec(line)![1]!;
    columns.push(column);
    if (/PRIMARY KEY/.test(line)) primaryKey = [column];
  }
  return { columns, primaryKey };
}

/** Every foreign key: the table and column that point, and the table and column pointed at. */
export function foreignKeys(): { table: string; column: string; parent: string; parentColumn: string }[] {
  return MYSQL_TABLES.flatMap((t) => [...t.sql.matchAll(/FOREIGN KEY \((\w+)\) REFERENCES (\w+)\((\w+)\)/g)]
    .map((m) => ({ table: t.name, column: m[1]!, parent: m[2]!, parentColumn: m[3]! })));
}

/** A table's CREATE statement with this server's collations. */
export function mysqlTableSql(sql: string, collations: MysqlCollations): string {
  return `${sql.replace('{ci}', collations.ci)} ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${collations.bin}`;
}
