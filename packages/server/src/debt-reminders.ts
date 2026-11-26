import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isLang, todayIso, type Lang } from '@qasa/core';
import type { Db } from './db.ts';
import { audit } from './audit.ts';
import { AppError, invalid, notFound } from './errors.ts';
import { aging, branchOf } from './brief.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Debt reminders (every plan): the customers who owe, with how much (dinars and dollars, each in its own) and for how
 * long (the oldest part of the debt, first in, first out, as in the ageing report), the language their messages are
 * written in (the customer's own, else the app's) and when they were last reminded. The app writes the message and
 * opens WhatsApp; nothing is sent by Qasa itself. Each reminder the person opened is kept on the customer
 * (party_reminders), so the list says who was reminded and when, and nobody is reminded twice in one sitting.
 */

export interface ReminderRow {
  partyId: string; code: string; name: string; phone: string; lang: Lang | null;
  /** IQD at the book rates (the official balance), and what is owed in each currency in its own */
  balance: number; owed: { IQD: number; USD: number };
  oldestDays: number;
  /** null: never reminded */
  lastRemindedAt: string | null;
  reminders: number;
}

/** The customers who owe, oldest debt first: those owing for at least `minDays`, and only above `minAmount` dinars. */
export function reminderList(db: Db, opts: { asOf?: string | undefined; minDays?: number | undefined; minAmount?: number | undefined } = {},
  branch: Parameters<typeof aging>[3] = null): ReminderRow[] {
  const asOf = opts.asOf ?? todayIso();
  const rows = aging(db, 'customer', asOf, branch);
  const last = db.prepare('SELECT MAX(created_at) AS at, COUNT(*) AS n FROM party_reminders WHERE party_id = ?');
  const langOf = db.prepare('SELECT lang FROM parties WHERE id = ?');
  return rows
    .filter((r) => r.oldestDays >= (opts.minDays ?? 0) && r.balance >= (opts.minAmount ?? 1))
    .map((r) => {
      const l = last.get(r.partyId) as { at: string | null; n: number };
      const lang = (langOf.get(r.partyId) as { lang: string | null } | undefined)?.lang ?? null;
      return {
        partyId: r.partyId, code: r.code, name: r.name, phone: r.phone, lang: lang && isLang(lang) ? lang : null,
        balance: r.balance, owed: r.owed, oldestDays: r.oldestDays, lastRemindedAt: l.at, reminders: Number(l.n)
      };
    })
    .sort((a, b) => b.oldestDays - a.oldestDays || b.balance - a.balance);
}

export interface ReminderLog { id: string; partyId: string; amount: number; currency: 'IQD' | 'USD'; days: number; lang: Lang; createdBy: string; createdAt: string }

/** Keeps that a reminder was opened for a customer (the amount and days it said, and its language). */
export function logReminder(db: Db, input: { partyId: string; amount: number; currency: 'IQD' | 'USD'; days: number; lang: Lang }, user: string): ReminderLog {
  if (!db.prepare("SELECT 1 FROM parties WHERE id = ? AND type = 'customer'").get(input.partyId)) throw notFound('party');
  if (!Number.isSafeInteger(input.amount) || !Number.isSafeInteger(input.days) || input.days < 0) throw invalid([{ code: 'amount_invalid' }]);
  const id = randomUUID();
  const at = new Date().toISOString();
  db.prepare('INSERT INTO party_reminders (id, party_id, amount, currency, days, lang, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.partyId, input.amount, input.currency, input.days, input.lang, user, at);
  audit(db, user, 'remind', 'party_reminder', id, { party: input.partyId, amount: input.amount, currency: input.currency });
  return { id, partyId: input.partyId, amount: input.amount, currency: input.currency, days: input.days, lang: input.lang, createdBy: user, createdAt: at };
}

/** A customer's reminders, newest first (their page). */
export function partyReminders(db: Db, partyId: string): ReminderLog[] {
  return (db.prepare('SELECT * FROM party_reminders WHERE party_id = ? ORDER BY created_at DESC LIMIT 100').all(partyId) as {
    id: string; party_id: string; amount: number; currency: 'IQD' | 'USD'; days: number; lang: Lang; created_by: string; created_at: string;
  }[]).map((r) => ({ id: r.id, partyId: r.party_id, amount: Number(r.amount), currency: r.currency, days: Number(r.days), lang: r.lang, createdBy: r.created_by, createdAt: r.created_at }));
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);

/**
 * Reading is open to every signed-in user, as the customers' balances and the ageing of what they owe are; sending a
 * reminder (keeping it) needs sales. A user limited to branches sees the debts of their branches only.
 */
export const debtRemindersApi: ApiExtension = {
  rules: {
    'POST /api/debt-reminders': 'sales'
  },
  routes(db, { actorOf }) {
    return [
      {
        method: 'GET', path: '/api/debt-reminders',
        handler: async (req: ApiRequest) => {
          const q = parse(z.object({
            asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), minDays: z.coerce.number().int().min(0).max(3650).optional(),
            minAmount: z.coerce.number().int().min(0).max(1e12).optional(), branchId: id.optional()
          }), req.query ?? {});
          return { rows: reminderList(db, q, branchOf(db, req, actorOf(req))) };
        }
      },
      {
        method: 'POST', path: '/api/debt-reminders',
        handler: async (req: ApiRequest, reply) => {
          const body = parse(z.object({
            partyId: id, amount: z.number().int().min(0).max(1e12), currency: z.enum(['IQD', 'USD']), days: z.number().int().min(0).max(36500), lang: z.enum(['ar', 'en', 'ku'])
          }), req.body);
          reply.status(201).send(logReminder(db, body, actorOf(req).name));
          return undefined;
        }
      },
      { method: 'GET', path: '/api/parties/:id/reminders', handler: async (req: ApiRequest) => partyReminders(db, parse(z.object({ id }), req.params).id) }
    ];
  }
};
