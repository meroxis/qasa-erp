import { randomUUID } from 'node:crypto';
import { isMinorAmount, normalizeForSearch } from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { postedLines } from './journal.ts';
import { getPostingAccounts } from './settings.ts';

export type PartyType = 'customer' | 'supplier';

export interface PartyInput {
  name: string;
  phone?: string | undefined;
  address?: string | undefined;
  accountCode?: string | undefined;
  /** IQD; null = no limit. Customers only. */
  creditLimit?: number | null | undefined;
  notes?: string | undefined;
  active?: boolean | undefined;
}

export interface PartyView {
  id: string;
  type: PartyType;
  code: string;
  name: string;
  phone: string;
  address: string;
  accountCode: string;
  creditLimit: number | null;
  notes: string;
  active: boolean;
  /** In IQD, in the party's own direction: what a customer owes us, or what we owe a supplier. */
  balance: number;
  hasEntries: boolean;
}

interface PartyRow {
  id: string; type: PartyType; code: string; name: string; phone: string | null; address: string | null;
  account_code: string; credit_limit: number | null; notes: string | null; active: number;
}

/** Customer accounts sit under 16 (المدينون), supplier accounts under 26 (الدائنون). */
const ACCOUNT_ROOT: Record<PartyType, string> = { customer: '16', supplier: '26' };
const CODE_PREFIX: Record<PartyType, string> = { customer: 'C', supplier: 'S' };

function balances(db: Db): Map<string, { debit: number; credit: number }> {
  const rows = db.prepare(`SELECT l.party_id, SUM(l.base_debit) AS debit, SUM(l.base_credit) AS credit
                           FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                           WHERE e.status = 'approved' AND l.party_id IS NOT NULL GROUP BY l.party_id`).all() as
    { party_id: string; debit: number; credit: number }[];
  return new Map(rows.map((r) => [r.party_id, { debit: r.debit, credit: r.credit }]));
}

function toView(row: PartyRow, sums: { debit: number; credit: number } | undefined, used: boolean): PartyView {
  const debit = sums?.debit ?? 0;
  const credit = sums?.credit ?? 0;
  return {
    id: row.id, type: row.type, code: row.code, name: row.name, phone: row.phone ?? '', address: row.address ?? '',
    accountCode: row.account_code, creditLimit: row.credit_limit, notes: row.notes ?? '', active: row.active === 1,
    balance: row.type === 'customer' ? debit - credit : credit - debit,
    hasEntries: used
  };
}

function usedParties(db: Db): Set<string> {
  const rows = db.prepare(`SELECT DISTINCT party_id AS id FROM entry_lines WHERE party_id IS NOT NULL
                           UNION SELECT DISTINCT party_id FROM invoices WHERE party_id IS NOT NULL`).all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

export function listParties(db: Db, filters: { type?: PartyType | undefined; q?: string | undefined; active?: boolean | undefined } = {}): PartyView[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filters.type) { where.push('type = ?'); params.push(filters.type); }
  if (filters.active !== undefined) where.push(`active = ${filters.active ? 1 : 0}`);
  const rows = db.prepare(`SELECT * FROM parties ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY code`).all(...params) as unknown as PartyRow[];
  const sums = balances(db);
  const used = usedParties(db);
  const q = filters.q ? normalizeForSearch(filters.q) : '';
  return rows
    .filter((r) => !q || normalizeForSearch(`${r.code} ${r.name} ${r.phone ?? ''}`).includes(q))
    .map((r) => toView(r, sums.get(r.id), used.has(r.id)));
}

function loadRow(db: Db, id: string): PartyRow {
  const row = db.prepare('SELECT * FROM parties WHERE id = ?').get(id) as unknown as PartyRow | undefined;
  if (!row) throw notFound('party');
  return row;
}

export function getParty(db: Db, id: string): PartyView {
  const row = loadRow(db, id);
  return toView(row, balances(db).get(id), usedParties(db).has(id));
}

function assertInput(db: Db, type: PartyType, input: PartyInput, accountCode: string): void {
  const errors: { code: string }[] = [];
  if (!input.name?.trim()) errors.push({ code: 'name_required' });
  const account = loadAccounts(db).find((a) => a.code === accountCode);
  if (!account || !accountCode.startsWith(ACCOUNT_ROOT[type])) errors.push({ code: 'account_invalid' });
  else if (!account.postable) errors.push({ code: 'account_not_postable' });
  if (input.creditLimit !== undefined && input.creditLimit !== null && (!isMinorAmount(input.creditLimit) || input.creditLimit < 0)) {
    errors.push({ code: 'credit_limit_invalid' });
  }
  if (errors.length) throw invalid(errors);
}

export function createParty(db: Db, type: PartyType, input: PartyInput, user: string): PartyView {
  const posting = getPostingAccounts(db);
  const accountCode = input.accountCode || (type === 'customer' ? posting.customers : posting.suppliers);
  assertInput(db, type, input, accountCode);
  const id = randomUUID();
  transaction(db, () => {
    const code = `${CODE_PREFIX[type]}-${String(nextSequence(db, `party:${type}`)).padStart(4, '0')}`;
    db.prepare(`INSERT INTO parties (id, type, code, name, phone, address, account_code, credit_limit, notes, active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, type, code, input.name.trim(), input.phone?.trim() || null, input.address?.trim() || null, accountCode,
        type === 'customer' ? input.creditLimit ?? null : null, input.notes?.trim() || null, input.active === false ? 0 : 1, new Date().toISOString());
    audit(db, user, 'create', 'party', id, { type, code, name: input.name.trim() });
  });
  return getParty(db, id);
}

export function updateParty(db: Db, id: string, input: PartyInput, user: string): PartyView {
  const row = loadRow(db, id);
  const accountCode = input.accountCode || row.account_code;
  assertInput(db, row.type, input, accountCode);
  transaction(db, () => {
    db.prepare('UPDATE parties SET name = ?, phone = ?, address = ?, account_code = ?, credit_limit = ?, notes = ?, active = ? WHERE id = ?')
      .run(input.name.trim(), input.phone?.trim() || null, input.address?.trim() || null, accountCode,
        row.type === 'customer' ? input.creditLimit ?? null : null, input.notes?.trim() || null, input.active === false ? 0 : 1, id);
    audit(db, user, 'update', 'party', id, input);
  });
  return getParty(db, id);
}

export function deleteParty(db: Db, id: string, user: string): void {
  loadRow(db, id);
  if (usedParties(db).has(id)) throw conflict('party_has_entries');
  transaction(db, () => {
    db.prepare('DELETE FROM parties WHERE id = ?').run(id);
    audit(db, user, 'delete', 'party', id);
  });
}

export interface PartyStatementLine {
  entryId: string;
  invoiceId: string | null;
  number: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  /** Running balance in the party's own direction. */
  balance: number;
}

export interface PartyStatement {
  party: PartyView;
  from: string | null;
  to: string | null;
  opening: number;
  lines: PartyStatementLine[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

/** كشف حساب زبون / مجهز — every posted line tagged with this party, in IQD. */
export function partyStatement(db: Db, id: string, range: { from?: string | undefined; to?: string | undefined } = {}): PartyStatement {
  const party = getParty(db, id);
  const sign = party.type === 'customer' ? 1 : -1;
  const invoiceOf = new Map((db.prepare('SELECT id, entry_id, cancel_entry_id FROM invoices WHERE party_id = ?').all(id) as
    { id: string; entry_id: string | null; cancel_entry_id: string | null }[])
    .flatMap((r) => [[r.entry_id, r.id], [r.cancel_entry_id, r.id]] as [string | null, string][]));
  let opening = 0;
  let running = 0;
  const lines: PartyStatementLine[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of postedLines(db, { partyId: id, ...(range.to ? { to: range.to } : {}) })) {
    const change = sign * (l.debit - l.credit);
    if (range.from && l.date < range.from) { opening += change; continue; }
    if (lines.length === 0) running = opening;
    running += change;
    totalDebit += l.debit;
    totalCredit += l.credit;
    lines.push({ entryId: l.entryId, invoiceId: invoiceOf.get(l.entryId) ?? null, number: l.number, date: l.date, description: l.description, debit: l.debit, credit: l.credit, balance: running });
  }
  return { party, from: range.from ?? null, to: range.to ?? null, opening, lines, totalDebit, totalCredit, closing: lines.length ? running : opening };
}
