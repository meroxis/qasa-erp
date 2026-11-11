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
      FOREIGN KEY (cash_account) REFERENCES accounts(code),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    )`
  },
  {
    name: 'pos_sales',
    since: 7,
    sql: `CREATE TABLE pos_sales (
      invoice_id ${ID} NOT NULL PRIMARY KEY,
      shift_id ${ID} NOT NULL,
      INDEX pos_sales_shift (shift_id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (shift_id) REFERENCES pos_shifts(id)
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
  trigger('installment_receipts_no_delete', 'BEFORE DELETE', 'installment_receipts', null, 'installment_contract_is_permanent', 6),
  // 10: batch quantity moves are kept forever, as stock moves are
  trigger('stock_batch_moves_no_update', 'BEFORE UPDATE', 'stock_batch_moves', null, 'stock_moves_are_permanent', 10),
  trigger('stock_batch_moves_no_delete', 'BEFORE DELETE', 'stock_batch_moves', null, 'stock_moves_are_permanent', 10)
];

/**
 * A step of a server migration that changes a table already there (version 10 is the first). Each says what it adds,
 * so a step already done (an upgrade cut off half way: the server commits each ALTER on its own) is skipped next time.
 */
export type MysqlStep =
  | { kind: 'column'; table: string; column: string; sql: string }
  | { kind: 'foreignKey'; table: string; column: string; parent: string; sql: string };

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

/** Version 12, owner tools (1.2): a customer's language for WhatsApp messages. */
export const V12_OWNER_TOOLS_MYSQL_STEPS: readonly MysqlStep[] = [
  mysqlAddColumn('parties', 'lang', "VARCHAR(2) CHECK (lang IS NULL OR lang IN ('ar', 'en', 'ku'))")
];

/** Version 12 on a server database at version 11: each feature's own steps, one after the other. */
export const V12_MYSQL_STEPS: readonly MysqlStep[] = [...V12_OWNER_TOOLS_MYSQL_STEPS];

/** What a server database has already, for pendingMysqlSteps: "table.column" and "table.column>parent". */
export interface MysqlSchemaState { columns: ReadonlySet<string>; foreignKeys: ReadonlySet<string> }

/** The statements of `steps` not done yet, in order. */
export function pendingMysqlSteps(steps: readonly MysqlStep[], state: MysqlSchemaState): string[] {
  const done = (s: MysqlStep) =>
    s.kind === 'column' ? state.columns.has(`${s.table}.${s.column}`) : state.foreignKeys.has(`${s.table}.${s.column}>${s.parent}`);
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
