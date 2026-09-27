import { accountStatement, finalAccounts, trialBalance, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { loadAccounts } from './accounts.ts';
import { postedLines } from './journal.ts';
import { notFound } from './errors.ts';

function names(db: Db): Map<string, Names> {
  return new Map(loadAccounts(db).map((a) => [a.code, a.name]));
}

export function trialBalanceReport(db: Db, opts: { from?: string | undefined; to?: string | undefined }) {
  const byCode = names(db);
  const range: { from?: string; to?: string } = {};
  if (opts.from) range.from = opts.from;
  if (opts.to) range.to = opts.to;
  const tb = trialBalance(postedLines(db, opts.to ? { to: opts.to } : {}), range);
  return { ...tb, rows: tb.rows.map((r) => ({ ...r, name: byCode.get(r.code) ?? { ar: r.code, en: r.code, ku: r.code } })) };
}

export function statementReport(db: Db, code: string, opts: { from?: string | undefined; to?: string | undefined }) {
  const byCode = names(db);
  const name = byCode.get(code);
  if (!name) throw notFound('account');
  const range: { from?: string; to?: string } = {};
  if (opts.from) range.from = opts.from;
  if (opts.to) range.to = opts.to;
  const st = accountStatement(code, postedLines(db), range);
  return { ...st, name, rows: st.rows.map((r) => ({ ...r, accountName: byCode.get(r.accountCode) ?? name })) };
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
