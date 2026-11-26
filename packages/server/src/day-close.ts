import { z } from 'zod';
import { addDays, todayIso, toBase, type CurrencyCode, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { AppError } from './errors.ts';
import { readSetting } from './settings.ts';
import { entryInBranchSql } from './branches.ts';
import { getShift, openedShift, shiftInvoiceIds, type CashMoves, type PosMethod } from './pos.ts';
import { loyaltyPaidFor } from './loyalty.ts';
import { branchOf, cashFlowOn, expensesBetween, lowStock, salesByItem, type BranchFilter, type ExpenseRow, type ItemSales, type LowStock } from './brief.ts';
import { seesBooks, type Actor } from './auth.ts';
import { closesBlind } from './till-settings.ts';
import { expiredUnused } from './gift-vouchers.ts';
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
export const DAY_METHODS = ['cash', 'bank', 'card', 'fib', 'zaincash', 'qi', 'credit', 'loyalty', 'voucher'] as const;
export type DayMethod = (typeof DAY_METHODS)[number];

export interface DayRegister {
  shiftId: string; number: string; register: string; openedBy: string; status: 'open' | 'closed'; openedAt: string; closedAt: string | null;
  sales: Money; count: number; expected: Money; counted: Money | null; difference: Money | null;
  /**
   * 2.0: the other cash on the register's safe while its shift was open (a supplier or an expense paid out of the
   * drawer, a debt collected into it), which `expected` holds; left out when there was none
   */
  cashMoves?: CashMoves;
  /** an open shift of a cashier who closes blind: its figures are left out */
  blind?: true;
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
  /** the day's expenses: left out of someone's own part (OwnPart), as they are the branch's, not theirs */
  expenses?: { rows: ExpenseRow[]; total: number };
  debts: { collected: number; collectedRows: DayDebtRow[]; added: number; addedRows: DayDebtRow[] };
  /** the money in and out of the safes and banks: left out of someone's own part (OwnPart), as expenses are */
  flow?: { in: number; out: number };
  lowStock: { count: number; top: LowStock[] };
  /** 2.0: gift vouchers past their date still owed (for those who keep the books) */
  giftExpired?: { count: number; amount: number };
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

/**
 * The part of the day someone who does not keep the books gets (1.4.1, the owner's decision): the shifts they opened
 * themselves, the invoices of those shifts (their sales and the returns paid out of their drawers), and the receipt
 * vouchers they prepared themselves. null: the whole day, for those who keep the books.
 */
interface OwnPart { userId: string | null; shiftIds: string[]; invoiceIds: string[] }

function salesByMethod(db: Db, date: string, branch: BranchFilter, own: OwnPart | null): Pick<DayCloseView, 'sales' | 'methods' | 'refunds'> {
  const [b, bp] = inList('i.warehouse_id', branch?.warehouses);
  const [o, op] = inList('i.id', own?.invoiceIds);
  const w = b + o;
  const wp = [...bp, ...op];
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
  // 2.0: a till sale's gift vouchers and dinar rounding (pos_sales)
  const till = new Map<string, { voucher: number; rounding: number }>();
  if (rows.length) {
    for (const t of db.prepare(`SELECT s.invoice_id, s.voucher_paid, s.rounding FROM pos_sales s JOIN invoices i ON i.id = s.invoice_id
                                WHERE i.status = 'posted' AND i.kind = 'sale' AND i.date = ?${w}`).all(date, ...wp) as { invoice_id: string; voucher_paid: number | null; rounding: number | null }[]) {
      till.set(t.invoice_id, { voucher: num(t.voucher_paid ?? 0), rounding: num(t.rounding ?? 0) });
    }
  }
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
    const t = till.get(r.id) ?? { voucher: 0, rounding: 0 };
    add('voucher', t.voucher, r.id);
    // what no part says: the invoice's own way, into its safe or bank, or on the customer's account (a till sale's
    // vouchers paid none of it, and its cash rows hold the rounding already)
    const rest = base(total - own.reduce((s, p) => s + p.amount, 0)) - byPoints - t.voucher + t.rounding;
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
        sales: v.sales, count: v.count, expected: v.expected, counted: v.counted, difference: v.difference,
        ...(v.cashMoves.count ? { cashMoves: v.cashMoves } : {})
      };
    });
}

/**
 * Debts on the day, from approved entries that still stand (neither reversed nor reversals): what customers paid off
 * (receipt vouchers crediting them) and what they newly owe (sales put on their account, a till sale's on-account part
 * included). For one branch, only its own entries (branches.ts).
 */
function debtsOn(db: Db, date: string, branch: BranchFilter, own: OwnPart | null): DayCloseView['debts'] {
  const [b, bp] = entryInBranchSql('e', branch);
  // someone who does not keep the books: the sales of their own shifts, and the receipts they prepared themselves
  const [o, op]: [string, (string | null)[]] = own
    ? [` AND ((e.type = 'sale' AND e.id IN (SELECT i.entry_id FROM invoices i WHERE i.id IN (${marks(own.invoiceIds)})))
              OR (e.type = 'receipt' AND e.prepared_by_id = ?))`, [...own.invoiceIds, own.userId]]
    : ['', []];
  const rows = db.prepare(`SELECT p.id, p.code, p.name, e.type, SUM(l.base_debit) AS debit, SUM(l.base_credit) AS credit
                           FROM entry_lines l JOIN entries e ON e.id = l.entry_id JOIN parties p ON p.id = l.party_id
                           WHERE p.type = 'customer' AND e.status = 'approved' AND e.date = ? AND e.type IN ('receipt', 'sale')
                             AND e.reversed_by_id IS NULL${b}${o}
                           GROUP BY p.id, p.code, p.name, e.type`).all(date, ...bp, ...op) as
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

/**
 * The day's close. `viewer` (1.4.1): who asks; someone who does not keep the books gets the registers they opened
 * themselves and the sales, returns, best sellers and debts of those shifts only (OwnPart). Without a viewer, or for
 * someone who keeps the books, the whole day. `mine` (phone app 1.1): the viewer's own part whatever else they may
 * read: a phone that keeps no PIN asks so (pro/src/phone), also for a cashier who keeps the stock or buys and so reads
 * the books on a PC. An own part has none of the branch's expenses and money in and out of its safes and banks.
 */
export function dayClose(db: Db, date: string, branch: BranchFilter = null, viewer: Actor | null = null, mine = false): DayCloseView {
  const company = (() => {
    try { return JSON.parse(readSetting(db, 'company_name') ?? '') as Names; } catch { return { ar: '', en: '', ku: '' }; }
  })();
  let registers = registersOn(db, date, branch);
  let own: OwnPart | null = null;
  if (viewer && (mine || !seesBooks(viewer))) {
    registers = registers.filter((r) => openedShift(db, r.shiftId, viewer));
    // a cashier who closes blind (till-settings.ts) never reads what an open shift of theirs expects: its register shows
    // no sales, expected cash or difference, and its sales are left out of the day's totals until it is closed
    const blind = closesBlind(db, viewer);
    if (blind) {
      registers = registers.map((r) => {
        if (r.status !== 'open') return r;
        // (the other cash on its safe tells what it expects too)
        const { cashMoves: _moves, ...rest } = r;
        return { ...rest, sales: { IQD: 0, USD: 0 }, expected: { IQD: 0, USD: 0 }, difference: null, blind: true as const };
      });
    }
    const shiftIds = registers.filter((r) => !(blind && r.status === 'open')).map((r) => r.shiftId);
    own = { userId: viewer.id, shiftIds, invoiceIds: [...new Set(shiftIds.flatMap((id) => shiftInvoiceIds(db, id)))] };
  }
  const closed = registers.filter((r) => r.status === 'closed' && r.counted && r.difference);
  const drawers = closed.length
    ? closed.reduce((t, r) => ({
      expected: { IQD: t.expected.IQD + r.expected.IQD, USD: t.expected.USD + r.expected.USD },
      counted: { IQD: t.counted.IQD + r.counted!.IQD, USD: t.counted.USD + r.counted!.USD },
      difference: { IQD: t.difference.IQD + r.difference!.IQD, USD: t.difference.USD + r.difference!.USD }
    }), { expected: zero(), counted: zero(), difference: zero() })
    : null;
  // the branch's expenses and the money in and out of its safes and banks are nobody's own part: left out of it, so a
  // phone asking mine=1 for someone who may read the books gets no more than a cashier does (cost-view.ts leaves them
  // out for a cashier anyway)
  const money = own ? null : { expenses: expensesBetween(db, date, date, branch), flow: cashFlowOn(db, date, branch) };
  // every item running out: the count, and the five that sell best
  const short = lowStock(db, date, 10_000, branch);
  return {
    date,
    company,
    ...salesByMethod(db, date, branch, own),
    registers,
    drawers,
    ...(money ? { expenses: { rows: money.expenses.rows, total: money.expenses.total } } : {}),
    debts: debtsOn(db, date, branch, own),
    ...(money ? { flow: money.flow } : {}),
    lowStock: { count: short.length, top: short.slice(0, 5) },
    // 2.0: gift vouchers past their date still owed in the books (for those who keep them: an admin writes them off)
    ...(money ? { giftExpired: expiredUnused(db, date) } : {}),
    topItems: salesByItem(db, date, date, 5, branch, own ? own.invoiceIds : null),
    ownerPhone: readSetting(db, 'brief_phone') ?? ''
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')));

/**
 * Reading is open to every signed-in user, as the Daily Brief is; a user limited to branches sees their own. Someone who
 * may not read the books (a cashier) gets the registers they opened themselves with their drawers, and the sales, best
 * sellers and debts of those shifts (1.4.1), without the expenses and the money in and out of the safes and banks
 * (cost-view.ts). `mine=1` asks for that own part whoever asks (the desktop never sends it).
 */
export const dayCloseApi: ApiExtension = {
  routes(db, { actorOf }) {
    return [
      {
        method: 'GET', path: '/api/brief/day-close',
        handler: async (req) => {
          const q = z.object({ date: isoDate.optional(), mine: z.enum(['1']).optional() }).safeParse(req.query ?? {});
          if (!q.success) throw new AppError(400, 'validation', q.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
          const actor = actorOf(req);
          return dayClose(db, q.data.date ?? todayIso(), branchOf(db, req, actor), actor, q.data.mine === '1');
        }
      }
    ];
  }
};
