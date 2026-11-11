import { z } from 'zod';
import { addDays, todayIso, toBase, type CurrencyCode, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { AppError } from './errors.ts';
import { readSetting } from './settings.ts';
import { entryInBranchSql } from './branches.ts';
import { getShift, type PosMethod } from './pos.ts';
import { loyaltyPaidFor } from './loyalty.ts';
import { branchOf, cashFlowOn, expensesBetween, lowStock, salesByItem, type BranchFilter, type ExpenseRow, type ItemSales, type LowStock } from './brief.ts';
import type { ApiExtension } from './routes.ts';

/**
 * The end-of-day close (إغلاق اليوم): one page the owner reads when the shop shuts — the day's sales by how they were
 * paid, each register's cash expected against what was counted, the expenses, debts collected and new debts, how many
 * items are running out and the best sellers. Printable, exportable and sent to the owner on WhatsApp by the page.
 * It only reads the books (posted invoices, approved entries, the POS shifts); nothing here changes anything.
 * Amounts are in IQD (dollar sales at their invoice's rate) unless a field says otherwise.
 */

type Money = Record<CurrencyCode, number>;

/** How a sale was paid: cash or a bank (a cash invoice into a safe or a bank), a card or wallet at the till, on account, or points. */
export const DAY_METHODS = ['cash', 'bank', 'card', 'fib', 'zaincash', 'qi', 'credit', 'loyalty'] as const;
export type DayMethod = (typeof DAY_METHODS)[number];

export interface DayRegister {
  shiftId: string; number: string; register: string; openedBy: string; status: 'open' | 'closed'; openedAt: string; closedAt: string | null;
  sales: Money; count: number; expected: Money; counted: Money | null; difference: Money | null;
}

export interface DayDebtRow { partyId: string; code: string; name: string; amount: number }

export interface DayCloseView {
  date: string;
  company: Names;
  sales: { gross: number; invoices: number; returns: number; returnsCount: number; net: number };
  /** the day's sales by how they were paid (gross, before returns), biggest first; methods with nothing are left out */
  methods: { method: DayMethod; amount: number; invoices: number }[];
  /** how the day's returns were paid back */
  refunds: { method: DayMethod; amount: number }[];
  /** each register open on the day (opened, closed or still open), with its drawer count once closed */
  registers: DayRegister[];
  /** the registers closed: expected, counted and the difference; null when none was closed */
  drawers: { expected: Money; counted: Money; difference: Money } | null;
  expenses: { rows: ExpenseRow[]; total: number };
  debts: { collected: number; collectedRows: DayDebtRow[]; added: number; addedRows: DayDebtRow[] };
  flow: { in: number; out: number };
  lowStock: { count: number; top: LowStock[] };
  topItems: ItemSales[];
  ownerPhone: string;
}

const num = (v: unknown) => Number(v ?? 0);
const marks = (list: readonly string[]) => (list.length ? list.map(() => '?').join(', ') : 'NULL');
const inList = (col: string, list: readonly string[] | undefined): [string, string[]] => (list ? [` AND ${col} IN (${marks(list)})`, [...list]] : ['', []]);
const zero = (): Money => ({ IQD: 0, USD: 0 });
/** The day on this PC's calendar of a moment kept as an ISO timestamp (shifts keep theirs in UTC). */
const localDay = (iso: string) => todayIso(new Date(iso));
/** A cash invoice's money went into a safe (181…) or a bank (183…). */
const cashOrBank = (account: string | null): DayMethod => (account?.startsWith('183') ? 'bank' : 'cash');
const fromPos = (m: PosMethod): DayMethod => (m === 'account' ? 'credit' : m);

/** What loyalty points (Pro) paid of each sale or gave back on each return, in IQD. */
const loyaltyPaid = loyaltyPaidFor;

function salesByMethod(db: Db, date: string, branch: BranchFilter): Pick<DayCloseView, 'sales' | 'methods' | 'refunds'> {
  const [w, wp] = inList('i.warehouse_id', branch?.warehouses);
  const rows = db.prepare(`SELECT i.id, i.kind, i.currency, i.rate_x100, i.total, i.payment, i.cash_account FROM invoices i
                           WHERE i.status = 'posted' AND i.kind IN ('sale', 'sale_return') AND i.date = ?${w}`).all(date, ...wp) as
    { id: string; kind: 'sale' | 'sale_return'; currency: CurrencyCode; rate_x100: number; total: number; payment: 'cash' | 'credit'; cash_account: string | null }[];
  const parts = new Map<string, { method: PosMethod; amount: number }[]>();
  for (const p of db.prepare(`SELECT p.invoice_id, p.method, p.amount FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
                              WHERE p.kind = 'pos' AND i.status = 'posted' AND i.kind = 'sale' AND i.date = ?${w}`).all(date, ...wp) as
    { invoice_id: string; method: PosMethod; amount: number }[]) {
    parts.set(p.invoice_id, [...(parts.get(p.invoice_id) ?? []), { method: p.method, amount: num(p.amount) }]);
  }
  const points = loyaltyPaid(db, rows.map((r) => r.id));
  const methods = new Map<DayMethod, { amount: number; invoices: Set<string> }>();
  const refunds = new Map<DayMethod, number>();
  const add = (method: DayMethod, amount: number, invoice: string) => {
    if (amount === 0) return;
    const m = methods.get(method) ?? { amount: 0, invoices: new Set<string>() };
    m.amount += amount;
    m.invoices.add(invoice);
    methods.set(method, m);
  };
  let gross = 0, invoices = 0, returns = 0, returnsCount = 0;
  for (const r of rows) {
    const base = (amount: number) => toBase(amount, r.currency, num(r.rate_x100));
    const total = num(r.total);
    const byPoints = points.get(r.id) ?? 0;
    if (r.kind === 'sale_return') {
      returns += base(total);
      returnsCount++;
      // points given back are no money paid back
      const money = base(total) - byPoints;
      if (byPoints) refunds.set('loyalty', (refunds.get('loyalty') ?? 0) + byPoints);
      const how: DayMethod = r.payment === 'credit' ? 'credit' : cashOrBank(r.cash_account);
      if (money) refunds.set(how, (refunds.get(how) ?? 0) + money);
      continue;
    }
    gross += base(total);
    invoices++;
    const own = parts.get(r.id) ?? [];
    for (const p of own) add(fromPos(p.method), base(p.amount), r.id);
    add('loyalty', byPoints, r.id);
    // what no part says: the invoice's own way, into its safe or bank, or on the customer's account
    const rest = base(total - own.reduce((s, p) => s + p.amount, 0)) - byPoints;
    add(r.payment === 'credit' ? 'credit' : cashOrBank(r.cash_account), rest, r.id);
  }
  const order = (a: { amount: number; method: DayMethod }, b: { amount: number; method: DayMethod }) =>
    b.amount - a.amount || DAY_METHODS.indexOf(a.method) - DAY_METHODS.indexOf(b.method);
  return {
    sales: { gross, invoices, returns, returnsCount, net: gross - returns },
    methods: [...methods].map(([method, m]) => ({ method, amount: m.amount, invoices: m.invoices.size })).sort(order),
    refunds: [...refunds].filter(([, amount]) => amount !== 0).map(([method, amount]) => ({ method, amount })).sort(order)
  };
}

/**
 * The registers (POS shifts) open at some time on the day: opened on it or before, and closed on it or later (or still
 * open). A shift's times are moments; the day is this PC's.
 */
function registersOn(db: Db, date: string, branch: BranchFilter): DayRegister[] {
  const [w, wp] = inList('warehouse_id', branch?.warehouses);
  // a day either side of the UTC times; the exact local day is checked below
  const ids = db.prepare(`SELECT id, opened_at, closed_at FROM pos_shifts
                          WHERE opened_at < ? AND (closed_at IS NULL OR closed_at >= ?)${w} ORDER BY opened_at`)
    .all(`${addDays(date, 2)}T00:00:00`, `${addDays(date, -1)}T00:00:00`, ...wp) as { id: string; opened_at: string; closed_at: string | null }[];
  return ids
    .filter((s) => localDay(s.opened_at) <= date && (!s.closed_at || localDay(s.closed_at) >= date))
    .map((s) => {
      const v = getShift(db, s.id);
      return {
        shiftId: v.id, number: v.number, register: v.register, openedBy: v.openedBy, status: v.status, openedAt: v.openedAt, closedAt: v.closedAt,
        sales: v.sales, count: v.count, expected: v.expected, counted: v.counted, difference: v.difference
      };
    });
}

/**
 * Debts on the day, from approved entries that still stand (neither reversed nor reversals): what customers paid off
 * (receipt vouchers crediting them) and what they newly owe (sales put on their account, a till sale's on-account part
 * included). For one branch, only its own entries (branches.ts).
 */
function debtsOn(db: Db, date: string, branch: BranchFilter): DayCloseView['debts'] {
  const [b, bp] = entryInBranchSql('e', branch);
  const rows = db.prepare(`SELECT p.id, p.code, p.name, e.type, SUM(l.base_debit) AS debit, SUM(l.base_credit) AS credit
                           FROM entry_lines l JOIN entries e ON e.id = l.entry_id JOIN parties p ON p.id = l.party_id
                           WHERE p.type = 'customer' AND e.status = 'approved' AND e.date = ? AND e.type IN ('receipt', 'sale')
                             AND e.reversed_by_id IS NULL${b}
                           GROUP BY p.id, p.code, p.name, e.type`).all(date, ...bp) as
    { id: string; code: string; name: string; type: 'receipt' | 'sale'; debit: number; credit: number }[];
  const pick = (type: 'receipt' | 'sale', amount: (r: { debit: number; credit: number }) => number) => rows
    .filter((r) => r.type === type)
    .map((r) => ({ partyId: r.id, code: r.code, name: r.name, amount: amount({ debit: num(r.debit), credit: num(r.credit) }) }))
    .filter((r) => r.amount > 0)
    .sort((x, y) => y.amount - x.amount);
  const collectedRows = pick('receipt', (r) => r.credit - r.debit);
  const addedRows = pick('sale', (r) => r.debit - r.credit);
  const sum = (list: DayDebtRow[]) => list.reduce((s, r) => s + r.amount, 0);
  return { collected: sum(collectedRows), collectedRows, added: sum(addedRows), addedRows };
}

export function dayClose(db: Db, date: string, branch: BranchFilter = null): DayCloseView {
  const company = (() => {
    try { return JSON.parse(readSetting(db, 'company_name') ?? '') as Names; } catch { return { ar: '', en: '', ku: '' }; }
  })();
  const registers = registersOn(db, date, branch);
  const closed = registers.filter((r) => r.status === 'closed' && r.counted && r.difference);
  const drawers = closed.length
    ? closed.reduce((t, r) => ({
      expected: { IQD: t.expected.IQD + r.expected.IQD, USD: t.expected.USD + r.expected.USD },
      counted: { IQD: t.counted.IQD + r.counted!.IQD, USD: t.counted.USD + r.counted!.USD },
      difference: { IQD: t.difference.IQD + r.difference!.IQD, USD: t.difference.USD + r.difference!.USD }
    }), { expected: zero(), counted: zero(), difference: zero() })
    : null;
  const expenses = expensesBetween(db, date, date, branch);
  // every item running out: the count, and the five that sell best
  const short = lowStock(db, date, 10_000, branch);
  return {
    date,
    company,
    ...salesByMethod(db, date, branch),
    registers,
    drawers,
    expenses: { rows: expenses.rows, total: expenses.total },
    debts: debtsOn(db, date, branch),
    flow: cashFlowOn(db, date, branch),
    lowStock: { count: short.length, top: short.slice(0, 5) },
    topItems: salesByItem(db, date, date, 5, branch),
    ownerPhone: readSetting(db, 'brief_phone') ?? ''
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')));

/** Reading is open to every signed-in user, as the Daily Brief is; a user limited to branches sees their own. */
export const dayCloseApi: ApiExtension = {
  routes(db, { actorOf }) {
    return [
      {
        method: 'GET', path: '/api/brief/day-close',
        handler: async (req) => {
          const q = z.object({ date: isoDate.optional() }).safeParse(req.query ?? {});
          if (!q.success) throw new AppError(400, 'validation', q.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
          return dayClose(db, q.data.date ?? todayIso(), branchOf(db, req, actorOf(req)));
        }
      }
    ];
  }
};
