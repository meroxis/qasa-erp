export type Lang = 'ar' | 'en' | 'ku';

/** Language order used everywhere in the product: Arabic, English, Kurdish. */
export const LANGS: readonly Lang[] = ['ar', 'en', 'ku'];

export interface Names {
  ar: string;
  en: string;
  ku: string;
}

export function isLang(value: unknown): value is Lang {
  return value === 'ar' || value === 'en' || value === 'ku';
}

export function isRtl(lang: Lang): boolean {
  return lang !== 'en';
}

/** HTML lang attribute value (Kurdish Sorani is "ckb"). */
export function htmlLang(lang: Lang): string {
  return lang === 'ku' ? 'ckb' : lang;
}

/**
 * Normalizes Arabic/Kurdish text for searching, so that a name typed on an
 * Arabic keyboard (ي ك ة) matches one typed on a Kurdish keyboard (ی ک ە) and vice versa.
 */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // harakat, superscript alef, tatweel
    .replace(/[يىی]/g, 'ی')
    .replace(/[كک]/g, 'ک')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ە')
    .replace(/ۆ/g, 'و')
    .replace(/ێ/g, 'ی')
    .replace(/ڕ/g, 'ر')
    .replace(/ڵ/g, 'ل')
    .replace(/\s+/g, ' ')
    .trim();
}
