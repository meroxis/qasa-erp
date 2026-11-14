import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PRINT_DOCS, type Lang } from '@qasa/core';
import type { EntryView, InvoiceView } from './api.ts';
import { buildHas } from './components.tsx';
import { I18nContext, isKey, makeI18n, type Key } from './i18n.ts';
import { closedPageAddress } from './router.ts';
import { entryModel, invoiceModel, POS_TITLE, sampleModel } from './industry/print-model.ts';
import { partsNotice } from './pages/CarParts.tsx';
import { jobStageShown, worksHelpKey } from './pages/EngineeringWorks.tsx';
import { CartName } from './pages/Pos.tsx';
import { cartShortNote } from './pages/pos-logic.ts';
import { logoTickShown } from './pages/PrintDesign.tsx';
import { reportTabsFor } from './pages/tabs.ts';
import { transferOffer } from './pages/transfer-offer.ts';

// The second hands-on test of 1.4: small things on many screens, each said in the words of what was wrong.

const LANGS: Lang[] = ['ar', 'en', 'ku'];
const texts = (lang: Lang) => makeI18n(lang, 'western', () => {}, () => {});
const src = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('"New transfer" on Stock documents leads only where the person can go', () => {
  const offer = (o: Partial<Parameters<typeof transferOffer>[0]>) => transferOffer({ warehouses: 1, planWarehouses: 1, mayOpenPlans: true, mayAddWarehouse: true, ...o });

  it('opens the form with two warehouses, whatever the plan', () => {
    expect(offer({ warehouses: 2 })).toBe('form');
    expect(offer({ warehouses: 3, planWarehouses: null, mayOpenPlans: false, mayAddWarehouse: false })).toBe('form');
  });

  it('names the plan only when the plan allows one warehouse, and links to Plans only for someone who can open it', () => {
    expect(offer({})).toBe('plan-link');
    // a storekeeper cannot open Plans: the reason as plain text, no button that lands on Home
    expect(offer({ mayOpenPlans: false, mayAddWarehouse: false })).toBe('plan-note');
  });

  it('on a plan with more warehouses says to add a second one: a link for who may add it, plain text otherwise', () => {
    for (const planWarehouses of [null, 5, undefined]) {
      expect(offer({ planWarehouses })).toBe('add-link');
      expect(offer({ planWarehouses, mayAddWarehouse: false, mayOpenPlans: false })).toBe('add-note');
    }
    const page = src('./pages/StockDocs.tsx');
    expect(page).toContain("href={href('items/warehouses')}");
    // the Plans link is under the one case that names the plan
    expect(page.match(/href\('plans'\)/g)).toHaveLength(1);
    expect(page).toContain("offer === 'plan-link' ? <a className=\"btn\" href={href('plans')}");
    for (const lang of LANGS) {
      expect(texts(lang).t('transferNeedsSecond')).not.toMatch(/Free|المجانية|بەخۆڕایی/);
      expect(texts(lang).t('transferNeedsTwo')).toMatch(/Free|المجانية|بەخۆڕایی/);
    }
  });
});

describe('small things said truly', () => {
  it('"Print the logo" shows whenever a logo is saved, kept ones too, so the advice of the remove question on Free is true', () => {
    expect(logoTickShown({ canLogo: false, logo: false, kept: true })).toBe(true);
    expect(logoTickShown({ canLogo: false, logo: true, kept: false })).toBe(true);
    expect(logoTickShown({ canLogo: true, logo: false, kept: false })).toBe(true);
    expect(logoTickShown({ canLogo: false, logo: false, kept: false })).toBe(false);
    for (const lang of LANGS) expect(texts(lang).t('pp_removeLogoFree')).toContain(texts(lang).t('pp_showLogo'));
  });

  it('car parts: the plan notice only when the plan lacks the feature; a neutral note when it is the role', () => {
    expect(partsNotice(false, true)).toBe('plan');
    expect(partsNotice(false, false)).toBe('plan');
    expect(partsNotice(true, false)).toBe('role');
    expect(partsNotice(true, true)).toBeNull();
    for (const lang of LANGS) expect(texts(lang).t('pt_readOnly')).not.toMatch(/Starter|Pro|Business/);
  });

  it('a closed page shows Home under Home\'s address', () => {
    expect(closedPageAddress({ closed: true, page: 'users', signedIn: true })).toBe('#/');
    expect(closedPageAddress({ closed: true, page: 'new-invoice', signedIn: true })).toBe('#/');
    // open, already Home, or nobody known yet: the address stays
    expect(closedPageAddress({ closed: false, page: 'users', signedIn: true })).toBeNull();
    expect(closedPageAddress({ closed: true, page: undefined, signedIn: true })).toBeNull();
    expect(closedPageAddress({ closed: true, page: 'home', signedIn: true })).toBeNull();
    expect(closedPageAddress({ closed: true, page: 'users', signedIn: false })).toBeNull();
    expect(src('./App.tsx')).toContain('window.location.replace(closedAddress)');
  });

  it('asks the server only for what the build serves: no backups, office network, phones or database server without the module', () => {
    expect(buildHas([], 'backup')).toBe(false);
    expect(buildHas(['backup', 'network'], 'network')).toBe(true);
    expect(buildHas(['backup'], 'phones')).toBe(false);
    // a server from before says nothing: asked as it used to be
    expect(buildHas(undefined, 'database')).toBe(true);
    const settings = src('./pages/Settings.tsx');
    for (const name of ['backup', 'network', 'phones', 'database']) expect(settings, name).toContain(`useBuildHas('${name}')`);
    expect(src('./industry/BackupNotice.tsx')).toContain('if (!admin || !served) return;');
    expect(src('./App.tsx')).toContain("served={buildHas(modules, 'backup')}");
  });

  it('reports: without the books no profit, no stock valuation and no ageing of what suppliers are owed', () => {
    expect(reportTabsFor(false)).toEqual(['sales-items', 'sales-categories', 'sales-brands', 'sales-customers', 'aging']);
    expect(reportTabsFor(true)).toContain('supplier-aging');
  });

  it('the Settings tile "Sales and point of sale" says what is inside it', () => {
    for (const lang of LANGS) {
      const m = texts(lang);
      expect(m.t('s14_salesSectionHelp')).not.toBe(m.t('ex_settings'));
      expect(m.t('s14_salesSectionHelp')).toContain(m.t('ex_policy'));
    }
  });
});

describe('currency names, the job page and the works list', () => {
  it('no select offers the bare codes IQD / USD: the app\'s currency names', () => {
    const dir = fileURLToPath(new URL('./pages/', import.meta.url));
    const raw = readdirSync(dir).filter((f) => f.endsWith('.tsx') && !f.includes('.test.')).filter((f) => /<option value="(IQD|USD)">(IQD|USD)<\/option>/.test(readFileSync(dir + f, 'utf8')));
    expect(raw).toEqual([]);
    expect(src('./pages/EngineeringWorks.tsx')).toContain(`<option value="IQD">{t('iqdName')}</option><option value="USD">{t('usdName')}</option>`);
    expect(src('./pages/Installments.tsx')).toContain(`<option value="IQD">{t('iqdName')}</option><option value="USD">{t('usdName')}</option>`);
    expect(texts('ku').t('iqdName')).toBe('دینار');
    expect(texts('ar').t('usdName')).toBe('دولار');
  });

  it('a job at the quote stage is headed "Quotation" once: the stage chip shows from the next stage on', () => {
    expect(jobStageShown('quote')).toBe(false);
    for (const status of ['measuring', 'approved', 'fabricating', 'installing', 'done', 'invoiced', 'cancelled'] as const) expect(jobStageShown(status)).toBe(true);
    for (const lang of LANGS) expect(texts(lang).t('ew_st_quote')).toBe(lang === 'en' ? 'Quote' : texts(lang).t('ew_quotation'));
  });

  it('the works list promises a job\'s cost and profit only to someone who is shown them', () => {
    expect(worksHelpKey(true)).toBe('ew_help');
    expect(worksHelpKey(false)).toBe('ew_helpNoCost');
    const words: Record<Lang, RegExp> = { ar: /كلفة|ربح/, en: /cost|earned|profit/, ku: /تێچوو|قازانج/ };
    for (const lang of LANGS) {
      expect(texts(lang).t('ew_help')).toMatch(words[lang]);
      expect(texts(lang).t('ew_helpNoCost')).not.toMatch(words[lang]);
    }
  });
});

describe('printed papers', () => {
  const entry = (lines: { description: string }[], description: string): EntryView => ({
    id: 'e1', type: 'receipt', number: 'RV-2026-0001', date: '2026-11-14', description, party: 'Raz', currency: 'IQD', rateX100: 100, status: 'approved',
    cashAccountCode: '1811', preparedBy: 'Las', total: 40_000, baseTotal: 40_000,
    lines: lines.map((l, i) => ({
      lineNo: i + 1, accountCode: i ? '1611' : '1811', accountName: { ar: 'حساب', en: 'Account', ku: 'هەژمار' }, debit: i ? 0 : 40_000, credit: i ? 40_000 : 0,
      baseDebit: i ? 0 : 40_000, baseCredit: i ? 40_000 : 0, description: l.description, partyId: i ? 'p1' : null, partyName: i ? 'Raz' : null
    }))
  } as unknown as EntryView);

  it('a receipt voucher prints its note once: at the foot, not again under each account line', () => {
    const model = entryModel(entry([{ description: 'For invoice INV-2026-0128' }, { description: ' For invoice INV-2026-0128 ' }], 'For invoice INV-2026-0128'));
    expect(model.notes).toBe('For invoice INV-2026-0128');
    expect(model.accountLines.map((l) => l.description)).toEqual(['', '']);
    // a line with a note of its own keeps it
    const own = entryModel(entry([{ description: 'Cash counted by Mer' }, { description: 'For invoice INV-2026-0128' }], 'For invoice INV-2026-0128'));
    expect(own.accountLines.map((l) => l.description)).toEqual(['Cash counted by Mer', '']);
  });

  it('a till receipt is headed "Sales receipt" (وەسڵی فرۆشتن) in the designer\'s preview and on the designed receipt, as on the standard one', () => {
    expect(POS_TITLE).toBe('pos_receipt');
    expect(sampleModel('pos', 'ku').titleKey).toBe(POS_TITLE);
    expect(texts('ku').t(POS_TITLE)).toBe('وەسڵی فرۆشتن');
    const sale = { kind: 'sale', status: 'posted', lines: [], payments: [], partyName: null, partyId: null } as unknown as InvoiceView;
    expect(invoiceModel(sale, { pos: true }).titleKey).toBe(POS_TITLE);
    expect(invoiceModel(sale).titleKey).toBe('sale');
    // every other paper keeps its own title
    for (const doc of PRINT_DOCS) if (doc !== 'pos') expect(sampleModel(doc, 'ku').titleKey).not.toBe(POS_TITLE);
    expect(src('./pages/Pos.tsx')).toContain("{t('pos_receipt')}");
  });

  it('a till sale read later still carries the cash handed over and the change, for a copy of its receipt', () => {
    const sale = { kind: 'sale', status: 'posted', lines: [], payments: [], partyName: null, partyId: null, tender: { paid: 125_000, change: 25_000 } } as unknown as InvoiceView;
    expect(invoiceModel(sale).tender).toEqual({ paid: 125_000, change: 25_000 });
    expect(invoiceModel({ ...sale, tender: undefined } as unknown as InvoiceView).tender).toBeNull();
    expect(src('./industry/PrintDocument.tsx')).toContain("label: plain('pos_paid'), value: money(model.tender.paid)");
    // the till sends what was handed over with the sale
    expect(src('./pages/Pos.tsx')).toContain('...(handed ? { tendered: handed.paid } : {})');
  });
});

describe('the till', () => {
  it('a long name in the cart opens in full on a tap: a button that says whether it is open', () => {
    const html = renderToStaticMarkup(<I18nContext.Provider value={texts('en')}><CartName name="Engine oil 5W-30, 4 L, synthetic, for petrol engines" /></I18nContext.Provider>);
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Engine oil 5W-30, 4 L, synthetic, for petrol engines');
    const css = src('./pos.css');
    expect(css).toContain('.pos-line-name > span:first-child.pos-name-open { display: block; -webkit-line-clamp: unset; overflow: visible; }');
    expect(src('./pages/Pos.tsx')).toContain('<CartName name={i18n.name(l.item.name)} />');
  });

  it('warns as an item beyond the stock is added, with what is left of it; the server still decides at Pay', () => {
    const one = (code: string, have: number) => `${code} (${have / 1000})`;
    expect(cartShortNote([], one, ', ')).toBe('');
    expect(cartShortNote([{ code: 'TEA', haveMilli: 0 }], one, ', ')).toBe('TEA (0)');
    expect(cartShortNote([{ code: 'TEA', haveMilli: 0 }, { code: 'CUP', haveMilli: 2000 }], one, '، ')).toBe('TEA (0)، CUP (2)');
    for (const lang of LANGS) expect(texts(lang).t('pos_cartShort', { i: 'TEA (0)' })).toContain('TEA (0)');
    const till = src('./pages/Pos.tsx');
    expect(till).toContain('cartShortNote(shortStock(cart)');
    expect(till).toContain("{shortNow && <div className=\"alert warn small\" role=\"status\">{t('pos_cartShort', { i: shortNow })}</div>}");
  });
});

describe('the new texts', () => {
  it('are there in Arabic, English and Kurdish', () => {
    const keys = [
      's14_balanceAlso', 's14_invoiceSettled', 's14_invoiceWaits', 's14_invReceived', 's14_invPaid', 's14_invWaiting', 's14_invOpen', 's14_invNothingOpen',
      'transferNeedsSecond', 'transferAddWarehouse', 'fsCustomers', 'fsCustomersHint', 'fsItems', 'fsItemsHint', 'pt_readOnly', 'ew_helpNoCost', 'pos_cartShort'
    ];
    for (const key of keys) {
      expect(isKey(key), key).toBe(true);
      const all = LANGS.map((lang) => texts(lang).t(key as Key));
      for (const text of all) expect(text.trim(), key).not.toBe('');
      expect(new Set(all).size, key).toBe(3);
    }
  });
});
