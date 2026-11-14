import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChoiceTiles, choiceMove, choiceTabStop, type Choice } from './ChoiceTiles.tsx';
import { DisplayContext } from './components.tsx';
import { I18nContext, makeI18n } from './i18n.ts';
import { DisplaySettings } from './pages/Settings.tsx';

// A setting that picks one of a few fixed options shows them as big rectangles (ChoiceTiles): a radio group for the
// keyboard and screen readers, the chosen one marked with a check mark as well as the accent border.
const THEMES: Choice<'light' | 'dark' | 'system'>[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon', hint: 'Easier at night' },
  { value: 'system', label: 'System', sample: 'Aa' }
];

type Node = ReactElement<Record<string, unknown>>;
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...flatten(node.props.children)];
}
/** The radios of a group as React made them, to press their keys and click them without a browser. */
function radios(props: Parameters<typeof ChoiceTiles<'light' | 'dark' | 'system'>>[0]): Node[] {
  let tree: unknown = null;
  function Probe() { tree = ChoiceTiles(props); return null; }
  renderToStaticMarkup(<Probe />);
  return flatten(tree).filter((n) => n.props.role === 'radio');
}
const key = (name: string, more: Record<string, unknown> = {}) => ({ key: name, preventDefault: vi.fn(), currentTarget: {}, altKey: false, ctrlKey: false, metaKey: false, ...more });

describe('ChoiceTiles', () => {
  it('is a radio group of rectangles: one chosen, with a check mark, and one Tab stop', () => {
    const html = renderToStaticMarkup(<ChoiceTiles label="Appearance" value="dark" options={THEMES} onChange={() => {}} />);
    expect(html.startsWith('<div class="choice-tiles" role="radiogroup" aria-label="Appearance">')).toBe(true);
    expect(html.split('role="radio"').length - 1).toBe(3);
    expect(html.split('aria-checked="true"').length - 1).toBe(1);
    expect(html.split('aria-checked="false"').length - 1).toBe(2);
    // the chosen one alone has the check mark (never colour alone) and is the one Tab stops on
    expect(html.split('class="choice-check"').length - 1).toBe(1);
    expect(html).toMatch(/aria-checked="true" tabindex="0"><span class="choice-check" aria-hidden="true"><svg/);
    expect(html.split('tabindex="0"').length - 1).toBe(1);
    expect(html.split('tabindex="-1"').length - 1).toBe(2);
    // an icon or a sample, the label, and the hint where there is one
    expect(html).toMatch(/<span class="choice-icon"><svg[^>]*>.*?<\/svg><\/span><span class="choice-label">Dark<\/span><span class="choice-hint">Easier at night<\/span>/);
    expect(html).toMatch(/<span class="choice-sample" aria-hidden="true">Aa<\/span><span class="choice-label">System<\/span><\/button>/);
    expect(html.split('class="choice-hint"').length - 1).toBe(1);
    // real buttons, so Space and Enter choose
    expect(html.split('<button type="button" role="radio" class="choice-tile"').length - 1).toBe(3);
  });

  it('with nothing chosen yet, Tab stops on the first option that can be chosen', () => {
    const html = renderToStaticMarkup(<ChoiceTiles label="Appearance" value={null} options={[{ ...THEMES[0]!, disabled: true }, THEMES[1]!, THEMES[2]!]} onChange={() => {}} />);
    expect(html).not.toContain('aria-checked="true"');
    expect(html).not.toContain('choice-check');
    expect(html).toMatch(/aria-checked="false" tabindex="-1" disabled="">.*?aria-checked="false" tabindex="0">.*?aria-checked="false" tabindex="-1">/);
    expect(choiceTabStop(-1, [false, true, true])).toBe(1);
    expect(choiceTabStop(2, [true, true, true])).toBe(2);
    expect(choiceTabStop(0, [false, true, true])).toBe(1);
    expect(choiceTabStop(1, [false, false, false])).toBe(-1);
  });

  it('chooses with a click (Space and Enter click a button), and never chooses again what is chosen', () => {
    const onChange = vi.fn();
    const [light, dark, system] = radios({ label: 'Appearance', value: 'dark', options: THEMES, onChange });
    (system!.props.onClick as () => void)();
    expect(onChange).toHaveBeenLastCalledWith('system');
    (light!.props.onClick as () => void)();
    expect(onChange).toHaveBeenLastCalledWith('light');
    (dark!.props.onClick as () => void)();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('moves with the arrows, Home and End without choosing; other keys are left alone', () => {
    const onChange = vi.fn();
    const [light, dark] = radios({ label: 'Appearance', value: 'dark', options: THEMES, onChange });
    const press = (node: Node, e: ReturnType<typeof key>) => { (node.props.onKeyDown as (e: unknown) => void)(e); return e.preventDefault; };
    for (const name of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'End']) expect(press(dark!, key(name)), name).toHaveBeenCalledTimes(1);
    expect(press(dark!, key('Home'))).toHaveBeenCalledTimes(1);
    // already on the first: Home has nowhere to go
    expect(press(light!, key('Home'))).not.toHaveBeenCalled();
    for (const name of ['Tab', 'a', 'Escape', ' ', 'Enter']) expect(press(dark!, key(name)), name).not.toHaveBeenCalled();
    expect(press(dark!, key('ArrowRight', { ctrlKey: true }))).not.toHaveBeenCalled();
    // moving the focus never chooses
    expect(onChange).not.toHaveBeenCalled();

    const all = [true, true, true];
    expect(choiceMove('ArrowRight', 0, all)).toBe(1);
    expect(choiceMove('ArrowDown', 1, all)).toBe(2);
    expect(choiceMove('ArrowRight', 2, all)).toBe(0); // around the end
    expect(choiceMove('ArrowLeft', 0, all)).toBe(2);
    expect(choiceMove('ArrowUp', 2, all)).toBe(1);
    expect(choiceMove('Home', 2, all)).toBe(0);
    expect(choiceMove('End', 0, all)).toBe(2);
    expect(choiceMove('Enter', 1, all)).toBe(1);
    // in Arabic and Kurdish the options run right to left: the left arrow goes on, the right arrow goes back
    expect(choiceMove('ArrowLeft', 0, all, true)).toBe(1);
    expect(choiceMove('ArrowRight', 0, all, true)).toBe(2);
    expect(choiceMove('ArrowDown', 0, all, true)).toBe(1);
    // an option that can't be chosen is stepped over, at the ends too
    expect(choiceMove('ArrowRight', 0, [true, false, true])).toBe(2);
    expect(choiceMove('ArrowLeft', 0, [true, true, false])).toBe(1);
    expect(choiceMove('Home', 2, [false, true, true])).toBe(1);
    expect(choiceMove('End', 0, [true, true, false])).toBe(1);
    expect(choiceMove('ArrowRight', 0, [true, false, false])).toBe(0);
    expect(choiceMove('ArrowRight', 1, [false, false, false])).toBe(1);
    expect(choiceMove('ArrowRight', 0, [])).toBe(0);
  });

  it('switched off, no option can be chosen, clicked or reached', () => {
    const html = renderToStaticMarkup(<ChoiceTiles label="Digits" value="dark" options={THEMES} onChange={() => {}} disabled busy />);
    expect(html).toContain('role="radiogroup" aria-label="Digits" aria-disabled="true" aria-busy="true"');
    expect(html.split('disabled=""').length - 1).toBe(3);
    expect(html).not.toContain('tabindex="0"');
    // the chosen one still shows which it is
    expect(html.split('aria-checked="true"').length - 1).toBe(1);
    expect(html.split('class="choice-check"').length - 1).toBe(1);
  });

  it('is styled as rectangles at least 104 by 72, the chosen one with the accent border, in contrast themes too', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const [, wide, high] = /\.choice-tile \{[^}]*min-inline-size: (\d+)px;[^}]*min-block-size: (\d+)px;/.exec(css) ?? [];
    expect(Number(wide)).toBeGreaterThanOrEqual(104);
    expect(Number(high)).toBeGreaterThanOrEqual(72);
    expect(css).toMatch(/\.choice-tile\[aria-checked='true'\] \{ border-color: var\(--accent\);/);
    expect(css).toMatch(/\.choice-check \{[^}]*background: var\(--accent\); color: var\(--on-accent\);/);
    const contrast = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(css.replace(/\r\n/g, '\n'))?.[1] ?? '';
    expect(contrast).toContain(".choice-tile[aria-checked='true'] { border-color: Highlight;");
    expect(contrast).toContain('.choice-check { forced-color-adjust: none; background: Highlight; color: HighlightText; }');
  });

  it('makes the rectangles of one group equally wide so they line up, and lets them wrap in a narrow window', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    // every column as wide as the widest label: "Not allowed" beside "After a confirmation (recorded)" is not a small box beside a big one
    expect(css).toMatch(/\n\.choice-tiles \{ display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;[^}]*inline-size: fit-content; max-inline-size: 100%; \}/);
    // language, digits, appearance and density line up under each other: one width fits their labels in the three languages
    expect(css).toMatch(/\.choice-tile \{[^}]*min-inline-size: 128px; max-inline-size: 240px;/);
    // a narrow window or a phone: they wrap instead of pushing the page sideways, and two still fit side by side on a phone
    expect(css).toContain('@media (max-width: 760px) { .choice-tiles { display: flex; flex-wrap: wrap; inline-size: auto; } }');
    expect(css).toContain('@media (max-width: 480px) { .choice-tiles > .choice-tile { min-inline-size: 104px; } }');
  });
});

describe('Settings → Language and display, as rectangles', () => {
  const wrap = (node: ReactNode, lang: 'ar' | 'en' | 'ku', digits: 'western' | 'eastern' = 'western') => {
    const w = globalThis as unknown as { window?: unknown };
    w.window = {};
    try {
      return renderToStaticMarkup(
        <I18nContext.Provider value={makeI18n(lang, digits, () => {}, () => {})}>
          <DisplayContext.Provider value={{ theme: 'dark', density: 'compact', setTheme: () => {}, setDensity: () => {} }}>{node}</DisplayContext.Provider>
        </I18nContext.Provider>
      );
    } finally {
      delete w.window;
    }
  };
  const chosen = (html: string) => [...html.matchAll(/aria-checked="true"[^>]*>(?:<span class="choice-check".*?<\/span>)(?:<span class="choice-(?:icon|sample)".*?<\/span>)?<span class="choice-label">([^<]*)</g)].map((m) => m[1]);

  it('offers language, digits, appearance and density as four radio groups, with the saved choices chosen', () => {
    const html = wrap(<DisplaySettings />, 'ar', 'eastern');
    const t = makeI18n('ar', 'eastern', () => {}, () => {}).t;
    for (const name of [t('language'), t('digits'), t('appearance'), t('density')]) expect(html).toContain(`role="radiogroup" aria-label="${name}"`);
    expect(html.split('role="radiogroup"').length - 1).toBe(4);
    expect(html).not.toContain('class="track"');
    expect(html).not.toContain('aria-pressed');
    expect(chosen(html)).toEqual(['عربي', t('lk_digitsEastern'), t('themeDark'), t('densityCompact')]);
    // the three languages by their own names, each marked with its own language
    expect(html).toMatch(/lang="ar"[^>]*>.*?<span class="choice-label">عربي<\/span>/);
    expect(html).toMatch(/lang="en"[^>]*>.*?<span class="choice-label">English<\/span>/);
    expect(html).toMatch(/lang="ckb"[^>]*>.*?<span class="choice-label">کوردی<\/span>/);
    // the digit styles show a sample of themselves
    expect(html).toContain('<span class="choice-sample" aria-hidden="true">١٢٣</span>');
    expect(html).toContain('<span class="choice-sample" aria-hidden="true">123</span>');
  });

  it('in English the digits are 123 and can’t be changed', () => {
    const html = wrap(<DisplaySettings />, 'en', 'eastern');
    const digits = html.slice(html.indexOf('role="radiogroup" aria-label="Digits"'), html.indexOf('role="radiogroup" aria-label="Appearance"'));
    expect(digits.startsWith('role="radiogroup" aria-label="Digits" aria-disabled="true"')).toBe(true);
    expect(digits.split('disabled=""').length - 1).toBe(2);
    expect(chosen(html)).toEqual(['English', 'Western digits', 'Dark', 'Compact']);
  });

  it('uses the rectangles for every fixed choice in Settings, and leaves lists that come from data as they were', () => {
    const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    const settings = src('./pages/Settings.tsx');
    // language, digits, appearance, density, and what happens to expired stock at the till
    expect(settings.split('<ChoiceTiles').length - 1).toBe(5);
    expect(settings).toContain("label={t('ex_policy')} value={s.expiredSales}");
    expect(settings).not.toContain('className="track"');
    // graphics acceleration, the beta channel, each paper's margins, each branch's loyalty rule
    for (const file of ['./industry/GraphicsSetting.tsx', './industry/UpdateSettings.tsx', './industry/Printers.tsx', './industry/Loyalty.tsx']) {
      expect(src(file).split('<ChoiceTiles').length - 1, file).toBe(1);
      expect(src(file), file).not.toContain('className="track"');
    }
    // joining the beta still asks first; leaving is at once
    expect(src('./industry/UpdateSettings.tsx')).toContain("onChange={(v) => { if (v === 'beta') setAsking(true); else channel('stable'); }}");
    // lists from data stay lists: the printers Windows has, the users a phone acts as, how many copies to keep
    expect(src('./industry/Printers.tsx')).toContain('{(printers ?? []).map((p) => <option key={p.name} value={p.name}>{optionLabel(p)}</option>)}');
    expect(settings).toContain('{status.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}');
    expect(settings).toContain('{KEEP_CHOICES.map((n) => <option key={n} value={n}>');
  });

  it('has the new words in Arabic, English and Kurdish', () => {
    for (const k of ['lk_digitsEastern', 'lk_digitsWestern'] as const) {
      const texts = (['ar', 'en', 'ku'] as const).map((l) => makeI18n(l, 'western', () => {}, () => {}).t(k));
      for (const text of texts) expect(text.trim(), k).not.toBe('');
      expect(new Set(texts).size, k).toBe(3);
    }
    const en = makeI18n('en', 'western', () => {}, () => {}).t;
    expect(en('lk_digitsEastern')).toBe('Eastern digits');
    expect(en('lk_digitsWestern')).toBe('Western digits');
  });
});
