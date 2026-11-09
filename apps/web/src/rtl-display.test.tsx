import { describe, expect, it } from 'vitest';
import { makeI18n } from './i18n.ts';
import { csvCell } from './components.tsx';

const LRI = '\u2066';
const PDI = '\u2069';
const EASTERN = /[\u0660-\u0669\u06F0-\u06F9]/;
const noop = () => {};
const ar = makeI18n('ar', 'western', noop, noop);
const ku = makeI18n('ku', 'western', noop, noop);
const en = makeI18n('en', 'western', noop, noop);
const arEastern = makeI18n('ar', 'eastern', noop, noop);
const kuEastern = makeI18n('ku', 'eastern', noop, noop);

// Arabic text before "$1,500.00" turns its digits into Arabic numbers for the bidi algorithm, and the "$" then lands
// on their right: "1,500.00$". Isolated left to right, the "$" stays right before the digits.
describe('dollar amounts in Arabic and Kurdish', () => {
  it('keeps the "$" directly before the digits', () => {
    expect(ar.money(150_000, 'USD')).toBe(`${LRI}$1,500.00${PDI}`);
    expect(ku.money(150_000, 'USD')).toBe(`${LRI}$1,500.00${PDI}`);
    expect(arEastern.money(150_000, 'USD')).toBe(`${LRI}$١٬٥٠٠٫٠٠${PDI}`);
  });

  it('writes a negative dollar amount the same way everywhere, as "$-1,500.00"', () => {
    expect(ar.money(-150_000, 'USD')).toBe(`${LRI}$-1,500.00${PDI}`);
    expect(ku.money(-150_000, 'USD')).toBe(`${LRI}$-1,500.00${PDI}`);
    expect(en.money(-150_000, 'USD')).toBe('$-1,500.00');
  });

  it('leaves English and dinar amounts as they were', () => {
    expect(en.money(150_000, 'USD')).toBe('$1,500.00');
    expect(ar.money(6_124_000, 'IQD')).toBe('6,124,000 د.ع');
    expect(en.money(6_124_000, 'IQD')).toBe('6,124,000 IQD');
  });

  it('keeps the marks out of Excel cells', () => {
    expect(csvCell(ar.money(150_000, 'USD'))).toBe('"$1,500.00"');
  });
});

// The app's own Kurdish texts had "٣٠ ڕۆژ" and "٨ پیت" while every amount used 0–9 (and the other way round).
describe('one digit style per screen', () => {
  it('writes the numbers in app texts with Western digits when the setting is 123', () => {
    expect(ku.t('br_b0')).toBe('0–30 ڕۆژ');
    expect(ku.t('err_password_too_short')).not.toMatch(EASTERN);
    expect(ku.t('br_soldMonth', { n: 4 })).toBe('4 لە 30 ڕۆژدا فرۆشراوە');
  });

  it('writes them with Eastern digits when the setting is ١٢٣', () => {
    expect(arEastern.t('err_password_too_short')).toBe('كلمة المرور ٨ أحرف على الأقل');
    expect(kuEastern.t('br_b0')).toBe('٠–٣٠ ڕۆژ');
    expect(arEastern.t('br_soldMonth', { n: 4 })).toBe('بيع ٤ خلال ٣٠ يوماً');
  });

  it('keeps numbers that belong to a Latin name or an address as written', () => {
    expect(arEastern.t('bkEncryptionHelp')).toContain('AES-256');
    expect(arEastern.t('err_db_host')).toContain('192.168.1.30');
  });

  it('leaves what a user typed as typed', () => {
    expect(ku.t('br_soldMonth', { n: 'کاڵای ٣' })).toBe('کاڵای ٣ لە 30 ڕۆژدا فرۆشراوە');
    expect(ku.name({ ar: '', en: '', ku: 'سپلیتی ١٨ هەزار' })).toBe('سپلیتی ١٨ هەزار');
  });

  it('changes nothing in English', () => {
    expect(en.t('br_b0')).toBe('0–30 days');
  });
});

// The backups list showed "9 Nov 2026, 14:05" in Arabic and Kurdish: Latin month names in the middle of the page.
describe('dates in Arabic and Kurdish', () => {
  it('shows a moment as the numeric date and the time, in the digit setting', () => {
    expect(ar.dateTime('2026-11-09T14:05:00')).toBe(`${LRI}09/11/2026 14:05${PDI}`);
    expect(kuEastern.dateTime('2026-11-09T14:05:00')).toBe(`${LRI}٠٩/١١/٢٠٢٦ ١٤:٠٥${PDI}`);
    expect(en.dateTime('2026-11-09T14:05:00')).toBe('09/11/2026 14:05');
    expect(ar.dateTime('2026-11-09T14:05:00')).not.toMatch(/[A-Za-z]/);
  });

  it('shows the time alone the same way', () => {
    expect(arEastern.time('2026-11-09T09:30:00')).toBe('٠٩:٣٠');
    expect(en.time('2026-11-09T09:30:00')).toBe('09:30');
  });

  it('names a month in the language', () => {
    expect(ar.month('2026-11')).toBe('تشرين الثاني');
    expect(ku.month('2026-11')).toBe('تشرینی دووەم');
    expect(en.month('2026-11')).toBe('November');
  });
});
