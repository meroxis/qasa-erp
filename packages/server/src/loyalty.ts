import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  earnRuleFor, expiryFor, loyaltyLedger, loyaltyRuleErrors, maxRedeemPoints, pointsFor, readLoyaltyRules, returnShare, todayIso,
  type CurrencyCode, type LoyaltyKind, type LoyaltyLedger, type LoyaltyMove, type LoyaltyRules, type Names
} from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { planStatus } from './license.ts';
import { readSetting, writeSetting } from './settings.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Loyalty points (Pro). A customer earns points on what they pay for a sale (a cash sale, the till's cash, card and
 * wallet parts; never what goes on their account or what points paid), at the company's rate or their branch's own,
 * and uses them later at the till or on a sale invoice as part of what it costs: points × the value of a point, within
 * the limits set. Returns take back what the goods returned earned and give back the points that paid for them;
 * cancelling a sale undoes all of its movements. Every movement is kept for ever (loyalty_moves, append-only).
 *
 * The books: a sale paid partly with points posts the points' value as a debit to the loyalty account (Settings;
 * by default "other expenses", 39, as the expenses' "anything else"), beside the safe or the customer, and the sale
 * itself at its full price: Dr safe / customer, Dr loyalty points, Cr sales. A return gives that value back the same
 * way (Cr loyalty points). Points not yet used are not in the books; the company's accountant may change the account.
 */

const RULES = 'loyalty_rules';
const ACCOUNT = 'loyalty_account';
/** where the points' value goes unless the company chose otherwise: other expenses (the expenses' "anything else") */
const DEFAULT_ACCOUNT = '39';

export const loyaltyAvailable = (db: Db): boolean => planStatus(db).features.includes('loyalty');

export function loyaltyRules(db: Db): LoyaltyRules {
  try {
    return readLoyaltyRules(JSON.parse(readSetting(db, RULES) ?? '{}'));
  } catch {
    return readLoyaltyRules({});
  }
}

/** Points are earned and used: the plan has them and they are switched on. */
export const loyaltyActive = (db: Db): boolean => loyaltyRules(db).on && loyaltyAvailable(db);

/** The account the points' value is posted to: the one chosen, or the first postable account at or under 39. */
export function loyaltyAccount(db: Db): string {
  const accounts = loadAccounts(db).filter((a) => a.postable);
  const chosen = readSetting(db, ACCOUNT);
  if (chosen && accounts.some((a) => a.code === chosen)) return chosen;
  return accounts.find((a) => a.code === DEFAULT_ACCOUNT)?.code ?? accounts.find((a) => a.code.startsWith(DEFAULT_ACCOUNT))?.code ?? DEFAULT_ACCOUNT;
}

export interface LoyaltySettingsView {
  /** the plan has loyalty points */
  available: boolean;
  rules: LoyaltyRules;
  accountCode: string;
  accountName: Names | null;
}

export function loyaltySettings(db: Db): LoyaltySettingsView {
  const accountCode = loyaltyAccount(db);
  return { available: loyaltyAvailable(db), rules: loyaltyRules(db), accountCode, accountName: loadAccounts(db).find((a) => a.code === accountCode)?.name ?? null };
}

export interface LoyaltySettingsInput {
  rules?: Partial<LoyaltyRules> | undefined;
  accountCode?: string | undefined;
}

/**
 * Changes the rules (and the account). Switching points on needs the plan; switching them off, or changing the rules
 * while they are off, never does. A branch named must be one of the company's; the account a postable expense (3…) or
 * revenue (4…) account, as the company's accountant decides.
 */
export function setLoyaltySettings(db: Db, input: LoyaltySettingsInput, user: string): LoyaltySettingsView {
  const current = loyaltyRules(db);
  const next: LoyaltyRules = { ...current, ...(input.rules ?? {}) };
  const errors: { code: string; field?: string }[] = loyaltyRuleErrors(input.rules ?? {});
  const branchIds = new Set((db.prepare('SELECT id FROM branches').all() as { id: string }[]).map((b) => b.id));
  for (const id of Object.keys(input.rules?.branches ?? {})) if (!branchIds.has(id)) errors.push({ code: 'bn_branch_invalid', field: `branches.${id}` });
  if (input.accountCode !== undefined) {
    const a = loadAccounts(db).find((x) => x.code === input.accountCode);
    if (!a || !a.postable || !/^[34]/.test(a.code)) errors.push({ code: 'loyalty_account_invalid', field: 'accountCode' });
  }
  if (errors.length) throw invalid(errors);
  if (next.on && !current.on && !loyaltyAvailable(db)) throw conflict('plan_limit', { limit: 'loyalty' });
  transaction(db, () => {
    writeSetting(db, RULES, JSON.stringify(readLoyaltyRules(next)));
    if (input.accountCode !== undefined) writeSetting(db, ACCOUNT, input.accountCode);
    audit(db, user, 'update', 'settings', RULES, { rules: readLoyaltyRules(next), ...(input.accountCode !== undefined ? { accountCode: input.accountCode } : {}) });
  });
  return loyaltySettings(db);
}

// ——— the movements ———

interface MoveRow {
  id: string; party_id: string; date: string; kind: LoyaltyKind; points: number; value: number; account_code: string | null; invoice_id: string | null;
  source_id: string | null; expires_on: string | null; note: string | null; created_by: string; created_at: string;
}

const toMove = (r: MoveRow): LoyaltyMove & { accountCode: string | null } => ({
  id: r.id, date: r.date, kind: r.kind, points: Number(r.points), value: Number(r.value), expiresOn: r.expires_on, sourceId: r.source_id,
  invoiceId: r.invoice_id, note: r.note, createdBy: r.created_by, createdAt: r.created_at, accountCode: r.account_code
});

function movesOf(db: Db, partyId: string): (LoyaltyMove & { accountCode: string | null })[] {
  return (db.prepare('SELECT * FROM loyalty_moves WHERE party_id = ? ORDER BY date, created_at, id').all(partyId) as unknown as MoveRow[]).map(toMove);
}

function invoiceMoves(db: Db, invoiceId: string): (LoyaltyMove & { accountCode: string | null })[] {
  return (db.prepare('SELECT * FROM loyalty_moves WHERE invoice_id = ? ORDER BY created_at, id').all(invoiceId) as unknown as MoveRow[]).map(toMove);
}

interface NewMove {
  partyId: string; date: string; kind: LoyaltyKind; points: number; value?: number; accountCode?: string | null; invoiceId?: string | null;
  sourceId?: string | null; expiresOn?: string | null; branchId?: string | null; note?: string | null;
}

function addMove(db: Db, m: NewMove, user: string): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO loyalty_moves (id, party_id, date, kind, points, value, account_code, invoice_id, source_id, expires_on, branch_id, note, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, m.partyId, m.date, m.kind, m.points, m.value ?? 0, m.accountCode ?? null, m.invoiceId ?? null, m.sourceId ?? null, m.expiresOn ?? null,
      m.branchId ?? null, m.note ?? null, user, new Date().toISOString());
  return id;
}

export interface PartyLoyaltyView extends LoyaltyLedger {
  partyId: string;
  /** what the balance is worth now, in dinars */
  worth: number;
  rules: Pick<LoyaltyRules, 'on' | 'pointValue' | 'minRedeem' | 'maxRedeemPercent' | 'expiryMonths'>;
  available: boolean;
}

/** A customer's points: the balance on `asOf`, what it is worth, the next to lapse, and the ledger (newest first). */
export function partyLoyalty(db: Db, partyId: string, asOf = todayIso()): PartyLoyaltyView {
  const party = db.prepare('SELECT type FROM parties WHERE id = ?').get(partyId) as { type: string } | undefined;
  if (!party) throw notFound('party');
  const ledger = loyaltyLedger(movesOf(db, partyId), asOf);
  const rules = loyaltyRules(db);
  return {
    partyId, ...ledger, rows: [...ledger.rows].reverse(), worth: Math.max(0, ledger.balance) * rules.pointValue, available: loyaltyAvailable(db),
    rules: { on: rules.on, pointValue: rules.pointValue, minRedeem: rules.minRedeem, maxRedeemPercent: rules.maxRedeemPercent, expiryMonths: rules.expiryMonths }
  };
}

/** A customer's balance on a day. */
export const loyaltyBalance = (db: Db, partyId: string, asOf: string): number => loyaltyLedger(movesOf(db, partyId), asOf).balance;

export interface Redemption { points: number; value: number; accountCode: string }

/**
 * Checks points a customer wants to use on a sale of `total` and says what they pay. Refused while points are off, for
 * a sale in dollars (a point is worth dinars), without a customer, below the fewest at once, above the share a sale
 * may be paid with points, or above the balance on the sale's day.
 */
export function planRedemption(db: Db, s: { partyId: string | null | undefined; points: number; total: number; currency: CurrencyCode; date: string }): Redemption {
  if (!Number.isSafeInteger(s.points) || s.points <= 0) throw invalid([{ code: 'loyalty_points_invalid' }]);
  if (!loyaltyActive(db)) throw conflict('loyalty_off');
  if (!s.partyId) throw invalid([{ code: 'party_required' }]);
  if (s.currency !== 'IQD') throw invalid([{ code: 'loyalty_iqd_only' }]);
  const rules = loyaltyRules(db);
  const balance = loyaltyBalance(db, s.partyId, s.date);
  const most = maxRedeemPoints(s.total, balance, rules);
  if (s.points < rules.minRedeem) throw invalid([{ code: 'loyalty_below_min', min: rules.minRedeem } as { code: string }]);
  if (s.points > balance) throw invalid([{ code: 'loyalty_balance_low', available: Math.max(0, balance) } as { code: string }]);
  if (s.points > most) throw invalid([{ code: 'loyalty_above_max', max: most, percent: rules.maxRedeemPercent } as { code: string }]);
  return { points: s.points, value: s.points * rules.pointValue, accountCode: loyaltyAccount(db) };
}

const branchOfWarehouse = (db: Db, warehouseId: string): string | null =>
  (db.prepare('SELECT branch_id FROM branch_warehouses WHERE warehouse_id = ?').get(warehouseId) as { branch_id: string } | undefined)?.branch_id ?? null;

/**
 * A sale just posted (in its transaction): the points it used, and those it earns on `paidIqd`, what was paid for it
 * other than on account or with points. Earning needs points on and a customer; a branch may earn its own way or none.
 */
export function recordSaleLoyalty(db: Db, sale: { invoiceId: string; partyId: string | null; date: string; warehouseId: string; paidIqd: number; redeemed: Redemption | null }, user: string): void {
  if (!sale.partyId) return;
  const branchId = branchOfWarehouse(db, sale.warehouseId);
  if (sale.redeemed) {
    addMove(db, { partyId: sale.partyId, date: sale.date, kind: 'redeem', points: -sale.redeemed.points, value: sale.redeemed.value, accountCode: sale.redeemed.accountCode, invoiceId: sale.invoiceId, branchId }, user);
  }
  if (!loyaltyActive(db)) return;
  const rules = loyaltyRules(db);
  const earned = pointsFor(sale.paidIqd, earnRuleFor(rules, branchId));
  if (earned > 0) addMove(db, { partyId: sale.partyId, date: sale.date, kind: 'earn', points: earned, invoiceId: sale.invoiceId, expiresOn: expiryFor(sale.date, rules), branchId }, user);
}

export interface ReturnLoyalty {
  /** points and dinars given back for what points paid of the goods returned */
  pointsBack: number; valueBack: number; accountCode: string | null;
  /** points taken back of what the goods returned earned */
  earnTake: number;
  earnMoveId: string | null; redeemMoveId: string | null;
}

/**
 * What a return of `returningNow` (in the sale's currency) from a posted sale gives back in points and takes back of
 * what it earned, on everything returned so far: the returns of the whole sale undo exactly its movements.
 */
export function returnLoyalty(db: Db, original: { id: string; total: number }, returnedBefore: number, returningNow: number): ReturnLoyalty | null {
  const moves = invoiceMoves(db, original.id).filter((m) => m.kind === 'earn' || m.kind === 'redeem');
  if (!moves.length) return null;
  const earn = moves.find((m) => m.kind === 'earn') ?? null;
  const redeem = moves.find((m) => m.kind === 'redeem') ?? null;
  const later = (sourceId: string | undefined, kind: LoyaltyKind) => sourceId
    ? (db.prepare('SELECT COALESCE(SUM(points), 0) AS p, COALESCE(SUM(value), 0) AS v FROM loyalty_moves WHERE source_id = ? AND kind = ?').get(sourceId, kind) as { p: number; v: number })
    : { p: 0, v: 0 };
  const taken = later(earn?.id, 'return_earn');
  const given = later(redeem?.id, 'return_redeem');
  const share = returnShare(
    { total: original.total, earned: earn?.points ?? 0, redeemedPoints: redeem ? -redeem.points : 0, redeemedValue: redeem?.value ?? 0 },
    returnedBefore, returningNow, { earnTaken: -Number(taken.p), pointsGiven: Number(given.p), valueGiven: Number(given.v) }
  );
  return { ...share, accountCode: redeem?.accountCode ?? null, earnMoveId: earn?.id ?? null, redeemMoveId: redeem?.id ?? null };
}

/** A return just posted (in its transaction): the movements returnLoyalty worked out. */
export function recordReturnLoyalty(db: Db, ret: { invoiceId: string; partyId: string | null; date: string; warehouseId: string }, share: ReturnLoyalty | null, user: string): void {
  if (!share || !ret.partyId) return;
  const branchId = branchOfWarehouse(db, ret.warehouseId);
  if (share.earnTake > 0) addMove(db, { partyId: ret.partyId, date: ret.date, kind: 'return_earn', points: -share.earnTake, invoiceId: ret.invoiceId, sourceId: share.earnMoveId, branchId }, user);
  if (share.pointsBack > 0) {
    addMove(db, {
      partyId: ret.partyId, date: ret.date, kind: 'return_redeem', points: share.pointsBack, value: share.valueBack, accountCode: share.accountCode,
      invoiceId: ret.invoiceId, sourceId: share.redeemMoveId, expiresOn: expiryFor(ret.date, loyaltyRules(db)), branchId
    }, user);
  }
}

/** A sale or a return cancelled (in its transaction): each of its movements not undone yet is undone. */
export function cancelLoyalty(db: Db, invoiceId: string, date: string, user: string): void {
  const moves = invoiceMoves(db, invoiceId);
  const undone = new Set(moves.filter((m) => m.kind === 'cancel').map((m) => m.sourceId));
  for (const m of moves) {
    if (m.kind === 'cancel' || undone.has(m.id)) continue;
    const party = (db.prepare('SELECT party_id FROM loyalty_moves WHERE id = ?').get(m.id) as { party_id: string }).party_id;
    addMove(db, { partyId: party, date, kind: 'cancel', points: -m.points, value: m.value, accountCode: m.accountCode, invoiceId, sourceId: m.id }, user);
  }
}

/** A correction by an admin (+ or −), with the reason. Needs the plan. */
export function adjustLoyalty(db: Db, partyId: string, input: { points: number; note: string; date?: string | undefined }, user: string): PartyLoyaltyView {
  if (!loyaltyAvailable(db)) throw conflict('plan_limit', { limit: 'loyalty' });
  const party = db.prepare('SELECT type FROM parties WHERE id = ?').get(partyId) as { type: string } | undefined;
  if (!party) throw notFound('party');
  const errors: { code: string }[] = [];
  if (party.type !== 'customer') errors.push({ code: 'party_invalid' });
  if (!Number.isSafeInteger(input.points) || input.points === 0 || Math.abs(input.points) > 100_000_000) errors.push({ code: 'loyalty_points_invalid' });
  const note = input.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
  if (!note) errors.push({ code: 'loyalty_note_required' });
  if (errors.length) throw invalid(errors);
  const date = input.date ?? todayIso();
  transaction(db, () => {
    addMove(db, { partyId, date, kind: 'adjust', points: input.points, note, expiresOn: input.points > 0 ? expiryFor(date, loyaltyRules(db)) : null }, user);
    audit(db, user, 'adjust', 'loyalty', partyId, { points: input.points });
  });
  return partyLoyalty(db, partyId);
}

// ——— for the invoice, the receipt and the end-of-day close ———

export interface InvoiceLoyaltyView {
  /** points this document earned (a sale) or took back (a return, negative) */
  earned: number;
  /** points used to pay (a sale), or given back (a return, negative) */
  redeemed: number;
  /** the dinars those points paid or gave back */
  value: number;
  /** the customer's balance now */
  balance: number;
}

export function invoiceLoyalty(db: Db, invoiceId: string, partyId: string | null): InvoiceLoyaltyView | null {
  if (!partyId) return null;
  const moves = invoiceMoves(db, invoiceId).filter((m) => m.kind !== 'cancel' && m.kind !== 'adjust');
  if (!moves.length && !loyaltyActive(db)) return null;
  const sum = (kinds: LoyaltyKind[], f: (m: LoyaltyMove) => number) => moves.filter((m) => kinds.includes(m.kind)).reduce((s, m) => s + f(m), 0);
  return {
    earned: sum(['earn', 'return_earn'], (m) => m.points),
    redeemed: sum(['redeem', 'return_redeem'], (m) => -m.points),
    value: sum(['redeem', 'return_redeem'], (m) => m.value),
    balance: loyaltyBalance(db, partyId, todayIso())
  };
}

/** What points paid of each sale, or gave back on each return, in dinars (the end-of-day close). */
export function loyaltyPaidFor(db: Db, invoiceIds: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < invoiceIds.length; i += 500) {
    const chunk = invoiceIds.slice(i, i + 500);
    const rows = db.prepare(`SELECT invoice_id, SUM(value) AS v FROM loyalty_moves WHERE kind IN ('redeem', 'return_redeem') AND invoice_id IN (${chunk.map(() => '?').join(', ')})
                             GROUP BY invoice_id`).all(...chunk) as { invoice_id: string; v: number }[];
    for (const r of rows) out.set(r.invoice_id, Number(r.v));
  }
  return out;
}

// ——— the API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const earnRule = z.object({ points: z.number().int().min(1).max(1_000), per: z.number().int().min(1).max(100_000_000) });
const idParam = z.object({ id: z.string().min(1).max(64) });

/**
 * Reading the rules and a customer's points is open to every signed-in user (the till and the customer page need
 * them); changing the rules and correcting a balance need an admin (they are not listed in rules).
 */
export const loyaltyApi: ApiExtension = {
  routes(db, { actorOf }) {
    const user = (req: ApiRequest) => actorOf(req).name;
    return [
      { method: 'GET', path: '/api/loyalty/settings', handler: async () => loyaltySettings(db) },
      {
        method: 'PUT', path: '/api/loyalty/settings',
        handler: async (req) => {
          const body = parse(z.object({
            rules: z.object({
              on: z.boolean(), earn: earnRule, pointValue: z.number().int().min(1).max(1_000_000), minRedeem: z.number().int().min(1).max(100_000_000),
              maxRedeemPercent: z.number().int().min(1).max(100), expiryMonths: z.number().int().min(1).max(120).nullable(),
              branches: z.record(z.string().regex(/^[\w-]{1,64}$/), z.union([z.literal('off'), earnRule]))
            }).partial().optional(),
            accountCode: z.string().regex(/^[34]\d{0,11}$/).optional()
          }), req.body ?? {});
          return setLoyaltySettings(db, body as LoyaltySettingsInput, user(req));
        }
      },
      { method: 'GET', path: '/api/loyalty/parties/:id', handler: async (req) => partyLoyalty(db, parse(idParam, req.params).id) },
      {
        method: 'POST', path: '/api/loyalty/parties/:id/adjust',
        handler: async (req) => {
          const body = parse(z.object({ points: z.number().int().min(-100_000_000).max(100_000_000), note: z.string().max(300) }), req.body ?? {});
          return adjustLoyalty(db, parse(idParam, req.params).id, body, user(req));
        }
      }
    ];
  }
};
