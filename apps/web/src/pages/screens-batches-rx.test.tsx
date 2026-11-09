import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../components.tsx';
import { I18nContext, makeI18n } from '../i18n.ts';
import type { ItemView } from '../api.ts';
import { arrivesExpired, BatchInFields, BatchPick } from '../industry/BatchFields.tsx';
import { controlledOf, RxTick } from '../industry/PharmacyPrompts.tsx';
import { posSaleLine } from './pos-logic.ts';
import { adjustmentBatch } from './StockAdjustments.tsx';

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  request: () => new Promise(() => {})
}));

// Batches on the POS and on stock adjustments, the pharmacy's Rx tick and controlled-medicine prompt on the sale
// invoice, and goods that arrive already expired.
const en = makeI18n('en', 'western', () => {}, () => {});
const wrap = (node: ReactNode, lang: 'ar' | 'en' | 'ku' = 'en') => renderToStaticMarkup(
  <I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>
    <DataContext.Provider value={{ settings: { businessTypes: ['pharmacy'] }, plan: { features: ['pharmacy'] } } as never}>{node}</DataContext.Provider>
  </I18nContext.Provider>
);
const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const tracked = { id: 'i1', trackBatches: true, trackExpiry: true } as Pick<ItemView, 'id' | 'trackBatches' | 'trackExpiry'>;

describe('goods that arrive already expired', () => {
  it('are those with an expiry date before the document date; the same day is not expired', () => {
    expect(arrivesExpired('2026-11-08', '2026-11-09')).toBe(true);
    expect(arrivesExpired('2026-11-09', '2026-11-09')).toBe(false);
    expect(arrivesExpired('2027-03-31', '2026-11-09')).toBe(false);
    expect(arrivesExpired('', '2026-11-09')).toBe(false);
    expect(arrivesExpired('2026-11-08', '')).toBe(false);
    expect(arrivesExpired('2026-11-08', undefined)).toBe(false);
  });

  it('show a warning under the batch fields, in each language, and none for a good date', () => {
    const late = wrap(<BatchInFields item={tracked} batchNo="L7" expiry="2026-10-31" date="2026-11-09" onChange={() => {}} />);
    expect(late).toContain('role="status"');
    expect(late).toContain('arrive already expired');
    expect(late).toContain('2026');
    const good = wrap(<BatchInFields item={tracked} batchNo="L7" expiry="2027-10-31" date="2026-11-09" onChange={() => {}} />);
    expect(good).not.toContain('role="status"');
    for (const lang of ['ar', 'ku'] as const) {
      const html = wrap(<BatchInFields item={tracked} batchNo="" expiry="2026-10-31" date="2026-11-09" onChange={() => {}} />, lang);
      expect(html).toContain('role="status"');
      expect(html).not.toContain('ex_arrivesExpired');
    }
    // an item that tracks no batches has no fields and no warning
    expect(wrap(<BatchInFields item={{ ...tracked, trackBatches: false }} batchNo="" expiry="2026-10-31" date="2026-11-09" onChange={() => {}} />)).toBe('');
  });

  it('is checked on the purchase invoice, the opening stock document and an adjustment coming in', () => {
    expect(src('./Invoices.tsx')).toContain("expiry={r.expiry ?? ''} date={date} onChange");
    expect(src('./StockDocs.tsx')).toContain("expiry={r.expiry ?? ''} date={date} onChange");
    expect(src('./StockAdjustments.tsx')).toContain("expiry={r.expiry ?? ''} date={date} onChange");
  });
});

describe('a batch picked by hand on a POS line', () => {
  it('goes with the line, in its unit or the base unit; automatic sends none', () => {
    const item = { id: 'i1' };
    expect(posSaleLine({ item, unit: 'strip', qtyMilli: 2_000, unitPrice: 2_300, batchId: 'b1' })).toEqual({ itemId: 'i1', unit: 'strip', unitQtyMilli: 2_000, unitPrice: 2_300, batchId: 'b1' });
    expect(posSaleLine({ item, unit: null, qtyMilli: 3_000, unitPrice: 250, batchId: 'b2' })).toEqual({ itemId: 'i1', qtyMilli: 3_000, unitPrice: 250, batchId: 'b2' });
    expect(posSaleLine({ item, unit: null, qtyMilli: 3_000, unitPrice: 250, batchId: '' })).toEqual({ itemId: 'i1', qtyMilli: 3_000, unitPrice: 250 });
    expect(posSaleLine({ item, unit: null, qtyMilli: 1_000, unitPrice: 250 })).not.toHaveProperty('batchId');
  });

  it('is offered on each cart line of an item that tracks batches, from the shift’s warehouse', () => {
    const pos = src('./Pos.tsx');
    expect(pos).toContain("<BatchPick item={l.item} warehouseId={shift.warehouseId} value={l.batchId ?? ''}");
    expect(pos).toContain('lines: cart.map(posSaleLine)');
    // the picker: automatic first; nothing for an item without batches
    expect(wrap(<BatchPick item={tracked} warehouseId="w1" value="" onChange={() => {}} />)).toContain('Automatic (earliest expiry)');
    expect(wrap(<BatchPick item={{ ...tracked, trackBatches: false }} warehouseId="w1" value="" onChange={() => {}} />)).toBe('');
  });
});

describe('batches on a stock adjustment line', () => {
  it('a line going out sends the batch picked (none: earliest expiry first); a line coming in its number and date', () => {
    expect(adjustmentBatch({ dir: 'out', batchId: 'b1', batchNo: 'X', expiry: '2027-01-01' })).toEqual({ batchId: 'b1' });
    expect(adjustmentBatch({ dir: 'out', batchId: '' })).toEqual({});
    expect(adjustmentBatch({ dir: 'in', batchId: 'b1', batchNo: '  L9 ', expiry: '2027-01-01' })).toEqual({ batchNo: 'L9', expiry: '2027-01-01' });
    expect(adjustmentBatch({ dir: 'in', batchNo: ' ', expiry: '' })).toEqual({});
  });

  it('shows the picker going out and the fields coming in, keeps a write-off draft pinned, and drops a pin on another warehouse', () => {
    const adj = src('./StockAdjustments.tsx');
    expect(adj).toContain("<BatchPick item={it} warehouseId={warehouseId} value={r.batchId ?? ''}");
    expect(adj).toContain('...adjustmentBatch(r)');
    expect(adj).toContain("batchId: l.batchId ?? '', batchNo: l.batchNo ?? '', expiry: l.expiry ?? ''");
    expect(adj).toContain("setRows((rs) => rs.map((r) => ({ ...r, batchId: '' })))");
  });
});

describe('a pharmacy’s sale invoice', () => {
  it('shows the Rx badge and the “prescription seen” tick, in the warning colour until ticked', () => {
    const unticked = wrap(<RxTick seen={false} onChange={() => {}} />);
    expect(unticked).toContain('>Rx<');
    expect(unticked).toContain('Prescription seen');
    expect(unticked).toContain('type="checkbox"');
    expect(unticked).toContain('var(--warn)');
    const ticked = wrap(<RxTick seen onChange={() => {}} />);
    expect(ticked).toContain('checked=""');
    expect(ticked).not.toContain('var(--warn)');
    expect(wrap(<RxTick seen={false} onChange={() => {}} />, 'ar')).toContain('رأيت الوصفة');
    expect(src('./Invoices.tsx')).toContain("{kind === 'sale' && it && rxItems.has(it.id) && <RxTick");
    expect(src('./Pos.tsx')).toContain('{rxItems.has(l.item.id) && <RxTick');
  });

  it('asks for the controlled medicines of the sale just posted, from the editor and from its page', () => {
    const lines = [{ invoiceId: 'a', lineNo: 1 }, { invoiceId: 'b', lineNo: 1 }, { invoiceId: 'a', lineNo: 3 }];
    expect(controlledOf(lines, 'a').map((l) => l.lineNo)).toEqual([1, 3]);
    expect(controlledOf(lines, 'c')).toEqual([]);
    const inv = src('./Invoices.tsx');
    // the editor posts and opens the sale's page, which asks; posting a draft from that page asks too
    expect(inv).toContain("if (kind === 'sale') askControlledOnOpen(saved.id);");
    expect(inv).toContain('const controlled = useControlledPrompt(id);');
    expect(inv).toContain("if (data.kind === 'sale') controlled.check(id);");
    expect(inv).toContain('{controlled.dialog}');
    expect(src('./Pos.tsx')).toContain('controlled.check(res.invoice.id);');
  });

  it('has the new text in Arabic, English and Kurdish', () => {
    for (const lang of ['ar', 'en', 'ku'] as const) {
      const text = makeI18n(lang, 'western', () => {}, () => {}).t('ex_arrivesExpired', { date: 'D' });
      expect(text).toContain('D');
      expect(text).not.toBe('ex_arrivesExpired');
    }
    expect(en.t('ph_rxSeen')).toBe('Prescription seen');
  });
});
