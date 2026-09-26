import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const names = z.object({ ar: z.string().max(200), en: z.string().max(200), ku: z.string().max(200) });
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currency = z.enum(['IQD', 'USD']);

const lineSchema = z.object({
  accountCode: z.string().min(1).max(12),
  debit: amount,
  credit: amount,
  description: z.string().max(500).optional()
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
  items: z.array(z.object({ accountCode: z.string().min(1).max(12), amount, description: z.string().max(500).optional() })).max(200)
});

const entryFilters = z.object({
  type: z.enum(['journal', 'receipt', 'payment', 'reversal']).optional(),
  status: z.enum(['draft', 'checked', 'approved']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().max(100).optional()
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid(result.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return result.data;
}

/** The acting user. Until sign-in arrives, the client sends the name in a header (URL-encoded, so Arabic/Kurdish names work). */
function userOf(req: FastifyRequest): string {
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

export function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.status).send({ error: error.code, details: error.details ?? null });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('posted_entry_is_permanent')) return reply.status(409).send({ error: 'posted_entry_is_permanent', details: null });
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) return reply.status(statusCode).send({ error: 'bad_request', details: message });
    console.error(error);
    return reply.status(500).send({ error: 'internal', details: null });
  });

  app.get('/api/health', async () => ({ ok: true, app: 'qasa-erp', version: '0.1.0' }));

  // settings & periods
  app.get('/api/settings', async () => getSettings(db));
  app.put('/api/settings', async (req) => {
    const body = parse(z.object({
      companyName: names.optional(),
      defaultRateX100: z.number().int().positive().optional(),
      fiscalYearStart: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).optional()
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

  app.get('/api/audit', async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(1000).optional() }), req.query);
    return listAudit(db, q.limit ?? 200);
  });

  return app;
}
