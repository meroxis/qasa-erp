import { buildAccounts, natureOf, rollupBalances, validateNewAccountCode, type Account, type Names, type Nature } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { conflict, invalid, notFound } from './errors.ts';
import { postedLines } from './journal.ts';

export interface AccountView extends Account {
  nature: Nature;
  balance: number;
  hasEntries: boolean;
}

interface AccountRow { code: string; name_ar: string; name_en: string; name_ku: string; system: number }

function rows(db: Db): AccountRow[] {
  return db.prepare('SELECT code, name_ar, name_en, name_ku, system FROM accounts').all() as unknown as AccountRow[];
}

export function loadAccounts(db: Db): Account[] {
  return buildAccounts(rows(db).map((r) => ({ code: r.code, name: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, system: r.system === 1 })));
}

export function accountsWithEntries(db: Db): Set<string> {
  return new Set((db.prepare('SELECT DISTINCT account_code AS code FROM entry_lines').all() as { code: string }[]).map((r) => r.code));
}

export function listAccounts(db: Db): AccountView[] {
  const accounts = loadAccounts(db);
  const balances = rollupBalances(accounts, postedLines(db));
  const used = accountsWithEntries(db);
  return accounts.map((a) => ({ ...a, nature: natureOf(a.code), balance: balances.get(a.code) ?? 0, hasEntries: used.has(a.code) }));
}

export function createAccount(db: Db, input: { parentCode: string; code: string; name: Names }, user: string): AccountView {
  const existing = new Set(rows(db).map((r) => r.code));
  const used = accountsWithEntries(db);
  const error = validateNewAccountCode(input.code, input.parentCode, { exists: (c) => existing.has(c), hasEntries: (c) => used.has(c) });
  if (error) throw error === 'code_exists' || error === 'parent_has_entries' ? conflict(error) : invalid([{ code: error }]);
  if (!input.name.ar.trim() && !input.name.en.trim() && !input.name.ku.trim()) throw invalid([{ code: 'name_required' }]);
  transaction(db, () => {
    db.prepare('INSERT INTO accounts (code, name_ar, name_en, name_ku, system, created_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(input.code, input.name.ar.trim(), input.name.en.trim(), input.name.ku.trim(), new Date().toISOString());
    audit(db, user, 'create', 'account', input.code, input);
  });
  return listAccounts(db).find((a) => a.code === input.code)!;
}

export function renameAccount(db: Db, code: string, name: Names, user: string): AccountView {
  if (!existsAccount(db, code)) throw notFound('account');
  transaction(db, () => {
    db.prepare('UPDATE accounts SET name_ar = ?, name_en = ?, name_ku = ? WHERE code = ?').run(name.ar.trim(), name.en.trim(), name.ku.trim(), code);
    audit(db, user, 'rename', 'account', code, name);
  });
  return listAccounts(db).find((a) => a.code === code)!;
}

export function deleteAccount(db: Db, code: string, user: string): void {
  const account = loadAccounts(db).find((a) => a.code === code);
  if (!account) throw notFound('account');
  if (account.system) throw conflict('account_is_standard');
  if (!account.postable) throw conflict('account_has_children');
  if (accountsWithEntries(db).has(code)) throw conflict('account_has_entries');
  transaction(db, () => {
    db.prepare('DELETE FROM accounts WHERE code = ?').run(code);
    audit(db, user, 'delete', 'account', code);
  });
}

export function existsAccount(db: Db, code: string): boolean {
  return !!db.prepare('SELECT 1 FROM accounts WHERE code = ?').get(code);
}
