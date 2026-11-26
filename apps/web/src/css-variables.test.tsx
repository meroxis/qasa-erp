import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Every colour, size or font variable the app reads is one it defines. A variable that is never defined makes the
// whole declaration void: a background becomes see-through (the business type screen over the dashboard,
// 2.0.0-beta.4: var(--bg)), a colour falls back to the parent's. var(--name, fallback) is fine: the fallback holds.
// a path Windows reads too (URL.pathname gives /D:/... there)
const here = fileURLToPath(new URL('.', import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path);
  return /\.(css|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
});

describe('CSS variables', () => {
  it('reads none that is never defined (without a fallback)', () => {
    const all = files(here).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    const defined = new Set<string>();
    for (const { text } of all) {
      for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]!);
      for (const m of text.matchAll(/setProperty\(\s*'(--[a-zA-Z0-9-]+)'/g)) defined.add(m[1]!);
      for (const m of text.matchAll(/'(--[a-zA-Z0-9-]+)'\s*:/g)) defined.add(m[1]!);
    }
    const missing: string[] = [];
    for (const { path, text } of all) {
      for (const m of text.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g)) {
        if (!defined.has(m[1]!)) missing.push(`${m[1]} in ${path.slice(here.length)}:${text.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(missing).toEqual([]);
    // the first screen of a new company covers what is under it
    expect(readFileSync(join(here, 'styles.css'), 'utf8')).toContain('.biz-screen { position: fixed; inset: 0; z-index: 90; overflow: auto; background: var(--mica); background-color: var(--mica-base);');
  });
});
