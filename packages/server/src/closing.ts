import { fiscalYear, fiscalYearOf, todayIso, type EntryInput, type PostedLine } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { loadAccounts } from './accounts.ts';
import { conflict, invalid } from './errors.ts';
import { assertValid, getEntry, insertEntry, nextNumber, postedLines, reverseEntryInternal, type EntryView } from './journal.ts';
import { planStatus } from './license.ts';
import { getSettings } from './settings.ts';
import type { Actor } from './auth.ts';

/**
 * Year-end closing (إقفال السنة المالية). Once a fiscal year has ended, one closing entry on its last day empties
 * every revenue (4) and expense (3) account into the accumulated result account (the "yearResult" posting account,
 * 229 in the reserves), and the year's months are locked. The year's final accounts still show its result: reports
 * leave closing entries out of it. Reopening reverses the closing entry and unlocks the months; nothing is deleted.
 * Closing is part of Pro (with print and Excel of the final accounts); reopening works on every plan.
 */

export type YearBlocker =
  | { code: 'plan_limit' }
  | { code: 'year_not_ended' }
  | { code: 'close_previous_year_first'; year: number }
  | { code: 'unfinished_entries'; count: number }
  | { code: 'unfinished_documents'; count: number }
  | { code: 'nothing_to_close' };

export interface YearStatus {
  year: number;
  from: string;
  to: string;
  ended: boolean;
  closing: { entryId: string; number: string | null; by: string | null; at: string | null } | null;
  /** Profit (+) or loss (−) of the year, the closing left out. */
  result: number;
  /** Why it can't be closed now (empty = it can). */
  blockers: YearBlocker[];
}

const isResultAccount = (code: string) => code.startsWith('3') || code.startsWith('4');

/** Net (debit − credit) per revenue and expense account over the lines that pass `keep`. */
function resultAccounts(lines: PostedLine[], keep: (l: PostedLine) => boolean): Map<string, number> {
  const net = new Map<string, number>();
  for (const l of lines) {
    if (!keep(l) || !isResultAccount(l.accountCode)) continue;
    net.set(l.accountCode, (net.get(l.accountCode) ?? 0) + l.debit - l.credit);
  }
  for (const [code, value] of net) if (value === 0) net.delete(code);
  return net;
}

const profitOf = (net: Map<string, number>) => -[...net.values()].reduce((s, v) => s + v, 0);

function activeClosing(db: Db, from: string, to: string) {
  return db.prepare(`SELECT id, number, approved_by, approved_at FROM entries
                     WHERE type = 'closing' AND status = 'approved' AND reversed_by_id IS NULL AND date BETWEEN ? AND ?`)
    .get(from, to) as { id: string; number: string | null; approved_by: string | null; approved_at: string | null } | undefined;
}

/** The months ("YYYY-MM") of a fiscal year. */
function monthsOf(from: string, to: string): string[] {
  const months: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  for (let p = from.slice(0, 7); p <= to.slice(0, 7); p = `${y}-${String(m).padStart(2, '0')}`) {
    months.push(p);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

function statusOf(db: Db, year: number, start: string, lines: PostedLine[], today: string, canClose: boolean): YearStatus {
  const { from, to } = fiscalYear(year, start);
  const closing = activeClosing(db, from, to);
  const result = profitOf(resultAccounts(lines, (l) => l.date >= from && l.date <= to && !l.closing));
  const blockers: YearBlocker[] = [];
  if (!closing) {
    if (!canClose) blockers.push({ code: 'plan_limit' });
    if (today <= to) blockers.push({ code: 'year_not_ended' });
    // earlier years first: nothing may be left in revenue and expenses before this year
    const open = resultAccounts(lines, (l) => l.date < from);
    if (open.size) {
      const earliest = Math.min(...lines.filter((l) => l.date < from && isResultAccount(l.accountCode)).map((l) => fiscalYearOf(l.date, start)));
      for (let y = earliest; y < year; y += 1) {
        const r = fiscalYear(y, start);
        if (resultAccounts(lines, (l) => l.date >= r.from && l.date <= r.to).size) {
          blockers.push({ code: 'close_previous_year_first', year: y });
          break;
        }
      }
    }
    const entries = (db.prepare("SELECT COUNT(*) AS n FROM entries WHERE status IN ('draft', 'checked') AND date BETWEEN ? AND ?").get(from, to) as { n: number }).n;
    if (entries) blockers.push({ code: 'unfinished_entries', count: entries });
    const documents = (db.prepare("SELECT (SELECT COUNT(*) FROM invoices WHERE status = 'draft' AND date BETWEEN ?1 AND ?2) + (SELECT COUNT(*) FROM stock_docs WHERE status = 'draft' AND date BETWEEN ?1 AND ?2) AS n").get(from, to) as { n: number }).n;
    if (documents) blockers.push({ code: 'unfinished_documents', count: documents });
    if (!resultAccounts(lines, (l) => l.date >= from && l.date <= to).size) blockers.push({ code: 'nothing_to_close' });
  }
  return {
    year, from, to, ended: today > to,
    closing: closing ? { entryId: closing.id, number: closing.number, by: closing.approved_by, at: closing.approved_at } : null,
    result, blockers
  };
}

/** Every fiscal year from the first posted entry to the current one, newest first. */
export function yearStatuses(db: Db, today: string = todayIso()): YearStatus[] {
  const first = (db.prepare("SELECT MIN(date) AS d FROM entries WHERE status = 'approved'").get() as { d: string | null }).d;
  if (!first) return [];
  const start = getSettings(db).fiscalYearStart;
  const lines = postedLines(db);
  const canClose = planStatus(db).features.includes('finalAccountsExport');
  const years: YearStatus[] = [];
  for (let y = fiscalYearOf(today, start); y >= fiscalYearOf(first, start); y -= 1) years.push(statusOf(db, y, start, lines, today, canClose));
  return years;
}

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < 1900 || year > 2999) throw invalid([{ code: 'year_invalid' }]);
}

/** Posts the closing entry of `year` and locks its months. */
export function closeYear(db: Db, year: number, actor: Actor, today: string = todayIso()): EntryView {
  assertYear(year);
  const start = getSettings(db).fiscalYearStart;
  const lines = postedLines(db);
  const plan = planStatus(db);
  const status = statusOf(db, year, start, lines, today, plan.features.includes('finalAccountsExport'));
  if (status.closing) throw conflict('year_closed', { year });
  const blocker = status.blockers[0];
  if (blocker) throw conflict(blocker.code === 'plan_limit' ? 'plan_limit' : blocker.code, blocker.code === 'plan_limit' ? { limit: 'yearEnd', plan: plan.plan } : blocker);

  const target = getSettings(db).postingAccounts.yearResult;
  const account = loadAccounts(db).find((a) => a.code === target);
  if (!account || !target.startsWith('2') || !account.postable) throw conflict('year_result_account_invalid', { code: target });

  // empty each revenue and expense account (its balance up to the last day, earlier closings included)
  const balances = resultAccounts(lines, (l) => l.date <= status.to);
  const input: EntryInput = {
    type: 'closing',
    date: status.to,
    description: `إقفال السنة المالية ${year} · Year-end closing ${year}`,
    currency: 'IQD',
    rateX100: 100,
    lines: [...balances.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, net]) => ({
      accountCode: code, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0, baseDebit: net < 0 ? -net : 0, baseCredit: net > 0 ? net : 0
    }))
  };
  const total = [...balances.values()].reduce((s, v) => s + v, 0);
  // a loss (net debit) lowers the accumulated result, a profit raises it (a year that broke even has no such line)
  if (total !== 0) input.lines.push({ accountCode: target, debit: total > 0 ? total : 0, credit: total < 0 ? -total : 0, baseDebit: total > 0 ? total : 0, baseCredit: total < 0 ? -total : 0 });

  const months = monthsOf(status.from, status.to);
  const id = transaction(db, () => {
    // the closing is the year's last word: its own month may already be locked
    db.prepare('DELETE FROM locked_periods WHERE period = ?').run(status.to.slice(0, 7));
    assertValid(db, input);
    const entryId = insertEntry(db, input, actor.name, null);
    const now = new Date().toISOString();
    const number = nextNumber(db, 'closing', status.to);
    db.prepare(`UPDATE entries SET status = 'approved', number = ?, prepared_by_id = ?, checked_by = ?, checked_at = ?, checked_by_id = ?,
                approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
      .run(number, actor.id, actor.name, now, actor.id, actor.name, now, now, entryId);
    const lock = db.prepare('INSERT OR IGNORE INTO locked_periods (period, locked_by, locked_at) VALUES (?, ?, ?)');
    for (const p of months) lock.run(p, actor.name, now);
    audit(db, actor.name, 'close_year', 'year', String(year), { number, result: -total, account: target, locked: months });
    return entryId;
  });
  return getEntry(db, id);
}

/** Reverses the closing entry of `year` and unlocks its months, so the year can be corrected and closed again. */
export function reopenYear(db: Db, year: number, actor: Actor): EntryView {
  assertYear(year);
  const start = getSettings(db).fiscalYearStart;
  const { from, to } = fiscalYear(year, start);
  const closing = activeClosing(db, from, to);
  if (!closing) throw conflict('year_not_closed', { year });
  const next = fiscalYear(year + 1, start);
  if (activeClosing(db, next.from, next.to)) throw conflict('reopen_later_year_first', { year: year + 1 });
  const months = monthsOf(from, to);
  const reversalId = transaction(db, () => {
    const unlock = db.prepare('DELETE FROM locked_periods WHERE period = ?');
    for (const p of months) unlock.run(p);
    const id = reverseEntryInternal(db, closing.id, actor.name, to);
    audit(db, actor.name, 'reopen_year', 'year', String(year), { closing: closing.number, unlocked: months });
    return id;
  });
  return getEntry(db, reversalId);
}
