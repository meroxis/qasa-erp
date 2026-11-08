import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { makeI18n } from './i18n.ts';

// The website demo opened on a phone (360 px): the menu becomes the icon rail and wide tables scroll inside their card,
// so the page never runs sideways; the demo also says it is made for a computer screen.
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

it('turns the menu into the icon rail at 760 px and narrower, and hides the wide/narrow toggle there', () => {
  expect(app).toContain("window.matchMedia('(max-width: 760px)')");
  expect(app).toContain('const railed = collapsed || narrow;');
  expect(app).toContain("<nav className={'sidebar' + (railed ? ' collapsed' : '')}");
  expect(app).toMatch(/\{!narrow && <button type="button" className="btn subtle icon nav-toggle"/);
  const narrow = /@media screen and \(max-width: 760px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  expect(narrow).toContain('.sidebar.collapsed { inline-size: 56px;');
  expect(narrow).toMatch(/\.card:has\(> \.table\), \.card:has\(> \.table-wrap\) \{ overflow-x: auto; \}/);
  expect(narrow).toMatch(/\.grid-2, \.grid-3, \.grid-4 \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

it('tells a phone visitor, in their language, that the demo is made for a computer screen (demo only)', () => {
  expect(app).toContain("{import.meta.env.MODE === 'demo' && narrow && <div className=\"alert info demo-phone no-print\"");
  const texts = (['ar', 'en', 'ku'] as const).map((l) => makeI18n(l, 'western', () => {}, () => {}).t('demoPhoneNote'));
  expect(texts[1]).toBe('This demo is made for a computer screen, like Qasa ERP itself (a Windows app). On a phone, turn it sideways, or open it on a PC.');
  expect(texts[0]).toContain('شاشة الحاسوب');
  expect(texts[2]).toContain('شاشەی کۆمپیوتەر');
  expect(new Set(texts).size).toBe(3);
});
