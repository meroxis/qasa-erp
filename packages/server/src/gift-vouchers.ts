import { randomInt, randomUUID } from 'node:crypto';
import { isIsoDate, todayIso, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { audit } from './audit.ts';
import { conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
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
 * receipt reversed: the money goes back to the customer). A voucher a refund made (goods paid by a voucher past its
 * date came back) has no receipt of its own: cancelling it pays the customer out of a safe, with its own entry. A
 * return cancelled takes back what it put on vouchers, and is refused once they spent it.
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
  /** made by a refund (not sold at a till): cancelling it pays the customer out of a safe the admin names */
  fromRefund: boolean;
}

interface Row {
  id: string; code: string; amount: number; balance: number; currency: 'IQD'; expires_on: string | null; status: 'active' | 'cancelled';
  account_code: string; shift_id: string | null; entry_id: string | null; created_by: string; created_at: string;
}

const view = (r: Row, today = todayIso()): GiftVoucherView => ({
  id: r.id, code: r.code, amount: Number(r.amount), balance: Number(r.balance), currency: 'IQD', expiresOn: r.expires_on, status: r.status,
  createdBy: r.created_by, createdAt: r.created_at, fromRefund: !r.shift_id,
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
  // a real day of the calendar (never 2026-13-45, which would sort as a date and never expire as one)
  if (input.expiresOn !== undefined && (!isIsoDate(input.expiresOn) || input.expiresOn < today)) throw invalid([{ code: 'gv_expiry_invalid' }]);
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

export interface VoucherBack { voucherId: string; code: string; accountCode: string; amount: number }

/**
 * A return of goods gift vouchers paid for: how that share (`amount`) goes back, each voucher its own part. A voucher
 * never gets back more than it paid on this sale less what earlier returns already gave it back, so no return puts on
 * a voucher what another voucher (or money) paid; the shares follow what is still out on each, and the last takes
 * the remainder to the dinar.
 */
export function planVoucherBack(db: Db, originalId: string, amount: number): VoucherBack[] {
  const paid = db.prepare(`SELECT v.id, v.code, v.account_code, -SUM(m.amount) AS paid, MIN(m.created_at) AS first_at FROM gift_voucher_moves m JOIN gift_vouchers v ON v.id = m.voucher_id
                           WHERE m.invoice_id = ? AND m.kind IN ('redeemed', 'restored') GROUP BY v.id, v.code, v.account_code ORDER BY first_at, v.code`).all(originalId) as
    { id: string; code: string; account_code: string; paid: number }[];
  const back = db.prepare(`SELECT COALESCE(m.for_voucher_id, m.voucher_id) AS id, SUM(m.amount) AS back FROM gift_voucher_moves m JOIN invoices r ON r.id = m.invoice_id
                           WHERE r.return_of = ? AND m.kind = 'returned' GROUP BY COALESCE(m.for_voucher_id, m.voucher_id)`).all(originalId) as { id: string; back: number }[];
  const given = new Map(back.map((b) => [b.id, Number(b.back)]));
  const open = paid.map((v) => ({ voucherId: v.id, code: v.code, accountCode: v.account_code, left: Math.max(0, Number(v.paid) - (given.get(v.id) ?? 0)) })).filter((v) => v.left > 0);
  const out = open.reduce((sum, v) => sum + v.left, 0);
  const share = Math.min(amount, out);
  if (share <= 0) return [];
  const plan: VoucherBack[] = [];
  let rest = share;
  open.forEach((v, i) => {
    const part = i === open.length - 1 ? rest : Math.min(v.left, rest, Math.round((share * v.left) / out));
    rest -= part;
    if (part > 0) plan.push({ voucherId: v.voucherId, code: v.code, accountCode: v.accountCode, amount: part });
  });
  // what rounding left over goes to whichever still has room
  for (const v of open) {
    if (rest <= 0) break;
    const has = plan.find((x) => x.voucherId === v.voucherId);
    const room = v.left - (has?.amount ?? 0);
    const more = Math.min(room, rest);
    if (more <= 0) continue;
    if (has) has.amount += more; else plan.push({ voucherId: v.voucherId, code: v.code, accountCode: v.accountCode, amount: more });
    rest -= more;
  }
  return plan;
}

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** the shortest life a voucher made for a refund gets */
const REFUND_VOUCHER_DAYS = 30;

/**
 * The shares of planVoucherBack put back, each onto its own voucher, never as money. A voucher's `amount` (what it was
 * sold for) never changes. One that can no longer be used (cancelled, or past its date: the customer would hold a
 * refund they can't spend) gets a new voucher instead, good for as long as the first one was (thirty days at least),
 * whose code is on the return's answer, in the audit log and in the voucher list. Inside the return's transaction;
 * its entry credits the vouchers' accounts.
 */
export function giveBackToVoucher(db: Db, input: { returnId: string; entryId: string | null; plan: readonly VoucherBack[] }, user: string): { voucherId: string; code: string; amount: number; made: boolean }[] {
  const now = new Date().toISOString();
  const today = todayIso();
  const done: { voucherId: string; code: string; amount: number; made: boolean }[] = [];
  for (const p of input.plan) {
    const v = db.prepare('SELECT id, code, status, expires_on, created_at FROM gift_vouchers WHERE id = ?').get(p.voucherId) as
      { id: string; code: string; status: string; expires_on: string | null; created_at: string };
    const usable = v.status === 'active' && (!v.expires_on || v.expires_on >= today);
    let target = { id: v.id, code: v.code };
    if (usable) {
      const changed = db.prepare('UPDATE gift_vouchers SET balance = balance + ? WHERE id = ? AND balance + ? <= amount').run(p.amount, v.id, p.amount);
      if (Number(changed.changes) !== 1) throw conflict('gv_balance');
    } else {
      const id = randomUUID();
      let code = newVoucherCode();
      while (db.prepare('SELECT 1 FROM gift_vouchers WHERE code = ?').get(code)) code = newVoucherCode();
      const life = v.expires_on ? Math.round((Date.parse(`${v.expires_on}T00:00:00.000Z`) - Date.parse(`${v.created_at.slice(0, 10)}T00:00:00.000Z`)) / 86_400_000) : 0;
      const expiresOn = v.expires_on ? addDays(today, Math.max(REFUND_VOUCHER_DAYS, life)) : null;
      // it has no entry of its own: what it holds is in the return's entry, which stays the return's alone (cancelling
      // this voucher never reverses a return: cancelGiftVoucher)
      db.prepare(`INSERT INTO gift_vouchers (id, code, amount, balance, currency, expires_on, status, account_code, shift_id, entry_id, created_by, created_at)
                  VALUES (?, ?, ?, ?, 'IQD', ?, 'active', ?, NULL, NULL, ?, ?)`)
        .run(id, code, p.amount, p.amount, expiresOn, p.accountCode, user, now);
      target = { id, code };
    }
    db.prepare("INSERT INTO gift_voucher_moves (id, voucher_id, kind, amount, invoice_id, for_voucher_id, created_by, created_at) VALUES (?, ?, 'returned', ?, ?, ?, ?, ?)")
      .run(randomUUID(), target.id, p.amount, input.returnId, p.voucherId, user, now);
    audit(db, user, 'gift_voucher_returned', 'gift_voucher', target.id, { code: target.code, amount: p.amount, returnId: input.returnId, made: !usable, ...(usable ? {} : { instead: v.code }) });
    done.push({ voucherId: target.id, code: target.code, amount: p.amount, made: !usable });
  }
  return done;
}

/** The vouchers a return gave money back onto (the till shows the codes: a new voucher's code is nowhere else for the customer). */
export function vouchersOfReturn(db: Db, returnId: string): { code: string; amount: number; made: boolean }[] {
  return (db.prepare(`SELECT v.code, m.amount, m.for_voucher_id, m.voucher_id FROM gift_voucher_moves m JOIN gift_vouchers v ON v.id = m.voucher_id
                      WHERE m.invoice_id = ? AND m.kind = 'returned' AND m.amount > 0 ORDER BY m.created_at, v.code`).all(returnId) as { code: string; amount: number; for_voucher_id: string | null; voucher_id: string }[])
    .map((r) => ({ code: r.code, amount: Number(r.amount), made: !!r.for_voucher_id && r.for_voucher_id !== r.voucher_id }));
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

/**
 * A sales return cancelled: what it put back on gift vouchers is taken off them again (the return's entry, reversed,
 * takes it out of the books), and a voucher the return made is cancelled. Refused when a voucher no longer holds it
 * (spent since, or written off after its date): the money is gone, and the return stands. Called from cancelInvoice,
 * inside its transaction.
 */
export function takeBackReturnedVouchers(db: Db, returnId: string, user: string): void {
  const moves = db.prepare(`SELECT m.voucher_id, m.for_voucher_id, v.code, SUM(m.amount) AS amount FROM gift_voucher_moves m JOIN gift_vouchers v ON v.id = m.voucher_id
                            WHERE m.invoice_id = ? AND m.kind = 'returned' GROUP BY m.voucher_id, m.for_voucher_id, v.code ORDER BY v.code`).all(returnId) as
    { voucher_id: string; for_voucher_id: string | null; code: string; amount: number }[];
  const now = new Date().toISOString();
  for (const m of moves) {
    const back = Number(m.amount);
    if (back <= 0) continue;
    const taken = db.prepare("UPDATE gift_vouchers SET balance = balance - ? WHERE id = ? AND status = 'active' AND balance >= ?").run(back, m.voucher_id, back);
    if (Number(taken.changes) !== 1) throw conflict('gv_return_spent', { voucher: m.code });
    db.prepare("INSERT INTO gift_voucher_moves (id, voucher_id, kind, amount, invoice_id, for_voucher_id, created_by, created_at) VALUES (?, ?, 'returned', ?, ?, ?, ?, ?)")
      .run(randomUUID(), m.voucher_id, -back, returnId, m.for_voucher_id, user, now);
    // a voucher this return made holds nothing now and never will: cancelled with it
    const made = !!m.for_voucher_id && m.for_voucher_id !== m.voucher_id;
    if (made) db.prepare("UPDATE gift_vouchers SET status = 'cancelled' WHERE id = ? AND balance = 0").run(m.voucher_id);
    audit(db, user, 'gift_voucher_return_cancelled', 'gift_voucher', m.voucher_id, { code: m.code, amount: back, returnId, made });
  }
}

/**
 * An unused voucher cancelled by an admin. One sold at a till: its receipt is reversed (the money is paid back out of
 * the safe it went into). One a refund made has no receipt (what it holds came from a return's entry, which is the
 * return's alone): the customer is paid in cash instead, with the voucher's own payment out of `cashAccountCode`, a
 * safe the admin names (round four of the review: never a safe nobody chose): Dr gift vouchers / Cr the safe.
 * Either way the money leaves a safe: a shift open on it counts it (pos.ts: the selling shift's voucher cash while
 * that shift is open, else the other cash of the shift open on the safe).
 */
export function cancelGiftVoucher(db: Db, id: string, actor: { id: string | null; name: string }, cashAccountCode?: string): GiftVoucherView {
  const user = actor.name;
  const r = db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw notFound('gift_voucher');
  if (r.status !== 'active') throw conflict('gv_cancelled');
  if (Number(r.balance) !== Number(r.amount)) throw conflict('gv_used');
  // sold at a till (it has that shift, and its own receipt); else made by a refund
  const sold = !!r.shift_id;
  if (!sold) {
    const safe = cashAccountCode?.startsWith('18') ? loadAccounts(db).find((a) => a.code === cashAccountCode) : undefined;
    if (!safe || !safe.postable) throw invalid([{ code: 'gv_cancel_safe_required' }]);
  }
  const reversal = sold
    ? (r.entry_id ? reverseEntryInternal(db, r.entry_id, user) : null)
    : postVoucherNow(db, {
      kind: 'payment', date: todayIso(), cashAccountCode: cashAccountCode!, currency: 'IQD', rateX100: 100,
      description: `${GIFT_NAMES.en} ${r.code}`, items: [{ accountCode: r.account_code, amount: Number(r.amount), description: r.code }]
    }, actor);
  db.prepare("UPDATE gift_vouchers SET status = 'cancelled', balance = 0, cancel_entry_id = ? WHERE id = ?").run(reversal, id);
  db.prepare("INSERT INTO gift_voucher_moves (id, voucher_id, kind, amount, invoice_id, created_by, created_at) VALUES (?, ?, 'cancelled', ?, NULL, ?, ?)")
    .run(randomUUID(), id, -Number(r.amount), user, new Date().toISOString());
  audit(db, user, 'cancel', 'gift_voucher', id, { code: r.code, amount: Number(r.amount), reversal });
  return getGiftVoucher(db, id);
}

/**
 * Cash a shift took for vouchers it sold (those cancelled since are paid back, so not expected in the drawer): what
 * they were sold for, from the 'sold' moves, whatever came back onto them since (a refund is no cash in the drawer).
 */
export function giftCashOf(db: Db, shiftId: string): number {
  const r = db.prepare(`SELECT COALESCE(SUM(m.amount), 0) AS total FROM gift_voucher_moves m JOIN gift_vouchers v ON v.id = m.voucher_id
                        WHERE v.shift_id = ? AND v.status = 'active' AND m.kind = 'sold'`).get(shiftId) as { total: number };
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

/** 2.0.0: the gift vouchers of one shift for its X/Z report: sold at this till (count and amount), and used on its sales (less what came back). */
export function giftOfShift(db: Db, shiftId: string): { soldCount: number; sold: number; used: number } {
  const sold = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(m.amount), 0) AS total FROM gift_voucher_moves m JOIN gift_vouchers v ON v.id = m.voucher_id
                           WHERE v.shift_id = ? AND v.status = 'active' AND m.kind = 'sold'`).get(shiftId) as { n: number; total: number };
  // a redemption is kept as a minus on the voucher, a restore (the sale cancelled) as a plus: their sum, turned round
  const used = db.prepare(`SELECT COALESCE(SUM(m.amount), 0) AS total FROM gift_voucher_moves m JOIN pos_sales s ON s.invoice_id = m.invoice_id
                           WHERE s.shift_id = ? AND m.kind IN ('redeemed', 'restored')`).get(shiftId) as { total: number };
  return { soldCount: Number(sold.n), sold: Number(sold.total), used: Math.max(0, -Number(used.total)) };
}

export interface GiftReport { vouchers: GiftVoucherView[]; sold: number; used: number; outstanding: number; expiredUnused: number }

/** Every voucher (newest first) with the totals: sold, used, still owed, and what expired unused. */
export function giftReport(db: Db, limit = 500): GiftReport {
  const today = todayIso();
  const rows = db.prepare('SELECT * FROM gift_vouchers ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as Row[];
  const all = db.prepare("SELECT balance, expires_on FROM gift_vouchers WHERE status = 'active'").all() as { balance: number; expires_on: string | null }[];
  // sold: what was paid for vouchers (a voucher made for a refund was not sold); used: what sales took, less what
  // cancels and returns put back
  const moved = db.prepare(`SELECT m.kind, COALESCE(SUM(m.amount), 0) AS total FROM gift_voucher_moves m JOIN gift_vouchers v ON v.id = m.voucher_id
                            WHERE v.status = 'active' AND m.kind IN ('sold', 'redeemed', 'restored', 'returned') GROUP BY m.kind`).all() as { kind: string; total: number }[];
  const sum = (kind: string) => Number(moved.find((m) => m.kind === kind)?.total ?? 0);
  const sold = sum('sold');
  const used = Math.max(0, -(sum('redeemed') + sum('restored') + sum('returned')));
  let outstanding = 0, expiredUnused = 0;
  for (const r of all) {
    if (r.expires_on && r.expires_on < today) expiredUnused += Number(r.balance);
    else outstanding += Number(r.balance);
  }
  return { vouchers: rows.map((r) => view(r, today)), sold, used, outstanding, expiredUnused };
}
