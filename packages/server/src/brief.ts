import { z } from 'zod';
import { addDays, daysBetween, todayIso, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { loadAccounts } from './accounts.ts';
import { audit } from './audit.ts';
import { invalid } from './errors.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';
import { readSetting, writeSetting } from './settings.ts';
import { AppError } from './errors.ts';
import { scopeLists, scopeOf } from './branches.ts';
import { chequesAhead, type ChequeAlert } from './banking.ts';

/** A branch's warehouses and safes (null: the whole company). See branches.ts. */
export type BranchFilter = { warehouses: string[]; accounts: string[] } | null;
const marks = (list: string[]) => (list.length ? list.map(() => '?').join(', ') : 'NULL');
/** `AND <col> IN (…)` for a branch, with its parameters; nothing for the whole company. */
const inBranch = (col: string, list: string[] | undefined): [string, string[]] => (list ? [` AND ${col} IN (${marks(list)})`, list] : ['', []]);

/**
 * The owner's view of the business: the Daily Brief (one page for a day: sales, cash, what came in and went out, who
 * is late, what runs out), the dashboard, the management reports, and quick expenses. Everything here only reads the
 * books — approved entries and posted invoices — except the brief's own settings. Quick expenses are ordinary payment
 * vouchers made through /api/vouchers, so they follow the preparer → checker → approver chain like any other.
 * All amounts are in IQD (the base currency) unless a field says otherwise.
 */

type Money = { IQD: number; USD: number };

/** An invoice's amount in IQD, in SQL (USD amounts are cents; the rate is IQD per USD × 100). */
const BASE = (amount: string, alias = 'i') => `(CASE WHEN ${alias}.currency = 'IQD' THEN ${amount} ELSE ROUND(${amount} * ${alias}.rate_x100 / 10000.0) END)`;
/** A line's share of its invoice's discount (returns store theirs; sales spread it over the lines by amount). */
const LINE_NET = `(l.amount - COALESCE(l.discount_share, CASE WHEN i.subtotal > 0 THEN i.discount * l.amount * 1.0 / i.subtotal ELSE 0 END))`;
/** +1 for a sale, −1 for a sale return. */
const SIGN = `(CASE i.kind WHEN 'sale_return' THEN -1 ELSE 1 END)`;

const num = (v: unknown) => Number(v ?? 0);
const name = (r: { name_ar: string; name_en: string; name_ku: string }): Names => ({ ar: r.name_ar, en: r.name_en, ku: r.name_ku });

function monthStart(iso: string): string {
  return iso.slice(0, 8) + '01';
}

function shiftMonth(iso: string, months: number): string {
  const [y, m] = iso.slice(0, 7).split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function lastDayOfMonth(iso: string): string {
  return addDays(shiftMonth(iso, 1), -1);
}

// ——— sales ———

/**
 * Net sales in IQD (sales less sale returns) of posted invoices between two dates, and how many sale invoices. For the
 * whole company it adds the generator owners' monthly bills: those are one journal entry per month, not invoices
 * (approved and not cancelled, the revenue they credit, by the entry's date). A run has no branch.
 */
export function salesBetween(db: Db, from: string, to: string, branch: BranchFilter = null): { amount: number; invoices: number } {
  const [w, wp] = inBranch('i.warehouse_id', branch?.warehouses);
  const r = db.prepare(`SELECT COALESCE(SUM(${SIGN} * ${BASE('i.total')}), 0) AS amount, COALESCE(SUM(i.kind = 'sale'), 0) AS invoices
                        FROM invoices i WHERE i.status = 'posted' AND i.kind IN ('sale', 'sale_return') AND i.date BETWEEN ? AND ?${w}`).get(from, to, ...wp) as
    { amount: number; invoices: number };
  const generators = branch ? 0 : num((db.prepare(`SELECT COALESCE(SUM(l.base_credit - l.base_debit), 0) AS amount
                                                   FROM gen_runs g JOIN entries e ON e.id = g.entry_id JOIN entry_lines l ON l.entry_id = e.id
                                                   WHERE g.status = 'posted' AND e.status = 'approved' AND e.reversed_by_id IS NULL AND l.account_code LIKE '4%'
                                                     AND e.date BETWEEN ? AND ?`).get(from, to) as { amount: number }).amount);
  return { amount: num(r.amount) + generators, invoices: num(r.invoices) };
}

export interface ItemSales { itemId: string; code: string; name: Names; qtyMilli: number; sales: number; cost: number; profit: number }

/** Sales, cost and profit by item (IQD), returns taken off, best sellers first. */
export function salesByItem(db: Db, from: string, to: string, limit = 500, branch: BranchFilter = null): ItemSales[] {
  const [w, wp] = inBranch('i.warehouse_id', branch?.warehouses);
  const rows = db.prepare(`SELECT it.id, it.code, it.name_ar, it.name_en, it.name_ku,
                                  SUM(${SIGN} * l.qty_milli) AS qty,
                                  SUM(${SIGN} * ${BASE(LINE_NET)}) AS sales,
                                  SUM(${SIGN} * COALESCE(l.cost, 0)) AS cost
                           FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN items it ON it.id = l.item_id
                           WHERE i.status = 'posted' AND i.kind IN ('sale', 'sale_return') AND i.date BETWEEN ? AND ?${w}
                           GROUP BY it.id ORDER BY sales DESC LIMIT ?`).all(from, to, ...wp, limit) as
    { id: string; code: string; name_ar: string; name_en: string; name_ku: string; qty: number; sales: number; cost: number }[];
  return rows.map((r) => {
    const sales = Math.round(num(r.sales));
    const cost = num(r.cost);
    return { itemId: r.id, code: r.code, name: name(r), qtyMilli: num(r.qty), sales, cost, profit: sales - cost };
  });
}

export interface CustomerSales { partyId: string | null; code: string; name: string; invoices: number; sales: number }

/** Net sales by customer (IQD); cash sales without a customer are one row (partyId null). */
export function salesByCustomer(db: Db, from: string, to: string, branch: BranchFilter = null): CustomerSales[] {
  const [w, wp] = inBranch('i.warehouse_id', branch?.warehouses);
  const rows = db.prepare(`SELECT p.id, p.code, p.name, COALESCE(SUM(i.kind = 'sale'), 0) AS invoices, SUM(${SIGN} * ${BASE('i.total')}) AS sales
                           FROM invoices i LEFT JOIN parties p ON p.id = i.party_id
                           WHERE i.status = 'posted' AND i.kind IN ('sale', 'sale_return') AND i.date BETWEEN ? AND ?${w}
                           GROUP BY p.id ORDER BY sales DESC`).all(from, to, ...wp) as { id: string | null; code: string | null; name: string | null; invoices: number; sales: number }[];
  return rows.map((r) => ({ partyId: r.id, code: r.code ?? '', name: r.name ?? '', invoices: num(r.invoices), sales: num(r.sales) }));
}

// ——— money ———

export interface CashAccount { code: string; name: Names; balance: Money; base: number }

/**
 * The exchange-rate revaluation entries (fx.ts keeps their ids in the `fx_revaluation_entries` setting) and their
 * reversals. They change what a safe is worth in dinars, but they are neither notes in it nor money received or paid,
 * so the cash figures (balance by currency, money in and out) leave them out; the IQD value keeps them.
 */
function revaluationEntries(db: Db): string[] {
  let ids: string[] = [];
  try {
    const list = JSON.parse(readSetting(db, 'fx_revaluation_entries') ?? '[]') as unknown;
    ids = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    ids = [];
  }
  if (!ids.length) return [];
  const reversals = db.prepare(`SELECT id FROM entries WHERE reverses_id IN (${marks(ids)})`).all(...ids) as { id: string }[];
  return [...ids, ...reversals.map((r) => r.id)];
}

/** Each safe and bank account (under 18) with its balance in each currency it holds, and in IQD. */
export function cashAccounts(db: Db, asOf: string, branch: BranchFilter = null): CashAccount[] {
  const accounts = loadAccounts(db).filter((a) => a.postable && a.code.startsWith('18') && (!branch || branch.accounts.includes(a.code)));
  const rows = db.prepare(`SELECT l.account_code AS code, e.currency, SUM(l.debit - l.credit) AS amount, SUM(l.base_debit - l.base_credit) AS base
                           FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                           WHERE e.status = 'approved' AND l.account_code LIKE '18%' AND e.date <= ?
                           GROUP BY l.account_code, e.currency`).all(asOf) as { code: string; currency: 'IQD' | 'USD'; amount: number; base: number }[];
  const reval = revaluationEntries(db);
  const revalRows = reval.length
    ? db.prepare(`SELECT l.account_code AS code, e.currency, SUM(l.debit - l.credit) AS amount
                  FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                  WHERE e.status = 'approved' AND l.account_code LIKE '18%' AND e.date <= ? AND e.id IN (${marks(reval)})
                  GROUP BY l.account_code, e.currency`).all(asOf, ...reval) as { code: string; currency: 'IQD' | 'USD'; amount: number }[]
    : [];
  return accounts.map((a) => {
    const balance: Money = { IQD: 0, USD: 0 };
    let base = 0;
    for (const r of rows) {
      if (r.code !== a.code) continue;
      balance[r.currency] += num(r.amount);
      base += num(r.base);
    }
    // a revaluation moves the dinar value only: no notes were added or taken
    for (const r of revalRows) if (r.code === a.code) balance[r.currency] -= num(r.amount);
    return { code: a.code, name: a.name, balance, base };
  });
}

/**
 * Money into and out of the safes and banks on a day (IQD), not counting moves between them: the cash lines of
 * approved entries that also touch something other than cash.
 */
export function cashFlowOn(db: Db, date: string, branch: BranchFilter = null): { in: number; out: number } {
  const [a, ap] = inBranch('l.account_code', branch?.accounts);
  const reval = revaluationEntries(db); // a revaluation is no money in or out
  const notReval = reval.length ? ` AND e.id NOT IN (${marks(reval)})` : '';
  const r = db.prepare(`SELECT COALESCE(SUM(l.base_debit), 0) AS cin, COALESCE(SUM(l.base_credit), 0) AS cout
                        FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                        WHERE e.status = 'approved' AND e.date = ? AND l.account_code LIKE '18%'${a}${notReval}
                          AND EXISTS (SELECT 1 FROM entry_lines o WHERE o.entry_id = e.id AND o.account_code NOT LIKE '18%')`).get(date, ...ap, ...reval) as { cin: number; cout: number };
  return { in: num(r.cin), out: num(r.cout) };
}

// ——— who owes what, and how old it is ———

export interface AgingRow {
  partyId: string; code: string; name: string; phone: string;
  balance: number;
  /** days since the oldest part of the balance (first in, first out) */
  oldestDays: number;
  buckets: [number, number, number, number];
}

/**
 * `AND <the entry belongs to the branch>` for entries `alias`, with its parameters (nothing for the whole company):
 * made on one of its safes or banks, by an invoice of one of its warehouses (or its cancellation), for a cheque on one
 * of its banks, or the reversal of such an entry. Plain journals and cheques still in hand belong to no branch.
 */
function entryInBranch(alias: string, branch: BranchFilter): [string, string[]] {
  if (!branch) return ['', []];
  const { warehouses: wh, accounts: acc } = branch;
  const own = (a: string): [string, string[]] => [`(${a}.cash_account IN (${marks(acc)})
      OR EXISTS (SELECT 1 FROM invoices bi WHERE (bi.entry_id = ${a}.id OR bi.cancel_entry_id = ${a}.id) AND bi.warehouse_id IN (${marks(wh)}))
      OR EXISTS (SELECT 1 FROM cheques bc WHERE bc.entry_id = ${a}.id AND bc.bank_account IN (${marks(acc)})))`, [...acc, ...wh, ...acc]];
  const [mine, mp] = own(alias);
  const [reversed, rp] = own('br');
  return [` AND (${mine} OR EXISTS (SELECT 1 FROM entries br WHERE br.id = ${alias}.reverses_id AND ${reversed}))`, [...mp, ...rp]];
}

const BUCKET_LIMITS = [30, 60, 90] as const;
function bucketOf(days: number): 0 | 1 | 2 | 3 {
  return days <= BUCKET_LIMITS[0] ? 0 : days <= BUCKET_LIMITS[1] ? 1 : days <= BUCKET_LIMITS[2] ? 2 : 3;
}

/**
 * Customer (or supplier) balances aged first in, first out: payments settle the oldest charges, so what is still owed
 * is made of the newest charges. Buckets: 0–30, 31–60, 61–90 and over 90 days. Only those who owe (customers) or are
 * owed (suppliers) appear, largest first. For one branch, only the branch's entries count (entryInBranch).
 */
export function aging(db: Db, type: 'customer' | 'supplier', asOf: string, branch: BranchFilter = null): AgingRow[] {
  const owed = type === 'customer' ? 'l.base_debit - l.base_credit' : 'l.base_credit - l.base_debit';
  const [b, bp] = entryInBranch('e', branch);
  const parties = db.prepare(`SELECT p.id, p.code, p.name, COALESCE(p.phone, '') AS phone, SUM(${owed}) AS balance
                              FROM parties p JOIN entry_lines l ON l.party_id = p.id JOIN entries e ON e.id = l.entry_id
                              WHERE p.type = ? AND e.status = 'approved' AND e.date <= ?${b}
                              GROUP BY p.id HAVING SUM(${owed}) > 0`).all(type, asOf, ...bp) as { id: string; code: string; name: string; phone: string; balance: number }[];
  if (!parties.length) return [];
  // the charges (customer debits, supplier credits), newest first, of everyone above in one go
  const charge = type === 'customer' ? 'l.base_debit' : 'l.base_credit';
  const charges = db.prepare(`SELECT l.party_id AS party, e.date, ${charge} AS amount
                              FROM entry_lines l JOIN entries e ON e.id = l.entry_id JOIN parties p ON p.id = l.party_id
                              WHERE p.type = ? AND e.status = 'approved' AND e.date <= ? AND ${charge} > 0
                                AND e.reversed_by_id IS NULL AND e.reverses_id IS NULL${b}
                              ORDER BY l.party_id, e.date DESC, e.number DESC`).all(type, asOf, ...bp) as { party: string; date: string; amount: number }[];
  const byParty = new Map<string, { date: string; amount: number }[]>();
  for (const c of charges) {
    const list = byParty.get(c.party) ?? [];
    list.push({ date: c.date, amount: num(c.amount) });
    byParty.set(c.party, list);
  }
  const rows = parties.map((p) => {
    let left = num(p.balance);
    const buckets: [number, number, number, number] = [0, 0, 0, 0];
    let oldestDays = 0;
    for (const c of byParty.get(p.id) ?? []) {
      if (left <= 0) break;
      const part = Math.min(left, c.amount);
      const days = Math.max(0, daysBetween(c.date, asOf));
      buckets[bucketOf(days)] += part;
      oldestDays = days;
      left -= part;
    }
    // an opening balance with no charge line behind it counts as the oldest
    if (left > 0) buckets[3] += left;
    return { partyId: p.id, code: p.code, name: p.name, phone: p.phone, balance: num(p.balance), oldestDays, buckets };
  });
  return rows.sort((a, b) => b.balance - a.balance);
}

// ——— installments ———

export interface InstallmentDue {
  contractId: string; number: string; partyId: string; party: string; phone: string; currency: 'IQD' | 'USD';
  /** overdue: everything due up to the day and not paid; due: the part of the next day's installments not yet covered */
  amount: number; dueDate: string; daysLate: number;
}

/**
 * Installment contracts (when the company uses them): what is overdue on a day, and what falls due the next day.
 * Collections cover the oldest installments first, as the installments module counts them. Only collections made by
 * the day count (a brief for an earlier day shows what was owed then); one reversed after the day still counted then.
 */
export function installmentsOn(db: Db, date: string): { overdue: InstallmentDue[]; dueTomorrow: InstallmentDue[] } {
  const contracts = db.prepare(`SELECT c.id, c.number, c.party_id, c.currency, p.name, COALESCE(p.phone, '') AS phone
                                FROM installment_contracts c JOIN parties p ON p.id = c.party_id WHERE c.status = 'active'`).all() as
    { id: string; number: string; party_id: string; currency: 'IQD' | 'USD'; name: string; phone: string }[];
  if (!contracts.length) return { overdue: [], dueTomorrow: [] };
  const paid = new Map((db.prepare(`SELECT r.contract_id AS id, COALESCE(SUM(r.amount), 0) AS paid
                                    FROM installment_receipts r JOIN entries e ON e.id = r.entry_id
                                    WHERE e.status = 'approved' AND e.date <= ?
                                      AND (e.reversed_by_id IS NULL OR EXISTS (SELECT 1 FROM entries rv WHERE rv.id = e.reversed_by_id AND rv.date > ?))
                                    GROUP BY r.contract_id`).all(date, date) as { id: string; paid: number }[])
    .map((r) => [r.id, num(r.paid)]));
  const schedule = db.prepare('SELECT contract_id AS id, due_date, amount FROM installment_schedule ORDER BY contract_id, seq').all() as
    { id: string; due_date: string; amount: number }[];
  const rows = new Map<string, { due_date: string; amount: number }[]>();
  for (const s of schedule) {
    const list = rows.get(s.id) ?? [];
    list.push({ due_date: s.due_date, amount: num(s.amount) });
    rows.set(s.id, list);
  }
  const tomorrow = addDays(date, 1);
  const overdue: InstallmentDue[] = [];
  const dueTomorrow: InstallmentDue[] = [];
  for (const c of contracts) {
    let covered = paid.get(c.id) ?? 0;
    let late = 0;
    let oldest: string | null = null;
    let tomorrowLeft = 0;
    for (const r of rows.get(c.id) ?? []) {
      const fromPaid = Math.min(covered, r.amount);
      covered -= fromPaid;
      const left = r.amount - fromPaid;
      if (left <= 0) continue;
      if (r.due_date <= date) {
        late += left;
        oldest ??= r.due_date;
      } else if (r.due_date === tomorrow) {
        tomorrowLeft += left;
      }
    }
    const base = { contractId: c.id, number: c.number, partyId: c.party_id, party: c.name, phone: c.phone, currency: c.currency };
    if (late > 0 && oldest) overdue.push({ ...base, amount: late, dueDate: oldest, daysLate: daysBetween(oldest, date) });
    if (tomorrowLeft > 0) dueTomorrow.push({ ...base, amount: tomorrowLeft, dueDate: tomorrow, daysLate: 0 });
  }
  overdue.sort((a, b) => b.daysLate - a.daysLate);
  return { overdue, dueTomorrow };
}

// ——— stock ———

export interface LowStock { itemId: string; code: string; name: Names; qtyMilli: number; reorderMilli: number | null; soldMilli: number }

/**
 * Items running out: those at or below their reorder level (car parts), and those with nothing left that sold in the
 * last 30 days. Services and items without stock tracking are left out.
 */
export function lowStock(db: Db, date: string, limit = 20): LowStock[] {
  const since = addDays(date, -30);
  const hasReorder = !!db.prepare("SELECT 1 FROM part_details WHERE reorder_milli IS NOT NULL LIMIT 1").get();
  const rows = db.prepare(`WITH stock AS (SELECT item_id, SUM(qty_milli) AS qty FROM stock_moves WHERE date <= ? GROUP BY item_id),
                                sold AS (SELECT l.item_id, SUM(l.qty_milli) AS qty FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
                                         WHERE i.status = 'posted' AND i.kind = 'sale' AND i.date BETWEEN ? AND ? GROUP BY l.item_id)
                           SELECT it.id, it.code, it.name_ar, it.name_en, it.name_ku, COALESCE(s.qty, 0) AS qty,
                                  ${hasReorder ? 'pd.reorder_milli' : 'NULL'} AS reorder, COALESCE(so.qty, 0) AS sold
                           FROM items it LEFT JOIN stock s ON s.item_id = it.id LEFT JOIN sold so ON so.item_id = it.id
                           ${hasReorder ? 'LEFT JOIN part_details pd ON pd.item_id = it.id' : ''}
                           WHERE it.active = 1 AND it.track_stock = 1 AND (
                             ${hasReorder ? '(pd.reorder_milli IS NOT NULL AND COALESCE(s.qty, 0) <= pd.reorder_milli) OR' : ''}
                             (COALESCE(s.qty, 0) <= 0 AND COALESCE(so.qty, 0) > 0))
                           ORDER BY sold DESC, qty ASC LIMIT ?`).all(date, since, date, limit) as
    { id: string; code: string; name_ar: string; name_en: string; name_ku: string; qty: number; reorder: number | null; sold: number }[];
  return rows.map((r) => ({ itemId: r.id, code: r.code, name: name(r), qtyMilli: num(r.qty), reorderMilli: r.reorder === null ? null : num(r.reorder), soldMilli: num(r.sold) }));
}

export interface StockValueRow { warehouseId: string; warehouseCode: string; warehouseName: Names; items: number; qtyMilli: number; value: number }

/** What the stock is worth in each warehouse (IQD, at average cost) on a day. */
export function stockValuation(db: Db, asOf: string, branch: BranchFilter = null): { warehouses: StockValueRow[]; items: (LowStock & { warehouseId: string; value: number })[] } {
  const [w, wp] = inBranch('m.warehouse_id', branch?.warehouses);
  const items = db.prepare(`SELECT m.warehouse_id, it.id, it.code, it.name_ar, it.name_en, it.name_ku, SUM(m.qty_milli) AS qty, SUM(m.value) AS value
                            FROM stock_moves m JOIN items it ON it.id = m.item_id WHERE m.date <= ?${w}
                            GROUP BY m.warehouse_id, it.id HAVING SUM(m.qty_milli) <> 0 OR SUM(m.value) <> 0
                            ORDER BY value DESC`).all(asOf, ...wp) as
    { warehouse_id: string; id: string; code: string; name_ar: string; name_en: string; name_ku: string; qty: number; value: number }[];
  const warehouses = (db.prepare('SELECT id, code, name_ar, name_en, name_ku FROM warehouses ORDER BY code').all() as
    { id: string; code: string; name_ar: string; name_en: string; name_ku: string }[]).filter((x) => !branch || branch.warehouses.includes(x.id)).map((w) => {
    const mine = items.filter((i) => i.warehouse_id === w.id);
    return {
      warehouseId: w.id, warehouseCode: w.code, warehouseName: name(w), items: mine.length,
      qtyMilli: mine.reduce((s, i) => s + num(i.qty), 0), value: mine.reduce((s, i) => s + num(i.value), 0)
    };
  });
  return {
    warehouses,
    items: items.map((r) => ({ warehouseId: r.warehouse_id, itemId: r.id, code: r.code, name: name(r), qtyMilli: num(r.qty), reorderMilli: null, soldMilli: 0, value: num(r.value) }))
  };
}

// ——— profit ———

/** Revenue (4…) less expenses (3…) of approved entries in a period, IQD; the year-end closing entry is left out. */
export function profitBetween(db: Db, from: string, to: string): { revenue: number; expenses: number; profit: number } {
  const r = db.prepare(`SELECT COALESCE(SUM(CASE WHEN l.account_code LIKE '4%' THEN l.base_credit - l.base_debit END), 0) AS revenue,
                               COALESCE(SUM(CASE WHEN l.account_code LIKE '3%' THEN l.base_debit - l.base_credit END), 0) AS expenses
                        FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                        WHERE e.status = 'approved' AND e.date BETWEEN ? AND ? AND e.type <> 'closing'
                          AND NOT (e.type = 'reversal' AND EXISTS (SELECT 1 FROM entries c WHERE c.id = e.reverses_id AND c.type = 'closing'))`).get(from, to) as
    { revenue: number; expenses: number };
  return { revenue: num(r.revenue), expenses: num(r.expenses), profit: num(r.revenue) - num(r.expenses) };
}

// ——— the Daily Brief ———

export interface BriefView {
  date: string;
  company: Names;
  sales: { today: number; invoices: number; sameDayLastWeek: number; month: number };
  cash: { accounts: CashAccount[]; total: Money; base: number };
  flow: { in: number; out: number };
  topItems: ItemSales[];
  lateCustomers: AgingRow[];
  receivables: number;
  installments: { overdue: InstallmentDue[]; dueTomorrow: InstallmentDue[]; overdueTotal: Money };
  lowStock: LowStock[];
  approvals: { waitingCheck: number; waitingApproval: number };
  /** cheques due within a week (or past due) and cheques bounced in the last 30 days */
  cheques: { due: ChequeAlert[]; bounced: ChequeAlert[]; dueTotal: Money };
  ownerPhone: string;
}

export function dailyBrief(db: Db, date: string, branch: BranchFilter = null): BriefView {
  const company = (() => {
    try { return JSON.parse(readSetting(db, 'company_name') ?? '') as Names; } catch { return { ar: '', en: '', ku: '' }; }
  })();
  const today = salesBetween(db, date, date, branch);
  const accounts = cashAccounts(db, date, branch);
  const total: Money = { IQD: 0, USD: 0 };
  for (const a of accounts) { total.IQD += a.balance.IQD; total.USD += a.balance.USD; }
  const customers = aging(db, 'customer', date, branch);
  const inst = installmentsOn(db, date);
  const overdueTotal: Money = { IQD: 0, USD: 0 };
  for (const o of inst.overdue) overdueTotal[o.currency] += o.amount;
  const approvals = db.prepare(`SELECT COALESCE(SUM(status = 'draft'), 0) AS draft, COALESCE(SUM(status = 'checked'), 0) AS checked
                                FROM entries WHERE status IN ('draft', 'checked')`).get() as { draft: number; checked: number };
  return {
    date,
    company,
    sales: {
      today: today.amount, invoices: today.invoices,
      sameDayLastWeek: salesBetween(db, addDays(date, -7), addDays(date, -7), branch).amount,
      month: salesBetween(db, monthStart(date), date, branch).amount
    },
    cash: { accounts: accounts.filter((a) => a.balance.IQD !== 0 || a.balance.USD !== 0 || a.base !== 0), total, base: accounts.reduce((s, a) => s + a.base, 0) },
    flow: cashFlowOn(db, date, branch),
    topItems: salesByItem(db, date, date, 5, branch),
    // late: something owed for over 30 days
    lateCustomers: customers.filter((c) => c.oldestDays > 30).sort((a, b) => b.oldestDays - a.oldestDays || b.balance - a.balance).slice(0, 8),
    receivables: customers.reduce((s, c) => s + c.balance, 0),
    installments: { overdue: inst.overdue.slice(0, 10), dueTomorrow: inst.dueTomorrow, overdueTotal },
    lowStock: lowStock(db, date, 10),
    approvals: { waitingCheck: num(approvals.draft), waitingApproval: num(approvals.checked) },
    cheques: chequesAhead(db, date, 10),
    ownerPhone: readSetting(db, 'brief_phone') ?? ''
  };
}

// ——— the dashboard ———

export interface DashboardView {
  date: string;
  salesMonth: number;
  salesLastMonth: number;
  /** null for one branch: profit comes from the whole company's books, which have no branch */
  profitMonth: { revenue: number; expenses: number; profit: number } | null;
  cash: { total: Money; base: number };
  receivables: number;
  payables: number;
  /** the last six months, oldest first: month (YYYY-MM), net sales and profit (null for one branch) */
  months: { month: string; sales: number; profit: number | null }[];
  /** open cheques due within a week (late ones included), how many of those are late, and bounces in the last 30 days */
  cheques: { due: number; late: number; bounced: number; dueTotal: Money };
}

export function dashboard(db: Db, date: string, branch: BranchFilter = null): DashboardView {
  const start = monthStart(date);
  const accounts = cashAccounts(db, date, branch);
  const total: Money = { IQD: 0, USD: 0 };
  for (const a of accounts) { total.IQD += a.balance.IQD; total.USD += a.balance.USD; }
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const from = shiftMonth(date, -i);
    const to = i === 0 ? date : lastDayOfMonth(from);
    months.push({ month: from.slice(0, 7), sales: salesBetween(db, from, to, branch).amount, profit: branch ? null : profitBetween(db, from, to).profit });
  }
  const lastFrom = shiftMonth(date, -1);
  return {
    date,
    salesMonth: salesBetween(db, start, date, branch).amount,
    salesLastMonth: salesBetween(db, lastFrom, lastDayOfMonth(lastFrom), branch).amount,
    profitMonth: branch ? null : profitBetween(db, start, date),
    cash: { total, base: accounts.reduce((s, a) => s + a.base, 0) },
    receivables: aging(db, 'customer', date, branch).reduce((s, r) => s + r.balance, 0),
    payables: aging(db, 'supplier', date, branch).reduce((s, r) => s + r.balance, 0),
    months,
    cheques: (() => {
      const c = chequesAhead(db, date, Number.MAX_SAFE_INTEGER);
      return { due: c.due.length, late: c.due.filter((x) => x.daysLate > 0).length, bounced: c.bounced.length, dueTotal: c.dueTotal };
    })()
  };
}

// ——— quick expenses ———

export const EXPENSE_CATEGORIES = ['rent', 'power', 'fuel', 'salaries', 'internet', 'maintenance', 'transport', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * Where each kind of expense goes in the unified chart unless the company chose otherwise: rent, internet, maintenance
 * and transport are service supplies (33), electricity and generator fuel commodity supplies (32), salaries 31,
 * anything else other expenses (39). A group with sub-accounts resolves to its first postable one.
 */
const DEFAULT_EXPENSE_ACCOUNTS: Record<ExpenseCategory, string> = {
  rent: '33', power: '32', fuel: '32', salaries: '31', internet: '33', maintenance: '33', transport: '33', other: '39'
};

export function expenseAccounts(db: Db): Record<ExpenseCategory, string> {
  let saved: Partial<Record<ExpenseCategory, string>> = {};
  try { saved = JSON.parse(readSetting(db, 'expense_accounts') ?? '{}') as Partial<Record<ExpenseCategory, string>>; } catch { saved = {}; }
  const accounts = loadAccounts(db);
  const postable = new Set(accounts.filter((a) => a.postable).map((a) => a.code));
  const resolve = (code: string) => postable.has(code) ? code : accounts.find((a) => a.postable && a.code.startsWith(code) && a.code !== code)?.code ?? code;
  return Object.fromEntries(EXPENSE_CATEGORIES.map((c) => {
    const chosen = saved[c];
    return [c, chosen && postable.has(chosen) ? chosen : resolve(DEFAULT_EXPENSE_ACCOUNTS[c])];
  })) as Record<ExpenseCategory, string>;
}

export function setExpenseAccounts(db: Db, input: Partial<Record<ExpenseCategory, string>>, user: string): Record<ExpenseCategory, string> {
  const accounts = loadAccounts(db);
  const errors: { code: string; category: string }[] = [];
  for (const [category, code] of Object.entries(input)) {
    const a = accounts.find((x) => x.code === code);
    if (!a || !a.postable || !a.code.startsWith('3')) errors.push({ code: 'expense_account_invalid', category });
  }
  if (errors.length) throw invalid(errors);
  writeSetting(db, 'expense_accounts', JSON.stringify({ ...JSON.parse(readSetting(db, 'expense_accounts') ?? '{}'), ...input }));
  audit(db, user, 'update', 'settings', 'expense_accounts', input);
  return expenseAccounts(db);
}

export interface ExpenseRow {
  entryId: string; number: string | null; date: string; status: string; description: string; cashAccountCode: string | null;
  accountCode: string; category: ExpenseCategory | null; currency: 'IQD' | 'USD'; amount: number; base: number;
}

export interface ExpenseAccountTotal { accountCode: string; name: Names; category: ExpenseCategory | null; amount: number }

/**
 * A month's expenses: payment vouchers (any stage, not reversed) and their lines on expense accounts (3…). A line's
 * kind is known only when one kind alone goes to its account: by default rent, internet, maintenance and transport
 * share 33, so such a line has no kind (null) and is shown under its account's name, never as "rent". `byAccount`
 * adds up every line by account; `byCategory` only the lines whose kind is known.
 */
export function monthExpenses(db: Db, month: string): { rows: ExpenseRow[]; byCategory: Record<string, number>; byAccount: ExpenseAccountTotal[]; total: number } {
  const from = `${month}-01`;
  const to = lastDayOfMonth(from);
  const map = expenseAccounts(db);
  const categoryOf = (code: string): ExpenseCategory | null => {
    const kinds = EXPENSE_CATEGORIES.filter((c) => map[c] === code);
    return kinds.length === 1 ? kinds[0]! : null;
  };
  const rows = (db.prepare(`SELECT e.id, e.number, e.date, e.status, e.description, e.cash_account, e.currency, l.account_code, l.debit, l.base_debit
                            FROM entries e JOIN entry_lines l ON l.entry_id = e.id
                            WHERE e.type = 'payment' AND e.reversed_by_id IS NULL AND e.date BETWEEN ? AND ? AND l.account_code LIKE '3%' AND l.debit > 0
                            ORDER BY e.date DESC, e.number DESC`).all(from, to) as
    { id: string; number: string | null; date: string; status: string; description: string; cash_account: string | null; currency: 'IQD' | 'USD'; account_code: string; debit: number; base_debit: number }[])
    .map((r) => ({
      entryId: r.id, number: r.number, date: r.date, status: r.status, description: r.description, cashAccountCode: r.cash_account,
      accountCode: r.account_code, category: categoryOf(r.account_code), currency: r.currency, amount: num(r.debit), base: num(r.base_debit)
    }));
  const byCategory: Record<string, number> = {};
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.category) byCategory[r.category] = (byCategory[r.category] ?? 0) + r.base;
    totals.set(r.accountCode, (totals.get(r.accountCode) ?? 0) + r.base);
  }
  const names = new Map(loadAccounts(db).map((a) => [a.code, a.name]));
  const byAccount = [...totals].map(([accountCode, amount]) => ({ accountCode, name: names.get(accountCode) ?? { ar: accountCode, en: accountCode, ku: accountCode }, category: categoryOf(accountCode), amount }))
    .sort((a, b) => b.amount - a.amount);
  return { rows, byCategory, byAccount, total: rows.reduce((s, r) => s + r.base, 0) };
}

// ——— the API ———

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')));
const range = z.object({ from: date.optional(), to: date.optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

/**
 * The branch a report is for: `branchId` in the query, or the x-qasa-branch header the app sends from the branch
 * switcher. A user limited to some branches always gets theirs (asking for another is refused); others get the whole
 * company unless they pick a branch.
 */
function branchOf(db: Db, req: ApiRequest, actor: Parameters<typeof scopeOf>[1]): BranchFilter {
  const q = (req.query ?? {}) as { branchId?: unknown };
  const raw = req.headers['x-qasa-branch'];
  const wanted = typeof q.branchId === 'string' && q.branchId ? q.branchId : typeof raw === 'string' && raw ? raw : null;
  if (wanted && !db.prepare('SELECT 1 FROM branches WHERE id = ?').get(wanted)) throw invalid([{ code: 'bn_branch_invalid' }]);
  return scopeLists(scopeOf(db, actor, wanted));
}

function period(req: ApiRequest): { from: string; to: string } {
  const q = parse(range, req.query ?? {});
  const to = q.to ?? todayIso();
  const from = q.from ?? monthStart(to);
  if (from > to) throw invalid([{ code: 'range_invalid' }]);
  return { from, to };
}

/**
 * Reading is open to every signed-in user, as the app's other reports are; changing the brief's settings (the owner's
 * WhatsApp number, where each expense goes) needs an admin — they are not listed in rules.
 */
export const briefApi: ApiExtension = {
  routes(db, { actorOf }) {
    return [
      {
        method: 'GET', path: '/api/brief',
        handler: async (req) => dailyBrief(db, parse(z.object({ date: date.optional() }), req.query ?? {}).date ?? todayIso(), branchOf(db, req, actorOf(req)))
      },
      {
        method: 'GET', path: '/api/brief/dashboard',
        handler: async (req) => dashboard(db, parse(z.object({ date: date.optional() }), req.query ?? {}).date ?? todayIso(), branchOf(db, req, actorOf(req)))
      },
      {
        method: 'GET', path: '/api/brief/settings',
        handler: async () => ({ ownerPhone: readSetting(db, 'brief_phone') ?? '', expenseAccounts: expenseAccounts(db) })
      },
      {
        method: 'PUT', path: '/api/brief/settings',
        handler: async (req) => {
          const body = parse(z.object({
            ownerPhone: z.string().max(30).regex(/^[0-9+ ()-]*$/).optional(),
            expenseAccounts: z.partialRecord(z.enum(EXPENSE_CATEGORIES), z.string().min(1).max(12)).optional()
          }), req.body ?? {});
          const user = actorOf(req).name;
          if (body.ownerPhone !== undefined) {
            writeSetting(db, 'brief_phone', body.ownerPhone.trim());
            audit(db, user, 'update', 'settings', 'brief_phone');
          }
          const accounts = body.expenseAccounts ? setExpenseAccounts(db, body.expenseAccounts, user) : expenseAccounts(db);
          return { ownerPhone: readSetting(db, 'brief_phone') ?? '', expenseAccounts: accounts };
        }
      },
      {
        method: 'GET', path: '/api/brief/expenses',
        handler: async (req) => {
          const q = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }), req.query ?? {});
          return monthExpenses(db, q.month ?? todayIso().slice(0, 7));
        }
      },
      { method: 'GET', path: '/api/brief/reports/sales-by-item', handler: async (req) => { const p = period(req); return { ...p, rows: salesByItem(db, p.from, p.to, 500, branchOf(db, req, actorOf(req))) }; } },
      { method: 'GET', path: '/api/brief/reports/sales-by-customer', handler: async (req) => { const p = period(req); return { ...p, rows: salesByCustomer(db, p.from, p.to, branchOf(db, req, actorOf(req))) }; } },
      {
        method: 'GET', path: '/api/brief/reports/aging',
        handler: async (req) => {
          const q = parse(z.object({ type: z.enum(['customer', 'supplier']), date: date.optional() }), req.query ?? {});
          const asOf = q.date ?? todayIso();
          return { date: asOf, type: q.type, rows: aging(db, q.type, asOf, branchOf(db, req, actorOf(req))) };
        }
      },
      {
        method: 'GET', path: '/api/brief/reports/stock-value',
        handler: async (req) => {
          const asOf = parse(z.object({ date: date.optional() }), req.query ?? {}).date ?? todayIso();
          return { date: asOf, ...stockValuation(db, asOf, branchOf(db, req, actorOf(req))) };
        }
      }
    ];
  }
};
