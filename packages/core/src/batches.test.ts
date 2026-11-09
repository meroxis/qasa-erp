import { describe, expect, it } from 'vitest';
import { expiryState, fefoOrder, isExpired, normalizeBatchNo, normalizeExpiry, pickFefo, pickPlainFirst, returnToBatches, type BatchStock } from './index.ts';

const b = (id: string, expiry: string | null, qtyMilli: number, createdAt = '2026-01-01T00:00:00Z'): BatchStock => ({ id, expiry, qtyMilli, createdAt });
const TODAY = '2026-11-09';

describe('batches: earliest expiry first', () => {
  it('orders by expiry, no expiry last, then the older batch', () => {
    const order = fefoOrder([b('none', null, 1), b('late', '2027-05-01', 1), b('early', '2027-01-01', 1), b('tie2', '2027-01-01', 1, '2026-02-01T00:00:00Z')]);
    expect(order.map((x) => x.id)).toEqual(['early', 'tie2', 'late', 'none']);
  });

  it('splits one line over several batches', () => {
    const r = pickFefo([b('a', '2027-03-01', 4_000), b('b', '2027-01-01', 3_000), b('c', null, 10_000)], 9_000, TODAY, 'block', false);
    expect(r).toEqual({ ok: true, picks: [{ id: 'b', qtyMilli: 3_000 }, { id: 'a', qtyMilli: 4_000 }, { id: 'c', qtyMilli: 2_000 }], usedExpired: false });
  });

  it('skips expired batches under block, even when asked to allow them', () => {
    const batches = [b('old', '2026-10-01', 5_000), b('good', '2027-01-01', 2_000)];
    expect(pickFefo(batches, 2_000, TODAY, 'block', false)).toEqual({ ok: true, picks: [{ id: 'good', qtyMilli: 2_000 }], usedExpired: false });
    expect(pickFefo(batches, 4_000, TODAY, 'block', false)).toEqual({ ok: false, code: 'batch_expired', availableMilli: 2_000 });
    expect(pickFefo(batches, 4_000, TODAY, 'block', true)).toEqual({ ok: false, code: 'batch_expired', availableMilli: 2_000 });
  });

  it('uses expired batches under warn only with allowExpired, and good ones first', () => {
    const batches = [b('old', '2026-10-01', 5_000), b('good', '2027-01-01', 2_000)];
    expect(pickFefo(batches, 4_000, TODAY, 'warn', false)).toEqual({ ok: false, code: 'batch_expired', availableMilli: 2_000 });
    expect(pickFefo(batches, 4_000, TODAY, 'warn', true)).toEqual({ ok: true, picks: [{ id: 'good', qtyMilli: 2_000 }, { id: 'old', qtyMilli: 2_000 }], usedExpired: true });
    expect(pickFefo(batches, 1_000, TODAY, 'warn', true)).toEqual({ ok: true, picks: [{ id: 'good', qtyMilli: 1_000 }], usedExpired: false });
  });

  it('says how much there is when there is not enough', () => {
    expect(pickFefo([b('a', null, 1_000), b('z', null, 0)], 3_000, TODAY, 'block', false)).toEqual({ ok: false, code: 'batch_insufficient', availableMilli: 1_000 });
    expect(pickFefo([b('a', '2026-01-01', 1_000)], 3_000, TODAY, 'warn', true)).toEqual({ ok: false, code: 'batch_insufficient', availableMilli: 1_000 });
  });

  it('puts a return back into the batches the line took, the last taken first, less earlier returns', () => {
    const taken = [{ id: 'b', qtyMilli: 3_000 }, { id: 'a', qtyMilli: 4_000 }];
    expect(returnToBatches(taken, new Map(), 5_000)).toEqual([{ id: 'a', qtyMilli: 4_000 }, { id: 'b', qtyMilli: 1_000 }]);
    expect(returnToBatches(taken, new Map([['a', 4_000]]), 2_000)).toEqual([{ id: 'b', qtyMilli: 2_000 }]);
    expect(returnToBatches(taken, new Map([['a', 1_000]]), 4_000)).toEqual([{ id: 'a', qtyMilli: 3_000 }, { id: 'b', qtyMilli: 1_000 }]);
  });

  it('tells expired, near and ok apart at the day boundaries', () => {
    expect(isExpired('2026-11-09', TODAY)).toBe(false); // an expiry of today is still good today
    expect(isExpired('2026-11-08', TODAY)).toBe(true);
    expect(expiryState('2026-11-08', TODAY, 90)).toBe('expired');
    expect(expiryState('2026-11-09', TODAY, 90)).toBe('near');
    expect(expiryState('2027-02-07', TODAY, 90)).toBe('near'); // today + 90
    expect(expiryState('2027-02-08', TODAY, 90)).toBe('ok');
    expect(expiryState(null, TODAY, 90)).toBeNull();
  });

  it('keeps batch numbers and expiry dates in one form', () => {
    expect(normalizeBatchNo('  ٢٣٤  ab\u0007 c ')).toBe('234 ab c');
    expect(normalizeBatchNo('Ａ１')).toBe('A1');
    expect(normalizeBatchNo('x'.repeat(60))).toHaveLength(40);
    expect(normalizeBatchNo(undefined)).toBe('');
    expect(normalizeExpiry('٢٠٢٧-٠١-٣١')).toBe('2027-01-31');
    expect(normalizeExpiry('2027-02-30')).toBe('invalid');
    expect(normalizeExpiry('')).toBeNull();
  });

  it('takes stock from before tracking out of the batch with no number first, then earliest expiry first, expired too', () => {
    const batches = [b('plain', null, 3_000), b('n1', '2027-03-31', 5_000), b('old', '2020-01-01', 2_000)];
    expect(pickPlainFirst(batches, 2_000, 'plain')).toEqual({ ok: true, picks: [{ id: 'plain', qtyMilli: 2_000 }], usedExpired: false });
    expect(pickPlainFirst(batches, 6_000, 'plain')).toEqual({ ok: true, picks: [{ id: 'plain', qtyMilli: 3_000 }, { id: 'old', qtyMilli: 2_000 }, { id: 'n1', qtyMilli: 1_000 }], usedExpired: false });
    expect(pickPlainFirst(batches, 4_000, null)).toEqual({ ok: true, picks: [{ id: 'old', qtyMilli: 2_000 }, { id: 'n1', qtyMilli: 2_000 }], usedExpired: false });
    expect(pickPlainFirst(batches, 11_000, 'plain')).toEqual({ ok: false, code: 'batch_insufficient', availableMilli: 10_000 });
  });
});
