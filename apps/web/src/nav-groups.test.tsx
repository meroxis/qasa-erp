import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Icon } from './components.tsx';
import { makeI18n } from './i18n.ts';
import { FIRST_OPEN_GROUP, GROUP_GLOW_MS, NAV, openGroups, openGroupsWith, revealTop, setOpenGroups, toggledGroup } from './nav.ts';

// The menu at the side: bigger rows, a line icon on each group heading, one group open at a time (remembered for each
// person on this PC), the current page's group opened and the others closed; a group opened by a click comes into view
// and glows for a moment.
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const toggle = /const toggleGroup = \(group: string\) => \{([\s\S]*?)\n  \};/.exec(app)?.[1] ?? '';
const glow = css.slice(css.indexOf('/* a group opened by a click glows'), css.indexOf('/* the narrow, icon-only menu */'));

describe('the menu’s groups', () => {
  const g = globalThis as unknown as { localStorage?: unknown };
  let kept: Map<string, string>;
  beforeEach(() => {
    kept = new Map();
    g.localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v); } };
  });
  afterEach(() => { delete g.localStorage; });

  it('the first time, opens the current page’s group alone, and Sales on a page in no group', () => {
    expect(FIRST_OPEN_GROUP).toBe('gSales');
    expect(openGroups('Mer')).toBeNull();
    expect(openGroupsWith(openGroups('Mer'), 'gOverview')).toEqual(['gOverview']);
    expect(openGroupsWith(null, 'gSystem')).toEqual(['gSystem']);
    expect(openGroupsWith(null, 'gSales')).toEqual(['gSales']);
    // a page that is in no group (a typed address) opens none of its own
    expect(openGroupsWith(null, null)).toEqual(['gSales']);
    // looking is not remembering
    expect(kept.size).toBe(0);
  });

  it('opening a group closes the others, and the one open is remembered for each person on this PC', () => {
    let open = openGroupsWith(openGroups('Mer'), 'gOverview');
    open = toggledGroup(open, 'gStock');
    expect(open).toEqual(['gStock']);
    open = toggledGroup(open, 'gReports');
    expect(open).toEqual(['gReports']);
    setOpenGroups('Mer', open);
    expect(openGroups('Mer')).toEqual(['gReports']);
    expect(kept.get('qasa.nav.open.Mer')).toBe('["gReports"]');
    // someone else on the same PC has their own, and so does the owner without sign-in
    expect(openGroups('Las')).toBeNull();
    setOpenGroups('Las', ['gAccounting']);
    setOpenGroups('', ['gPurchases', 'gPurchases']);
    expect(openGroups('Las')).toEqual(['gAccounting']);
    expect(openGroups('')).toEqual(['gPurchases']);
    expect(kept.get('qasa.nav.open.owner')).toBe('["gPurchases"]');
    expect(openGroups('Mer')).toEqual(['gReports']);
  });

  it('clicking the open group’s heading closes it: then none is open, and that is remembered', () => {
    expect(toggledGroup(['gSales'], 'gSales')).toEqual([]);
    expect(toggledGroup([], 'gSystem')).toEqual(['gSystem']);
    setOpenGroups('Mer', []);
    // remembered as "all closed": Sales does not come back by itself on a page in no group
    expect(openGroups('Mer')).toEqual([]);
    expect(openGroupsWith(openGroups('Mer'), null)).toEqual([]);
    // a page in a group still opens it
    expect(openGroupsWith(openGroups('Mer'), 'gSystem')).toEqual(['gSystem']);
  });

  it('a page opens its own group and the others close', () => {
    setOpenGroups('Mer', ['gStock']);
    expect(openGroupsWith(openGroups('Mer'), 'gAccounting')).toEqual(['gAccounting']);
    expect(openGroupsWith(openGroups('Mer'), 'gStock')).toEqual(['gStock']);
    // on a page in no group, the one the person left open
    expect(openGroupsWith(openGroups('Mer'), null)).toEqual(['gStock']);
  });

  it('turns a menu remembered by 1.5.0 with several groups open into one open group', () => {
    kept.set('qasa.nav.open.Mer', '["gSales","gOverview","gStock","gReports"]');
    expect(openGroups('Mer')).toEqual(['gSales', 'gOverview', 'gStock', 'gReports']);
    // on a page in no group: the last one remembered
    expect(openGroupsWith(openGroups('Mer'), null)).toEqual(['gReports']);
    // on a page in a group: that group only
    expect(openGroupsWith(openGroups('Mer'), 'gOverview')).toEqual(['gOverview']);
    expect(openGroupsWith(openGroups('Mer'), 'gSystem')).toEqual(['gSystem']);
    // a click that opens a group closes every other one
    expect(toggledGroup(['gSales', 'gOverview', 'gStock'], 'gPurchases')).toEqual(['gPurchases']);
    expect(toggledGroup(['gSales', 'gOverview', 'gStock'], 'gOverview')).toEqual(['gSales', 'gStock']);
    // the storage keeps its form and its names: what is written reads back the same
    setOpenGroups('Mer', openGroupsWith(openGroups('Mer'), null));
    expect(kept.get('qasa.nav.open.Mer')).toBe('["gReports"]');
  });

  it('never changes what it is given', () => {
    const remembered = Object.freeze(['gStock', 'gReports']);
    const open = Object.freeze(['gSales']);
    expect(() => {
      openGroupsWith(remembered, null);
      openGroupsWith(remembered, 'gSales');
      toggledGroup(open, 'gSystem');
      toggledGroup(open, 'gSales');
    }).not.toThrow();
    expect(remembered).toEqual(['gStock', 'gReports']);
    expect(open).toEqual(['gSales']);
    // and hands back a list of its own, so changing it changes nothing kept elsewhere
    const one = Object.freeze(['gSales']);
    const shown = openGroupsWith(one, null);
    expect(shown).toEqual(['gSales']);
    expect(shown).not.toBe(one);
    expect(toggledGroup(one, 'gSystem')).not.toBe(one);
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

describe('bringing a group just opened into view', () => {
  // a list 500 px high, scrolled to the top, 1200 px long; 8 px kept at its ends (its scroll-padding)
  const list = { top: 0, height: 500, length: 1200 };

  it('moves the list just enough to show the group’s heading and every page of it', () => {
    // System opened below the edge: its end comes up to the list's end
    expect(revealTop(list, { top: 600, height: 300 }, 8)).toBe(408);
    expect(revealTop(list, { top: 450, height: 200 }, 8)).toBe(158);
    // a group shown already: the list stays where the person left it
    expect(revealTop(list, { top: 100, height: 200 }, 8)).toBeNull();
    expect(revealTop({ ...list, top: 300 }, { top: 400, height: 300 }, 8)).toBeNull();
  });

  it('puts the heading at the top when the group is taller than the list, or when the heading went above it', () => {
    expect(revealTop(list, { top: 300, height: 600 }, 8)).toBe(292);
    expect(revealTop({ ...list, top: 700 }, { top: 300, height: 600 }, 8)).toBe(292);
    // the groups above it closed, and its heading moved up out of sight
    expect(revealTop({ ...list, top: 400 }, { top: 350, height: 200 }, 8)).toBe(342);
    // the heading at the top already
    expect(revealTop({ ...list, top: 292 }, { top: 300, height: 600 }, 8)).toBeNull();
  });

  it('stays within the list: never above its start nor past its end', () => {
    expect(revealTop({ ...list, top: 50 }, { top: 4, height: 100 }, 8)).toBe(0);
    expect(revealTop({ top: 0, height: 500, length: 700 }, { top: 450, height: 250 }, 8)).toBe(200);
    // at its end already: nothing to move
    expect(revealTop({ top: 200, height: 500, length: 700 }, { top: 450, height: 250 }, 8)).toBeNull();
    // a list too short to scroll
    expect(revealTop({ top: 0, height: 500, length: 500 }, { top: 0, height: 480 }, 8)).toBeNull();
    // whole pixels
    expect(revealTop({ top: 0.5, height: 500.4, length: 1200 }, { top: 600.3, height: 300 }, 8)).toBe(408);
  });
});

describe('the menu in the app shell', () => {
  it('opens and closes a group without going anywhere, and remembers it for the person', () => {
    expect(app).toContain('const open = railed || openNav.includes(g.group);');
    expect(app).toContain('aria-expanded={open} aria-controls={id} title={t(g.group)} onClick={() => toggleGroup(g.group)}>');
    expect(toggle).toContain('toggledGroup(openNavNow.current, group)');
    expect(toggle).toContain('setOpenGroups(favUser, next);');
    expect(toggle).not.toMatch(/location|href|go\(/);
    // a page opens its own group (and the others close), whatever was remembered
    expect(app).toContain('const open = openGroupsWith(remembered, activeGroup);');
    expect(app).toMatch(/\}, \[signedIn, favUser, activeGroup, routePage\]\);/);
    // what shows is remembered once the person has chosen by hand (so several kept by 1.5.0 become one)
    expect(app).toContain('if (remembered && open.join() !== remembered.join()) setOpenGroups(favUser, open);');
    expect(app).not.toMatch(/several can stay open|several at once/);
  });

  it('brings a group opened by a click into view, after the other groups have closed', () => {
    expect(toggle).toContain('const opening = !openNavNow.current.includes(group);');
    expect(toggle).toContain('requestAnimationFrame(() => requestAnimationFrame(() => revealGroup(navRef.current, group)));');
    // only when it opens: closing a group leaves the list where it is
    expect(toggle.indexOf('if (!opening) return;')).toBeGreaterThan(-1);
    expect(toggle.indexOf('if (!opening) return;')).toBeLessThan(toggle.indexOf('requestAnimationFrame('));
    // only the menu's list moves (not the window), found by its group's name, smoothly unless less motion is asked for
    const reveal = /\nfunction revealGroup\(list: HTMLElement \| null, group: string\) \{([\s\S]*?)\n\}/.exec(app)?.[1] ?? '';
    expect(reveal).toContain(".find((s) => s.dataset.group === group);");
    expect(reveal).toContain('revealTop(');
    expect(reveal).toContain("const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;");
    expect(reveal).toContain("list.scrollTo({ top, behavior: still ? 'auto' : 'smooth' });");
    expect(reveal).not.toContain('scrollIntoView');
    // the page's own row does not pull the list back when a click shows or hides it
    expect(toggle).toContain('headingClicked.current = pageRowShown(next) !== activeShown;');
    expect(app).toContain('if (headingClicked.current) { headingClicked.current = false; return; }');
  });

  it('makes a group opened by a click glow for a moment, not a group a page opens', () => {
    expect(app).toContain("<div key={g.group} data-group={g.group} className={'nav-section' + (open ? ' open' : '') + (!railed && justOpened === g.group ? ' just-opened' : '')}>");
    expect(toggle).toContain('setJustOpened(opening ? group : null);');
    // a newer glow is never cleared by an older one's timer, and no timer outlives the app
    expect(toggle.indexOf('window.clearTimeout(glowTimer.current);')).toBeGreaterThan(-1);
    expect(toggle.indexOf('window.clearTimeout(glowTimer.current);')).toBeLessThan(toggle.indexOf('glowTimer.current = window.setTimeout('));
    expect(toggle).toContain('glowTimer.current = window.setTimeout(() => setJustOpened((g) => (g === group ? null : g)), GROUP_GLOW_MS);');
    expect(app).toContain('useEffect(() => () => window.clearTimeout(glowTimer.current), []);');
    // the glow lasts as long as its animation
    expect(GROUP_GLOW_MS).toBe(1800);
    expect(glow).toContain('animation: nav-just-opened 1.8s var(--ease) both;');
    expect(glow).toContain('animation: nav-just-opened-mark 1.8s var(--ease) both;');
    // a page opening its group neither glows nor moves the list by itself; a group it closes stops glowing
    const pageOpens = /useLayoutEffect\(\(\) => \{\n    if \(!signedIn\) return;([\s\S]*?)\n  \}, \[signedIn/.exec(app)?.[1] ?? '';
    expect(pageOpens).toContain('openGroupsWith(remembered, activeGroup)');
    expect(pageOpens).not.toMatch(/revealGroup|scroll/);
    expect(pageOpens.match(/setJustOpened\(/g)).toHaveLength(1);
    expect(pageOpens).toContain('setJustOpened((g) => (g && !open.includes(g) ? null : g));');
  });

  it('glows light blue with the orange mark beside the heading, in both directions, dark mode, contrast themes and with less motion', () => {
    expect(glow).toContain('--nav-glow: color-mix(in srgb, var(--accent) 13%, transparent);');
    expect(glow).toContain('@keyframes nav-just-opened { 0%, 55% { background-color: var(--nav-glow); } 100% { background-color: transparent; } }');
    expect(glow).toMatch(/\.nav-section\.just-opened > \.nav-group-btn::before \{[^}]*inset-inline-start: 0;[^}]*background: var\(--indicator\);/);
    // the theme's own colours (light and dark), no fixed ones; no physical left or right: Arabic and Kurdish mirror
    expect(glow).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(glow).not.toMatch(/(?:margin|padding|border)-(?:left|right)|(?:^|[\s;{])(?:left|right):/);
    // less motion: no fading, a still tint for the moment the group glows
    expect(glow).toContain('@media (prefers-reduced-motion: reduce) {\n  .nav-section.just-opened { animation: none; background-color: var(--nav-glow); }\n  .nav-section.just-opened > .nav-group-btn::before { animation: none; }\n}');
    // contrast themes: the mark in the theme's highlight colour, as the current page's
    expect(glow).toContain('@media (forced-colors: active) { .nav-section.just-opened > .nav-group-btn::before { forced-color-adjust: none; background: Highlight; } }');
  });

  it('shows the heading’s icon, its name and a chevron; a group with no page this person may see is not shown', () => {
    expect(app).toContain('<Icon name={g.icon} />\n                          <span>{t(g.group)}</span>\n                          <Icon name="chevronDown" size={16} className="nav-chevron" />');
    expect(app).toContain('{NAV.filter((g) => shownItems(g.items).length).map((g) => {');
    expect(app).toContain('const shownItems = (items: NavItem[]) => items.filter((item) => canSee(item, viewer));');
    // the icon rail has no headings: every group's pages show, as before, and nothing glows there
    expect(app).toContain('{!railed && (\n                        <button type="button" className="nav-group nav-group-btn"');
  });

  it('carries the full name of every row in its tooltip, for a label too long to fit', () => {
    // (the name this person reads: a cashier's vouchers are "My vouchers")
    expect(app).toContain("aria-current={active ? 'page' : undefined} title={t(navLabel(item, viewer))}>");
    expect(app).toContain('<button key={item.key} type="button" className="nav-item" disabled title={t(navLabel(item, viewer))}>');
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
