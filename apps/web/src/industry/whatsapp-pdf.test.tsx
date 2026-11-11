import { describe, expect, it } from 'vitest';
import { makeI18n } from '../i18n.ts';
import { displayPhone, whatsappNumber, whatsappUrl } from '../share.ts';
import { pdfFileName } from '../../../desktop/src/share-pdf.ts';
import { makePdf, pdfOutcomeOf, pdfRef, PDF_CLASS, type PdfPage } from './whatsapp-pdf.ts';
import { phoneState } from './WhatsAppSend.tsx';
import { receiptMessage, withAttachment } from './WhatsAppShare.tsx';

const noop = () => {};
const en = makeI18n('en', 'western', noop, noop);
const ar = makeI18n('ar', 'western', noop, noop);
const ku = makeI18n('ku', 'western', noop, noop);

describe('Iraqi numbers for WhatsApp', () => {
  it('takes every usual way of writing an Iraqi mobile, and writes it back as +964 …', () => {
    for (const typed of ['07501234567', '0750 123 4567', '0750-123-4567', '+964 750 123 4567', '+9647501234567', '009647501234567', '964 750 123 4567',
      '+964 0750 123 4567', '7501234567', '٠٧٥٠١٢٣٤٥٦٧', '۰۷۵۰ ۱۲۳ ۴۵۶۷']) {
      expect(whatsappNumber(typed), typed).toBe('9647501234567');
      expect(displayPhone(typed), typed).toBe('+964 750 123 4567');
    }
    expect(whatsappNumber('0770 000 0001')).toBe('9647700000001');
  });

  it('refuses what WhatsApp can\'t reach: a landline, too few or too many digits, a number without its country', () => {
    for (const bad of ['', '   ', '066 222 3333', '+964 66 222 3333', '0750 123 456', '0750 123 45678', '12345', '1 202 555 0100', 'Mer']) {
      expect(whatsappNumber(bad), bad).toBeNull();
      expect(displayPhone(bad), bad).toBeNull();
    }
    // another country's number, written in full with its +
    expect(whatsappNumber('+44 20 7946 0958')).toBe('442079460958');
    expect(displayPhone('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('says in the dialog whether the number will do: none (pick the chat), the number, or not one', () => {
    expect(phoneState('')).toEqual({ ok: true, shown: null });
    expect(phoneState('0750 123 4567')).toEqual({ ok: true, shown: '+964 750 123 4567' });
    expect(phoneState('066 222 3333')).toEqual({ ok: false });
  });

  it('opens wa.me only, with the message as text and nothing else in the link', () => {
    const url = new URL(whatsappUrl('0750 123 4567', 'Hello & welcome?\nline=2'));
    expect(url.origin).toBe('https://wa.me');
    expect(url.pathname).toBe('/9647501234567');
    expect([...url.searchParams.keys()]).toEqual(['text']);
    expect(url.searchParams.get('text')).toBe('Hello & welcome?\nline=2');
    expect(whatsappUrl('not a number', 'x')).toBe('https://wa.me/?text=x');
  });
});

describe('the PDF a document is sent as', () => {
  it('turns a document\'s number into a file name part the Windows app accepts', () => {
    for (const [from, to] of [
      ['INV-2026-0001', 'INV-2026-0001'], ['C-0001_2026-11-11', 'C-0001_2026-11-11'], ['٢٠٢٦-١١-١١', '2026-11-11'],
      ['../../etc/passwd', 'etc-passwd'], ['QT 2026/7', 'QT-2026-7'], ['فاتورة', 'document'], ['a..b', 'a.b'], ['x'.repeat(80), 'x'.repeat(64)], ['', 'document']
    ] as const) {
      expect(pdfRef(from), from).toBe(to);
      expect(pdfFileName('invoice', pdfRef(from)), from).not.toBeNull();
    }
  });

  it('reads the app\'s answer, taking anything odd for a failure', () => {
    expect(pdfOutcomeOf({ status: 'saved', name: 'Invoice-INV-1.pdf' })).toEqual({ status: 'saved', name: 'Invoice-INV-1.pdf' });
    expect(pdfOutcomeOf({ status: 'saved', name: '<img src=x>.pdf' })).toEqual({ status: 'failed' });
    expect(pdfOutcomeOf({ status: 'busy' })).toEqual({ status: 'busy' });
    expect(pdfOutcomeOf(null)).toEqual({ status: 'failed' });
    expect(pdfOutcomeOf('saved')).toEqual({ status: 'failed' });
  });

  it('keeps the dialog off the paper while the app makes the PDF, and asks only with a kind and a clean number', async () => {
    const classes = new Set<string>();
    const seen: string[][] = [];
    const page: PdfPage = { addClass: (c) => classes.add(c), removeClass: (c) => classes.delete(c), paint: async () => {} };
    const desktop = { sharePdf: async (kind: string, ref: string) => { seen.push([kind, ref, ...[...classes].sort()]); return { status: 'saved', name: `Receipt-${ref}.pdf` }; } };
    expect(await makePdf('receipt', 'INV 2026/0009', { desktop, page, bodyClass: 'pos-printing' })).toEqual({ status: 'saved', name: 'Receipt-INV-2026-0009.pdf' });
    expect(seen).toEqual([['receipt', 'INV-2026-0009', PDF_CLASS, 'pos-printing']]);
    expect(classes.size).toBe(0);
    // an app that fails or throws: failed, and the page is as it was
    const broken = { sharePdf: async () => { throw new Error('gone'); } };
    expect(await makePdf('invoice', 'INV-1', { desktop: broken, page })).toEqual({ status: 'failed' });
    expect(classes.size).toBe(0);
    // a browser: no PDF from here (the dialog offers the print window instead)
    expect(await makePdf('invoice', 'INV-1', { desktop: null, page })).toBeNull();
  });
});

describe('the messages that go with the PDF', () => {
  const sale = {
    number: 'INV-2026-0042', date: '2026-11-11', total: 35_000, currency: 'IQD' as const, partyName: 'Las',
    payments: [{ kind: 'pos', method: 'cash', amount: 20_000, currency: 'IQD' as const }, { kind: 'pos', method: 'fib', amount: 15_000, currency: 'IQD' as const }]
  };

  it('writes a receipt in the customer\'s language, with how it was paid when it was split', () => {
    const text = withAttachment(en, receiptMessage(en, 'Mer Store', sale));
    expect(text.split('\n')).toEqual([
      'Mer Store', 'Hello Las,', 'Receipt INV-2026-0042 of 11/11/2026', 'Total: 35,000 IQD', 'Paid: Cash 20,000 IQD، FIB 15,000 IQD', expect.any(String), 'The PDF is attached.'
    ]);
    expect(receiptMessage(ar, 'متجر مير', sale)).toContain('مرحباً Las،');
    expect(withAttachment(ku, receiptMessage(ku, 'دوکانی مێر', sale))).toContain('فایلەکە بە شێوەی PDF هاوپێچ کراوە.');
    // a walk-in cash sale: no greeting, no payment line
    const plain = receiptMessage(en, 'Mer Store', { ...sale, partyName: null, payments: [] });
    expect(plain).not.toContain('Hello');
    expect(plain).not.toContain('Paid:');
  });
});
