import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Lang } from '@qasa/core';
import { I18nContext, makeI18n } from './i18n.ts';
import { LONG_LIST_TEXT } from './i18n/long-list.ts';
import { MoreRows, ROWS_AT_ONCE, useRowsShown } from './industry/LongList.tsx';

// 2.0.0: a long table shows a few hundred rows at a time. A big company's items page, or a year of a till's safe on
// its statement, put 100,000 rows on the screen at once and the app stood still (bench/big-company.ts).

function Table({ n, from }: { n: number; from?: 'start' | 'end' }) {
  const rows = useRowsShown(Array.from({ length: n }, (_, i) => i + 1), from ? { from } : {});
  return (
    <table><tbody>
      {from === 'end' && <MoreRows hidden={rows.hidden} columns={2} earlier onMore={rows.more} onAll={rows.all} />}
      {rows.shown.map((r) => <tr key={r}><td>row-{r}</td></tr>)}
      {from !== 'end' && <MoreRows hidden={rows.hidden} columns={2} onMore={rows.more} onAll={rows.all} />}
    </tbody></table>
  );
}

const render = (node: React.ReactNode, lang: Lang = 'en') => renderToStaticMarkup(
  <I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>{node}</I18nContext.Provider>
);
const rowsIn = (html: string) => [...html.matchAll(/row-(\d+)</g)].map((m) => Number(m[1]));

describe('long lists', () => {
  it('shows the first few hundred rows and says how many more there are', () => {
    const html = render(<Table n={1000} />);
    expect(rowsIn(html)).toEqual(Array.from({ length: ROWS_AT_ONCE }, (_, i) => i + 1));
    expect(html).toContain('700 more rows not shown');
    expect(html).toContain('Show 300 more');
    expect(html).toContain('Show all');
    // never printed: printing draws the whole list
    expect(html).toContain('class="more-rows no-print"');
  });

  it('a statement shows its newest lines, the earlier ones folded above them', () => {
    const html = render(<Table n={1000} from="end" />);
    expect(rowsIn(html)).toEqual(Array.from({ length: ROWS_AT_ONCE }, (_, i) => 1000 - ROWS_AT_ONCE + i + 1));
    expect(html.indexOf('700 earlier lines not shown')).toBeLessThan(html.indexOf('row-701<'));
  });

  it('a short list is shown whole, with nothing more to show', () => {
    const html = render(<Table n={ROWS_AT_ONCE} />);
    expect(rowsIn(html)).toHaveLength(ROWS_AT_ONCE);
    expect(html).not.toContain('more-rows');
    expect(render(<Table n={0} from="end" />)).not.toContain('more-rows');
  });

  it('one row left reads as one', () => {
    expect(render(<Table n={ROWS_AT_ONCE + 1} />)).toContain('1 more row not shown');
    expect(render(<Table n={ROWS_AT_ONCE + 1} from="end" />)).toContain('1 earlier line not shown');
  });

  it('reads in Arabic and Kurdish too', () => {
    for (const [key, texts] of Object.entries(LONG_LIST_TEXT)) {
      expect(texts, key).toHaveLength(3);
      for (const text of texts) expect(text.trim(), key).not.toBe('');
    }
    expect(render(<Table n={1000} />, 'ku')).toContain(LONG_LIST_TEXT.ll_all[2]);
    expect(render(<Table n={1000} />, 'ar')).toContain(LONG_LIST_TEXT.ll_all[0]);
  });

  it('is used by the long tables: items, account and customer statements, stock value', () => {
    const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(read('./pages/Items.tsx')).toContain('{rows.shown.map((it) => (');
    expect(read('./pages/Reports.tsx')).toContain("useRowsShown(data?.rows, { from: 'end'");
    expect(read('./pages/Parties.tsx')).toContain("useRowsShown(data?.lines, { from: 'end'");
    expect(read('./pages/MoreReports.tsx')).toContain('{opened.shown.map((r) => (');
  });
});

describe('big shops: what is not loaded or drawn whole any more', () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it('after a sale the till reads the stock of what was sold, and the whole list every few minutes only', () => {
    const till = read('./pos/Register.tsx');
    const after = till.slice(till.indexOf('setLastDone({ total: i18n.money(total, currency)'), till.indexOf("toast(t('pos_saved'"));
    expect(after).toContain('refreshSold(sold);');
    expect(after).not.toContain('loadItems();');
    expect(till).toContain('const ITEMS_AGAIN_MS = 5 * 60_000;');
    expect(till).toContain('api.itemsByIds([...new Set(ids)].slice(0, 500))');
  });

  it('an offer\'s items are searched for in a box, not picked from a list of every item', () => {
    const offers = read('./pages/Offers.tsx');
    expect(offers).toContain('<SearchCombo value="" options={itemOptions}');
    expect(offers).not.toContain("(allItems.data ?? []).map((it) => <option");
  });
});
