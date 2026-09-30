import {
  COMPANY_TABLES, createMysqlTriggers, isMysql, quoteId, schemaVersion, SCHEMA_VERSION, transaction, type Db, type SqlParam
} from './db.ts';
import { foreignKeys, MYSQL_TRIGGERS, tableColumns } from './schema-mysql.ts';

/**
 * Copies a whole company from one database to another, row for row: the company file to a MariaDB/MySQL server
 * (moving to a server), or a server to a file (a backup, or moving back). The target must have the current schema and
 * no rows: a new file after migrate(), or a server database after prepareMysqlForCopy().
 *
 * The rules that keep posted work permanent (triggers) would refuse to write a posted voucher's lines, so they are
 * off while the rows go in and back on after; foreign keys are checked once at the end instead of row by row (a
 * reversal and the entry it reverses point at each other). Then every table's row count and the money in it are
 * compared with the source, all inside one transaction: a copy is complete and equal, or there is none.
 */

export class CopyError extends Error {
  constructor(readonly code: 'schema_differs' | 'target_not_empty' | 'copy_differs' | 'broken_reference', readonly details: unknown = null) {
    super(code);
  }
}

/** Sums that must come out the same on both sides, beside each table's row count. */
const TOTALS: Record<string, string[]> = {
  entry_lines: ['debit', 'credit', 'base_debit', 'base_credit'],
  stock_moves: ['qty_milli', 'value'],
  invoices: ['total'],
  invoice_lines: ['amount'],
  stock_doc_lines: ['qty_milli']
};

/** Rows read at a time, and written per INSERT (one round trip to a server each). */
const PAGE = 1000;
const BATCH = 100;

export interface CopySummary { tables: Record<string, number> }

export function copyCompany(from: Db, to: Db): CopySummary {
  const version = schemaVersion(from);
  if (version !== SCHEMA_VERSION || schemaVersion(to) !== SCHEMA_VERSION) {
    throw new CopyError('schema_differs', { from: version, to: schemaVersion(to), app: SCHEMA_VERSION });
  }
  const filled = COMPANY_TABLES.filter((t) => count(to, t) > 0);
  if (filled.length) throw new CopyError('target_not_empty', { tables: filled });

  const savedTriggers = suspendRules(to);
  let summary: CopySummary;
  try {
    summary = transaction(to, () => {
      const tables: Record<string, number> = {};
      for (const table of COMPANY_TABLES) tables[table] = copyTable(from, to, table);
      compare(from, to);
      const broken = brokenReferences(to);
      if (broken.length) throw new CopyError('broken_reference', broken.slice(0, 5));
      return { tables };
    });
  } finally {
    restoreRules(to, savedTriggers);
  }
  return summary;
}

function count(db: Db, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number | bigint }).n);
}

function copyTable(from: Db, to: Db, table: string): number {
  const { columns, primaryKey } = tableColumns(table);
  const list = columns.map(quoteId).join(', ');
  const read = from.prepare(`SELECT ${list} FROM ${table} ORDER BY ${primaryKey.map(quoteId).join(', ')} LIMIT ? OFFSET ?`);
  const row = `(${columns.map(() => '?').join(', ')})`;
  const insertFull = to.prepare(`INSERT INTO ${table} (${list}) VALUES ${Array(BATCH).fill(row).join(', ')}`);
  let copied = 0;
  for (;;) {
    const page = read.all(PAGE, copied);
    for (let i = 0; i < page.length; i += BATCH) {
      const rows = page.slice(i, i + BATCH);
      const values: SqlParam[] = [];
      for (const r of rows) {
        for (const c of columns) values.push(clean(table, c, r[c] ?? null));
      }
      const insert = rows.length === BATCH ? insertFull : to.prepare(`INSERT INTO ${table} (${list}) VALUES ${Array(rows.length).fill(row).join(', ')}`);
      insert.run(...values);
    }
    copied += page.length;
    if (page.length < PAGE) break;
  }
  return copied;
}

/** The one value SQLite allowed that a server's unique barcode key would not: '' as "no barcode" (the app writes NULL). */
function clean(table: string, column: string, value: SqlParam): SqlParam {
  return table === 'items' && column === 'barcode' && value === '' ? null : value;
}

function compare(from: Db, to: Db): void {
  const differences: unknown[] = [];
  for (const table of COMPANY_TABLES) {
    const sums = TOTALS[table] ?? [];
    const sql = `SELECT COUNT(*) AS n${sums.map((c) => `, COALESCE(SUM(${c}), 0) AS ${c}`).join('')} FROM ${table}`;
    const a = from.prepare(sql).get()!;
    const b = to.prepare(sql).get()!;
    for (const key of Object.keys(a)) {
      if (Number(a[key]) !== Number(b[key])) differences.push({ table, key, from: Number(a[key]), to: Number(b[key]) });
    }
  }
  if (differences.length) throw new CopyError('copy_differs', differences);
}

/** Rows whose foreign key points at nothing (checked once, as the rows went in without it). */
function brokenReferences(db: Db): { table: string; column: string; rows: number }[] {
  const broken: { table: string; column: string; rows: number }[] = [];
  for (const fk of foreignKeys()) {
    const rows = Number((db.prepare(
      `SELECT COUNT(*) AS n FROM ${fk.table} c LEFT JOIN ${fk.parent} p ON p.${quoteId(fk.parentColumn)} = c.${quoteId(fk.column)}
       WHERE c.${quoteId(fk.column)} IS NOT NULL AND p.${quoteId(fk.parentColumn)} IS NULL`
    ).get() as { n: number }).n);
    if (rows) broken.push({ table: fk.table, column: fk.column, rows });
  }
  return broken;
}

/** Takes the triggers off and foreign keys to "checked at the end"; returns what restoreRules needs to put them back. */
function suspendRules(db: Db): { name: string; sql: string }[] {
  if (isMysql(db)) {
    const present = db.prepare('SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = DATABASE()').all() as { name: string }[];
    for (const t of present) {
      if (MYSQL_TRIGGERS.some((m) => m.name === t.name)) db.exec(`DROP TRIGGER ${quoteId(t.name)}`);
    }
    db.exec('SET FOREIGN_KEY_CHECKS = 0');
    return [];
  }
  const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'").all() as { name: string; sql: string }[];
  for (const t of triggers) db.exec(`DROP TRIGGER ${quoteId(t.name)}`);
  // outside any transaction: SQLite ignores this pragma inside one
  db.exec('PRAGMA foreign_keys = OFF');
  return triggers;
}

function restoreRules(db: Db, sqliteTriggers: { name: string; sql: string }[]): void {
  if (isMysql(db)) {
    db.exec('SET FOREIGN_KEY_CHECKS = 1');
    createMysqlTriggers(db);
    return;
  }
  for (const t of sqliteTriggers) db.exec(t.sql);
  db.exec('PRAGMA foreign_keys = ON');
}
