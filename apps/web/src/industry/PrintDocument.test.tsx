import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_PRINT_DESIGN, type PrintDesign, type PrintDesigns } from '@qasa/core';
import { DataContext } from '../components.tsx';
import { I18nContext, makeI18n } from '../i18n.ts';
import { sampleModel } from './print-model.ts';
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
});
