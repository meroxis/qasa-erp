import { describe, expect, it } from 'vitest';
import { formatDateTime, formatTime, monthName, textDigits } from './index.ts';

describe('the digits of app texts', () => {
  it('turns Eastern digits Western for the 123 setting', () => {
    expect(textDigits('٠–٣٠ ڕۆژ', 'western')).toBe('0–30 ڕۆژ');
    expect(textDigits('لانیکەم ١٠ پیت.', 'western')).toBe('لانیکەم 10 پیت.');
  });

  it('turns Western digits Eastern for the ١٢٣ setting', () => {
    expect(textDigits('0–30 يوماً', 'eastern')).toBe('٠–٣٠ يوماً');
    expect(textDigits('خصم 15% على 3 مواد', 'eastern')).toBe('خصم ١٥٪ على ٣ مواد');
  });

  it('keeps numbers of Latin names, versions and addresses', () => {
    expect(textDigits('تُشفَّر (AES-256) دائماً', 'eastern')).toBe('تُشفَّر (AES-256) دائماً');
    expect(textDigits('يلزم MariaDB 10.6 أو أحدث', 'eastern')).toBe('يلزم MariaDB 10.6 أو أحدث');
    expect(textDigits('مثل 192.168.1.30 أو db.example.com', 'eastern')).toBe('مثل 192.168.1.30 أو db.example.com');
    expect(textDigits('ورق 80mm', 'eastern')).toBe('ورق 80mm');
  });
});

describe('dates without month names', () => {
  it('writes a moment as the numeric date and 24-hour local time', () => {
    expect(formatDateTime('2026-11-09T14:05:00')).toBe('09/11/2026 14:05');
    expect(formatDateTime('2026-01-02T00:07:00')).toBe('02/01/2026 00:07');
    expect(formatTime('2026-11-09T09:30:00')).toBe('09:30');
  });

  it('leaves text that is no date as it is', () => {
    expect(formatDateTime('soon')).toBe('soon');
  });

  it('names months from the app list', () => {
    expect(monthName('2026-11', 'ar')).toBe('تشرين الثاني');
    expect(monthName('2026-01', 'ku')).toBe('کانوونی دووەم');
    expect(monthName('2026-12', 'en')).toBe('December');
  });
});
