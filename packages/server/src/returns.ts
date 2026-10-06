import { randomUUID } from 'node:crypto';
import {
  allocateDiscount, isIsoDate, remainingShare, returnKindOf, roundHalfUp,
  type EntryInput, type LineInput, type PaymentMode
} from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { conflict, invalid } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { assertValid, insertEntry, nextNumber } from './journal.ts';
import { getParty } from './parties.ts';
import { addStockMove, stockOf } from './items.ts';
import { getPostingAccounts, isPeriodLocked } from './settings.ts';
import { fromBase, getInvoice, returnedByLine, returnedTotals, type InvoiceView } from './invoices.ts';

export interface ReturnInput {
  date: string;
  /** cash = the money goes back through a safe or bank; credit = the customer's or supplier's balance changes */
  payment: PaymentMode;
  cashAccountCode?: string;
  notes?: string;
  /** Lines of the original invoice and how much of each comes back. */
  lines: { lineNo: number; qtyMilli: number }[];
}

interface ReturnLine {
  sourceLine: number;
  itemId: string;
  trackStock: boolean;
  qtyMilli: number;
  unitPrice: number;
  amount: number;
  discountShare: number;
  /** IQD value of the goods: back into stock (sales return) or out of stock (purchase return). */
  cost: number | null;
}

/**
 * Returns goods from a posted invoice (مردودات المبيعات / مردودات المشتريات) and posts it at once.
 * Prices and the discount follow the original invoice, so partial returns never give back more than was charged.
 * Sales return:    Dr sales (42) / Cr customer or safe;   Dr warehouse / Cr cost of sales (35), at the original cost.
 * Purchase return: Dr supplier or safe / Cr warehouse at the purchase cost; any difference goes to cost of sales.
 */
export function createReturn(db: Db, originalId: string, input: ReturnInput, user: string): InvoiceView {
  const original = getInvoice(db, originalId);
  if ((original.kind !== 'sale' && original.kind !== 'purchase') || original.status !== 'posted') {
    throw conflict('action_not_allowed', { status: original.status, action: 'return' });
  }
  if (original.installmentContract) throw conflict('invoice_has_contract', { contract: original.installmentContract.number });
  const kind = returnKindOf(original.kind);
  const errors: { code: string; line?: number; period?: string; available?: number }[] = [];
  if (!isIsoDate(input.date)) errors.push({ code: 'date_invalid' });
  else {
    if (input.date < original.date) errors.push({ code: 'return_before_invoice' });
    if (isPeriodLocked(db, input.date)) errors.push({ code: 'period_locked', period: input.date.slice(0, 7) });
  }
  if (input.payment === 'credit' && !original.partyId) errors.push({ code: 'party_required' });
  if (input.payment === 'cash') {
    const account = input.cashAccountCode?.startsWith('18') ? loadAccounts(db).find((a) => a.code === input.cashAccountCode) : undefined;
    if (!account || !account.postable) errors.push({ code: 'cash_account_invalid' });
  }

  const wanted = new Map<number, number>();
  input.lines.forEach((l, i) => {
    if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli < 0) errors.push({ code: 'line_qty_invalid', line: i + 1 });
    else if (l.qtyMilli > 0) wanted.set(l.lineNo, (wanted.get(l.lineNo) ?? 0) + l.qtyMilli);
  });
  if (wanted.size === 0 && !errors.some((e) => e.code === 'line_qty_invalid')) errors.push({ code: 'lines_required' });

  const returned = returnedByLine(db, originalId);
  const byLine = new Map(original.lines.map((l, index) => [l.lineNo, { line: l, index }]));
  for (const [lineNo, qty] of wanted) {
    const found = byLine.get(lineNo);
    if (!found) { errors.push({ code: 'item_invalid', line: lineNo }); continue; }
    const left = found.line.qtyMilli - (returned.get(lineNo)?.qtyMilli ?? 0);
    if (qty > left) errors.push({ code: 'return_qty_exceeded', line: lineNo, available: Math.max(0, left) });
  }
  if (errors.length) throw invalid(errors);

  const shares = allocateDiscount(original.lines.map((l) => l.amount), original.discount);
  const lines: ReturnLine[] = [...wanted.entries()].sort((a, b) => a[0] - b[0]).map(([lineNo, qty]) => {
    const { line: ol, index } = byLine.get(lineNo)!;
    const prev = returned.get(lineNo) ?? { qtyMilli: 0, amount: 0, discount: 0, cost: 0 };
    const share = shares[index] ?? 0;
    if (prev.amount > ol.amount || prev.discount > share || prev.discount > prev.amount) throw conflict('return_totals_invalid');
    const amount = remainingShare(ol.amount, prev.amount, qty, prev.qtyMilli, ol.qtyMilli);
    const discountLeft = share - prev.discount;
    // Keep both this refund and the remaining refund non-negative, even on a one-cent line.
    const discountShare = Math.max(0, discountLeft - (ol.amount - prev.amount - amount),
      Math.min(amount, remainingShare(share, prev.discount, qty, prev.qtyMilli, ol.qtyMilli)));
    return {
      sourceLine: lineNo, itemId: ol.itemId, trackStock: ol.trackStock, qtyMilli: qty, unitPrice: ol.unitPrice,
      amount, discountShare,
      cost: ol.cost === null ? null : remainingShare(ol.cost, prev.cost, qty, prev.qtyMilli, ol.qtyMilli)
    };
  });

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const discount = lines.reduce((s, l) => s + l.discountShare, 0);
  const total = subtotal - discount;
  if (total < 0 || lines.some((l) => l.discountShare > l.amount)) throw conflict('return_totals_invalid');
  const accounts = getPostingAccounts(db);
  const warehouseAccount = (db.prepare('SELECT account_code FROM warehouses WHERE id = ?').get(original.warehouseId) as { account_code: string }).account_code;
  const party = original.partyId ? getParty(db, original.partyId) : null;
  const counterAccount = input.payment === 'cash' ? input.cashAccountCode! : party!.accountCode;
  const counterParty = input.payment === 'credit' && party ? { partyId: party.id } : {};
  const { currency, rateX100 } = original;
  const refunded = returnedTotals(db, originalId);
  if (refunded.total > original.total || refunded.baseTotal > original.baseTotal) throw conflict('return_totals_invalid');
  const baseTotal = remainingShare(original.baseTotal, refunded.baseTotal, total, refunded.total, original.total);
  const entryLines: LineInput[] = [];
  const moves: { itemId: string; qtyMilli: number; value: number }[] = [];

  if (kind === 'sale_return') {
    if (total > 0) {
      entryLines.push({ accountCode: accounts.sales, debit: total, credit: 0, baseDebit: baseTotal, baseCredit: 0 });
      entryLines.push({ accountCode: counterAccount, debit: 0, credit: total, baseDebit: 0, baseCredit: baseTotal, ...counterParty });
    }
    const totalCost = lines.reduce((s, l) => s + (l.trackStock ? l.cost ?? 0 : 0), 0);
    if (totalCost > 0) {
      const cost = fromBase(totalCost, currency, rateX100);
      entryLines.push({ accountCode: warehouseAccount, debit: cost, credit: 0, baseDebit: totalCost, baseCredit: 0 });
      entryLines.push({ accountCode: accounts.costOfSales, debit: 0, credit: cost, baseDebit: 0, baseCredit: totalCost });
    }
    for (const l of lines) if (l.trackStock && l.cost !== null) moves.push({ itemId: l.itemId, qtyMilli: l.qtyMilli, value: l.cost });
  } else {
    // the goods must still be in the warehouse; they leave at their purchase cost, never more than the stock is worth
    const stock = new Map<string, { qtyMilli: number; value: number }>();
    const stockErrors: { code: string; line: number; available: number }[] = [];
    for (const l of lines) {
      if (!l.trackStock) continue;
      const s = stock.get(l.itemId) ?? stockOf(db, l.itemId, original.warehouseId);
      if (s.qtyMilli < l.qtyMilli) { stockErrors.push({ code: 'stock_insufficient', line: l.sourceLine, available: Math.max(0, s.qtyMilli) }); continue; }
      const value = s.qtyMilli === l.qtyMilli ? s.value : Math.max(0, Math.min(l.cost ?? 0, s.value));
      l.cost = value;
      stock.set(l.itemId, { qtyMilli: s.qtyMilli - l.qtyMilli, value: s.value - value });
      moves.push({ itemId: l.itemId, qtyMilli: -l.qtyMilli, value: -value });
    }
    if (stockErrors.length) throw invalid(stockErrors);
    const totalOut = lines.reduce((s, l) => s + (l.trackStock ? l.cost ?? 0 : 0), 0);
    const diff = baseTotal - totalOut;
    // amounts in the invoice currency split in the same proportion, so the entry balances in both currencies
    const warehouseCur = currency === 'IQD' ? totalOut : baseTotal > 0 ? roundHalfUp((total * totalOut) / baseTotal) : fromBase(totalOut, currency, rateX100);
    const diffCur = total - warehouseCur;
    if (total > 0) entryLines.push({ accountCode: counterAccount, debit: total, credit: 0, baseDebit: baseTotal, baseCredit: 0, ...counterParty });
    if (totalOut > 0) entryLines.push({ accountCode: warehouseAccount, debit: 0, credit: warehouseCur, baseDebit: 0, baseCredit: totalOut });
    if (diff > 0) entryLines.push({ accountCode: accounts.costOfSales, debit: 0, credit: diffCur, baseDebit: 0, baseCredit: diff });
    if (diff < 0) entryLines.push({ accountCode: accounts.costOfSales, debit: -diffCur, credit: 0, baseDebit: -diff, baseCredit: 0 });
  }

  const id = randomUUID();
  transaction(db, () => {
    const number = nextNumber(db, kind, input.date);
    const now = new Date().toISOString();
    // written as a draft first: posted invoices accept no new lines
    db.prepare(`INSERT INTO invoices (id, kind, status, date, party_id, warehouse_id, currency, rate_x100, payment, cash_account, discount, subtotal, total, notes, return_of,
                                      created_by, created_at, updated_at)
                VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, kind, input.date, original.partyId, original.warehouseId, currency, rateX100, input.payment, input.payment === 'cash' ? input.cashAccountCode! : null,
        discount, subtotal, total, input.notes?.trim() || null, originalId, user, now, now);
    const insert = db.prepare(`INSERT INTO invoice_lines (invoice_id, line_no, item_id, description, qty_milli, unit_price, amount, cost, source_line, discount_share)
                               VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`);
    lines.forEach((l, i) => insert.run(id, i + 1, l.itemId, l.qtyMilli, l.unitPrice, l.amount, l.cost, l.sourceLine, l.discountShare));

    let entryId: string | null = null;
    if (entryLines.length >= 2) {
      const entry: EntryInput = {
        type: kind, date: input.date, currency, rateX100, lines: entryLines,
        description: [party?.name, `↩ ${original.number}`, input.notes?.trim()].filter(Boolean).join(' — '),
        ...(party ? { party: party.name } : {})
      };
      assertValid(db, entry);
      entryId = insertEntry(db, entry, user, input.payment === 'cash' ? input.cashAccountCode! : null);
      db.prepare(`UPDATE entries SET status = 'approved', number = ?, checked_by = ?, checked_at = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
        .run(number, user, now, user, now, now, entryId);
    }
    for (const m of moves) addStockMove(db, { ...m, warehouseId: original.warehouseId, date: input.date, sourceType: kind, sourceId: id });
    db.prepare(`UPDATE invoices SET status = 'posted', number = ?, entry_id = ?, posted_by = ?, posted_at = ?, updated_at = ? WHERE id = ?`)
      .run(number, entryId, user, now, now, id);
    audit(db, user, 'post', 'invoice', id, { kind, number, returnOf: original.number });
  });
  return getInvoice(db, id);
}
