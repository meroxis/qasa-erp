import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { costOut, isIsoDate, lineAmount, todayIso, type EntryInput, type Names, type UnitCode } from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { assertValid, insertEntry, nextNumber, reverseEntryInternal } from './journal.ts';
import { addStockMove, stockOf } from './items.ts';
import { isPeriodLocked, readSetting, writeSetting } from './settings.ts';
import type { Actor } from './auth.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Stock adjustments (every plan): goods that leave a warehouse without a sale (damaged, lost, expired, used in the
 * company, issued to a job order) or come in without a purchase (a count surplus), at cost. A line takes out (−) at the
 * warehouse's weighted average cost or adds (+) at a given unit cost (else the current average). Posting makes one
 * IQD journal entry at once, as stock documents do: what leaves is Dr the reason's loss or expense account / Cr the
 * warehouse's stock account; what comes in is Dr the warehouse / Cr the gain account. Issued to a job, the cost is
 * also counted as the job's materials (job_costs, by the entry). Cancelling reverses the entry and the stock moves.
 * The count mode turns counted quantities into such lines (reason "count").
 */

export const ADJUSTMENT_REASONS = ['damaged', 'lost', 'expired', 'count', 'internal_use', 'job', 'other'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];
export type AdjustmentStatus = 'draft' | 'posted' | 'cancelled';
export type AdjustmentAction = 'edit' | 'delete' | 'post' | 'cancel';

/** Where the value goes by default: losses and other expenses (39), commodity supplies (32), other revenue (49). */
export interface AdjustmentAccounts {
  damaged: string;
  lost: string;
  expired: string;
  internal_use: string;
  job: string;
  other: string;
  /** a count shortage */
  count: string;
  /** what comes in (a count surplus, goods found) */
  gain: string;
}

export const DEFAULT_ADJUSTMENT_ACCOUNTS: AdjustmentAccounts = {
  damaged: '39', lost: '39', expired: '39', internal_use: '32', job: '32', other: '39', count: '39', gain: '49'
};

const SETTING = 'adjustment_accounts';

export interface AdjustmentLineInput { itemId: string; qtyMilli: number; unitCost?: number | undefined }

export interface AdjustmentInput {
  date: string;
  warehouseId: string;
  reason: AdjustmentReason;
  /** Overrides the reason's default account for what leaves. */
  accountCode?: string | undefined;
  jobId?: string | undefined;
  notes?: string | undefined;
  lines: AdjustmentLineInput[];
}

export interface AdjustmentLineView {
  seq: number;
  itemId: string;
  itemCode: string;
  itemName: Names;
  unit: UnitCode;
  qtyMilli: number;
  unitCost: number | null;
  /** IQD value that moved (positive in, negative out); set once posted. */
  value: number | null;
  /** On hand in the warehouse now. */
  stockMilli: number;
}

export interface AdjustmentSummary {
  id: string;
  number: string | null;
  date: string;
  status: AdjustmentStatus;
  reason: AdjustmentReason;
  warehouseId: string;
  warehouseName: Names;
  lineCount: number;
  /** IQD: what left and what came in, once posted. */
  valueOut: number;
  valueIn: number;
  job: { id: string; number: string; title: string } | null;
  notes: string;
  createdBy: string;
}

export interface AdjustmentView extends AdjustmentSummary {
  accountCode: string;
  accountName: Names | null;
  gainAccountCode: string;
  entry: { id: string; number: string | null } | null;
  reversal: { id: string; number: string | null } | null;
  createdAt: string;
  lines: AdjustmentLineView[];
  actions: AdjustmentAction[];
}

interface Row {
  id: string; number: string | null; date: string; warehouse_id: string; reason: AdjustmentReason; account_code: string | null; job_id: string | null;
  status: AdjustmentStatus; entry_id: string | null; notes: string | null; created_by: string; created_at: string;
  w_ar: string; w_en: string; w_ku: string;
}

const SELECT = `SELECT a.*, w.name_ar AS w_ar, w.name_en AS w_en, w.name_ku AS w_ku
                FROM stock_adjustments a JOIN warehouses w ON w.id = a.warehouse_id`;

export function adjustmentAccounts(db: Db): AdjustmentAccounts {
  let stored: Partial<AdjustmentAccounts> = {};
  try {
    stored = JSON.parse(readSetting(db, SETTING) ?? '{}') as Partial<AdjustmentAccounts>;
  } catch {
    stored = {};
  }
  return { ...DEFAULT_ADJUSTMENT_ACCOUNTS, ...stored };
}

function postableAccount(db: Db, code: string | undefined | null): boolean {
  if (!code) return false;
  const a = loadAccounts(db).find((x) => x.code === code);
  // any postable account except stock itself
  return !!a && a.postable && !a.code.startsWith('13');
}

export function updateAdjustmentAccounts(db: Db, patch: Partial<AdjustmentAccounts>, actor: Actor): AdjustmentAccounts {
  const next = { ...adjustmentAccounts(db), ...patch };
  const errors = (Object.keys(next) as (keyof AdjustmentAccounts)[])
    .filter((k) => !postableAccount(db, next[k])).map((k) => ({ code: 'account_invalid', field: k }));
  if (errors.length) throw invalid(errors);
  transaction(db, () => {
    writeSetting(db, SETTING, JSON.stringify(next));
    audit(db, actor.name, 'update', 'adjustment_settings', null, patch);
  });
  return next;
}

const lossAccountOf = (db: Db, row: { reason: AdjustmentReason; account_code: string | null }) =>
  row.account_code ?? adjustmentAccounts(db)[row.reason];

function jobOf(db: Db, jobId: string | null): { id: string; number: string; title: string } | null {
  if (!jobId) return null;
  const j = db.prepare('SELECT id, number, title FROM jobs WHERE id = ?').get(jobId) as { id: string; number: string; title: string } | undefined;
  return j ?? null;
}

/** IQD that moved by line (from the stock moves the posting made), out negative. */
function movedValues(db: Db, id: string): Map<string, { qty: number; value: number }[]> {
  const rows = db.prepare("SELECT item_id, qty_milli, value FROM stock_moves WHERE source_type = 'adjustment' AND source_id = ? ORDER BY id")
    .all(id) as { item_id: string; qty_milli: number; value: number }[];
  const map = new Map<string, { qty: number; value: number }[]>();
  for (const r of rows) {
    const list = map.get(r.item_id) ?? [];
    list.push({ qty: Number(r.qty_milli), value: Number(r.value) });
    map.set(r.item_id, list);
  }
  return map;
}

function actionsFor(row: Row): AdjustmentAction[] {
  if (row.status === 'draft') return ['edit', 'delete', 'post'];
  if (row.status === 'posted') return ['cancel'];
  return [];
}

function loadRow(db: Db, id: string): Row {
  const row = db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as Row | undefined;
  if (!row) throw notFound('adjustment');
  return row;
}

function totalsOf(db: Db, id: string): { out: number; in: number } {
  const t = db.prepare(`SELECT COALESCE(SUM(CASE WHEN value < 0 THEN -value ELSE 0 END), 0) AS out_v,
                               COALESCE(SUM(CASE WHEN value > 0 THEN value ELSE 0 END), 0) AS in_v
                        FROM stock_moves WHERE source_type = 'adjustment' AND source_id = ?`).get(id) as { out_v: number; in_v: number };
  return { out: Number(t.out_v), in: Number(t.in_v) };
}

function summaryOf(db: Db, r: Row, lineCount: number): AdjustmentSummary {
  const totals = r.status === 'draft' ? { out: 0, in: 0 } : totalsOf(db, r.id);
  return {
    id: r.id, number: r.number, date: r.date, status: r.status, reason: r.reason, warehouseId: r.warehouse_id,
    warehouseName: { ar: r.w_ar, en: r.w_en, ku: r.w_ku }, lineCount, valueOut: totals.out, valueIn: totals.in,
    job: jobOf(db, r.job_id), notes: r.notes ?? '', createdBy: r.created_by
  };
}

export function getAdjustment(db: Db, id: string): AdjustmentView {
  const r = loadRow(db, id);
  const lines = db.prepare(`SELECT l.seq, l.item_id, l.qty_milli, l.unit_cost, i.code, i.name_ar, i.name_en, i.name_ku, i.unit
                            FROM stock_adjustment_lines l JOIN items i ON i.id = l.item_id WHERE l.adjustment_id = ? ORDER BY l.seq`)
    .all(id) as { seq: number; item_id: string; qty_milli: number; unit_cost: number | null; code: string; name_ar: string; name_en: string; name_ku: string; unit: UnitCode }[];
  const moved = r.status === 'draft' ? new Map<string, { qty: number; value: number }[]>() : movedValues(db, id);
  const account = lossAccountOf(db, r);
  const accounts = loadAccounts(db);
  const acc = accounts.find((a) => a.code === account);
  const entry = r.entry_id
    ? (db.prepare('SELECT id, number, reversed_by_id FROM entries WHERE id = ?').get(r.entry_id) as { id: string; number: string | null; reversed_by_id: string | null } | undefined)
    : undefined;
  const reversal = entry?.reversed_by_id
    ? (db.prepare('SELECT id, number FROM entries WHERE id = ?').get(entry.reversed_by_id) as { id: string; number: string | null } | undefined)
    : undefined;
  return {
    ...summaryOf(db, r, lines.length),
    accountCode: account, accountName: acc?.name ?? null, gainAccountCode: adjustmentAccounts(db).gain,
    entry: entry ? { id: entry.id, number: entry.number } : null,
    reversal: reversal ? { id: reversal.id, number: reversal.number } : null,
    createdAt: r.created_at,
    lines: lines.map((l) => {
      // the posting's own move for this line (an item can be on several lines: taken in order)
      const list = moved.get(l.item_id);
      const m = list?.shift();
      return {
        seq: l.seq, itemId: l.item_id, itemCode: l.code, itemName: { ar: l.name_ar, en: l.name_en, ku: l.name_ku }, unit: l.unit,
        qtyMilli: Number(l.qty_milli), unitCost: l.unit_cost === null ? null : Number(l.unit_cost), value: m ? m.value : null,
        stockMilli: stockOf(db, l.item_id, r.warehouse_id).qtyMilli
      };
    }),
    actions: actionsFor(r)
  };
}

export function listAdjustments(db: Db, f: { status?: AdjustmentStatus | undefined; warehouseId?: string | undefined; reason?: AdjustmentReason | undefined; limit?: number | undefined } = {}): AdjustmentSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (f.status) { where.push('a.status = ?'); params.push(f.status); }
  if (f.warehouseId) { where.push('a.warehouse_id = ?'); params.push(f.warehouseId); }
  if (f.reason) { where.push('a.reason = ?'); params.push(f.reason); }
  const limit = Math.min(f.limit ?? 200, 1000);
  const rows = db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.date DESC, a.created_at DESC LIMIT ${limit}`)
    .all(...params) as unknown as Row[];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const counts = new Map((db.prepare(`SELECT adjustment_id AS id, COUNT(*) AS n FROM stock_adjustment_lines WHERE adjustment_id IN (${marks}) GROUP BY adjustment_id`)
    .all(...ids) as { id: string; n: number }[]).map((x) => [x.id, Number(x.n)]));
  const totals = new Map((db.prepare(`SELECT source_id AS id, COALESCE(SUM(CASE WHEN value < 0 THEN -value ELSE 0 END), 0) AS out_v,
                                             COALESCE(SUM(CASE WHEN value > 0 THEN value ELSE 0 END), 0) AS in_v
                                      FROM stock_moves WHERE source_type = 'adjustment' AND source_id IN (${marks}) GROUP BY source_id`)
    .all(...ids) as { id: string; out_v: number; in_v: number }[]).map((x) => [x.id, { out: Number(x.out_v), in: Number(x.in_v) }]));
  const jobIds = [...new Set(rows.map((r) => r.job_id).filter((x): x is string => !!x))];
  const jobs = new Map(jobIds.length
    ? (db.prepare(`SELECT id, number, title FROM jobs WHERE id IN (${jobIds.map(() => '?').join(',')})`).all(...jobIds) as { id: string; number: string; title: string }[]).map((j) => [j.id, j])
    : []);
  return rows.map((r) => {
    const t = totals.get(r.id) ?? { out: 0, in: 0 };
    return {
      id: r.id, number: r.number, date: r.date, status: r.status, reason: r.reason, warehouseId: r.warehouse_id,
      warehouseName: { ar: r.w_ar, en: r.w_en, ku: r.w_ku }, lineCount: counts.get(r.id) ?? 0, valueOut: t.out, valueIn: t.in,
      job: r.job_id ? jobs.get(r.job_id) ?? null : null, notes: r.notes ?? '', createdBy: r.created_by
    };
  });
}

function assertInput(db: Db, input: AdjustmentInput): void {
  const errors: { code: string; line?: number; period?: string; field?: string }[] = [];
  if (!isIsoDate(input.date)) errors.push({ code: 'date_invalid' });
  else if (isPeriodLocked(db, input.date)) errors.push({ code: 'period_locked', period: input.date.slice(0, 7) });
  const wh = db.prepare('SELECT active FROM warehouses WHERE id = ?').get(input.warehouseId) as { active: number } | undefined;
  if (!wh || Number(wh.active) !== 1) errors.push({ code: 'warehouse_invalid' });
  if (!(ADJUSTMENT_REASONS as readonly string[]).includes(input.reason)) errors.push({ code: 'adj_reason_invalid' });
  if (input.accountCode !== undefined && !postableAccount(db, input.accountCode)) errors.push({ code: 'account_invalid', field: 'accountCode' });
  if (input.reason === 'job') {
    if (!input.jobId) errors.push({ code: 'adj_job_required' });
    else {
      const job = db.prepare('SELECT status FROM jobs WHERE id = ?').get(input.jobId) as { status: string } | undefined;
      if (!job || job.status === 'cancelled') errors.push({ code: 'adj_job_invalid' });
    }
  } else if (input.jobId) errors.push({ code: 'adj_job_only_for_job' });
  if (!Array.isArray(input.lines) || input.lines.length === 0) errors.push({ code: 'lines_required' });
  else {
    const find = db.prepare('SELECT track_stock, active FROM items WHERE id = ?');
    input.lines.forEach((l, i) => {
      const item = find.get(l.itemId) as { track_stock: number; active: number } | undefined;
      if (!item || Number(item.active) !== 1) errors.push({ code: 'item_invalid', line: i + 1 });
      else if (Number(item.track_stock) !== 1) errors.push({ code: 'item_not_stock', line: i + 1 });
      if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli === 0) errors.push({ code: 'line_qty_invalid', line: i + 1 });
      else if (input.reason === 'job' && l.qtyMilli > 0) errors.push({ code: 'adj_job_outs_only', line: i + 1 });
      if (l.unitCost !== undefined && (!Number.isSafeInteger(l.unitCost) || l.unitCost < 0)) errors.push({ code: 'line_price_invalid', line: i + 1 });
    });
  }
  if (errors.length) throw invalid(errors);
}

function writeLines(db: Db, id: string, lines: AdjustmentLineInput[]): void {
  db.prepare('DELETE FROM stock_adjustment_lines WHERE adjustment_id = ?').run(id);
  const insert = db.prepare('INSERT INTO stock_adjustment_lines (adjustment_id, seq, item_id, qty_milli, unit_cost) VALUES (?, ?, ?, ?, ?)');
  lines.forEach((l, i) => insert.run(id, i + 1, l.itemId, l.qtyMilli, l.qtyMilli > 0 && l.unitCost !== undefined ? l.unitCost : null));
}

export function createAdjustment(db: Db, input: AdjustmentInput, actor: Actor): AdjustmentView {
  assertInput(db, input);
  const id = randomUUID();
  transaction(db, () => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO stock_adjustments (id, number, date, warehouse_id, reason, account_code, job_id, status, entry_id, notes, created_by, created_at, updated_at)
                VALUES (?, NULL, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?, ?)`)
      .run(id, input.date, input.warehouseId, input.reason, input.accountCode ?? null, input.jobId ?? null, input.notes?.trim() || null, actor.name, now, now);
    writeLines(db, id, input.lines);
    audit(db, actor.name, 'create', 'adjustment', id, { reason: input.reason, lines: input.lines.length });
  });
  return getAdjustment(db, id);
}

export function updateAdjustment(db: Db, id: string, input: AdjustmentInput, actor: Actor): AdjustmentView {
  const row = loadRow(db, id);
  if (row.status !== 'draft') throw conflict('action_not_allowed', { status: row.status, action: 'edit' });
  assertInput(db, input);
  transaction(db, () => {
    db.prepare('UPDATE stock_adjustments SET date = ?, warehouse_id = ?, reason = ?, account_code = ?, job_id = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(input.date, input.warehouseId, input.reason, input.accountCode ?? null, input.jobId ?? null, input.notes?.trim() || null, new Date().toISOString(), id);
    writeLines(db, id, input.lines);
    audit(db, actor.name, 'update', 'adjustment', id);
  });
  return getAdjustment(db, id);
}

export function deleteAdjustment(db: Db, id: string, actor: Actor): void {
  const row = loadRow(db, id);
  if (row.status !== 'draft') throw conflict('action_not_allowed', { status: row.status, action: 'delete' });
  transaction(db, () => {
    db.prepare('DELETE FROM stock_adjustment_lines WHERE adjustment_id = ?').run(id);
    db.prepare('DELETE FROM stock_adjustments WHERE id = ?').run(id);
    audit(db, actor.name, 'delete', 'adjustment', id);
  });
}

function warehouseAccount(db: Db, warehouseId: string): string {
  return (db.prepare('SELECT account_code FROM warehouses WHERE id = ?').get(warehouseId) as { account_code: string }).account_code;
}

const REASON_WORDS: Record<AdjustmentReason, string> = {
  damaged: 'Damaged goods', lost: 'Lost goods', expired: 'Expired goods', count: 'Stock count difference',
  internal_use: 'Used in the company', job: 'Issued to a job', other: 'Stock adjustment'
};

export function postAdjustment(db: Db, id: string, actor: Actor): AdjustmentView {
  const row = loadRow(db, id);
  if (row.status !== 'draft') throw conflict('action_not_allowed', { status: row.status, action: 'post' });
  const view = getAdjustment(db, id);
  assertInput(db, {
    date: view.date, warehouseId: view.warehouseId, reason: view.reason, accountCode: row.account_code ?? undefined, jobId: row.job_id ?? undefined,
    lines: view.lines.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli, unitCost: l.unitCost ?? undefined }))
  });
  const lossAccount = lossAccountOf(db, row);
  const gainAccount = adjustmentAccounts(db).gain;
  if (!postableAccount(db, lossAccount)) throw invalid([{ code: 'account_invalid', field: 'accountCode' }]);
  if (view.lines.some((l) => l.qtyMilli > 0) && !postableAccount(db, gainAccount)) throw invalid([{ code: 'account_invalid', field: 'gain' }]);

  // work through the lines in order, as the stock stands after each one
  const stock = new Map<string, { qtyMilli: number; value: number }>();
  const errors: { code: string; line: number; available?: number }[] = [];
  const moves: { itemId: string; qtyMilli: number; value: number }[] = [];
  for (const l of view.lines) {
    const s = stock.get(l.itemId) ?? stockOf(db, l.itemId, view.warehouseId);
    if (l.qtyMilli < 0) {
      const out = -l.qtyMilli;
      if (s.qtyMilli < out) errors.push({ code: 'stock_insufficient', line: l.seq, available: Math.max(0, s.qtyMilli) });
      const value = costOut(s.qtyMilli, s.value, out);
      stock.set(l.itemId, { qtyMilli: s.qtyMilli - out, value: s.value - value });
      moves.push({ itemId: l.itemId, qtyMilli: l.qtyMilli, value: -value });
    } else {
      let value: number;
      if (l.unitCost !== null) value = lineAmount(l.qtyMilli, l.unitCost);
      else if (s.qtyMilli > 0) value = Math.round((s.value * l.qtyMilli) / s.qtyMilli);
      else {
        errors.push({ code: 'adj_cost_required', line: l.seq });
        value = 0;
      }
      stock.set(l.itemId, { qtyMilli: s.qtyMilli + l.qtyMilli, value: s.value + value });
      moves.push({ itemId: l.itemId, qtyMilli: l.qtyMilli, value });
    }
  }
  if (errors.length) throw invalid(errors);

  const outTotal = moves.filter((m) => m.value < 0).reduce((s, m) => s - m.value, 0);
  const inTotal = moves.filter((m) => m.value > 0).reduce((s, m) => s + m.value, 0);
  const stockAccount = warehouseAccount(db, view.warehouseId);

  transaction(db, () => {
    const number = `ADJ-${view.date.slice(0, 4)}-${String(nextSequence(db, `adjustment:${view.date.slice(0, 4)}`)).padStart(4, '0')}`;
    const now = new Date().toISOString();
    let entryId: string | null = null;
    if (outTotal > 0 || inTotal > 0) {
      const description = `${number} · ${REASON_WORDS[view.reason]}${view.job ? ` · ${view.job.number}` : ''}${view.notes ? ` · ${view.notes}` : ''}`.slice(0, 300);
      const lines: EntryInput['lines'] = [];
      if (outTotal > 0) {
        lines.push({ accountCode: lossAccount, debit: outTotal, credit: 0, description });
        lines.push({ accountCode: stockAccount, debit: 0, credit: outTotal, description });
      }
      if (inTotal > 0) {
        lines.push({ accountCode: stockAccount, debit: inTotal, credit: 0, description });
        lines.push({ accountCode: gainAccount, debit: 0, credit: inTotal, description });
      }
      const entry: EntryInput = { type: 'journal', date: view.date, currency: 'IQD', rateX100: 100, description, lines };
      assertValid(db, entry);
      entryId = insertEntry(db, entry, actor.name, null);
      // like stock documents and invoices, the document posts its entry at once
      db.prepare(`UPDATE entries SET status = 'approved', number = ?, checked_by = ?, checked_at = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
        .run(nextNumber(db, 'journal', view.date), actor.name, now, actor.name, now, now, entryId);
    }
    for (const m of moves) {
      addStockMove(db, { itemId: m.itemId, warehouseId: view.warehouseId, date: view.date, qtyMilli: m.qtyMilli, value: m.value, sourceType: 'adjustment', sourceId: id });
    }
    if (view.reason === 'job' && row.job_id && entryId && outTotal > 0) {
      db.prepare(`INSERT INTO job_costs (id, job_id, category, invoice_id, entry_id, amount, description, created_by, created_at)
                  VALUES (?, ?, 'materials', NULL, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), row.job_id, entryId, outTotal, `${number} · ${view.notes || REASON_WORDS.job}`.slice(0, 300), actor.name, now);
    }
    db.prepare(`UPDATE stock_adjustments SET status = 'posted', number = ?, entry_id = ?, updated_at = ? WHERE id = ?`).run(number, entryId, now, id);
    audit(db, actor.name, 'post', 'adjustment', id, { number, entryId, out: outTotal, in: inTotal });
  });
  return getAdjustment(db, id);
}

/** Cancels a posted adjustment: its entry is reversed, its stock moves undone (what came in must still be there). */
export function cancelAdjustment(db: Db, id: string, actor: Actor, date?: string): AdjustmentView {
  const row = loadRow(db, id);
  if (row.status !== 'posted') throw conflict('action_not_allowed', { status: row.status, action: 'cancel' });
  const cancelDate = date ?? todayIso();
  if (!isIsoDate(cancelDate)) throw invalid([{ code: 'date_invalid' }]);
  if (cancelDate < row.date) throw invalid([{ code: 'date_before_document' }]);
  if (isPeriodLocked(db, cancelDate)) throw invalid([{ code: 'period_locked', period: cancelDate.slice(0, 7) }]);
  const moves = db.prepare("SELECT item_id, qty_milli, value FROM stock_moves WHERE source_type = 'adjustment' AND source_id = ? ORDER BY id")
    .all(id) as { item_id: string; qty_milli: number; value: number }[];
  // what came in leaves again: it must still be on hand
  const lineOf = new Map((db.prepare('SELECT item_id, MIN(seq) AS seq FROM stock_adjustment_lines WHERE adjustment_id = ? AND qty_milli > 0 GROUP BY item_id')
    .all(id) as { item_id: string; seq: number }[]).map((r) => [r.item_id, Number(r.seq)]));
  const remaining = new Map<string, { qtyMilli: number; value: number }>();
  const errors: { code: string; line: number; itemId: string; available?: number }[] = [];
  for (const m of moves) {
    if (Number(m.qty_milli) < 0) continue;
    const s = remaining.get(m.item_id) ?? stockOf(db, m.item_id, row.warehouse_id);
    const after = { qtyMilli: s.qtyMilli - Number(m.qty_milli), value: s.value - Number(m.value) };
    const line = lineOf.get(m.item_id) ?? 0;
    if (after.qtyMilli < 0) errors.push({ code: 'stock_insufficient', line, itemId: m.item_id, available: Math.max(0, s.qtyMilli) });
    else if (after.value < 0 || (after.qtyMilli === 0 && after.value !== 0)) errors.push({ code: 'stock_already_used', line, itemId: m.item_id });
    remaining.set(m.item_id, after);
  }
  if (errors.length) throw invalid(errors);
  transaction(db, () => {
    const reversalId = row.entry_id ? reverseEntryInternal(db, row.entry_id, actor.name, cancelDate) : null;
    for (const m of moves) {
      addStockMove(db, { itemId: m.item_id, warehouseId: row.warehouse_id, date: cancelDate, qtyMilli: -Number(m.qty_milli), value: -Number(m.value), sourceType: 'adjustment_cancel', sourceId: id });
    }
    // the job no longer counts these materials
    if (row.entry_id) db.prepare('DELETE FROM job_costs WHERE entry_id = ?').run(row.entry_id);
    db.prepare("UPDATE stock_adjustments SET status = 'cancelled', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    audit(db, actor.name, 'cancel', 'adjustment', id, { reversalId });
  });
  return getAdjustment(db, id);
}

// ——— stock count ———

export interface CountSheetRow { itemId: string; code: string; barcode: string; name: Names; unit: UnitCode; stockMilli: number }

/** The stock items with what the books say is in the warehouse, to count against. */
export function countSheet(db: Db, warehouseId: string): CountSheetRow[] {
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(warehouseId)) throw notFound('warehouse');
  const rows = db.prepare(`SELECT i.id, i.code, i.barcode, i.name_ar, i.name_en, i.name_ku, i.unit,
                                  COALESCE((SELECT SUM(m.qty_milli) FROM stock_moves m WHERE m.item_id = i.id AND m.warehouse_id = ?), 0) AS qty
                           FROM items i WHERE i.track_stock = 1 AND i.active = 1 ORDER BY i.code`).all(warehouseId) as
    { id: string; code: string; barcode: string | null; name_ar: string; name_en: string; name_ku: string; unit: UnitCode; qty: number }[];
  return rows.map((r) => ({ itemId: r.id, code: r.code, barcode: r.barcode ?? '', name: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, unit: r.unit, stockMilli: Number(r.qty) }));
}

export interface CountInput {
  date: string;
  warehouseId: string;
  notes?: string | undefined;
  /** By item id, or by its code or barcode (a CSV from the phone app or a scanner). */
  counts: { itemId?: string | undefined; code?: string | undefined; countedMilli: number }[];
  /** Items not listed count as zero (a full count) or are left alone (a partial count, the default). */
  full?: boolean | undefined;
}

export interface CountResult {
  adjustment: AdjustmentView | null;
  /** Lines that matched no item (by their position in the list). */
  unknown: { row: number; code: string }[];
  /** How many items were counted and how many differ. */
  counted: number;
  differences: number;
}

/** Counted quantities → a draft "count" adjustment with the differences (nothing is made when all agree). */
export function stockCount(db: Db, input: CountInput, actor: Actor): CountResult {
  if (!isIsoDate(input.date)) throw invalid([{ code: 'date_invalid' }]);
  const sheet = countSheet(db, input.warehouseId);
  const byId = new Map(sheet.map((r) => [r.itemId, r]));
  const byCode = new Map<string, CountSheetRow>();
  for (const r of sheet) {
    byCode.set(r.code.trim().toUpperCase(), r);
    if (r.barcode) byCode.set(r.barcode.trim().toUpperCase(), r);
  }
  const counted = new Map<string, number>();
  const unknown: { row: number; code: string }[] = [];
  const errors: { code: string; row: number }[] = [];
  input.counts.forEach((c, i) => {
    if (!Number.isSafeInteger(c.countedMilli) || c.countedMilli < 0) errors.push({ code: 'line_qty_invalid', row: i + 1 });
    const hit = c.itemId ? byId.get(c.itemId) : c.code ? byCode.get(c.code.trim().toUpperCase()) : undefined;
    if (!hit) unknown.push({ row: i + 1, code: c.itemId ?? c.code ?? '' });
    // the same item scanned twice adds up (two shelves)
    else counted.set(hit.itemId, (counted.get(hit.itemId) ?? 0) + Math.max(0, c.countedMilli));
  });
  if (errors.length) throw invalid(errors);
  if (input.full) for (const r of sheet) if (!counted.has(r.itemId)) counted.set(r.itemId, 0);
  const lines: AdjustmentLineInput[] = [];
  for (const [itemId, qty] of counted) {
    const diff = qty - byId.get(itemId)!.stockMilli;
    if (diff !== 0) lines.push({ itemId, qtyMilli: diff });
  }
  const adjustment = lines.length
    ? createAdjustment(db, { date: input.date, warehouseId: input.warehouseId, reason: 'count', notes: input.notes, lines }, actor)
    : null;
  return { adjustment, unknown, counted: counted.size, differences: lines.length };
}

// ——— API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const idParam = z.object({ id });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const qty = z.number().int().min(-1e12).max(1e12);
const accountCode = z.string().min(1).max(12);
const adjustmentBody = z.object({
  date, warehouseId: id, reason: z.enum(ADJUSTMENT_REASONS), accountCode: accountCode.optional(), jobId: id.optional(),
  notes: z.string().max(500).optional(),
  lines: z.array(z.object({ itemId: id, qtyMilli: qty, unitCost: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() })).min(1).max(500)
});

export const adjustmentsApi: ApiExtension = {
  rules: {
    'POST /api/adjustments': 'stock',
    'PUT /api/adjustments/:id': 'stock',
    'DELETE /api/adjustments/:id': 'stock',
    'POST /api/adjustments/:id/post': 'stock',
    'POST /api/adjustments/:id/cancel': 'stock',
    'POST /api/adjustments/count': 'stock'
    // PUT /api/adjustments/settings is not listed: admin only
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      {
        method: 'GET', path: '/api/adjustments',
        handler: async (req) => {
          const f = parse(z.object({
            status: z.enum(['draft', 'posted', 'cancelled']).optional(), warehouseId: id.optional(), reason: z.enum(ADJUSTMENT_REASONS).optional(),
            limit: z.coerce.number().int().min(1).max(1000).optional()
          }), req.query);
          return listAdjustments(db, f);
        }
      },
      { method: 'GET', path: '/api/adjustments/settings', handler: async () => ({ accounts: adjustmentAccounts(db), defaults: DEFAULT_ADJUSTMENT_ACCOUNTS }) },
      {
        method: 'PUT', path: '/api/adjustments/settings',
        handler: async (req) => {
          const body = parse(z.object({
            damaged: accountCode, lost: accountCode, expired: accountCode, internal_use: accountCode, job: accountCode, other: accountCode, count: accountCode, gain: accountCode
          }).partial(), req.body);
          return { accounts: updateAdjustmentAccounts(db, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as Partial<AdjustmentAccounts>, actor(req)), defaults: DEFAULT_ADJUSTMENT_ACCOUNTS };
        }
      },
      {
        method: 'GET', path: '/api/adjustments/count-sheet',
        handler: async (req) => countSheet(db, parse(z.object({ warehouseId: id }), req.query).warehouseId)
      },
      {
        method: 'POST', path: '/api/adjustments/count',
        handler: async (req) => {
          const body = parse(z.object({
            date, warehouseId: id, notes: z.string().max(500).optional(), full: z.boolean().optional(),
            counts: z.array(z.object({ itemId: id.optional(), code: z.string().max(64).optional(), countedMilli: z.number().int().max(1e12) })).min(1).max(20000)
          }), req.body);
          return stockCount(db, body, actor(req));
        }
      },
      { method: 'GET', path: '/api/adjustments/:id', handler: async (req) => getAdjustment(db, parse(idParam, req.params).id) },
      {
        method: 'POST', path: '/api/adjustments',
        handler: async (req, reply) => {
          reply.status(201).send(createAdjustment(db, parse(adjustmentBody, req.body), actor(req)));
          return undefined;
        }
      },
      { method: 'PUT', path: '/api/adjustments/:id', handler: async (req) => updateAdjustment(db, parse(idParam, req.params).id, parse(adjustmentBody, req.body), actor(req)) },
      {
        method: 'DELETE', path: '/api/adjustments/:id',
        handler: async (req, reply) => {
          deleteAdjustment(db, parse(idParam, req.params).id, actor(req));
          reply.status(204).send();
          return undefined;
        }
      },
      { method: 'POST', path: '/api/adjustments/:id/post', handler: async (req) => postAdjustment(db, parse(idParam, req.params).id, actor(req)) },
      {
        method: 'POST', path: '/api/adjustments/:id/cancel',
        handler: async (req) => {
          const body = parse(z.object({ date: date.optional() }), req.body ?? {});
          return cancelAdjustment(db, parse(idParam, req.params).id, actor(req), body.date);
        }
      }
    ];
  }
};
