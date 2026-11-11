import { describe, expect, it } from 'vitest';
import {
  addMonths, DEFAULT_LOYALTY_RULES, earnRuleFor, expiryFor, loyaltyLedger, loyaltyRuleErrors, maxRedeemPoints, pointsFor, readLoyaltyRules, returnShare,
  type LoyaltyMove
} from './loyalty.ts';

let n = 0;
const move = (date: string, kind: LoyaltyMove['kind'], points: number, over: Partial<LoyaltyMove> = {}): LoyaltyMove => ({
  id: `m${++n}`, date, kind, points, value: 0, expiresOn: null, sourceId: null, invoiceId: null, note: null, createdBy: 'Mer', createdAt: `${date}T10:00:0${n % 10}Z`, ...over
});

describe('loyalty rules', () => {
  it('reads saved rules value by value, keeping the defaults for anything missing or out of range', () => {
    expect(readLoyaltyRules(null)).toEqual(DEFAULT_LOYALTY_RULES);
    const r = readLoyaltyRules({ on: true, earn: { points: 2, per: 5_000 }, pointValue: 0, minRedeem: 50, maxRedeemPercent: 300, expiryMonths: 12,
      branches: { b1: 'off', b2: { points: 3, per: 1_000 }, b3: { points: -1, per: 1 }, '../x': 'off' } });
    expect(r).toEqual({ on: true, earn: { points: 2, per: 5_000 }, pointValue: 10, minRedeem: 50, maxRedeemPercent: 50, expiryMonths: 12, branches: { b1: 'off', b2: { points: 3, per: 1_000 } } });
    expect(readLoyaltyRules({ expiryMonths: null }).expiryMonths).toBeNull();
    expect(readLoyaltyRules({ on: 'yes' }).on).toBe(false);
  });

  it('says which typed rule is wrong', () => {
    expect(loyaltyRuleErrors({ pointValue: 25, maxRedeemPercent: 100, expiryMonths: null })).toEqual([]);
    expect(loyaltyRuleErrors({ earn: { points: 1, per: 0 }, pointValue: 1.5, minRedeem: -1, maxRedeemPercent: 0, expiryMonths: 121, branches: { b1: { points: 0, per: 1 } } }).map((e) => e.field))
      .toEqual(['earn', 'pointValue', 'minRedeem', 'maxRedeemPercent', 'expiryMonths', 'branches.b1']);
  });

  it('earns whole steps only, at the branch\'s own rate or none there', () => {
    const rules = { ...DEFAULT_LOYALTY_RULES, branches: { erbil: { points: 3, per: 1_000 }, duhok: 'off' as const } };
    expect(pointsFor(2_999, earnRuleFor(rules, null))).toBe(2);
    expect(pointsFor(2_999, earnRuleFor(rules, 'erbil'))).toBe(6);
    expect(pointsFor(2_999, earnRuleFor(rules, 'duhok'))).toBe(0);
    expect(pointsFor(2_999, earnRuleFor(rules, 'basra'))).toBe(2);
    expect(pointsFor(-5_000, rules.earn)).toBe(0);
    expect(pointsFor(9_007_199_254_740_991, { points: 1_000, per: 1 })).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('lets a sale use points up to its share and the balance', () => {
    const rules = { pointValue: 10, maxRedeemPercent: 50 };
    expect(maxRedeemPoints(20_000, 5_000, rules)).toBe(1_000);
    expect(maxRedeemPoints(20_000, 300, rules)).toBe(300);
    expect(maxRedeemPoints(19_999, 5_000, { pointValue: 10, maxRedeemPercent: 50 })).toBe(999);
    expect(maxRedeemPoints(0, 5_000, rules)).toBe(0);
    expect(maxRedeemPoints(20_000, -10, rules)).toBe(0);
  });

  it('dates the lapse by whole months, the last day of a short month when needed', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(expiryFor('2026-01-15', { expiryMonths: 6 })).toBe('2026-07-14');
    expect(expiryFor('2026-01-15', { expiryMonths: null })).toBeNull();
  });
});

describe('a customer\'s points ledger', () => {
  it('uses the points that lapse soonest first, and lets the rest lapse after their last day', () => {
    const moves = [
      move('2026-01-10', 'earn', 100, { expiresOn: '2026-07-09' }),
      move('2026-03-01', 'earn', 80, { expiresOn: '2026-08-31' }),
      move('2026-04-01', 'redeem', -120, { value: 1_200 })
    ];
    const july = loyaltyLedger(moves, '2026-07-09');
    expect(july.balance).toBe(60);
    expect(july.expiring).toEqual({ points: 60, on: '2026-08-31' });
    const later = loyaltyLedger(moves, '2026-09-01');
    expect(later.balance).toBe(0);
    expect(later.rows.map((r) => [r.kind, r.date, r.points, r.balance])).toEqual([
      ['earn', '2026-01-10', 100, 100], ['earn', '2026-03-01', 80, 180], ['redeem', '2026-04-01', -120, 60], ['expire', '2026-09-01', -60, 0]
    ]);
  });

  it('takes points back from the movement named first, owes them when none are left, and pays that off with the next points in', () => {
    const sale = move('2026-05-01', 'earn', 50);
    const moves = [
      move('2026-04-01', 'adjust', 30),
      sale,
      move('2026-05-02', 'redeem', -80),
      move('2026-05-03', 'return_earn', -50, { sourceId: sale.id }),
      move('2026-05-04', 'earn', 70)
    ];
    const l = loyaltyLedger(moves, '2026-06-01');
    expect(l.rows.map((r) => r.balance)).toEqual([30, 80, 0, -50, 20]);
    expect(l.balance).toBe(20);
    expect(l.expiring).toBeNull();
  });

  it('never counts points lapsed before a movement for it, and works out the same whatever order the movements come in', () => {
    const moves = [move('2026-01-01', 'earn', 100, { expiresOn: '2026-01-31' }), move('2026-02-01', 'earn', 10)];
    expect(loyaltyLedger(moves, '2026-02-02').balance).toBe(10);
    expect(loyaltyLedger([...moves].reverse(), '2026-02-02')).toEqual(loyaltyLedger(moves, '2026-02-02'));
  });
});

describe('what a return gives back and takes back', () => {
  const sale = { total: 20_000, earned: 17, redeemedPoints: 201, redeemedValue: 2_010 };
  it('splits on everything returned so far, so the returns of the whole sale undo it exactly', () => {
    const first = returnShare(sale, 0, 10_000, { earnTaken: 0, pointsGiven: 0, valueGiven: 0 });
    expect(first).toEqual({ earnTake: 8, pointsBack: 100, valueBack: 1_005 });
    const second = returnShare(sale, 10_000, 10_000, { earnTaken: 8, pointsGiven: 100, valueGiven: 1_005 });
    expect(second).toEqual({ earnTake: 9, pointsBack: 101, valueBack: 1_005 });
    // three returns of a third each: the last takes what is left
    const parts = [6_667, 6_667, 6_666];
    let before = 0;
    const done = { earnTaken: 0, pointsGiven: 0, valueGiven: 0 };
    for (const p of parts) {
      const s = returnShare(sale, before, p, done);
      before += p;
      done.earnTaken += s.earnTake; done.pointsGiven += s.pointsBack; done.valueGiven += s.valueBack;
    }
    expect(done).toEqual({ earnTaken: 17, pointsGiven: 201, valueGiven: 2_010 });
  });

  it('never gives back more than the return is worth, nor anything for a sale with nothing to give', () => {
    expect(returnShare({ total: 1_000, earned: 0, redeemedPoints: 100, redeemedValue: 1_000 }, 0, 100, { earnTaken: 0, pointsGiven: 0, valueGiven: 0 }).valueBack).toBe(100);
    expect(returnShare({ total: 0, earned: 5, redeemedPoints: 0, redeemedValue: 0 }, 0, 0, { earnTaken: 0, pointsGiven: 0, valueGiven: 0 })).toEqual({ earnTake: 0, pointsBack: 0, valueBack: 0 });
  });
});
