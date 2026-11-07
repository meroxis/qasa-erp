import { describe, expect, it } from 'vitest';
import { makeI18n } from '../i18n.ts';
import { mayPrefill, rateTextOf } from './fx-prefill.ts';
import { quoteMessage, withVerifyLink } from './WhatsAppShare.tsx';
import { chequeBriefLines, type ChequesAheadView } from './ChequesAhead.tsx';
import { whatsappUrl } from '../share.ts';

const en = makeI18n('en', 'western', () => {}, () => {});
const ar = makeI18n('ar', 'western', () => {}, () => {});

describe('rate prefill', () => {
  it('fills only new dollar documents with a valid date, and never after the user typed', () => {
    const base = { active: true, currency: 'USD' as const, date: '2026-11-07', typed: false };
    expect(mayPrefill(base)).toBe(true);
    expect(mayPrefill({ ...base, currency: 'IQD' })).toBe(false);
    expect(mayPrefill({ ...base, typed: true })).toBe(false);
    expect(mayPrefill({ ...base, active: false })).toBe(false);
    expect(mayPrefill({ ...base, date: '' })).toBe(false);
    expect(rateTextOf({ rateX100: 131_500 })).toBe('1315');
  });
});

describe('WhatsApp messages', () => {
  it('writes a quotation in the user’s language with its validity', () => {
    const text = quoteMessage(en, 'Sample Co', { number: 'QT-2026-0007', date: '2026-11-01', total: 250_000_000, currency: 'IQD', validUntil: '2026-11-15', customerName: 'Aram' });
    expect(text.split('\n')[0]).toBe('Sample Co');
    expect(text).toContain('QT-2026-0007');
    expect(text).toContain('Aram');
    expect(text).toMatch(/Valid until/);
    expect(quoteMessage(ar, 'شركة', { number: 'QT-1', date: '2026-11-01', total: 1, currency: 'USD', validUntil: null })).not.toMatch(/ساري/);
  });

  it('adds the verify link when there is one', () => {
    expect(withVerifyLink(en, 'Hi', 'https://qasaerp.com/v/abc')).toBe('Hi\nCheck the invoice: https://qasaerp.com/v/abc');
    expect(withVerifyLink(en, 'Hi', null)).toBe('Hi');
  });

  it('prefills an Iraqi number and encodes the text', () => {
    expect(whatsappUrl('0750 123 4567', 'a b')).toBe('https://wa.me/9647501234567?text=a%20b');
    expect(whatsappUrl('', 'x')).toBe('https://wa.me/?text=x');
  });
});

describe('cheques in the Brief message', () => {
  const c = (over: Partial<ChequesAheadView['due'][number]>) => ({
    id: 'c', direction: 'received' as const, number: '1', bank: 'Rafidain', partyId: 'p', party: 'Sanos', phone: '', currency: 'IQD' as const,
    amount: 1_000_000, dueDate: '2026-11-08', daysLate: 0, ...over
  });
  it('says nothing when all is clear', () => {
    expect(chequeBriefLines(en, { due: [], bounced: [], dueTotal: { IQD: 0, USD: 0 } })).toEqual([]);
    expect(chequeBriefLines(en, undefined)).toEqual([]);
  });
  it('counts due and late cheques and names the bounced ones', () => {
    const lines = chequeBriefLines(en, { due: [c({}), c({ id: 'd', daysLate: 3 })], bounced: [c({ id: 'b', party: 'Zagros' })], dueTotal: { IQD: 2_000_000, USD: 0 } });
    expect(lines.join('\n')).toMatch(/Cheques due within a week: 2/);
    expect(lines.join('\n')).toMatch(/1 late/);
    expect(lines.join('\n')).toMatch(/Zagros/);
  });
});
