import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Text that ran out of its box (found by a sweep of every page in Arabic, English and Kurdish at 1280×720, 1366×768
// and 1920×1080, in both densities, with long company, customer and item names): each rule that keeps it inside.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = read('./styles.css');
const app = read('./App.tsx');
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `${selector} is in styles.css`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

describe('text stays inside its box', () => {
  it('the title band: the search box gives way before the page’s title, and both carry their whole text', () => {
    // at 1280 wide the title ("Purchase invoices", "فاتورة مبيعات جديدة") was cut to "…" while the search box kept its
    // fixed 26% of the window: now the box starts at 150px and grows only into the room left, up to that width
    const search = rule('.search-trigger');
    expect(search).toContain('flex: 3 1 150px; min-inline-size: 150px; max-inline-size: clamp(180px, 26vw, 340px);');
    expect(search).not.toMatch(/(^|[^-])inline-size: clamp/);
    // below 1240 the box is an icon only
    expect(css).toContain('@media (max-width: 1240px) { .search-trigger { flex: 0 0 auto; min-inline-size: 0; max-inline-size: none; }');
    expect(css).toMatch(/\.topbar h1 > span:last-child \{[^}]*min-inline-size: 0; overflow: hidden; text-overflow: ellipsis;/);
    expect(app).toContain('<span title={title}>{title}</span>');
    expect(app).toContain("aria-label={t('searchHint')} title={t('searchHint')} aria-keyshortcuts=\"Control+K\"");
  });

  it('a figure or name too wide for its tile goes on to a second line inside it (Daily brief, a customer’s page)', () => {
    // "179,718,600 IQD + $1,500.00" ran over the next tile; so did a long customer's name on their page
    const value = rule('.tile .value');
    expect(value).not.toContain('white-space: nowrap');
    expect(value).toContain('overflow-wrap: break-word');
    expect(value).toContain('min-inline-size: 0');
    expect(css).toMatch(/\.grid-4 \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
    // the balance tile on a customer's page: "Owes us 1,600,000 IQD" ran past the tile's edge at 1280 wide
    expect(rule('.owe-tile .owe-line')).toContain('flex-wrap: wrap;');
  });

  it('two amounts in one tile wrap between the amounts, never between a figure and its currency', () => {
    // "179,718,600 د.ع + $1,500.00" broke as "179,718,600" / "د.ع + $1,500.00" in a 1280-wide Arabic window
    // (each amount is a .dual-part that keeps itself whole; amounts-dual.test.tsx renders it)
    expect(css).toContain('.dual-part, .dual-second { white-space: nowrap; }');
    expect(read('./Amount.tsx')).toContain('<span className="dual-part">{wrap(p)}</span>');
  });

  it('the kinds of expense are buttons whose words wrap inside them', () => {
    // "Electricity & generator", "Salaries & wages", "مووچە و هەقدەست" ran under the next button
    expect(rule('.btn.wraps')).toMatch(/white-space: normal; text-align: start; min-inline-size: 0; overflow-wrap: break-word;/);
    const expenses = read('./pages/Expenses.tsx');
    expect(expenses).toContain("className={'btn wraps' + (category === c ? ' primary' : '')}");
    expect(expenses).toContain("gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))'");
    // every other button keeps its label on one line
    expect(rule('.btn')).toContain('white-space: nowrap;');
  });

  it('the chart of accounts: the code stays on one line, the names wrap, so the row’s buttons stay inside the card', () => {
    expect(css).toContain('.tree-row td:first-child { white-space: nowrap; }');
    expect(rule('.tree-row .tree-name')).toContain('white-space: normal; min-inline-size: 0;');
    expect(read('./pages/Accounts.tsx')).toContain('<span className="tree-code num">{a.code}</span>\n                      <span className="tree-name">');
  });

  it('the footer line’s example is a line of its own under the box, not a placeholder cut short', () => {
    const print = read('./pages/PrintDesign.tsx');
    expect(print).not.toContain("placeholder={t('pp_footerHint')}");
    expect(print).toContain('aria-describedby="pp-footer-hint"');
    expect(print).toContain("<small id=\"pp-footer-hint\" className=\"muted small\">{t('pp_footerHint')}</small>");
  });
});
