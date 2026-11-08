import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Every page link written in the code must name a route App.tsx knows; an unknown one silently falls to Home
// (the Management reports tabs and the Home report tiles once linked to "more-reports" instead of "reports-more").
it('every href, go and nav link points to a route App.tsx handles', () => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const cases = new Set([...readFileSync(join(root, 'App.tsx'), 'utf8').matchAll(/case '([a-z0-9-]+)':/g)].map((m) => m[1]!));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) files.push(p);
    }
  };
  walk(root);
  const unknown: string[] = [];
  let seen = 0;
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:\bhref|\bgo|navigate)\(\s*[`'"]([a-z][a-z0-9-]*)|\b(?:link|path):\s*[`'"]([a-z][a-z0-9-]*)/g)) {
      seen++;
      const target = m[1] ?? m[2]!;
      if (!cases.has(target)) unknown.push(`${file.slice(root.length)}: ${target}`);
    }
  }
  expect(seen).toBeGreaterThan(50);
  expect(unknown).toEqual([]);
});
