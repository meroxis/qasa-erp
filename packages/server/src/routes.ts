import { z } from 'zod';
import { APP_VERSION } from '@qasa/core';
import type { Db } from './db.ts';
import { AppError, invalid } from './errors.ts';
import { createAccount, deleteAccount, listAccounts, renameAccount } from './accounts.ts';
import {
  approveEntry, checkEntry, createJournalEntry, createVoucher, deleteEntry, getEntry, listEntries,
  returnEntry, reverseEntry, updateJournalEntry, updateVoucher
} from './journal.ts';
import { statementReport, trialBalanceReport } from './reports.ts';
import { getSettings, lockPeriod, lockedPeriods, unlockPeriod, updateSettings } from './settings.ts';
import { listAudit } from './audit.ts';
import { createParty, deleteParty, getParty, listParties, partyStatement, updateParty } from './parties.ts';
import {
  createItem, createWarehouse, deleteItem, getItem, itemMoves, itemStock, listItems, listWarehouses, updateItem, updateWarehouse
} from './items.ts';
import { activateLicense, planStatus, removeLicense, startTrial } from './license.ts';
import { cancelInvoice, createInvoice, deleteInvoice, getInvoice, listInvoices, postInvoice, updateInvoice } from './invoices.ts';

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
  type: z.enum(['journal', 'receipt', 'payment', 'reversal', 'sale', 'purchase']).optional(),
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

const idParam = z.object({ id: z.string().min(1).max(64) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid(result.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return result.data;
}

/** The acting user. Until sign-in arrives, the client sends the name in a header (URL-encoded, so Arabic/Kurdish names work). */
function userOf(req: ApiRequest): string {
  const raw = req.headers['x-qasa-user'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return 'Admin';
  try {
    return decodeURIComponent(value).slice(0, 100) || 'Admin';
  } catch {
    return 'Admin';
  }
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
}

/** Lets a route choose its status code (201, 204); otherwise the returned value is sent with 200. */
export class ApiReply {
  statusCode = 200;
  payload: unknown = undefined;
  sent = false;

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
  for (const code of ['posted_entry_is_permanent', 'posted_invoice_is_permanent', 'stock_moves_are_permanent']) {
    if (message.includes(code)) return { status: 409, body: { error: code, details: null } };
  }
  return { status: 500, body: { error: 'internal', details: null } };
}

/** Every API route. Fastify serves them on the PC and network editions; the demo website runs them in the browser. */
export function apiRoutes(db: Db): Route[] {
  const routes: Route[] = [];
  const add = (method: HttpMethod) => (path: string, handler: Route['handler']) => { routes.push({ method, path, handler }); };
  const app = { get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE') };

  app.get('/api/health', async () => ({ ok: true, app: 'qasa-erp', version: APP_VERSION }));

  // settings & periods
  app.get('/api/settings', async () => getSettings(db));
  app.put('/api/settings', async (req) => {
    const body = parse(z.object({
      companyName: names.optional(),
      defaultRateX100: z.number().int().positive().optional(),
      fiscalYearStart: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).optional(),
      postingAccounts: z.object({
        customers: z.string().max(12), suppliers: z.string().max(12), sales: z.string().max(12), costOfSales: z.string().max(12), cash: z.string().max(12)
      }).optional()
    }), req.body);
    return updateSettings(db, withoutUndefined(body), userOf(req));
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
    return reply.status(201).send(createJournalEntry(db, withoutUndefined(body), userOf(req)));
  });
  app.put('/api/entries/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    return updateJournalEntry(db, id, withoutUndefined(parse(journalSchema, req.body)), userOf(req));
  });
  app.post('/api/vouchers', async (req, reply) => {
    const body = parse(voucherSchema, req.body);
    return reply.status(201).send(createVoucher(db, withoutUndefined(body), userOf(req)));
  });
  app.put('/api/vouchers/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    return updateVoucher(db, id, withoutUndefined(parse(voucherSchema, req.body)), userOf(req));
  });
  app.delete('/api/entries/:id', async (req, reply) => {
    deleteEntry(db, parse(z.object({ id: z.string() }), req.params).id, userOf(req));
    return reply.status(204).send();
  });
  app.post('/api/entries/:id/check', async (req) => checkEntry(db, parse(z.object({ id: z.string() }), req.params).id, userOf(req)));
  app.post('/api/entries/:id/return', async (req) => returnEntry(db, parse(z.object({ id: z.string() }), req.params).id, userOf(req)));
  app.post('/api/entries/:id/approve', async (req) => approveEntry(db, parse(z.object({ id: z.string() }), req.params).id, userOf(req)));
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
      kind: z.enum(['sale', 'purchase']).optional(), status: z.enum(['draft', 'posted', 'cancelled']).optional(),
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

  // plan & license
  app.get('/api/plan', async () => planStatus(db));
  app.post('/api/plan/license', async (req) => activateLicense(db, parse(z.object({ key: z.string().min(1).max(4000) }), req.body).key, userOf(req)));
  app.delete('/api/plan/license', async (req) => removeLicense(db, userOf(req)));
  app.post('/api/plan/trial', async (req) => startTrial(db, userOf(req)));

  app.get('/api/audit', async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(1000).optional() }), req.query);
    return listAudit(db, q.limit ?? 200);
  });

  return routes;
}
