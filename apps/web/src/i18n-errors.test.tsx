import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { isKey } from './i18n.ts';

const root = join(import.meta.dirname, '../../..');
const serverFiles = (dir: string) => readdirSync(join(root, dir))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.startsWith('chart-') && f !== 'demo-data.ts')
  .map((f) => join(dir, f));
const dirs = ['packages/server/src', 'packages/core/src', 'pro/src'].filter((d) => { try { readdirSync(join(root, d)); return true; } catch { return false; } });

/** Shown by the desktop app's own windows (recovery, start over, update), never by these pages. */
const ELSEWHERE = new Set(['recovery_failed', 'recovery_method_invalid', 'recovery_not_admin', 'start_over_confirmation', 'start_over_on_server', 'update_copy_failed',
  // the error of every refused form: its details carry the codes
  'validation']);

const THROWN = [/conflict\('([a-z][a-z0-9_]*)'/g, /new AppError\(\d+, '([a-z][a-z0-9_]*)'/g, /\{ code: '([a-z][a-z0-9_]*)'/g];

it('has a text, in Arabic, English and Kurdish, for every error a server file can give (reliability review #7)', () => {
  const missing = new Set<string>();
  for (const file of dirs.flatMap(serverFiles)) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const re of THROWN) {
      for (const m of text.matchAll(re)) {
        const code = m[1]!;
        if (ELSEWHERE.has(code) || isKey(`err_${code}`)) continue;
        // a text per field ("err_note_required_note") is enough
        if (!hasFieldText(code)) missing.add(`${code} (${file})`);
      }
    }
  }
  expect([...missing].sort()).toEqual([]);
});

let keys: string[] | null = null;
function hasFieldText(code: string): boolean {
  keys ??= readdirSync(join(root, 'apps/web/src/i18n')).concat('../i18n.ts')
    .flatMap((f) => [...readFileSync(join(root, 'apps/web/src/i18n', f), 'utf8').matchAll(/\b(err_[a-z0-9_]+)\s*:/g)].map((m) => m[1]!));
  return keys.some((k) => k.startsWith(`err_${code}_`) && isKey(k));
}
