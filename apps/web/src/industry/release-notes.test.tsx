import { describe, expect, it } from 'vitest';
import { blocks, inline, pickNotes } from './release-notes.ts';

const FENCED = `Intro line outside
::: en
### New
- **Faster** start
:::
::: ar
### جديد
- بدء أسرع
:::
::: ku
### نوێ
:::`;

describe('pickNotes', () => {
  it('picks the reader’s fenced section', () => {
    expect(pickNotes(FENCED, 'ar')).toBe('### جديد\n- بدء أسرع');
    expect(pickNotes(FENCED, 'en')).toBe('### New\n- **Faster** start');
    expect(pickNotes(FENCED, 'ku')).toBe('### نوێ');
  });
  it('falls back to English, then the first section', () => {
    expect(pickNotes('::: en\nHello\n:::', 'ku')).toBe('Hello');
    expect(pickNotes('::: ar\nمرحبا\n:::', 'en')).toBe('مرحبا');
  });
  it('splits the older notes format', () => {
    const legacy = 'English text.\n\n---\n\n**بالعربية:** نص عربي.\n\n**بە کوردی:** دەقی کوردی.';
    expect(pickNotes(legacy, 'en')).toBe('English text.');
    expect(pickNotes(legacy, 'ar')).toBe('نص عربي.');
    expect(pickNotes(legacy, 'ku')).toBe('دەقی کوردی.');
  });
  it('returns plain notes whole', () => {
    expect(pickNotes('  Just notes.  ', 'ar')).toBe('Just notes.');
  });
});

describe('markdown-lite', () => {
  it('inline keeps link text, drops code ticks, splits bold', () => {
    expect(inline('See [docs](https://x) and `npm` **now**')).toEqual([
      { text: 'See docs and npm ', bold: false },
      { text: 'now', bold: true }
    ]);
  });
  it('blocks: headings, items, paragraphs', () => {
    const b = blocks('## Title\n\nline one\nline two\n\n- a\n* b\n---\nend');
    expect(b.map((x) => x.kind)).toEqual(['heading', 'para', 'item', 'item', 'para']);
    expect(b[1]!.parts[0]!.text).toBe('line one line two');
  });
  it('never yields HTML elements, only text', () => {
    const b = blocks('<img src=x onerror=alert(1)>');
    expect(b[0]!.parts[0]!.text).toContain('<img');
  });
});
