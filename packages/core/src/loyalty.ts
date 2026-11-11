import { addDays, isIsoDate } from './dates.ts';

/**
 * Loyalty points (Pro): a customer earns points on what they pay for a sale (X points for every Y dinars, the same in
 * every branch or a branch's own, or none there), and later uses them as part of what a sale costs, at a fixed value
 * per point, within limits (the fewest points used at once, the most of a sale points may pay). Points may lapse some
 * months after they were earned. Everything here is arithmetic on whole numbers, with no database: the server keeps
 * the movements (packages/server/src/loyalty.ts) and works balances out of them with loyaltyLedger.
 */

export interface LoyaltyEarnRule {
  /** points given … */
  points: number;
  /** … for every this many dinars paid */
  per: number;
}

export interface LoyaltyRules {
  on: boolean;
  earn: LoyaltyEarnRule;
  /** dinars one point is worth when it is used */
  pointValue: number;
  /** the fewest points used at once */
  minRedeem: number;
  /** the most of a sale's total points may pay, in percent (1–100) */
  maxRedeemPercent: number;
  /** points lapse this many whole months after the day they were earned (null: never) */
  expiryMonths: number | null;
  /** a branch's own earning (by branch id), or 'off' for none there; a branch not listed earns by `earn` */
  branches: Record<string, LoyaltyEarnRule | 'off'>;
}

/** 1 point per 1,000 IQD, a point worth 10 IQD (1% back), from 100 points, at most half a sale, never lapsing. */
export const DEFAULT_LOYALTY_RULES: LoyaltyRules = {
  on: false, earn: { points: 1, per: 1_000 }, pointValue: 10, minRedeem: 100, maxRedeemPercent: 50, expiryMonths: null, branches: {}
};

/** The highest a rule's numbers go: points per step, dinars per step, a point's value. */
export const LOYALTY_LIMITS = { points: 1_000, per: 100_000_000, pointValue: 1_000_000, minRedeem: 100_000_000, expiryMonths: 120 } as const;

const whole = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : null;

function earnRuleOf(v: unknown): LoyaltyEarnRule | null {
  const r = v as { points?: unknown; per?: unknown } | null;
  const points = whole(r?.points, 1, LOYALTY_LIMITS.points);
  const per = whole(r?.per, 1, LOYALTY_LIMITS.per);
  return points !== null && per !== null ? { points, per } : null;
}

/** The rules as saved, each value checked: anything missing or out of range takes its default. */
export function readLoyaltyRules(value: unknown): LoyaltyRules {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_LOYALTY_RULES;
  const branches: LoyaltyRules['branches'] = {};
  if (v.branches && typeof v.branches === 'object') {
    for (const [id, rule] of Object.entries(v.branches as Record<string, unknown>)) {
      if (!/^[\w-]{1,64}$/.test(id)) continue;
      if (rule === 'off') branches[id] = 'off';
      else { const r = earnRuleOf(rule); if (r) branches[id] = r; }
    }
  }
  return {
    on: v.on === true,
    earn: earnRuleOf(v.earn) ?? d.earn,
    pointValue: whole(v.pointValue, 1, LOYALTY_LIMITS.pointValue) ?? d.pointValue,
    minRedeem: whole(v.minRedeem, 1, LOYALTY_LIMITS.minRedeem) ?? d.minRedeem,
    maxRedeemPercent: whole(v.maxRedeemPercent, 1, 100) ?? d.maxRedeemPercent,
    expiryMonths: v.expiryMonths === null ? null : whole(v.expiryMonths, 1, LOYALTY_LIMITS.expiryMonths) ?? d.expiryMonths,
    branches
  };
}

/** What is wrong with rules typed on the settings page (each with the field it is about); empty when they are fine. */
export function loyaltyRuleErrors(input: Partial<LoyaltyRules>): { code: string; field: string }[] {
  const errors: { code: string; field: string }[] = [];
  if (input.earn !== undefined && !earnRuleOf(input.earn)) errors.push({ code: 'loyalty_rule_invalid', field: 'earn' });
  if (input.pointValue !== undefined && whole(input.pointValue, 1, LOYALTY_LIMITS.pointValue) === null) errors.push({ code: 'loyalty_rule_invalid', field: 'pointValue' });
  if (input.minRedeem !== undefined && whole(input.minRedeem, 1, LOYALTY_LIMITS.minRedeem) === null) errors.push({ code: 'loyalty_rule_invalid', field: 'minRedeem' });
  if (input.maxRedeemPercent !== undefined && whole(input.maxRedeemPercent, 1, 100) === null) errors.push({ code: 'loyalty_rule_invalid', field: 'maxRedeemPercent' });
  if (input.expiryMonths !== undefined && input.expiryMonths !== null && whole(input.expiryMonths, 1, LOYALTY_LIMITS.expiryMonths) === null) {
    errors.push({ code: 'loyalty_rule_invalid', field: 'expiryMonths' });
  }
  for (const [id, rule] of Object.entries(input.branches ?? {})) {
    if (!/^[\w-]{1,64}$/.test(id) || (rule !== 'off' && !earnRuleOf(rule))) errors.push({ code: 'loyalty_rule_invalid', field: `branches.${id}` });
  }
  return errors;
}

/** How a sale in a branch earns (null: it earns nothing there). No branch: the company's rule. */
export function earnRuleFor(rules: LoyaltyRules, branchId: string | null): LoyaltyEarnRule | null {
  const own = branchId ? rules.branches[branchId] : undefined;
  if (own === 'off') return null;
  return own ?? rules.earn;
}

/** Points for an amount paid (dinars): whole steps only, rounded down (1 per 1,000: 2,999 → 2). */
export function pointsFor(paidIqd: number, rule: LoyaltyEarnRule | null): number {
  if (!rule || !Number.isSafeInteger(paidIqd) || paidIqd <= 0) return 0;
  const points = (BigInt(paidIqd) / BigInt(rule.per)) * BigInt(rule.points);
  return points > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(points);
}

/** The most points one sale of `totalIqd` may use: the share points may pay, within the balance (whole points). */
export function maxRedeemPoints(totalIqd: number, balance: number, rules: Pick<LoyaltyRules, 'pointValue' | 'maxRedeemPercent'>): number {
  if (!Number.isSafeInteger(totalIqd) || totalIqd <= 0 || balance <= 0) return 0;
  const share = (BigInt(totalIqd) * BigInt(rules.maxRedeemPercent)) / 100n;
  return Math.min(balance, Number(share / BigInt(rules.pointValue)));
}

/** "2026-01-31" + 1 month → "2026-02-28": the same day of the month, or the month's last day when it has fewer. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

/** The last day points earned on `date` may be used (null: they never lapse). */
export function expiryFor(date: string, rules: Pick<LoyaltyRules, 'expiryMonths'>): string | null {
  return rules.expiryMonths && isIsoDate(date) ? addDays(addMonths(date, rules.expiryMonths), -1) : null;
}

export const LOYALTY_KINDS = ['earn', 'redeem', 'return_earn', 'return_redeem', 'cancel', 'adjust'] as const;
export type LoyaltyKind = (typeof LOYALTY_KINDS)[number];

/** One kept movement: points in (+) or out (−); value is the dinars points paid or gave back (0 when none). */
export interface LoyaltyMove {
  id: string;
  date: string;
  kind: LoyaltyKind;
  points: number;
  value: number;
  /** for points in: the last day they may be used (null: never) */
  expiresOn: string | null;
  /** the movement this one takes back or gives back (a return's, a cancellation's) */
  sourceId: string | null;
  invoiceId: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

/** A line of a customer's points ledger: a movement, or points that lapsed ('expire', worked out, never kept). */
export interface LoyaltyLedgerRow {
  id: string;
  date: string;
  kind: LoyaltyKind | 'expire';
  points: number;
  value: number;
  expiresOn: string | null;
  invoiceId: string | null;
  note: string | null;
  createdBy: string | null;
  /** the balance after it */
  balance: number;
}

export interface LoyaltyLedger {
  rows: LoyaltyLedgerRow[];
  /** points the customer may use on `asOf` (below zero when more was taken back than was left) */
  balance: number;
  /** the next points to lapse, and when (null: none) */
  expiring: { points: number; on: string } | null;
}

/**
 * A customer's ledger from their movements, oldest first, with the points that lapsed. Points are used oldest first
 * (the soonest to lapse first); a movement that takes points back from one it names (a return taking back what a sale
 * earned) takes them from it first. Points taken back when none are left are owed, and the next points in pay that
 * off before they count. `asOf`: lots whose last day is before it have lapsed.
 */
export function loyaltyLedger(moves: readonly LoyaltyMove[], asOf: string): LoyaltyLedger {
  const sorted = [...moves].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const lots: { id: string; left: number; expiresOn: string | null; date: string }[] = [];
  let owed = 0;
  const rows: LoyaltyLedgerRow[] = [];
  const balance = () => lots.reduce((s, l) => s + l.left, 0) - owed;
  const lapse = (day: string) => {
    const due = lots.filter((l) => l.left > 0 && l.expiresOn !== null && l.expiresOn < day).sort((a, b) => a.expiresOn!.localeCompare(b.expiresOn!));
    for (const l of due) {
      const points = l.left;
      l.left = 0;
      rows.push({ id: `expire:${l.id}`, date: addDays(l.expiresOn!, 1), kind: 'expire', points: -points, value: 0, expiresOn: l.expiresOn, invoiceId: null, note: null, createdBy: null, balance: balance() });
    }
  };
  // the soonest to lapse first, then the oldest; points that never lapse last
  const order = (a: (typeof lots)[number], b: (typeof lots)[number]) =>
    (a.expiresOn ?? '9999-12-31').localeCompare(b.expiresOn ?? '9999-12-31') || a.date.localeCompare(b.date);
  for (const m of sorted) {
    lapse(m.date);
    if (m.points > 0) {
      const paid = Math.min(owed, m.points);
      owed -= paid;
      lots.push({ id: m.id, left: m.points - paid, expiresOn: m.expiresOn, date: m.date });
    } else {
      let need = -m.points;
      const named = m.sourceId ? lots.find((l) => l.id === m.sourceId) : undefined;
      if (named) { const take = Math.min(need, named.left); named.left -= take; need -= take; }
      for (const l of [...lots].sort(order)) {
        if (need <= 0) break;
        const take = Math.min(need, l.left);
        l.left -= take;
        need -= take;
      }
      owed += need;
    }
    rows.push({ id: m.id, date: m.date, kind: m.kind, points: m.points, value: m.value, expiresOn: m.points > 0 ? m.expiresOn : null, invoiceId: m.invoiceId, note: m.note, createdBy: m.createdBy, balance: balance() });
  }
  lapse(asOf);
  const next = lots.filter((l) => l.left > 0 && l.expiresOn !== null).sort(order)[0];
  const expiring = next ? { on: next.expiresOn!, points: lots.filter((l) => l.left > 0 && l.expiresOn === next.expiresOn).reduce((s, l) => s + l.left, 0) } : null;
  return { rows, balance: balance(), expiring };
}

/**
 * What a return of part of a sale takes back and gives back, worked out on everything returned so far so that the
 * returns of a whole sale take back exactly what it earned and give back exactly what points paid.
 */
export function returnShare(sale: { total: number; earned: number; redeemedPoints: number; redeemedValue: number },
  returnedBefore: number, returningNow: number, already: { earnTaken: number; pointsGiven: number; valueGiven: number }):
  { earnTake: number; pointsBack: number; valueBack: number } {
  if (sale.total <= 0) return { earnTake: 0, pointsBack: 0, valueBack: 0 };
  const upTo = Math.min(sale.total, Math.max(0, returnedBefore + returningNow));
  const share = (whole: number) => (upTo >= sale.total ? whole : Number((BigInt(whole) * BigInt(upTo)) / BigInt(sale.total)));
  return {
    earnTake: Math.max(0, share(sale.earned) - already.earnTaken),
    pointsBack: Math.max(0, share(sale.redeemedPoints) - already.pointsGiven),
    valueBack: Math.max(0, Math.min(returningNow, share(sale.redeemedValue) - already.valueGiven))
  };
}
