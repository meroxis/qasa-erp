import { randomUUID } from 'node:crypto';
import {
  allowedActions,
  DOCUMENT_ENTRY_TYPES,
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
  type VoucherInput,
  type CurrencyCode
} from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { isPeriodLocked, readSetting, writeSetting } from './settings.ts';
import { entryInBranchSql } from './branches.ts';

interface EntryRow {
  id: string; type: EntryType; number: string | null; date: string; description: string; party: string | null;
  currency: 'IQD' | 'USD'; rate_x100: number; status: EntryStatus; cash_account: string | null;
  reverses_id: string | null; reversed_by_id: string | null;
  prepared_by: string; prepared_at: string; checked_by: string | null; checked_at: string | null;
  approved_by: string | null; approved_at: string | null;
  prepared_by_id: string | null; checked_by_id: string | null;
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
  /** who that is, so the screens know a user's own voucher (null: prepared without sign-in) */
  preparedById: string | null;
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
  /** The opening-stock or transfer document that posted this entry. */
  stockDocId: string | null;
  /** 1.4: sent for approval ("Vouchers need approval"): where that stands, who asked and who answered (null: never sent) */
  approval: VoucherApproval | null;
}

export type ApprovalState = 'waiting' | 'rejected' | 'approved';

export interface VoucherApproval {
  state: ApprovalState;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  /** why it was rejected */
  reason: string | null;
}

interface ApprovalRow {
  va_state: ApprovalState | null; va_requested_by: string | null; va_requested_at: string | null;
  va_decided_by: string | null; va_decided_at: string | null; va_reason: string | null;
}

const APPROVAL_COLUMNS = 'va.state AS va_state, va.requested_by AS va_requested_by, va.requested_at AS va_requested_at, va.decided_by AS va_decided_by, va.decided_at AS va_decided_at, va.reason AS va_reason';

function toApproval(r: ApprovalRow | undefined): VoucherApproval | null {
  if (!r?.va_state) return null;
  return { state: r.va_state, requestedBy: r.va_requested_by ?? '', requestedAt: r.va_requested_at ?? '', decidedBy: r.va_decided_by, decidedAt: r.va_decided_at, reason: r.va_reason };
}

function approvalOf(db: Db, id: string): VoucherApproval | null {
  return toApproval(db.prepare(`SELECT ${APPROVAL_COLUMNS} FROM voucher_approvals va WHERE va.entry_id = ?`).get(id) as ApprovalRow | undefined);
}

// ——— "Vouchers need approval" (1.4) ———

/**
 * A company setting, off unless switched on. While it is on, a voucher made by someone who may not approve vouchers
 * (the entries.approve permission: the approver role, and every admin) is saved as waiting for approval: still a draft,
 * so in no balance and no report, until someone with that permission approves it, or rejects it with a reason. A
 * voucher made by someone who has the permission is approved at once (not under "separate duties": whoever prepared a
 * voucher never approves it there).
 */
const NEED_APPROVAL = 'vouchers_need_approval';

export function vouchersNeedApproval(db: Db): boolean {
  return readSetting(db, NEED_APPROVAL) === '1';
}

/** Who prepares a voucher: `mayApprove` says whether they hold the entries.approve permission. */
export interface Preparer { id: string | null; name: string; mayApprove: boolean }

/** May this person's own voucher be approved as it is made? */
export function approvesOwn(db: Db, who: Preparer): boolean {
  return who.mayApprove && readSetting(db, 'separate_duties') !== '1';
}

export function setVouchersNeedApproval(db: Db, on: boolean, user: string): void {
  transaction(db, () => {
    writeSetting(db, NEED_APPROVAL, on ? '1' : '0');
    // switched off: what was waiting or rejected is a plain draft again, checked and approved the usual way (the
    // rejection and its reason stay in the audit log)
    if (!on) db.prepare("DELETE FROM voucher_approvals WHERE state <> 'approved'").run();
    audit(db, user, 'update', 'settings', NEED_APPROVAL, { vouchersNeedApproval: on });
  });
}

export function waitingVouchers(db: Db): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM voucher_approvals va JOIN entries e ON e.id = va.entry_id WHERE va.state = 'waiting' AND e.status <> 'approved'").get() as { n: number }).n);
}

/**
 * A draft just made or changed through the vouchers screen: with the setting on it waits for approval (again, when it
 * had been rejected) unless whoever wrote it may approve vouchers; otherwise it is a plain draft. Callers that say
 * nothing about who prepares (the features' own drafts) leave it as it is. Call inside the transaction that wrote it.
 */
function markPrepared(db: Db, id: string, who: Preparer | undefined): void {
  if (!who) return;
  const before = db.prepare("SELECT requested_by, requested_by_id FROM voucher_approvals WHERE entry_id = ? AND state <> 'approved'").get(id) as
    { requested_by: string; requested_by_id: string | null } | undefined;
  db.prepare("DELETE FROM voucher_approvals WHERE entry_id = ? AND state <> 'approved'").run(id);
  if (!vouchersNeedApproval(db)) return;
  // someone who may approve and corrects a voucher that waits leaves it waiting, in its preparer's name
  if (who.mayApprove && !before) return;
  const asked = who.mayApprove && before ? { name: before.requested_by, id: before.requested_by_id } : { name: who.name, id: who.id };
  db.prepare("INSERT INTO voucher_approvals (entry_id, state, requested_by, requested_by_id, requested_at) VALUES (?, 'waiting', ?, ?, ?)")
    .run(id, asked.name, asked.id, new Date().toISOString());
  audit(db, who.name, 'request_approval', 'entry', id);
}

/** Numbers and approves a draft its preparer may approve themselves. Call inside a transaction. */
function approveOwn(db: Db, id: string, type: EntryType, date: string, who: Preparer): void {
  const now = new Date().toISOString();
  const number = nextNumber(db, type, date);
  db.prepare(`UPDATE entries SET status = 'approved', number = ?, checked_by = ?, checked_at = ?, checked_by_id = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
    .run(number, who.name, now, who.id, who.name, now, now, id);
  audit(db, who.name, 'approve', 'entry', id, { number, own: true, approvedAt: now });
}

/** With the setting on, a new voucher of someone who may approve vouchers is approved as it is made. */
const approvedAtOnce = (db: Db, who: Preparer | undefined): who is Preparer => !!who && vouchersNeedApproval(db) && approvesOwn(db, who);

export type EntrySummary = Omit<EntryView, 'lines' | 'actions' | 'invoiceId' | 'stockDocId'>;

const isInvoiceType = (type: EntryType) => DOCUMENT_ENTRY_TYPES.includes(type);

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

/** "Separate duties" (a Pro setting): the one who prepared a voucher can neither check nor approve it. */
function assertNotPreparer(db: Db, row: EntryRow, actorId: string | null | undefined): void {
  if (actorId && row.prepared_by_id === actorId && readSetting(db, 'separate_duties') === '1') throw conflict('same_person');
}

/**
 * A receipt or payment that a document makes (an installment collected): checked like any voucher, then numbered and
 * approved at once by whoever made it, as invoices post their entries. Call inside a transaction.
 */
export function postVoucherNow(db: Db, v: VoucherInput, actor: { id: string | null; name: string }): string {
  const entry = assertValidVoucher(db, v);
  const id = insertEntry(db, entry, actor.name, v.cashAccountCode);
  const now = new Date().toISOString();
  db.prepare(`UPDATE entries SET status = 'approved', number = ?, prepared_by_id = ?, checked_by = ?, checked_at = ?, checked_by_id = ?,
              approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
    .run(nextNumber(db, entry.type, entry.date), actor.id, actor.name, now, actor.id, actor.name, now, now, id);
  audit(db, actor.name, 'post', 'entry', id, { type: entry.type });
  return id;
}

export function createJournalEntry(db: Db, input: Omit<EntryInput, 'type'>, user: string, actorId?: string | null, who?: Preparer): EntryView {
  const entry: EntryInput = { ...input, type: 'journal' };
  assertValid(db, entry);
  const id = transaction(db, () => {
    const newId = insertEntry(db, entry, user, null);
    if (actorId) db.prepare('UPDATE entries SET prepared_by_id = ? WHERE id = ?').run(actorId, newId);
    audit(db, user, 'create', 'entry', newId, { type: 'journal' });
    if (approvedAtOnce(db, who)) approveOwn(db, newId, 'journal', entry.date, who);
    else markPrepared(db, newId, who);
    return newId;
  });
  return getEntry(db, id);
}

/**
 * `who` (the vouchers screen and the quick forms give it): with "Vouchers need approval" on, the voucher waits for
 * approval, or is approved at once when its preparer may approve vouchers. `now`: approve it at once whatever the
 * setting says; the caller has checked that this person may (quick-vouchers.ts).
 */
export function createVoucher(db: Db, v: VoucherInput, user: string, actorId?: string | null, who?: Preparer, now = false): EntryView {
  const entry = assertValidVoucher(db, v);
  const id = transaction(db, () => {
    const newId = insertEntry(db, entry, user, v.cashAccountCode);
    if (actorId) db.prepare('UPDATE entries SET prepared_by_id = ? WHERE id = ?').run(actorId, newId);
    audit(db, user, 'create', 'entry', newId, { type: v.kind });
    if (who && (now || approvedAtOnce(db, who))) approveOwn(db, newId, v.kind, entry.date, who);
    else markPrepared(db, newId, who);
    return newId;
  });
  return getEntry(db, id);
}

function loadRow(db: Db, id: string): EntryRow {
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as unknown as EntryRow | undefined;
  if (!row) throw notFound('entry');
  return row;
}

/**
 * The feature an entry belongs to, if any. Such an entry is edited, deleted and reversed only from that feature's page,
 * which keeps its own records (stock, cheques, the asset register, payroll and generator months, deposits) in step with
 * the books. Receipts and payments that features post at once (installments, collections, deposits taken, payroll
 * payments, advances) are not listed: those features count a reversed voucher as taken back.
 */
const ENTRY_OWNERS: readonly { owner: string; sql: string; marks: number }[] = [
  { owner: 'adjustment', sql: 'SELECT 1 FROM stock_adjustments WHERE entry_id = ?', marks: 1 },
  { owner: 'cheque', sql: 'SELECT 1 FROM cheques WHERE entry_id = ? OR clear_entry_id = ? OR bounce_entry_id = ?', marks: 3 },
  { owner: 'depreciation', sql: 'SELECT 1 FROM depreciation_runs WHERE entry_id = ?', marks: 1 },
  { owner: 'disposal', sql: 'SELECT 1 FROM fixed_assets WHERE disposal_entry_id = ?', marks: 1 },
  { owner: 'payroll', sql: 'SELECT 1 FROM payroll_runs WHERE entry_id = ?', marks: 1 },
  { owner: 'generator_run', sql: 'SELECT 1 FROM gen_runs WHERE entry_id = ?', marks: 1 },
  { owner: 'deposit', sql: 'SELECT 1 FROM re_deposits WHERE close_entry_id = ?', marks: 1 }
];

export function entryOwner(db: Db, id: string): string | null {
  for (const o of ENTRY_OWNERS) {
    if (db.prepare(o.sql).get(...Array.from({ length: o.marks }, () => id))) return o.owner;
  }
  return null;
}

/**
 * The voucher of an online payment (website API) keeps the amount the shop was paid: it is checked, approved, rejected
 * (deleted while a draft) or reversed here, but never edited, so the payment kept with the order always matches it.
 */
function editOwner(db: Db, id: string): string | null {
  return db.prepare("SELECT 1 FROM invoice_payments WHERE entry_id = ? AND kind = 'online'").get(id) ? 'online_payment' : null;
}

/** Actions that change an entry's lines or take it out of the books: for an owned entry, only its feature does them. */
const OWNER_ONLY: readonly EntryAction[] = ['edit', 'delete', 'reverse'];

/**
 * What may be done with an entry. Documents are corrected from the document; a closing entry only by reopening the year;
 * an entry a feature owns is checked, returned and approved here but changed only from that feature.
 */
function actionsOf(db: Db, row: EntryRow): EntryAction[] {
  let actions = allowedActions(row.status, { reversed: !!row.reversed_by_id, isReversal: row.type === 'reversal', fromInvoice: isInvoiceType(row.type) || row.type === 'closing' });
  if (row.status !== 'approved' && actions.length) {
    // waiting for approval: changed or deleted by its preparer, approved or rejected by someone who may; a rejected
    // one is changed (and so sent again) or deleted
    const state = approvalOf(db, row.id)?.state;
    if (state === 'waiting') actions = ['edit', 'delete', 'approve_waiting', 'reject'];
    else if (state === 'rejected') actions = ['edit', 'delete'];
  }
  if (actions.includes('edit') && editOwner(db, row.id)) return actions.filter((a) => a !== 'edit');
  if (!actions.some((a) => OWNER_ONLY.includes(a)) || !entryOwner(db, row.id)) return actions;
  return actions.filter((a) => !OWNER_ONLY.includes(a));
}

function requireAction(db: Db, row: EntryRow, action: EntryAction): void {
  if (OWNER_ONLY.includes(action)) {
    const owner = entryOwner(db, row.id) ?? (action === 'edit' ? editOwner(db, row.id) : null);
    if (owner) throw conflict(`entry_belongs_to_${owner}`);
  }
  if (!actionsOf(db, row).includes(action)) throw conflict('action_not_allowed', { status: row.status, action });
}

/** Replaces a draft journal entry. */
export function updateJournalEntry(db: Db, id: string, input: Omit<EntryInput, 'type'>, user: string, actorId?: string | null, who?: Preparer): EntryView {
  const row = loadRow(db, id);
  if (row.type !== 'journal') throw conflict('wrong_entry_type');
  requireAction(db, row, 'edit');
  const entry: EntryInput = { ...input, type: 'journal' };
  assertValid(db, entry);
  transaction(db, () => {
    replaceDraft(db, id, entry, null, user, actorId);
    audit(db, user, 'update', 'entry', id);
    markPrepared(db, id, who);
  });
  return getEntry(db, id);
}

/** Replaces a draft receipt/payment voucher. */
export function updateVoucher(db: Db, id: string, v: VoucherInput, user: string, actorId?: string | null, who?: Preparer): EntryView {
  const row = loadRow(db, id);
  if (row.type !== v.kind) throw conflict('wrong_entry_type');
  requireAction(db, row, 'edit');
  const entry = assertValidVoucher(db, v);
  transaction(db, () => {
    replaceDraft(db, id, entry, v.cashAccountCode, user, actorId);
    audit(db, user, 'update', 'entry', id);
    markPrepared(db, id, who);
  });
  return getEntry(db, id);
}

function replaceDraft(db: Db, id: string, entry: EntryInput, cashAccountCode: string | null, user: string, actorId?: string | null): void {
  const now = new Date().toISOString();
  // The editor is responsible for the current draft; earlier preparation stays in the audit trail.
  db.prepare('UPDATE entries SET date = ?, description = ?, party = ?, currency = ?, rate_x100 = ?, cash_account = ?, prepared_by = ?, prepared_by_id = ?, prepared_at = ?, updated_at = ? WHERE id = ?')
    .run(entry.date, entry.description.trim(), entry.party?.trim() || null, entry.currency, entry.currency === 'IQD' ? 100 : entry.rateX100,
      cashAccountCode, user, actorId ?? null, now, now, id);
  db.prepare('DELETE FROM entry_lines WHERE entry_id = ?').run(id);
  insertLines(db, id, entry);
}

export function deleteEntry(db: Db, id: string, user: string): void {
  const row = loadRow(db, id);
  // an entry a feature owns (a payroll or generator month, a depreciation month, a disposal, a deposit's refund, a
  // cheque's step, a stock adjustment) is taken back from that feature's page, which unlinks it before deleting it
  requireAction(db, row, 'delete');
  // a draft matched to a bank statement line is unmatched on the reconciliation page first
  if (db.prepare('SELECT 1 FROM bank_statement_lines WHERE entry_id = ?').get(id)) throw conflict('entry_matched_to_statement');
  transaction(db, () => {
    // a rejected online payment stays with its order, without a voucher: it no longer counts as paid, and the same
    // reference from the shop again gives it back rather than a new one
    const online = db.prepare("SELECT id FROM invoice_payments WHERE entry_id = ? AND kind = 'online'").all(id) as { id: string }[];
    if (online.length) db.prepare("UPDATE invoice_payments SET entry_id = NULL WHERE entry_id = ? AND kind = 'online'").run(id);
    db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    audit(db, user, 'delete', 'entry', id, { type: row.type, ...(online.length ? { onlinePayments: online.map((p) => p.id) } : {}) });
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
export function checkEntry(db: Db, id: string, user: string, actorId?: string | null): EntryView {
  const row = loadRow(db, id);
  requireAction(db, row, 'check');
  assertNotPreparer(db, row, actorId);
  revalidateStored(db, id);
  transaction(db, () => {
    const now = new Date().toISOString();
    db.prepare("UPDATE entries SET status = 'checked', checked_by = ?, checked_by_id = ?, checked_at = ?, updated_at = ? WHERE id = ?").run(user, actorId ?? null, now, now, id);
    audit(db, user, 'check', 'entry', id);
  });
  return getEntry(db, id);
}

/** Sends a checked entry back to the preparer. */
export function returnEntry(db: Db, id: string, user: string): EntryView {
  const row = loadRow(db, id);
  requireAction(db, row, 'return');
  transaction(db, () => {
    db.prepare("UPDATE entries SET status = 'draft', checked_by = NULL, checked_by_id = NULL, checked_at = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    audit(db, user, 'return', 'entry', id);
  });
  return getEntry(db, id);
}

export function nextNumber(db: Db, type: EntryType, date: string): string {
  const year = yearOf(date);
  return entryNumber(type, year, nextSequence(db, `${type}:${year}`));
}

/** المصادق: checked → approved (posted). The voucher number is assigned now, so posted numbers have no gaps. */
export function approveEntry(db: Db, id: string, user: string, actorId?: string | null): EntryView {
  const row = loadRow(db, id);
  requireAction(db, row, 'approve');
  assertNotPreparer(db, row, actorId);
  revalidateStored(db, id);
  transaction(db, () => {
    const now = new Date().toISOString();
    const number = nextNumber(db, row.type, row.date);
    db.prepare("UPDATE entries SET status = 'approved', number = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?").run(number, user, now, now, id);
    audit(db, user, 'approve', 'entry', id, { number });
  });
  return getEntry(db, id);
}

/**
 * A voucher that waits for approval is approved by someone who may approve vouchers (the route asks for the
 * entries.approve permission; `mayApprove` is checked again here): numbered and posted now, with who approved it and
 * when kept on the voucher, on its approval record and in the audit log.
 */
export function approveWaiting(db: Db, id: string, actor: Preparer): EntryView {
  if (!actor.mayApprove) throw new AppError(403, 'forbidden', { need: 'entries.approve' });
  const row = loadRow(db, id);
  requireAction(db, row, 'approve_waiting');
  assertNotPreparer(db, row, actor.id);
  revalidateStored(db, id);
  transaction(db, () => {
    const now = new Date().toISOString();
    const number = nextNumber(db, row.type, row.date);
    db.prepare(`UPDATE entries SET status = 'approved', number = ?, checked_by = COALESCE(checked_by, ?), checked_at = COALESCE(checked_at, ?),
                approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`).run(number, actor.name, now, actor.name, now, now, id);
    db.prepare("UPDATE voucher_approvals SET state = 'approved', decided_by = ?, decided_by_id = ?, decided_at = ?, reason = NULL WHERE entry_id = ?")
      .run(actor.name, actor.id, now, id);
    audit(db, actor.name, 'approve', 'entry', id, { number, preparedBy: row.prepared_by, waited: true, approvedAt: now });
  });
  return getEntry(db, id);
}

export const MAX_REJECT_REASON = 300;

/** A voucher that waits for approval is sent back with the reason: it stays a draft, out of every balance. */
export function rejectWaiting(db: Db, id: string, reason: string, actor: Preparer): EntryView {
  if (!actor.mayApprove) throw new AppError(403, 'forbidden', { need: 'entries.approve' });
  const why = typeof reason === 'string' ? reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
  if (!why || why.length > MAX_REJECT_REASON) throw invalid([{ code: 'reject_reason_required' }]);
  const row = loadRow(db, id);
  requireAction(db, row, 'reject');
  transaction(db, () => {
    const now = new Date().toISOString();
    db.prepare("UPDATE entries SET status = 'draft', checked_by = NULL, checked_by_id = NULL, checked_at = NULL, updated_at = ? WHERE id = ?").run(now, id);
    db.prepare("UPDATE voucher_approvals SET state = 'rejected', decided_by = ?, decided_by_id = ?, decided_at = ?, reason = ? WHERE entry_id = ?")
      .run(actor.name, actor.id, now, why, id);
    audit(db, actor.name, 'reject', 'entry', id, { reason: why, preparedBy: row.prepared_by, rejectedAt: now });
  });
  return getEntry(db, id);
}

/** Corrects a posted entry with an opposite entry (قيد عكسي). Both stay in the books. */
export function reverseEntry(db: Db, id: string, user: string, date?: string): EntryView {
  requireAction(db, loadRow(db, id), 'reverse');
  return getEntry(db, reverseEntryInternal(db, id, user, date));
}

/**
 * Creates and posts the reversal of a posted entry; also used when an invoice is cancelled. Returns the reversal's id.
 * A reversal is never dated before the entry it reverses (the books would show the correction before the mistake);
 * with no date it is today, or the entry's own date when that is still ahead.
 */
export function reverseEntryInternal(db: Db, id: string, user: string, date?: string): string {
  const original = getEntry(db, id);
  if (original.status !== 'approved' || original.reversedById) throw conflict('action_not_allowed', { status: original.status, action: 'reverse' });
  const today = todayIso();
  const reversalDate = date ?? (today < original.date ? original.date : today);
  if (!isIsoDate(reversalDate)) throw invalid([{ code: 'date_invalid' }]);
  if (reversalDate < original.date) throw invalid([{ code: 'reversal_before_entry' }]);
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

function toView(db: Db, row: EntryRow, lines: LineRow[], invoiceId: string | null = null, stockDocId: string | null = null, withActions = true, approval: VoucherApproval | null = null): EntryView {
  const view: EntryView = {
    id: row.id, type: row.type, number: row.number, date: row.date, description: row.description, party: row.party,
    currency: row.currency, rateX100: row.rate_x100, status: row.status, cashAccountCode: row.cash_account,
    reversesId: row.reverses_id, reversedById: row.reversed_by_id,
    preparedBy: row.prepared_by, preparedById: row.prepared_by_id, preparedAt: row.prepared_at, checkedBy: row.checked_by, checkedAt: row.checked_at,
    approvedBy: row.approved_by, approvedAt: row.approved_at,
    total: lines.reduce((s, l) => s + l.debit, 0),
    baseTotal: lines.reduce((s, l) => s + l.base_debit, 0),
    lines: lines.map((l) => ({
      lineNo: l.line_no, accountCode: l.account_code, accountName: { ar: l.name_ar, en: l.name_en, ku: l.name_ku },
      debit: l.debit, credit: l.credit, baseDebit: l.base_debit, baseCredit: l.base_credit, description: l.description ?? '',
      partyId: l.party_id, partyName: l.party_name
    })),
    actions: withActions ? actionsOf(db, row) : [],
    invoiceId,
    stockDocId,
    approval
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
  const doc = invoice ? undefined : db.prepare('SELECT id FROM stock_docs WHERE entry_id = ? OR cancel_entry_id = ?').get(id, id) as { id: string } | undefined;
  return toView(db, row, db.prepare(LINES_SQL).all(id) as unknown as LineRow[], invoice?.id ?? null, doc?.id ?? null, true, approvalOf(db, id));
}

export interface EntryFilters {
  type?: EntryType | undefined;
  status?: EntryStatus | undefined;
  /** 1.4: only vouchers that wait for approval, or that were rejected */
  approval?: 'waiting' | 'rejected' | undefined;
  from?: string | undefined;
  to?: string | undefined;
  q?: string | undefined;
  limit?: number | undefined;
  /** 1.4: only the receipt and payment vouchers this user prepared (someone who does not keep the books: cost-view.ts) */
  ownVouchersOf?: string | undefined;
}

/** Whether this is a receipt or payment voucher this user prepared (and nobody else has prepared again since). */
export function isOwnVoucher(db: Db, id: string, userId: string): boolean {
  return !!db.prepare("SELECT 1 FROM entries WHERE id = ? AND prepared_by_id = ? AND type IN ('receipt', 'payment')").get(id, userId);
}

export function listEntries(db: Db, f: EntryFilters = {}): EntrySummary[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.type) { where.push('e.type = ?'); params.push(f.type); }
  if (f.status) { where.push('e.status = ?'); params.push(f.status); }
  if (f.approval) { where.push("va.state = ? AND e.status <> 'approved'"); params.push(f.approval); }
  if (f.ownVouchersOf) { where.push("e.prepared_by_id = ? AND e.type IN ('receipt', 'payment')"); params.push(f.ownVouchersOf); }
  if (f.from) { where.push('e.date >= ?'); params.push(f.from); }
  if (f.to) { where.push('e.date <= ?'); params.push(f.to); }
  if (f.q) {
    where.push("(LOWER(e.description) LIKE ? OR LOWER(IFNULL(e.party, '')) LIKE ? OR LOWER(IFNULL(e.number, '')) LIKE ?)");
    const like = `%${f.q.toLowerCase()}%`;
    params.push(like, like, like);
  }
  const sql = `SELECT e.*, (SELECT SUM(debit) FROM entry_lines WHERE entry_id = e.id) AS total,
                      (SELECT SUM(base_debit) FROM entry_lines WHERE entry_id = e.id) AS base_total, ${APPROVAL_COLUMNS}
               FROM entries e LEFT JOIN voucher_approvals va ON va.entry_id = e.id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY e.date DESC, e.prepared_at DESC LIMIT ?`;
  params.push(f.limit ?? 500);
  const found = db.prepare(sql).all(...params) as unknown as (EntryRow & ApprovalRow & { total: number; base_total: number })[];
  return found.map((row) => {
    const { lines: _lines, actions: _actions, invoiceId: _invoiceId, stockDocId: _stockDocId, ...summary } = toView(db, row, [], null, null, false, toApproval(row));
    return { ...summary, total: row.total ?? 0, baseTotal: row.base_total ?? 0 };
  });
}

/** Lines of approved entries in IQD — the input for every report. */
export function postedLines(
  db: Db, opts: { to?: string; partyId?: string; branch?: { warehouses: string[]; accounts: string[] } | null } = {}
): (PostedLine & { partyId: string | null; currency: CurrencyCode; ownDebit: number; ownCredit: number; approvedAt: string | null })[] {
  const where = ["e.status = 'approved'"];
  const params: string[] = [];
  if (opts.to) { where.push('e.date <= ?'); params.push(opts.to); }
  if (opts.partyId) { where.push('l.party_id = ?'); params.push(opts.partyId); }
  // one branch's entries only (branches.ts), for a user limited to branches
  if (opts.branch) {
    const [sql, p] = entryInBranchSql('e', opts.branch);
    where.push(sql.replace(/^ AND /, ''));
    params.push(...p);
  }
  const rows = db.prepare(`SELECT e.id, e.number, e.date, e.currency, e.approved_at, l.debit, l.credit, l.account_code, l.base_debit, l.base_credit, l.party_id,
                                  COALESCE(l.description, e.description) AS description,
                                  (e.type = 'closing' OR (e.type = 'reversal' AND EXISTS (SELECT 1 FROM entries c WHERE c.id = e.reverses_id AND c.type = 'closing'))) AS closing
                           FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                           WHERE ${where.join(' AND ')}
                           ORDER BY e.date, e.number, l.line_no`).all(...params) as {
    id: string; number: string; date: string; currency: CurrencyCode; debit: number; credit: number; account_code: string; base_debit: number; base_credit: number;
    party_id: string | null; description: string; closing: number; approved_at: string | null;
  }[];
  // debit/credit: IQD at the entry's rate (the books); ownDebit/ownCredit: in the entry's own currency (1.1).
  // The rows come by date and entry number; approvedAt lets a party's statement put a day in the order it happened.
  return rows.map((r) => ({
    entryId: r.id, number: r.number, date: r.date, accountCode: r.account_code, debit: r.base_debit, credit: r.base_credit,
    description: r.description, partyId: r.party_id, currency: r.currency, ownDebit: Number(r.debit), ownCredit: Number(r.credit),
    approvedAt: r.approved_at ?? null,
    ...(r.closing ? { closing: true } : {})
  }));
}
