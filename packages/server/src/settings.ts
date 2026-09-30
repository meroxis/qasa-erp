import { DEFAULT_POSTING_ACCOUNTS, type Names, type PostingAccounts } from '@qasa/core';
import type { Db } from './db.ts';
import { audit } from './audit.ts';
import { transaction } from './db.ts';
import { invalid } from './errors.ts';

export interface Settings {
  companyName: Names;
  /** Default USD rate, IQD per 1 USD × 100. */
  defaultRateX100: number;
  /** "MM-DD" */
  fiscalYearStart: string;
  /** Accounts that invoices post to. */
  postingAccounts: PostingAccounts;
}

/** Where each posting account must sit in the unified chart. */
const POSTING_ACCOUNT_PARENTS: Record<keyof PostingAccounts, string> = {
  customers: '16', suppliers: '26', sales: '4', costOfSales: '3', cash: '18', yearResult: '22'
};

export function readSetting(db: Db, key: string): string | undefined {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

export function writeSetting(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function deleteSetting(db: Db, key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

export function getPostingAccounts(db: Db): PostingAccounts {
  const stored = JSON.parse(readSetting(db, 'posting_accounts') ?? '{}') as Partial<PostingAccounts>;
  // a company from before the year-end closing where 229 could not be added (22 already had entries): 22 itself
  const yearResult = stored.yearResult
    ?? (db.prepare('SELECT 1 FROM accounts WHERE code = ?').get(DEFAULT_POSTING_ACCOUNTS.yearResult) ? DEFAULT_POSTING_ACCOUNTS.yearResult : '22');
  return { ...DEFAULT_POSTING_ACCOUNTS, ...stored, yearResult };
}

export function getSettings(db: Db): Settings {
  return {
    companyName: JSON.parse(readSetting(db, 'company_name') ?? '{"ar":"","en":"","ku":""}') as Names,
    defaultRateX100: Number(readSetting(db, 'default_rate_x100') ?? '142000'),
    fiscalYearStart: readSetting(db, 'fiscal_year_start') ?? '01-01',
    postingAccounts: getPostingAccounts(db)
  };
}

function assertPostingAccounts(db: Db, accounts: PostingAccounts): void {
  const exists = db.prepare('SELECT 1 FROM accounts WHERE code = ?');
  const hasChildren = db.prepare("SELECT 1 FROM accounts WHERE code LIKE ? || '%' AND code <> ? LIMIT 1");
  const errors: { code: string; field: string }[] = [];
  for (const key of Object.keys(POSTING_ACCOUNT_PARENTS) as (keyof PostingAccounts)[]) {
    const code = accounts[key];
    if (!code || !code.startsWith(POSTING_ACCOUNT_PARENTS[key]) || !exists.get(code)) errors.push({ code: 'account_invalid', field: key });
    else if (hasChildren.get(code, code)) errors.push({ code: 'account_not_postable', field: key });
  }
  if (errors.length) throw invalid(errors);
}

export function updateSettings(db: Db, patch: Partial<Settings>, user: string): Settings {
  if (patch.postingAccounts) assertPostingAccounts(db, { ...getPostingAccounts(db), ...patch.postingAccounts });
  transaction(db, () => {
    if (patch.companyName) writeSetting(db, 'company_name', JSON.stringify(patch.companyName));
    if (patch.defaultRateX100 !== undefined) writeSetting(db, 'default_rate_x100', String(patch.defaultRateX100));
    if (patch.fiscalYearStart) writeSetting(db, 'fiscal_year_start', patch.fiscalYearStart);
    if (patch.postingAccounts) writeSetting(db, 'posting_accounts', JSON.stringify({ ...getPostingAccounts(db), ...patch.postingAccounts }));
    audit(db, user, 'update', 'settings', null, patch);
  });
  return getSettings(db);
}

export function lockedPeriods(db: Db): { period: string; lockedBy: string; lockedAt: string }[] {
  return (db.prepare('SELECT period, locked_by, locked_at FROM locked_periods ORDER BY period').all() as { period: string; locked_by: string; locked_at: string }[])
    .map((r) => ({ period: r.period, lockedBy: r.locked_by, lockedAt: r.locked_at }));
}

export function isPeriodLocked(db: Db, isoDate: string): boolean {
  return !!db.prepare('SELECT 1 FROM locked_periods WHERE period = ?').get(isoDate.slice(0, 7));
}

export function lockPeriod(db: Db, period: string, user: string): void {
  transaction(db, () => {
    db.prepare('INSERT OR IGNORE INTO locked_periods (period, locked_by, locked_at) VALUES (?, ?, ?)').run(period, user, new Date().toISOString());
    audit(db, user, 'lock', 'period', period);
  });
}

export function unlockPeriod(db: Db, period: string, user: string): void {
  transaction(db, () => {
    db.prepare('DELETE FROM locked_periods WHERE period = ?').run(period);
    audit(db, user, 'unlock', 'period', period);
  });
}
