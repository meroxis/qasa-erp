import type { Lang, Names } from '@qasa/core';

/**
 * One name for an item, a category or a warehouse (1.4). The form asks for one text; it is kept for all three
 * languages, so a list, an invoice or a print in any of them shows it. Records from before that hold a different text
 * per language keep them: the one field then changes only the text it shows.
 */

/** Whether the three languages hold more than one different text (empty ones don't count). */
export function namesDiffer(names: Names): boolean {
  return new Set([names.ar.trim(), names.en.trim(), names.ku.trim()].filter(Boolean)).size > 1;
}

/** The language whose text the screens show for `lang`: its own, else the first that has one (as i18n.name does). */
export function shownLang(names: Names, lang: Lang): Lang {
  if (names[lang].trim()) return lang;
  return (['ar', 'en', 'ku'] as const).find((l) => names[l].trim()) ?? lang;
}

/** The same text for every language. */
export function sameName(text: string): Names {
  return { ar: text, en: text, ku: text };
}

/**
 * The names after the one field was typed in. `own`: the language whose text the field shows when the record keeps a
 * text per language (only that one changes); null: one text for all three.
 */
export function withOneName(names: Names, text: string, own: Lang | null): Names {
  return own ? { ...names, [own]: text } : sameName(text);
}
