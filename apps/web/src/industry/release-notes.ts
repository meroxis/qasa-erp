import type { Lang } from '@qasa/core';

/**
 * Release notes in the update banner's "What's new" (format: docs/releasing.md). A release may hold a section per
 * language between `::: ar` / `::: en` / `::: ku` and `:::` lines; the reader's language is shown, else English, else
 * the whole text. Older notes (English, then paragraphs starting "**بالعربية:**" and "**بە کوردی:**") are split the
 * same way. The text is markdown-lite: "### " headings, "- " items, **bold**; links show their text. Everything is
 * rendered as text, never as HTML.
 */

const FENCE = /^:::\s*(ar|en|ku)\s*$/;
const LEGACY: [Lang, RegExp][] = [['ar', /^\*\*بالعربية:?\*\*:?/], ['ku', /^\*\*بە کوردی:?\*\*:?/]];

export function pickNotes(text: string, lang: Lang): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const sections: Partial<Record<Lang, string[]>> = {};
  let current: Lang | null = null;
  let fenced = false;
  for (const line of lines) {
    const open = FENCE.exec(line.trim());
    if (open) {
      current = open[1] as Lang;
      fenced = true;
      sections[current] = [];
      continue;
    }
    if (line.trim() === ':::') {
      current = null;
      continue;
    }
    if (current) sections[current]!.push(line);
  }
  if (!fenced) {
    // older notes: English first, then a paragraph per language
    const legacy: Partial<Record<Lang, string[]>> = { en: [] };
    let at: Lang = 'en';
    for (const line of lines) {
      const hit = LEGACY.find(([, re]) => re.test(line.trim()));
      if (hit) {
        at = hit[0];
        legacy[at] = [line.trim().replace(hit[1], '').trim()];
        continue;
      }
      (legacy[at] ??= []).push(line);
    }
    if (!legacy.ar && !legacy.ku) return text.trim();
    // drop the trailing separator line the English part ends with
    const clean = (l: string[] | undefined) => (l ?? []).join('\n').replace(/\n-{3,}\s*$/, '').trim();
    return clean(legacy[lang]) || clean(legacy.en) || text.trim();
  }
  const pick = sections[lang] ?? sections.en ?? Object.values(sections)[0] ?? [];
  return pick.join('\n').trim();
}

export type Inline = { text: string; bold: boolean };
export type Block = { kind: 'heading' | 'item' | 'para'; parts: Inline[] };

/** **bold** spans; [text](url) and `code` keep their text only. */
export function inline(text: string): Inline[] {
  const plain = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`([^`]*)`/g, '$1');
  const parts: Inline[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  for (let m = re.exec(plain); m; m = re.exec(plain)) {
    if (m.index > last) parts.push({ text: plain.slice(last, m.index), bold: false });
    parts.push({ text: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < plain.length) parts.push({ text: plain.slice(last), bold: false });
  return parts.filter((p) => p.text);
}

export function blocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'para', parts: inline(para.join(' ')) });
    para = [];
  };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || /^-{3,}$/.test(line)) { flush(); continue; }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) { flush(); out.push({ kind: 'heading', parts: inline(heading[1]!) }); continue; }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) { flush(); out.push({ kind: 'item', parts: inline(item[1]!) }); continue; }
    para.push(line);
  }
  flush();
  return out;
}
