import { readdirSync, readFileSync } from 'node:fs';

/**
 * For tests only: the till's source as one text (2.0: pages/Pos.tsx is the page, its parts are in pos/), so a test
 * that checks how the till is written finds the line in whichever file holds it now.
 */
export function tillSource(): string {
  const dir = new URL('./pos/', import.meta.url);
  const parts = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.')).sort()
    .map((f) => readFileSync(new URL(f, dir), 'utf8'));
  return [readFileSync(new URL('./pages/Pos.tsx', import.meta.url), 'utf8'), ...parts].join('\n');
}

/** For tests only: one file of the till's parts (pos/<name>). */
export const tillPart = (name: string): string => readFileSync(new URL(`./pos/${name}`, import.meta.url), 'utf8');
