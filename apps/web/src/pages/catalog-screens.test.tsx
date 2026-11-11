import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nContext, makeI18n } from '../i18n.ts';
import { categoryLabel, inCategory, type CategoryView } from '../industry/categories-api.ts';
import { PosCategories } from './Pos.tsx';

const cat = (id: string, en: string, parentId: string | null = null): CategoryView => ({
  id, code: id.toUpperCase(), name: { ar: `${en} ع`, en, ku: `${en} ک` }, sort: 0, active: true, parentId, items: 0, children: 0, createdAt: '', updatedAt: ''
});
const list = [cat('phones', 'Phones'), cat('smart', 'Smartphones', 'phones'), cat('cases', 'Cases', 'phones'), cat('tools', 'Tools')];
const wrap = (node: ReactNode, lang: 'ar' | 'en' | 'ku' = 'en') => renderToStaticMarkup(
  <I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>{node}</I18nContext.Provider>
);

describe('picking items by category on the invoice and at the till', () => {
  it('a category takes in its subcategories\' items; a subcategory only its own; none only items without one', () => {
    expect(inCategory(list, 'smart', 'phones')).toBe(true);
    expect(inCategory(list, 'phones', 'phones')).toBe(true);
    expect(inCategory(list, 'tools', 'phones')).toBe(false);
    expect(inCategory(list, 'phones', 'smart')).toBe(false);
    expect(inCategory(list, null, 'phones')).toBe(false);
    expect(inCategory(list, null, 'none')).toBe(true);
    expect(inCategory(list, 'smart', 'none')).toBe(false);
    expect(inCategory(list, 'smart', '')).toBe(true);
    const en = makeI18n('en', 'western', () => {}, () => {});
    expect(categoryLabel(list, 'smart', en.name)).toBe('Phones › Smartphones');
    expect(categoryLabel(list, 'tools', en.name)).toBe('Tools');
  });

  it('the till shows the top-level categories, opens a category\'s subcategories with a way back, in the screen\'s language', () => {
    const top = wrap(<PosCategories list={list} value="" onChange={() => {}} />);
    expect(top).toContain('aria-pressed="true">All categories<');
    expect(top).toContain('>Phones<');
    expect(top).toContain('>Tools<');
    expect(top).not.toContain('Smartphones');
    const open = wrap(<PosCategories list={list} value="phones" onChange={() => {}} />);
    expect(open).toContain('Back');
    expect(open).toContain('aria-pressed="true">Phones<');
    expect(open).toContain('>Smartphones<');
    expect(open).not.toContain('>Tools<');
    // a subcategory picked: its siblings stay on screen
    const sub = wrap(<PosCategories list={list} value="smart" onChange={() => {}} />, 'ku');
    expect(sub).toContain('aria-pressed="true">Smartphones ک<');
    expect(sub).toContain('>Cases ک<');
    expect(sub).toContain('گەڕانەوە');
  });
});
