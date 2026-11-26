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
/** a batch number (40 characters as kept, with room) */
const BATCH = 'VARCHAR(64)';

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
      lang VARCHAR(2) CHECK (lang IS NULL OR lang IN ('ar', 'en', 'ku')),
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
    // before items, which point at it (a fresh server database makes the tables in this order)
    name: 'item_categories',
    since: 10,
    sql: `CREATE TABLE item_categories (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${ID} NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ku TEXT NOT NULL,
      sort INT NOT NULL DEFAULT 0,
      active INT NOT NULL DEFAULT 1,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      parent_id ${ID},
      reorder_milli BIGINT CHECK (reorder_milli IS NULL OR reorder_milli >= 0),
      FOREIGN KEY (parent_id) REFERENCES item_categories(id)
    )`
  },
  {
    // before items, which point at it
    name: 'brands',
    since: 11,
    sql: `CREATE TABLE brands (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${ID} UNIQUE,
      name VARCHAR(200) NOT NULL,
      name_key ${ID} NOT NULL UNIQUE,
      name_ar VARCHAR(200) NOT NULL DEFAULT '',
      name_ku VARCHAR(200) NOT NULL DEFAULT '',
      country ${WORD},
      sort INT NOT NULL DEFAULT 0,
      active INT NOT NULL DEFAULT 1,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL
    )`
  },
  {
    // SQLite's barcode index skips NULL and ''; the app stores no barcode as NULL, which a UNIQUE key allows many of.
    // The columns after created_at came with version 10 (ALTER ... ADD COLUMN puts them last, as SQLite does)
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
      category_id ${ID},
      sale_unit ${WORD},
      purchase_unit ${WORD},
      track_batches INT NOT NULL DEFAULT 0,
      track_expiry INT NOT NULL DEFAULT 0,
      updated_at ${WHEN},
      brand_id ${ID},
      reorder_milli BIGINT CHECK (reorder_milli IS NULL OR reorder_milli >= 0),
      purchase_price BIGINT CHECK (purchase_price IS NULL OR purchase_price >= 0),
      purchase_currency ${WORD} CHECK (purchase_currency IS NULL OR purchase_currency IN ('IQD', 'USD')),
      UNIQUE KEY items_barcode (barcode),
      FOREIGN KEY (category_id) REFERENCES item_categories(id),
      FOREIGN KEY (brand_id) REFERENCES brands(id)
    )`
  },
  {
    // before the document lines, which point at it
    name: 'item_batches',
    since: 10,
    sql: `CREATE TABLE item_batches (
      id ${ID} NOT NULL PRIMARY KEY,
      item_id ${ID} NOT NULL,
      number ${BATCH} NOT NULL,
      expiry ${WHEN},
      created_at ${WHEN} NOT NULL,
      UNIQUE KEY item_batches_number_expiry (item_id, number, expiry),
      INDEX item_batches_expiry (expiry),
      FOREIGN KEY (item_id) REFERENCES items(id)
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
      revision INT NOT NULL DEFAULT 0,
      INDEX entries_date (date),
      INDEX entries_status_date (status, date),
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
    // 13 (1.4): vouchers sent for an admin's approval, and the answer (db.ts V13)
    name: 'voucher_approvals',
    since: 13,
    sql: `CREATE TABLE voucher_approvals (
      entry_id ${ID} NOT NULL PRIMARY KEY,
      state ${WORD} NOT NULL CHECK (state IN ('waiting', 'rejected', 'approved')),
      requested_by TEXT NOT NULL,
      requested_by_id ${ID},
      requested_at ${WHEN} NOT NULL,
      decided_by TEXT,
      decided_by_id ${ID},
      decided_at ${WHEN},
      reason TEXT,
      INDEX voucher_approvals_state (state),
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
      FOREIGN KEY (requested_by_id) REFERENCES users(id),
      FOREIGN KEY (decided_by_id) REFERENCES users(id)
    )`
  },
  {
    // 15: the photo of a paper receipt kept with its voucher (db.ts V15)
    name: 'entry_images',
    since: 15,
    sql: `CREATE TABLE entry_images (
      entry_id ${ID} NOT NULL PRIMARY KEY,
      mime ${WORD} NOT NULL CHECK (mime = 'image/jpeg'),
      data MEDIUMBLOB NOT NULL,
      bytes INT NOT NULL CHECK (bytes > 0 AND bytes <= 409600),
      sha256 VARCHAR(64) NOT NULL,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
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
      details MEDIUMTEXT,
      INDEX audit_log_user_login (entity(32), entity_id(64), action(32), id)
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
      offers_on INT NOT NULL DEFAULT 0 CHECK (offers_on IN (0, 1)),
      offer_discount BIGINT NOT NULL DEFAULT 0 CHECK (offer_discount >= 0),
      CHECK ((kind IN ('sale_return', 'purchase_return')) = (return_of IS NOT NULL)),
      INDEX invoices_date (date),
      INDEX invoices_return_of (return_of),
      INDEX invoices_cash_posted (cash_account, posted_at),
      INDEX invoices_cash_cancelled (cash_account, cancelled_at),
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
      unit ${WORD},
      unit_factor_milli BIGINT,
      unit_qty_milli BIGINT,
      batch_no ${BATCH},
      expiry ${WHEN},
      batch_id ${ID},
      PRIMARY KEY (invoice_id, line_no),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (batch_id) REFERENCES item_batches(id)
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
      INDEX stock_moves_stock (item_id, warehouse_id, date, qty_milli, value),
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
      unit ${WORD},
      unit_factor_milli BIGINT,
      unit_qty_milli BIGINT,
      batch_no ${BATCH},
      expiry ${WHEN},
      batch_id ${ID},
      PRIMARY KEY (doc_id, line_no),
      FOREIGN KEY (doc_id) REFERENCES stock_docs(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (batch_id) REFERENCES item_batches(id)
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
  },
  {
    name: 're_projects',
    since: 7,
    sql: `CREATE TABLE re_projects (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${ID} NOT NULL UNIQUE,
      name TEXT NOT NULL,
      city TEXT,
      address TEXT,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      item_id ${ID} NOT NULL,
      active INT NOT NULL DEFAULT 1,
      notes TEXT,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 're_units',
    since: 7,
    sql: `CREATE TABLE re_units (
      id ${ID} NOT NULL PRIMARY KEY,
      project_id ${ID} NOT NULL,
      building ${ID} NOT NULL DEFAULT '',
      code ${ID} NOT NULL,
      floor INT NOT NULL DEFAULT 0,
      kind ${WORD} NOT NULL CHECK (kind IN ('apartment', 'villa', 'house', 'shop', 'office', 'land')),
      bedrooms INT NOT NULL DEFAULT 0 CHECK (bedrooms >= 0),
      area_x100 BIGINT NOT NULL DEFAULT 0 CHECK (area_x100 >= 0),
      price BIGINT NOT NULL CHECK (price >= 0),
      view TEXT,
      status ${WORD} NOT NULL CHECK (status IN ('available', 'reserved', 'sold')),
      party_id ${ID},
      reserved_until ${WHEN},
      invoice_id ${ID},
      contract_id ${ID},
      notes TEXT,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      CHECK ((status = 'available') = (party_id IS NULL)),
      CHECK (status = 'sold' OR (invoice_id IS NULL AND contract_id IS NULL)),
      UNIQUE KEY re_units_code (project_id, building, code),
      INDEX re_units_project (project_id),
      INDEX re_units_party (party_id),
      FOREIGN KEY (project_id) REFERENCES re_projects(id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (contract_id) REFERENCES installment_contracts(id)
    )`
  },
  {
    name: 'serials',
    since: 7,
    sql: `CREATE TABLE serials (
      id ${ID} NOT NULL PRIMARY KEY,
      item_id ${ID} NOT NULL,
      serial ${ID} NOT NULL UNIQUE,
      grade ${WORD} NOT NULL CHECK (grade IN ('new', 'used')),
      status ${WORD} NOT NULL CHECK (status IN ('in_stock', 'sold', 'returned', 'defective')),
      purchase_invoice_id ${ID},
      from_party_id ${ID},
      cost BIGINT,
      sale_invoice_id ${ID},
      party_id ${ID},
      sold_at ${WHEN},
      warranty_until ${WHEN},
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      CHECK (status <> 'sold' OR sale_invoice_id IS NOT NULL),
      INDEX serials_item (item_id),
      INDEX serials_sale (sale_invoice_id),
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (purchase_invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (from_party_id) REFERENCES parties(id),
      FOREIGN KEY (sale_invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )`
  },
  {
    name: 'serial_sales',
    since: 7,
    sql: `CREATE TABLE serial_sales (
      id ${ID} NOT NULL PRIMARY KEY,
      serial_id ${ID} NOT NULL,
      invoice_id ${ID} NOT NULL,
      warranty_until ${WHEN},
      created_at ${WHEN} NOT NULL,
      INDEX serial_sales_serial (serial_id),
      INDEX serial_sales_invoice (invoice_id),
      FOREIGN KEY (serial_id) REFERENCES serials(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    name: 'repair_orders',
    since: 7,
    sql: `CREATE TABLE repair_orders (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      date ${WHEN} NOT NULL,
      party_id ${ID} NOT NULL,
      device TEXT NOT NULL,
      serial TEXT,
      problem TEXT NOT NULL,
      accessories TEXT,
      passcode_given INT NOT NULL DEFAULT 0,
      technician TEXT,
      status ${WORD} NOT NULL CHECK (status IN ('received', 'diagnosing', 'waiting_parts', 'repairing', 'ready', 'delivered', 'cancelled')),
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      estimate BIGINT NOT NULL DEFAULT 0 CHECK (estimate >= 0),
      promised_date ${WHEN},
      invoice_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      delivered_at ${WHEN},
      updated_at ${WHEN} NOT NULL,
      INDEX repair_orders_party (party_id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    name: 'part_details',
    since: 7,
    sql: `CREATE TABLE part_details (
      item_id ${ID} NOT NULL PRIMARY KEY,
      shelf TEXT,
      brand TEXT,
      origin TEXT,
      wholesale_price BIGINT CHECK (wholesale_price IS NULL OR wholesale_price >= 0),
      reorder_milli BIGINT CHECK (reorder_milli IS NULL OR reorder_milli >= 0),
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'part_numbers',
    since: 7,
    sql: `CREATE TABLE part_numbers (
      item_id ${ID} NOT NULL,
      number TEXT NOT NULL,
      number_key ${ID} NOT NULL,
      kind ${WORD} NOT NULL CHECK (kind IN ('oem', 'alt')),
      maker TEXT,
      PRIMARY KEY (item_id, number_key),
      INDEX part_numbers_key (number_key),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'part_fitments',
    since: 7,
    sql: `CREATE TABLE part_fitments (
      id ${ID} NOT NULL PRIMARY KEY,
      item_id ${ID} NOT NULL,
      make ${ID} NOT NULL,
      model ${ID} NOT NULL,
      year_from INT,
      year_to INT,
      engine TEXT,
      CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to),
      INDEX part_fitments_item (item_id),
      INDEX part_fitments_car (make, model),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'jobs',
    since: 7,
    sql: `CREATE TABLE jobs (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      date ${WHEN} NOT NULL,
      party_id ${ID} NOT NULL,
      title TEXT NOT NULL,
      category ${WORD} NOT NULL CHECK (category IN ('welding', 'steel', 'aluminium', 'mdf', 'openings', 'electrical', 'solar', 'general')),
      site TEXT,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      status ${WORD} NOT NULL CHECK (status IN ('quote', 'measuring', 'approved', 'fabricating', 'installing', 'done', 'invoiced', 'cancelled')),
      discount BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
      due_date ${WHEN},
      assigned_to TEXT,
      invoice_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      INDEX jobs_party (party_id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    name: 'job_lines',
    since: 7,
    sql: `CREATE TABLE job_lines (
      job_id ${ID} NOT NULL,
      seq INT NOT NULL,
      description TEXT NOT NULL,
      unit ${WORD} NOT NULL CHECK (unit IN ('m2', 'm', 'piece', 'kg', 'set', 'lump')),
      qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
      unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
      PRIMARY KEY (job_id, seq),
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )`
  },
  {
    name: 'job_costs',
    since: 7,
    sql: `CREATE TABLE job_costs (
      id ${ID} NOT NULL PRIMARY KEY,
      job_id ${ID} NOT NULL,
      category ${WORD} NOT NULL CHECK (category IN ('materials', 'labour', 'subcontract', 'transport', 'other')),
      invoice_id ${ID},
      entry_id ${ID},
      amount BIGINT NOT NULL CHECK (amount > 0),
      description TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      CHECK ((invoice_id IS NULL) <> (entry_id IS NULL)),
      INDEX job_costs_job (job_id),
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'job_receipts',
    since: 7,
    sql: `CREATE TABLE job_receipts (
      job_id ${ID} NOT NULL,
      entry_id ${ID} NOT NULL UNIQUE,
      amount BIGINT NOT NULL CHECK (amount > 0),
      created_at ${WHEN} NOT NULL,
      PRIMARY KEY (job_id, entry_id),
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'item_images',
    since: 7,
    sql: `CREATE TABLE item_images (
      item_id ${ID} NOT NULL PRIMARY KEY,
      mime ${WORD} NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
      data MEDIUMBLOB NOT NULL,
      updated_at ${WHEN} NOT NULL,
      sha256 VARCHAR(64),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'quotes',
    since: 7,
    sql: `CREATE TABLE quotes (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      date ${WHEN} NOT NULL,
      valid_until ${WHEN},
      party_id ${ID},
      customer_name TEXT,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      discount BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
      status ${WORD} NOT NULL CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'invoiced', 'cancelled')),
      invoice_id ${ID},
      notes TEXT,
      terms TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      CHECK (party_id IS NOT NULL OR customer_name IS NOT NULL),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    name: 'quote_lines',
    since: 7,
    sql: `CREATE TABLE quote_lines (
      quote_id ${ID} NOT NULL,
      seq INT NOT NULL,
      item_id ${ID},
      description TEXT NOT NULL,
      qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
      unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
      PRIMARY KEY (quote_id, seq),
      FOREIGN KEY (quote_id) REFERENCES quotes(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'deals',
    since: 7,
    sql: `CREATE TABLE deals (
      id ${ID} NOT NULL PRIMARY KEY,
      title TEXT NOT NULL,
      party_id ${ID},
      contact_name TEXT,
      phone TEXT,
      source TEXT,
      stage ${WORD} NOT NULL CHECK (stage IN ('lead', 'contacted', 'quoted', 'negotiating', 'won', 'lost')),
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      value BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0),
      expected_date ${WHEN},
      next_step TEXT,
      next_date ${WHEN},
      owner TEXT,
      quote_id ${ID},
      lost_reason TEXT,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      closed_at ${WHEN},
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (quote_id) REFERENCES quotes(id)
    )`
  },
  {
    // ——— 17, TILLS ——— (before pos_shifts, whose till_id points at it)
    name: 'pos_tills',
    since: 17,
    sql: `CREATE TABLE pos_tills (
      id ${ID} NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      cash_account ${ID} NOT NULL,
      warehouse_id ${ID} NOT NULL,
      drawer ${WORD} NOT NULL DEFAULT 'off' CHECK (drawer IN ('off', 'cash')),
      customer_display INT NOT NULL DEFAULT 0 CHECK (customer_display IN (0, 1)),
      active INT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (cash_account) REFERENCES accounts(code),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    )`
  },
  {
    name: 'pos_shifts',
    since: 7,
    sql: `CREATE TABLE pos_shifts (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      register TEXT NOT NULL,
      cash_account ${ID} NOT NULL,
      warehouse_id ${ID} NOT NULL,
      status ${WORD} NOT NULL CHECK (status IN ('open', 'closed')),
      opened_by TEXT NOT NULL,
      opened_at ${WHEN} NOT NULL,
      opening_cash BIGINT NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
      closed_by TEXT,
      closed_at ${WHEN},
      expected_cash BIGINT,
      counted_cash BIGINT,
      expected_usd BIGINT,
      counted_usd BIGINT,
      notes TEXT,
      till_id ${ID},
      FOREIGN KEY (cash_account) REFERENCES accounts(code),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (till_id) REFERENCES pos_tills(id)
    )`
  },
  {
    name: 'pos_sales',
    since: 7,
    sql: `CREATE TABLE pos_sales (
      invoice_id ${ID} NOT NULL PRIMARY KEY,
      shift_id ${ID} NOT NULL,
      tendered BIGINT CHECK (tendered IS NULL OR tendered >= 0),
      usd_cash BIGINT CHECK (usd_cash IS NULL OR usd_cash > 0),
      usd_rate_x100 BIGINT CHECK (usd_rate_x100 IS NULL OR usd_rate_x100 > 0),
      rounding BIGINT NOT NULL DEFAULT 0,
      voucher_paid BIGINT NOT NULL DEFAULT 0,
      INDEX pos_sales_shift (shift_id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (shift_id) REFERENCES pos_shifts(id)
    )`
  },
  {
    // 1.2 offline outbox: a till's sale made offline, with the temporary reference on its receipt
    name: 'pos_offline_sales',
    since: 12,
    sql: `CREATE TABLE pos_offline_sales (
      invoice_id ${ID} NOT NULL PRIMARY KEY,
      reference ${ID} NOT NULL,
      sold_at ${WHEN} NOT NULL,
      synced_at ${WHEN} NOT NULL,
      INDEX pos_offline_sales_reference (reference),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    // 1.2 offline outbox: the keys clients send with a document they may send again (idempotency.ts)
    name: 'idempotency_keys',
    since: 12,
    sql: `CREATE TABLE idempotency_keys (
      idem_key ${ID} NOT NULL PRIMARY KEY,
      user_key ${ID} NOT NULL,
      route ${ID} NOT NULL,
      request_hash ${ID} NOT NULL,
      result_id ${ID},
      created_at ${WHEN} NOT NULL,
      INDEX idempotency_keys_created (created_at)
    )`
  },
  {
    name: 'employees',
    since: 7,
    sql: `CREATE TABLE employees (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${ID} NOT NULL UNIQUE,
      name TEXT NOT NULL,
      job_title TEXT,
      department TEXT,
      phone TEXT,
      id_number TEXT,
      hire_date ${WHEN},
      end_date ${WHEN},
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      base_salary BIGINT NOT NULL CHECK (base_salary >= 0),
      allowances BIGINT NOT NULL DEFAULT 0 CHECK (allowances >= 0),
      social_security INT NOT NULL DEFAULT 0,
      bank_account TEXT,
      active INT NOT NULL DEFAULT 1,
      notes TEXT,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL
    )`
  },
  {
    name: 'payroll_runs',
    since: 7,
    sql: `CREATE TABLE payroll_runs (
      id ${ID} NOT NULL PRIMARY KEY,
      period ${WORD} NOT NULL,
      date ${WHEN} NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      status ${WORD} NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
      entry_id ${ID},
      payment_entry_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      INDEX payroll_runs_period (period),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (payment_entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'payroll_lines',
    since: 7,
    sql: `CREATE TABLE payroll_lines (
      run_id ${ID} NOT NULL,
      employee_id ${ID} NOT NULL,
      base BIGINT NOT NULL,
      allowances BIGINT NOT NULL DEFAULT 0,
      overtime BIGINT NOT NULL DEFAULT 0,
      bonus BIGINT NOT NULL DEFAULT 0,
      absence BIGINT NOT NULL DEFAULT 0,
      advance_deduction BIGINT NOT NULL DEFAULT 0,
      social_security BIGINT NOT NULL DEFAULT 0,
      other_deductions BIGINT NOT NULL DEFAULT 0,
      net BIGINT NOT NULL,
      notes TEXT,
      PRIMARY KEY (run_id, employee_id),
      FOREIGN KEY (run_id) REFERENCES payroll_runs(id),
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )`
  },
  {
    name: 'employee_advances',
    since: 7,
    sql: `CREATE TABLE employee_advances (
      id ${ID} NOT NULL PRIMARY KEY,
      employee_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      amount BIGINT NOT NULL CHECK (amount > 0),
      monthly BIGINT NOT NULL CHECK (monthly > 0),
      entry_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      INDEX employee_advances_employee (employee_id),
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'fx_rates',
    since: 7,
    sql: `CREATE TABLE fx_rates (
      date ${WHEN} NOT NULL PRIMARY KEY,
      rate_x100 BIGINT NOT NULL CHECK (rate_x100 > 0),
      source TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL
    )`
  },
  {
    name: 'gen_subscribers',
    since: 7,
    sql: `CREATE TABLE gen_subscribers (
      party_id ${ID} NOT NULL PRIMARY KEY,
      code ${ID} NOT NULL UNIQUE,
      amps_x10 INT NOT NULL CHECK (amps_x10 > 0),
      line ${WORD} NOT NULL CHECK (line IN ('normal', 'golden')),
      area TEXT,
      route TEXT,
      status ${WORD} NOT NULL CHECK (status IN ('active', 'suspended', 'ended')),
      start_date ${WHEN},
      notes TEXT,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )`
  },
  {
    name: 'gen_runs',
    since: 7,
    sql: `CREATE TABLE gen_runs (
      id ${ID} NOT NULL PRIMARY KEY,
      period ${WORD} NOT NULL UNIQUE,
      date ${WHEN} NOT NULL,
      price_normal BIGINT NOT NULL CHECK (price_normal >= 0),
      price_golden BIGINT NOT NULL CHECK (price_golden >= 0),
      status ${WORD} NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
      entry_id ${ID},
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'gen_bills',
    since: 7,
    sql: `CREATE TABLE gen_bills (
      run_id ${ID} NOT NULL,
      party_id ${ID} NOT NULL,
      amps_x10 INT NOT NULL,
      line ${WORD} NOT NULL CHECK (line IN ('normal', 'golden')),
      amount BIGINT NOT NULL CHECK (amount >= 0),
      PRIMARY KEY (run_id, party_id),
      FOREIGN KEY (run_id) REFERENCES gen_runs(id),
      FOREIGN KEY (party_id) REFERENCES gen_subscribers(party_id)
    )`
  },
  {
    name: 'gen_collections',
    since: 7,
    sql: `CREATE TABLE gen_collections (
      entry_id ${ID} NOT NULL PRIMARY KEY,
      party_id ${ID} NOT NULL,
      collector TEXT,
      amount BIGINT NOT NULL CHECK (amount > 0),
      created_at ${WHEN} NOT NULL,
      INDEX gen_collections_party (party_id),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (party_id) REFERENCES gen_subscribers(party_id)
    )`
  },
  {
    name: 'api_keys',
    since: 7,
    sql: `CREATE TABLE api_keys (
      id ${ID} NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      prefix ${WORD} NOT NULL,
      hash ${ID} NOT NULL UNIQUE,
      scopes TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      last_used_at ${WHEN},
      revoked_at ${WHEN}
    )`
  },
  {
    name: 'stock_adjustments',
    since: 7,
    sql: `CREATE TABLE stock_adjustments (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} UNIQUE,
      date ${WHEN} NOT NULL,
      warehouse_id ${ID} NOT NULL,
      reason ${WORD} NOT NULL CHECK (reason IN ('damaged', 'lost', 'expired', 'count', 'internal_use', 'job', 'other')),
      account_code ${ID},
      job_id ${ID},
      status ${WORD} NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
      entry_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      prepared_by_id ${ID},
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (account_code) REFERENCES accounts(code),
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (prepared_by_id) REFERENCES users(id)
    )`
  },
  {
    name: 'stock_adjustment_lines',
    since: 7,
    sql: `CREATE TABLE stock_adjustment_lines (
      adjustment_id ${ID} NOT NULL,
      seq INT NOT NULL,
      item_id ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL CHECK (qty_milli <> 0),
      unit_cost BIGINT,
      unit ${WORD},
      unit_factor_milli BIGINT,
      unit_qty_milli BIGINT,
      batch_no ${BATCH},
      expiry ${WHEN},
      batch_id ${ID},
      PRIMARY KEY (adjustment_id, seq),
      FOREIGN KEY (adjustment_id) REFERENCES stock_adjustments(id),
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (batch_id) REFERENCES item_batches(id)
    )`
  },
  {
    name: 'purchase_orders',
    since: 7,
    sql: `CREATE TABLE purchase_orders (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      date ${WHEN} NOT NULL,
      party_id ${ID} NOT NULL,
      warehouse_id ${ID},
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      expected_date ${WHEN},
      status ${WORD} NOT NULL CHECK (status IN ('draft', 'sent', 'partial', 'received', 'cancelled')),
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    )`
  },
  {
    name: 'purchase_order_lines',
    since: 7,
    sql: `CREATE TABLE purchase_order_lines (
      order_id ${ID} NOT NULL,
      seq INT NOT NULL,
      item_id ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
      unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
      unit ${WORD},
      unit_factor_milli BIGINT,
      unit_qty_milli BIGINT,
      PRIMARY KEY (order_id, seq),
      FOREIGN KEY (order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'purchase_order_receipts',
    since: 7,
    sql: `CREATE TABLE purchase_order_receipts (
      order_id ${ID} NOT NULL,
      invoice_id ${ID} NOT NULL,
      PRIMARY KEY (order_id, invoice_id),
      FOREIGN KEY (order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    name: 'party_price_lists',
    since: 7,
    sql: `CREATE TABLE party_price_lists (
      party_id ${ID} NOT NULL PRIMARY KEY,
      list ${WORD} NOT NULL CHECK (list IN ('retail', 'wholesale')),
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )`
  },
  {
    name: 'item_prices',
    since: 7,
    sql: `CREATE TABLE item_prices (
      item_id ${ID} NOT NULL,
      list ${WORD} NOT NULL CHECK (list IN ('wholesale')),
      price BIGINT NOT NULL CHECK (price >= 0),
      PRIMARY KEY (item_id, list),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'fixed_assets',
    since: 7,
    sql: `CREATE TABLE fixed_assets (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${ID} NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category ${WORD} CHECK (category IN ('land', 'buildings', 'machinery', 'vehicles', 'tools', 'furniture', 'computers')),
      asset_account ${ID} NOT NULL,
      accum_account ${ID} NOT NULL,
      expense_account ${ID} NOT NULL,
      acquired ${WHEN} NOT NULL,
      cost BIGINT NOT NULL CHECK (cost > 0),
      salvage BIGINT NOT NULL DEFAULT 0 CHECK (salvage >= 0),
      life_months INT NOT NULL CHECK (life_months > 0),
      method ${WORD} NOT NULL CHECK (method IN ('straight_line')),
      opening_accum BIGINT NOT NULL DEFAULT 0 CHECK (opening_accum >= 0),
      location TEXT,
      status ${WORD} NOT NULL CHECK (status IN ('active', 'disposed')),
      disposed_on ${WHEN},
      disposal_entry_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (disposal_entry_id) REFERENCES entries(id),
      FOREIGN KEY (asset_account) REFERENCES accounts(code),
      FOREIGN KEY (accum_account) REFERENCES accounts(code),
      FOREIGN KEY (expense_account) REFERENCES accounts(code)
    )`
  },
  {
    name: 'depreciation_runs',
    since: 7,
    sql: `CREATE TABLE depreciation_runs (
      id ${ID} NOT NULL PRIMARY KEY,
      period ${WORD} NOT NULL UNIQUE,
      entry_id ${ID},
      status ${WORD} NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'depreciation_lines',
    since: 7,
    sql: `CREATE TABLE depreciation_lines (
      run_id ${ID} NOT NULL,
      asset_id ${ID} NOT NULL,
      amount BIGINT NOT NULL CHECK (amount >= 0),
      PRIMARY KEY (run_id, asset_id),
      FOREIGN KEY (run_id) REFERENCES depreciation_runs(id),
      FOREIGN KEY (asset_id) REFERENCES fixed_assets(id)
    )`
  },
  {
    name: 're_deposits',
    since: 7,
    sql: `CREATE TABLE re_deposits (
      entry_id ${ID} NOT NULL PRIMARY KEY,
      unit_id ${ID} NOT NULL,
      party_id ${ID} NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      amount BIGINT NOT NULL CHECK (amount > 0),
      date ${WHEN} NOT NULL,
      status ${WORD} NOT NULL CHECK (status IN ('held', 'applied', 'refunded', 'forfeited')),
      invoice_id ${ID},
      close_entry_id ${ID},
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      closed_at ${WHEN},
      INDEX re_deposits_unit (unit_id),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (unit_id) REFERENCES re_units(id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (close_entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'cheques',
    since: 7,
    sql: `CREATE TABLE cheques (
      id ${ID} NOT NULL PRIMARY KEY,
      direction ${WORD} NOT NULL CHECK (direction IN ('received', 'issued')),
      number ${ID} NOT NULL,
      bank TEXT NOT NULL,
      party_id ${ID} NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      amount BIGINT NOT NULL CHECK (amount > 0),
      issue_date ${WHEN} NOT NULL,
      due_date ${WHEN} NOT NULL,
      status ${WORD} NOT NULL CHECK (status IN ('in_hand', 'deposited', 'cleared', 'bounced', 'cancelled', 'pending')),
      bank_account ${ID},
      entry_id ${ID},
      clear_entry_id ${ID},
      bounce_entry_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      INDEX cheques_due (status, due_date),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (bank_account) REFERENCES accounts(code),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (clear_entry_id) REFERENCES entries(id),
      FOREIGN KEY (bounce_entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'bank_statements',
    since: 7,
    sql: `CREATE TABLE bank_statements (
      id ${ID} NOT NULL PRIMARY KEY,
      account_code ${ID} NOT NULL,
      period_from ${WHEN} NOT NULL,
      period_to ${WHEN} NOT NULL,
      opening BIGINT NOT NULL,
      closing BIGINT NOT NULL,
      status ${WORD} NOT NULL CHECK (status IN ('open', 'reconciled')),
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (account_code) REFERENCES accounts(code)
    )`
  },
  {
    name: 'bank_statement_lines',
    since: 7,
    sql: `CREATE TABLE bank_statement_lines (
      statement_id ${ID} NOT NULL,
      seq INT NOT NULL,
      date ${WHEN} NOT NULL,
      description TEXT NOT NULL,
      reference TEXT,
      amount BIGINT NOT NULL,
      entry_id ${ID},
      PRIMARY KEY (statement_id, seq),
      FOREIGN KEY (statement_id) REFERENCES bank_statements(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'branches',
    since: 7,
    sql: `CREATE TABLE branches (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${ID} NOT NULL UNIQUE,
      name TEXT NOT NULL,
      city TEXT,
      active INT NOT NULL DEFAULT 1,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL
    )`
  },
  {
    name: 'branch_warehouses',
    since: 7,
    sql: `CREATE TABLE branch_warehouses (
      warehouse_id ${ID} NOT NULL PRIMARY KEY,
      branch_id ${ID} NOT NULL,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    )`
  },
  {
    name: 'branch_accounts',
    since: 7,
    sql: `CREATE TABLE branch_accounts (
      account_code ${ID} NOT NULL PRIMARY KEY,
      branch_id ${ID} NOT NULL,
      FOREIGN KEY (account_code) REFERENCES accounts(code),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    )`
  },
  {
    name: 'user_branches',
    since: 7,
    sql: `CREATE TABLE user_branches (
      user_id ${ID} NOT NULL,
      branch_id ${ID} NOT NULL,
      PRIMARY KEY (user_id, branch_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    )`
  },
  {
    name: 'solar_designs',
    since: 7,
    sql: `CREATE TABLE solar_designs (
      job_id ${ID} NOT NULL PRIMARY KEY,
      design MEDIUMTEXT NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )`
  },
  {
    name: 'maint_plans',
    since: 7,
    sql: `CREATE TABLE maint_plans (
      id ${ID} NOT NULL PRIMARY KEY,
      party_id ${ID} NOT NULL,
      job_id ${ID},
      title TEXT NOT NULL,
      site TEXT,
      every_months INT NOT NULL CHECK (every_months BETWEEN 1 AND 24),
      next_date ${WHEN} NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      price BIGINT NOT NULL DEFAULT 0 CHECK (price >= 0),
      status ${WORD} NOT NULL CHECK (status IN ('active', 'paused', 'ended')),
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      INDEX maint_plans_party (party_id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )`
  },
  {
    name: 'maint_visits',
    since: 7,
    sql: `CREATE TABLE maint_visits (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      plan_id ${ID},
      party_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      kind ${WORD} NOT NULL CHECK (kind IN ('service', 'repair', 'inspection', 'installation')),
      technician TEXT,
      status ${WORD} NOT NULL CHECK (status IN ('scheduled', 'done', 'cancelled')),
      findings TEXT,
      work_done TEXT,
      invoice_id ${ID},
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      INDEX maint_visits_party (party_id),
      FOREIGN KEY (plan_id) REFERENCES maint_plans(id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    name: 'webapi_orders',
    since: 7,
    sql: `CREATE TABLE webapi_orders (
      source ${ID} NOT NULL,
      external_id ${ID} NOT NULL,
      invoice_id ${ID} NOT NULL,
      created_at ${WHEN} NOT NULL,
      PRIMARY KEY (source, external_id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    name: 'webhooks',
    since: 7,
    sql: `CREATE TABLE webhooks (
      id ${ID} NOT NULL PRIMARY KEY,
      url TEXT NOT NULL,
      events TEXT NOT NULL,
      secret TEXT NOT NULL,
      active INT NOT NULL DEFAULT 1,
      last_status INT,
      last_delivery_at ${WHEN},
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL
    )`
  },
  {
    name: 'stock_counts',
    since: 8,
    sql: `CREATE TABLE stock_counts (
      id ${ID} NOT NULL PRIMARY KEY,
      warehouse_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      notes TEXT,
      count_all INT NOT NULL DEFAULT 0,
      status ${WORD} NOT NULL CHECK (status IN ('open', 'done', 'discarded')),
      adjustment_id ${ID},
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at ${WHEN} NOT NULL,
      scope TEXT,
      INDEX stock_counts_warehouse (warehouse_id, status),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (adjustment_id) REFERENCES stock_adjustments(id)
    )`
  },
  {
    name: 'stock_count_lines',
    since: 8,
    sql: `CREATE TABLE stock_count_lines (
      count_id ${ID} NOT NULL,
      item_id ${ID} NOT NULL,
      counted_milli BIGINT NOT NULL CHECK (counted_milli >= 0),
      book_milli BIGINT NOT NULL,
      unit_cost BIGINT,
      counted_at ${WHEN} NOT NULL,
      PRIMARY KEY (count_id, item_id),
      FOREIGN KEY (count_id) REFERENCES stock_counts(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'stock_count_items',
    since: 9,
    sql: `CREATE TABLE stock_count_items (
      count_id ${ID} NOT NULL,
      item_id ${ID} NOT NULL,
      PRIMARY KEY (count_id, item_id),
      FOREIGN KEY (count_id) REFERENCES stock_counts(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    // many NULL barcodes are allowed by a UNIQUE key, as by SQLite's unique index; the app stores no barcode as NULL
    name: 'item_units',
    since: 10,
    sql: `CREATE TABLE item_units (
      item_id ${ID} NOT NULL,
      unit ${WORD} NOT NULL,
      factor_milli BIGINT NOT NULL CHECK (factor_milli > 0),
      barcode ${ID},
      sale_price BIGINT CHECK (sale_price IS NULL OR sale_price >= 0),
      sort INT NOT NULL DEFAULT 0,
      PRIMARY KEY (item_id, unit),
      UNIQUE KEY item_units_barcode (barcode),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'stock_batch_moves',
    since: 10,
    sql: `CREATE TABLE stock_batch_moves (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      batch_id ${ID} NOT NULL,
      item_id ${ID} NOT NULL,
      warehouse_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      qty_milli BIGINT NOT NULL,
      source_type ${WORD} NOT NULL,
      source_id ${ID},
      line_no INT,
      created_at ${WHEN} NOT NULL,
      INDEX stock_batch_moves_batch (batch_id, warehouse_id),
      INDEX stock_batch_moves_item (item_id, warehouse_id),
      INDEX stock_batch_moves_source (source_type, source_id),
      FOREIGN KEY (batch_id) REFERENCES item_batches(id),
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    )`
  },
  {
    name: 'invoice_payments',
    since: 10,
    sql: `CREATE TABLE invoice_payments (
      id ${ID} NOT NULL PRIMARY KEY,
      invoice_id ${ID} NOT NULL,
      kind ${WORD} NOT NULL CHECK (kind IN ('pos', 'online')),
      method ${WORD} NOT NULL CHECK (method IN ('cash', 'card', 'fib', 'zaincash', 'qi', 'account', 'other')),
      account_code ${ID} NOT NULL,
      amount BIGINT NOT NULL CHECK (amount > 0),
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      entry_id ${ID},
      source VARCHAR(64),
      reference VARCHAR(191),
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      UNIQUE KEY invoice_payments_ref (source, reference),
      INDEX invoice_payments_invoice (invoice_id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (account_code) REFERENCES accounts(code),
      FOREIGN KEY (entry_id) REFERENCES entries(id)
    )`
  },
  {
    // 13 (1.4): a quick receipt or payment voucher and the invoice it was made for (db.ts V13)
    name: 'invoice_vouchers',
    since: 13,
    sql: `CREATE TABLE invoice_vouchers (
      entry_id ${ID} NOT NULL PRIMARY KEY,
      invoice_id ${ID} NOT NULL,
      INDEX invoice_vouchers_invoice (invoice_id),
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    )`
  },
  {
    name: 'pharma_details',
    since: 10,
    sql: `CREATE TABLE pharma_details (
      item_id ${ID} NOT NULL PRIMARY KEY,
      generic_name VARCHAR(200) NOT NULL DEFAULT '',
      generic_key VARCHAR(200) NOT NULL DEFAULT '',
      form ${WORD} NOT NULL DEFAULT 'other' CHECK (form IN ('tablet', 'capsule', 'syrup', 'suspension', 'injection', 'drops', 'cream', 'ointment', 'inhaler', 'suppository', 'sachet', 'spray', 'other')),
      strength VARCHAR(60) NOT NULL DEFAULT '',
      manufacturer VARCHAR(200) NOT NULL DEFAULT '',
      rx_only INT NOT NULL DEFAULT 0,
      controlled INT NOT NULL DEFAULT 0,
      shelf VARCHAR(60) NOT NULL DEFAULT '',
      updated_at ${WHEN} NOT NULL,
      INDEX pharma_details_generic (generic_key),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    // the app always writes every column (TEXT takes no default on every server)
    name: 'pharma_controlled_log',
    since: 10,
    sql: `CREATE TABLE pharma_controlled_log (
      invoice_id ${ID} NOT NULL,
      line_no INT NOT NULL,
      patient TEXT NOT NULL,
      prescriber TEXT NOT NULL,
      prescription_no TEXT NOT NULL,
      notes TEXT,
      recorded_by TEXT NOT NULL,
      recorded_at ${WHEN} NOT NULL,
      PRIMARY KEY (invoice_id, line_no),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    // 12, owner tools: the loyalty points ledger (Pro), kept for ever like stock moves
    name: 'loyalty_moves',
    since: 12,
    sql: `CREATE TABLE loyalty_moves (
      id ${ID} NOT NULL PRIMARY KEY,
      party_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      kind ${WORD} NOT NULL CHECK (kind IN ('earn', 'redeem', 'return_earn', 'return_redeem', 'cancel', 'adjust')),
      points BIGINT NOT NULL CHECK (points <> 0),
      value BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0),
      account_code ${ID},
      invoice_id ${ID},
      source_id ${ID},
      expires_on ${WHEN},
      branch_id ${ID},
      note TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      INDEX loyalty_moves_party (party_id, date),
      INDEX loyalty_moves_invoice (invoice_id),
      INDEX loyalty_moves_source (source_id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (account_code) REFERENCES accounts(code),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (source_id) REFERENCES loyalty_moves(id),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    )`
  },
  {
    // 16: petrol stations: fuels, tanks, pumps, nozzles, shifts and their meter readings, deliveries, dips and each
    // tank's moves (db.ts V16)
    name: 'fuel_types',
    since: 16,
    sql: `CREATE TABLE fuel_types (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${ID} NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ku TEXT NOT NULL,
      price BIGINT NOT NULL CHECK (price > 0),
      revenue_account ${ID} NOT NULL,
      active INT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      sort INT NOT NULL DEFAULT 0,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (revenue_account) REFERENCES accounts(code)
    )`
  },
  {
    name: 'fuel_tanks',
    since: 16,
    sql: `CREATE TABLE fuel_tanks (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${ID} NOT NULL UNIQUE,
      name TEXT NOT NULL,
      fuel_type_id ${ID} NOT NULL,
      capacity_milli BIGINT NOT NULL CHECK (capacity_milli > 0),
      chart TEXT,
      last_cost BIGINT NOT NULL DEFAULT 0 CHECK (last_cost >= 0),
      opening_entry_id ${ID},
      active INT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (fuel_type_id) REFERENCES fuel_types(id),
      FOREIGN KEY (opening_entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'fuel_pumps',
    since: 16,
    sql: `CREATE TABLE fuel_pumps (
      id ${ID} NOT NULL PRIMARY KEY,
      number INT NOT NULL UNIQUE CHECK (number > 0),
      active INT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at ${WHEN} NOT NULL
    )`
  },
  {
    name: 'fuel_nozzles',
    since: 16,
    sql: `CREATE TABLE fuel_nozzles (
      id ${ID} NOT NULL PRIMARY KEY,
      pump_id ${ID} NOT NULL,
      number INT NOT NULL CHECK (number > 0),
      fuel_type_id ${ID} NOT NULL,
      tank_id ${ID} NOT NULL,
      meter_milli BIGINT NOT NULL DEFAULT 0 CHECK (meter_milli >= 0),
      meter_max_milli BIGINT NOT NULL DEFAULT 999999990 CHECK (meter_max_milli > 0),
      active INT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at ${WHEN} NOT NULL,
      UNIQUE KEY fuel_nozzles_pump_number (pump_id, number),
      FOREIGN KEY (pump_id) REFERENCES fuel_pumps(id),
      FOREIGN KEY (fuel_type_id) REFERENCES fuel_types(id),
      FOREIGN KEY (tank_id) REFERENCES fuel_tanks(id)
    )`
  },
  {
    name: 'fuel_shifts',
    since: 16,
    sql: `CREATE TABLE fuel_shifts (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      date ${WHEN} NOT NULL,
      shift ${WORD} NOT NULL CHECK (shift IN ('morning', 'evening', 'night')),
      attendant TEXT NOT NULL,
      status ${WORD} NOT NULL CHECK (status IN ('open', 'closed', 'reversed')),
      credit BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0),
      handed BIGINT CHECK (handed IS NULL OR handed >= 0),
      sales BIGINT,
      cost BIGINT,
      difference BIGINT,
      cash_account ${ID},
      entry_id ${ID},
      reversal_entry_id ${ID},
      notes TEXT,
      opened_by TEXT NOT NULL,
      opened_at ${WHEN} NOT NULL,
      closed_by TEXT,
      closed_at ${WHEN},
      reversed_by TEXT,
      reversed_at ${WHEN},
      reverse_reason TEXT,
      INDEX fuel_shifts_date (date),
      FOREIGN KEY (cash_account) REFERENCES accounts(code),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (reversal_entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'fuel_readings',
    since: 16,
    sql: `CREATE TABLE fuel_readings (
      shift_id ${ID} NOT NULL,
      nozzle_id ${ID} NOT NULL,
      fuel_type_id ${ID} NOT NULL,
      tank_id ${ID} NOT NULL,
      price BIGINT NOT NULL CHECK (price > 0),
      opening_milli BIGINT NOT NULL CHECK (opening_milli >= 0),
      closing_milli BIGINT CHECK (closing_milli IS NULL OR closing_milli >= 0),
      meter_max_milli BIGINT NOT NULL CHECK (meter_max_milli > 0),
      rollover INT NOT NULL DEFAULT 0 CHECK (rollover IN (0, 1)),
      cost BIGINT,
      PRIMARY KEY (shift_id, nozzle_id),
      INDEX fuel_readings_nozzle (nozzle_id),
      FOREIGN KEY (shift_id) REFERENCES fuel_shifts(id) ON DELETE CASCADE,
      FOREIGN KEY (nozzle_id) REFERENCES fuel_nozzles(id),
      FOREIGN KEY (fuel_type_id) REFERENCES fuel_types(id),
      FOREIGN KEY (tank_id) REFERENCES fuel_tanks(id)
    )`
  },
  {
    name: 'fuel_deliveries',
    since: 16,
    sql: `CREATE TABLE fuel_deliveries (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      date ${WHEN} NOT NULL,
      tank_id ${ID} NOT NULL,
      supplier_id ${ID} NOT NULL,
      note_no ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
      cost_per_litre BIGINT NOT NULL CHECK (cost_per_litre > 0),
      cost BIGINT NOT NULL CHECK (cost > 0),
      payment ${WORD} NOT NULL CHECK (payment IN ('cash', 'credit')),
      cash_account ${ID},
      status ${WORD} NOT NULL CHECK (status IN ('posted', 'reversed')),
      entry_id ${ID},
      reversal_entry_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      reversed_by TEXT,
      reversed_at ${WHEN},
      reverse_reason TEXT,
      INDEX fuel_deliveries_note (supplier_id, note_no),
      INDEX fuel_deliveries_date (date),
      FOREIGN KEY (tank_id) REFERENCES fuel_tanks(id),
      FOREIGN KEY (supplier_id) REFERENCES parties(id),
      FOREIGN KEY (cash_account) REFERENCES accounts(code),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (reversal_entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'fuel_dips',
    since: 16,
    sql: `CREATE TABLE fuel_dips (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      date ${WHEN} NOT NULL,
      tank_id ${ID} NOT NULL,
      dip_mm INT CHECK (dip_mm IS NULL OR dip_mm >= 0),
      measured_milli BIGINT NOT NULL CHECK (measured_milli >= 0),
      book_milli BIGINT NOT NULL,
      variance_milli BIGINT NOT NULL,
      value BIGINT NOT NULL,
      status ${WORD} NOT NULL CHECK (status IN ('posted', 'reversed')),
      entry_id ${ID},
      reversal_entry_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      reversed_by TEXT,
      reversed_at ${WHEN},
      reverse_reason TEXT,
      INDEX fuel_dips_tank (tank_id, date),
      FOREIGN KEY (tank_id) REFERENCES fuel_tanks(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (reversal_entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'fuel_moves',
    since: 16,
    sql: `CREATE TABLE fuel_moves (
      id ${ID} NOT NULL PRIMARY KEY,
      tank_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      kind ${WORD} NOT NULL CHECK (kind IN ('opening', 'delivery', 'sale', 'dip')),
      source_id ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL,
      value BIGINT NOT NULL,
      created_at ${WHEN} NOT NULL,
      INDEX fuel_moves_tank (tank_id, date),
      INDEX fuel_moves_source (source_id),
      FOREIGN KEY (tank_id) REFERENCES fuel_tanks(id)
    )`
  },
  // ——— v17: supermarket reports (db.ts V17) ———
  {
    // 17: shelf labels to reprint (shelf-labels.ts)
    name: 'shelf_label_flags',
    since: 17,
    sql: `CREATE TABLE shelf_label_flags (
      item_id ${ID} NOT NULL,
      unit ${WORD} NOT NULL DEFAULT '',
      old_price BIGINT CHECK (old_price IS NULL OR old_price >= 0),
      new_price BIGINT NOT NULL CHECK (new_price >= 0),
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      changed_at ${WHEN} NOT NULL,
      changed_by TEXT NOT NULL,
      PRIMARY KEY (item_id, unit),
      INDEX shelf_label_flags_changed (changed_at),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  // ——— end v17: supermarket reports ———
  // ===== 17 · CONSIGNMENT (db.ts V17, consignment.ts) — begin =====
  {
    name: 'consignment_items',
    since: 17,
    sql: `CREATE TABLE consignment_items (
      item_id ${ID} NOT NULL PRIMARY KEY,
      supplier_id ${ID} NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      unit_cost BIGINT NOT NULL CHECK (unit_cost >= 0),
      active INT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      INDEX consignment_items_supplier (supplier_id),
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (supplier_id) REFERENCES parties(id)
    )`
  },
  {
    name: 'consignment_docs',
    since: 17,
    sql: `CREATE TABLE consignment_docs (
      id ${ID} NOT NULL PRIMARY KEY,
      kind ${WORD} NOT NULL CHECK (kind IN ('receipt', 'return')),
      number ${ID} UNIQUE,
      date ${WHEN} NOT NULL,
      supplier_id ${ID} NOT NULL,
      warehouse_id ${ID} NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      rate_x100 BIGINT NOT NULL CHECK (rate_x100 > 0),
      status ${WORD} NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
      entry_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      prepared_by_id ${ID},
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      INDEX consignment_docs_supplier (supplier_id, date),
      FOREIGN KEY (supplier_id) REFERENCES parties(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (prepared_by_id) REFERENCES users(id)
    )`
  },
  {
    name: 'consignment_doc_lines',
    since: 17,
    sql: `CREATE TABLE consignment_doc_lines (
      doc_id ${ID} NOT NULL,
      seq INT NOT NULL,
      item_id ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
      unit_cost BIGINT,
      unit ${WORD},
      unit_factor_milli BIGINT,
      unit_qty_milli BIGINT,
      batch_no ${BATCH},
      expiry ${WHEN},
      batch_id ${ID},
      PRIMARY KEY (doc_id, seq),
      FOREIGN KEY (doc_id) REFERENCES consignment_docs(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'consignment_settlements',
    since: 17,
    sql: `CREATE TABLE consignment_settlements (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      date ${WHEN} NOT NULL,
      supplier_id ${ID} NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      rate_x100 BIGINT NOT NULL CHECK (rate_x100 > 0),
      amount BIGINT NOT NULL CHECK (amount > 0),
      book_value BIGINT NOT NULL,
      status ${WORD} NOT NULL CHECK (status IN ('open', 'cancelled')),
      entry_id ${ID},
      cancel_entry_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      INDEX consignment_settlements_supplier (supplier_id, date),
      FOREIGN KEY (supplier_id) REFERENCES parties(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (cancel_entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'consignment_moves',
    since: 17,
    sql: `CREATE TABLE consignment_moves (
      id ${ID} NOT NULL PRIMARY KEY,
      item_id ${ID} NOT NULL,
      supplier_id ${ID} NOT NULL,
      warehouse_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      kind ${WORD} NOT NULL CHECK (kind IN ('received', 'returned', 'sold', 'transfer')),
      source_type ${WORD} NOT NULL,
      source_id ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL,
      value BIGINT NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      ccy_value BIGINT NOT NULL,
      settlement_id ${ID},
      created_at ${WHEN} NOT NULL,
      INDEX consignment_moves_item (item_id, warehouse_id),
      INDEX consignment_moves_supplier (supplier_id, kind, date),
      INDEX consignment_moves_settlement (settlement_id),
      INDEX consignment_moves_source (source_type, source_id),
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (supplier_id) REFERENCES parties(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (settlement_id) REFERENCES consignment_settlements(id)
    )`
  },
  // ===== 17 · CONSIGNMENT — end =====
  // ===== 17 · OFFERS (db.ts V17) =====
  {
    name: 'offers',
    since: 17,
    sql: `CREATE TABLE offers (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${ID} NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ku TEXT NOT NULL,
      kind ${WORD} NOT NULL CHECK (kind IN ('buyGet', 'bundle', 'price')),
      active INT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      priority INT NOT NULL DEFAULT 0 CHECK (priority >= 0),
      exclusive INT NOT NULL DEFAULT 0 CHECK (exclusive IN (0, 1)),
      max_per_sale BIGINT CHECK (max_per_sale IS NULL OR max_per_sale > 0),
      starts_on ${WHEN},
      ends_on ${WHEN},
      weekdays ${WORD},
      from_time ${WORD},
      to_time ${WORD},
      branch_ids TEXT,
      items TEXT NOT NULL,
      categories TEXT NOT NULL,
      get_items TEXT NOT NULL,
      get_categories TEXT NOT NULL,
      buy_milli BIGINT,
      get_milli BIGINT,
      get_percent INT,
      bundle_milli BIGINT,
      bundle_price BIGINT,
      price BIGINT,
      percent_off INT,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL
    )`
  },
  {
    name: 'invoice_offer_lines',
    since: 17,
    sql: `CREATE TABLE invoice_offer_lines (
      invoice_id ${ID} NOT NULL,
      line_no INT NOT NULL,
      offer_id ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL CHECK (qty_milli >= 0),
      discount BIGINT NOT NULL CHECK (discount >= 0),
      PRIMARY KEY (invoice_id, line_no, offer_id),
      INDEX invoice_offer_lines_offer (offer_id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (offer_id) REFERENCES offers(id)
    )`
  },
  // ===== 18 · TILL RULES (till-rules.ts, gift-vouchers.ts) =====
  {
    name: 'pos_pins',
    since: 18,
    sql: `CREATE TABLE pos_pins (
      user_id ${ID} NOT NULL PRIMARY KEY,
      pin_hash TEXT NOT NULL,
      digits INT,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  },
  {
    name: 'pos_approvals',
    since: 18,
    sql: `CREATE TABLE pos_approvals (
      id ${ID} NOT NULL PRIMARY KEY,
      shift_id ${ID} NOT NULL,
      action ${WORD} NOT NULL CHECK (action IN ('line_delete', 'void', 'price', 'discount', 'no_sale', 'refund', 'credit_over', 'blind_view')),
      approver TEXT NOT NULL,
      approver_id ${ID},
      cashier TEXT NOT NULL,
      detail TEXT,
      created_at ${WHEN} NOT NULL,
      expires_at ${WHEN} NOT NULL,
      used_at ${WHEN},
      INDEX pos_approvals_shift (shift_id),
      FOREIGN KEY (shift_id) REFERENCES pos_shifts(id)
    )`
  },
  // ——— 19: the approvals as they are now (pos_approvals above stays, empty and unused), the PIN counts, the shift
  // that paid a refund, and the items' price history ———
  {
    name: 'till_approvals',
    since: 19,
    sql: `CREATE TABLE till_approvals (
      id ${ID} NOT NULL PRIMARY KEY,
      shift_id ${ID},
      action ${WORD} NOT NULL,
      approver TEXT NOT NULL,
      approver_id ${ID},
      cashier TEXT NOT NULL,
      cashier_id ${ID},
      subject VARCHAR(160),
      amount BIGINT,
      currency ${WORD},
      gross BIGINT,
      scope TEXT,
      detail TEXT,
      created_at ${WHEN} NOT NULL,
      expires_at ${WHEN} NOT NULL,
      used_at ${WHEN},
      INDEX till_approvals_shift (shift_id),
      FOREIGN KEY (shift_id) REFERENCES pos_shifts(id)
    )`
  },
  {
    name: 'pos_pin_tries',
    since: 19,
    sql: `CREATE TABLE pos_pin_tries (
      k VARCHAR(160) NOT NULL PRIMARY KEY,
      n INT NOT NULL DEFAULT 0,
      since ${WHEN} NOT NULL,
      locked_until ${WHEN},
      day_on ${WHEN},
      day_n INT NOT NULL DEFAULT 0
    )`
  },
  {
    name: 'pos_shift_refunds',
    since: 19,
    sql: `CREATE TABLE pos_shift_refunds (
      invoice_id ${ID} NOT NULL PRIMARY KEY,
      shift_id ${ID} NOT NULL,
      created_at ${WHEN} NOT NULL,
      INDEX pos_shift_refunds_shift (shift_id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (shift_id) REFERENCES pos_shifts(id)
    )`
  },
  {
    name: 'item_price_history',
    since: 19,
    sql: `CREATE TABLE item_price_history (
      id ${ID} NOT NULL PRIMARY KEY,
      item_id ${ID} NOT NULL,
      unit ${WORD} NOT NULL DEFAULT '',
      price BIGINT NOT NULL,
      currency ${WORD} NOT NULL,
      changed_at ${WHEN} NOT NULL,
      INDEX item_price_history_item (item_id, unit, changed_at),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  // ——— 20: what the open product databases answered for a barcode (kept a while, a "not found" too), and where an
  // item's picture came from when it came from one of them (its credit) ———
  {
    name: 'product_lookups',
    since: 20,
    sql: `CREATE TABLE product_lookups (
      barcode VARCHAR(64) NOT NULL PRIMARY KEY,
      found TINYINT NOT NULL DEFAULT 0 CHECK (found IN (0, 1)),
      source ${WORD},
      name TEXT,
      name_ar TEXT,
      name_en TEXT,
      name_ku TEXT,
      brand TEXT,
      quantity TEXT,
      image_url TEXT,
      image_small_url TEXT,
      page_url TEXT,
      looked_at ${WHEN} NOT NULL,
      INDEX product_lookups_when (looked_at)
    )`
  },
  {
    name: 'item_image_sources',
    since: 20,
    sql: `CREATE TABLE item_image_sources (
      item_id ${ID} NOT NULL PRIMARY KEY,
      source ${WORD} NOT NULL,
      licence ${WORD} NOT NULL,
      url TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'gift_vouchers',
    since: 18,
    sql: `CREATE TABLE gift_vouchers (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${WORD} NOT NULL,
      amount BIGINT NOT NULL CHECK (amount > 0),
      balance BIGINT NOT NULL CHECK (balance >= 0),
      currency ${WORD} NOT NULL DEFAULT 'IQD' CHECK (currency IN ('IQD')),
      expires_on ${WHEN},
      status ${WORD} NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
      account_code ${ID} NOT NULL,
      shift_id ${ID},
      entry_id ${ID},
      cancel_entry_id ${ID},
      expire_entry_id ${ID},
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      UNIQUE KEY gift_vouchers_code (code),
      INDEX gift_vouchers_shift (shift_id),
      INDEX gift_vouchers_entry (entry_id),
      INDEX gift_vouchers_cancel_entry (cancel_entry_id),
      INDEX gift_vouchers_expire_entry (expire_entry_id),
      FOREIGN KEY (account_code) REFERENCES accounts(code),
      FOREIGN KEY (shift_id) REFERENCES pos_shifts(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (cancel_entry_id) REFERENCES entries(id),
      FOREIGN KEY (expire_entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'gift_voucher_moves',
    since: 18,
    sql: `CREATE TABLE gift_voucher_moves (
      id ${ID} NOT NULL PRIMARY KEY,
      voucher_id ${ID} NOT NULL,
      kind ${WORD} NOT NULL CHECK (kind IN ('sold', 'redeemed', 'restored', 'cancelled', 'returned', 'expired')),
      amount BIGINT NOT NULL,
      invoice_id ${ID},
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      for_voucher_id ${ID},
      INDEX gift_voucher_moves_voucher (voucher_id),
      INDEX gift_voucher_moves_invoice (invoice_id),
      FOREIGN KEY (voucher_id) REFERENCES gift_vouchers(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    name: 'pos_display_images',
    since: 18,
    sql: `CREATE TABLE pos_display_images (
      id ${ID} NOT NULL PRIMARY KEY,
      mime ${WORD} NOT NULL,
      data MEDIUMTEXT NOT NULL,
      sort INT NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL
    )`
  },
  {
    name: 'pos_display_codes',
    since: 18,
    sql: `CREATE TABLE pos_display_codes (
      till_id ${ID} NOT NULL PRIMARY KEY,
      code_hash TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      FOREIGN KEY (till_id) REFERENCES pos_tills(id)
    )`
  },
  {
    name: 'pos_display_keys',
    since: 18,
    sql: `CREATE TABLE pos_display_keys (
      key_hash VARCHAR(64) NOT NULL PRIMARY KEY,
      till_id ${ID} NOT NULL,
      created_at ${WHEN} NOT NULL,
      seen_at ${WHEN},
      INDEX pos_display_keys_till (till_id),
      FOREIGN KEY (till_id) REFERENCES pos_tills(id)
    )`
  },
  // ===== end 18 · TILL RULES =====
  // ===== 18 · GOLD (db.ts V18, gold.ts) — begin =====
  {
    name: 'gold_items',
    since: 18,
    sql: `CREATE TABLE gold_items (
      item_id ${ID} NOT NULL PRIMARY KEY,
      weight_mg BIGINT NOT NULL CHECK (weight_mg > 0),
      karat INT NOT NULL CHECK (karat IN (18, 21, 22, 24)),
      making_kind ${WORD} NOT NULL CHECK (making_kind IN ('gram', 'piece')),
      making_amount BIGINT NOT NULL DEFAULT 0 CHECK (making_amount >= 0),
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'gold_prices',
    since: 18,
    sql: `CREATE TABLE gold_prices (
      id ${ID} NOT NULL PRIMARY KEY,
      date ${WHEN} NOT NULL,
      karat INT NOT NULL CHECK (karat IN (18, 21, 22, 24)),
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      buy_per_gram BIGINT NOT NULL CHECK (buy_per_gram >= 0),
      sell_per_gram BIGINT NOT NULL CHECK (sell_per_gram >= 0),
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      UNIQUE KEY gold_prices_day (date, karat, currency)
    )`
  },
  {
    name: 'gold_suppliers',
    since: 18,
    sql: `CREATE TABLE gold_suppliers (
      party_id ${ID} NOT NULL PRIMARY KEY,
      basis_karat INT NOT NULL CHECK (basis_karat IN (21, 24)),
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )`
  },
  {
    name: 'gold_docs',
    since: 18,
    sql: `CREATE TABLE gold_docs (
      id ${ID} NOT NULL PRIMARY KEY,
      kind ${WORD} NOT NULL CHECK (kind IN ('buy', 'melt', 'receipt', 'delivery')),
      number ${ID} UNIQUE,
      date ${WHEN} NOT NULL,
      status ${WORD} NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
      party_id ${ID},
      customer_name TEXT,
      warehouse_id ${ID},
      cash_account ${ID},
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      rate_x100 BIGINT NOT NULL CHECK (rate_x100 > 0),
      karat INT CHECK (karat IS NULL OR karat IN (18, 21, 22, 24)),
      weight_mg BIGINT CHECK (weight_mg IS NULL OR weight_mg > 0),
      price_per_gram BIGINT CHECK (price_per_gram IS NULL OR price_per_gram >= 0),
      karat_out INT CHECK (karat_out IS NULL OR karat_out IN (18, 21, 22, 24)),
      weight_out_mg BIGINT CHECK (weight_out_mg IS NULL OR weight_out_mg > 0),
      entry_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      prepared_by_id ${ID},
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      INDEX gold_docs_kind (kind, date),
      INDEX gold_docs_party (party_id),
      INDEX gold_docs_entry (entry_id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (cash_account) REFERENCES accounts(code),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (prepared_by_id) REFERENCES users(id)
    )`
  },
  {
    name: 'gold_doc_lines',
    since: 18,
    sql: `CREATE TABLE gold_doc_lines (
      doc_id ${ID} NOT NULL,
      seq INT NOT NULL,
      item_id ${ID} NOT NULL,
      making BIGINT NOT NULL DEFAULT 0 CHECK (making >= 0),
      PRIMARY KEY (doc_id, seq),
      INDEX gold_doc_lines_item (item_id),
      FOREIGN KEY (doc_id) REFERENCES gold_docs(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'gold_scrap_moves',
    since: 18,
    sql: `CREATE TABLE gold_scrap_moves (
      id ${ID} NOT NULL PRIMARY KEY,
      date ${WHEN} NOT NULL,
      karat INT NOT NULL CHECK (karat IN (18, 21, 22, 24)),
      weight_mg BIGINT NOT NULL,
      value BIGINT NOT NULL,
      source_type ${WORD} NOT NULL,
      source_id ${ID} NOT NULL,
      created_at ${WHEN} NOT NULL,
      INDEX gold_scrap_moves_karat (karat, date),
      INDEX gold_scrap_moves_source (source_id)
    )`
  },
  {
    name: 'gold_supplier_moves',
    since: 18,
    sql: `CREATE TABLE gold_supplier_moves (
      id ${ID} NOT NULL PRIMARY KEY,
      party_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      fine_mg BIGINT NOT NULL,
      value BIGINT NOT NULL,
      source_type ${WORD} NOT NULL,
      source_id ${ID} NOT NULL,
      created_at ${WHEN} NOT NULL,
      INDEX gold_supplier_moves_party (party_id, date),
      INDEX gold_supplier_moves_source (source_id),
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )`
  },
  // ===== 18 · GOLD — end =====
  // ===== 18 · WHOLESALE (db.ts V18, wholesale.ts) — begin =====
  {
    name: 'ws_reps',
    since: 18,
    sql: `CREATE TABLE ws_reps (
      id ${ID} NOT NULL PRIMARY KEY,
      user_id ${ID} NOT NULL UNIQUE,
      name TEXT NOT NULL,
      warehouse_id ${ID} NOT NULL UNIQUE,
      load_warehouse_id ${ID} NOT NULL,
      cash_account ${ID} NOT NULL,
      active INT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (load_warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (cash_account) REFERENCES accounts(code)
    )`
  },
  {
    name: 'ws_route_stops',
    since: 18,
    sql: `CREATE TABLE ws_route_stops (
      id ${ID} NOT NULL PRIMARY KEY,
      rep_id ${ID} NOT NULL,
      weekday INT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      party_id ${ID} NOT NULL,
      seq INT NOT NULL CHECK (seq >= 0),
      UNIQUE KEY ws_route_stops_unique (rep_id, weekday, party_id),
      INDEX ws_route_stops_party (party_id),
      FOREIGN KEY (rep_id) REFERENCES ws_reps(id),
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )`
  },
  {
    name: 'ws_visits',
    since: 18,
    sql: `CREATE TABLE ws_visits (
      id ${ID} NOT NULL PRIMARY KEY,
      rep_id ${ID} NOT NULL,
      party_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      outcome ${WORD} NOT NULL CHECK (outcome IN ('order', 'no_order', 'closed', 'collected')),
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      INDEX ws_visits_rep (rep_id, date),
      FOREIGN KEY (rep_id) REFERENCES ws_reps(id),
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )`
  },
  {
    name: 'ws_orders',
    since: 18,
    sql: `CREATE TABLE ws_orders (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      rep_id ${ID},
      party_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      warehouse_id ${ID} NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      rate_x100 BIGINT NOT NULL CHECK (rate_x100 > 0),
      status ${WORD} NOT NULL CHECK (status IN ('draft', 'approved', 'delivered', 'cancelled')),
      total BIGINT NOT NULL CHECK (total >= 0),
      limit_check ${WORD} CHECK (limit_check IS NULL OR limit_check IN ('ok', 'warn', 'override')),
      override_by TEXT,
      override_reason TEXT,
      approved_by TEXT,
      approved_at ${WHEN},
      invoice_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      INDEX ws_orders_party (party_id, date),
      INDEX ws_orders_rep (rep_id, date),
      INDEX ws_orders_invoice (invoice_id),
      FOREIGN KEY (rep_id) REFERENCES ws_reps(id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    name: 'ws_order_lines',
    since: 18,
    sql: `CREATE TABLE ws_order_lines (
      order_id ${ID} NOT NULL,
      line_no INT NOT NULL,
      item_id ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
      unit ${WORD},
      unit_qty_milli BIGINT,
      unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
      amount BIGINT NOT NULL CHECK (amount >= 0),
      PRIMARY KEY (order_id, line_no),
      FOREIGN KEY (order_id) REFERENCES ws_orders(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'ws_van_counts',
    since: 18,
    sql: `CREATE TABLE ws_van_counts (
      id ${ID} NOT NULL PRIMARY KEY,
      rep_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      status ${WORD} NOT NULL CHECK (status IN ('open', 'closed')),
      adjustment_id ${ID},
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      closed_by TEXT,
      closed_at ${WHEN},
      UNIQUE KEY ws_van_counts_day (rep_id, date),
      FOREIGN KEY (rep_id) REFERENCES ws_reps(id),
      FOREIGN KEY (adjustment_id) REFERENCES stock_adjustments(id)
    )`
  },
  {
    name: 'ws_van_count_lines',
    since: 18,
    sql: `CREATE TABLE ws_van_count_lines (
      count_id ${ID} NOT NULL,
      item_id ${ID} NOT NULL,
      expected_milli BIGINT NOT NULL,
      counted_milli BIGINT NOT NULL CHECK (counted_milli >= 0),
      PRIMARY KEY (count_id, item_id),
      FOREIGN KEY (count_id) REFERENCES ws_van_counts(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'ws_handovers',
    since: 18,
    sql: `CREATE TABLE ws_handovers (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      rep_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      to_account ${ID} NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      rate_x100 BIGINT NOT NULL CHECK (rate_x100 > 0),
      amount BIGINT NOT NULL CHECK (amount > 0),
      entry_id ${ID},
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      cancelled_at ${WHEN},
      cancel_entry_id ${ID},
      INDEX ws_handovers_rep (rep_id),
      INDEX ws_handovers_entry (entry_id),
      FOREIGN KEY (rep_id) REFERENCES ws_reps(id),
      FOREIGN KEY (to_account) REFERENCES accounts(code),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (cancel_entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'ws_collections',
    since: 18,
    sql: `CREATE TABLE ws_collections (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      rep_id ${ID} NOT NULL,
      party_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      rate_x100 BIGINT NOT NULL CHECK (rate_x100 > 0),
      amount BIGINT NOT NULL CHECK (amount > 0),
      entry_id ${ID},
      handover_id ${ID},
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      cancelled_at ${WHEN},
      cancel_entry_id ${ID},
      INDEX ws_collections_rep (rep_id, date),
      INDEX ws_collections_entry (entry_id),
      INDEX ws_collections_handover (handover_id),
      FOREIGN KEY (rep_id) REFERENCES ws_reps(id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id),
      FOREIGN KEY (handover_id) REFERENCES ws_handovers(id),
      FOREIGN KEY (cancel_entry_id) REFERENCES entries(id)
    )`
  },
  // ===== end 18 · WHOLESALE =====
  // ===== 18 · MARKET EXTRAS (db.ts V18) — begin =====
  {
    name: 'delivery_drivers',
    since: 18,
    sql: `CREATE TABLE delivery_drivers (
      id ${ID} NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      user_id ${ID},
      cash_account ${ID},
      active INT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (cash_account) REFERENCES accounts(code)
    )`
  },
  {
    name: 'delivery_orders',
    since: 18,
    sql: `CREATE TABLE delivery_orders (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${ID} NOT NULL UNIQUE,
      status ${WORD} NOT NULL CHECK (status IN ('new', 'preparing', 'out', 'delivered', 'cancelled')),
      party_id ${ID},
      customer_name TEXT NOT NULL,
      phone TEXT,
      address TEXT NOT NULL,
      area TEXT,
      notes TEXT,
      lang ${WORD} CHECK (lang IS NULL OR lang IN ('ar', 'en', 'ku')),
      warehouse_id ${ID} NOT NULL,
      payment ${WORD} NOT NULL CHECK (payment IN ('cod', 'account')),
      fee BIGINT NOT NULL DEFAULT 0 CHECK (fee >= 0),
      driver_id ${ID},
      invoice_id ${ID},
      cancel_reason TEXT,
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      out_at ${WHEN},
      delivered_at ${WHEN},
      INDEX delivery_orders_status (status, created_at),
      INDEX delivery_orders_party (party_id),
      INDEX delivery_orders_driver (driver_id),
      INDEX delivery_orders_invoice (invoice_id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (driver_id) REFERENCES delivery_drivers(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    name: 'delivery_order_lines',
    since: 18,
    sql: `CREATE TABLE delivery_order_lines (
      order_id ${ID} NOT NULL,
      line_no INT NOT NULL,
      item_id ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
      unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
      unit ${WORD},
      unit_qty_milli BIGINT CHECK (unit_qty_milli IS NULL OR unit_qty_milli > 0),
      PRIMARY KEY (order_id, line_no),
      FOREIGN KEY (order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'delivery_handovers',
    since: 18,
    sql: `CREATE TABLE delivery_handovers (
      id ${ID} NOT NULL PRIMARY KEY,
      driver_id ${ID} NOT NULL,
      entry_id ${ID} NOT NULL,
      amount BIGINT NOT NULL CHECK (amount > 0),
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      INDEX delivery_handovers_driver (driver_id, created_at),
      INDEX delivery_handovers_entry (entry_id),
      FOREIGN KEY (driver_id) REFERENCES delivery_drivers(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id)
    )`
  },
  {
    name: 'party_reminders',
    since: 18,
    sql: `CREATE TABLE party_reminders (
      id ${ID} NOT NULL PRIMARY KEY,
      party_id ${ID} NOT NULL,
      amount BIGINT NOT NULL,
      currency ${WORD} NOT NULL CHECK (currency IN ('IQD', 'USD')),
      days INT NOT NULL CHECK (days >= 0),
      lang ${WORD} NOT NULL CHECK (lang IN ('ar', 'en', 'ku')),
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      INDEX party_reminders_party (party_id, created_at),
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )`
  },
  {
    name: 'price_checker_devices',
    since: 18,
    sql: `CREATE TABLE price_checker_devices (
      id ${ID} NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash ${ID} NOT NULL UNIQUE,
      warehouse_id ${ID},
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      last_seen_at ${WHEN},
      revoked_at ${WHEN},
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    )`
  },
  {
    name: 'daily_supplier_items',
    since: 18,
    sql: `CREATE TABLE daily_supplier_items (
      party_id ${ID} NOT NULL,
      item_id ${ID} NOT NULL,
      sort INT NOT NULL DEFAULT 0,
      unit_cost BIGINT CHECK (unit_cost IS NULL OR unit_cost >= 0),
      PRIMARY KEY (party_id, item_id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'daily_receipts',
    since: 18,
    sql: `CREATE TABLE daily_receipts (
      id ${ID} NOT NULL PRIMARY KEY,
      party_id ${ID} NOT NULL,
      date ${WHEN} NOT NULL,
      warehouse_id ${ID} NOT NULL,
      purchase_id ${ID},
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      INDEX daily_receipts_party (party_id, date),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (purchase_id) REFERENCES invoices(id)
    )`
  },
  {
    name: 'daily_receipt_lines',
    since: 18,
    sql: `CREATE TABLE daily_receipt_lines (
      receipt_id ${ID} NOT NULL,
      item_id ${ID} NOT NULL,
      received_milli BIGINT NOT NULL CHECK (received_milli >= 0),
      returned_milli BIGINT NOT NULL CHECK (returned_milli >= 0),
      unit_cost BIGINT NOT NULL CHECK (unit_cost >= 0),
      PRIMARY KEY (receipt_id, item_id),
      FOREIGN KEY (receipt_id) REFERENCES daily_receipts(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'daily_receipt_returns',
    since: 18,
    sql: `CREATE TABLE daily_receipt_returns (
      receipt_id ${ID} NOT NULL,
      return_id ${ID} NOT NULL,
      PRIMARY KEY (receipt_id, return_id),
      FOREIGN KEY (receipt_id) REFERENCES daily_receipts(id) ON DELETE CASCADE,
      FOREIGN KEY (return_id) REFERENCES invoices(id)
    )`
  },
  // ===== end 18 · MARKET EXTRAS =====
  // ===== 18 · CLOTHING (db.ts V18, clothing.ts) — begin =====
  {
    name: 'cl_colors',
    since: 18,
    sql: `CREATE TABLE cl_colors (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${WORD} NOT NULL,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ku TEXT NOT NULL,
      hex ${WORD},
      sort INT NOT NULL DEFAULT 0,
      active INT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      UNIQUE KEY cl_colors_code (code)
    )`
  },
  {
    name: 'cl_models',
    since: 18,
    sql: `CREATE TABLE cl_models (
      id ${ID} NOT NULL PRIMARY KEY,
      code ${ID} NOT NULL,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ku TEXT NOT NULL,
      sizes TEXT NOT NULL,
      season ${ID},
      category_id ${ID},
      brand_id ${ID},
      unit ${WORD} NOT NULL,
      sale_price BIGINT NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
      sale_currency ${WORD} NOT NULL CHECK (sale_currency IN ('IQD', 'USD')),
      purchase_price BIGINT CHECK (purchase_price IS NULL OR purchase_price >= 0),
      purchase_currency ${WORD} CHECK (purchase_currency IS NULL OR purchase_currency IN ('IQD', 'USD')),
      active INT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_by TEXT NOT NULL,
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      UNIQUE KEY cl_models_code (code),
      INDEX cl_models_season (season),
      INDEX cl_models_category (category_id),
      FOREIGN KEY (category_id) REFERENCES item_categories(id),
      FOREIGN KEY (brand_id) REFERENCES brands(id)
    )`
  },
  {
    name: 'cl_variants',
    since: 18,
    sql: `CREATE TABLE cl_variants (
      item_id ${ID} NOT NULL PRIMARY KEY,
      model_id ${ID} NOT NULL,
      size ${WORD} NOT NULL,
      color_id ${ID} NOT NULL DEFAULT '',
      created_at ${WHEN} NOT NULL,
      UNIQUE KEY cl_variants_cell (model_id, size, color_id),
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (model_id) REFERENCES cl_models(id)
    )`
  },
  // ===== end 18 · CLOTHING =====
  // ===== 22 · RESTAURANTS AND CAFÉS (db.ts V22, restaurant.ts) — begin =====
  {
    name: 'rs_areas',
    since: 22,
    sql: `CREATE TABLE rs_areas (
      id ${ID} NOT NULL PRIMARY KEY,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ku TEXT NOT NULL,
      family INT NOT NULL DEFAULT 0 CHECK (family IN (0, 1)),
      sort INT NOT NULL DEFAULT 0,
      active INT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL
    )`
  },
  {
    name: 'rs_tables',
    since: 22,
    sql: `CREATE TABLE rs_tables (
      id ${ID} NOT NULL PRIMARY KEY,
      area_id ${ID} NOT NULL,
      name ${WORD} NOT NULL,
      seats INT NOT NULL DEFAULT 4 CHECK (seats >= 1),
      sort INT NOT NULL DEFAULT 0,
      active INT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      UNIQUE KEY rs_tables_name (area_id, name),
      FOREIGN KEY (area_id) REFERENCES rs_areas(id)
    )`
  },
  {
    name: 'rs_orders',
    since: 22,
    sql: `CREATE TABLE rs_orders (
      id ${ID} NOT NULL PRIMARY KEY,
      number ${WORD} NOT NULL,
      kind ${WORD} NOT NULL CHECK (kind IN ('table', 'takeaway', 'delivery')),
      table_id ${ID},
      guests INT CHECK (guests IS NULL OR guests >= 1),
      party_id ${ID},
      phone ${WORD},
      address TEXT,
      notes TEXT,
      status ${WORD} NOT NULL CHECK (status IN ('open', 'closed', 'cancelled')),
      warehouse_id ${ID} NOT NULL,
      tickets INT NOT NULL DEFAULT 0,
      bill_printed_at ${WHEN},
      opened_by TEXT NOT NULL,
      opened_by_id ${ID},
      opened_at ${WHEN} NOT NULL,
      updated_at ${WHEN} NOT NULL,
      closed_at ${WHEN},
      closed_by TEXT,
      cancel_reason TEXT,
      UNIQUE KEY rs_orders_number (number),
      INDEX rs_orders_status (status, opened_at),
      INDEX rs_orders_table (table_id, status),
      FOREIGN KEY (table_id) REFERENCES rs_tables(id),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    )`
  },
  {
    name: 'rs_order_lines',
    since: 22,
    sql: `CREATE TABLE rs_order_lines (
      id ${ID} NOT NULL PRIMARY KEY,
      order_id ${ID} NOT NULL,
      line_no INT NOT NULL,
      item_id ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
      unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
      note TEXT,
      ticket INT,
      sent_at ${WHEN},
      voided_at ${WHEN},
      voided_by TEXT,
      void_reason TEXT,
      added_by TEXT NOT NULL,
      added_at ${WHEN} NOT NULL,
      station ${WORD} CHECK (station IS NULL OR station IN ('kitchen', 'grill', 'bar')),
      ready_at ${WHEN},
      ready_by TEXT,
      served_at ${WHEN},
      UNIQUE KEY rs_order_lines_no (order_id, line_no),
      INDEX rs_order_lines_item (item_id),
      INDEX rs_order_lines_sent (sent_at),
      FOREIGN KEY (order_id) REFERENCES rs_orders(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  },
  {
    name: 'rs_paid',
    since: 22,
    sql: `CREATE TABLE rs_paid (
      id ${ID} NOT NULL PRIMARY KEY,
      order_id ${ID} NOT NULL,
      line_id ${ID} NOT NULL,
      invoice_id ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
      created_at ${WHEN} NOT NULL,
      INDEX rs_paid_order (order_id),
      INDEX rs_paid_invoice (invoice_id),
      FOREIGN KEY (order_id) REFERENCES rs_orders(id),
      FOREIGN KEY (line_id) REFERENCES rs_order_lines(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  },
  {
    name: 'rs_category_stations',
    since: 22,
    sql: `CREATE TABLE rs_category_stations (
      category_id ${ID} NOT NULL PRIMARY KEY,
      station ${WORD} NOT NULL CHECK (station IN ('kitchen', 'grill', 'bar')),
      updated_at ${WHEN} NOT NULL,
      FOREIGN KEY (category_id) REFERENCES item_categories(id)
    )`
  },
  {
    name: 'item_recipes',
    since: 22,
    sql: `CREATE TABLE item_recipes (
      item_id ${ID} NOT NULL,
      ingredient_id ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
      updated_at ${WHEN} NOT NULL,
      PRIMARY KEY (item_id, ingredient_id),
      INDEX item_recipes_ingredient (ingredient_id),
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (ingredient_id) REFERENCES items(id)
    )`
  },
  {
    name: 'invoice_recipe_moves',
    since: 22,
    sql: `CREATE TABLE invoice_recipe_moves (
      invoice_id ${ID} NOT NULL,
      line_no INT NOT NULL,
      item_id ${ID} NOT NULL,
      qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
      value BIGINT NOT NULL CHECK (value >= 0),
      PRIMARY KEY (invoice_id, line_no, item_id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )`
  }
  // ===== end 22 · RESTAURANTS AND CAFÉS =====
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
  trigger('installment_receipts_no_delete', 'BEFORE DELETE', 'installment_receipts', null, 'installment_contract_is_permanent', 6),
  // 10: batch quantity moves are kept forever, as stock moves are
  trigger('stock_batch_moves_no_update', 'BEFORE UPDATE', 'stock_batch_moves', null, 'stock_moves_are_permanent', 10),
  trigger('stock_batch_moves_no_delete', 'BEFORE DELETE', 'stock_batch_moves', null, 'stock_moves_are_permanent', 10),
  // 12: a customer's loyalty points movements are kept for ever too
  trigger('loyalty_moves_no_update', 'BEFORE UPDATE', 'loyalty_moves', null, 'loyalty_moves_are_permanent', 12),
  trigger('loyalty_moves_no_delete', 'BEFORE DELETE', 'loyalty_moves', null, 'loyalty_moves_are_permanent', 12),
  // 15: a receipt's photo is never changed, and a posted voucher keeps it (on the server a cascaded delete fires no
  // trigger, so a deleted draft's photo goes with it, as in SQLite)
  trigger('entry_images_no_update', 'BEFORE UPDATE', 'entry_images', null, 'entry_image_is_permanent', 15),
  trigger('entry_images_no_delete', 'BEFORE DELETE', 'entry_images', `(SELECT status FROM entries WHERE id = OLD.entry_id) = 'approved'`, 'entry_image_is_permanent', 15)
];

/**
 * A step of a server migration that changes a table already there (version 10 is the first). Each says what it adds,
 * so a step already done (an upgrade cut off half way: the server commits each ALTER on its own) is skipped next time.
 */
export type MysqlStep =
  | { kind: 'column'; table: string; column: string; sql: string }
  | { kind: 'foreignKey'; table: string; column: string; parent: string; sql: string }
  /** `unlessForeignKey` ("table.column>parent"): also skipped on a database that has that foreign key already */
  | { kind: 'index'; table: string; name: string; sql: string; unlessForeignKey?: string };

const NAME = /^\w+$/;

/** ALTER TABLE … ADD COLUMN, last in the table (as SQLite's ADD COLUMN puts it); skipped when the column is there. */
export function mysqlAddColumn(table: string, column: string, definition: string): MysqlStep {
  if (!NAME.test(table) || !NAME.test(column)) throw new Error(`bad name ${table}.${column}`);
  return { kind: 'column', table, column, sql: `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}` };
}

/** ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY; skipped when the column already points at that table. */
export function mysqlAddForeignKey(table: string, column: string, parent: string, parentColumn: string): MysqlStep {
  if (![table, column, parent, parentColumn].every((n) => NAME.test(n))) throw new Error('bad name');
  return {
    kind: 'foreignKey', table, column, parent,
    sql: `ALTER TABLE ${table} ADD CONSTRAINT ${table}_${column}_fk FOREIGN KEY (${column}) REFERENCES ${parent}(${parentColumn})`
  };
}

/**
 * ALTER TABLE … ADD INDEX; skipped when the table has an index of that name. A TEXT column is indexed by a prefix, which
 * its entry in `columns` carries ("entity(32)").
 */
export function mysqlAddIndex(table: string, name: string, columns: readonly string[], unlessForeignKey?: string): MysqlStep {
  if (!NAME.test(table) || !NAME.test(name) || !columns.length || !columns.every((c) => /^\w+(\(\d+\))?$/.test(c))) throw new Error(`bad index ${table}.${name}`);
  return { kind: 'index', table, name, sql: `ALTER TABLE ${table} ADD INDEX ${name} (${columns.join(', ')})`, ...(unlessForeignKey ? { unlessForeignKey } : {}) };
}

const lineColumns = (table: string, batches: boolean): MysqlStep[] => [
  mysqlAddColumn(table, 'unit', WORD),
  mysqlAddColumn(table, 'unit_factor_milli', 'BIGINT'),
  mysqlAddColumn(table, 'unit_qty_milli', 'BIGINT'),
  ...(batches
    ? [mysqlAddColumn(table, 'batch_no', BATCH), mysqlAddColumn(table, 'expiry', WHEN), mysqlAddColumn(table, 'batch_id', ID), mysqlAddForeignKey(table, 'batch_id', 'item_batches', 'id')]
    : [])
];

/** Version 10 on a server database at version 9: the columns its tables gain (its new tables come from MYSQL_TABLES). */
export const V10_MYSQL_STEPS: readonly MysqlStep[] = [
  mysqlAddColumn('items', 'category_id', ID),
  mysqlAddColumn('items', 'sale_unit', WORD),
  mysqlAddColumn('items', 'purchase_unit', WORD),
  mysqlAddColumn('items', 'track_batches', 'INT NOT NULL DEFAULT 0'),
  mysqlAddColumn('items', 'track_expiry', 'INT NOT NULL DEFAULT 0'),
  mysqlAddColumn('items', 'updated_at', WHEN),
  mysqlAddForeignKey('items', 'category_id', 'item_categories', 'id'),
  ...lineColumns('invoice_lines', true),
  ...lineColumns('stock_doc_lines', true),
  ...lineColumns('stock_adjustment_lines', true),
  ...lineColumns('purchase_order_lines', false),
  mysqlAddColumn('item_images', 'sha256', 'VARCHAR(64)')
];

/** Version 11 on a server database at version 10: subcategories, brands (its table comes from MYSQL_TABLES), reorder levels and stock count scopes. */
export const V11_MYSQL_STEPS: readonly MysqlStep[] = [
  mysqlAddColumn('item_categories', 'parent_id', ID),
  mysqlAddColumn('item_categories', 'reorder_milli', 'BIGINT CHECK (reorder_milli IS NULL OR reorder_milli >= 0)'),
  mysqlAddForeignKey('item_categories', 'parent_id', 'item_categories', 'id'),
  mysqlAddColumn('items', 'brand_id', ID),
  mysqlAddColumn('items', 'reorder_milli', 'BIGINT CHECK (reorder_milli IS NULL OR reorder_milli >= 0)'),
  mysqlAddForeignKey('items', 'brand_id', 'brands', 'id'),
  mysqlAddColumn('stock_counts', 'scope', 'TEXT')
];

/** Version 12, owner tools (1.2): a customer's language for WhatsApp messages (the loyalty ledger is a new table). */
export const V12_OWNER_TOOLS_MYSQL_STEPS: readonly MysqlStep[] = [
  mysqlAddColumn('parties', 'lang', "VARCHAR(2) CHECK (lang IS NULL OR lang IN ('ar', 'en', 'ku'))")
];

/** Version 12 on a server database at version 11: each feature's own steps, one after the other. */
export const V12_MYSQL_STEPS: readonly MysqlStep[] = [...V12_OWNER_TOOLS_MYSQL_STEPS];

/** Version 13 (1.4): an item's purchase price and its currency, and the cash handed over for a till's sale. */
export const V13_MYSQL_STEPS: readonly MysqlStep[] = [
  mysqlAddColumn('items', 'purchase_price', 'BIGINT CHECK (purchase_price IS NULL OR purchase_price >= 0)'),
  mysqlAddColumn('items', 'purchase_currency', `${WORD} CHECK (purchase_currency IS NULL OR purchase_currency IN ('IQD', 'USD'))`),
  mysqlAddColumn('pos_sales', 'tendered', 'BIGINT CHECK (tendered IS NULL OR tendered >= 0)')
];

/**
 * Version 14: the index the sign-in check reads an account's known places through (auth.ts, knownPlaces), so the first
 * sign-in after a restart doesn't scan the whole append-only audit log. Its columns are TEXT: each is indexed by a prefix.
 */
export const V14_MYSQL_STEPS: readonly MysqlStep[] = [
  mysqlAddIndex('audit_log', 'audit_log_user_login', ['entity(32)', 'entity_id(64)', 'action(32)', 'id'])
];

/**
 * Version 15 (1.5): each entry's revision, one up with every change to a draft (journal.ts, replaceDraft), which an
 * approval sent from the phone is checked against (entry-seen.ts). The table of receipt photos comes from MYSQL_TABLES.
 */
export const V15_MYSQL_STEPS: readonly MysqlStep[] = [
  mysqlAddColumn('entries', 'revision', 'INT NOT NULL DEFAULT 0')
];

/** Version 16: petrol stations' tables only (MYSQL_TABLES, since 16); no column added to an older table. */
export const V16_MYSQL_STEPS: readonly MysqlStep[] = [];

// ——— 17, TILLS ———
/**
 * Version 17 (supermarket): the columns it adds to older tables. Its new tables (tills, consignment, shelf labels, offers)
 * come from MYSQL_TABLES, since 17. Tills: a shift's till, and the dollar notes taken on a dinar sale; offers: two invoice columns.
 */
export const V17_MYSQL_STEPS: readonly MysqlStep[] = [
  mysqlAddColumn('pos_shifts', 'till_id', ID),
  // the index a new database gets by itself for this foreign key is named after the column ("till_id"); made here under
  // that name first, the constraint below uses it, so an upgraded server has the index a new one has. A server
  // upgraded before this step existed has the constraint already (and its index under the constraint's name): left as
  // it is, never given a second index.
  mysqlAddIndex('pos_shifts', 'till_id', ['till_id'], 'pos_shifts.till_id>pos_tills'),
  mysqlAddForeignKey('pos_shifts', 'till_id', 'pos_tills', 'id'),
  mysqlAddColumn('pos_sales', 'usd_cash', 'BIGINT CHECK (usd_cash IS NULL OR usd_cash > 0)'),
  mysqlAddColumn('pos_sales', 'usd_rate_x100', 'BIGINT CHECK (usd_rate_x100 IS NULL OR usd_rate_x100 > 0)'),
  // offers: worked out for this invoice, and the part of its discount that came from them
  mysqlAddColumn('invoices', 'offers_on', 'INT NOT NULL DEFAULT 0 CHECK (offers_on IN (0, 1))'),
  mysqlAddColumn('invoices', 'offer_discount', 'BIGINT NOT NULL DEFAULT 0 CHECK (offer_discount >= 0)')
];
// ——— end of 17, TILLS ———

// ===== 18 · TILL RULES =====
/** Version 18 (till rules): the dinar rounding of a till sale's cash. The new tables come from MYSQL_TABLES, since 18. */
export const V18_MYSQL_STEPS: readonly MysqlStep[] = [
  mysqlAddColumn('pos_sales', 'rounding', 'BIGINT NOT NULL DEFAULT 0'),
  mysqlAddColumn('pos_sales', 'voucher_paid', 'BIGINT NOT NULL DEFAULT 0')
];

/**
 * Version 19 (what the reviews of 2.0 added after 18 was first built): the voucher a returned share stands for, and the
 * taking back of a wholesale collection or handover. Its new tables come from MYSQL_TABLES, since 19.
 */
export const V19_MYSQL_STEPS: readonly MysqlStep[] = [
  mysqlAddColumn('gift_voucher_moves', 'for_voucher_id', ID),
  mysqlAddColumn('ws_handovers', 'cancelled_at', WHEN),
  mysqlAddColumn('ws_handovers', 'cancel_entry_id', ID),
  mysqlAddForeignKey('ws_handovers', 'cancel_entry_id', 'entries', 'id'),
  mysqlAddColumn('ws_collections', 'cancelled_at', WHEN),
  mysqlAddColumn('ws_collections', 'cancel_entry_id', ID),
  mysqlAddForeignKey('ws_collections', 'cancel_entry_id', 'entries', 'id')
];
// ===== end of 18 · TILL RULES =====

/**
 * What a server database has already, for pendingMysqlSteps: "table.column", "table.column>parent" and "table.index"
 * (no `indexes`: none yet).
 */
export interface MysqlSchemaState { columns: ReadonlySet<string>; foreignKeys: ReadonlySet<string>; indexes?: ReadonlySet<string> }

/**
 * Version 21 (2.0.0): an item's stock read from an index that holds each move's quantity and value (the till's item
 * list, bench/big-company.ts), and a till shift's cash found by its safe and time. The barcode and party indexes SQLite gets in this version are there already on a server:
 * a unique key on items.barcode, and every party column is a foreign key.
 */
export const V21_MYSQL_STEPS: readonly MysqlStep[] = [
  mysqlAddIndex('stock_moves', 'stock_moves_stock', ['item_id', 'warehouse_id', 'date', 'qty_milli', 'value']),
  // approved entries of a period
  mysqlAddIndex('entries', 'entries_status_date', ['status', 'date']),
  // a till shift's cash: what was posted to its safe while it was open
  mysqlAddIndex('invoices', 'invoices_cash_posted', ['cash_account', 'posted_at']),
  mysqlAddIndex('invoices', 'invoices_cash_cancelled', ['cash_account', 'cancelled_at'])
];

/** The statements of `steps` not done yet, in order. */
export function pendingMysqlSteps(steps: readonly MysqlStep[], state: MysqlSchemaState): string[] {
  const done = (s: MysqlStep) =>
    s.kind === 'column' ? state.columns.has(`${s.table}.${s.column}`)
      : s.kind === 'foreignKey' ? state.foreignKeys.has(`${s.table}.${s.column}>${s.parent}`)
        : !!state.indexes?.has(`${s.table}.${s.name}`) || (!!s.unlessForeignKey && state.foreignKeys.has(s.unlessForeignKey));
  return steps.filter((s) => !done(s)).map((s) => s.sql);
}

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
