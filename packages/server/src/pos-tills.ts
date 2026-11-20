import { randomUUID } from 'node:crypto';
import { tillRules, useApproval } from './till-settings.ts';
import { z } from 'zod';
import { cleanScalePrefixes, todayIso, toBase, type CurrencyCode } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { planStatus } from './license.ts';
import { readSetting, writeSetting } from './settings.ts';
import { seesBooks, type Actor } from './auth.ts';
import { getShift, openedShift } from './pos.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Tills (2.0, supermarkets): the shop's named registers. Each keeps the safe and warehouse its shifts use, whether the
 * cash drawer opens on a cash sale (through the receipt printer of the PC the till runs on) and whether it has a
 * customer screen. A PC picks its till once and remembers it; a shift opened there is that till's, with its own cash.
 *
 * Every plan has one till; more need Starter or above ('multiTill'). Shifts typed by register name, as before 2.0,
 * keep working on every plan. Also here: the cash drawer opened with no sale (written to the audit log, so the owner
 * sees who opened it when), the scale labels that carry a price, and the sales of a period till by till.
 */

export interface TillView {
  id: string;
  name: string;
  cashAccountCode: string;
  warehouseId: string;
  drawer: 'off' | 'cash';
  customerDisplay: boolean;
  active: boolean;
  /** the open shift on it now, if any */
  openShiftId: string | null;
}

export interface TillInput {
  name: string;
  cashAccountCode: string;
  warehouseId: string;
  drawer?: 'off' | 'cash' | undefined;
  customerDisplay?: boolean | undefined;
  active?: boolean | undefined;
}

interface TillRow {
  id: string; name: string; cash_account: string; warehouse_id: string; drawer: 'off' | 'cash'; customer_display: number; active: number;
}

export const multiTillAvailable = (db: Db): boolean => planStatus(db).features.includes('multiTill');

const view = (db: Db, r: TillRow): TillView => {
  const open = db.prepare("SELECT id FROM pos_shifts WHERE status = 'open' AND till_id = ? ORDER BY opened_at DESC LIMIT 1").get(r.id) as { id: string } | undefined;
  return {
    id: r.id, name: r.name, cashAccountCode: r.cash_account, warehouseId: r.warehouse_id, drawer: r.drawer,
    customerDisplay: Number(r.customer_display) === 1, active: Number(r.active) === 1, openShiftId: open?.id ?? null
  };
};

export function listTills(db: Db): TillView[] {
  return (db.prepare('SELECT * FROM pos_tills ORDER BY active DESC, name').all() as unknown as TillRow[]).map((r) => view(db, r));
}

export function getTill(db: Db, id: string): TillView {
  const r = db.prepare('SELECT * FROM pos_tills WHERE id = ?').get(id) as unknown as TillRow | undefined;
  if (!r) throw notFound('till');
  return view(db, r);
}

function checkTill(db: Db, input: TillInput, id: string | null): void {
  const errors: { code: string }[] = [];
  const name = input.name?.trim() ?? '';
  if (!name || name.length > 60) errors.push({ code: 'till_name_required' });
  const account = loadAccounts(db).find((a) => a.code === input.cashAccountCode);
  if (!input.cashAccountCode?.startsWith('18') || !account?.postable) errors.push({ code: 'cash_account_invalid' });
  const warehouse = db.prepare('SELECT active FROM warehouses WHERE id = ?').get(input.warehouseId) as { active: number } | undefined;
  if (!warehouse || Number(warehouse.active) !== 1) errors.push({ code: 'warehouse_invalid' });
  if (errors.length) throw invalid(errors);
  const same = (db.prepare('SELECT id, name FROM pos_tills').all() as { id: string; name: string }[])
    .some((t) => t.id !== id && t.name.trim().toLowerCase() === name.toLowerCase());
  if (same) throw conflict('till_name_taken');
  // one till on every plan; a second active one needs the plan
  if (input.active !== false && !multiTillAvailable(db)) {
    const others = db.prepare('SELECT COUNT(*) AS n FROM pos_tills WHERE active = 1 AND id <> ?').get(id ?? '') as { n: number };
    if (Number(others.n) >= 1) throw conflict('plan_limit', { limit: 'multiTill', plan: planStatus(db).plan });
  }
}

export function createTill(db: Db, input: TillInput, user: string): TillView {
  checkTill(db, input, null);
  const id = randomUUID();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO pos_tills (id, name, cash_account, warehouse_id, drawer, customer_display, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.name.trim(), input.cashAccountCode, input.warehouseId, input.drawer ?? 'off', input.customerDisplay ? 1 : 0, input.active === false ? 0 : 1, now, now);
    audit(db, user, 'create', 'pos_till', id, { name: input.name.trim() });
  });
  return getTill(db, id);
}

export function updateTill(db: Db, id: string, input: TillInput, user: string): TillView {
  const before = getTill(db, id);
  checkTill(db, input, id);
  // an open shift keeps its till's name, safe and warehouse: those wait until it is closed
  if (before.openShiftId && (input.name.trim() !== before.name || input.cashAccountCode !== before.cashAccountCode || input.warehouseId !== before.warehouseId || input.active === false)) {
    throw conflict('till_has_open_shift');
  }
  transaction(db, () => {
    db.prepare('UPDATE pos_tills SET name = ?, cash_account = ?, warehouse_id = ?, drawer = ?, customer_display = ?, active = ?, updated_at = ? WHERE id = ?')
      .run(input.name.trim(), input.cashAccountCode, input.warehouseId, input.drawer ?? before.drawer, (input.customerDisplay ?? before.customerDisplay) ? 1 : 0,
        input.active === false ? 0 : 1, new Date().toISOString(), id);
    audit(db, user, 'update', 'pos_till', id, input);
  });
  return getTill(db, id);
}

/* ---------- the cash drawer opened with no sale ---------- */

/**
 * The drawer opened with no sale (to give change, or a check): by whoever runs the shift, written to the audit log
 * with the reason. The Windows app opens the drawer after this answers, never before, so every opening is on record.
 */
export function drawerOpened(db: Db, shiftId: string, reason: string, actor: Actor, approvals?: readonly string[]): { opened: number } {
  const shift = getShift(db, shiftId, actor);
  if (shift.status !== 'open') throw conflict('pos_shift_closed');
  if (!shift.actions.includes('sell')) throw new AppError(403, 'forbidden', { need: 'shift_owner' });
  // 2.0: a company may want a supervisor's PIN for each opening with no sale (till-settings.ts)
  const approver = tillRules(db).supervisor.noSale ? useApproval(db, approvals, shiftId, 'no_sale', actor.name) : null;
  audit(db, actor.name, 'drawer_open', 'pos_shift', shiftId, { reason: reason.trim().slice(0, 200) || null, register: shift.register, ...(approver ? { approver } : {}) });
  return { opened: drawerOpenings(db, shiftId) };
}

/** How many times the drawer of a shift was opened with no sale. */
export function drawerOpenings(db: Db, shiftId: string): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'pos_shift' AND entity_id = ? AND action = 'drawer_open'").get(shiftId) as { n: number }).n);
}

/* ---------- scale labels that carry the price ---------- */

const SCALE_KEY = 'pos_scale_price_prefixes';

export function scalePricePrefixes(db: Db): string[] {
  try { return cleanScalePrefixes(JSON.parse(readSetting(db, SCALE_KEY) ?? '[]') as unknown[]); } catch { return []; }
}

export function setScalePricePrefixes(db: Db, list: readonly string[], user: string): string[] {
  const clean = cleanScalePrefixes(list);
  if (clean.length !== list.length) throw invalid([{ code: 'scale_prefix_invalid' }]);
  transaction(db, () => {
    writeSetting(db, SCALE_KEY, JSON.stringify(clean));
    audit(db, user, 'update', 'settings', SCALE_KEY, clean);
  });
  return clean;
}

/* ---------- the sales of a period, till by till ---------- */

type Money = Record<CurrencyCode, number>;

export interface TillSummaryRow {
  /** the till's id, or null for a register typed by name */
  tillId: string | null;
  register: string;
  shifts: number;
  sales: Money;
  count: number;
  /** what each way of paying brought, in IQD (dollar sales at their invoice's rate) */
  methods: Record<string, number>;
  /** the closed shifts' counted − expected, by currency */
  difference: Money;
  /** drawer openings with no sale */
  noSale: number;
}

/**
 * The shifts opened between two days (this PC's calendar), grouped by till (or by register name for shifts without
 * one). Whoever keeps the books reads all of them; anyone else only the shifts they opened.
 */
export function tillSummary(db: Db, from: string, to: string, actor: Actor | null): TillSummaryRow[] {
  const rows = db.prepare('SELECT id, register, till_id, opened_at FROM pos_shifts ORDER BY opened_at').all() as { id: string; register: string; till_id: string | null; opened_at: string }[];
  const out = new Map<string, TillSummaryRow>();
  const own = !!actor && !seesBooks(actor);
  for (const r of rows) {
    const day = todayIso(new Date(r.opened_at));
    if (day < from || day > to) continue;
    if (own && !openedShift(db, r.id, actor!)) continue;
    const s = getShift(db, r.id, actor);
    const key = r.till_id ?? `name:${r.register.trim().toLowerCase()}`;
    const row = out.get(key) ?? { tillId: r.till_id, register: s.register, shifts: 0, sales: { IQD: 0, USD: 0 }, count: 0, methods: {}, difference: { IQD: 0, USD: 0 }, noSale: 0 };
    row.shifts++;
    row.sales.IQD += s.sales.IQD;
    row.sales.USD += s.sales.USD;
    row.count += s.count;
    const rate = Number(readSetting(db, 'default_rate_x100') ?? '142000');
    for (const [m, money] of Object.entries(s.methods)) {
      if (!money) continue;
      row.methods[m] = (row.methods[m] ?? 0) + money.IQD + toBase(money.USD, 'USD', rate);
    }
    if (s.difference) { row.difference.IQD += s.difference.IQD; row.difference.USD += s.difference.USD; }
    row.noSale += drawerOpenings(db, r.id);
    out.set(key, row);
  }
  return [...out.values()].sort((a, b) => a.register.localeCompare(b.register));
}

/* ---------- the API ---------- */

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const tillBody = z.object({
  name: z.string().min(1).max(60), cashAccountCode: z.string().min(1).max(12), warehouseId: id,
  drawer: z.enum(['off', 'cash']).optional(), customerDisplay: z.boolean().optional(), active: z.boolean().optional()
});
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Reading the tills (to pick one on a PC), the scale prefixes, and opening the drawer with no sale need the Point of
 * sale permission; the summary is read like the shifts (books keepers all, cashiers their own); changing tills and
 * the scale prefixes is for an admin (not listed: every change not listed needs one).
 */
export const posTillsApi: ApiExtension = {
  rules: {
    'GET /api/pos/tills': 'pos',
    'GET /api/pos/scale': 'pos',
    'POST /api/pos/shifts/:id/drawer': 'pos'
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      { method: 'GET', path: '/api/pos/tills', handler: async () => ({ tills: listTills(db), multiTill: multiTillAvailable(db) }) },
      {
        method: 'POST', path: '/api/pos/tills',
        handler: async (req, reply) => {
          reply.status(201).send(createTill(db, parse(tillBody, req.body), actor(req).name));
          return undefined;
        }
      },
      { method: 'PUT', path: '/api/pos/tills/:id', handler: async (req) => updateTill(db, parse(z.object({ id }), req.params).id, parse(tillBody, req.body), actor(req).name) },
      {
        method: 'GET', path: '/api/pos/tills/summary',
        handler: async (req) => {
          const today = todayIso();
          const f = parse(z.object({ from: day.optional(), to: day.optional() }), req.query ?? {});
          return { from: f.from ?? today, to: f.to ?? today, rows: tillSummary(db, f.from ?? today, f.to ?? today, actor(req)) };
        }
      },
      {
        method: 'POST', path: '/api/pos/shifts/:id/drawer',
        handler: async (req) => {
          const body = parse(z.object({ reason: z.string().max(200).optional(), approvals: z.array(id).max(4).optional() }), req.body ?? {});
          return drawerOpened(db, parse(z.object({ id }), req.params).id, body.reason ?? '', actor(req), body.approvals);
        }
      },
      { method: 'GET', path: '/api/pos/scale', handler: async () => ({ pricePrefixes: scalePricePrefixes(db) }) },
      {
        method: 'PUT', path: '/api/pos/scale',
        handler: async (req) => ({ pricePrefixes: setScalePricePrefixes(db, parse(z.object({ pricePrefixes: z.array(z.string().max(4)).max(10) }), req.body).pricePrefixes, actor(req).name) })
      }
    ];
  }
};
