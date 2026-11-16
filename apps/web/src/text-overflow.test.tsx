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
    // at 1280 wide the title ("Purchase invoices", "فاتورة مبيعات جديدة") was cut to "…" while the search box kept 333px
    expect(rule('.search-trigger')).toMatch(/flex-shrink: 100; min-inline-size: 150px;/);
    // below 1240 the box is an icon only, and does not shrink further
    expect(css).toContain('@media (max-width: 1240px) { .search-trigger { inline-size: auto; min-inline-size: 0; flex-shrink: 0; }');
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
