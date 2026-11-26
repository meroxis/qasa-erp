import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db } from './db.ts';
import { migrate, openDatabase, SCHEMA_VERSION } from './db.ts';

// Version 21 (2.0.0): indexes a big company needs (bench/big-company.ts). On a MariaDB or MySQL server the barcode
// and party columns are indexed already (a unique key, foreign keys): a server gets the stock index only.
const onServer = !!process.env.QASA_TEST_DB;
const plan = (db: Db, sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('x') as { detail: string }[]).map((r) => r.detail).join(' / ');

describe.skipIf(onServer)('version 21', () => {
  it('is the current version', () => { expect(SCHEMA_VERSION).toBe(21); });

  it('comes on top of a 2.0 beta company file (version 20) and keeps its data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-v21-'));
    const file = join(dir, 'company.sqlite');
    try {
      const raw = new DatabaseSync(file);
      raw.exec('PRAGMA foreign_keys = ON');
      migrate(raw as unknown as Db, 20);
      expect(raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'items_barcode_find'").get()).toBeUndefined();
      raw.prepare("INSERT INTO items (id, code, barcode, name_ar, name_en, name_ku, unit, sale_price, sale_currency, track_stock, active, created_at) VALUES ('i1', 'I-0001', '6291041500550', 'لوح', 'Panel', 'پانێڵ', 'piece', 1000, 'IQD', 1, 1, '2026-11-01')").run();
      raw.close();
      const db = openDatabase(file);
      try {
        expect(Number((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version)).toBe(21);
        expect(db.prepare("SELECT id FROM items WHERE barcode = '6291041500550'").get()).toEqual({ id: 'i1' });
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds a barcode, and a party in each table that says whether it is used, by an index: never by reading the whole table', () => {
    const db = openDatabase(':memory:');
    try {
      // the till's scan and the check that a new barcode is free
      expect(plan(db, 'SELECT id FROM items WHERE barcode = ?')).toMatch(/USING (COVERING )?INDEX items_barcode_find/);
      expect(plan(db, "SELECT 1 FROM items WHERE barcode = ? AND id <> COALESCE(NULL, '')")).toMatch(/USING (COVERING )?INDEX items_barcode_find/);
      for (const [table, column] of [['invoices', 'party_id'], ['quotes', 'party_id'], ['deals', 'party_id'], ['purchase_orders', 'party_id'], ['cheques', 'party_id'],
        ['re_deposits', 'party_id'], ['serials', 'party_id'], ['serials', 'from_party_id'], ['entry_lines', 'party_id'], ['jobs', 'party_id'],
        ['installment_contracts', 'party_id'], ['gen_subscribers', 'party_id'], ['re_units', 'party_id'], ['repair_orders', 'party_id'],
        ['maint_plans', 'party_id'], ['maint_visits', 'party_id'], ['loyalty_moves', 'party_id']] as const) {
        expect(plan(db, `SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`), `${table}.${column}`).not.toMatch(/^SCAN/);
      }
    } finally {
      db.close();
    }
  });

  it('sums every item\'s stock from the stock index alone, in one pass', () => {
    const db = openDatabase(':memory:');
    try {
      const sql = 'SELECT m.item_id, SUM(m.qty_milli), SUM(m.value), COUNT(*) FROM stock_moves m GROUP BY m.item_id';
      expect(plan(db, sql.replace('GROUP BY', 'WHERE m.item_id <> ? GROUP BY'))).toContain('USING COVERING INDEX stock_moves_stock');
    } finally {
      db.close();
    }
  });

  it('answers the home page, the low stock and a till shift\'s cash by index (bench/big-company.ts)', () => {
    const db = openDatabase(':memory:');
    try {
      const many = (sql: string, n: number) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(n).fill('x')) as { detail: string }[]).map((r) => r.detail).join(' / ');
      // the stock on a day, from the index alone
      expect(many('SELECT item_id, SUM(qty_milli) FROM stock_moves WHERE date <= ? GROUP BY item_id', 1)).toContain('USING COVERING INDEX stock_moves_stock');
      // the approved entries of a period (profit on the home page)
      expect(many("SELECT 1 FROM entries e WHERE e.status = 'approved' AND e.date BETWEEN ? AND ?", 2)).toContain('INDEX entries_status_date');
      // what went into a till's safe while its shift was open: at every sale, the shift's figures are worked out again
      expect(many('SELECT 1 FROM invoices i WHERE i.cash_account = ? AND i.posted_at >= ?', 2)).toContain('INDEX invoices_cash_posted');
      expect(many('SELECT 1 FROM invoices i WHERE i.cash_account = ? AND i.cancelled_at >= ?', 2)).toContain('INDEX invoices_cash_cancelled');
    } finally {
      db.close();
    }
  });

  it('reads one item\'s stock and one party\'s balance from their own rows (bench/big-company.ts: seconds before, at every scan and credit sale)', async () => {
    const { readFileSync } = await import('node:fs');
    const items = readFileSync(new URL('./items.ts', import.meta.url), 'utf8');
    expect(items).toContain("const row = itemRows(db, 'WHERE i.id = ?', [id], warehouses, id)[0];");
    expect(items).toContain("typeof only === 'string' ? 'WHERE m.item_id = ?'");
    const parties = readFileSync(new URL('./parties.ts', import.meta.url), 'utf8');
    expect(parties).toContain('return toView(row, balances(db, branch, id).get(id), partyUsed(db, id));');
    expect(parties).toContain("if (partyUsed(db, id)) throw conflict('party_has_entries');");
  });
});
