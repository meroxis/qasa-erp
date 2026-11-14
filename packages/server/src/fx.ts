import { z } from 'zod';
import { todayIso, toBase, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { isMysql, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { createJournalEntry, type EntryView } from './journal.ts';
import { getSettings, readSetting, updateSettings, writeSetting } from './settings.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * The dollar rate board (سعر الصرف). The company enters the day's market rate; the history is kept, the latest rate
 * becomes the default rate that new invoices and vouchers start with, and the revaluation report shows what the
 * dollar balances are worth in dinars at that rate.
 *
 * Revaluation: only monetary accounts (loans granted 14, debtors 16, cash 18, loans received 24, bank overdrafts 25,
 * creditors 26) and only what was booked in dollars. For each account (and customer or supplier) the dollar balance
 * (the USD lines of approved entries) is carried in dinars at the rates it was booked at, plus earlier revaluations;
 * at the new rate it is worth more or less, and the difference is an unrealised gain or loss. Posting makes a draft
 * journal entry in dinars (it follows the preparer, checker and approver): each balance adjusted, gains to an
 * "other revenue" account (49) and losses to an "other expenses" account (39), both changeable.
 */

/** IQD per 1 USD × 100, as everywhere in the app. */
export interface RateView { date: string; rateX100: number; source: string | null; createdBy: string; createdAt: string }

export interface RevaluationRow {
  accountCode: string;
  accountName: Names;
  partyId: string | null;
  partyName: string | null;
  /** the dollar balance, in cents (debit positive) */
  usd: number;
  /** its value in the books, in dinars (debit positive) */
  carried: number;
  /** its value at the new rate */
  revalued: number;
  /** revalued − carried: a gain on a dollar asset when the dollar rises, a loss on a dollar debt */
  difference: number;
  /**
   * a customer, supplier or other debt that also has dinar amounts (a dollar invoice paid in dinars …): its dollar
   * balance can't be told apart, so it is left out of posting. Cash and bank accounts are never mixed: the dollar lines
   * are the dollar notes, whatever dinars the same safe holds.
   */
  mixed: boolean;
}

export interface RevaluationReport {
  date: string;
  rateX100: number;
  rateSource: 'board' | 'default' | 'given';
  rows: RevaluationRow[];
  /** over the rows that would be posted (not mixed) */
  gains: number;
  losses: number;
  net: number;
}

/** The accounts whose dollar balances are money (not stock, assets or capital). */
const MONETARY = ['14', '16', '18', '24', '25', '26'];
const MONETARY_SQL = MONETARY.map((p) => `l.account_code LIKE '${p}%'`).join(' OR ');

/** Entries the revaluation posted, so the next revaluation counts them in what is carried. */
const POSTED_KEY = 'fx_revaluation_entries';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: string) => ISO.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

function toView(r: { date: string; rate_x100: number; source: string | null; created_by: string; created_at: string }): RateView {
  return { date: r.date, rateX100: Number(r.rate_x100), source: r.source, createdBy: r.created_by, createdAt: r.created_at };
}

/** The rates entered, newest first (all of them, or the last `days` days before `to`). */
export function listRates(db: Db, f: { days?: number | undefined; to?: string | undefined } = {}): RateView[] {
  const to = f.to ?? todayIso();
  const from = f.days ? new Date(Date.parse(to + 'T00:00:00Z') - (f.days - 1) * 86_400_000).toISOString().slice(0, 10) : '0000-01-01';
  const rows = db.prepare('SELECT date, rate_x100, source, created_by, created_at FROM fx_rates WHERE date >= ? AND date <= ? ORDER BY date DESC')
    .all(from, to) as Parameters<typeof toView>[0][];
  return rows.map(toView);
}

/** The rate for a date: the one entered on it or the latest before it, else the company's default rate. */
export function rateOn(db: Db, date: string): { date: string | null; rateX100: number; source: 'board' | 'default' } {
  const r = db.prepare('SELECT date, rate_x100 FROM fx_rates WHERE date <= ? ORDER BY date DESC LIMIT 1').get(date) as { date: string; rate_x100: number } | undefined;
  if (r) return { date: r.date, rateX100: Number(r.rate_x100), source: 'board' };
  return { date: null, rateX100: getSettings(db).defaultRateX100, source: 'default' };
}

/**
 * Enters (or corrects) the rate of a day. When it is the newest rate on the board, it also becomes the company's
 * default rate, which new invoices and vouchers start with.
 */
export function setRate(db: Db, input: { date: string; rateX100: number; source?: string | undefined }, user: string): RateView {
  const errors: { code: string; field: string }[] = [];
  if (!isDate(input.date)) errors.push({ code: 'date_invalid', field: 'date' });
  else if (input.date > todayIso()) errors.push({ code: 'fx_date_future', field: 'date' });
  // a sanity range: 100 to 100,000 dinars a dollar
  if (!Number.isSafeInteger(input.rateX100) || input.rateX100 < 10_000 || input.rateX100 > 10_000_000) errors.push({ code: 'rate_invalid', field: 'rateX100' });
  if (errors.length) throw invalid(errors);
  const source = input.source?.trim() || null;
  transaction(db, () => {
    const now = new Date().toISOString();
    db.prepare(isMysql(db)
      ? 'INSERT INTO fx_rates (date, rate_x100, source, created_by, created_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE rate_x100 = VALUES(rate_x100), source = COALESCE(VALUES(source), source), created_by = VALUES(created_by), created_at = VALUES(created_at)'
      : 'INSERT INTO fx_rates (date, rate_x100, source, created_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (date) DO UPDATE SET rate_x100 = excluded.rate_x100, source = COALESCE(excluded.source, fx_rates.source), created_by = excluded.created_by, created_at = excluded.created_at')
      .run(input.date, input.rateX100, source, user, now);
    audit(db, user, 'set', 'fx_rate', input.date, { rateX100: input.rateX100 });
    const newest = (db.prepare('SELECT MAX(date) AS d FROM fx_rates').get() as { d: string }).d;
    if (newest === input.date && getSettings(db).defaultRateX100 !== input.rateX100) updateSettings(db, { defaultRateX100: input.rateX100 }, user);
  });
  return toView(db.prepare('SELECT date, rate_x100, source, created_by, created_at FROM fx_rates WHERE date = ?').get(input.date) as Parameters<typeof toView>[0]);
}

export function deleteRate(db: Db, date: string, user: string): void {
  if (!db.prepare('SELECT 1 FROM fx_rates WHERE date = ?').get(date)) throw new AppError(404, 'not_found', { what: 'fx_rate' });
  transaction(db, () => {
    const newest = (db.prepare('SELECT MAX(date) AS d FROM fx_rates').get() as { d: string }).d;
    db.prepare('DELETE FROM fx_rates WHERE date = ?').run(date);
    audit(db, user, 'delete', 'fx_rate', date);
    // the newest rate is also the company's default rate: a wrong one deleted must not stay behind as the default
    if (newest === date) {
      const next = db.prepare('SELECT rate_x100 FROM fx_rates ORDER BY date DESC LIMIT 1').get() as { rate_x100: number } | undefined;
      if (next && getSettings(db).defaultRateX100 !== Number(next.rate_x100)) updateSettings(db, { defaultRateX100: Number(next.rate_x100) }, user);
    }
  });
}

/** The revaluation entries posted so far (dinar journal entries on the dollar accounts and parties). */
export function postedRevaluations(db: Db): string[] {
  try {
    const list = JSON.parse(readSetting(db, POSTED_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** What the dollar balances are worth at a rate (default: the board's rate for the date). */
export function revaluation(db: Db, f: { date?: string | undefined; rateX100?: number | undefined } = {}): RevaluationReport {
  const date = f.date ?? todayIso();
  if (!isDate(date)) throw invalid([{ code: 'date_invalid', field: 'date' }]);
  let rateX100: number;
  let rateSource: RevaluationReport['rateSource'];
  if (f.rateX100 !== undefined) {
    if (!Number.isSafeInteger(f.rateX100) || f.rateX100 <= 0) throw invalid([{ code: 'rate_invalid', field: 'rateX100' }]);
    rateX100 = f.rateX100;
    rateSource = 'given';
  } else {
    const r = rateOn(db, date);
    rateX100 = r.rateX100;
    rateSource = r.source;
  }

  // the dollar side: USD lines of approved entries (reversals are approved entries too, so they cancel what they reverse)
  const usdRows = db.prepare(`SELECT l.account_code AS account, l.party_id AS party,
                                COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS usd,
                                COALESCE(SUM(l.base_debit), 0) - COALESCE(SUM(l.base_credit), 0) AS base
                              FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                              WHERE e.status = 'approved' AND e.currency = 'USD' AND e.date <= ? AND (${MONETARY_SQL})
                              GROUP BY l.account_code, l.party_id`).all(date) as { account: string; party: string | null; usd: number; base: number }[];

  // earlier revaluations (and their reversals) are part of what is carried
  const posted = postedRevaluations(db);
  const adjust = new Map<string, number>();
  const other = new Map<string, number>();
  const keyOf = (account: string, party: string | null) => `${account}|${party ?? ''}`;
  if (posted.length) {
    const marks = posted.map(() => '?').join(', ');
    const rows = db.prepare(`SELECT l.account_code AS account, l.party_id AS party, COALESCE(SUM(l.base_debit), 0) - COALESCE(SUM(l.base_credit), 0) AS base
                             FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                             WHERE e.status = 'approved' AND e.date <= ? AND (e.id IN (${marks}) OR e.reverses_id IN (${marks}))
                             GROUP BY l.account_code, l.party_id`).all(date, ...posted, ...posted) as { account: string; party: string | null; base: number }[];
    for (const r of rows) adjust.set(keyOf(r.account, r.party), Number(r.base));
  }

  // dinar amounts on the same account and party (other than revaluations) make a balance "mixed"
  const dinarRows = db.prepare(`SELECT l.account_code AS account, l.party_id AS party, COALESCE(SUM(l.base_debit), 0) - COALESCE(SUM(l.base_credit), 0) AS base
                                FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                                WHERE e.status = 'approved' AND e.currency = 'IQD' AND e.date <= ? AND (${MONETARY_SQL})
                                  ${posted.length ? `AND e.id NOT IN (${posted.map(() => '?').join(', ')}) AND (e.reverses_id IS NULL OR e.reverses_id NOT IN (${posted.map(() => '?').join(', ')}))` : ''}
                                GROUP BY l.account_code, l.party_id`).all(date, ...posted, ...posted) as { account: string; party: string | null; base: number }[];
  for (const r of dinarRows) if (Number(r.base) !== 0) other.set(keyOf(r.account, r.party), Number(r.base));

  const accounts = new Map(loadAccounts(db).map((a) => [a.code, a.name]));
  const partyNames = new Map((db.prepare('SELECT id, name FROM parties').all() as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  const rows: RevaluationRow[] = [];
  for (const r of usdRows) {
    const usd = Number(r.usd);
    const key = keyOf(r.account, r.party);
    const carried = Number(r.base) + (adjust.get(key) ?? 0);
    if (usd === 0 && carried === 0) continue;
    const revalued = toBase(usd, 'USD', rateX100);
    rows.push({
      accountCode: r.account,
      accountName: accounts.get(r.account) ?? { ar: r.account, en: r.account, ku: r.account },
      partyId: r.party,
      partyName: r.party ? partyNames.get(r.party) ?? null : null,
      usd, carried, revalued, difference: revalued - carried,
      mixed: !r.account.startsWith('18') && other.has(key)
    });
  }
  rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode) || (a.partyName ?? '').localeCompare(b.partyName ?? ''));
  const counted = rows.filter((r) => !r.mixed);
  const gains = counted.reduce((s, r) => s + Math.max(0, r.difference), 0);
  const losses = counted.reduce((s, r) => s + Math.max(0, -r.difference), 0);
  return { date, rateX100, rateSource, rows, gains, losses, net: gains - losses };
}

const DESCRIPTION: Record<'ar' | 'en' | 'ku', (rate: string, date: string) => string> = {
  ar: (rate, date) => `إعادة تقييم أرصدة الدولار بسعر ${rate} دينار في ${date}`,
  en: (rate, date) => `Revaluation of dollar balances at ${rate} dinars on ${date}`,
  ku: (rate, date) => `هەڵسەنگاندنەوەی ڕەسیدی دۆلار بە نرخی ${rate} دینار لە ${date}`
};

/**
 * Posts the revaluation as a draft journal entry in dinars (it then follows the preparer, checker and approver).
 * Mixed balances are left out. Gains go to `gainAccount` (under 4, default 49), losses to `lossAccount` (under 3,
 * default 39).
 */
export function postRevaluation(
  db: Db,
  input: { date: string; rateX100?: number | undefined; gainAccount?: string | undefined; lossAccount?: string | undefined; lang: 'ar' | 'en' | 'ku' },
  actor: { id: string | null; name: string }
): EntryView {
  // the report counts approved entries only: a revaluation still waiting for approval would be posted a second time
  const posted = postedRevaluations(db);
  if (posted.length && db.prepare(`SELECT 1 FROM entries WHERE status IN ('draft', 'checked') AND id IN (${posted.map(() => '?').join(', ')}) LIMIT 1`).get(...posted)) {
    throw conflict('fx_revaluation_pending');
  }
  const report = revaluation(db, { date: input.date, rateX100: input.rateX100 });
  const gainAccount = input.gainAccount ?? '49';
  const lossAccount = input.lossAccount ?? '39';
  const postable = new Map(loadAccounts(db).map((a) => [a.code, a.postable]));
  const errors: { code: string; field: string }[] = [];
  if (!gainAccount.startsWith('4') || !postable.get(gainAccount)) errors.push({ code: 'fx_account_invalid', field: 'gainAccount' });
  if (!lossAccount.startsWith('3') || !postable.get(lossAccount)) errors.push({ code: 'fx_account_invalid', field: 'lossAccount' });
  if (errors.length) throw invalid(errors);
  const rows = report.rows.filter((r) => !r.mixed && r.difference !== 0);
  if (!rows.length) throw conflict('fx_nothing_to_post');

  const lines: { accountCode: string; debit: number; credit: number; partyId?: string; description?: string }[] = [];
  for (const r of rows) {
    lines.push({
      accountCode: r.accountCode,
      debit: r.difference > 0 ? r.difference : 0,
      credit: r.difference < 0 ? -r.difference : 0,
      ...(r.partyId ? { partyId: r.partyId } : {})
    });
  }
  if (report.gains > 0) lines.push({ accountCode: gainAccount, debit: 0, credit: report.gains });
  if (report.losses > 0) lines.push({ accountCode: lossAccount, debit: report.losses, credit: 0 });

  const rate = (report.rateX100 / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return transaction(db, () => {
    const entry = createJournalEntry(db, {
      date: report.date, description: DESCRIPTION[input.lang](rate, report.date), currency: 'IQD', rateX100: 100, lines
    }, actor.name, actor.id);
    writeSetting(db, POSTED_KEY, JSON.stringify([...postedRevaluations(db), entry.id]));
    audit(db, actor.name, 'revalue', 'fx_rate', report.date, { rateX100: report.rateX100, entryId: entry.id, gains: report.gains, losses: report.losses });
    return entry;
  });
}

// ——— the API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rate = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * Reading is open to every signed-in user (other screens look up a day's rate). Entering a rate and posting a
 * revaluation need the preparer's permission (entries.prepare); the revaluation then follows approval like any entry.
 */
export const fxApi: ApiExtension = {
  rules: {
    'POST /api/fx/rates': 'entries.prepare',
    'DELETE /api/fx/rates/:date': 'entries.prepare',
    'POST /api/fx/revaluation': 'entries.prepare'
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      {
        method: 'GET', path: '/api/fx/rates',
        handler: async (req) => {
          const q = parse(z.object({ days: z.coerce.number().int().min(1).max(3660).optional(), to: date.optional() }), req.query);
          return listRates(db, q);
        }
      },
      {
        method: 'GET', path: '/api/fx/rate',
        handler: async (req) => {
          const q = parse(z.object({ date: date.optional() }), req.query);
          return rateOn(db, q.date ?? todayIso());
        }
      },
      {
        method: 'POST', path: '/api/fx/rates',
        handler: async (req, reply) => {
          const body = parse(z.object({ date: date.optional(), rateX100: rate, source: z.string().max(100).optional() }), req.body);
          reply.status(201).send(setRate(db, { date: body.date ?? todayIso(), rateX100: body.rateX100, source: body.source }, actor(req).name));
          return undefined;
        }
      },
      {
        method: 'DELETE', path: '/api/fx/rates/:date',
        handler: async (req, reply) => {
          deleteRate(db, parse(z.object({ date }), req.params).date, actor(req).name);
          reply.status(204).send();
          return undefined;
        }
      },
      {
        method: 'GET', path: '/api/fx/revaluation',
        handler: async (req) => {
          const q = parse(z.object({ date: date.optional(), rateX100: z.coerce.number().int().positive().optional() }), req.query);
          return revaluation(db, q);
        }
      },
      {
        method: 'POST', path: '/api/fx/revaluation',
        handler: async (req, reply) => {
          const body = parse(z.object({
            date, rateX100: rate.optional(), gainAccount: z.string().min(1).max(12).optional(), lossAccount: z.string().min(1).max(12).optional(),
            lang: z.enum(['ar', 'en', 'ku']).default('ar')
          }), req.body);
          const a = actor(req);
          reply.status(201).send(postRevaluation(db, body, { id: a.id, name: a.name }));
          return undefined;
        }
      }
    ];
  }
};
