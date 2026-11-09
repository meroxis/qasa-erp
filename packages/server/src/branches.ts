import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { planStatus } from './license.ts';
import type { Actor } from './auth.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Branches (الفروع), Business. A branch groups warehouses and safes/banks (accounts under 18); a user can be limited to
 * some branches. Documents carry no branch of their own: an invoice or a stock document belongs to its warehouse's
 * branch, a voucher to its safe's. A limited user only sees and uses the warehouses and safes of their branches; the
 * ones in no branch are the company's own (head office) and stay out of their reach. Admins and users not limited
 * work everywhere. Limits keep working when the plan lapses (they only take rights away); making and changing branches
 * needs the plan.
 */

export interface BranchView {
  id: string;
  code: string;
  name: string;
  city: string;
  active: boolean;
  warehouses: { id: string; code: string }[];
  accounts: string[];
  users: { id: string; username: string; name: string }[];
}

/** What a user may reach; null = everything. */
export interface BranchScope {
  branchIds: string[];
  warehouses: Set<string>;
  accounts: Set<string>;
}

const available = (db: Db) => planStatus(db).features.includes('branches');
function requirePlan(db: Db): void {
  if (!available(db)) throw conflict('plan_limit', { limit: 'branches' });
}

const anyBranches = (db: Db) => !!db.prepare('SELECT 1 FROM branches LIMIT 1').get();

/**
 * Whether a user is limited to some branches (admins never are). An assignment to a branch that was made inactive still
 * limits the user: it gives them nothing (scopeOf), and never the whole company.
 */
export function isBranchLimited(db: Db, actor: Actor | null | undefined): boolean {
  if (!actor || !actor.id || actor.permissions.includes('admin')) return false;
  return !!db.prepare('SELECT 1 FROM user_branches WHERE user_id = ? LIMIT 1').get(actor.id);
}

/**
 * The branches a user is limited to, or null when they work in every branch (admins always do). Only active branches
 * count: deactivating a branch takes its warehouses and safes away from the users assigned to it, and a user whose
 * branches are all inactive gets an empty scope (no warehouse, no safe), never the whole company.
 */
export function scopeOf(db: Db, actor: Actor | null | undefined, only?: string | null): BranchScope | null {
  if (!actor || !actor.id || !isBranchLimited(db, actor)) return only ? scopeOfBranches(db, [only]) : null;
  const limited = (db.prepare(`SELECT ub.branch_id FROM user_branches ub JOIN branches b ON b.id = ub.branch_id
                               WHERE ub.user_id = ? AND b.active = 1`).all(actor.id) as { branch_id: string }[]).map((r) => r.branch_id);
  if (only) {
    if (!limited.includes(only)) throw new AppError(403, 'branch_forbidden');
    return scopeOfBranches(db, [only]);
  }
  return scopeOfBranches(db, limited);
}

function scopeOfBranches(db: Db, ids: string[]): BranchScope {
  if (!ids.length) return { branchIds: [], warehouses: new Set(), accounts: new Set() };
  const marks = ids.map(() => '?').join(', ');
  const warehouses = (db.prepare(`SELECT warehouse_id AS id FROM branch_warehouses WHERE branch_id IN (${marks})`).all(...ids) as { id: string }[]).map((r) => r.id);
  const accounts = (db.prepare(`SELECT account_code AS code FROM branch_accounts WHERE branch_id IN (${marks})`).all(...ids) as { code: string }[]).map((r) => r.code);
  return { branchIds: ids, warehouses: new Set(warehouses), accounts: new Set(accounts) };
}

/**
 * The warehouse a document falls back to when none is chosen: the first active one (by code) the user may use, as
 * elsewhere. A user limited to branches only gets one of their branches' warehouses; when those have no active one, the
 * user is asked to choose a warehouse instead of the document landing in another branch's (or the head office's).
 */
export function defaultWarehouseId(db: Db, actor: Actor | null | undefined): string {
  const active = (db.prepare('SELECT id FROM warehouses WHERE active = 1 ORDER BY code').all() as { id: string }[]).map((r) => r.id);
  const scope = anyBranches(db) ? scopeOf(db, actor) : null;
  const id = scope ? active.find((w) => scope.warehouses.has(w)) : active[0];
  if (!id) throw invalid([{ code: scope ? 'bn_warehouse_choose' : 'warehouse_invalid' }]);
  return id;
}

/** For report queries: the warehouses and safes of a scope (null = no filter). */
export function scopeLists(scope: BranchScope | null): { warehouses: string[]; accounts: string[] } | null {
  return scope ? { warehouses: [...scope.warehouses], accounts: [...scope.accounts] } : null;
}

/** The warehouses and safes of the branches a user is limited to, for report queries (null: not limited). */
export function userBranchLists(db: Db, actor: Actor | null | undefined): { warehouses: string[]; accounts: string[] } | null {
  return scopeLists(scopeOf(db, actor));
}

const sqlList = (list: readonly string[]) => (list.length ? list.map(() => '?').join(', ') : 'NULL');

/** SQL: entry `a` was made on one of the safes or banks, by a document of one of the warehouses, or for a cheque on a bank. */
function ownEntry(a: string, wh: readonly string[], acc: readonly string[]): [string, string[]] {
  return [`(${a}.cash_account IN (${sqlList(acc)})
      OR EXISTS (SELECT 1 FROM invoices bi WHERE (bi.entry_id = ${a}.id OR bi.cancel_entry_id = ${a}.id) AND bi.warehouse_id IN (${sqlList(wh)}))
      OR EXISTS (SELECT 1 FROM stock_docs bd WHERE (bd.entry_id = ${a}.id OR bd.cancel_entry_id = ${a}.id)
                 AND (bd.warehouse_id IN (${sqlList(wh)}) OR bd.to_warehouse_id IN (${sqlList(wh)})))
      OR EXISTS (SELECT 1 FROM stock_adjustments ba WHERE ba.entry_id = ${a}.id AND ba.warehouse_id IN (${sqlList(wh)}))
      OR EXISTS (SELECT 1 FROM cheques bc WHERE (bc.entry_id = ${a}.id OR bc.clear_entry_id = ${a}.id OR bc.bounce_entry_id = ${a}.id)
                 AND bc.bank_account IN (${sqlList(acc)})))`, [...acc, ...wh, ...wh, ...wh, ...wh, ...acc]];
}

/**
 * `AND <entry belongs to the branch>` for the entries aliased `alias`, with its parameters (nothing for the whole
 * company). An entry belongs to a branch when it is on one of its safes or banks, comes from an invoice, a stock
 * document or a stock adjustment of one of its warehouses (or cancels one), is for a cheque on one of its banks, or
 * reverses such an entry. Plain journals and cheques still in hand belong to no branch. The same rule serves the
 * aging report, the Daily Brief and customer and supplier statements (SQLite, MySQL and MariaDB alike).
 */
export function entryInBranchSql(alias: string, branch: { warehouses: readonly string[]; accounts: readonly string[] } | null): [string, string[]] {
  if (!branch) return ['', []];
  const [cond, params] = branchEntry(alias, branch.warehouses, branch.accounts);
  return [` AND ${cond}`, params];
}

function branchEntry(alias: string, wh: readonly string[], acc: readonly string[]): [string, string[]] {
  const [mine, mp] = ownEntry(alias, wh, acc);
  const [reversed, rp] = ownEntry('br', wh, acc);
  return [`(${mine} OR EXISTS (SELECT 1 FROM entries br WHERE br.id = ${alias}.reverses_id AND ${reversed}))`, [...mp, ...rp]];
}

// ——— keeping limited users inside their branches (called by the router for every request) ———

const isCash = (code: unknown): code is string => typeof code === 'string' && code.startsWith('18');
const forbidden = () => new AppError(403, 'branch_forbidden');

/**
 * The company's own books: reports computed from every posted line (the trial balance, final accounts, account
 * statements and the general ledger, the year-end closing, the currency revaluation) and the fixed assets register.
 * The books have no branch, so a user limited to branches gets none of them (admins are never limited).
 */
export const COMPANY_BOOKS: readonly string[] = ['/api/reports/', '/api/year-end', '/api/fx/revaluation', '/api/assets'];
export const isCompanyBooks = (path: string): boolean => COMPANY_BOOKS.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : p + '/'));

/** Refuses a request that touches a warehouse or safe outside the user's branches. */
export function checkBranchRequest(db: Db, actor: Actor | null, method: string, path: string, req: ApiRequest): void {
  if (!actor || actor.permissions.includes('admin') || !anyBranches(db)) return;
  const scope = scopeOf(db, actor);
  if (!scope) return;
  if (isCompanyBooks(path)) throw forbidden();
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  if (method !== 'GET') {
    // a document's own warehouse and safe (the destination of a transfer may be any branch)
    if (typeof body.warehouseId === 'string' && !scope.warehouses.has(body.warehouseId)) throw forbidden();
    // every safe or bank named in the body: a voucher's, a bank transfer's both ends, a cheque's or a statement's bank
    for (const key of ['cashAccountCode', 'cashAccount', 'downPaymentCashAccount', 'from', 'to', 'bankAccount', 'accountCode']) {
      if (isCash(body[key]) && !scope.accounts.has(body[key])) throw forbidden();
    }
    for (const list of [body.lines, body.items]) {
      if (!Array.isArray(list)) continue;
      for (const line of list as { accountCode?: unknown }[]) if (isCash(line?.accountCode) && !scope.accounts.has(line.accountCode)) throw forbidden();
    }
  }
  // a warehouse asked for in the query: a count sheet, a list narrowed to one warehouse
  const query = (req.query && typeof req.query === 'object' ? req.query : {}) as Record<string, unknown>;
  if (typeof query.warehouseId === 'string' && query.warehouseId && !scope.warehouses.has(query.warehouseId)) throw forbidden();
  const id = (req.params as { id?: unknown } | undefined)?.id;
  if (typeof id !== 'string') return;
  /** A document of one warehouse: refused when that warehouse is outside the user's branches (none: no branch). */
  const ofWarehouse = (sql: string) => {
    const row = db.prepare(sql).get(id) as { warehouse_id: string | null } | undefined;
    if (row?.warehouse_id && !scope.warehouses.has(row.warehouse_id)) throw forbidden();
  };
  if (path.startsWith('/api/invoices/:id')) {
    ofWarehouse('SELECT warehouse_id FROM invoices WHERE id = ?');
  } else if (path.startsWith('/api/adjustments/counts/:id')) {
    // a count session belongs to its warehouse's branch
    ofWarehouse('SELECT warehouse_id FROM stock_counts WHERE id = ?');
  } else if (path.startsWith('/api/adjustments/:id')) {
    // a stock adjustment or a stock count belongs to its warehouse's branch
    ofWarehouse('SELECT warehouse_id FROM stock_adjustments WHERE id = ?');
  } else if (path.startsWith('/api/purchase-orders/:id')) {
    // an order with no warehouse yet belongs to no branch
    ofWarehouse('SELECT warehouse_id FROM purchase_orders WHERE id = ?');
  } else if (path.startsWith('/api/pos/shifts/:id')) {
    const row = db.prepare('SELECT warehouse_id, cash_account FROM pos_shifts WHERE id = ?').get(id) as { warehouse_id: string; cash_account: string } | undefined;
    if (row && (!scope.warehouses.has(row.warehouse_id) || !scope.accounts.has(row.cash_account))) throw forbidden();
  } else if (path.startsWith('/api/stock-docs/:id')) {
    const row = db.prepare('SELECT warehouse_id, to_warehouse_id FROM stock_docs WHERE id = ?').get(id) as { warehouse_id: string; to_warehouse_id: string | null } | undefined;
    // the receiving branch may look at a transfer; only the sending one changes it
    const mine = row && (scope.warehouses.has(row.warehouse_id) || (method === 'GET' && !!row.to_warehouse_id && scope.warehouses.has(row.to_warehouse_id)));
    if (row && !mine) throw forbidden();
  } else if (path.startsWith('/api/entries/:id') || path.startsWith('/api/vouchers/:id')) {
    if (!visibleEntries(db, scope, [id]).has(id) && db.prepare('SELECT 1 FROM entries WHERE id = ?').get(id)) throw forbidden();
  } else if (path.startsWith('/api/banking/cheques/:id')) {
    // a cheque handed to (or drawn on) another branch's bank
    const row = db.prepare('SELECT bank_account FROM cheques WHERE id = ?').get(id) as { bank_account: string | null } | undefined;
    if (row?.bank_account && !scope.accounts.has(row.bank_account)) throw forbidden();
  } else if (path.startsWith('/api/banking/statements/:id')) {
    const row = db.prepare('SELECT account_code FROM bank_statements WHERE id = ?').get(id) as { account_code: string } | undefined;
    if (row && !scope.accounts.has(row.account_code)) throw forbidden();
  }
}

/**
 * Entries a scope may see: those of its branches (entryInBranchSql), and plain journals (no safe of their own, not made
 * by an invoice, a stock document or a stock adjustment) none of whose lines is on a safe or bank outside the scope. A
 * journal an admin wrote on another branch's (or the head office's) safe is that branch's business, not theirs.
 */
function visibleEntries(db: Db, scope: BranchScope, ids: string[]): Set<string> {
  if (!ids.length) return new Set();
  const acc = [...scope.accounts];
  const [own, ownParams] = branchEntry('e', [...scope.warehouses], acc);
  const linked = ['invoices', 'stock_docs'].map((t) => `EXISTS (SELECT 1 FROM ${t} x WHERE x.entry_id = e.id OR x.cancel_entry_id = e.id)`)
    .concat('EXISTS (SELECT 1 FROM stock_adjustments x WHERE x.entry_id = e.id)');
  const plain = `(e.cash_account IS NULL AND ${linked.map((l) => `NOT ${l}`).join(' AND ')}
      AND NOT EXISTS (SELECT 1 FROM entry_lines jl WHERE jl.entry_id = e.id AND jl.account_code LIKE '18%'${acc.length ? ` AND jl.account_code NOT IN (${sqlList(acc)})` : ''}))`;
  const rows = db.prepare(`SELECT e.id FROM entries e WHERE e.id IN (${sqlList(ids)}) AND (${own} OR ${plain})`)
    .all(...ids, ...ownParams, ...acc) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** For modules (the Pro module's own records): the entries among `ids` a limited user may see, as in the journal. */
export function visibleEntryIds(db: Db, scope: BranchScope, ids: readonly string[]): Set<string> {
  return visibleEntries(db, scope, [...new Set(ids)]);
}

/** Narrows lists (warehouses, safes, invoices, vouchers, stock documents) to the user's branches. */
export function filterBranchResult(db: Db, actor: Actor | null, method: string, path: string, result: unknown): unknown {
  if (method !== 'GET' || !result || typeof result !== 'object' || !actor || actor.permissions.includes('admin') || !anyBranches(db)) return result;
  const banking = path === '/api/banking/accounts';
  if (!Array.isArray(result) && !banking) return result;
  const scope = scopeOf(db, actor);
  if (!scope) return result;
  if (banking) {
    // the banking page's safes, banks and wallets: only the branch's own, as in the chart of accounts
    const r = result as { accounts?: { code: string }[] };
    return Array.isArray(r.accounts) ? { ...r, accounts: r.accounts.filter((a) => scope.accounts.has(a.code)) } : result;
  }
  switch (path) {
    case '/api/banking/cheques':
      // a cheque not handed to any bank yet belongs to no branch; one handed to (or drawn on) a bank, to that bank's
      return (result as { bankAccount: { code: string } | null }[]).filter((c) => !c.bankAccount || scope.accounts.has(c.bankAccount.code));
    case '/api/banking/statements':
      return (result as { accountCode: string }[]).filter((s) => scope.accounts.has(s.accountCode));
    case '/api/warehouses':
      return (result as { id: string }[]).filter((w) => scope.warehouses.has(w.id));
    case '/api/accounts':
      // the safes and banks of other branches (and the head office's) are left out; the chart above them stays
      return (result as { code: string; postable?: boolean }[]).filter((a) => !isCash(a.code) || !a.postable || scope.accounts.has(a.code));
    case '/api/invoices':
      return (result as { warehouseId: string }[]).filter((i) => scope.warehouses.has(i.warehouseId));
    case '/api/stock-docs':
      return (result as { warehouseId: string; toWarehouseId: string | null }[])
        .filter((d) => scope.warehouses.has(d.warehouseId) || (!!d.toWarehouseId && scope.warehouses.has(d.toWarehouseId)));
    case '/api/adjustments':
      return (result as { warehouseId: string }[]).filter((a) => scope.warehouses.has(a.warehouseId));
    case '/api/pos/shifts':
      return (result as { warehouseId: string; cashAccountCode: string }[]).filter((s) => scope.warehouses.has(s.warehouseId) && scope.accounts.has(s.cashAccountCode));
    case '/api/purchase-orders': {
      // the list carries no warehouse: an order with none belongs to no branch and stays listed
      const rows = result as { id: string }[];
      if (!rows.length) return rows;
      const elsewhere = new Set((db.prepare(`SELECT id, warehouse_id FROM purchase_orders WHERE id IN (${rows.map(() => '?').join(', ')})`).all(...rows.map((r) => r.id)) as
        { id: string; warehouse_id: string | null }[]).filter((o) => o.warehouse_id && !scope.warehouses.has(o.warehouse_id)).map((o) => o.id));
      return rows.filter((r) => !elsewhere.has(r.id));
    }
    case '/api/entries': {
      const rows = result as { id: string }[];
      const visible = visibleEntries(db, scope, rows.map((r) => r.id));
      return rows.filter((r) => visible.has(r.id));
    }
    default:
      return result;
  }
}

// ——— managing branches ———

export function listBranches(db: Db): BranchView[] {
  const branches = db.prepare('SELECT id, code, name, city, active FROM branches ORDER BY code').all() as
    { id: string; code: string; name: string; city: string | null; active: number }[];
  const wh = db.prepare(`SELECT b.branch_id, w.id, w.code FROM branch_warehouses b JOIN warehouses w ON w.id = b.warehouse_id ORDER BY w.code`).all() as
    { branch_id: string; id: string; code: string }[];
  const acc = db.prepare('SELECT branch_id, account_code FROM branch_accounts ORDER BY account_code').all() as { branch_id: string; account_code: string }[];
  const users = db.prepare(`SELECT ub.branch_id, u.id, u.username, u.name FROM user_branches ub JOIN users u ON u.id = ub.user_id ORDER BY u.username`).all() as
    { branch_id: string; id: string; username: string; name: string }[];
  return branches.map((b) => ({
    id: b.id, code: b.code, name: b.name, city: b.city ?? '', active: Number(b.active) === 1,
    warehouses: wh.filter((w) => w.branch_id === b.id).map((w) => ({ id: w.id, code: w.code })),
    accounts: acc.filter((a) => a.branch_id === b.id).map((a) => a.account_code),
    users: users.filter((u) => u.branch_id === b.id).map((u) => ({ id: u.id, username: u.username, name: u.name }))
  }));
}

function getBranch(db: Db, id: string): BranchView {
  const b = listBranches(db).find((x) => x.id === id);
  if (!b) throw notFound('branch');
  return b;
}

export interface BranchInput { code: string; name: string; city?: string | undefined; active?: boolean | undefined }

export function createBranch(db: Db, input: BranchInput, user: string): BranchView {
  requirePlan(db);
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code || !name) throw invalid([{ code: 'bn_name_required' }]);
  if (db.prepare('SELECT 1 FROM branches WHERE code = ?').get(code)) throw invalid([{ code: 'bn_code_taken' }]);
  const id = randomUUID();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('INSERT INTO branches (id, code, name, city, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, code, name, input.city?.trim() || null, input.active === false ? 0 : 1, now, now);
    audit(db, user, 'create', 'branch', id, { code });
  });
  return getBranch(db, id);
}

export function updateBranch(db: Db, id: string, input: BranchInput, user: string): BranchView {
  requirePlan(db);
  getBranch(db, id);
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code || !name) throw invalid([{ code: 'bn_name_required' }]);
  if (db.prepare('SELECT 1 FROM branches WHERE code = ? AND id <> ?').get(code, id)) throw invalid([{ code: 'bn_code_taken' }]);
  transaction(db, () => {
    db.prepare('UPDATE branches SET code = ?, name = ?, city = ?, active = ?, updated_at = ? WHERE id = ?')
      .run(code, name, input.city?.trim() || null, input.active === false ? 0 : 1, new Date().toISOString(), id);
    audit(db, user, 'update', 'branch', id, { code });
  });
  return getBranch(db, id);
}

/** The warehouses of a branch (replaces the list). A warehouse belongs to one branch only. */
export function setBranchWarehouses(db: Db, id: string, warehouseIds: string[], user: string): BranchView {
  requirePlan(db);
  getBranch(db, id);
  const ids = [...new Set(warehouseIds)];
  for (const w of ids) {
    if (!db.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(w)) throw invalid([{ code: 'warehouse_invalid' }]);
    const other = db.prepare('SELECT branch_id FROM branch_warehouses WHERE warehouse_id = ? AND branch_id <> ?').get(w, id);
    if (other) throw conflict('bn_warehouse_in_other_branch', { warehouseId: w });
  }
  transaction(db, () => {
    db.prepare('DELETE FROM branch_warehouses WHERE branch_id = ?').run(id);
    const add = db.prepare('INSERT INTO branch_warehouses (warehouse_id, branch_id) VALUES (?, ?)');
    for (const w of ids) add.run(w, id);
    audit(db, user, 'update', 'branch', id, { warehouses: ids.length });
  });
  return getBranch(db, id);
}

/** The safes and banks of a branch (postable accounts under 18; replaces the list). Each belongs to one branch only. */
export function setBranchAccounts(db: Db, id: string, codes: string[], user: string): BranchView {
  requirePlan(db);
  getBranch(db, id);
  const list = [...new Set(codes)];
  for (const code of list) {
    const ok = isCash(code) && db.prepare('SELECT 1 FROM accounts WHERE code = ?').get(code)
      && !db.prepare("SELECT 1 FROM accounts WHERE code LIKE ? || '%' AND code <> ? LIMIT 1").get(code, code);
    if (!ok) throw invalid([{ code: 'bn_account_invalid', account: code }]);
    if (db.prepare('SELECT 1 FROM branch_accounts WHERE account_code = ? AND branch_id <> ?').get(code, id)) throw conflict('bn_account_in_other_branch', { account: code });
  }
  transaction(db, () => {
    db.prepare('DELETE FROM branch_accounts WHERE branch_id = ?').run(id);
    const add = db.prepare('INSERT INTO branch_accounts (account_code, branch_id) VALUES (?, ?)');
    for (const code of list) add.run(code, id);
    audit(db, user, 'update', 'branch', id, { accounts: list.length });
  });
  return getBranch(db, id);
}

/** Limits a user to some branches; an empty list lets them work in every branch again (always allowed). */
export function setUserBranches(db: Db, userId: string, branchIds: string[], user: string): { userId: string; branchIds: string[] } {
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw notFound('user');
  const ids = [...new Set(branchIds)];
  if (ids.length) requirePlan(db);
  for (const b of ids) if (!db.prepare('SELECT 1 FROM branches WHERE id = ?').get(b)) throw invalid([{ code: 'bn_branch_invalid' }]);
  transaction(db, () => {
    db.prepare('DELETE FROM user_branches WHERE user_id = ?').run(userId);
    const add = db.prepare('INSERT INTO user_branches (user_id, branch_id) VALUES (?, ?)');
    for (const b of ids) add.run(userId, b);
    audit(db, user, 'update', 'user', userId, { branches: ids.length });
  });
  return { userId, branchIds: ids };
}

/** For the branch switcher: the branches this person can pick, and whether they are limited. */
export function myBranches(db: Db, actor: Actor | null): { limited: boolean; branches: { id: string; code: string; name: string }[] } {
  const all = db.prepare('SELECT id, code, name FROM branches WHERE active = 1 ORDER BY code').all() as { id: string; code: string; name: string }[];
  const scope = scopeOf(db, actor);
  return scope ? { limited: true, branches: all.filter((b) => scope.branchIds.includes(b.id)) } : { limited: false, branches: all };
}

// ——— API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const branchInput = z.object({ code: z.string().min(1).max(20), name: z.string().min(1).max(120), city: z.string().max(120).optional(), active: z.boolean().optional() });

/** Reading is open to signed-in users; every change is admin-only (not listed in rules). */
export const branchesApi: ApiExtension = {
  rules: { 'GET /api/branches': 'admin' },
  routes(db, { actorOf }) {
    const user = (req: ApiRequest) => actorOf(req).name;
    return [
      { method: 'GET', path: '/api/branches', handler: async () => ({ available: available(db), branches: listBranches(db) }) },
      { method: 'GET', path: '/api/branches/mine', handler: async (req) => myBranches(db, actorOf(req)) },
      {
        method: 'POST', path: '/api/branches',
        handler: async (req, reply) => {
          reply.status(201).send(createBranch(db, parse(branchInput, req.body), user(req)));
          return undefined;
        }
      },
      { method: 'PUT', path: '/api/branches/:id', handler: async (req) => updateBranch(db, parse(z.object({ id }), req.params).id, parse(branchInput, req.body), user(req)) },
      {
        method: 'PUT', path: '/api/branches/:id/warehouses',
        handler: async (req) => setBranchWarehouses(db, parse(z.object({ id }), req.params).id, parse(z.object({ warehouseIds: z.array(id).max(500) }), req.body).warehouseIds, user(req))
      },
      {
        method: 'PUT', path: '/api/branches/:id/accounts',
        handler: async (req) => setBranchAccounts(db, parse(z.object({ id }), req.params).id, parse(z.object({ accounts: z.array(z.string().min(1).max(12)).max(500) }), req.body).accounts, user(req))
      },
      {
        method: 'PUT', path: '/api/users/:id/branches',
        handler: async (req) => setUserBranches(db, parse(z.object({ id }), req.params).id, parse(z.object({ branchIds: z.array(id).max(200) }), req.body).branchIds, user(req))
      }
    ];
  }
};
