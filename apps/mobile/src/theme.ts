import type { Lang } from './i18n';

/**
 * The phone app's look, from the desktop app's own (apps/web/src/styles.css): the same navy, blue and orange, the
 * same quiet greys, light and dark, and the same fonts — Noto Sans Arabic for Arabic and Kurdish, IBM Plex Sans for
 * English and for numbers. Every text colour meets WCAG AA (4.5:1) on the surfaces it is used on, in both themes
 * (test/theme.test.ts measures them).
 */

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

export interface Palette {
  /** the screen behind the cards */
  bg: string;
  /** cards, sheets, the tab bar */
  surface: string;
  /** a raised or pressed surface */
  surface2: string;
  line: string;
  ink: string;
  ink2: string;
  ink3: string;
  /** the brand's navy: the home screen's banner */
  brand: string;
  onBrand: string;
  onBrand2: string;
  accent: string;
  onAccent: string;
  accentSoft: string;
  accentText: string;
  /** the brand's orange */
  highlight: string;
  onHighlight: string;
  ok: string; okBg: string;
  warn: string; warnBg: string;
  bad: string; badBg: string;
  info: string; infoBg: string;
  scrim: string;
  skeleton: string;
}

export const PALETTES: Record<Scheme, Palette> = {
  light: {
    bg: '#F4F6F9', surface: '#FFFFFF', surface2: '#EEF1F5', line: '#E3E7ED',
    ink: '#141B2D', ink2: '#475166', ink3: '#5C6679',
    brand: '#0F1E3D', onBrand: '#FFFFFF', onBrand2: '#C9D3E6',
    accent: '#1D5FD1', onAccent: '#FFFFFF', accentSoft: '#E6EEFB', accentText: '#1A51B5',
    highlight: '#F2A33A', onHighlight: '#0F1E3D',
    ok: '#0B6B45', okBg: '#E3F3EA', warn: '#8A5800', warnBg: '#FCF0D9', bad: '#A1271A', badBg: '#FBE7E3', info: '#1F4E93', infoBg: '#E6EEF9',
    scrim: 'rgba(15, 30, 61, 0.32)', skeleton: '#E6EAF0'
  },
  dark: {
    bg: '#11151C', surface: '#1F242D', surface2: '#2A303B', line: '#2C323D',
    ink: '#E8ECF3', ink2: '#B6BFCD', ink3: '#98A2B3',
    brand: '#182A4F', onBrand: '#FFFFFF', onBrand2: '#C3CEE3',
    accent: '#7AA7FF', onAccent: '#0A1630', accentSoft: '#1E3156', accentText: '#8FB5FF',
    highlight: '#F2A33A', onHighlight: '#0F1E3D',
    ok: '#6FD3A0', okBg: '#163A2A', warn: '#F3BE6B', warnBg: '#3B2D12', bad: '#FF9C8F', badBg: '#43201B', info: '#93BBFF', infoBg: '#1A2C4C',
    scrim: 'rgba(0, 0, 0, 0.5)', skeleton: '#2A303B'
  }
};

/** Spacing on a 4-point grid. */
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;
export const radius = { s: 8, m: 12, l: 16, pill: 999 } as const;
/** The smallest thing a finger presses: 48 dp (Android's and WCAG's target size). */
export const TOUCH = 48;

// ——— type ———

export type Weight = 'regular' | 'semibold' | 'bold';

/** Font families as the app loads them (fonts.ts), by script. */
export const FONT_FILES = {
  'NotoSansArabic-Regular': 'regular', 'NotoSansArabic-SemiBold': 'semibold', 'NotoSansArabic-Bold': 'bold',
  'IBMPlexSans-Regular': 'regular', 'IBMPlexSans-SemiBold': 'semibold', 'IBMPlexSans-Bold': 'bold'
} as const;

const FAMILY: Record<'arabic' | 'latin', Record<Weight, keyof typeof FONT_FILES>> = {
  arabic: { regular: 'NotoSansArabic-Regular', semibold: 'NotoSansArabic-SemiBold', bold: 'NotoSansArabic-Bold' },
  latin: { regular: 'IBMPlexSans-Regular', semibold: 'IBMPlexSans-SemiBold', bold: 'IBMPlexSans-Bold' }
};

/** The family for text in a language (numbers: always the Latin one, tabular like the desktop's). */
export const fontFor = (lang: Lang | 'number', weight: Weight = 'regular') => FAMILY[lang === 'en' || lang === 'number' ? 'latin' : 'arabic'][weight];

export type TextVariant = 'display' | 'title' | 'headline' | 'body' | 'bodyStrong' | 'label' | 'caption' | 'number' | 'numberLarge';

/**
 * Sizes and line heights. Arabic and Kurdish letters reach further above and below the line than Latin ones: their
 * lines are a little taller, so nothing is clipped and diacritics have room.
 */
export function typeScale(lang: Lang): Record<TextVariant, { fontSize: number; lineHeight: number; weight: Weight; family: 'text' | 'number' }> {
  const k = lang === 'en' ? 1.35 : 1.6;
  const v = (fontSize: number, weight: Weight, family: 'text' | 'number' = 'text') => ({ fontSize, lineHeight: Math.round(fontSize * k), weight, family });
  return {
    display: v(28, 'bold'), title: v(22, 'bold'), headline: v(18, 'semibold'), body: v(16, 'regular'), bodyStrong: v(16, 'semibold'),
    label: v(14, 'semibold'), caption: v(13, 'regular'), number: { ...v(16, 'semibold', 'number'), lineHeight: 22 }, numberLarge: { ...v(26, 'bold', 'number'), lineHeight: 34 }
  };
}

// ——— contrast (WCAG 2.2) ———

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
