import type { Names } from '@qasa/core';
import type { Db } from './db.ts';
import { audit } from './audit.ts';
import { transaction } from './db.ts';

export interface Settings {
  companyName: Names;
  /** Default USD rate, IQD per 1 USD × 100. */
  defaultRateX100: number;
  /** "MM-DD" */
  fiscalYearStart: string;
}

function read(db: Db, key: string): string | undefined {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

function write(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function getSettings(db: Db): Settings {
  return {
    companyName: JSON.parse(read(db, 'company_name') ?? '{"ar":"","en":"","ku":""}') as Names,
    defaultRateX100: Number(read(db, 'default_rate_x100') ?? '142000'),
    fiscalYearStart: read(db, 'fiscal_year_start') ?? '01-01'
  };
}

export function updateSettings(db: Db, patch: Partial<Settings>, user: string): Settings {
  transaction(db, () => {
    if (patch.companyName) write(db, 'company_name', JSON.stringify(patch.companyName));
    if (patch.defaultRateX100 !== undefined) write(db, 'default_rate_x100', String(patch.defaultRateX100));
    if (patch.fiscalYearStart) write(db, 'fiscal_year_start', patch.fiscalYearStart);
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
