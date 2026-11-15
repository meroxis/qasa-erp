import { describe, expect, it } from 'vitest';
import { ltr, translate } from '../src/i18n';
import type { RateRow } from '../src/owner/api';
import { BIG_CHANGE_PERCENT, changeText, isBigChange, lastDays, percentText, rateStatus, rateText, readRate, RATE_MAX, RATE_MIN } from '../src/owner/rate';

// The dollar rate on the phone (phone app 1.1): typed per $100 as on the desktop, in the office's range, asked about
// when far from the last rate, and shown as the desktop's rate board shows it.

const row = (date: string, rateX100: number): RateRow => ({ date, rateX100, source: null, createdAt: `${date}T07:00:00.000Z` });

describe('the dollar rate on the phone', () => {
  it('reads a rate typed per $100, with Western, Arabic-Indic or Persian digits and separators', () => {
    expect(readRate('146500')).toBe(146_500);
    expect(readRate('146,500')).toBe(146_500);
    expect(readRate(' ١٤٦٬٥٠٠ ')).toBe(146_500);
    expect(readRate('۱۴۶۵۰۰')).toBe(146_500);
    // not a whole number of dinars, not a number, or outside the office's own range
    for (const text of ['1465.5', '١٤٦٫٥', '', 'abc', '-146500', '1e5', '9999', '10000001']) expect(readRate(text), text).toBeNull();
    expect(readRate(String(RATE_MIN))).toBe(10_000);
    expect(readRate(String(RATE_MAX))).toBe(10_000_000);
  });

  it('asks before saving a rate more than 5 % from the last one, and says by how much', () => {
    expect(BIG_CHANGE_PERCENT).toBe(5);
    expect(isBigChange(146_500, 153_825)).toBe(false); // exactly 5 %
    expect(isBigChange(146_500, 153_826)).toBe(true);
    expect(isBigChange(146_500, 139_175)).toBe(false);
    expect(isBigChange(146_500, 139_000)).toBe(true);
    // nothing to compare with: nothing to ask
    expect(isBigChange(null, 146_500)).toBe(false);
    expect(isBigChange(0, 146_500)).toBe(false);
    expect(percentText(146_500, 155_000)).toBe('5.8');
    expect(percentText(140_000, 154_000)).toBe('10');
    expect(translate('en', 'rateBigChange', { r: rateText(146_500), p: percentText(146_500, 155_000) })).toBe(`This differs from the last rate (${ltr('146,500')}) by 5.8%. Save it?`);
  });

  it('shows the rate, its change and the last days as the desktop\'s rate board does', () => {
    expect(rateText(146_500)).toBe(ltr('146,500'));
    expect(rateText(1_000_000)).toBe(ltr('1,000,000'));
    expect(changeText([row('2026-11-15', 147_000), row('2026-11-14', 146_500)])).toBe(`▲ ${ltr('500')}`);
    expect(changeText([row('2026-11-15', 145_000), row('2026-11-13', 146_000)])).toBe(`▼ ${ltr('1,000')}`);
    expect(changeText([row('2026-11-15', 145_000), row('2026-11-13', 145_000)])).toBe(ltr('0'));
    expect(changeText([row('2026-11-15', 145_000)])).toBeNull();
    const rows = ['2026-11-15', '2026-11-12', '2026-11-09', '2026-11-08', '2026-10-20'].map((d, i) => row(d, 146_000 + i));
    expect(lastDays(rows, '2026-11-15').map((r) => r.date)).toEqual(['2026-11-15', '2026-11-12', '2026-11-09']);
    expect(lastDays(rows, '2026-11-15', 30)).toHaveLength(5);
  });

  it('says whether the rate is today\'s, the last day\'s, or the default rate', () => {
    expect(rateStatus({ date: '2026-11-15', rateX100: 146_500, source: 'board' }, '2026-11-15')).toEqual({ key: 'rateToday', date: '2026-11-15' });
    expect(rateStatus({ date: '2026-11-12', rateX100: 146_500, source: 'board' }, '2026-11-15')).toEqual({ key: 'rateLast', date: '2026-11-12' });
    expect(rateStatus({ date: null, rateX100: 142_000, source: 'default' }, '2026-11-15')).toEqual({ key: 'rateDefault', date: null });
    // the words, in each language, keep the desktop's
    expect(translate('en', 'ratePer100')).toBe('dinars per $100');
    expect(translate('ar', 'rateInvalid')).toContain('10,000');
    expect(translate('ku', 'rateTitle')).toBe('نرخی دۆلار');
  });
});
