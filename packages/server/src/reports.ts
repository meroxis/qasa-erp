import { accountStatement, DATE_RANGE_REVERSED, finalAccounts, isReversedRange, trialBalance, type CurrencyCode, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { loadAccounts } from './accounts.ts';
import { postedLines } from './journal.ts';
import { AppError, notFound } from './errors.ts';

function names(db: Db): Map<string, Names> {
  return new Map(loadAccounts(db).map((a) => [a.code, a.name]));
}

export function trialBalanceReport(db: Db, opts: { from?: string | undefined; to?: string | undefined }) {
  // refused before the books are read (core refuses it too)
  if (isReversedRange(opts.from, opts.to)) throw new AppError(400, DATE_RANGE_REVERSED, { from: opts.from, to: opts.to });
  const byCode = names(db);
  const range: { from?: string; to?: string } = {};
  if (opts.from) range.from = opts.from;
  if (opts.to) range.to = opts.to;
  const tb = trialBalance(postedLines(db, opts.to ? { to: opts.to } : {}), range);
  return { ...tb, rows: tb.rows.map((r) => ({ ...r, name: byCode.get(r.code) ?? { ar: r.code, en: r.code, ku: r.code } })) };
}

export function statementReport(db: Db, code: string, opts: { from?: string | undefined; to?: string | undefined; currency?: CurrencyCode | undefined }) {
  const byCode = names(db);
  const name = byCode.get(code);
  if (!name) throw notFound('account');
  const range: { from?: string; to?: string } = {};
  if (opts.from) range.from = opts.from;
  if (opts.to) range.to = opts.to;
  // one currency (1.1): that currency's lines in their own amounts, so a dollar safe runs a dollar balance
  const lines = opts.currency
    ? postedLines(db).filter((l) => l.currency === opts.currency).map((l) => ({ ...l, debit: l.ownDebit, credit: l.ownCredit }))
    : postedLines(db);
  const st = accountStatement(code, lines, range);
  return { ...st, name, currency: opts.currency ?? null, rows: st.rows.map((r) => ({ ...r, accountName: byCode.get(r.accountCode) ?? name })) };
}

/** Final accounts for a period, with the account names the app shows. */
export function finalAccountsReport(db: Db, opts: { from: string; to: string }) {
  const byCode = names(db);
  const name = (code: string) => byCode.get(code) ?? { ar: code, en: code, ku: code };
  const withNames = (details: { code: string; amount: number }[]) => details.map((d) => ({ ...d, name: name(d.code) }));
  const fa = finalAccounts(postedLines(db, { to: opts.to }), opts);
  const group = (g: { code: string; amount: number; details: { code: string; amount: number }[] }) => ({ ...g, name: name(g.code), details: withNames(g.details) });
  return {
    ...fa,
    sections: fa.sections.map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r, details: withNames(r.details) })) })),
    balanceSheet: { ...fa.balanceSheet, assets: fa.balanceSheet.assets.map(group), liabilities: fa.balanceSheet.liabilities.map(group) }
  };
}
