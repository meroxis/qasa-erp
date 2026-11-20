import { randomInt, randomUUID } from 'node:crypto';
import { todayIso, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { audit } from './audit.ts';
import { conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { readSetting } from './settings.ts';
import { createJournalEntry, postVoucherNow, reverseEntryInternal } from './journal.ts';
import { transaction } from './db.ts';
import { featureAccount } from './feature-accounts.ts';

/**
 * Gift vouchers (2.0, the till): a customer buys a voucher at the till (cash into the shift's drawer), and whoever holds
 * it pays with it later, all at once or in parts (the rest stays on it until it expires).
 *
 * The books: selling it is a receipt posted at once with the till's sale (Dr the shift's safe / Cr gift vouchers sold,
 * a liability: the company owes the goods). Paying with it is part of the sale (Dr gift vouchers sold), as loyalty
 * points are. A sale cancelled gives the voucher back what it took. An unused voucher can be cancelled by an admin (its
 * receipt reversed: the money goes back to the customer).
 *
 * The account: the company's choice (setting gift_voucher_account), else 263 "Gift vouchers sold" under 26 creditors,
 * made the first time it is needed, as consignment's 268 is.
 */

export const GIFT_ACCOUNT = '263';
const GIFT_NAMES: Names = { ar: 'قسائم الهدايا المباعة', en: 'Gift vouchers sold', ku: 'کوپۆنی دیاری فرۆشراو' };
/** The largest voucher the till sells (dinars). */
export const GIFT_MAX = 100_000_000;
/** No 0/O, 1/I/L: a code read aloud or typed from paper is not misread. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export interface GiftVoucherView {
  id: string; code: string; amount: number; balance: number; currency: 'IQD'; expiresOn: string | null;
  status: 'active' | 'cancelled'; createdBy: string; createdAt: string;
  /** may pay with it today: active, not expired, something left on it */
  usable: boolean;
}

interface Row {
  id: string; code: string; amount: number; balance: number; currency: 'IQD'; expires_on: string | null; status: 'active' | 'cancelled';
  account_code: string; shift_id: string | null; entry_id: string | null; created_by: string; created_at: string;
}

const view = (r: Row, today = todayIso()): GiftVoucherView => ({
  id: r.id, code: r.code, amount: Number(r.amount), balance: Number(r.balance), currency: 'IQD', expiresOn: r.expires_on, status: r.status,
  createdBy: r.created_by, createdAt: r.created_at,
  usable: r.status === 'active' && Number(r.balance) > 0 && (!r.expires_on || r.expires_on >= today)
});

/** A code as typed or scanned: spaces and dashes out, upper case. */
export const normalizeCode = (code: string): string => code.replace(/[\s-]/g, '').toUpperCase();

export function newVoucherCode(): string {
  let s = 'GV';
  for (let i = 0; i < 10; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** The liability account vouchers sold are kept in (see above). */
export function giftAccount(db: Db, user: string): string {
  return featureAccount(db, 'giftVouchers', user, GIFT_NAMES);
}

/**
 * A voucher sold at a till's open shift: its receipt posted at once into the shift's safe. Call inside a transaction.
 */
export function sellGiftVoucher(db: Db, shift: { id: string; cashAccount: string }, input: { amount: number; expiresOn?: string | undefined },
  actor: { id: string | null; name: string }): GiftVoucherView {
  const today = todayIso();
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > GIFT_MAX) throw invalid([{ code: 'gv_amount_invalid' }]);
  if (input.expiresOn !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn) || input.expiresOn < today)) throw invalid([{ code: 'gv_expiry_invalid' }]);
  const account = giftAccount(db, actor.name);
  let code = newVoucherCode();
  while (db.prepare('SELECT 1 FROM gift_vouchers WHERE code = ?').get(code)) code = newVoucherCode();
  const entryId = postVoucherNow(db, {
    kind: 'receipt', date: today, cashAccountCode: shift.cashAccount, currency: 'IQD', rateX100: 100,
    description: `${GIFT_NAMES.en} ${code}`, items: [{ accountCode: account, amount: input.amount, description: code }]
  }, actor);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO gift_vouchers (id, code, amount, balance, currency, expires_on, status, account_code, shift_id, entry_id, created_by, created_at)
              VALUES (?, ?, ?, ?, 'IQD', ?, 'active', ?, ?, ?, ?, ?)`)
    .run(id, code, input.amount, input.amount, input.expiresOn ?? null, account, shift.id, entryId, actor.name, now);
  db.prepare("INSERT INTO gift_voucher_moves (id, voucher_id, kind, amount, invoice_id, created_by, created_at) VALUES (?, ?, 'sold', ?, NULL, ?, ?)")
    .run(randomUUID(), id, input.amount, actor.name, now);
  audit(db, actor.name, 'sell', 'gift_voucher', id, { code, amount: input.amount, shiftId: shift.id, entryId });
  return getGiftVoucher(db, id);
}

export function getGiftVoucher(db: Db, id: string): GiftVoucherView {
  const r = db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw notFound('gift_voucher');
  return view(r);
}

/** A voucher by its code (as typed or scanned); null when there is none. */
export function findGiftVoucher(db: Db, code: string): GiftVoucherView | null {
  const r = db.prepare('SELECT * FROM gift_vouchers WHERE code = ?').get(normalizeCode(code)) as Row | undefined;
  return r ? view(r) : null;
}

export interface GiftPart { voucherId: string; code: string; accountCode: string; amount: number }

/**
 * What vouchers pay on a sale on `date`: each must be usable then and hold the amount asked of it; the same voucher
 * twice is refused. Checked again (and taken) in the sale's transaction.
 */
export function giftParts(db: Db, list: readonly { code: string; amount: number }[], date: string): GiftPart[] {
  const seen = new Set<string>();
  const parts: GiftPart[] = [];
  const errors: { code: string; voucher?: string; balance?: number }[] = [];
  for (const asked of list) {
    const code = normalizeCode(asked.code);
    const r = db.prepare('SELECT * FROM gift_vouchers WHERE code = ?').get(code) as Row | undefined;
    if (!r) { errors.push({ code: 'gv_not_found', voucher: code }); continue; }
    if (seen.has(r.id)) { errors.push({ code: 'gv_twice', voucher: code }); continue; }
    seen.add(r.id);
    if (r.status !== 'active') errors.push({ code: 'gv_cancelled', voucher: code });
    else if (r.expires_on && r.expires_on < date) errors.push({ code: 'gv_expired', voucher: code });
    else if (!Number.isSafeInteger(asked.amount) || asked.amount <= 0 || asked.amount > Number(r.balance)) errors.push({ code: 'gv_balance', voucher: code, balance: Number(r.balance) });
    else parts.push({ voucherId: r.id, code, accountCode: r.account_code, amount: asked.amount });
  }
  if (errors.length) throw invalid(errors);
  return parts;
}

/**
 * A return of goods a gift voucher paid for: that share goes back onto the voucher (the first one the sale used that
 * is still active), or onto a new voucher when none is (cancelled meanwhile), whose code is in the audit log and the
 * voucher list. Never as money. Inside the return's transaction; its entry credits the voucher account.
 */
export function giveBackToVoucher(db: Db, input: { originalId: string; returnId: string; entryId: string | null; amount: number }, user: string): { voucherId: string; code: string } {
  const used = db.prepare(`SELECT v.id, v.code, v.status, v.account_code, v.expires_on FROM gift_voucher_moves m JOIN gift_vouchers v ON v.id = m.voucher_id
                           WHERE m.invoice_id = ? AND m.kind = 'redeemed' ORDER BY m.created_at`).all(input.originalId) as
    { id: string; code: string; status: string; account_code: string; expires_on: string | null }[];
  const now = new Date().toISOString();
  const active = used.find((v) => v.status === 'active');
  let target: { id: string; code: string };
  if (active) {
    db.prepare('UPDATE gift_vouchers SET balance = balance + ?, amount = CASE WHEN balance + ? > amount THEN balance + ? ELSE amount END WHERE id = ?')
      .run(input.amount, input.amount, input.amount, active.id);
    target = active;
  } else {
    const id = randomUUID();
    const code = newVoucherCode();
    db.prepare(`INSERT INTO gift_vouchers (id, code, amount, balance, currency, expires_on, status, account_code, shift_id, entry_id, created_by, created_at)
                VALUES (?, ?, ?, ?, 'IQD', ?, 'active', ?, NULL, ?, ?, ?)`)
      .run(id, code, input.amount, input.amount, used[0]?.expires_on ?? null, used[0]?.account_code ?? GIFT_ACCOUNT, input.entryId, user, now);
    target = { id, code };
  }
  db.prepare("INSERT INTO gift_voucher_moves (id, voucher_id, kind, amount, invoice_id, created_by, created_at) VALUES (?, ?, 'returned', ?, ?, ?, ?)")
    .run(randomUUID(), target.id, input.amount, input.returnId, user, now);
  audit(db, user, 'gift_voucher_returned', 'gift_voucher', target.id, { code: target.code, amount: input.amount, returnId: input.returnId, made: !active });
  return { voucherId: target.id, code: target.code };
}

/** The vouchers a posted sale paid with: their balances go down. Inside the sale's transaction. */
export function takeGiftParts(db: Db, invoiceId: string, parts: readonly GiftPart[], user: string): void {
  const now = new Date().toISOString();
  for (const p of parts) {
    const changed = db.prepare('UPDATE gift_vouchers SET balance = balance - ? WHERE id = ? AND balance >= ?').run(p.amount, p.voucherId, p.amount);
    if (Number(changed.changes) !== 1) throw invalid([{ code: 'gv_balance', voucher: p.code }]);
    db.prepare("INSERT INTO gift_voucher_moves (id, voucher_id, kind, amount, invoice_id, created_by, created_at) VALUES (?, ?, 'redeemed', ?, ?, ?, ?)")
      .run(randomUUID(), p.voucherId, -p.amount, invoiceId, user, now);
    audit(db, user, 'redeem', 'gift_voucher', p.voucherId, { code: p.code, amount: p.amount, invoiceId });
  }
}

/** A sale cancelled: what it took from vouchers goes back on them (once). Called from cancelInvoice. */
export function restoreGiftVouchers(db: Db, invoiceId: string, user: string): void {
  const moves = db.prepare(`SELECT voucher_id, SUM(amount) AS amount FROM gift_voucher_moves WHERE invoice_id = ? AND kind IN ('redeemed', 'restored')
                            GROUP BY voucher_id`).all(invoiceId) as { voucher_id: string; amount: number }[];
  const now = new Date().toISOString();
  for (const m of moves) {
    const back = -Number(m.amount);
    if (back <= 0) continue;
    db.prepare('UPDATE gift_vouchers SET balance = balance + ? WHERE id = ?').run(back, m.voucher_id);
    db.prepare("INSERT INTO gift_voucher_moves (id, voucher_id, kind, amount, invoice_id, created_by, created_at) VALUES (?, ?, 'restored', ?, ?, ?, ?)")
      .run(randomUUID(), m.voucher_id, back, invoiceId, user, now);
    audit(db, user, 'restore', 'gift_voucher', m.voucher_id, { amount: back, invoiceId });
  }
}

/** An unused voucher cancelled by an admin: its receipt is reversed (the money is paid back). */
export function cancelGiftVoucher(db: Db, id: string, user: string): GiftVoucherView {
  const r = db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw notFound('gift_voucher');
  if (r.status !== 'active') throw conflict('gv_cancelled');
  if (Number(r.balance) !== Number(r.amount)) throw conflict('gv_used');
  const reversal = r.entry_id ? reverseEntryInternal(db, r.entry_id, user) : null;
  db.prepare("UPDATE gift_vouchers SET status = 'cancelled', balance = 0, cancel_entry_id = ? WHERE id = ?").run(reversal, id);
  db.prepare("INSERT INTO gift_voucher_moves (id, voucher_id, kind, amount, invoice_id, created_by, created_at) VALUES (?, ?, 'cancelled', ?, NULL, ?, ?)")
    .run(randomUUID(), id, -Number(r.amount), user, new Date().toISOString());
  audit(db, user, 'cancel', 'gift_voucher', id, { code: r.code, amount: Number(r.amount), reversal });
  return getGiftVoucher(db, id);
}

/** Cash a shift took for vouchers it sold (those cancelled since are paid back, so not expected in the drawer). */
export function giftCashOf(db: Db, shiftId: string): number {
  const r = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM gift_vouchers WHERE shift_id = ? AND status = 'active'").get(shiftId) as { total: number };
  return Number(r.total);
}

/** What vouchers past their date still hold (still owed in the books until an admin writes it off). */
export function expiredUnused(db: Db, today = todayIso()): { count: number; amount: number } {
  const r = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(balance), 0) AS amount FROM gift_vouchers WHERE status = 'active' AND balance > 0 AND expires_on IS NOT NULL AND expires_on < ?")
    .get(today) as { n: number; amount: number };
  return { count: Number(r.n), amount: Number(r.amount) };
}

/**
 * An admin takes what expired vouchers still hold into income (other revenue, 49…), through one draft journal entry
 * that is checked and approved like any other: Dr each voucher's liability account / Cr the income account. The
 * vouchers are emptied (move 'expired') and keep the entry, which only this feature changes (journal.ts ENTRY_OWNERS).
 */
export function writeOffExpired(db: Db, actor: { id: string | null; name: string }, incomeAccount?: string): { entryId: string | null; count: number; amount: number } {
  const today = todayIso();
  const rows = db.prepare("SELECT id, code, balance, account_code FROM gift_vouchers WHERE status = 'active' AND balance > 0 AND expires_on IS NOT NULL AND expires_on < ?")
    .all(today) as { id: string; code: string; balance: number; account_code: string }[];
  if (!rows.length) return { entryId: null, count: 0, amount: 0 };
  const accounts = loadAccounts(db).filter((a) => a.postable);
  const income = incomeAccount && accounts.some((a) => a.code === incomeAccount && a.code.startsWith('4')) ? incomeAccount
    : accounts.filter((a) => a.code.startsWith('49')).sort((x, y) => x.code.localeCompare(y.code))[0]?.code;
  if (!income) throw conflict('gv_income_account_missing');
  const byAccount = new Map<string, number>();
  for (const r of rows) byAccount.set(r.account_code, (byAccount.get(r.account_code) ?? 0) + Number(r.balance));
  const amount = rows.reduce((s, r) => s + Number(r.balance), 0);
  return transaction(db, () => {
    const entry = createJournalEntry(db, {
      date: today, currency: 'IQD', rateX100: 100, description: `Expired gift vouchers (${rows.length})`,
      lines: [...[...byAccount].map(([accountCode, value]) => ({ accountCode, debit: value, credit: 0 })), { accountCode: income, debit: 0, credit: amount }]
    }, actor.name, actor.id);
    const now = new Date().toISOString();
    for (const r of rows) {
      db.prepare('UPDATE gift_vouchers SET balance = 0, expire_entry_id = ? WHERE id = ?').run(entry.id, r.id);
      db.prepare("INSERT INTO gift_voucher_moves (id, voucher_id, kind, amount, invoice_id, created_by, created_at) VALUES (?, ?, 'expired', ?, NULL, ?, ?)")
        .run(randomUUID(), r.id, -Number(r.balance), actor.name, now);
    }
    audit(db, actor.name, 'gift_vouchers_expired', 'entry', entry.id, { count: rows.length, amount });
    return { entryId: entry.id, count: rows.length, amount };
  });
}

export interface GiftReport { vouchers: GiftVoucherView[]; sold: number; used: number; outstanding: number; expiredUnused: number }

/** Every voucher (newest first) with the totals: sold, used, still owed, and what expired unused. */
export function giftReport(db: Db, limit = 500): GiftReport {
  const today = todayIso();
  const rows = db.prepare('SELECT * FROM gift_vouchers ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as Row[];
  const all = db.prepare("SELECT amount, balance, expires_on, status FROM gift_vouchers WHERE status = 'active'").all() as { amount: number; balance: number; expires_on: string | null }[];
  let sold = 0, used = 0, outstanding = 0, expiredUnused = 0;
  for (const r of all) {
    sold += Number(r.amount);
    used += Number(r.amount) - Number(r.balance);
    if (r.expires_on && r.expires_on < today) expiredUnused += Number(r.balance);
    else outstanding += Number(r.balance);
  }
  return { vouchers: rows.map((r) => view(r, today)), sold, used, outstanding, expiredUnused };
}
