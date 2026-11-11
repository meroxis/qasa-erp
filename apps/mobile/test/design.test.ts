import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dateText, KEYS, LANGS, ltr, money, parseNumber, qty, translate, type Lang } from '../src/i18n';
import { contrast, PALETTES, type Palette } from '../src/theme';

const root = join(__dirname, '..');

describe('colours', () => {
  // text colours and the surfaces they are used on
  const pairs: [keyof Palette, keyof Palette][] = [
    ['ink', 'bg'], ['ink', 'surface'], ['ink', 'surface2'], ['ink2', 'surface'], ['ink3', 'surface'], ['ink3', 'bg'],
    ['onBrand', 'brand'], ['onBrand2', 'brand'], ['onAccent', 'accent'], ['accentText', 'surface'], ['accentText', 'accentSoft'],
    ['onHighlight', 'highlight'], ['ok', 'okBg'], ['warn', 'warnBg'], ['bad', 'badBg'], ['info', 'infoBg'], ['bad', 'surface'], ['ok', 'surface']
  ];
  for (const scheme of ['light', 'dark'] as const) {
    it(`every text meets WCAG AA (4.5:1) on its surface, ${scheme}`, () => {
      const p = PALETTES[scheme];
      for (const [fg, bg] of pairs) expect(contrast(p[fg], p[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('measures contrast as WCAG does', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});

describe('texts', () => {
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it('every text is in Arabic, English and Kurdish, with the same {placeholders}', () => {
    for (const key of KEYS) {
      const [ar, en, ku] = LANGS.map((l) => translate(l, key));
      for (const [lang, text] of [['ar', ar], ['en', en], ['ku', ku]] as const) expect(text?.trim(), `${key} ${lang}`).toBeTruthy();
      expect(vars(ar!), key).toEqual(vars(en!));
      expect(vars(ku!), key).toEqual(vars(en!));
    }
  });

  it('Kurdish is written with Sorani letters, Arabic with Arabic ones, English with neither', () => {
    for (const key of KEYS) {
      // Sorani has ی and ک, not Arabic ي and ك
      expect(translate('ku', key), `${key} ku`).not.toMatch(/[يك]/);
      // Sorani-only letters (ڕ ڵ ێ ۆ ە) and Persian ی ک don't belong in Arabic
      expect(translate('ar', key), `${key} ar`).not.toMatch(/[ڕڵێۆەیک]/);
      expect(translate('en', key), `${key} en`).not.toMatch(/[؀-ۿ]/);
    }
  });

  it('money and quantities read as on the desktop, digits kept left to right inside Arabic and Kurdish', () => {
    expect(money(1_250_000, 'IQD', 'ar')).toBe(`${ltr('1,250,000')} د.ع`);
    expect(money(1_250_000, 'IQD', 'en')).toBe(`${ltr('1,250,000')} IQD`);
    expect(money(150_075, 'USD', 'ku')).toBe(ltr('$1,500.75'));
    expect(money(-5_000, 'IQD', 'ku')).toBe(`${ltr('-5,000')} د.ع`);
    expect(money(-5, 'USD')).toBe(ltr('-$0.05'));
    expect(qty(12_500)).toBe(ltr('12.5'));
    expect(qty(3_000)).toBe(ltr('3'));
    expect(qty(1_234_567)).toBe(ltr('1,234.567'));
    expect(dateText('2026-11-09')).toBe(ltr('09/11/2026'));
  });

  it('reads numbers typed with Arabic-Indic or Persian digits', () => {
    expect(parseNumber('١٬٢٥٠٫٥')).toBe(1250.5);
    expect(parseNumber('۲۵۰۰')).toBe(2500);
    expect(parseNumber('1,250')).toBe(1250);
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('-5')).toBeNaN();
    expect(parseNumber('1e5')).toBeNaN();
  });
});

/** The characters a TrueType font has (its cmap: format 4, and format 12 when present). */
function cmap(file: string): Set<number> {
  const b = readFileSync(file);
  const tables = b.readUInt16BE(4);
  let offset = -1;
  for (let i = 0; i < tables; i++) if (b.toString('latin1', 12 + i * 16, 16 + i * 16) === 'cmap') offset = b.readUInt32BE(12 + i * 16 + 8);
  const out = new Set<number>();
  const count = b.readUInt16BE(offset + 2);
  for (let i = 0; i < count; i++) {
    const sub = offset + b.readUInt32BE(offset + 4 + i * 8 + 4);
    const format = b.readUInt16BE(sub);
    if (format === 4) {
      const segs = b.readUInt16BE(sub + 6) / 2;
      for (let s = 0; s < segs; s++) {
        const end = b.readUInt16BE(sub + 14 + s * 2);
        const start = b.readUInt16BE(sub + 16 + segs * 2 + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) out.add(c);
      }
    } else if (format === 12) {
      const groups = b.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) for (let c = b.readUInt32BE(sub + 16 + g * 12); c <= b.readUInt32BE(sub + 20 + g * 12); c++) out.add(c);
    }
  }
  return out;
}

describe('fonts', () => {
  const fonts = join(root, 'assets', 'fonts');
  const chars = (lang: Lang) => new Set([...KEYS.map((k) => translate(lang, k)).join('')].map((c) => c.codePointAt(0)!));

  it('Noto Sans Arabic has every Arabic-script letter of the Arabic and Kurdish texts, in each weight', () => {
    const needed = [...chars('ar'), ...chars('ku')].filter((c) => c >= 0x0600 && c <= 0x06ff);
    expect(needed.length).toBeGreaterThan(40);
    for (const weight of ['Regular', 'SemiBold', 'Bold']) {
      const have = cmap(join(fonts, `NotoSansArabic-${weight}.ttf`));
      expect(needed.filter((c) => !have.has(c)).map((c) => c.toString(16)), weight).toEqual([]);
    }
  });

  it('IBM Plex Sans has every letter and digit of the English texts and the numbers', () => {
    const needed = [...chars('en'), ...'0123456789,.$-/'.split('').map((c) => c.charCodeAt(0))].filter((c) => /[\p{L}\p{N}$,./-]/u.test(String.fromCodePoint(c)));
    for (const weight of ['Regular', 'SemiBold', 'Bold']) {
      const have = cmap(join(fonts, `IBMPlexSans-${weight}.ttf`));
      expect(needed.filter((c) => !have.has(c)).map((c) => String.fromCodePoint(c)), weight).toEqual([]);
    }
  });

  it('ships with the fonts\' licence', () => {
    expect(readFileSync(join(fonts, 'NotoSansArabic-OFL.txt'), 'utf8')).toMatch(/SIL Open Font License/);
    expect(readFileSync(join(fonts, 'IBMPlexSans-OFL.txt'), 'utf8')).toMatch(/SIL Open Font License/);
  });
});

describe('privacy in the code', () => {
  const files = [join(root, 'App.tsx'), ...readdirSync(join(root, 'src'), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f)).map((f) => join(root, 'src', f))];

  it('writes nothing to the log (no names, amounts or keys in a phone\'s logs)', () => {
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bconsole\.(log|info|warn|error|debug)\b/);
  });

  it('keeps nothing in plain storage, and talks to nothing but the office and the relay', () => {
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/AsyncStorage|localStorage/);
      expect(text, f).not.toMatch(/\bfetch\(/);
    }
  });
});
