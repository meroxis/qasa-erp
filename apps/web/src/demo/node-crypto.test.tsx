import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import * as shim from './node-crypto.ts';

// The website demo bundles the server with `node:crypto` replaced by node-crypto.ts (vite.config.ts). A name the
// server imports but the stand-in lacks fails `npm run build:demo` (MISSING_EXPORT), and with it the website build.
it('the demo crypto stand-in exports every name the server imports from node:crypto', () => {
  const dir = fileURLToPath(new URL('../../../../packages/server/src/', import.meta.url));
  const needed = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    for (const m of readFileSync(dir + file, 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*'node:crypto'/g)) {
      for (const part of m[1]!.split(',').map((p) => p.trim()).filter((p) => p && !p.startsWith('type '))) needed.add(part.split(/\s+as\s+/)[0]!);
    }
  }
  expect(needed.size).toBeGreaterThan(0);
  expect([...needed].filter((name) => !(name in shim)).sort()).toEqual([]);
});
