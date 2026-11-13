import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext, LanguageSwitch } from '../components.tsx';
import { I18nContext, makeI18n } from '../i18n.ts';
import { BusinessTypeChooser } from './BusinessType.tsx';

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  api: { updateSettings: () => new Promise(() => {}), startTrial: () => new Promise(() => {}) }
}));
vi.mock('../industry/LegalPanel.tsx', () => ({ AgreeLine: () => null }));

const data = { settings: { businessTypes: ['trade'] }, plan: { features: [], trialAvailable: true }, reloadSettings: () => {}, reloadPlan: () => {} };
const wrap = (node: ReactNode, lang: 'ar' | 'en' | 'ku' = 'ar', setLang: (l: 'ar' | 'en' | 'ku') => void = () => {}) => renderToStaticMarkup(
  <I18nContext.Provider value={makeI18n(lang, 'western', setLang, () => {})}>
    <DataContext.Provider value={data as never}>{node}</DataContext.Provider>
  </I18nContext.Provider>
);

type Node = ReactElement<Record<string, unknown>>;
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...flatten(node.props.children)];
}

describe('the first-start “What does your company do?” dialog', () => {
  it('offers the three languages at the top, each in its own name, with the current one pressed', () => {
    const html = wrap(<BusinessTypeChooser first />, 'ar');
    const en = makeI18n('en', 'western', () => {}, () => {});
    const ar = makeI18n('ar', 'western', () => {}, () => {});
    expect(html.indexOf('role="group" aria-label="' + ar.t('language') + '"')).toBeGreaterThan(-1);
    expect(html.indexOf('عربي')).toBeLessThan(html.indexOf('<h2>'));
    expect(html).toContain('lang="en" aria-pressed="false">English<');
    expect(html).toContain('aria-pressed="true">عربي<');
    expect(html).toContain('>کوردی<');
    // in English the dialog is in English and English is the pressed one
    const inEnglish = wrap(<BusinessTypeChooser first />, 'en');
    expect(inEnglish).toContain(`<h2>${en.t('bizWelcome')}</h2>`);
    expect(inEnglish).toContain('lang="en" aria-pressed="true">English<');
  });

  it('keeps the switch off the Settings page version, where the language lives in Settings → Language', () => {
    expect(wrap(<BusinessTypeChooser />)).not.toContain('English');
  });

  it('changes the language through the same setLang as Settings (which also sets the Windows menus)', () => {
    const setLang = vi.fn();
    let tree: unknown = null;
    function Probe() { tree = LanguageSwitch({}); return null; }
    wrap(<Probe />, 'ar', setLang);
    const buttons = flatten(tree).filter((n) => n.type === 'button');
    expect(buttons.map((b) => b.props.children)).toEqual(['عربي', 'English', 'کوردی']);
    (buttons[2]!.props.onClick as () => void)();
    expect(setLang).toHaveBeenCalledWith('ku');
    (buttons[1]!.props.onClick as () => void)();
    expect(setLang).toHaveBeenLastCalledWith('en');
  });

  it('shares the one list of languages with Settings, which shows them as rectangles and keeps no list of its own', () => {
    const settings = readFileSync(new URL('./Settings.tsx', import.meta.url), 'utf8');
    expect(settings).toContain('LANGUAGE_NAMES.map(');
    expect(settings).toContain("<ChoiceTiles label={t('language')} value={lang} options={languages} onChange={setLang} />");
    expect(settings).not.toMatch(/LANGUAGES|'English'|'کوردی'/);
  });
});
