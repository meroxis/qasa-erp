import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { todayIso, type CurrencyCode, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { createAccount, loadAccounts } from './accounts.ts';
import { createJournalEntry, createVoucher, deleteEntry, getEntry, reverseEntryInternal, type EntryView } from './journal.ts';
import { planStatus } from './license.ts';
import { readSetting, writeSetting } from './settings.ts';
import type { Actor } from './auth.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Banking: the company's safes (181…), bank accounts and e-wallets (183…), moving money between them, cheques
 * (الصكوك) and, on Pro, reconciling a bank account with the bank's statement.
 *
 * Every entry made here is a DRAFT that follows the preparer → checker → approver chain like a voucher typed by hand;
 * nothing is posted behind the approver's back. A cheque's next step (clearing, bouncing) waits until the entry of the
 * step before it is approved, so the books never run ahead of the approvals.
 *
 * Cheques received: Dr notes receivable (أوراق القبض, 162 — added under 16 the first time it is needed), Cr the customer.
 * Clearing: Dr the bank, Cr notes receivable (a receipt voucher on the bank). Bouncing: Dr the customer, Cr notes
 * receivable (the customer owes again), with an optional bounce fee charged to the customer.
 * Cheques written: Dr the supplier, Cr notes payable (262). Clearing: Dr notes payable, Cr the bank (a payment voucher).
 * Cancelling a cheque that was never cleared makes the opposite entry (or deletes it while it is still a draft).
 */

type Money = Record<CurrencyCode, number>;
const zero = (): Money => ({ IQD: 0, USD: 0 });
const num = (v: unknown) => Number(v ?? 0);

// ——— accounts: safes, banks, wallets ———

export const WALLET_KINDS = ['bank', 'zaincash', 'fib', 'qi', 'asiahawala', 'wallet'] as const;
export type MoneyKind = 'safe' | (typeof WALLET_KINDS)[number];

interface AccountMeta { kind: MoneyKind; currency: CurrencyCode | null }

const META_KEY = 'banking_accounts';

function metaMap(db: Db): Record<string, AccountMeta> {
  try {
    const parsed = JSON.parse(readSetting(db, META_KEY) ?? '{}') as Record<string, AccountMeta>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export interface MoneyAccountView {
  code: string;
  name: Names;
  /** safe (181…), bank (183…) or the kind of e-wallet */
  kind: MoneyKind;
  /** the currency the account is meant for, when set (balances are kept per currency anyway) */
  currency: CurrencyCode | null;
  /** approved entries only, in each currency (debit positive) */
  balance: Money;
  /** the same in dinars at the rates booked */
  base: number;
  /** drafts and checked entries not yet approved that touch it */
  pending: number;
}

/** The postable cash accounts (under 18), with their balances by currency. */
export function moneyAccounts(db: Db): MoneyAccountView[] {
  const meta = metaMap(db);
  const accounts = loadAccounts(db).filter((a) => a.postable && a.code.startsWith('18'));
  const rows = db.prepare(`SELECT l.account_code AS code, e.currency, SUM(l.debit - l.credit) AS amount, SUM(l.base_debit - l.base_credit) AS base
                           FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                           WHERE e.status = 'approved' AND l.account_code LIKE '18%'
                           GROUP BY l.account_code, e.currency`).all() as { code: string; currency: CurrencyCode; amount: number; base: number }[];
  const pendingRows = db.prepare(`SELECT l.account_code AS code, COUNT(DISTINCT e.id) AS n
                                  FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                                  WHERE e.status IN ('draft', 'checked') AND l.account_code LIKE '18%'
                                  GROUP BY l.account_code`).all() as { code: string; n: number }[];
  const pending = new Map(pendingRows.map((r) => [r.code, num(r.n)]));
  return accounts.map((a) => {
    const balance = zero();
    let base = 0;
    for (const r of rows) {
      if (r.code !== a.code) continue;
      balance[r.currency] += num(r.amount);
      base += num(r.base);
    }
    const m = meta[a.code];
    const kind: MoneyKind = m?.kind ?? (a.code.startsWith('183') ? 'bank' : 'safe');
    return { code: a.code, name: a.name, kind, currency: m?.currency ?? null, balance, base, pending: pending.get(a.code) ?? 0 };
  });
}

function isMoneyAccount(db: Db, code: string): boolean {
  return loadAccounts(db).some((a) => a.code === code && a.postable && a.code.startsWith('18'));
}

/** Adds a bank account or e-wallet under 183 (the next free code: 1833, 1834 … then 18310 …). */
export function addMoneyAccount(db: Db, input: { name: Names; kind: (typeof WALLET_KINDS)[number]; currency?: CurrencyCode | null | undefined }, actor: Actor): MoneyAccountView {
  if (!input.name.ar.trim() && !input.name.en.trim() && !input.name.ku.trim()) throw invalid([{ code: 'name_required' }]);
  const children = loadAccounts(db).filter((a) => a.parentCode === '183').map((a) => Number(a.code.slice(3))).filter((n) => Number.isSafeInteger(n));
  const next = children.length ? Math.max(...children) + 1 : 1;
  const code = `183${next}`;
  return transaction(db, () => {
    createAccount(db, { parentCode: '183', code, name: input.name }, actor.name);
    const meta = metaMap(db);
    meta[code] = { kind: input.kind, currency: input.currency ?? null };
    writeSetting(db, META_KEY, JSON.stringify(meta));
    audit(db, actor.name, 'create', 'bank_account', code, { kind: input.kind, currency: input.currency ?? null });
    return moneyAccounts(db).find((a) => a.code === code)!;
  });
}

/** Marks an existing cash account as a safe, a bank or a kind of wallet (and its currency). */
export function setMoneyAccountMeta(db: Db, code: string, input: AccountMeta, actor: Actor): MoneyAccountView {
  if (!isMoneyAccount(db, code)) throw notFound('account');
  const meta = metaMap(db);
  meta[code] = { kind: input.kind, currency: input.currency };
  writeSetting(db, META_KEY, JSON.stringify(meta));
  audit(db, actor.name, 'update', 'bank_account', code, input);
  return moneyAccounts(db).find((a) => a.code === code)!;
}

// ——— transfers ———

export interface TransferInput {
  date: string;
  from: string;
  to: string;
  currency: CurrencyCode;
  rateX100?: number | undefined;
  amount: number;
  /** a bank charge taken from the account the money leaves */
  charge?: number | undefined;
  chargeAccount?: string | undefined;
  description?: string | undefined;
  lang?: BankLang | undefined;
}

const DEFAULT_CHARGE_ACCOUNT = '39';

function postableExpense(db: Db, code: string): boolean {
  return loadAccounts(db).some((a) => a.code === code && a.postable && a.code.startsWith('3'));
}

/**
 * Money from one safe/bank/wallet to another, in one currency (an exchange between dinars and dollars is a receipt and
 * a payment voucher, as before). A draft journal entry: Dr the account it goes to, Cr the account it leaves; the charge
 * Dr the charges account, Cr the account it leaves.
 */
export function transfer(db: Db, input: TransferInput, actor: Actor): EntryView {
  const errors: { code: string; field?: string }[] = [];
  if (!isMoneyAccount(db, input.from)) errors.push({ code: 'bk_account_invalid', field: 'from' });
  if (!isMoneyAccount(db, input.to)) errors.push({ code: 'bk_account_invalid', field: 'to' });
  if (input.from === input.to) errors.push({ code: 'bk_same_account' });
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) errors.push({ code: 'amount_invalid' });
  const charge = input.charge ?? 0;
  if (!Number.isSafeInteger(charge) || charge < 0) errors.push({ code: 'amount_invalid', field: 'charge' });
  const chargeAccount = input.chargeAccount ?? DEFAULT_CHARGE_ACCOUNT;
  if (charge > 0 && !postableExpense(db, chargeAccount)) errors.push({ code: 'bk_charge_account_invalid' });
  if (input.currency === 'USD' && (!input.rateX100 || input.rateX100 <= 0)) errors.push({ code: 'rate_invalid' });
  if (errors.length) throw invalid(errors);
  const w = words(input.lang);
  const description = input.description?.trim() || w.transfer;
  const lines: { accountCode: string; debit: number; credit: number; description?: string }[] = [
    { accountCode: input.to, debit: input.amount, credit: 0 },
    { accountCode: input.from, debit: 0, credit: input.amount }
  ];
  if (charge > 0) {
    lines.push({ accountCode: chargeAccount, debit: charge, credit: 0, description: w.charge });
    lines.push({ accountCode: input.from, debit: 0, credit: charge, description: w.charge });
  }
  return transaction(db, () => {
    const entry = createJournalEntry(db, {
      date: input.date, description, currency: input.currency, rateX100: input.currency === 'IQD' ? 100 : input.rateX100!, lines
    }, actor.name, actor.id);
    audit(db, actor.name, 'transfer', 'bank_account', input.from, { to: input.to, amount: input.amount, currency: input.currency, entryId: entry.id });
    return entry;
  });
}

// ——— cheques ———

export const NOTES_RECEIVABLE = '162';
export const NOTES_PAYABLE = '262';
const NR_NAMES: Names = { ar: 'أوراق القبض', en: 'Notes receivable', ku: 'بەڵگەنامەکانی وەرگرتن' };

/**
 * Notes receivable (أوراق القبض, 162 in the unified chart). New and older companies alike get it the first time a
 * cheque is received, as a standard account under 16 — unless 16 itself already holds entries (then it can't take a
 * sub-account and the company's accountant has to choose another: setting banking_notes_receivable).
 */
export function notesReceivable(db: Db, user: string): string {
  const chosen = readSetting(db, 'banking_notes_receivable');
  const accounts = loadAccounts(db);
  const postable = (code: string) => accounts.some((a) => a.code === code && a.postable);
  if (chosen && postable(chosen)) return chosen;
  if (postable(NOTES_RECEIVABLE)) return NOTES_RECEIVABLE;
  if (accounts.some((a) => a.code === NOTES_RECEIVABLE)) throw conflict('bk_notes_receivable_missing');
  if (!accounts.some((a) => a.code === '16')) throw conflict('bk_notes_receivable_missing');
  if (db.prepare('SELECT 1 FROM entry_lines WHERE account_code = ? LIMIT 1').get('16')) throw conflict('bk_notes_receivable_missing');
  db.prepare('INSERT INTO accounts (code, name_ar, name_en, name_ku, "system", created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(NOTES_RECEIVABLE, NR_NAMES.ar, NR_NAMES.en, NR_NAMES.ku, new Date().toISOString());
  audit(db, user, 'create', 'account', NOTES_RECEIVABLE, { name: NR_NAMES, standard: true });
  return NOTES_RECEIVABLE;
}

function notesPayable(db: Db): string {
  const chosen = readSetting(db, 'banking_notes_payable');
  const accounts = loadAccounts(db);
  const postable = (code: string) => accounts.some((a) => a.code === code && a.postable);
  if (chosen && postable(chosen)) return chosen;
  if (postable(NOTES_PAYABLE)) return NOTES_PAYABLE;
  throw conflict('bk_notes_payable_missing');
}

export type ChequeDirection = 'received' | 'issued';
export type ChequeStatus = 'in_hand' | 'deposited' | 'cleared' | 'bounced' | 'cancelled' | 'pending';
export type ChequeAction = 'deposit' | 'clear' | 'bounce' | 'cancel' | 'undo';

interface ChequeRow {
  id: string; direction: ChequeDirection; number: string; bank: string; party_id: string; currency: CurrencyCode; amount: number;
  issue_date: string; due_date: string; status: ChequeStatus; bank_account: string | null; entry_id: string | null;
  clear_entry_id: string | null; bounce_entry_id: string | null; notes: string | null; created_by: string; created_at: string; updated_at: string;
}

export interface ChequeView {
  id: string;
  direction: ChequeDirection;
  number: string;
  bank: string;
  party: { id: string; name: string; phone: string | null };
  currency: CurrencyCode;
  amount: number;
  issueDate: string;
  dueDate: string;
  /** days until due (negative: overdue) */
  daysToDue: number;
  status: ChequeStatus;
  bankAccount: { code: string; name: Names } | null;
  entry: { id: string; number: string | null; status: string; date: string } | null;
  clearEntry: { id: string; number: string | null; status: string; date: string } | null;
  bounceEntry: { id: string; number: string | null; status: string; date: string } | null;
  notes: string;
  createdBy: string;
  createdAt: string;
  actions: ChequeAction[];
}

const DAY = 86_400_000;
const daysBetweenIso = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY);

/** A cheque's entry, with its date (an undo's reversal is never dated before it). */
function entryRef(db: Db, id: string | null): { id: string; number: string | null; status: string; date: string } | null {
  if (!id) return null;
  const r = db.prepare('SELECT id, number, status, date FROM entries WHERE id = ?').get(id) as { id: string; number: string | null; status: string; date: string } | undefined;
  return r ? { id: r.id, number: r.number, status: r.status, date: r.date } : null;
}

/** Approved and still standing (a reversed entry no longer carries the cheque's step). */
const approved = (db: Db, id: string | null) => !!id && (db.prepare("SELECT 1 FROM entries WHERE id = ? AND status = 'approved' AND reversed_by_id IS NULL").get(id) !== undefined);

function actionsFor(db: Db, r: ChequeRow): ChequeAction[] {
  const ready = approved(db, r.entry_id);
  if (r.direction === 'received') {
    if (r.status === 'in_hand') return ready ? ['deposit', 'clear', 'bounce', 'cancel'] : ['cancel'];
    if (r.status === 'deposited') return ready ? ['clear', 'bounce'] : [];
    return canUndo(db, r) ? ['undo'] : [];
  }
  if (r.status === 'pending') return ready ? ['clear', 'cancel'] : ['cancel'];
  return canUndo(db, r) ? ['undo'] : [];
}

function toView(db: Db, r: ChequeRow, today = todayIso()): ChequeView {
  const party = db.prepare('SELECT id, name, phone FROM parties WHERE id = ?').get(r.party_id) as { id: string; name: string; phone: string | null };
  const account = r.bank_account ? loadAccounts(db).find((a) => a.code === r.bank_account) : undefined;
  return {
    id: r.id, direction: r.direction, number: r.number, bank: r.bank, party: { id: party.id, name: party.name, phone: party.phone },
    currency: r.currency, amount: num(r.amount), issueDate: r.issue_date, dueDate: r.due_date, daysToDue: daysBetweenIso(today, r.due_date),
    status: r.status, bankAccount: account ? { code: account.code, name: account.name } : null,
    entry: entryRef(db, r.entry_id), clearEntry: entryRef(db, r.clear_entry_id), bounceEntry: entryRef(db, r.bounce_entry_id),
    notes: r.notes ?? '', createdBy: r.created_by, createdAt: r.created_at, actions: actionsFor(db, r)
  };
}

function loadCheque(db: Db, id: string): ChequeRow {
  const r = db.prepare('SELECT * FROM cheques WHERE id = ?').get(id) as ChequeRow | undefined;
  if (!r) throw notFound('cheque');
  return r;
}

export function getCheque(db: Db, id: string): ChequeView {
  return toView(db, loadCheque(db, id));
}

export interface ChequeFilters {
  direction?: ChequeDirection | undefined;
  status?: ChequeStatus | 'open' | undefined;
  due?: 'today' | 'week' | 'overdue' | undefined;
  partyId?: string | undefined;
  q?: string | undefined;
}

const OPEN_STATUSES = ['in_hand', 'deposited', 'pending'];

export function listCheques(db: Db, f: ChequeFilters = {}): ChequeView[] {
  const where: string[] = [];
  const params: string[] = [];
  const today = todayIso();
  if (f.direction) { where.push('c.direction = ?'); params.push(f.direction); }
  if (f.status === 'open' || f.due) where.push(`c.status IN (${OPEN_STATUSES.map(() => '?').join(', ')})`), params.push(...OPEN_STATUSES);
  else if (f.status) { where.push('c.status = ?'); params.push(f.status); }
  if (f.due === 'today') { where.push('c.due_date = ?'); params.push(today); }
  if (f.due === 'week') { where.push('c.due_date >= ? AND c.due_date <= ?'); params.push(today, new Date(Date.parse(today + 'T00:00:00Z') + 7 * DAY).toISOString().slice(0, 10)); }
  if (f.due === 'overdue') { where.push('c.due_date < ?'); params.push(today); }
  if (f.partyId) { where.push('c.party_id = ?'); params.push(f.partyId); }
  if (f.q) {
    where.push('(c.number LIKE ? OR c.bank LIKE ? OR p.name LIKE ?)');
    const like = `%${f.q}%`;
    params.push(like, like, like);
  }
  const rows = db.prepare(`SELECT c.* FROM cheques c JOIN parties p ON p.id = c.party_id
                           ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                           ORDER BY c.due_date, c.created_at LIMIT 1000`).all(...params) as unknown as ChequeRow[];
  return rows.map((r) => toView(db, r, today));
}

export interface ChequeSummary {
  /** received and not yet cleared or bounced */
  inHand: Money;
  inHandCount: number;
  /** written and not yet cleared */
  issuedPending: Money;
  issuedPendingCount: number;
  dueToday: number;
  dueThisWeek: number;
  overdue: number;
}

/** For the cheques page and the Daily Brief: what is in hand, written, and due. */
export function chequeSummary(db: Db, today = todayIso()): ChequeSummary {
  const weekEnd = new Date(Date.parse(today + 'T00:00:00Z') + 7 * DAY).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT direction, currency, due_date, amount FROM cheques WHERE status IN ('in_hand', 'deposited', 'pending')`).all() as
    { direction: ChequeDirection; currency: CurrencyCode; due_date: string; amount: number }[];
  const s: ChequeSummary = { inHand: zero(), inHandCount: 0, issuedPending: zero(), issuedPendingCount: 0, dueToday: 0, dueThisWeek: 0, overdue: 0 };
  for (const r of rows) {
    if (r.direction === 'received') { s.inHand[r.currency] += num(r.amount); s.inHandCount += 1; }
    else { s.issuedPending[r.currency] += num(r.amount); s.issuedPendingCount += 1; }
    if (r.due_date === today) s.dueToday += 1;
    if (r.due_date >= today && r.due_date <= weekEnd) s.dueThisWeek += 1;
    if (r.due_date < today) s.overdue += 1;
  }
  return s;
}

export interface ChequeAlert {
  id: string; direction: ChequeDirection; number: string; bank: string; partyId: string; party: string; phone: string;
  currency: CurrencyCode; amount: number; dueDate: string;
  /** days past its due date (0 when due today or later) */
  daysLate: number;
}

/**
 * For the Daily Brief and the home page: cheques still open (in hand, deposited or written) that fall due within the next
 * week — or are already past due — and cheques that bounced in the last 30 days.
 */
export function chequesAhead(db: Db, today = todayIso(), limit = 20): { due: ChequeAlert[]; bounced: ChequeAlert[]; dueTotal: Money } {
  const weekEnd = new Date(Date.parse(today + 'T00:00:00Z') + 7 * DAY).toISOString().slice(0, 10);
  const since = new Date(Date.parse(today + 'T00:00:00Z') - 30 * DAY).toISOString();
  const select = `SELECT c.id, c.direction, c.number, c.bank, c.party_id, p.name AS party, p.phone, c.currency, c.amount, c.due_date
                  FROM cheques c JOIN parties p ON p.id = c.party_id`;
  type Row = { id: string; direction: ChequeDirection; number: string; bank: string; party_id: string; party: string; phone: string | null; currency: CurrencyCode; amount: number; due_date: string };
  const view = (r: Row): ChequeAlert => ({
    id: r.id, direction: r.direction, number: r.number, bank: r.bank, partyId: r.party_id, party: r.party, phone: r.phone ?? '',
    currency: r.currency, amount: num(r.amount), dueDate: r.due_date,
    daysLate: r.due_date < today ? Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(r.due_date + 'T00:00:00Z')) / DAY) : 0
  });
  const due = (db.prepare(`${select} WHERE c.status IN ('in_hand', 'deposited', 'pending') AND c.due_date <= ? ORDER BY c.due_date, c.number`)
    .all(weekEnd) as Row[]).map(view);
  const bounced = (db.prepare(`${select} WHERE c.status = 'bounced' AND c.updated_at >= ? ORDER BY c.updated_at DESC`).all(since) as Row[]).map(view);
  const dueTotal = zero();
  for (const c of due) dueTotal[c.currency] += c.amount;
  return { due: due.slice(0, limit), bounced: bounced.slice(0, limit), dueTotal };
}

export interface ChequeInput {
  number: string;
  bank: string;
  partyId: string;
  currency: CurrencyCode;
  rateX100?: number | undefined;
  amount: number;
  issueDate: string;
  dueDate: string;
  /** issued cheques: the company's bank account it is drawn on */
  bankAccount?: string | undefined;
  notes?: string | undefined;
  lang?: BankLang | undefined;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const rateOf = (currency: CurrencyCode, rateX100: number | undefined) => (currency === 'IQD' ? 100 : rateX100 ?? 0);

function partyFor(db: Db, partyId: string, type: 'customer' | 'supplier'): { id: string; name: string; accountCode: string } {
  const p = db.prepare('SELECT id, name, type, account_code, active FROM parties WHERE id = ?').get(partyId) as
    { id: string; name: string; type: string; account_code: string; active: number } | undefined;
  if (!p || p.type !== type) throw invalid([{ code: type === 'customer' ? 'customer_required' : 'supplier_required' }]);
  if (Number(p.active) !== 1) throw invalid([{ code: 'party_inactive' }]);
  return { id: p.id, name: p.name, accountCode: p.account_code };
}

function chequeErrors(db: Db, direction: ChequeDirection, input: ChequeInput): { code: string; field?: string }[] {
  const errors: { code: string; field?: string }[] = [];
  if (!input.number.trim()) errors.push({ code: 'bk_cheque_number_required' });
  if (!input.bank.trim()) errors.push({ code: 'bk_cheque_bank_required' });
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) errors.push({ code: 'amount_invalid' });
  if (!isDate(input.issueDate)) errors.push({ code: 'date_invalid', field: 'issueDate' });
  if (!isDate(input.dueDate)) errors.push({ code: 'date_invalid', field: 'dueDate' });
  if (isDate(input.issueDate) && isDate(input.dueDate) && input.dueDate < input.issueDate) errors.push({ code: 'bk_due_before_issue' });
  if (input.currency === 'USD' && (!input.rateX100 || input.rateX100 <= 0)) errors.push({ code: 'rate_invalid' });
  if (direction === 'issued' && (!input.bankAccount || !isMoneyAccount(db, input.bankAccount))) errors.push({ code: 'bk_account_invalid', field: 'bankAccount' });
  const duplicate = db.prepare(`SELECT 1 FROM cheques WHERE direction = ? AND number = ? AND bank = ? AND status NOT IN ('cancelled', 'bounced')`)
    .get(direction, input.number.trim(), input.bank.trim());
  if (duplicate) errors.push({ code: 'bk_cheque_duplicate' });
  return errors;
}

export type BankLang = 'ar' | 'en' | 'ku';

/** The words banking writes into entries, in the language of whoever made the step (they stay on printed vouchers). */
const WORDS: Record<BankLang, {
  transfer: string; charge: string; cheque: (n: string, bank: string) => string; cleared: string; bounced: string; fee: string; cancelled: string;
}> = {
  ar: { transfer: 'تحويل بين الحسابات', charge: 'عمولة مصرفية', cheque: (n, b) => `صك رقم ${n} — ${b}`, cleared: 'صُرف', bounced: 'مرتجع', fee: 'عمولة صك مرتجع', cancelled: 'ملغى' },
  en: { transfer: 'Transfer', charge: 'Bank charge', cheque: (n, b) => `Cheque ${n} — ${b}`, cleared: 'cleared', bounced: 'bounced', fee: 'Bounced cheque fee', cancelled: 'cancelled' },
  ku: { transfer: 'گواستنەوە لە نێوان هەژمارەکان', charge: 'کرێی بانک', cheque: (n, b) => `چەکی ژمارە ${n} — ${b}`, cleared: 'سەرف کرا', bounced: 'گەڕایەوە', fee: 'کرێی چەکی گەڕاوە', cancelled: 'هەڵوەشێنرایەوە' }
};
const words = (lang: BankLang | undefined) => WORDS[lang ?? 'ar'];

function insertCheque(db: Db, direction: ChequeDirection, input: ChequeInput, status: ChequeStatus, entryId: string, user: string): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO cheques (id, direction, number, bank, party_id, currency, amount, issue_date, due_date, status, bank_account, entry_id,
              notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, direction, input.number.trim(), input.bank.trim(), input.partyId, input.currency, input.amount, input.issueDate, input.dueDate, status,
      input.bankAccount ?? null, entryId, input.notes?.trim() || null, user, now, now);
  return id;
}

/** A customer's cheque received: Dr notes receivable, Cr the customer (draft entry). */
export function receiveCheque(db: Db, input: ChequeInput, actor: Actor): ChequeView {
  const errors = chequeErrors(db, 'received', input);
  if (errors.length) throw invalid(errors);
  const party = partyFor(db, input.partyId, 'customer');
  return transaction(db, () => {
    const nr = notesReceivable(db, actor.name);
    const description = words(input.lang).cheque(input.number.trim(), input.bank.trim());
    const entry = createJournalEntry(db, {
      date: input.issueDate, description, party: party.name, currency: input.currency, rateX100: rateOf(input.currency, input.rateX100),
      lines: [
        { accountCode: nr, debit: input.amount, credit: 0 },
        { accountCode: party.accountCode, debit: 0, credit: input.amount, partyId: party.id }
      ]
    }, actor.name, actor.id);
    const id = insertCheque(db, 'received', { ...input, bankAccount: undefined }, 'in_hand', entry.id, actor.name);
    audit(db, actor.name, 'receive', 'cheque', id, { number: input.number, amount: input.amount, currency: input.currency });
    return getCheque(db, id);
  });
}

/** A cheque written to a supplier: Dr the supplier, Cr notes payable (draft entry). */
export function issueCheque(db: Db, input: ChequeInput, actor: Actor): ChequeView {
  const errors = chequeErrors(db, 'issued', input);
  if (errors.length) throw invalid(errors);
  const party = partyFor(db, input.partyId, 'supplier');
  const np = notesPayable(db);
  return transaction(db, () => {
    const entry = createJournalEntry(db, {
      date: input.issueDate, description: words(input.lang).cheque(input.number.trim(), input.bank.trim()), party: party.name, currency: input.currency,
      rateX100: rateOf(input.currency, input.rateX100),
      lines: [
        { accountCode: party.accountCode, debit: input.amount, credit: 0, partyId: party.id },
        { accountCode: np, debit: 0, credit: input.amount }
      ]
    }, actor.name, actor.id);
    const id = insertCheque(db, 'issued', input, 'pending', entry.id, actor.name);
    audit(db, actor.name, 'issue', 'cheque', id, { number: input.number, amount: input.amount, currency: input.currency });
    return getCheque(db, id);
  });
}

function requireAction(db: Db, r: ChequeRow, action: ChequeAction): void {
  if (actionsFor(db, r).includes(action)) return;
  if (!approved(db, r.entry_id) && ['deposit', 'clear', 'bounce'].includes(action)) throw conflict('bk_cheque_entry_not_approved');
  throw conflict('action_not_allowed', { status: r.status, action });
}

/** Handed to the bank: no entry (the money isn't there yet), only the bank account it went to. */
export function depositCheque(db: Db, id: string, input: { bankAccount: string; date?: string | undefined }, actor: Actor): ChequeView {
  const r = loadCheque(db, id);
  requireAction(db, r, 'deposit');
  if (!isMoneyAccount(db, input.bankAccount)) throw invalid([{ code: 'bk_account_invalid', field: 'bankAccount' }]);
  transaction(db, () => {
    db.prepare("UPDATE cheques SET status = 'deposited', bank_account = ?, updated_at = ? WHERE id = ?").run(input.bankAccount, new Date().toISOString(), id);
    audit(db, actor.name, 'deposit', 'cheque', id, { bankAccount: input.bankAccount, date: input.date ?? todayIso() });
  });
  return getCheque(db, id);
}

/**
 * The bank paid (or took) the money. Received: a receipt voucher on the bank, Cr notes receivable. Issued: a payment
 * voucher on the bank, Dr notes payable. Both drafts.
 */
export function clearCheque(db: Db, id: string, input: { date: string; bankAccount?: string | undefined; rateX100?: number | undefined; lang?: BankLang | undefined }, actor: Actor): ChequeView {
  const r = loadCheque(db, id);
  requireAction(db, r, 'clear');
  const bank = input.bankAccount ?? r.bank_account;
  if (!bank || !isMoneyAccount(db, bank)) throw invalid([{ code: 'bk_account_invalid', field: 'bankAccount' }]);
  if (!isDate(input.date)) throw invalid([{ code: 'date_invalid' }]);
  if (r.currency === 'USD' && !(input.rateX100 ?? rateOfEntry(db, r.entry_id))) throw invalid([{ code: 'rate_invalid' }]);
  const party = db.prepare('SELECT name FROM parties WHERE id = ?').get(r.party_id) as { name: string };
  return transaction(db, () => {
    const counter = r.direction === 'received' ? notesReceivable(db, actor.name) : notesPayable(db);
    const entry = createVoucher(db, {
      kind: r.direction === 'received' ? 'receipt' : 'payment', date: input.date, cashAccountCode: bank, party: party.name,
      description: `${words(input.lang).cheque(r.number, r.bank)} — ${words(input.lang).cleared}`, currency: r.currency,
      rateX100: r.currency === 'IQD' ? 100 : input.rateX100 ?? rateOfEntry(db, r.entry_id)!,
      items: [{ accountCode: counter, amount: num(r.amount) }]
    }, actor.name, actor.id);
    db.prepare("UPDATE cheques SET status = 'cleared', bank_account = ?, clear_entry_id = ?, updated_at = ? WHERE id = ?")
      .run(bank, entry.id, new Date().toISOString(), id);
    audit(db, actor.name, 'clear', 'cheque', id, { entryId: entry.id });
    return getCheque(db, id);
  });
}

function rateOfEntry(db: Db, entryId: string | null): number | null {
  if (!entryId) return null;
  return (db.prepare('SELECT rate_x100 FROM entries WHERE id = ?').get(entryId) as { rate_x100: number } | undefined)?.rate_x100 ?? null;
}

const FEE_ACCOUNT_DEFAULT = '49';

/**
 * A received cheque the bank returned unpaid: the customer owes again (Dr the customer, Cr notes receivable), with an
 * optional fee charged to the customer (Dr the customer, Cr other revenue). A draft entry.
 */
export function bounceCheque(db: Db, id: string, input: { date: string; fee?: number | undefined; feeAccount?: string | undefined; reason?: string | undefined; lang?: BankLang | undefined }, actor: Actor): ChequeView {
  const r = loadCheque(db, id);
  if (r.direction !== 'received') throw conflict('action_not_allowed', { status: r.status, action: 'bounce' });
  requireAction(db, r, 'bounce');
  if (!isDate(input.date)) throw invalid([{ code: 'date_invalid' }]);
  const fee = input.fee ?? 0;
  if (!Number.isSafeInteger(fee) || fee < 0) throw invalid([{ code: 'amount_invalid', field: 'fee' }]);
  const feeAccount = input.feeAccount ?? FEE_ACCOUNT_DEFAULT;
  if (fee > 0 && !loadAccounts(db).some((a) => a.code === feeAccount && a.postable && a.code.startsWith('4'))) throw invalid([{ code: 'bk_fee_account_invalid' }]);
  // the customer owes again even when they were set inactive since: read directly, as clearing does
  const p = db.prepare('SELECT id, name, account_code FROM parties WHERE id = ?').get(r.party_id) as { id: string; name: string; account_code: string };
  const party = { id: p.id, name: p.name, accountCode: p.account_code };
  return transaction(db, () => {
    const nr = notesReceivable(db, actor.name);
    const lines: { accountCode: string; debit: number; credit: number; partyId?: string; description?: string }[] = [
      { accountCode: party.accountCode, debit: num(r.amount), credit: 0, partyId: party.id },
      { accountCode: nr, debit: 0, credit: num(r.amount) }
    ];
    if (fee > 0) {
      lines.push({ accountCode: party.accountCode, debit: fee, credit: 0, partyId: party.id, description: words(input.lang).fee });
      lines.push({ accountCode: feeAccount, debit: 0, credit: fee, description: words(input.lang).fee });
    }
    const entry = createJournalEntry(db, {
      date: input.date, description: `${words(input.lang).cheque(r.number, r.bank)} — ${words(input.lang).bounced}${input.reason?.trim() ? ': ' + input.reason.trim() : ''}`,
      party: party.name, currency: r.currency, rateX100: r.currency === 'IQD' ? 100 : rateOfEntry(db, r.entry_id) ?? 100, lines
    }, actor.name, actor.id);
    db.prepare("UPDATE cheques SET status = 'bounced', bounce_entry_id = ?, updated_at = ? WHERE id = ?").run(entry.id, new Date().toISOString(), id);
    audit(db, actor.name, 'bounce', 'cheque', id, { entryId: entry.id, fee, reason: input.reason?.trim() || null });
    return getCheque(db, id);
  });
}

/**
 * A cheque given back (received) or torn up (issued) before it was cleared. While its entry is still a draft the entry
 * is simply deleted; once approved, the opposite draft entry is made (kept as the cheque's bounce entry).
 */
export function cancelCheque(db: Db, id: string, input: { date?: string | undefined; reason?: string | undefined; lang?: BankLang | undefined }, actor: Actor): ChequeView {
  const r = loadCheque(db, id);
  requireAction(db, r, 'cancel');
  return transaction(db, () => {
    let reversal: string | null = null;
    const status = r.entry_id ? (db.prepare('SELECT status FROM entries WHERE id = ?').get(r.entry_id) as { status: string } | undefined)?.status : undefined;
    if (r.entry_id && status === 'draft') {
      db.prepare('UPDATE cheques SET entry_id = NULL WHERE id = ?').run(id);
      deleteEntry(db, r.entry_id, actor.name);
    } else if (r.entry_id && status === 'approved') {
      const original = getEntry(db, r.entry_id);
      const e = createJournalEntry(db, {
        date: input.date ?? todayIso(), description: `${original.description} — ${words(input.lang).cancelled}`, ...(original.party ? { party: original.party } : {}),
        currency: original.currency, rateX100: original.rateX100,
        lines: original.lines.map((l) => ({ accountCode: l.accountCode, debit: l.credit, credit: l.debit, ...(l.partyId ? { partyId: l.partyId } : {}) }))
      }, actor.name, actor.id);
      reversal = e.id;
    } else if (r.entry_id) {
      // checked but not approved: it has to be returned to draft by the checker first
      throw conflict('bk_cheque_entry_in_review');
    }
    db.prepare("UPDATE cheques SET status = 'cancelled', bounce_entry_id = ?, updated_at = ? WHERE id = ?").run(reversal, new Date().toISOString(), id);
    audit(db, actor.name, 'cancel', 'cheque', id, { reason: input.reason?.trim() || null, reversal });
    return getCheque(db, id);
  });
}

/** The entry of a cheque's last step (clearing, bouncing, cancelling), which "undo" takes back. */
function lastStepEntry(r: ChequeRow): string | null {
  if (r.status === 'cleared') return r.clear_entry_id;
  if (r.status === 'bounced' || r.status === 'cancelled') return r.bounce_entry_id;
  return null;
}

/** Whether the last step can be taken back: its entry is a draft, or approved and not reversed yet. */
function canUndo(db: Db, r: ChequeRow): boolean {
  const entryId = lastStepEntry(r);
  if (!entryId) return false;
  const e = db.prepare('SELECT status, reversed_by_id FROM entries WHERE id = ?').get(entryId) as { status: string; reversed_by_id: string | null } | undefined;
  return !!e && (e.status === 'draft' || (e.status === 'approved' && !e.reversed_by_id));
}

/** Whether undoing the last step reverses an approved entry (that needs the approver's permission). */
export function undoNeedsApprover(db: Db, id: string): boolean {
  const entryId = lastStepEntry(loadCheque(db, id));
  return !!entryId && (db.prepare("SELECT 1 FROM entries WHERE id = ? AND status = 'approved'").get(entryId) !== undefined);
}

/**
 * Takes back a cheque's last step (a clearing, bounce or cancelling made by mistake): while its entry is a draft the
 * entry is deleted; once approved it is reversed (an approved reversal, as from the journal). The cheque goes back to
 * where it was before the step: deposited (when it had been handed to the bank) or in hand, or pending for one written.
 */
export function undoChequeStep(db: Db, id: string, actor: Actor, date?: string): ChequeView {
  const r = loadCheque(db, id);
  const entryId = lastStepEntry(r);
  if (!entryId || !canUndo(db, r)) {
    if (entryId && (db.prepare("SELECT 1 FROM entries WHERE id = ? AND status = 'checked'").get(entryId))) throw conflict('bk_cheque_entry_in_review');
    throw conflict('action_not_allowed', { status: r.status, action: 'undo' });
  }
  const deposited = r.direction === 'received' && r.status !== 'cancelled'
    && !!db.prepare("SELECT 1 FROM audit_log WHERE entity = 'cheque' AND entity_id = ? AND action = 'deposit'").get(id);
  const back: ChequeStatus = r.direction === 'issued' ? 'pending' : deposited ? 'deposited' : 'in_hand';
  const column = r.status === 'cleared' ? 'clear_entry_id' : 'bounce_entry_id';
  const status = (db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }).status;
  return transaction(db, () => {
    const now = new Date().toISOString();
    db.prepare(`UPDATE cheques SET status = ?, ${column} = NULL, bank_account = ?, updated_at = ? WHERE id = ?`)
      .run(back, r.direction === 'issued' || deposited ? r.bank_account : null, now, id);
    let reversal: string | null = null;
    if (status === 'draft') deleteEntry(db, entryId, actor.name);
    else reversal = reverseEntryInternal(db, entryId, actor.name, date);
    audit(db, actor.name, 'undo', 'cheque', id, { was: r.status, now: back, entryId, reversal });
    return getCheque(db, id);
  });
}

// ——— bank reconciliation (Pro) ———

export const reconciliationAvailable = (db: Db) => planStatus(db).features.includes('bankReconciliation');

function requireReconciliation(db: Db): void {
  if (!reconciliationAvailable(db)) throw conflict('plan_limit', { limit: 'bankReconciliation' });
}

export interface StatementLineInput { date: string; description: string; reference?: string | undefined; amount: number }

export interface StatementInput {
  accountCode: string;
  currency: CurrencyCode;
  from: string;
  to: string;
  opening: number;
  closing: number;
  lines: StatementLineInput[];
}

export interface BookLine {
  entryId: string;
  number: string | null;
  date: string;
  description: string;
  /** money in positive, out negative, in the statement's currency */
  amount: number;
  matched: boolean;
}

export interface StatementLineView {
  seq: number;
  date: string;
  description: string;
  reference: string;
  amount: number;
  entry: { id: string; number: string | null; date: string; status: string } | null;
}

export interface StatementView {
  id: string;
  account: { code: string; name: Names };
  currency: CurrencyCode;
  from: string;
  to: string;
  opening: number;
  closing: number;
  status: 'open' | 'reconciled';
  lines: StatementLineView[];
  /** the account's entries (approved, in this currency) from 3 days before the period to 3 days after */
  book: BookLine[];
  /** the account's balance in this currency in the books at the end of the period (approved entries) */
  bookBalance: number;
  /** closing − book balance */
  difference: number;
  /** statement lines not matched yet, and their sum */
  unmatchedLines: number;
  unmatchedLinesSum: number;
  /** book entries in the period not on the statement, and their sum */
  unmatchedBook: number;
  unmatchedBookSum: number;
  canReconcile: boolean;
  createdBy: string;
  createdAt: string;
}

const currencyKey = (id: string) => `bank_statement_currency:${id}`;
const shift = (iso: string, days: number) => new Date(Date.parse(iso + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);

/** Every entry already matched to some statement line (a bank line is matched once). */
function matchedEntries(db: Db, exceptStatement?: string): Set<string> {
  const rows = db.prepare(`SELECT entry_id FROM bank_statement_lines WHERE entry_id IS NOT NULL ${exceptStatement ? 'AND statement_id <> ?' : ''}`)
    .all(...(exceptStatement ? [exceptStatement] : [])) as { entry_id: string }[];
  return new Set(rows.map((r) => r.entry_id));
}

/** The account's entries with their net movement on the account (one per entry), in a currency, between two dates. */
function bookLines(db: Db, account: string, currency: CurrencyCode, from: string, to: string, includeDrafts = false): Omit<BookLine, 'matched'>[] {
  const rows = db.prepare(`SELECT e.id, e.number, e.date, e.description, SUM(l.debit - l.credit) AS amount
                           FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                           WHERE l.account_code = ? AND e.currency = ? AND e.date >= ? AND e.date <= ?
                             AND e.status ${includeDrafts ? "IN ('draft', 'checked', 'approved')" : "= 'approved'"}
                           GROUP BY e.id, e.number, e.date, e.description
                           ORDER BY e.date, e.number`).all(account, currency, from, to) as { id: string; number: string | null; date: string; description: string; amount: number }[];
  return rows.filter((r) => num(r.amount) !== 0).map((r) => ({ entryId: r.id, number: r.number, date: r.date, description: r.description, amount: num(r.amount) }));
}

function bookBalance(db: Db, account: string, currency: CurrencyCode, to: string): number {
  return num((db.prepare(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                          WHERE l.account_code = ? AND e.currency = ? AND e.status = 'approved' AND e.date <= ?`).get(account, currency, to) as { b: number }).b);
}

export function createStatement(db: Db, input: StatementInput, actor: Actor): StatementView {
  requireReconciliation(db);
  const errors: { code: string; line?: number; field?: string }[] = [];
  if (!isMoneyAccount(db, input.accountCode)) errors.push({ code: 'bk_account_invalid', field: 'accountCode' });
  if (!isDate(input.from) || !isDate(input.to) || input.to < input.from) errors.push({ code: 'date_invalid', field: 'period' });
  if (!Number.isSafeInteger(input.opening) || !Number.isSafeInteger(input.closing)) errors.push({ code: 'amount_invalid', field: 'balance' });
  if (!input.lines.length) errors.push({ code: 'bk_statement_empty' });
  input.lines.forEach((l, i) => {
    if (!isDate(l.date)) errors.push({ code: 'date_invalid', line: i + 1 });
    if (!Number.isSafeInteger(l.amount) || l.amount === 0) errors.push({ code: 'amount_invalid', line: i + 1 });
  });
  const sum = input.lines.reduce((s, l) => s + (Number.isSafeInteger(l.amount) ? l.amount : 0), 0);
  if (!errors.length && input.opening + sum !== input.closing) errors.push({ code: 'bk_statement_unbalanced' });
  if (errors.length) throw invalid(errors);
  const id = randomUUID();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO bank_statements (id, account_code, period_from, period_to, opening, closing, status, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`).run(id, input.accountCode, input.from, input.to, input.opening, input.closing, actor.name, now, now);
    const insert = db.prepare('INSERT INTO bank_statement_lines (statement_id, seq, date, description, reference, amount) VALUES (?, ?, ?, ?, ?, ?)');
    input.lines.forEach((l, i) => insert.run(id, i + 1, l.date, l.description.trim().slice(0, 500) || '—', l.reference?.trim() || null, l.amount));
    writeSetting(db, currencyKey(id), input.currency);
    audit(db, actor.name, 'create', 'bank_statement', id, { account: input.accountCode, lines: input.lines.length, from: input.from, to: input.to });
  });
  return getStatement(db, id);
}

interface StatementRow { id: string; account_code: string; period_from: string; period_to: string; opening: number; closing: number; status: 'open' | 'reconciled'; created_by: string; created_at: string }

function loadStatement(db: Db, id: string): StatementRow {
  const r = db.prepare('SELECT * FROM bank_statements WHERE id = ?').get(id) as StatementRow | undefined;
  if (!r) throw notFound('bank_statement');
  return r;
}

export function getStatement(db: Db, id: string): StatementView {
  const s = loadStatement(db, id);
  const currency = (readSetting(db, currencyKey(id)) as CurrencyCode | undefined) ?? 'IQD';
  const account = loadAccounts(db).find((a) => a.code === s.account_code)!;
  const rows = db.prepare('SELECT seq, date, description, reference, amount, entry_id FROM bank_statement_lines WHERE statement_id = ? ORDER BY seq').all(id) as
    { seq: number; date: string; description: string; reference: string | null; amount: number; entry_id: string | null }[];
  const elsewhere = matchedEntries(db, id);
  const here = new Set(rows.map((r) => r.entry_id).filter((x): x is string => !!x));
  const book = bookLines(db, s.account_code, currency, shift(s.period_from, -3), shift(s.period_to, 3))
    .filter((b) => !elsewhere.has(b.entryId))
    .map((b) => ({ ...b, matched: here.has(b.entryId) }));
  const lines: StatementLineView[] = rows.map((r) => {
    const e = r.entry_id ? db.prepare('SELECT id, number, date, status FROM entries WHERE id = ?').get(r.entry_id) as { id: string; number: string | null; date: string; status: string } | undefined : undefined;
    return { seq: r.seq, date: r.date, description: r.description, reference: r.reference ?? '', amount: num(r.amount), entry: e ? { id: e.id, number: e.number, date: e.date, status: e.status } : null };
  });
  const balance = bookBalance(db, s.account_code, currency, s.period_to);
  const unmatched = lines.filter((l) => !l.entry);
  const inPeriodBook = book.filter((b) => !b.matched && b.date >= s.period_from && b.date <= s.period_to);
  const difference = num(s.closing) - balance;
  return {
    id: s.id, account: { code: account.code, name: account.name }, currency, from: s.period_from, to: s.period_to,
    opening: num(s.opening), closing: num(s.closing), status: s.status, lines, book, bookBalance: balance, difference,
    unmatchedLines: unmatched.length, unmatchedLinesSum: unmatched.reduce((a, l) => a + l.amount, 0),
    unmatchedBook: inPeriodBook.length, unmatchedBookSum: inPeriodBook.reduce((a, b) => a + b.amount, 0),
    canReconcile: s.status === 'open' && unmatched.length === 0 && difference === 0 && lines.every((l) => !l.entry || l.entry.status === 'approved'),
    createdBy: s.created_by, createdAt: s.created_at
  };
}

export function listStatements(db: Db, accountCode?: string): { id: string; accountCode: string; from: string; to: string; closing: number; status: string; lines: number; matched: number }[] {
  const rows = db.prepare(`SELECT s.id, s.account_code, s.period_from, s.period_to, s.closing, s.status,
                                  COUNT(l.seq) AS line_count, COUNT(l.entry_id) AS matched
                           FROM bank_statements s LEFT JOIN bank_statement_lines l ON l.statement_id = s.id
                           ${accountCode ? 'WHERE s.account_code = ?' : ''}
                           GROUP BY s.id, s.account_code, s.period_from, s.period_to, s.closing, s.status
                           ORDER BY s.period_to DESC`).all(...(accountCode ? [accountCode] : [])) as
    { id: string; account_code: string; period_from: string; period_to: string; closing: number; status: string; line_count: number; matched: number }[];
  return rows.map((r) => ({ id: r.id, accountCode: r.account_code, from: r.period_from, to: r.period_to, closing: num(r.closing), status: r.status, lines: num(r.line_count), matched: num(r.matched) }));
}

function requireOpen(s: StatementRow): void {
  if (s.status !== 'open') throw conflict('bk_statement_reconciled');
}

/** Words of 3+ characters or digits in a text, for comparing a bank reference with an entry's text. */
const tokens = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []));

/**
 * Pairs each unmatched statement line with an unmatched book entry of the same amount within 3 days. When several fit,
 * the one whose number or description shares the line's reference (a cheque or transfer number) wins, then the closest
 * date. A book entry is used once.
 */
export function autoMatch(db: Db, id: string, actor: Actor): { matched: number; statement: StatementView } {
  requireReconciliation(db);
  const s = loadStatement(db, id);
  requireOpen(s);
  const view = getStatement(db, id);
  const free = view.book.filter((b) => !b.matched);
  const used = new Set<string>();
  const update = db.prepare('UPDATE bank_statement_lines SET entry_id = ? WHERE statement_id = ? AND seq = ?');
  let matched = 0;
  transaction(db, () => {
    for (const line of view.lines) {
      if (line.entry) continue;
      const ref = tokens(`${line.reference} ${line.description}`);
      const candidates = free.filter((b) => !used.has(b.entryId) && b.amount === line.amount && Math.abs(daysBetweenIso(b.date, line.date)) <= 3);
      if (!candidates.length) continue;
      const score = (b: Omit<BookLine, 'matched'>) => {
        const words = tokens(`${b.number ?? ''} ${b.description}`);
        let shared = 0;
        for (const w of ref) if (words.has(w)) shared += 1;
        return shared * 100 - Math.abs(daysBetweenIso(b.date, line.date));
      };
      candidates.sort((a, b) => score(b) - score(a));
      const best = candidates[0]!;
      // two equally good candidates with nothing to tell them apart: leave it to the person
      if (candidates.length > 1 && score(candidates[1]!) === score(best) && tokens(line.reference).size === 0) continue;
      used.add(best.entryId);
      update.run(best.entryId, id, line.seq);
      matched += 1;
    }
    if (matched) audit(db, actor.name, 'match', 'bank_statement', id, { matched });
  });
  return { matched, statement: getStatement(db, id) };
}

export function matchLine(db: Db, id: string, seq: number, entryId: string | null, actor: Actor): StatementView {
  requireReconciliation(db);
  const s = loadStatement(db, id);
  requireOpen(s);
  const line = db.prepare('SELECT amount FROM bank_statement_lines WHERE statement_id = ? AND seq = ?').get(id, seq) as { amount: number } | undefined;
  if (!line) throw notFound('bank_statement_line');
  if (entryId) {
    // any entry (approved or still in review) that moves this account in the statement's currency by the line's amount
    const currency = (readSetting(db, currencyKey(id)) as CurrencyCode | undefined) ?? 'IQD';
    const moved = db.prepare(`SELECT e.currency, e.reversed_by_id, e.type, SUM(l.debit - l.credit) AS amount FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                              WHERE e.id = ? AND l.account_code = ? GROUP BY e.id, e.currency, e.reversed_by_id, e.type`).get(entryId, s.account_code) as
      { currency: CurrencyCode; reversed_by_id: string | null; type: string; amount: number } | undefined;
    if (!moved || moved.currency !== currency || moved.reversed_by_id || moved.type === 'reversal') throw invalid([{ code: 'bk_match_invalid' }]);
    if (matchedEntries(db).has(entryId)) throw conflict('bk_already_matched');
    if (num(moved.amount) !== num(line.amount)) throw invalid([{ code: 'bk_match_amount' }]);
  }
  transaction(db, () => {
    db.prepare('UPDATE bank_statement_lines SET entry_id = ? WHERE statement_id = ? AND seq = ?').run(entryId, id, seq);
    audit(db, actor.name, entryId ? 'match' : 'unmatch', 'bank_statement', id, { seq, entryId });
  });
  return getStatement(db, id);
}

/**
 * A line the books don't have yet (bank charges, interest, a deposit no one recorded): a draft voucher on the bank
 * account — a receipt for money in, a payment for money out — matched to the line at once.
 */
export function voucherFromLine(db: Db, id: string, seq: number, input: { accountCode: string; partyId?: string | undefined; description?: string | undefined; rateX100?: number | undefined }, actor: Actor): StatementView {
  requireReconciliation(db);
  const s = loadStatement(db, id);
  requireOpen(s);
  const line = db.prepare('SELECT date, description, amount, entry_id FROM bank_statement_lines WHERE statement_id = ? AND seq = ?').get(id, seq) as
    { date: string; description: string; amount: number; entry_id: string | null } | undefined;
  if (!line) throw notFound('bank_statement_line');
  if (line.entry_id) throw conflict('bk_already_matched');
  const currency = (readSetting(db, currencyKey(id)) as CurrencyCode | undefined) ?? 'IQD';
  if (currency === 'USD' && !input.rateX100) throw invalid([{ code: 'rate_invalid' }]);
  const amount = num(line.amount);
  return transaction(db, () => {
    const entry = createVoucher(db, {
      kind: amount > 0 ? 'receipt' : 'payment', date: line.date, cashAccountCode: s.account_code,
      description: input.description?.trim() || line.description, currency, rateX100: currency === 'IQD' ? 100 : input.rateX100!,
      items: [{ accountCode: input.accountCode, amount: Math.abs(amount), ...(input.partyId ? { partyId: input.partyId } : {}) }]
    }, actor.name, actor.id);
    db.prepare('UPDATE bank_statement_lines SET entry_id = ? WHERE statement_id = ? AND seq = ?').run(entry.id, id, seq);
    audit(db, actor.name, 'create', 'bank_statement', id, { seq, entryId: entry.id });
    return getStatement(db, id);
  });
}

export function reconcileStatement(db: Db, id: string, actor: Actor): StatementView {
  requireReconciliation(db);
  const view = getStatement(db, id);
  if (view.status !== 'open') throw conflict('bk_statement_reconciled');
  if (view.unmatchedLines > 0) throw conflict('bk_statement_unmatched', { lines: view.unmatchedLines });
  if (view.difference !== 0) throw conflict('bk_statement_difference', { difference: view.difference });
  // every line's entry must be in the books for good: approved and not reversed
  const unposted = db.prepare(`SELECT l.seq FROM bank_statement_lines l JOIN entries e ON e.id = l.entry_id
                               WHERE l.statement_id = ? AND (e.status <> 'approved' OR e.reversed_by_id IS NOT NULL) ORDER BY l.seq`).all(id) as { seq: number }[];
  if (unposted.length) throw conflict('bk_statement_unposted', { lines: unposted.map((r) => num(r.seq)) });
  transaction(db, () => {
    db.prepare("UPDATE bank_statements SET status = 'reconciled', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    audit(db, actor.name, 'reconcile', 'bank_statement', id, { closing: view.closing });
  });
  return getStatement(db, id);
}

export function deleteStatement(db: Db, id: string, actor: Actor): void {
  const s = loadStatement(db, id);
  requireOpen(s);
  transaction(db, () => {
    db.prepare('DELETE FROM bank_statement_lines WHERE statement_id = ?').run(id);
    db.prepare('DELETE FROM bank_statements WHERE id = ?').run(id);
    db.prepare('DELETE FROM settings WHERE "key" = ?').run(currencyKey(id));
    audit(db, actor.name, 'delete', 'bank_statement', id);
  });
}

// ——— the API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.number().int().max(Number.MAX_SAFE_INTEGER).min(-Number.MAX_SAFE_INTEGER);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const code = z.string().min(1).max(12);
const currency = z.enum(['IQD', 'USD']);
/** the language of the words written into the entry (the person's own, as the other modules take it) */
const lang = z.enum(['ar', 'en', 'ku']).optional();
const id = z.string().min(1).max(64);
const names = z.object({ ar: z.string().max(200), en: z.string().max(200), ku: z.string().max(200) });
const chequeBody = z.object({
  number: z.string().min(1).max(50), bank: z.string().min(1).max(120), partyId: id, currency, rateX100: positive.optional(), amount: positive,
  issueDate: date, dueDate: date, bankAccount: code.optional(), notes: z.string().max(1000).optional(), lang
});

/**
 * Reading is open to every signed-in user. Making entries (transfers, cheques, reconciliation vouchers) needs the
 * preparer's permission, as typing a voucher does; adding a bank account or marking accounts is for an admin.
 */
export const bankingApi: ApiExtension = {
  rules: {
    'POST /api/banking/transfers': 'entries.prepare',
    'POST /api/banking/cheques': 'entries.prepare',
    'POST /api/banking/cheques/:id/deposit': 'entries.prepare',
    'POST /api/banking/cheques/:id/clear': 'entries.prepare',
    'POST /api/banking/cheques/:id/bounce': 'entries.prepare',
    'POST /api/banking/cheques/:id/cancel': 'entries.prepare',
    // deleting a draft step needs the preparer; reversing an approved one also the approver (checked in the handler)
    'POST /api/banking/cheques/:id/undo': 'entries.prepare',
    'POST /api/banking/statements': 'entries.prepare',
    'POST /api/banking/statements/:id/auto-match': 'entries.prepare',
    'POST /api/banking/statements/:id/lines/:seq/match': 'entries.prepare',
    'POST /api/banking/statements/:id/lines/:seq/voucher': 'entries.prepare',
    'POST /api/banking/statements/:id/reconcile': 'entries.prepare',
    'DELETE /api/banking/statements/:id': 'entries.prepare'
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    const idParam = z.object({ id });
    return [
      { method: 'GET', path: '/api/banking/accounts', handler: async () => ({ accounts: moneyAccounts(db), reconciliation: reconciliationAvailable(db) }) },
      {
        method: 'POST', path: '/api/banking/accounts',
        handler: async (req, reply) => {
          const body = parse(z.object({ name: names, kind: z.enum(WALLET_KINDS), currency: currency.nullable().optional() }), req.body);
          reply.status(201).send(addMoneyAccount(db, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'PUT', path: '/api/banking/accounts/:code',
        handler: async (req) => {
          const body = parse(z.object({ kind: z.enum(['safe', ...WALLET_KINDS]), currency: currency.nullable() }), req.body);
          return setMoneyAccountMeta(db, parse(z.object({ code }), req.params).code, body, actor(req));
        }
      },
      {
        method: 'POST', path: '/api/banking/transfers',
        handler: async (req, reply) => {
          const body = parse(z.object({
            date, from: code, to: code, currency, rateX100: positive.optional(), amount: positive, charge: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
            chargeAccount: code.optional(), description: z.string().max(300).optional(), lang
          }), req.body);
          reply.status(201).send(transfer(db, body, actor(req)));
          return undefined;
        }
      },
      { method: 'GET', path: '/api/banking/cheques/summary', handler: async () => chequeSummary(db) },
      {
        method: 'GET', path: '/api/banking/cheques',
        handler: async (req) => {
          const f = parse(z.object({
            direction: z.enum(['received', 'issued']).optional(),
            status: z.enum(['in_hand', 'deposited', 'cleared', 'bounced', 'cancelled', 'pending', 'open']).optional(),
            due: z.enum(['today', 'week', 'overdue']).optional(), partyId: id.optional(), q: z.string().max(100).optional()
          }), req.query);
          return listCheques(db, { ...f, q: f.q?.trim() || undefined });
        }
      },
      { method: 'GET', path: '/api/banking/cheques/:id', handler: async (req) => getCheque(db, parse(idParam, req.params).id) },
      {
        method: 'POST', path: '/api/banking/cheques',
        handler: async (req, reply) => {
          const body = parse(chequeBody.extend({ direction: z.enum(['received', 'issued']) }), req.body);
          const { direction, ...input } = body;
          reply.status(201).send(direction === 'received' ? receiveCheque(db, input, actor(req)) : issueCheque(db, input, actor(req)));
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/banking/cheques/:id/deposit',
        handler: async (req) => depositCheque(db, parse(idParam, req.params).id, parse(z.object({ bankAccount: code, date: date.optional() }), req.body), actor(req))
      },
      {
        method: 'POST', path: '/api/banking/cheques/:id/clear',
        handler: async (req) => clearCheque(db, parse(idParam, req.params).id,
          parse(z.object({ date, bankAccount: code.optional(), rateX100: positive.optional(), lang }), req.body), actor(req))
      },
      {
        method: 'POST', path: '/api/banking/cheques/:id/bounce',
        handler: async (req) => bounceCheque(db, parse(idParam, req.params).id,
          parse(z.object({ date, fee: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), feeAccount: code.optional(), reason: z.string().max(300).optional(), lang }), req.body), actor(req))
      },
      {
        method: 'POST', path: '/api/banking/cheques/:id/cancel',
        handler: async (req) => cancelCheque(db, parse(idParam, req.params).id, parse(z.object({ date: date.optional(), reason: z.string().max(300).optional(), lang }), req.body ?? {}), actor(req))
      },
      {
        method: 'POST', path: '/api/banking/cheques/:id/undo',
        handler: async (req) => {
          const chequeId = parse(idParam, req.params).id;
          const body = parse(z.object({ date: date.optional() }), req.body ?? {});
          const who = actor(req);
          // taking back an approved step is a reversal, which only an approver makes (as in the journal)
          if (undoNeedsApprover(db, chequeId) && !who.permissions.includes('entries.approve')) throw new AppError(403, 'forbidden', { need: 'entries.approve' });
          return undoChequeStep(db, chequeId, who, body.date);
        }
      },
      {
        method: 'GET', path: '/api/banking/statements',
        handler: async (req) => listStatements(db, parse(z.object({ accountCode: code.optional() }), req.query).accountCode)
      },
      { method: 'GET', path: '/api/banking/statements/:id', handler: async (req) => getStatement(db, parse(idParam, req.params).id) },
      {
        method: 'POST', path: '/api/banking/statements',
        handler: async (req, reply) => {
          const body = parse(z.object({
            accountCode: code, currency, from: date, to: date, opening: amount, closing: amount,
            lines: z.array(z.object({ date, description: z.string().max(500), reference: z.string().max(100).optional(), amount })).min(1).max(5000)
          }), req.body);
          reply.status(201).send(createStatement(db, body, actor(req)));
          return undefined;
        }
      },
      { method: 'POST', path: '/api/banking/statements/:id/auto-match', handler: async (req) => autoMatch(db, parse(idParam, req.params).id, actor(req)) },
      {
        method: 'POST', path: '/api/banking/statements/:id/lines/:seq/match',
        handler: async (req) => {
          const p = parse(z.object({ id, seq: z.coerce.number().int().positive() }), req.params);
          return matchLine(db, p.id, p.seq, parse(z.object({ entryId: id.nullable() }), req.body).entryId, actor(req));
        }
      },
      {
        method: 'POST', path: '/api/banking/statements/:id/lines/:seq/voucher',
        handler: async (req) => {
          const p = parse(z.object({ id, seq: z.coerce.number().int().positive() }), req.params);
          const body = parse(z.object({ accountCode: code, partyId: id.optional(), description: z.string().max(300).optional(), rateX100: positive.optional() }), req.body);
          return voucherFromLine(db, p.id, p.seq, body, actor(req));
        }
      },
      { method: 'POST', path: '/api/banking/statements/:id/reconcile', handler: async (req) => reconcileStatement(db, parse(idParam, req.params).id, actor(req)) },
      {
        method: 'DELETE', path: '/api/banking/statements/:id',
        handler: async (req, reply) => {
          deleteStatement(db, parse(idParam, req.params).id, actor(req));
          reply.status(204).send();
          return undefined;
        }
      }
    ];
  }
};
