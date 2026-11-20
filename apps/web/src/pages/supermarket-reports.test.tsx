import { describe, expect, it } from 'vitest';
import type { GroupSalesView } from '../industry/brief-api.ts';
import type { ShelfFlagView, SlowStockRowView } from '../industry/supermarket-reports-api.ts';
import { rowsWithChanged, SHELF_SIZES, LABEL_SIZES } from './Labels.tsx';
import { sortGroups } from './MoreReports.tsx';
import { slowStockCsv } from './SlowStock.tsx';
import { reportTabsFor } from './tabs.ts';
import { SMR_TEXT } from '../i18n/supermarket-reports.ts';

const one = (t: string) => ({ ar: t, en: t, ku: t });
const group = (id: string | null, sales: number, profit: number, children: GroupSalesView[] = []): GroupSalesView =>
  ({ id, code: id ?? '', name: id ? one(id) : null, qtyMilli: 0, sales, cost: sales - profit, profit, children, total: { qtyMilli: 0, sales, cost: sales - profit, profit } });

describe('profit by category and by brand', () => {
  it('sorts by profit, by margin or by sales, subcategories too, with items of no category last', () => {
    const rows = [group(null, 900, 800), group('food', 1000, 100, [group('rice', 300, 30), group('tea', 700, 70)]), group('soap', 400, 200)];
    expect(sortGroups(rows, 'profit').map((r) => r.id)).toEqual(['soap', 'food', null]);
    expect(sortGroups(rows, 'margin').map((r) => r.id)).toEqual(['soap', 'food', null]);
    expect(sortGroups(rows, 'sales').map((r) => r.id)).toEqual(['food', 'soap', null]);
    expect(sortGroups(rows, 'profit')[1]!.children.map((r) => r.id)).toEqual(['tea', 'rice']);
  });

  it('are reports of the books, as profit by item is; slow sellers and dead stock is for everyone', () => {
    expect(reportTabsFor(false)).not.toContain('profit-categories');
    expect(reportTabsFor(false)).not.toContain('profit-brands');
    expect(reportTabsFor(false)).toContain('slow-stock');
    expect(reportTabsFor(true)).toEqual(expect.arrayContaining(['profit-categories', 'profit-brands', 'slow-stock']));
  });
});

describe('slow sellers and dead stock', () => {
  const row: SlowStockRowView = {
    itemId: 'i1', code: 'RICE', barcode: '', name: one('Rice'), unit: 'piece', categoryId: 'c', categoryName: one('Grains'),
    qtyMilli: 48_000, value: 480_000, soldMilli: 0, lastSale: '2026-07-05', idleDays: 138, coverDays: null, firstIn: '2026-06-01'
  };
  const label = { name: (r: SlowStockRowView) => r.name.en, category: (r: SlowStockRowView) => r.categoryName?.en ?? '' };
  it('exports the value only to someone the server sent it to', () => {
    expect(slowStockCsv([row], true, label, ['h'])[1]).toEqual(['RICE', 'Rice', 'Grains', 48, '480,000', 0, '2026-07-05', 138, '']);
    expect(slowStockCsv([{ ...row, value: undefined }], false, label, ['h'])[1]).toEqual(['RICE', 'Rice', 'Grains', 48, 0, '2026-07-05', 138, '']);
  });
});

describe('shelf labels to reprint', () => {
  const flag = (itemId: string, unit: string | null, oldPrice: number | null): ShelfFlagView => ({
    itemId, unit, code: itemId, barcode: '', name: one(itemId), categoryId: null, oldPrice, newPrice: 2_000, currency: 'IQD', changedAt: '2026-11-20T10:00:00Z', changedBy: 'Mer'
  });
  it('adds one label of each changed price, keeping the copies of a row already chosen and taking its old price', () => {
    const rows = rowsWithChanged([{ itemId: 'milk', copies: 3, unit: null }, { itemId: 'tea', copies: 1, unit: null }], [flag('milk', null, 1_500), flag('milk', 'box', null)]);
    expect(rows).toEqual([
      { itemId: 'milk', copies: 3, unit: null, oldPrice: 1_500, changedAt: '2026-11-20T10:00:00Z' },
      { itemId: 'tea', copies: 1, unit: null },
      { itemId: 'milk', copies: 1, unit: 'box', oldPrice: null, changedAt: '2026-11-20T10:00:00Z' }
    ]);
  });

  it('prints shelf labels on an A4 sheet that fits', () => {
    for (const k of SHELF_SIZES) {
      const s = LABEL_SIZES[k as keyof typeof LABEL_SIZES];
      expect(s.sheet).toBe(true);
      expect(s.w * s.cols).toBeLessThanOrEqual(210);
      expect(s.h * s.rows).toBeLessThanOrEqual(297);
    }
  });
});

describe('the texts', () => {
  it('every text in Arabic, English and Kurdish, none empty', () => {
    for (const [k, v] of Object.entries(SMR_TEXT)) {
      expect(v, k).toHaveLength(3);
      for (const s of v) expect(s.trim(), k).not.toBe('');
    }
  });
});
