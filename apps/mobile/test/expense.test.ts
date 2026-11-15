import { describe, expect, it } from 'vitest';
import { translate } from '../src/i18n';
import {
  CATEGORY_TEXT, DAYS_BACK, daysAgo, daysBefore, EXPENSE_CATEGORIES, expenseBody, expenseOutcome, NOTE_MAX, OUTCOME_TEXT, PHOTO_STEPS, PHOTO_TEXT_MAX, photoFits, resizeFor
} from '../src/staff/expense';

// 1.1: an expense with the photo of its paper receipt, as the phone sends it (POST /api/expenses)

describe('an expense from the phone', () => {
  const input = { category: 'fuel' as const, amount: 75_000, currency: 'IQD' as const, cashAccountCode: '1811', date: '2026-11-15', note: '  Generator diesel  ', lang: 'en' as const };

  it('sends exactly what the phone link takes: no rate (the office books a dollar expense at its rate of the day), no party, no account', () => {
    const body = expenseBody(input);
    expect(body).toEqual({ category: 'fuel', amount: 75_000, currency: 'IQD', cashAccountCode: '1811', date: '2026-11-15', lang: 'en', note: 'Generator diesel' });
    expect(Object.keys(expenseBody({ ...input, currency: 'USD' }))).not.toContain('rateX100');
    // the keys the office's phone link allows (pro/src/phone/staff-routes.ts): nothing else
    const allowed = ['category', 'amount', 'currency', 'cashAccountCode', 'date', 'note', 'lang', 'photo'];
    expect(Object.keys(body).every((k) => allowed.includes(k))).toBe(true);
    // no note: none sent (the office writes the kind's words)
    expect(expenseBody({ ...input, note: '   ' })).not.toHaveProperty('note');
    // control characters become spaces, and a long note is cut to what the office takes
    expect(expenseBody({ ...input, note: 'a\u0000b\nc' }).note).toBe('a b c');
    expect(expenseBody({ ...input, note: 'x'.repeat(500) }).note).toHaveLength(NOTE_MAX);
    expect(() => expenseBody({ ...input, amount: 0 })).toThrow();
    expect(() => expenseBody({ ...input, amount: 1.5 })).toThrow();
    expect(() => expenseBody({ ...input, category: 'gifts' as never })).toThrow();
  });

  it('has the desktop\'s eight kinds, each with its words in the three languages', () => {
    expect([...EXPENSE_CATEGORIES]).toEqual(['rent', 'power', 'fuel', 'salaries', 'internet', 'maintenance', 'transport', 'other']);
    for (const c of EXPENSE_CATEGORIES) for (const lang of ['ar', 'en', 'ku'] as const) expect(translate(lang, CATEGORY_TEXT[c]), `${c} ${lang}`).toBeTruthy();
    expect(translate('en', CATEGORY_TEXT.power)).toBe('Electricity & generator');
  });

  it('goes back day by day up to 31 days', () => {
    expect(daysBefore('2026-11-15', 0)).toBe('2026-11-15');
    expect(daysBefore('2026-11-15', 1)).toBe('2026-11-14');
    expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28');
    expect(daysBefore('2026-11-15', DAYS_BACK)).toBe('2026-10-15');
    expect(daysAgo('2026-10-15', '2026-11-15')).toBe(31);
    expect(DAYS_BACK).toBeLessThan(62);
  });

  it('makes the photo small enough: the longer side 1600 pixels at 0.6, then 1280 at 0.5, and no more than the office takes', () => {
    expect(PHOTO_STEPS).toEqual([{ side: 1600, compress: 0.6 }, { side: 1280, compress: 0.5 }]);
    expect(resizeFor(4000, 3000, 1600)).toEqual({ width: 1600 });
    expect(resizeFor(3000, 4000, 1600)).toEqual({ height: 1600 });
    // never larger than it is
    expect(resizeFor(800, 600, 1600)).toEqual({ width: 800 });
    const text = (bytes: number) => Buffer.alloc(bytes, 1).toString('base64');
    expect(photoFits(text(200 * 1024))).toBe(true);
    expect(photoFits(text(Math.floor((PHOTO_TEXT_MAX * 3) / 4) + 3))).toBe(false);
    expect(photoFits('')).toBe(false);
    // an office that takes less says so (me.phoneLink.photoMaxBytes)
    expect(photoFits(text(150 * 1024), 100 * 1024)).toBe(false);
  });

  it('says what became of it: posted, waiting for approval, a draft, or saved without knowing which (a kept answer)', () => {
    expect(expenseOutcome('posted', { id: 'e1', status: 'approved', approval: null })).toBe('posted');
    expect(expenseOutcome('sent', { id: 'e1', status: 'draft', approval: { state: 'waiting' } })).toBe('waiting');
    expect(expenseOutcome('sent', { id: 'e1', status: 'draft', approval: null })).toBe('draft');
    // what the phone link keeps of an earlier try: its id, number and status only
    expect(expenseOutcome('sent', { id: 'e1', status: 'draft' })).toBe('notYet');
    expect(expenseOutcome('queued', null)).toBe('queued');
    expect(translate('en', OUTCOME_TEXT.notYet)).toBe('The payment voucher is saved; it counts once it is approved.');
    // the draft's words claim no approval on the PC (phones approve too)
    expect(translate('en', OUTCOME_TEXT.draft)).not.toMatch(/on the PC/);
  });
});
