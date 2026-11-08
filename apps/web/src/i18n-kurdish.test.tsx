import { expect, it } from 'vitest';

// Sorani is written with Kurdish letters: ی and ک, never the Arabic ى, ي or ك (they look alike, but they break search
// and sorting and read as a mistake). Checks every module text file (apps/web/src/i18n/*.ts).
const modules = import.meta.glob('./i18n/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;

it('writes every Kurdish module text with Kurdish letters', () => {
  const wrong: string[] = [];
  for (const [file, exports] of Object.entries(modules)) {
    for (const table of Object.values(exports)) {
      if (!table || typeof table !== 'object') continue;
      for (const [key, value] of Object.entries(table as Record<string, unknown>)) {
        const ku = Array.isArray(value) ? value[2] : undefined;
        if (typeof ku === 'string' && /[ىيك]/.test(ku)) wrong.push(`${file} ${key}: ${ku}`);
      }
    }
  }
  expect(Object.keys(modules).length).toBeGreaterThan(10);
  expect(wrong).toEqual([]);
});

// Privacy is تایبەتێتی; تایبەتمەندی means a feature, so «سیاسەتی تایبەتمەندی» would read as "feature policy".
it('calls privacy تایبەتێتی in Kurdish, never تایبەتمەندی (feature)', () => {
  const wrong: string[] = [];
  let checked = 0;
  for (const [file, exports] of Object.entries(modules)) {
    for (const table of Object.values(exports)) {
      if (!table || typeof table !== 'object') continue;
      for (const [key, value] of Object.entries(table as Record<string, unknown>)) {
        if (!Array.isArray(value) || typeof value[1] !== 'string' || !/privacy/i.test(value[1].replace(/\{\w+\}/g, ''))) continue;
        checked++;
        const ku = String(value[2]);
        if (!ku.includes('تایبەتێتی') || ku.includes('تایبەتمەندی')) wrong.push(`${file} ${key}: ${ku}`);
      }
    }
  }
  expect(checked).toBeGreaterThan(0);
  expect(wrong).toEqual([]);
  const legal = modules['./i18n/legal.ts']!.LEGAL_TEXT as Record<string, readonly string[]>;
  expect(legal.lg_privacy![2]).toBe('سیاسەتی تایبەتێتی');
});
