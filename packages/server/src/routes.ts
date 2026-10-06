import { z } from 'zod';
import { APP_VERSION } from '@qasa/core';
import type { Db } from './db.ts';
import { AppError, conflict, invalid } from './errors.ts';
import {
  changeOwnPassword, createUser, listUsers, login, logout, ownerActor, ROLES, separateDuties, SESSION_COOKIE, sessionActor, sessionCookie,
  setPassword, setSeparateDuties, setSignInRequired, signInRequired, updateUser, type Actor, type Permission
} from './auth.ts';
import { createAccount, deleteAccount, listAccounts, renameAccount } from './accounts.ts';
import {
  approveEntry, checkEntry, createJournalEntry, createVoucher, deleteEntry, getEntry, listEntries,
  returnEntry, reverseEntry, updateJournalEntry, updateVoucher
} from './journal.ts';
import { finalAccountsReport, statementReport, trialBalanceReport } from './reports.ts';
import { getSettings, lockPeriod, lockedPeriods, unlockPeriod, updateSettings } from './settings.ts';
import { listAudit } from './audit.ts';
import { createParty, deleteParty, getParty, listParties, partyStatement, updateParty } from './parties.ts';
import {
  createItem, createWarehouse, deleteItem, getItem, itemMoves, itemStock, listItems, listWarehouses, updateItem, updateWarehouse
} from './items.ts';
import { activateLicense, planStatus, removeLicense, startTrial } from './license.ts';
import { cancelInvoice, createInvoice, deleteInvoice, getInvoice, listInvoices, postInvoice, updateInvoice } from './invoices.ts';
import { closeYear, reopenYear, yearStatuses } from './closing.ts';
import { createReturn } from './returns.ts';
import { cancelStockDoc, createStockDoc, deleteStockDoc, getStockDoc, listStockDocs, postStockDoc, updateStockDoc } from './stock-docs.ts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const names = z.object({ ar: z.string().max(200), en: z.string().max(200), ku: z.string().max(200) });
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currency = z.enum(['IQD', 'USD']);

const lineSchema = z.object({
  accountCode: z.string().min(1).max(12),
  debit: amount,
  credit: amount,
  description: z.string().max(500).optional(),
  partyId: z.string().max(64).optional()
});

const journalSchema = z.object({
  date: isoDate,
  description: z.string().max(500),
  party: z.string().max(200).optional(),
  currency,
  rateX100: z.number().int().positive(),
  lines: z.array(lineSchema).max(500)
});

const voucherSchema = z.object({
  kind: z.enum(['receipt', 'payment']),
  date: isoDate,
  cashAccountCode: z.string().min(1).max(12),
  party: z.string().max(200).optional(),
  description: z.string().max(500),
  currency,
  rateX100: z.number().int().positive(),
  items: z.array(z.object({ accountCode: z.string().min(1).max(12), amount, description: z.string().max(500).optional(), partyId: z.string().max(64).optional() })).max(200)
});

const entryFilters = z.object({
  type: z.enum(['journal', 'receipt', 'payment', 'reversal', 'sale', 'purchase', 'sale_return', 'purchase_return', 'opening_stock', 'transfer', 'closing']).optional(),
  status: z.enum(['draft', 'checked', 'approved']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().max(100).optional()
});

const partySchema = z.object({
  name: z.string().max(200),
  phone: z.string().max(50).optional(),
  address: z.string().max(300).optional(),
  accountCode: z.string().max(12).optional(),
  creditLimit: amount.nullable().optional(),
  notes: z.string().max(1000).optional(),
  active: z.boolean().optional()
});

const itemSchema = z.object({
  code: z.string().max(24).optional(),
  barcode: z.string().max(64).optional(),
  name: names,
  unit: z.enum(['piece', 'carton', 'box', 'set', 'kg', 'm', 'l', 'service']),
  salePrice: amount,
  saleCurrency: currency,
  trackStock: z.boolean().optional(),
  active: z.boolean().optional()
});

const invoiceSchema = z.object({
  kind: z.enum(['sale', 'purchase']),
  date: isoDate,
  partyId: z.string().max(64).optional(),
  warehouseId: z.string().min(1).max(64),
  currency,
  rateX100: z.number().int().positive(),
  payment: z.enum(['cash', 'credit']),
  cashAccountCode: z.string().max(12).optional(),
  discount: amount,
  notes: z.string().max(1000).optional(),
  lines: z.array(z.object({
    itemId: z.string().min(1).max(64),
    qtyMilli: z.number().int(),
    unitPrice: z.number().int(),
    description: z.string().max(500).optional()
  })).max(500)
});

const returnSchema = z.object({
  date: isoDate,
  payment: z.enum(['cash', 'credit']),
  cashAccountCode: z.string().max(12).optional(),
  notes: z.string().max(1000).optional(),
  lines: z.array(z.object({ lineNo: z.number().int().positive(), qtyMilli: z.number().int() })).max(500)
});

const stockDocSchema = z.object({
  kind: z.enum(['opening', 'transfer']),
  date: isoDate,
  warehouseId: z.string().min(1).max(64),
  toWarehouseId: z.string().max(64).optional(),
  counterAccountCode: z.string().max(12).optional(),
  notes: z.string().max(1000).optional(),
  lines: z.array(z.object({ itemId: z.string().min(1).max(64), qtyMilli: z.number().int(), unitCost: z.number().int().optional() })).max(1000)
});

const idParam = z.object({ id: z.string().min(1).max(64) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid(result.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return result.data;
}

function header(req: ApiRequest, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Without sign-in, the name typed on this PC (URL-encoded, so Arabic/Kurdish names work) is printed on vouchers. */
function typedName(req: ApiRequest): string | undefined {
  const value = header(req, 'x-qasa-user');
  if (!value) return undefined;
  try {
    return decodeURIComponent(value).trim().slice(0, 100) || undefined;
  } catch {
    return undefined;
  }
}

function cookie(req: ApiRequest, name: string): string | undefined {
  for (const part of (header(req, 'cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

/**
 * Who is asking, for routes added outside apiRoutes (the Pro module's): the owner without sign-in, otherwise the
 * user of the session cookie, or null.
 */
export function requestActor(db: Db, headers: ApiRequest['headers']): Actor | null {
  const req = { params: {}, query: {}, body: undefined, headers, secure: false } as ApiRequest;
  if (!signInRequired(db)) return ownerActor(db, typedName(req));
  const token = cookie(req, SESSION_COOKIE);
  return token ? sessionActor(db, token) : null;
}

/** The signed-in user (or, without sign-in, the owner). Set on every request by apiRoutes. */
function actorOf(req: ApiRequest): Actor {
  const actor = (req as ApiRequest & { actor?: Actor }).actor;
  if (!actor) throw new AppError(401, 'unauthorized');
  return actor;
}

function userOf(req: ApiRequest): string {
  return actorOf(req).name;
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** What a route sees of a request — the same shape under Fastify and in the in-browser demo. */
export interface ApiRequest {
  params: unknown;
  query: unknown;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  /** true when the request came over https */
  secure?: boolean;
}

/** Lets a route choose its status code (201, 204); otherwise the returned value is sent with 200. */
export class ApiReply {
  statusCode = 200;
  payload: unknown = undefined;
  sent = false;
  headers: Record<string, string> = {};

  header(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  send(payload?: unknown): this {
    this.payload = payload;
    this.sent = true;
    return this;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Route {
  method: HttpMethod;
  path: string;
  handler(req: ApiRequest, reply: ApiReply): Promise<unknown>;
}

/** Maps an error to the API's JSON error body. Unknown errors become 500 "internal". */
export function errorResponse(error: unknown): { status: number; body: { error: string; details: unknown } } {
  if (error instanceof AppError) return { status: error.status, body: { error: error.code, details: error.details ?? null } };
  const message = error instanceof Error ? error.message : String(error);
  for (const code of ['posted_entry_is_permanent', 'posted_invoice_is_permanent', 'posted_document_is_permanent', 'stock_moves_are_permanent', 'installment_contract_is_permanent']) {
    if (message.includes(code)) return { status: 409, body: { error: code, details: null } };
  }
  return { status: 500, body: { error: 'internal', details: null } };
}

/**
 * Routes a module adds to the API (the Pro module's installments …). They are served next to the app's own, on this
 * PC and on the office network, behind the same sign-in, permission and same-site checks: `rules` says which
 * permission each change needs ("POST /api/…": 'sales'); a change not listed needs an admin, as the app's own do.
 */
export interface ApiExtension {
  rules?: Record<string, Permission | null>;
  routes(db: Db, helpers: { actorOf(req: ApiRequest): Actor }): Route[];
}

/** Every API route. Fastify serves them on the PC and network editions; the demo website runs them in the browser. */
export function apiRoutes(db: Db, options: { demo?: boolean; extensions?: readonly ApiExtension[] } = {}): Route[] {
  const routes: Route[] = [];

  function authenticate(req: ApiRequest): Actor | null {
    if (!signInRequired(db)) return ownerActor(db, typedName(req));
    const token = cookie(req, SESSION_COOKIE);
    return token ? sessionActor(db, token) : null;
  }

  const kindOf = (id: unknown) => (db.prepare('SELECT kind FROM invoices WHERE id = ?').get(String(id)) as { kind: string } | undefined)?.kind;
  const invoicePermission = (kind: unknown): Permission => (kind === 'purchase' || kind === 'purchase_return' ? 'purchases' : 'sales');
  const partyPermission = (type: unknown): Permission => (type === 'supplier' ? 'purchases' : 'sales');
  const idOf = (req: ApiRequest) => (req.params as { id?: string }).id;

  /** What each change needs. Anything not listed: reading is open to every signed-in user, changing needs admin. */
  const RULES: Record<string, Permission | null | ((req: ApiRequest) => Permission)> = {
    'POST /api/auth/password': null,
    'POST /api/entries': 'entries.prepare', 'PUT /api/entries/:id': 'entries.prepare', 'DELETE /api/entries/:id': 'entries.prepare',
    'POST /api/vouchers': 'entries.prepare', 'PUT /api/vouchers/:id': 'entries.prepare',
    'POST /api/entries/:id/check': 'entries.check', 'POST /api/entries/:id/return': 'entries.check',
    'POST /api/entries/:id/approve': 'entries.approve', 'POST /api/entries/:id/reverse': 'entries.approve',
    'POST /api/parties': (req) => partyPermission((req.body as { type?: string } | undefined)?.type),
    'PUT /api/parties/:id': (req) => partyPermission((db.prepare('SELECT type FROM parties WHERE id = ?').get(String(idOf(req))) as { type: string } | undefined)?.type),
    'DELETE /api/parties/:id': (req) => partyPermission((db.prepare('SELECT type FROM parties WHERE id = ?').get(String(idOf(req))) as { type: string } | undefined)?.type),
    'POST /api/items': 'stock', 'PUT /api/items/:id': 'stock', 'DELETE /api/items/:id': 'stock',
    'POST /api/invoices': (req) => invoicePermission((req.body as { kind?: string } | undefined)?.kind),
    'PUT /api/invoices/:id': (req) => invoicePermission(kindOf(idOf(req))),
    'DELETE /api/invoices/:id': (req) => invoicePermission(kindOf(idOf(req))),
    'POST /api/invoices/:id/post': (req) => invoicePermission(kindOf(idOf(req))),
    'POST /api/invoices/:id/cancel': (req) => invoicePermission(kindOf(idOf(req))),
    'POST /api/invoices/:id/returns': (req) => invoicePermission(kindOf(idOf(req))),
    'POST /api/stock-docs': 'stock', 'PUT /api/stock-docs/:id': 'stock', 'DELETE /api/stock-docs/:id': 'stock',
    'POST /api/stock-docs/:id/post': 'stock', 'POST /api/stock-docs/:id/cancel': 'stock',
    'GET /api/audit': 'admin', 'GET /api/users': 'admin'
  };
  for (const extension of options.extensions ?? []) Object.assign(RULES, extension.rules ?? {});
  const PUBLIC = new Set(['GET /api/health', 'GET /api/auth/me', 'POST /api/auth/login', 'POST /api/auth/logout']);

  /** Hides the buttons a user may not use: the server refuses those actions anyway. */
  const ENTRY_ACTION: Record<string, Permission> = {
    edit: 'entries.prepare', delete: 'entries.prepare', check: 'entries.check', return: 'entries.check', approve: 'entries.approve', reverse: 'entries.approve'
  };
  function forActor(path: string, value: unknown, actor: Actor | null): unknown {
    if (!actor || !value || typeof value !== 'object' || !Array.isArray((value as { actions?: unknown }).actions)) return value;
    const v = value as { actions: string[]; kind?: string };
    const need = (action: string): Permission | undefined => path.startsWith('/api/invoices') ? invoicePermission(v.kind)
      : path.startsWith('/api/stock-docs') ? 'stock'
      : path.startsWith('/api/entries') || path.startsWith('/api/vouchers') ? ENTRY_ACTION[action] : undefined;
    return { ...v, actions: v.actions.filter((a) => { const p = need(a); return !p || actor.permissions.includes(p); }) };
  }

  const add = (method: HttpMethod) => (path: string, handler: Route['handler']) => {
    const key = `${method} ${path}`;
    routes.push({
      method, path,
      handler: async (req, reply) => {
        const actor = authenticate(req);
        if (!PUBLIC.has(key)) {
          if (!actor) throw new AppError(401, 'unauthorized');
          // with sign-in (a cookie session), changes must come from the app itself, not from another site
          if (method !== 'GET' && signInRequired(db) && header(req, 'x-qasa-client') !== '1') throw new AppError(403, 'forbidden');
          const rule = key in RULES ? RULES[key] : method === 'GET' ? null : 'admin';
          const need = typeof rule === 'function' ? rule(req) : rule;
          if (need && !actor.permissions.includes(need)) throw new AppError(403, 'forbidden', { need });
        }
        (req as ApiRequest & { actor?: Actor | null }).actor = actor;
        const result = await handler(req, reply);
        if (reply.sent) reply.payload = forActor(path, reply.payload, actor);
        return forActor(path, result, actor);
      }
    });
  };
  const app = { get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE') };
  const notInDemo = () => { if (options.demo) throw conflict('demo_unavailable'); };

  app.get('/api/health', async () => ({ ok: true, app: 'qasa-erp', version: APP_VERSION }));

  // settings & periods
  app.get('/api/settings', async () => getSettings(db));
  app.put('/api/settings', async (req) => {
    const body = parse(z.object({
      companyName: names.optional(),
      defaultRateX100: z.number().int().positive().optional(),
      fiscalYearStart: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).optional(),
      postingAccounts: z.object({
        customers: z.string().max(12), suppliers: z.string().max(12), sales: z.string().max(12), costOfSales: z.string().max(12), cash: z.string().max(12),
        yearResult: z.string().max(12).optional()
      }).optional()
    }), req.body);
    const { postingAccounts, ...rest } = withoutUndefined(body);
    return updateSettings(db, { ...rest, ...(postingAccounts ? { postingAccounts: { ...getSettings(db).postingAccounts, ...withoutUndefined(postingAccounts) } } : {}) }, userOf(req));
  });
  // year-end closing: every year's state; closing and reopening need an admin (the default for changes)
  const yearParam = z.object({ year: z.coerce.number().int().min(1900).max(2999) });
  app.get('/api/year-end', async () => ({ fiscalYearStart: getSettings(db).fiscalYearStart, years: yearStatuses(db) }));
  app.post('/api/year-end/:year/close', async (req) => {
    notInDemo();
    return closeYear(db, parse(yearParam, req.params).year, actorOf(req));
  });
  app.post('/api/year-end/:year/reopen', async (req) => {
    notInDemo();
    return reopenYear(db, parse(yearParam, req.params).year, actorOf(req));
  });

  app.get('/api/periods', async () => lockedPeriods(db));
  app.post('/api/periods/:period/lock', async (req) => {
    const { period: p } = parse(z.object({ period }), req.params);
    lockPeriod(db, p, userOf(req));
    return lockedPeriods(db);
  });
  app.delete('/api/periods/:period/lock', async (req) => {
    const { period: p } = parse(z.object({ period }), req.params);
    unlockPeriod(db, p, userOf(req));
    return lockedPeriods(db);
  });

  // chart of accounts
  app.get('/api/accounts', async () => listAccounts(db));
  app.post('/api/accounts', async (req, reply) => {
    const body = parse(z.object({ parentCode: z.string().min(1).max(12), code: z.string().min(1).max(12), name: names }), req.body);
    return reply.status(201).send(createAccount(db, body, userOf(req)));
  });
  app.patch('/api/accounts/:code', async (req) => {
    const { code } = parse(z.object({ code: z.string().min(1).max(12) }), req.params);
    const body = parse(z.object({ name: names }), req.body);
    return renameAccount(db, code, body.name, userOf(req));
  });
  app.delete('/api/accounts/:code', async (req, reply) => {
    const { code } = parse(z.object({ code: z.string().min(1).max(12) }), req.params);
    deleteAccount(db, code, userOf(req));
    return reply.status(204).send();
  });

  // entries & vouchers
  app.get('/api/entries', async (req) => listEntries(db, parse(entryFilters, req.query)));
  app.get('/api/entries/:id', async (req) => getEntry(db, parse(z.object({ id: z.string() }), req.params).id));
  app.post('/api/entries', async (req, reply) => {
    const body = parse(journalSchema, req.body);
    return reply.status(201).send(createJournalEntry(db, withoutUndefined(body), userOf(req), actorOf(req).id));
  });
  app.put('/api/entries/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    return updateJournalEntry(db, id, withoutUndefined(parse(journalSchema, req.body)), userOf(req), actorOf(req).id);
  });
  app.post('/api/vouchers', async (req, reply) => {
    const body = parse(voucherSchema, req.body);
    return reply.status(201).send(createVoucher(db, withoutUndefined(body), userOf(req), actorOf(req).id));
  });
  app.put('/api/vouchers/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    return updateVoucher(db, id, withoutUndefined(parse(voucherSchema, req.body)), userOf(req), actorOf(req).id);
  });
  app.delete('/api/entries/:id', async (req, reply) => {
    deleteEntry(db, parse(z.object({ id: z.string() }), req.params).id, userOf(req));
    return reply.status(204).send();
  });
  app.post('/api/entries/:id/check', async (req) => checkEntry(db, parse(z.object({ id: z.string() }), req.params).id, userOf(req), actorOf(req).id));
  app.post('/api/entries/:id/return', async (req) => returnEntry(db, parse(z.object({ id: z.string() }), req.params).id, userOf(req)));
  app.post('/api/entries/:id/approve', async (req) => approveEntry(db, parse(z.object({ id: z.string() }), req.params).id, userOf(req), actorOf(req).id));
  app.post('/api/entries/:id/reverse', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ date: isoDate.optional() }), req.body ?? {});
    return reverseEntry(db, id, userOf(req), body.date);
  });

  // reports
  app.get('/api/reports/trial-balance', async (req) => {
    const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional() }), req.query);
    return trialBalanceReport(db, q);
  });
  app.get('/api/reports/final-accounts', async (req) => {
    const q = parse(z.object({ from: isoDate, to: isoDate }), req.query);
    if (q.from > q.to) throw invalid([{ code: 'date_invalid' }]);
    return finalAccountsReport(db, q);
  });
  app.get('/api/reports/statement', async (req) => {
    const q = parse(z.object({ account: z.string().min(1).max(12), from: isoDate.optional(), to: isoDate.optional() }), req.query);
    return statementReport(db, q.account, q);
  });

  // customers & suppliers
  const partyFilters = z.object({ type: z.enum(['customer', 'supplier']).optional(), q: z.string().max(100).optional(), active: z.enum(['true', 'false']).optional() });
  app.get('/api/parties', async (req) => {
    const q = parse(partyFilters, req.query);
    return listParties(db, { type: q.type, q: q.q, active: q.active === undefined ? undefined : q.active === 'true' });
  });
  app.get('/api/parties/:id', async (req) => getParty(db, parse(idParam, req.params).id));
  app.post('/api/parties', async (req, reply) => {
    const { type, ...input } = parse(partySchema.extend({ type: z.enum(['customer', 'supplier']) }), req.body);
    return reply.status(201).send(createParty(db, type, withoutUndefined(input), userOf(req)));
  });
  app.put('/api/parties/:id', async (req) => updateParty(db, parse(idParam, req.params).id, withoutUndefined(parse(partySchema, req.body)), userOf(req)));
  app.delete('/api/parties/:id', async (req, reply) => {
    deleteParty(db, parse(idParam, req.params).id, userOf(req));
    return reply.status(204).send();
  });
  app.get('/api/parties/:id/statement', async (req) => {
    const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional() }), req.query);
    return partyStatement(db, parse(idParam, req.params).id, q);
  });

  // warehouses, items & stock
  app.get('/api/warehouses', async () => listWarehouses(db));
  app.post('/api/warehouses', async (req, reply) => {
    const body = parse(z.object({ code: z.string().max(12), name: names }), req.body);
    return reply.status(201).send(createWarehouse(db, body, userOf(req)));
  });
  app.put('/api/warehouses/:id', async (req) => {
    const body = parse(z.object({ name: names, active: z.boolean().optional() }), req.body);
    return updateWarehouse(db, parse(idParam, req.params).id, body, userOf(req));
  });
  app.get('/api/items', async (req) => {
    const q = parse(z.object({ q: z.string().max(100).optional(), warehouseId: z.string().max(64).optional(), active: z.enum(['true', 'false']).optional() }), req.query);
    return listItems(db, { q: q.q, warehouseId: q.warehouseId, active: q.active === undefined ? undefined : q.active === 'true' });
  });
  app.get('/api/items/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    return { ...getItem(db, id), stock: itemStock(db, id), moves: itemMoves(db, id) };
  });
  app.post('/api/items', async (req, reply) => reply.status(201).send(createItem(db, withoutUndefined(parse(itemSchema, req.body)), userOf(req))));
  app.put('/api/items/:id', async (req) => updateItem(db, parse(idParam, req.params).id, withoutUndefined(parse(itemSchema, req.body)), userOf(req)));
  app.delete('/api/items/:id', async (req, reply) => {
    deleteItem(db, parse(idParam, req.params).id, userOf(req));
    return reply.status(204).send();
  });

  // invoices
  app.get('/api/invoices', async (req) => {
    const q = parse(z.object({
      kind: z.enum(['sale', 'purchase', 'sale_return', 'purchase_return']).optional(), status: z.enum(['draft', 'posted', 'cancelled']).optional(),
      partyId: z.string().max(64).optional(), from: isoDate.optional(), to: isoDate.optional(), q: z.string().max(100).optional()
    }), req.query);
    return listInvoices(db, q);
  });
  app.get('/api/invoices/:id', async (req) => getInvoice(db, parse(idParam, req.params).id));
  app.post('/api/invoices', async (req, reply) => reply.status(201).send(createInvoice(db, withoutUndefined(parse(invoiceSchema, req.body)), userOf(req))));
  app.put('/api/invoices/:id', async (req) => updateInvoice(db, parse(idParam, req.params).id, withoutUndefined(parse(invoiceSchema, req.body)), userOf(req)));
  app.delete('/api/invoices/:id', async (req, reply) => {
    deleteInvoice(db, parse(idParam, req.params).id, userOf(req));
    return reply.status(204).send();
  });
  app.post('/api/invoices/:id/post', async (req) => postInvoice(db, parse(idParam, req.params).id, userOf(req)));
  app.post('/api/invoices/:id/cancel', async (req) => {
    const body = parse(z.object({ date: isoDate.optional() }), req.body ?? {});
    return cancelInvoice(db, parse(idParam, req.params).id, userOf(req), body.date);
  });

  // returns (مردودات), made from a posted invoice
  app.post('/api/invoices/:id/returns', async (req, reply) =>
    reply.status(201).send(createReturn(db, parse(idParam, req.params).id, withoutUndefined(parse(returnSchema, req.body)), userOf(req))));

  // stock documents: opening stock and transfers between warehouses
  app.get('/api/stock-docs', async (req) => {
    const q = parse(z.object({ kind: z.enum(['opening', 'transfer']).optional(), status: z.enum(['draft', 'posted', 'cancelled']).optional() }), req.query);
    return listStockDocs(db, q);
  });
  app.get('/api/stock-docs/:id', async (req) => getStockDoc(db, parse(idParam, req.params).id));
  app.post('/api/stock-docs', async (req, reply) => reply.status(201).send(createStockDoc(db, withoutUndefined(parse(stockDocSchema, req.body)), userOf(req))));
  app.put('/api/stock-docs/:id', async (req) => updateStockDoc(db, parse(idParam, req.params).id, withoutUndefined(parse(stockDocSchema, req.body)), userOf(req)));
  app.delete('/api/stock-docs/:id', async (req, reply) => {
    deleteStockDoc(db, parse(idParam, req.params).id, userOf(req));
    return reply.status(204).send();
  });
  app.post('/api/stock-docs/:id/post', async (req) => postStockDoc(db, parse(idParam, req.params).id, userOf(req)));
  app.post('/api/stock-docs/:id/cancel', async (req) => {
    const body = parse(z.object({ date: isoDate.optional() }), req.body ?? {});
    return cancelStockDoc(db, parse(idParam, req.params).id, userOf(req), body.date);
  });

  // sign-in and users
  const roleSchema = z.enum(ROLES as [string, ...string[]]).transform((r) => r as (typeof ROLES)[number]);
  const userSchema = z.object({ username: z.string().max(32), name: z.string().max(100), roles: z.array(roleSchema).max(ROLES.length) });
  const me = (actor: Actor | null) => ({
    signInRequired: signInRequired(db), separateDuties: separateDuties(db), demo: !!options.demo,
    user: actor ? { id: actor.id, name: actor.name, username: actor.username, roles: actor.roles, permissions: actor.permissions } : null
  });
  app.get('/api/auth/me', async (req) => me((req as ApiRequest & { actor?: Actor | null }).actor ?? null));
  app.post('/api/auth/login', async (req, reply) => {
    notInDemo();
    const body = parse(z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) }), req.body);
    const { token, actor } = login(db, body.username, body.password, header(req, 'user-agent'));
    reply.header('set-cookie', sessionCookie(token, !!req.secure));
    return me(actor);
  });
  app.post('/api/auth/logout', async (req, reply) => {
    const token = cookie(req, SESSION_COOKIE);
    if (token) logout(db, token);
    reply.header('set-cookie', sessionCookie('', !!req.secure, 0));
    return { ok: true };
  });
  app.post('/api/auth/password', async (req) => {
    notInDemo();
    const body = parse(z.object({ current: z.string().max(200).optional(), password: z.string().max(200) }), req.body);
    changeOwnPassword(db, actorOf(req), body.current, body.password, cookie(req, SESSION_COOKIE));
    return { ok: true };
  });
  app.put('/api/auth/signin', async (req) => {
    notInDemo();
    setSignInRequired(db, parse(z.object({ on: z.boolean() }), req.body).on, actorOf(req));
    return me(signInRequired(db) ? null : ownerActor(db, typedName(req)));
  });
  app.put('/api/auth/separate-duties', async (req) => {
    setSeparateDuties(db, parse(z.object({ on: z.boolean() }), req.body).on, actorOf(req));
    return me(actorOf(req));
  });
  app.get('/api/users', async () => listUsers(db));
  app.post('/api/users', async (req, reply) => {
    const body = parse(userSchema.extend({ password: z.string().max(200).optional() }), req.body);
    if (body.password !== undefined) notInDemo();
    return reply.status(201).send(createUser(db, body, userOf(req)));
  });
  app.put('/api/users/:id', async (req) => updateUser(db, parse(idParam, req.params).id, parse(userSchema.extend({ active: z.boolean() }), req.body), actorOf(req)));
  app.post('/api/users/:id/password', async (req) => {
    notInDemo();
    return setPassword(db, parse(idParam, req.params).id, parse(z.object({ password: z.string().max(200) }), req.body).password, userOf(req));
  });

  // plan & license
  app.get('/api/plan', async () => planStatus(db));
  app.post('/api/plan/license', async (req) => activateLicense(db, parse(z.object({ key: z.string().min(1).max(4000) }), req.body).key, userOf(req)));
  app.delete('/api/plan/license', async (req) => removeLicense(db, userOf(req)));
  app.post('/api/plan/trial', async (req) => startTrial(db, userOf(req)));

  app.get('/api/audit', async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(1000).optional() }), req.query);
    return listAudit(db, q.limit ?? 200);
  });

  // the modules' routes, behind the same checks as the app's own (not in the website demo)
  if (!options.demo) {
    for (const extension of options.extensions ?? []) {
      for (const route of extension.routes(db, { actorOf })) add(route.method)(route.path, route.handler);
    }
  }

  return routes;
}
