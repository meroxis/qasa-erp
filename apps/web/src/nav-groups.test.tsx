import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Icon } from './components.tsx';
import { makeI18n } from './i18n.ts';
import { FIRST_OPEN_GROUP, NAV, openGroups, openGroupsWith, setOpenGroups, toggledGroup } from './nav.ts';

// The menu at the side: bigger rows, a line icon on each group heading, several groups open at once and remembered for
// each person on this PC, the current page's group always opened.
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('the menu’s groups', () => {
  const g = globalThis as unknown as { localStorage?: unknown };
  let kept: Map<string, string>;
  beforeEach(() => {
    kept = new Map();
    g.localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v); } };
  });
  afterEach(() => { delete g.localStorage; });

  it('the first time, opens the current page’s group and Sales', () => {
    expect(FIRST_OPEN_GROUP).toBe('gSales');
    expect(openGroups('Mer')).toBeNull();
    expect(openGroupsWith(openGroups('Mer'), 'gOverview')).toEqual(['gSales', 'gOverview']);
    expect(openGroupsWith(null, 'gSystem')).toEqual(['gSales', 'gSystem']);
    expect(openGroupsWith(null, 'gSales')).toEqual(['gSales']);
    // a page that is in no group (a typed address) opens none of its own
    expect(openGroupsWith(null, null)).toEqual(['gSales']);
    // looking is not remembering
    expect(kept.size).toBe(0);
  });

  it('keeps several groups open at once and remembers them for each person on this PC', () => {
    let open = openGroupsWith(openGroups('Mer'), 'gOverview');
    open = toggledGroup(open, 'gStock');
    open = toggledGroup(open, 'gReports');
    expect(open).toEqual(['gSales', 'gOverview', 'gStock', 'gReports']);
    setOpenGroups('Mer', open);
    expect(openGroups('Mer')).toEqual(['gSales', 'gOverview', 'gStock', 'gReports']);
    expect(kept.get('qasa.nav.open.Mer')).toBe('["gSales","gOverview","gStock","gReports"]');
    // someone else on the same PC has their own, and so does the owner without sign-in
    expect(openGroups('Las')).toBeNull();
    setOpenGroups('Las', ['gAccounting']);
    setOpenGroups('', ['gPurchases', 'gPurchases']);
    expect(openGroups('Las')).toEqual(['gAccounting']);
    expect(openGroups('')).toEqual(['gPurchases']);
    expect(kept.get('qasa.nav.open.owner')).toBe('["gPurchases"]');
    expect(openGroups('Mer')).toEqual(['gSales', 'gOverview', 'gStock', 'gReports']);
  });

  it('closing a group closes that one only, and everything can be closed', () => {
    expect(toggledGroup(['gSales', 'gOverview', 'gStock'], 'gOverview')).toEqual(['gSales', 'gStock']);
    expect(toggledGroup(['gSales'], 'gSales')).toEqual([]);
    setOpenGroups('Mer', []);
    // remembered as "all closed": Sales does not come back by itself
    expect(openGroups('Mer')).toEqual([]);
    expect(openGroupsWith(openGroups('Mer'), null)).toEqual([]);
  });

  it('opening a page always opens its own group beside the remembered ones', () => {
    setOpenGroups('Mer', ['gStock', 'gReports']);
    expect(openGroupsWith(openGroups('Mer'), 'gAccounting')).toEqual(['gStock', 'gReports', 'gAccounting']);
    expect(openGroupsWith(openGroups('Mer'), 'gReports')).toEqual(['gStock', 'gReports']);
    setOpenGroups('Mer', []);
    expect(openGroupsWith(openGroups('Mer'), 'gSystem')).toEqual(['gSystem']);
    // what is passed in is never changed
    const remembered = ['gStock'];
    openGroupsWith(remembered, 'gSales');
    expect(remembered).toEqual(['gStock']);
  });

  it('reads only what it wrote: anything else kept under the name is ignored', () => {
    kept.set('qasa.nav.open.Mer', '["gSales","nothing",7,"gSales","gSystem"]');
    expect(openGroups('Mer')).toEqual(['gSales', 'gSystem']);
    kept.set('qasa.nav.open.Mer', '{"gSales":true}');
    expect(openGroups('Mer')).toBeNull();
    kept.set('qasa.nav.open.Mer', 'not json');
    expect(openGroups('Mer')).toBeNull();
    // without storage (a locked-down browser) nothing breaks: the first-time groups show
    delete g.localStorage;
    expect(openGroups('Mer')).toBeNull();
    expect(() => setOpenGroups('Mer', ['gSales'])).not.toThrow();
  });

  it('gives every group one line icon from the app’s own set, in the same order of groups as before', () => {
    expect(NAV.map((n) => n.group)).toEqual(['gOverview', 'gSales', 'gPurchases', 'gStock', 'gIndustry', 'gAccounting', 'gPeople', 'gReports', 'gSystem']);
    for (const n of NAV) {
      const svg = renderToStaticMarkup(<Icon name={n.icon} />);
      expect(svg, n.group).toMatch(/<path d="[^"]+"/);
      expect(svg, n.group).toContain('stroke="currentColor"');
    }
    expect(new Set(NAV.map((n) => n.icon)).size).toBe(NAV.length);
  });

  it('names every group in Arabic, English and Kurdish', () => {
    for (const key of [...NAV.map((n) => n.group), 'navFavourites'] as const) {
      const texts = (['ar', 'en', 'ku'] as const).map((l) => makeI18n(l, 'western', () => {}, () => {}).t(key));
      for (const text of texts) expect(text.trim(), key).not.toBe('');
      expect(new Set(texts).size, key).toBe(3);
    }
  });
});

describe('the menu in the app shell', () => {
  it('opens and closes a group without going anywhere, and remembers it for the person', () => {
    expect(app).toContain('const open = railed || openNav.includes(g.group);');
    expect(app).toContain('aria-expanded={open} aria-controls={id} title={t(g.group)} onClick={() => toggleGroup(g.group)}>');
    const toggle = /const toggleGroup = \(group: string\) => \{([\s\S]*?)\n  \};/.exec(app)?.[1] ?? '';
    expect(toggle).toContain('toggledGroup(openNavNow.current, group)');
    expect(toggle).toContain('setOpenGroups(favUser, next);');
    expect(toggle).not.toMatch(/location|href|go\(/);
    // a page opens its own group, whatever was remembered
    expect(app).toContain('const open = openGroupsWith(remembered, activeGroup);');
    expect(app).toMatch(/\}, \[signedIn, favUser, activeGroup, routePage\]\);/);
  });

  it('shows the heading’s icon, its name and a chevron; a group with no page this person may see is not shown', () => {
    expect(app).toContain('<Icon name={g.icon} />\n                          <span>{t(g.group)}</span>\n                          <Icon name="chevronDown" size={16} className="nav-chevron" />');
    expect(app).toContain('{NAV.filter((g) => shownItems(g.items).length).map((g) => {');
    expect(app).toContain('const shownItems = (items: NavItem[]) => items.filter((item) => canSee(item, viewer));');
    // the icon rail has no headings: every group's pages show, as before
    expect(app).toContain('{!railed && (\n                        <button type="button" className="nav-group nav-group-btn"');
  });

  it('carries the full name of every row in its tooltip, for a label too long to fit', () => {
    expect(app).toContain("aria-current={active ? 'page' : undefined} title={t(item.key)}>");
    expect(app).toContain('<button key={item.key} type="button" className="nav-item" disabled title={t(item.key)}>');
    expect(app).toContain("<div className=\"company-card\" title={company || t('noCompany')}>");
    expect(css).toMatch(/\.nav-item > span:not\(\.soon\) \{[^}]*overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
    expect(css).toMatch(/\.nav-group-btn > span \{[^}]*overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
  });

  it('has bigger text and bigger rows in the comfortable density, near the old sizes in compact', () => {
    const root = /\n:root \{\n  \/\* brand \*\/([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    for (const size of ['--sidebar-w: 296px;', '--rail-w: 72px;', '--nav-h: 44px;', '--nav-fs: 16px;', '--nav-icon: 20px;', '--nav-group-h: 42px;', '--nav-group-fs: 15px;', '--nav-label-fs: 14px;', '--rail-icon: 22px;']) {
      expect(root, size).toContain(size);
    }
    const compact = /\n:root\[data-density='compact'\] \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    for (const size of ['--sidebar-w: 264px;', '--nav-h: 32px;', '--nav-fs: 14px;', '--nav-icon: 18px;']) expect(compact, size).toContain(size);
    expect(css).toMatch(/\.nav-item \{[^}]*min-block-size: var\(--nav-h\);[^}]*font-size: var\(--nav-fs\);/);
    expect(css).toMatch(/\.nav-item svg \{[^}]*inline-size: var\(--nav-icon\); block-size: var\(--nav-icon\);/);
    // group headings are rows of their own: 15 px, weight 600, the text colour, a 16 px chevron
    expect(css).toMatch(/\.nav-group-btn \{[^}]*min-block-size: var\(--nav-group-h\);[^}]*font-size: var\(--nav-group-fs\); font-weight: 600; color: var\(--ink\);/);
    expect(css).toMatch(/\.nav-group-btn > svg\.nav-chevron \{ inline-size: 16px; block-size: 16px;/);
    expect(css).toMatch(/\.nav-group \{[^}]*font-size: var\(--nav-label-fs\); font-weight: 600; color: var\(--ink-2\);/);
    expect(css).toMatch(/\.brand-name \{[^}]*font-size: 18px;/);
    expect(css).toMatch(/\.brand-tag \{ font-size: 13px;/);
    expect(css).toMatch(/\.company-card strong \{[^}]*font-size: 15px;/);
    expect(css).toMatch(/\.company-card \.label \{[^}]*font-size: 12\.5px;/);
    expect(css).toMatch(/\.nav-item \.soon \{[^}]*font-size: 12px;/);
  });

  it('leaves the Home page as many tiles in a row as before the menu grew wider', () => {
    const root = /\n:root \{\n  \/\* brand \*\/([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const sidebar = Number(/--sidebar-w: (\d+)px;/.exec(root)?.[1]);
    const pad = Number(/--content-pad: (\d+)px;/.exec(root)?.[1]);
    const [, min, gap] = /\.launch-grid \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\((\d+)px, 1fr\)\); gap: (\d+)px; \}/.exec(css) ?? [];
    // tiles in a row of the launcher: the window less the menu, the page's border and its padding on both sides
    const columns = (window: number, menu: number, tile: number) => Math.floor((window - menu - 1 - 2 * pad + Number(gap)) / (tile + Number(gap)));
    // the menu was 264 px wide and a tile at least 150 px: seven in a row at 1440 px (Sales has seven pages), six at 1366 px
    expect(columns(1440, 264, 150)).toBe(7);
    for (const window of [1280, 1366, 1440, 1536, 1600, 1920]) {
      expect(columns(window, sidebar, Number(min)), String(window)).toBeGreaterThanOrEqual(columns(window, 264, 150));
    }
    // seven tiles at 1440 px are a little narrower than they were: 8 px at the sides keeps the longest Kurdish name on one line
    expect(css).toMatch(/\.launch-tile > a \{[^}]*\n  padding: 16px 8px 12px;/);
  });

  it('keeps the orange mark, the icon rail, both directions, contrast themes and print', () => {
    expect(css).toMatch(/\.nav-item\.active::before \{[^}]*background: var\(--indicator\);/);
    expect(css).toContain('.sidebar.collapsed { inline-size: var(--rail-w); padding-inline: 6px; }');
    expect(css).toContain('.sidebar.collapsed .nav-item svg { inline-size: var(--rail-icon); block-size: var(--rail-icon); }');
    // the chevron of a closed group points the way the text runs
    expect(css).toContain(".nav-group-btn[aria-expanded='false'] > svg.nav-chevron { transform: rotate(-90deg); }");
    expect(css).toContain("html[dir='rtl'] .nav-group-btn[aria-expanded='false'] > svg.nav-chevron { transform: rotate(90deg); }");
    expect(css).toContain('.nav-group-btn:focus-visible { outline: 2px solid var(--focus-outer); outline-offset: -2px; }');
    expect(css).toContain('.nav-item.active::before { forced-color-adjust: none; background: Highlight; inline-size: 4px; }');
    expect(css).toContain('.sidebar, .topbar, .statusbar, .no-print, .toast, .menu { display: none !important; }');
    // no physical left or right in the menu's rules: Arabic and Kurdish mirror by themselves
    const menu = css.slice(css.indexOf('/* navigation pane on Mica */'), css.indexOf('.main {'));
    expect(menu).not.toMatch(/(?:margin|padding|border)-(?:left|right)|(?:^|[\s;{])(?:left|right):/);
  });
});
