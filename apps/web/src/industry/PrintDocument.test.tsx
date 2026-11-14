import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_PRINT_DESIGN, DEFAULT_RECEIPT_DESIGN, PRINT_GALLERY, withGalleryDesign, type PrintDesign, type PrintDesigns, type PrintField } from '@qasa/core';
import { DataContext } from '../components.tsx';
import { I18nContext, makeI18n } from '../i18n.ts';
import type { EntryView, InvoiceView } from '../api.ts';
import { balancesAround, entryModel, entryParty, invoiceModel, sampleModel, type PrintModel } from './print-model.ts';
import { DesignedPrint, PrintDocument } from './PrintDocument.tsx';

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  request: () => new Promise(() => {}),
  api: { partyStatement: () => new Promise(() => {}), items: () => new Promise(() => {}) }
}));
vi.mock('./InvoiceQr.tsx', () => ({ InvoiceQr: () => null }));
vi.mock('./ItemImage.tsx', () => ({ ItemImage: () => null }));
vi.mock('./print-design.css', () => ({}));

const i18n = makeI18n('en', 'western', () => {}, () => {});
const data = { settings: { companyName: { ar: 'شركة', en: 'Acme Trading', ku: 'کۆمپانیا' }, defaultRateX100: 150000 }, plan: { features: [] } };
const wrap = (node: React.ReactNode) => renderToStaticMarkup(
  <I18nContext.Provider value={i18n}>
    <DataContext.Provider value={data as never}>{node}</DataContext.Provider>
  </I18nContext.Provider>
);

const modern: PrintDesign = { ...DEFAULT_PRINT_DESIGN, layout: 'modern', accent: '#aa0000' };
const compact: PrintDesign = { ...DEFAULT_PRINT_DESIGN, layout: 'compact' };
const saved: PrintDesigns = { sale: modern, quote: compact };

describe('the printed paper', () => {
  it('prints each kind with its own design, else the sale invoice’s, and the POS receipt on the receipt design', () => {
    expect(wrap(<DesignedPrint model={sampleModel('quote')} designs={saved} />)).toContain('qd-compact');
    expect(wrap(<DesignedPrint model={sampleModel('purchase')} designs={saved} />)).toContain('qd-modern');
    expect(wrap(<DesignedPrint model={sampleModel('voucher')} designs={saved} />)).toContain('qd-modern');
    expect(wrap(<DesignedPrint model={sampleModel('pos')} designs={saved} />)).toContain('qd-receipt80');
    expect(wrap(<DesignedPrint model={sampleModel('sale')} designs={{}} />)).toContain('qd-classic');
  });

  it('sets the page size and margins from the design, and none in the preview', () => {
    const html = wrap(<DesignedPrint model={sampleModel('sale')} designs={{ sale: { ...modern, paper: 'A5', marginMm: 8 } }} />);
    expect(html).toContain('size: A5; margin: 8mm;');
    expect(html).toContain('counter(page)');
    const preview = wrap(<PrintDocument model={sampleModel('sale')} design={modern} profile={null} company={data.settings.companyName} branding={false} preview />);
    expect(preview).not.toContain('@page');
  });

  it('shows and hides parts, uses renamed headings and prints free text as text, never HTML', () => {
    const design: PrintDesign = {
      ...DEFAULT_PRINT_DESIGN,
      show: { ...DEFAULT_PRINT_DESIGN.show, itemCode: false, stamp: true, bankDetails: true },
      labels: { item: 'Part', title: '<img src=x onerror=alert(1)>' },
      bankDetails: 'RAFIDAIN <script>alert(1)</script>'
    };
    const html = wrap(<PrintDocument model={sampleModel('sale')} design={design} profile={null} company={data.settings.companyName} branding />);
    expect(html).not.toContain('P-101');
    expect(html).toContain('>Part<');
    expect(html).toContain('qd-stamp');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Made with Qasa ERP');
  });

  it('adds the second language under the headings', () => {
    const html = wrap(<PrintDocument model={sampleModel('sale')} design={{ ...DEFAULT_PRINT_DESIGN, secondLang: 'ar' }} profile={null} company={data.settings.companyName} branding={false} lang="en" />);
    expect(html).toContain('qd-second');
    expect(html).toContain('الكمية');
  });

  it('prints the dinar paper’s dollar equivalent at the company’s rate', () => {
    const html = wrap(<PrintDocument model={sampleModel('sale')} design={{ ...DEFAULT_PRINT_DESIGN, show: { ...DEFAULT_PRINT_DESIGN.show, usdEquivalent: true } }} profile={null} company={data.settings.companyName} branding={false} lang="en" defaultRateX100={150000} />);
    // 145,000 IQD at 1,500 = $96.67
    expect(html).toContain('$96.67');
  });

  it('prints no discount column, even for a design saved with one: the discount is on the whole paper, under the subtotal', () => {
    const design: PrintDesign = { ...DEFAULT_PRINT_DESIGN, show: { ...DEFAULT_PRINT_DESIGN.show, discount: true }, labels: { discount: 'Rebate' } };
    const html = wrap(<PrintDocument model={sampleModel('sale')} design={design} profile={null} company={data.settings.companyName} branding={false} lang="en" />);
    const table = html.slice(html.indexOf('<table class="qd-table qd-items"'), html.indexOf('</table>'));
    expect(table).toContain('>Amount<');
    expect(table).not.toContain('Rebate');
    expect(table.match(/<tr>/g)!.length).toBe(1 + sampleModel('sale').lines.length);
    // every row has as many cells as the heading has columns
    const heads = table.slice(0, table.indexOf('</thead>')).match(/<th[ >]/g)!.length;
    for (const row of table.slice(table.indexOf('<tbody>')).split('<tr>').slice(1)) expect(row.match(/<td/g)!.length).toBe(heads);
    // the paper's own discount still prints with the totals
    expect(html.slice(html.indexOf('</table>'))).toContain('Rebate');
  });
});

const company = data.settings.companyName;
const paper = (model: PrintModel, design: PrintDesign, lang: 'ar' | 'en' | 'ku' = 'en', profile: Parameters<typeof PrintDocument>[0]['profile'] = null) =>
  wrap(<PrintDocument model={model} design={design} profile={profile} company={company} branding={false} lang={lang} preview />);
const showing = (on: Partial<Record<PrintField, boolean>>, base: PrintDesign = DEFAULT_PRINT_DESIGN): PrintDesign => ({ ...base, show: { ...base.show, ...on } });

describe('the balance before and after a paper', () => {
  // Raz owed 500,000; a 200,000 invoice, a 150,000 receipt, then another invoice the same day
  const statement = {
    party: { type: 'customer' },
    closing: 650_000,
    lines: [
      { entryId: 'e-old', invoiceId: 'i-old', debit: 500_000, credit: 0, balance: 500_000 },
      { entryId: 'e-inv', invoiceId: 'i-1', debit: 200_000, credit: 0, balance: 700_000 },
      { entryId: 'e-rv', invoiceId: null, debit: 0, credit: 150_000, balance: 550_000 },
      { entryId: 'e-later', invoiceId: 'i-2', debit: 100_000, credit: 0, balance: 650_000 }
    ]
  };

  it('finds a posted paper in the statement: what was owed before it and right after it, not at the end of the day', () => {
    expect(balancesAround(statement, { entryIds: ['e-rv'] })).toEqual({ previous: 700_000, after: 550_000 });
    expect(balancesAround(statement, { invoiceId: 'i-1' })).toEqual({ previous: 500_000, after: 700_000 });
    // an invoice with the money taken with it: from before the invoice to after its payment
    expect(balancesAround(statement, { invoiceId: 'i-1', entryIds: ['e-inv', 'e-rv'] })).toEqual({ previous: 500_000, after: 550_000 });
  });

  it('works out a paper not posted yet from what it will change, and a supplier in the direction of what is owed to them', () => {
    // a receipt of 150,000 from a customer credits them: they owe that much less
    expect(balancesAround(statement, { entryIds: ['draft'], rawEffect: -150_000 })).toEqual({ previous: 650_000, after: 500_000 });
    // paying a supplier 40,000 debits them: we owe that much less
    const supplier = { party: { type: 'supplier' }, closing: 90_000, lines: [] };
    expect(balancesAround(supplier, { entryIds: ['draft'], rawEffect: 40_000 })).toEqual({ previous: 90_000, after: 50_000 });
    // a quotation moves nothing: the balance as it stands
    expect(balancesAround(statement, {})).toEqual({ previous: null, after: 650_000 });
  });

  const voucher = {
    id: 'e-rv', type: 'receipt', number: 'RV-7', date: '2026-11-07', description: '', party: null, currency: 'IQD', rateX100: 100, status: 'approved',
    total: 150_000, baseTotal: 150_000, preparedBy: 'Mer',
    lines: [
      { lineNo: 1, accountCode: '1811', accountName: { ar: 'الصندوق', en: 'Safe', ku: 'سندوق' }, debit: 150_000, credit: 0, baseDebit: 150_000, baseCredit: 0, description: '', partyId: null, partyName: null },
      { lineNo: 2, accountCode: '1611', accountName: { ar: 'العملاء', en: 'Customers', ku: 'کڕیاران' }, debit: 0, credit: 150_000, baseDebit: 0, baseCredit: 150_000, description: '', partyId: 'p-raz', partyName: 'Raz' }
    ]
  } as unknown as EntryView;

  it('knows whose balance a voucher prints: the customer or supplier on its lines', () => {
    expect(entryParty(voucher)).toEqual({ partyId: 'p-raz', name: 'Raz', rawEffect: -150_000 });
    const model = entryModel(voucher);
    expect(model.balanceOf).toEqual({ partyId: 'p-raz', date: '2026-11-07', entryIds: ['e-rv'], rawEffect: -150_000 });
    // the party picked on the line is named on the paper when "received from" was left empty
    expect(model.party?.name).toBe('Raz');
    expect(entryModel({ ...voucher, lines: voucher.lines.slice(0, 1) } as EntryView).balanceOf).toBeNull();
  });

  it('knows whose balance an invoice prints: a posted one with a customer from the list, with the money taken with it', () => {
    const inv = {
      id: 'i-1', kind: 'sale', number: 'INV-1', date: '2026-11-07', status: 'posted', partyId: 'p-raz', partyName: 'Raz', partyCode: null, partyPhone: null,
      partyAddress: null, currency: 'IQD', rateX100: 100, lines: [], subtotal: 0, discount: 0, total: 0, baseTotal: 0, notes: '', createdBy: 'Mer',
      entryId: 'e-inv', payments: [{ entryId: 'e-rv' }, { entryId: null }]
    } as unknown as InvoiceView;
    expect(invoiceModel(inv).balanceOf).toEqual({ partyId: 'p-raz', date: '2026-11-07', invoiceId: 'i-1', entryIds: ['e-inv', 'e-rv'] });
    expect(invoiceModel({ ...inv, status: 'draft' } as InvoiceView).balanceOf).toBeNull();
    expect(invoiceModel({ ...inv, partyId: null } as InvoiceView).balanceOf).toBeNull();
    // the POS receipt is the same invoice: its design's balance prints too
    expect(invoiceModel(inv, { pos: true }).balanceOf).not.toBeNull();
  });

  it('prints a real voucher\'s note and, for dollars, its rate when the design shows them, and neither when it does not', () => {
    // the same voucher taken in dollars at 1,450, with what its preparer wrote
    const model = entryModel({ ...voucher, currency: 'USD', rateX100: 145_000, description: 'First part of the November invoice' } as EntryView);
    for (const g of PRINT_GALLERY) {
      const base = withGalleryDesign(DEFAULT_PRINT_DESIGN, g.id);
      const on = paper(model, showing({ notes: true, exchangeRate: true }, base));
      expect(on, g.id).toContain('First part of the November invoice');
      expect(on, g.id).toContain('Exchange rate');
      expect(on, g.id).toContain('1450');
      const off = paper(model, showing({ notes: false, exchangeRate: false }, base));
      expect(off, g.id).not.toContain('First part of the November invoice');
      expect(off, g.id).not.toContain('Exchange rate');
    }
    // a dinar voucher has no rate to print
    expect(paper(entryModel(voucher), showing({ exchangeRate: true }))).not.toContain('Exchange rate');
  });

  it('prints the previous balance, the amount received and the remaining balance on a receipt voucher when the design shows them', () => {
    const model: PrintModel = { ...entryModel(voucher), previousBalance: 700_000, partyBalance: 550_000 };
    const on = paper(model, showing({ partyBalance: true, previousBalance: true }));
    const totals = on.slice(on.indexOf('qd-totals'));
    expect(totals).toContain('Previous balance');
    expect(totals).toContain('700,000');
    expect(totals).toContain('150,000');
    expect(totals).toContain('Remaining balance');
    expect(totals).toContain('550,000');
    // what was owed, what was received, what is left: in that order
    expect(totals.indexOf('Previous balance')).toBeLessThan(totals.indexOf('qd-grand'));
    expect(totals.indexOf('qd-grand')).toBeLessThan(totals.indexOf('Remaining balance'));
    const off = paper(model, showing({ partyBalance: false, previousBalance: false }));
    expect(off).not.toContain('Remaining balance');
    expect(off).not.toContain('Previous balance');
    // each switch on its own
    const onlyAfter = paper(model, showing({ partyBalance: true, previousBalance: false }));
    expect(onlyAfter).toContain('Remaining balance');
    expect(onlyAfter).not.toContain('Previous balance');
  });

  it('prints both balances on an invoice under the total, in every layout', () => {
    for (const g of PRINT_GALLERY) {
      const html = paper(sampleModel('sale'), showing({ partyBalance: true, previousBalance: true }, withGalleryDesign(DEFAULT_PRINT_DESIGN, g.id)));
      expect(html, g.id).toContain('Previous balance');
      expect(html, g.id).toContain('250,000');
      expect(html, g.id).toContain('Balance after this');
      expect(html, g.id).toContain('395,000');
    }
  });
});

describe('the designs', () => {
  it('draws Modern with lines: a band with the company, the title and the number, the customer beside the date, a ruled table', () => {
    const html = paper(sampleModel('sale'), withGalleryDesign(DEFAULT_PRINT_DESIGN, 'modernLines'));
    expect(html).toContain('qd-paper qd-modernLines qd-a4');
    const band = html.slice(html.indexOf('qd-band'), html.indexOf('</header>'));
    expect(band).toContain('Acme Trading');
    expect(band).toContain('INV-2026-0128');
    expect(band).toContain('qd-title');
    expect(html).toContain('qd-info-party');
    expect(html).toContain('qd-table qd-items');
    expect(html).not.toContain('qd-title-row');
  });

  it('draws the Classic ledger: the title in the middle, the details in a box, the totals ruled and joined to the table, the stamp box', () => {
    const html = paper(sampleModel('sale'), showing({ stamp: true }, { ...withGalleryDesign(DEFAULT_PRINT_DESIGN, 'ledger'), secondLang: 'ar' }));
    expect(html).toContain('qd-paper qd-ledger qd-a4');
    expect(html).toContain('qd-title-center');
    const box = html.slice(html.indexOf('qd-box'), html.indexOf('</dl>'));
    for (const text of ['INV-2026-0128', 'Customer', 'C-0012', '0770 123 4567']) expect(box, text).toContain(text);
    const totals = html.slice(html.indexOf('qd-tot-table'));
    expect(totals).toContain('qd-words-cell');
    expect(totals).toContain('rowSpan="3"');
    expect(totals).toContain('145,000');
    expect(html).toContain('qd-stamp');
    // the company's name in the second language, on the other side of the header
    expect(html).toContain('qd-company-2');
    expect(html).toContain('شركة');
    // Arabic and English headings
    expect(html).toContain('الكمية');
  });

  it('draws the half page on A5 and the receipt on the 80 mm roll, with the page size to match', () => {
    const half = withGalleryDesign(DEFAULT_PRINT_DESIGN, 'halfPage');
    expect(paper(sampleModel('sale'), half)).toContain('qd-paper qd-compact qd-a5');
    expect(wrap(<PrintDocument model={sampleModel('sale')} design={half} profile={null} company={company} branding={false} />)).toContain('size: A5;');
    const roll = wrap(<PrintDocument model={sampleModel('pos')} design={DEFAULT_RECEIPT_DESIGN} profile={null} company={company} branding={false} />);
    expect(roll).toContain('qd-paper qd-receipt80 qd-80mm');
    expect(roll).toContain('@page { margin: 3mm;');
    expect(roll).not.toContain('size:');
  });

  it('draws every design for every kind of paper in Arabic, English and Kurdish, right to left and left to right', () => {
    for (const g of PRINT_GALLERY) {
      for (const doc of ['sale', 'purchase', 'return', 'quote', 'voucher', 'pos'] as const) {
        for (const lang of ['ar', 'en', 'ku'] as const) {
          const html = paper(sampleModel(doc), withGalleryDesign(DEFAULT_PRINT_DESIGN, g.id), lang);
          const what = [g.id, doc, lang].join(' ');
          expect(html, what).toContain('dir="' + (lang === 'en' ? 'ltr' : 'rtl') + '"');
          expect(html, what).toContain(doc === 'voucher' ? 'RV-2026-0042' : doc === 'quote' ? 'QT-2026-0007' : 'INV-2026-0128');
        }
      }
    }
  });
});

describe('the sample voucher of the designer', () => {
  const voucher = sampleModel('voucher', 'en');

  it('carries a note and dollars with their rate, so the Notes and Exchange rate switches change the preview', () => {
    expect(voucher.notes).toBe('Payment for invoice INV-2026-0128');
    expect(voucher.currency).toBe('USD');
    expect(voucher.rateX100).toBe(142_000);
    // the dinars are the dollars at that rate, and the balance left is the balance before less those dinars
    expect(voucher.baseTotal).toBe(Math.round((voucher.total * voucher.rateX100) / 10000));
    expect(voucher.partyBalance).toBe(voucher.previousBalance! - voucher.baseTotal);
    expect(voucher.accountLines.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
    for (const lang of ['ar', 'en', 'ku'] as const) expect(sampleModel('voucher', lang).notes, lang).not.toBe('');
    for (const g of PRINT_GALLERY) {
      const base = withGalleryDesign(DEFAULT_PRINT_DESIGN, g.id);
      for (const [field, text] of [['notes', 'Payment for invoice INV-2026-0128'], ['exchangeRate', 'Exchange rate'], ['usdEquivalent', '1,207,000']] as [PrintField, string][]) {
        expect(paper(voucher, showing({ [field]: true, previousBalance: false, partyBalance: false }, base), 'en'), `${g.id}: ${field} on`).toContain(text);
        expect(paper(voucher, showing({ [field]: false, previousBalance: false, partyBalance: false }, base), 'en'), `${g.id}: ${field} off`).not.toContain(text);
      }
      expect(paper(voucher, showing({ exchangeRate: true }, base), 'en'), g.id).toContain('1420');
    }
  });
});

describe('what the paper shows', () => {
  const profile = { address: 'Erbil, 60 m street', phone: '0750 000 0000', taxNumber: 'TX-123', footer: '', showLogo: true, logo: { mime: 'image/png' as const, data: 'AAAA', updatedAt: '' } };
  const all = (model: PrintModel, on: Partial<Record<PrintField, boolean>>, base: PrintDesign = DEFAULT_PRINT_DESIGN) => paper(model, showing(on, base), 'en', profile);
  const sale: PrintModel = { ...sampleModel('sale'), notes: 'Deliver before noon', currency: 'USD', rateX100: 150_000, baseTotal: 217_500_000 };

  it('shows and hides each part by its own switch, in every layout that prints it', () => {
    const cases: [PrintField, string][] = [
      ['logo', 'data:image/png;base64,AAAA'], ['companyAddress', 'Erbil, 60 m street'], ['companyPhone', '0750 000 0000'], ['companyTax', 'TX-123'],
      ['partyPhone', '0770 123 4567'], ['partyAddress', 'أربيل، شارع 60'], ['itemCode', 'P-101'], ['unit', 'piece'], ['subtotal', 'Subtotal'],
      ['notes', 'Deliver before noon'], ['amountWords', 'qd-words-label'], ['exchangeRate', 'Exchange rate'], ['signatures', 'Received by'], ['stamp', 'qd-stamp'],
      ['qr', 'qd-qr'], ['usdEquivalent', 'Equivalent']
    ];
    for (const g of PRINT_GALLERY) {
      const base = withGalleryDesign(DEFAULT_PRINT_DESIGN, g.id);
      for (const [field, text] of cases) {
        expect(all(sale, { [field]: true }, base), g.id + ': ' + field + ' on').toContain(text);
        expect(all(sale, { [field]: false }, base), g.id + ': ' + field + ' off').not.toContain(text);
      }
    }
  });

  it('prints the terms and the bank details when they are on and written', () => {
    const base: PrintDesign = { ...DEFAULT_PRINT_DESIGN, terms: 'Goods are returned within 7 days', bankDetails: 'Account 123-456' };
    expect(all(sale, { terms: true, bankDetails: true }, base)).toContain('Goods are returned within 7 days');
    expect(all(sale, { terms: true, bankDetails: true }, base)).toContain('Account 123-456');
    expect(all(sale, { terms: false, bankDetails: false }, base)).not.toContain('Goods are returned within 7 days');
    expect(all(sale, { terms: false, bankDetails: false }, base)).not.toContain('Account 123-456');
  });

  it('prints no logo the server did not hand out (a plan without it), whatever the design says', () => {
    expect(paper(sale, showing({ logo: true }), 'en', { ...profile, logo: null })).not.toContain('<img');
    expect(paper(sale, showing({ logo: true }), 'en', { ...profile, showLogo: false })).not.toContain('<img');
  });
});

describe('codes beside names', () => {
  it('keeps the item code apart from the item name on the 80 mm receipt, whatever the direction', () => {
    const html = paper(sampleModel('pos'), showing({ itemCode: true }, DEFAULT_RECEIPT_DESIGN), 'ku');
    // the separator is outside the left-to-right code: a space inside it would fall on the code's far side
    expect(html).toContain('<span class="qd-muted"> · <span class="ltr qd-nb">P-101</span></span>');
    expect(html).not.toMatch(/class="[^"]*ltr[^"]*"> P-101/);
  });

  it('never breaks the customer code across lines, on any layout', () => {
    for (const design of [DEFAULT_PRINT_DESIGN, withGalleryDesign(DEFAULT_PRINT_DESIGN, 'ledger'), { ...DEFAULT_PRINT_DESIGN, layout: 'modern' as const }]) {
      expect(paper(sampleModel('sale'), design)).toContain('<span class="ltr qd-nb">C-0012</span>');
    }
  });
});
