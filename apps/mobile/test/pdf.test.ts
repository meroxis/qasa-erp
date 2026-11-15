import { describe, expect, it } from 'vitest';
import type { Statement } from '../src/api';
import { money, qty, translate } from '../src/i18n';
import type { InvoiceDetail } from '../src/staff/api';
import { accentOf, CSP, DEFAULT_ACCENT, esc, invoiceHtml, logoUrl, rateText, statementHtml, type PdfLook } from '../src/staff/pdf';

// 1.1: a customer's invoice or statement as the page the phone prints to a PDF

const names = (en: string, ar = en, ku = en) => ({ ar, en, ku });
const invoice = (extra: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  id: 'inv-1', kind: 'sale', status: 'posted', number: 'INV-2026-0001', date: '2026-11-15', partyId: 'c-1', partyName: 'Mer', currency: 'IQD', total: 23_000,
  payment: 'credit', partyPhone: '0750 123 4567', partyAddress: null, partyLang: null, rateX100: 100, discount: 2_000, subtotal: 25_000, notes: 'Delivered to the shop',
  lines: [
    { lineNo: 1, itemId: 'i-1', itemCode: 'CB1', itemName: names('Cable', 'كابل', 'کێبڵ'), unit: 'piece', description: 'Cable', qtyMilli: 2000, unitPrice: 5_000, amount: 10_000, lineUnit: null, unitFactorMilli: null, unitQtyMilli: null },
    { lineNo: 2, itemId: 'i-2', itemCode: 'CH1', itemName: names('Charger'), unit: 'piece', description: 'Charger', qtyMilli: 12_000, unitPrice: 15_000, amount: 15_000, lineUnit: 'box', unitFactorMilli: 12_000, unitQtyMilli: 1000 }
  ],
  settlement: { currency: 'IQD', total: 23_000, returned: 0, received: 5_000, waiting: 0, open: 18_000 },
  ...extra
});
const look = (extra: Partial<PdfLook> = {}): PdfLook => ({
  company: 'Mer Store', profile: { address: 'Erbil, 100m street', phone: '066 222 3344', taxNumber: 'TX-77', footer: 'Thank you', showLogo: true, logo: null }, design: null, ...extra
});
const QR = { url: 'https://qasaerp.com/v/#eyJ2IjoxfQ.c2ln', licensed: true };

describe('the page of a PDF', () => {
  it('escapes every text from the office: a name or a note can never be read as HTML or script', () => {
    const hostile = invoice({ partyName: '<script>alert(1)</script>"\'', notes: '<img src=x onerror=alert(1)>', lines: [{ ...invoice().lines[0]!, itemName: names('</td><script>x</script>') }] });
    const html = invoiceHtml('en', look({ company: 'Mer & Sons "<b>"' }), hostile, null);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img src=x/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;');
    expect(html).toContain('Mer &amp; Sons &quot;&lt;b&gt;&quot;');
    expect(esc('<a href="x">\'&')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
    // the page itself loads nothing and runs nothing
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
    expect(CSP).toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:");
    expect(html).not.toMatch(/<script|https?:\/\/(?!qasaerp)|src="http|url\(http/i);
  });

  it('reads right to left in Arabic and Kurdish, left to right in English', () => {
    expect(invoiceHtml('ar', look(), invoice(), null)).toMatch(/<html lang="ar" dir="rtl">/);
    expect(invoiceHtml('ku', look(), invoice(), null)).toMatch(/<html lang="ckb" dir="rtl">/);
    expect(invoiceHtml('en', look(), invoice(), null)).toMatch(/<html lang="en" dir="ltr">/);
    expect(invoiceHtml('ku', look(), invoice(), null)).toContain(translate('ku', 'pdfSaleInvoice'));
  });

  it('writes money and quantities as the screens do: the line\'s own unit, the order\'s total, what is paid and still owed', () => {
    const html = invoiceHtml('en', look(), invoice(), null);
    expect(html).toContain(money(10_000, 'IQD', 'en'));
    expect(html).toContain(`${qty(2000)} piece`);
    // the second line was sold in boxes: one box, at the box's price
    expect(html).toContain(`${qty(1000)} box`);
    expect(html).toContain(money(15_000, 'IQD', 'en'));
    expect(html).toContain(translate('en', 'pdfSubtotal'));
    expect(html).toContain(money(25_000, 'IQD', 'en'));
    expect(html).toContain(money(23_000, 'IQD', 'en'));
    expect(html).toContain(translate('en', 'pdfStillOwed'));
    expect(html).toContain(money(18_000, 'IQD', 'en'));
    expect(html).toContain('INV-2026-0001');
    expect(html).toContain('15/11/2026');
    // cash: no "still owed"; no discount: no subtotal
    const cash = invoiceHtml('en', look(), invoice({ payment: 'cash', settlement: null, discount: 0, subtotal: 23_000 }), null);
    expect(cash).not.toContain(translate('en', 'pdfStillOwed'));
    expect(cash).not.toContain(translate('en', 'pdfSubtotal'));
    // a dollar invoice says its rate, as the desktop does
    expect(rateText(147_500)).toBe('1,475');
    expect(rateText(147_550)).toBe('1,475.5');
    expect(invoiceHtml('en', look(), invoice({ currency: 'USD', rateX100: 147_500 }), null)).toContain('$1 = 1,475');
    // an item's unit the app has no word for is not written in the office's code
    const odd = invoice({ lines: [{ ...invoice().lines[0]!, unit: 'strip' }] });
    expect(invoiceHtml('ar', look(), odd, null)).not.toContain('strip');
  });

  it('prints the QR code only when the office gave its address, captioned as the plan makes true', () => {
    expect(invoiceHtml('en', look(), invoice(), null)).not.toContain('<svg');
    const verified = invoiceHtml('en', look(), invoice(), QR);
    expect(verified).toContain('<svg');
    expect(verified).toContain(translate('en', 'pdfQrVerified'));
    const free = invoiceHtml('en', look(), invoice(), { ...QR, licensed: false });
    expect(free).toContain(translate('en', 'pdfQrDetails'));
    expect(free).not.toContain(translate('en', 'pdfQrVerified'));
    // an address that is not one is not drawn
    expect(invoiceHtml('en', look(), invoice(), { url: 'javascript:alert(1)', licensed: true })).not.toContain('<svg');
    // the design may leave the code out
    expect(invoiceHtml('en', look({ design: { layout: 'classic', accent: '#123456', show: { qr: false } } }), invoice(), QR)).not.toContain('<svg');
  });

  it('follows the design: the Classic ledger in black and white with every cell ruled and a stamp box; else the design\'s colour', () => {
    const ledger = invoiceHtml('en', look({ design: { layout: 'ledger', accent: '#aa0000' } }), invoice(), null);
    expect(ledger).toContain('border:1px solid #000');
    expect(ledger).toContain(translate('en', 'pdfStamp'));
    expect(ledger).not.toContain('#aa0000');
    const classic = invoiceHtml('en', look({ design: { layout: 'classic', accent: '#2a7f62' } }), invoice(), null);
    expect(classic).toContain('#2a7f62');
    expect(classic).not.toContain(translate('en', 'pdfStamp'));
    // a stamp box when the classic design asks for one
    expect(invoiceHtml('en', look({ design: { layout: 'classic', accent: '#2a7f62', show: { stamp: true } } }), invoice(), null)).toContain(translate('en', 'pdfStamp'));
  });

  it('uses the design\'s colour only when it is one (#rrggbb): it goes into the page\'s styles', () => {
    expect(accentOf({ layout: 'classic', accent: '#1D5FD1' })).toBe('#1D5FD1');
    for (const accent of ['red', '#12345', '#1234567', 'url(x)', '#12345g;}body{display:none', '']) expect(accentOf({ layout: 'classic', accent }), accent).toBe(DEFAULT_ACCENT);
    expect(accentOf(null)).toBe(DEFAULT_ACCENT);
    const html = invoiceHtml('en', look({ design: { layout: 'classic', accent: 'red;}body{display:none' } }), invoice(), null);
    expect(html).not.toContain('display:none');
  });

  it('shows the logo only as a PNG, JPEG or WebP the office sent, when the profile and the design show it', () => {
    expect(logoUrl({ mime: 'image/png', data: 'iVBORw0KGgo=' })).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(logoUrl({ mime: 'image/svg+xml', data: 'PHN2Zz4=' })).toBeNull();
    expect(logoUrl({ mime: 'image/png', data: 'x" onerror="alert(1)' })).toBeNull();
    expect(logoUrl(null)).toBeNull();
    const logo = { mime: 'image/png', data: 'iVBORw0KGgo=' };
    expect(invoiceHtml('en', look({ profile: { ...look().profile!, logo } }), invoice(), null)).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(invoiceHtml('en', look({ profile: { ...look().profile!, logo, showLogo: false } }), invoice(), null)).not.toContain('<img');
    expect(invoiceHtml('en', look({ profile: { ...look().profile!, logo }, design: { layout: 'classic', accent: '#123456', show: { logo: false } } }), invoice(), null)).not.toContain('<img');
    // the company's details as the design shows them
    const bare = invoiceHtml('en', look({ design: { layout: 'classic', accent: '#123456', show: { companyAddress: false, companyPhone: false, companyTax: false, partyPhone: false, notes: false } } }), invoice(), null);
    for (const text of ['Erbil, 100m street', '066 222 3344', 'TX-77', '0750 123 4567', 'Delivered to the shop']) expect(bare, text).not.toContain(text);
    const full = invoiceHtml('en', look(), invoice(), null);
    for (const text of ['Erbil, 100m street', '066 222 3344', 'TX-77', '0750 123 4567', 'Delivered to the shop', 'Thank you']) expect(full, text).toContain(text);
  });

  it('embeds the app\'s own fonts when it has them, by the letters each covers, and only as base64', () => {
    const fonts = { arabicRegular: 'AAEC', arabicBold: 'AAED', latinRegular: 'AAEE', latinBold: 'AAEF' };
    const html = invoiceHtml('ar', look({ fonts }), invoice(), null);
    expect(html).toContain("src:url(data:font/ttf;base64,AAEC) format('truetype')");
    expect(html).toContain('unicode-range:U+0600-06FF');
    expect(invoiceHtml('ar', look({ fonts: { ...fonts, latinBold: 'x);}*{display:none' } }), invoice(), null)).not.toContain('@font-face');
    expect(invoiceHtml('ar', look(), invoice(), null)).not.toContain('@font-face');
  });

  it('makes a statement: the customer, the period, the opening balance, each line and the closing balance', () => {
    const s: Statement = {
      party: { id: 'c-1', code: 'C0001', name: 'Las', phone: '0750 765 4321', type: 'customer', active: true }, from: '2026-08-01', to: '2026-11-15', currency: null,
      opening: 10_000, totalDebit: 25_000, totalCredit: 5_000, closing: 30_000,
      lines: [
        { entryId: 'e1', invoiceId: 'inv-1', number: 'INV-2026-0001', date: '2026-09-02', description: 'Sale <b>', debit: 25_000, credit: 0, balance: 35_000, currency: 'IQD', amount: 25_000 },
        { entryId: 'e2', invoiceId: null, number: 'RV-2026-0004', date: '2026-10-02', description: 'Received', debit: 0, credit: 5_000, balance: 30_000, currency: 'IQD', amount: 5_000 }
      ]
    };
    const html = statementHtml('en', look(), s, { from: '2026-08-01', to: '2026-11-15' });
    expect(html).toContain(translate('en', 'pdfStatement'));
    expect(html).toContain(translate('en', 'pdfPeriod', { f: '⁦01/08/2026⁩', t: '⁦15/11/2026⁩' }));
    for (const n of [10_000, 25_000, 5_000, 30_000, 35_000]) expect(html, String(n)).toContain(money(n, 'IQD', 'en'));
    expect(html).toContain('Sale &lt;b&gt;');
    expect(html).toContain('RV-2026-0004');
    expect(statementHtml('ku', look(), s, { from: null, to: '2026-11-15' })).toMatch(/dir="rtl"/);
  });
});
