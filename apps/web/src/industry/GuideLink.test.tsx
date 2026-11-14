import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { GUIDE_SLUGS, guideUrl, isGuideUrl } from '@qasa/core';
import { GuideLink, PAGE_GUIDE, pageGuide } from './GuideLink.tsx';

vi.mock('../i18n.ts', () => ({ useI18n: () => ({ t: (s: string) => s, lang: 'ku' }) }));

const web = fileURLToPath(new URL('..', import.meta.url));
const desktop = fileURLToPath(new URL('../../../desktop/src', import.meta.url));
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const path = join(dir, f);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [path] : [];
  });
}

describe('links to the user guide', () => {
  it('use only topics the guide has, everywhere in the app', () => {
    const used = new Set<string>(Object.values(PAGE_GUIDE));
    for (const file of [...sources(web), ...sources(desktop)]) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/<GuideLink\s+slug=["']([^"']+)["']/g)) used.add(m[1]!);
      for (const m of text.matchAll(/guideUrl\(\s*['"]([^'"]+)['"]/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(10);
    for (const slug of used) expect(GUIDE_SLUGS, slug).toContain(slug);
  });

  it('sit on real pages of the app', () => {
    const cases = new Set([...readFileSync(join(web, 'App.tsx'), 'utf8').matchAll(/case '([a-z0-9-]+)':/g)].map((m) => m[1]!));
    for (const page of Object.keys(PAGE_GUIDE)) expect(cases, page).toContain(page);
  });

  it('cover the main pages', () => {
    expect(pageGuide('sales')).toBe('sales-invoices-returns-customers-quotations');
    expect(pageGuide('new-invoice', 'sale')).toBe('sales-invoices-returns-customers-quotations');
    expect(pageGuide('new-invoice', 'purchase')).toBe('purchases-and-suppliers');
    expect(pageGuide('purchases')).toBe('purchases-and-suppliers');
    expect(pageGuide('entries')).toBe('vouchers-and-approval');
    expect(pageGuide('items')).toBe('stock-items-warehouses-counts');
    expect(pageGuide('pos')).toBe('point-of-sale');
    expect(pageGuide('banking')).toBe('banks-safes-and-cheques');
    expect(pageGuide('final-accounts')).toBe('reports-final-accounts-year-end');
    expect(pageGuide('reports-more')).toBe('reports-final-accounts-year-end');
    expect(pageGuide('users')).toBe('users-roles-and-sign-in');
    expect(pageGuide('plans')).toBe('plans-licences-and-activation');
    expect(pageGuide('payroll')).toBe('payroll');
    expect(pageGuide('home')).toBeNull();
    expect(pageGuide('settings')).toBeNull();
    expect(pageGuide('toString')).toBeNull();
    // backups and the office network live in Settings, beside their own cards
    const settings = readFileSync(join(web, 'pages', 'Settings.tsx'), 'utf8');
    expect(settings).toContain('<GuideLink slug="backups-restore-and-companies" />');
    expect(settings).toContain('<GuideLink slug="office-network-and-qasa-relay" />');
    // beside the card's heading, never inside it: the link's label would become part of the heading's name
    expect(settings).not.toMatch(/<h[1-6][^>]*>(?:(?!<\/h[1-6]>)[\s\S])*<GuideLink/);
    expect(settings.match(/<div className="card-head"><h2>[^<]*<\/h2><GuideLink slug=/g)).toHaveLength(6); // 1.4: two more, the cards a PC connected to an office PC shows instead
  });

  it('open the topic in the app language, outside the app', () => {
    const link = GuideLink({ slug: 'point-of-sale' }) as ReactElement<Record<string, unknown>>;
    expect(link.type).toBe('a');
    expect(link.props.href).toBe('https://qasaerp.com/ku/guide/point-of-sale/');
    expect(isGuideUrl(link.props.href as string)).toBe(true);
    expect(link.props.target).toBe('_blank');
    expect(link.props.rel).toBe('noopener noreferrer');
    expect(link.props['aria-label']).toBe('us_guideHere');
  });

  it('Settings → Help & support links to the guide home', () => {
    const help = readFileSync(join(web, 'industry', 'SupportButton.tsx'), 'utf8');
    expect(help).toContain("guideUrl(null, i18n.lang)");
    expect(guideUrl(null, 'en')).toBe('https://qasaerp.com/en/guide/');
  });
});
