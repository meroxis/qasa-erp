import { randomUUID } from 'node:crypto';
import {
  allowedActions,
  entryNumber,
  isIsoDate,
  isMinorAmount,
  reverseLines,
  todayIso,
  validateEntry,
  voucherToEntry,
  withBaseAmounts,
  yearOf,
  type EntryAction,
  type EntryInput,
  type EntryStatus,
  type EntryType,
  type Names,
  type PostedLine,
  type VoucherInput
} from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { isPeriodLocked } from './settings.ts';

interface EntryRow {
  id: string; type: EntryType; number: string | null; date: string; description: string; party: string | null;
  currency: 'IQD' | 'USD'; rate_x100: number; status: EntryStatus; cash_account: string | null;
  reverses_id: string | null; reversed_by_id: string | null;
  prepared_by: string; prepared_at: string; checked_by: string | null; checked_at: string | null;
  approved_by: string | null; approved_at: string | null;
}

interface LineRow {
  line_no: number; account_code: string; debit: number; credit: number; base_debit: number; base_credit: number; description: string | null;
  name_ar: string; name_en: string; name_ku: string; party_id: string | null; party_name: string | null;
}

export interface EntryLineView {
  lineNo: number;
  accountCode: string;
  accountName: Names;
  debit: number;
  credit: number;
  baseDebit: number;
  baseCredit: number;
  description: string;
  partyId: string | null;
  partyName: string | null;
}

export interface EntryView {
  id: string;
  type: EntryType;
  number: string | null;
  date: string;
  description: string;
  party: string | null;
  currency: 'IQD' | 'USD';
  rateX100: number;
  status: EntryStatus;
  cashAccountCode: string | null;
  reversesId: string | null;
  reversedById: string | null;
  preparedBy: string;
  preparedAt: string;
  checkedBy: string | null;
  checkedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  /** Total in the entry currency (sum of debits). */
  total: number;
  /** Total in IQD. */
  baseTotal: number;
  lines: EntryLineView[];
  actions: EntryAction[];
  /** The invoice that posted (or cancelled) this entry, if any. */
  invoiceId: string | null;
}

export type EntrySummary = Omit<EntryView, 'lines' | 'actions' | 'invoiceId'>;

const isInvoiceType = (type: EntryType) => type === 'sale' || type === 'purchase';

function entryContext(db: Db) {
  const accounts = new Map(loadAccounts(db).map((a) => [a.code, a]));
  return {
    accountExists: (code: string) => accounts.has(code),
    isPostable: (code: string) => accounts.get(code)?.postable ?? false,
    isPeriodLocked: (date: string) => isPeriodLocked(db, date)
  };
}

export function assertValid(db: Db, input: EntryInput): void {
  const errors: { code: string; line?: number }[] = validateEntry(input, entryContext(db));
  const partyExists = db.prepare('SELECT 1 FROM parties WHERE id = ?');
  input.lines.forEach((l, i) => {
    if (l.partyId && !partyExists.get(l.partyId)) errors.push({ code: 'party_invalid', line: i + 1 });
  });
  if (errors.length) throw invalid(errors);
}

function assertValidVoucher(db: Db, v: VoucherInput): EntryInput {
  const errors: { code: string; line?: number }[] = [];
  if (!v.cashAccountCode || !v.cashAccountCode.startsWith('18')) errors.push({ code: 'cash_account_invalid' });
  if (!Array.isArray(v.items) || v.items.length === 0) errors.push({ code: 'items_required' });
  else v.items.forEach((it, i) => { if (!isMinorAmount(it.amount) || it.amount <= 0) errors.push({ code: 'line_amount_invalid', line: i + 1 }); });
  if (errors.length) throw invalid(errors);
  const entry = voucherToEntry(v);
  assertValid(db, entry);
  return entry;
}

function insertLines(db: Db, id: string, input: EntryInput): void {
  const insert = db.prepare(`INSERT INTO entry_lines (entry_id, line_no, account_code, debit, credit, base_debit, base_credit, description, party_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  withBaseAmounts(input).forEach((l, i) => {
    insert.run(id, i + 1, l.accountCode, l.debit, l.credit, l.baseDebit, l.baseCredit, l.description?.trim() || null, l.partyId ?? null);
  });
}

export function insertEntry(db: Db, input: EntryInput, user: string, cashAccountCode: string | null, status: EntryStatus = 'draft'): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO entries (id, type, date, description, party, currency, rate_x100, status, cash_account, prepared_by, prepared_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.type, input.date, input.description.trim(), input.party?.trim() || null, input.currency,
      input.currency === 'IQD' ? 100 : input.rateX100, status, cashAccountCode, user, now, now);
  insertLines(db, id, input);
  return id;
}

export function createJournalEntry(db: Db, input: Omit<EntryInput, 'type'>, user: string): EntryView {
  const entry: EntryInput = { ...input, type: 'journal' };
  assertValid(db, entry);
  const id = transaction(db, () => {
    const newId = insertEntry(db, entry, user, null);
    audit(db, user, 'create', 'entry', newId, { type: 'journal' });
    return newId;
  });
  return getEntry(db, id);
}

export function createVoucher(db: Db, v: VoucherInput, user: string): EntryView {
  const entry = assertValidVoucher(db, v);
  const id = transaction(db, () => {
    const newId = insertEntry(db, entry, user, v.cashAccountCode);
    audit(db, user, 'create', 'entry', newId, { type: v.kind });
    return newId;
  });
  return getEntry(db, id);
}

function loadRow(db: Db, id: string): EntryRow {
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as unknown as EntryRow | undefined;
  if (!row) throw notFound('entry');
  return row;
}

function requireAction(row: EntryRow, action: EntryAction): void {
  const actions = allowedActions(row.status, { reversed: !!row.reversed_by_id, isReversal: row.type === 'reversal', fromInvoice: isInvoiceType(row.type) });
  if (!actions.includes(action)) throw conflict('action_not_allowed', { status: row.status, action });
}

/** Replaces a draft journal entry. */
export function updateJournalEntry(db: Db, id: string, input: Omit<EntryInput, 'type'>, user: string): EntryView {
  const row = loadRow(db, id);
  if (row.type !== 'journal') throw conflict('wrong_entry_type');
  requireAction(row, 'edit');
  const entry: EntryInput = { ...input, type: 'journal' };
  assertValid(db, entry);
  transaction(db, () => {
    replaceDraft(db, id, entry, null);
    audit(db, user, 'update', 'entry', id);
  });
  return getEntry(db, id);
}

/** Replaces a draft receipt/payment voucher. */
export function updateVoucher(db: Db, id: string, v: VoucherInput, user: string): EntryView {
  const row = loadRow(db, id);
  if (row.type !== v.kind) throw conflict('wrong_entry_type');
  requireAction(row, 'edit');
  const entry = assertValidVoucher(db, v);
  transaction(db, () => {
    replaceDraft(db, id, entry, v.cashAccountCode);
    audit(db, user, 'update', 'entry', id);
  });
  return getEntry(db, id);
}

function replaceDraft(db: Db, id: string, entry: EntryInput, cashAccountCode: string | null): void {
  db.prepare('UPDATE entries SET date = ?, description = ?, party = ?, currency = ?, rate_x100 = ?, cash_account = ?, updated_at = ? WHERE id = ?')
    .run(entry.date, entry.description.trim(), entry.party?.trim() || null, entry.currency, entry.currency === 'IQD' ? 100 : entry.rateX100,
      cashAccountCode, new Date().toISOString(), id);
  db.prepare('DELETE FROM entry_lines WHERE entry_id = ?').run(id);
  insertLines(db, id, entry);
}

export function deleteEntry(db: Db, id: string, user: string): void {
  const row = loadRow(db, id);
  requireAction(row, 'delete');
  transaction(db, () => {
    db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    audit(db, user, 'delete', 'entry', id, { type: row.type });
  });
}

function revalidateStored(db: Db, id: string): void {
  const view = getEntry(db, id);
  assertValid(db, {
    type: view.type, date: view.date, description: view.description, currency: view.currency, rateX100: view.rateX100,
    lines: view.lines.map((l) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit, ...(l.partyId ? { partyId: l.partyId } : {}) }))
  });
}

/** المدقق: draft → checked */
export function checkEntry(db: Db, id: string, user: string): EntryView {
  const row = loadRow(db, id);
  requireAction(row, 'check');
  revalidateStored(db, id);
  transaction(db, () => {
    const now = new Date().toISOString();
    db.prepare("UPDATE entries SET status = 'checked', checked_by = ?, checked_at = ?, updated_at = ? WHERE id = ?").run(user, now, now, id);
    audit(db, user, 'check', 'entry', id);
  });
  return getEntry(db, id);
}

/** Sends a checked entry back to the preparer. */
export function returnEntry(db: Db, id: string, user: string): EntryView {
  const row = loadRow(db, id);
  requireAction(row, 'return');
  transaction(db, () => {
    db.prepare("UPDATE entries SET status = 'draft', checked_by = NULL, checked_at = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    audit(db, user, 'return', 'entry', id);
  });
  return getEntry(db, id);
}

export function nextNumber(db: Db, type: EntryType, date: string): string {
  const year = yearOf(date);
  return entryNumber(type, year, nextSequence(db, `${type}:${year}`));
}

/** المصادق: checked → approved (posted). The voucher number is assigned now, so posted numbers have no gaps. */
export function approveEntry(db: Db, id: string, user: string): EntryView {
  const row = loadRow(db, id);
  requireAction(row, 'approve');
  revalidateStored(db, id);
  transaction(db, () => {
    const now = new Date().toISOString();
    const number = nextNumber(db, row.type, row.date);
    db.prepare("UPDATE entries SET status = 'approved', number = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?").run(number, user, now, now, id);
    audit(db, user, 'approve', 'entry', id, { number });
  });
  return getEntry(db, id);
}

/** Corrects a posted entry with an opposite entry (قيد عكسي). Both stay in the books. */
export function reverseEntry(db: Db, id: string, user: string, date?: string): EntryView {
  requireAction(loadRow(db, id), 'reverse');
  return getEntry(db, reverseEntryInternal(db, id, user, date));
}

/** Creates and posts the reversal of a posted entry; also used when an invoice is cancelled. Returns the reversal's id. */
export function reverseEntryInternal(db: Db, id: string, user: string, date?: string): string {
  const original = getEntry(db, id);
  if (original.status !== 'approved' || original.reversedById) throw conflict('action_not_allowed', { status: original.status, action: 'reverse' });
  const reversalDate = date ?? todayIso();
  if (!isIsoDate(reversalDate)) throw invalid([{ code: 'date_invalid' }]);
  const input: EntryInput = {
    type: 'reversal',
    date: reversalDate,
    description: `${original.number ?? ''} — ${original.description}`.trim(),
    currency: original.currency,
    rateX100: original.rateX100,
    lines: reverseLines(original.lines.map((l) => ({
      accountCode: l.accountCode, debit: l.debit, credit: l.credit, baseDebit: l.baseDebit, baseCredit: l.baseCredit,
      ...(l.description ? { description: l.description } : {}),
      ...(l.partyId ? { partyId: l.partyId } : {})
    })))
  };
  if (original.party) input.party = original.party;
  assertValid(db, input);
  const newId = transaction(db, () => {
    const reversalId = insertEntry(db, input, user, original.cashAccountCode);
    const now = new Date().toISOString();
    const number = nextNumber(db, 'reversal', reversalDate);
    db.prepare(`UPDATE entries SET status = 'approved', number = ?, reverses_id = ?, checked_by = ?, checked_at = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
      .run(number, id, user, now, user, now, now, reversalId);
    db.prepare('UPDATE entries SET reversed_by_id = ?, updated_at = ? WHERE id = ?').run(reversalId, now, id);
    audit(db, user, 'reverse', 'entry', id, { reversalId, number });
    return reversalId;
  });
  return newId;
}

function toView(row: EntryRow, lines: LineRow[], invoiceId: string | null = null): EntryView {
  const view: EntryView = {
    id: row.id, type: row.type, number: row.number, date: row.date, description: row.description, party: row.party,
    currency: row.currency, rateX100: row.rate_x100, status: row.status, cashAccountCode: row.cash_account,
    reversesId: row.reverses_id, reversedById: row.reversed_by_id,
    preparedBy: row.prepared_by, preparedAt: row.prepared_at, checkedBy: row.checked_by, checkedAt: row.checked_at,
    approvedBy: row.approved_by, approvedAt: row.approved_at,
    total: lines.reduce((s, l) => s + l.debit, 0),
    baseTotal: lines.reduce((s, l) => s + l.base_debit, 0),
    lines: lines.map((l) => ({
      lineNo: l.line_no, accountCode: l.account_code, accountName: { ar: l.name_ar, en: l.name_en, ku: l.name_ku },
      debit: l.debit, credit: l.credit, baseDebit: l.base_debit, baseCredit: l.base_credit, description: l.description ?? '',
      partyId: l.party_id, partyName: l.party_name
    })),
    actions: allowedActions(row.status, { reversed: !!row.reversed_by_id, isReversal: row.type === 'reversal', fromInvoice: isInvoiceType(row.type) }),
    invoiceId
  };
  return view;
}

const LINES_SQL = `SELECT l.line_no, l.account_code, l.debit, l.credit, l.base_debit, l.base_credit, l.description, a.name_ar, a.name_en, a.name_ku,
                          l.party_id, p.name AS party_name
                   FROM entry_lines l JOIN accounts a ON a.code = l.account_code LEFT JOIN parties p ON p.id = l.party_id
                   WHERE l.entry_id = ? ORDER BY l.line_no`;

export function getEntry(db: Db, id: string): EntryView {
  const row = loadRow(db, id);
  const invoice = db.prepare('SELECT id FROM invoices WHERE entry_id = ? OR cancel_entry_id = ?').get(id, id) as { id: string } | undefined;
  return toView(row, db.prepare(LINES_SQL).all(id) as unknown as LineRow[], invoice?.id ?? null);
}

export interface EntryFilters {
  type?: EntryType | undefined;
  status?: EntryStatus | undefined;
  from?: string | undefined;
  to?: string | undefined;
  q?: string | undefined;
  limit?: number | undefined;
}

export function listEntries(db: Db, f: EntryFilters = {}): EntrySummary[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.type) { where.push('e.type = ?'); params.push(f.type); }
  if (f.status) { where.push('e.status = ?'); params.push(f.status); }
  if (f.from) { where.push('e.date >= ?'); params.push(f.from); }
  if (f.to) { where.push('e.date <= ?'); params.push(f.to); }
  if (f.q) {
    where.push("(e.description LIKE ? OR IFNULL(e.party, '') LIKE ? OR IFNULL(e.number, '') LIKE ?)");
    const like = `%${f.q}%`;
    params.push(like, like, like);
  }
  const sql = `SELECT e.*, (SELECT SUM(debit) FROM entry_lines WHERE entry_id = e.id) AS total,
                      (SELECT SUM(base_debit) FROM entry_lines WHERE entry_id = e.id) AS base_total
               FROM entries e ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY e.date DESC, e.prepared_at DESC LIMIT ?`;
  params.push(f.limit ?? 500);
  const found = db.prepare(sql).all(...params) as unknown as (EntryRow & { total: number; base_total: number })[];
  return found.map((row) => {
    const { lines: _lines, actions: _actions, invoiceId: _invoiceId, ...summary } = toView(row, []);
    return { ...summary, total: row.total ?? 0, baseTotal: row.base_total ?? 0 };
  });
}

/** Lines of approved entries in IQD — the input for every report. */
export function postedLines(db: Db, opts: { to?: string; partyId?: string } = {}): (PostedLine & { partyId: string | null })[] {
  const where = ["e.status = 'approved'"];
  const params: string[] = [];
  if (opts.to) { where.push('e.date <= ?'); params.push(opts.to); }
  if (opts.partyId) { where.push('l.party_id = ?'); params.push(opts.partyId); }
  const rows = db.prepare(`SELECT e.id, e.number, e.date, l.account_code, l.base_debit, l.base_credit, l.party_id,
                                  COALESCE(l.description, e.description) AS description
                           FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                           WHERE ${where.join(' AND ')}
                           ORDER BY e.date, e.number, l.line_no`).all(...params) as {
    id: string; number: string; date: string; account_code: string; base_debit: number; base_credit: number; party_id: string | null; description: string;
  }[];
  return rows.map((r) => ({
    entryId: r.id, number: r.number, date: r.date, accountCode: r.account_code, debit: r.base_debit, credit: r.base_credit,
    description: r.description, partyId: r.party_id
  }));
}
