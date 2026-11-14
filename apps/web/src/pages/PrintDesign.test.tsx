import { describe, expect, it } from 'vitest';
import { checkPrintDesign, DEFAULT_PRINT_DESIGN, DEFAULT_RECEIPT_DESIGN, galleryIdOf, PRINT_DOCS, PRINT_FIELDS, PRINT_FONT_SIZES, PRINT_GALLERY, PRINT_LAYOUTS, withGalleryDesign } from '@qasa/core';
import { LABEL_TEXT } from '../i18n/labels.ts';
import { PRINT14_TEXT } from '../i18n/print14.ts';
import { isKey, makeI18n } from '../i18n.ts';
import { balanceLabelKey, sampleModel } from '../industry/print-model.ts';
import { DESIGNER_FIELDS, designerGroups, FIELD_GROUPS, fieldLabelKey, fontSizeName, mayRemoveLogo, problemText, withLayout } from './PrintDesign.tsx';

describe('removing the company logo', () => {
  it('asks first on a plan that cannot add a logo again, and removes nothing when the answer is no', () => {
    const asked: string[] = [];
    const answer = (yes: boolean) => (key: string) => { asked.push(key); return yes; };
    // a paid plan (or the free month): the logo can be chosen again, so nothing is asked
    expect(mayRemoveLogo(true, answer(false))).toBe(true);
    expect(asked).toEqual([]);
    // Free, with a logo kept from before: one question, and "no" keeps the logo
    expect(mayRemoveLogo(false, answer(false))).toBe(false);
    expect(mayRemoveLogo(false, answer(true))).toBe(true);
    expect(asked).toEqual(['pp_removeLogoFree', 'pp_removeLogoFree']);
    // the question says what is lost and the other way, in the three languages
    expect(new Set(PRINT14_TEXT.pp_removeLogoFree).size).toBe(3);
    expect(PRINT14_TEXT.pp_removeLogoFree[1]).toContain(LABEL_TEXT.pp_showLogo[1]);
    expect(PRINT14_TEXT.pp_removeLogoFree[0]).toContain(LABEL_TEXT.pp_showLogo[0]);
    expect(PRINT14_TEXT.pp_removeLogoFree[2]).toContain(LABEL_TEXT.pp_showLogo[2]);
  });
});

describe('the print designer', () => {
  it('moves the thermal receipt onto 80 mm paper and back to A4, always as a design the server accepts', () => {
    const receipt = withLayout(DEFAULT_PRINT_DESIGN, 'receipt80');
    expect(receipt).toMatchObject({ layout: 'receipt80', paper: '80mm' });
    expect(receipt.marginMm).toBeLessThanOrEqual(5);
    expect('design' in checkPrintDesign(receipt)).toBe(true);
    const back = withLayout(receipt, 'modern');
    expect(back).toMatchObject({ layout: 'modern', paper: 'A4', marginMm: DEFAULT_PRINT_DESIGN.marginMm });
    expect('design' in checkPrintDesign(back)).toBe(true);
    expect(withLayout({ ...DEFAULT_PRINT_DESIGN, paper: 'A5' }, 'compact').paper).toBe('A5');
  });

  it('offers no discount column (lines have no discount of their own), yet still accepts a design saved with one', () => {
    expect(DESIGNER_FIELDS).not.toContain('discount');
    expect(DESIGNER_FIELDS).toEqual(PRINT_FIELDS.filter((f) => f !== 'discount'));
    const older = { ...DEFAULT_PRINT_DESIGN, show: { ...DEFAULT_PRINT_DESIGN.show, discount: true } };
    expect('design' in checkPrintDesign(older)).toBe(true);
  });

  it('has a label for each field it offers, and none for a field it does not', () => {
    // remainingBalance is the voucher's name for the balance after the paper, not a part of its own
    const labels = Object.keys({ ...LABEL_TEXT, ...PRINT14_TEXT }).filter((k) => k.startsWith('pd_f_')).map((k) => k.slice('pd_f_'.length)).filter((k) => k !== 'remainingBalance').sort();
    expect(labels).toEqual([...DESIGNER_FIELDS].sort());
    for (const doc of PRINT_DOCS) for (const f of DESIGNER_FIELDS) expect(isKey(fieldLabelKey(f, doc)), f).toBe(true);
    // the balance after the paper: the option is named by the very words the paper prints, one wording for both
    expect(fieldLabelKey('partyBalance', 'voucher')).toBe('pd_h_remainingBalance');
    expect(fieldLabelKey('partyBalance', 'quote')).toBe('pd_h_currentBalance');
    for (const doc of ['sale', 'purchase', 'return', 'pos'] as const) expect(fieldLabelKey('partyBalance', doc)).toBe('pd_h_balance');
    for (const doc of PRINT_DOCS) expect(fieldLabelKey('partyBalance', doc)).toBe(balanceLabelKey(doc));
    const ku = makeI18n('ku', 'western', () => {}, () => {});
    expect(ku.t(fieldLabelKey('partyBalance', 'voucher'))).toBe('ڕەسیدی ماوە');
    expect(ku.t(fieldLabelKey('partyBalance', 'sale'))).toBe('ڕەسید دوای ئەم پسوولەیە');
    // the same words as the short form of "Receive payment" for what is left
    expect(ku.t('s14_balanceAfter')).toBe(ku.t('pd_h_remainingBalance'));
  });

  it('shows every part once, in groups, and only the parts the kind of paper and the layout can print', () => {
    expect(FIELD_GROUPS.flatMap((g) => g.fields).sort()).toEqual([...DESIGNER_FIELDS].sort());
    const offered = (doc: (typeof PRINT_DOCS)[number], layout: (typeof PRINT_LAYOUTS)[number]) => designerGroups(doc, layout).flatMap((g) => g.fields);
    // a voucher has no item lines, no subtotal and no verify code, but it does print the two balances
    const voucher = offered('voucher', 'classic');
    for (const f of ['itemCode', 'barcode', 'itemImage', 'unit', 'subtotal', 'qr'] as const) expect(voucher, f).not.toContain(f);
    expect(voucher).toEqual(expect.arrayContaining(['previousBalance', 'partyBalance', 'signatures', 'stamp', 'amountWords']));
    // nor its party's phone and address: a switch that changes nothing on the real paper is not offered, and the
    // sample voucher is built as a real one is
    for (const f of ['partyPhone', 'partyAddress'] as const) expect(voucher, f).not.toContain(f);
    expect(offered('sale', 'classic')).toEqual(expect.arrayContaining(['partyPhone', 'partyAddress']));
    expect(sampleModel('voucher').party).toEqual({ name: sampleModel('sale').party!.name, code: null, phone: null, address: null });
    expect(offered('voucher', 'receipt80')).not.toContain('pageNumbers');
    expect(offered('voucher', 'classic')).toContain('pageNumbers');
    // the verify code is a sale's; a receipt roll has no pages, pictures or barcodes
    expect(offered('purchase', 'classic')).not.toContain('qr');
    expect(offered('sale', 'modernLines')).toContain('qr');
    const roll = offered('pos', 'receipt80');
    for (const f of ['pageNumbers', 'itemImage', 'barcode'] as const) expect(roll, f).not.toContain(f);
    expect(offered('quote', 'ledger')).not.toContain('unit');
    for (const doc of PRINT_DOCS) for (const layout of PRINT_LAYOUTS) expect(offered(doc, layout)).not.toContain('discount');
  });

  it('offers a gallery of designs: each a design the server accepts, on its paper, with a name and a line about it in three languages', () => {
    expect(PRINT_GALLERY.map((g) => g.id)).toEqual(['classic', 'modernLines', 'ledger', 'modern', 'halfPage', 'receipt80']);
    // every layout is in the gallery
    expect(new Set(PRINT_GALLERY.map((g) => g.layout))).toEqual(new Set(PRINT_LAYOUTS));
    for (const from of [DEFAULT_PRINT_DESIGN, DEFAULT_RECEIPT_DESIGN, { ...DEFAULT_PRINT_DESIGN, paper: 'A5' as const, marginMm: 25 }]) {
      for (const g of PRINT_GALLERY) {
        const d = withGalleryDesign(from, g.id);
        expect(d).toMatchObject({ layout: g.layout, paper: g.paper });
        expect('design' in checkPrintDesign(d), g.id).toBe(true);
        expect(galleryIdOf(d)).toBe(g.id);
        // colour, logo and what shows stay as they were
        expect(d).toMatchObject({ accent: from.accent, logo: from.logo, show: from.show });
      }
    }
    expect(withGalleryDesign(DEFAULT_PRINT_DESIGN, 'receipt80').marginMm).toBeLessThanOrEqual(5);
    expect(withGalleryDesign(DEFAULT_PRINT_DESIGN, 'halfPage').marginMm).toBeLessThanOrEqual(10);
    expect(withGalleryDesign(DEFAULT_RECEIPT_DESIGN, 'ledger').marginMm).toBe(DEFAULT_PRINT_DESIGN.marginMm);
    for (const g of PRINT_GALLERY) {
      for (const key of [`pd_g_${g.id}`, `pd_g_${g.id}_d`] as (keyof typeof PRINT14_TEXT)[]) {
        expect(new Set(PRINT14_TEXT[key]).size, key).toBe(3);
      }
    }
  });

  it('names the text sizes small, normal and large, and keeps a size of its own', () => {
    expect(fontSizeName(PRINT_FONT_SIZES.small)).toBe('small');
    expect(fontSizeName(DEFAULT_PRINT_DESIGN.fontSize)).toBe('normal');
    expect(fontSizeName(PRINT_FONT_SIZES.large)).toBe('large');
    expect(fontSizeName(13)).toBeNull();
    for (const size of Object.values(PRINT_FONT_SIZES)) expect('design' in checkPrintDesign({ ...DEFAULT_PRINT_DESIGN, fontSize: size })).toBe(true);
  });

  it('has every new text in Arabic, English and Kurdish', () => {
    for (const [key, texts] of Object.entries(PRINT14_TEXT)) {
      expect(texts.length, key).toBe(3);
      for (const text of texts) expect(text.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('says what is wrong with a design file in words, with where', () => {
    const t = (k: string) => (k === 'err_pd_invalid_colour' ? 'Bad colour' : k);
    expect(problemText(t as never, { code: 'pd_invalid_colour', path: 'design.accent' })).toBe('Bad colour (design.accent)');
    expect(problemText(t as never, { code: 'something_new', path: '' })).toBe('something_new');
  });
});

describe('a paper that follows the sale invoice', () => {
  it('says where to change its switches, naming "Its own design" as the button reads, in the three languages', () => {
    expect(new Set(PRINT14_TEXT.pd_followNote).size).toBe(3);
    for (const i of [0, 1, 2]) expect(PRINT14_TEXT.pd_followNote[i]).toContain(LABEL_TEXT.pd_ownDesign[i]);
  });

  it('says a logo kept from before is kept, instead of "no logo yet" beside "Remove the logo"', () => {
    expect(new Set(PRINT14_TEXT.pp_logoKeptBox).size).toBe(3);
    expect(PRINT14_TEXT.pp_logoKeptBox[1]).not.toBe(LABEL_TEXT.pp_noLogo[1]);
  });
});
