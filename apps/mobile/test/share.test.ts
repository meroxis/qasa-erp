import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { money, translate } from '../src/i18n';
import { invoiceMessage, pdfRef, SHARE_KEEP_MS, shareExpired, statementMessage, whatsappLink, whatsappNumber } from '../src/staff/share';

// 1.1: sending a customer their invoice or statement: the WhatsApp number rule and the messages, as the desktop's

const web = join(__dirname, '..', '..', 'web', 'src');

describe('a customer\'s number for WhatsApp, as the desktop reads it', () => {
  it('takes Iraqi mobiles written any way, and other countries\' numbers written in full with +', () => {
    for (const [phone, number] of [
      ['0750 123 4567', '9647501234567'], ['07501234567', '9647501234567'], ['+964 750 123 4567', '9647501234567'], ['00964 750 123 4567', '9647501234567'],
      ['+964 0750 123 4567', '9647501234567'], ['750 123 4567', '9647501234567'], ['٠٧٥٠١٢٣٤٥٦٧', '9647501234567'], ['۰۷۵۰۱۲۳۴۵۶۷', '9647501234567'],
      ['+44 20 7946 0958', '442079460958'], ['+1 (212) 555-0100', '12125550100']
    ] as const) expect(whatsappNumber(phone), phone).toBe(number);
    for (const phone of ['066 222 3344', '+964 66 222 3344', '442079460958', '12', '', null, undefined, 'none']) expect(whatsappNumber(phone), String(phone)).toBeNull();
  });

  it('is the desktop\'s own rule (apps/web/src/share.ts), when the monorepo is here', () => {
    const file = join(web, 'share.ts');
    if (!existsSync(file)) return;
    const body = (raw: string) => {
      const source = raw.replace(/\r\n/g, '\n');
      const start = source.indexOf('export function whatsappNumber');
      return source.slice(start, source.indexOf('\n}\n', start) + 2);
    };
    expect(body(readFileSync(join(__dirname, '..', 'src', 'staff', 'share.ts'), 'utf8'))).toBe(body(readFileSync(file, 'utf8')));
  });

  it('opens the chat with a link that holds only the number\'s digits and the encoded message', () => {
    const text = 'Mer Store\nInvoice INV-1 & more <b> "x"';
    const link = whatsappLink('0750 123 4567', text)!;
    expect(link).toBe(`https://wa.me/9647501234567?text=${encodeURIComponent(text)}`);
    expect(link).toMatch(/^https:\/\/wa\.me\/\d+\?text=[A-Za-z0-9%._~!*'()-]*$/);
    expect(whatsappLink('066 222 3344', text)).toBeNull();
    expect(whatsappLink(null, text)).toBeNull();
    // anything the number field holds besides digits never reaches the link
    expect(whatsappLink('+44 20 7946 0958 <script>"', 'hi')).toBe('https://wa.me/442079460958?text=hi');
  });
});

describe('the messages sent with the chat', () => {
  it('an invoice: the company, its number and date, to whom, the total, the link that checks it, thanks; no "attached" line', () => {
    const text = invoiceMessage('en', 'Mer Store', { number: 'INV-2026-0001', date: '2026-11-15', total: 23_000, currency: 'IQD', partyName: 'Las' }, 'https://qasaerp.com/v/#abc');
    expect(text.split('\n')).toEqual([
      'Mer Store', translate('en', 'shrMsgInvoice', { n: 'INV-2026-0001', d: '⁦15/11/2026⁩' }), 'To: Las', `Total: ${money(23_000, 'IQD', 'en')}`,
      'Check it: https://qasaerp.com/v/#abc', translate('en', 'shrMsgThanks')
    ]);
    expect(text).not.toMatch(/attach/i);
    expect(invoiceMessage('ar', 'متجر مير', { number: 'INV-1', date: '2026-11-15', total: 1, currency: 'IQD' })).toContain(translate('ar', 'shrMsgThanks'));
  });

  it('a statement: the balance, and when it is the customer\'s in credit, says so', () => {
    expect(statementMessage('en', 'Mer Store', { name: 'Las', balance: 30_000, currency: 'IQD', date: '2026-11-15' })).toContain(`Balance: ${money(30_000, 'IQD', 'en')}`);
    const credit = statementMessage('en', 'Mer Store', { name: 'Las', balance: -5_000, currency: 'IQD', date: '2026-11-15' });
    expect(credit).toContain(`${money(5_000, 'IQD', 'en')} (in your favour)`);
  });
});

describe('the shared PDF\'s file', () => {
  it('is named by the document\'s number, as the desktop names its PDFs', () => {
    expect(pdfRef('INV-2026-0001')).toBe('INV-2026-0001');
    expect(pdfRef('فاتورة ٢٠٢٦/٠٠١')).toBe('2026-001');
    expect(pdfRef('../../x')).toBe('x');
    expect(pdfRef('كشف')).toBe('document');
    expect(pdfRef('a'.repeat(100))).toHaveLength(64);
  });

  it('is kept after the share sheet closes (the chat may read it later), and goes only 10 minutes on, at the next share or start', () => {
    expect(SHARE_KEEP_MS).toBe(10 * 60_000);
    const at = 1_000_000;
    expect(shareExpired(null, at)).toBe(false);
    expect(shareExpired(at, at + 60_000)).toBe(false);
    expect(shareExpired(at, at + SHARE_KEEP_MS)).toBe(false);
    expect(shareExpired(at, at + SHARE_KEEP_MS + 1)).toBe(true);
    // the app's own code: emptied before each new PDF and at start, swept when the app comes back to the screen
    const files = readFileSync(join(__dirname, '..', 'src', 'staff', 'files.ts'), 'utf8');
    const share = files.slice(files.indexOf('export async function sharePdf'));
    expect(share.indexOf('emptyShareFolder()')).toBeLessThan(share.indexOf('printToFileAsync'));
    expect(share).not.toMatch(/shareAsync\([^)]*\)[\s\S]*delete/);
    expect(readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8')).toMatch(/cleanTemporaryFiles\(\);[\s\S]*sweepShared\(\);/);
  });
});
