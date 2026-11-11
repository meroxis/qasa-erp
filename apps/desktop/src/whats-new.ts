import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "What's new in <version>" after an update (1.1): the version the app last ran with, kept for this Windows user in
 * the app's folder (last-version.json). The window shows the notes of the new version once, then says "seen"; a fresh
 * install never shows them (there was nothing before it).
 */

const FILE = 'last-version.json';
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,32})?$/;

export interface WhatsNew { current: string; previous: string | null }

function read(dir: string): string | null {
  try {
    const v = (JSON.parse(readFileSync(join(dir, FILE), 'utf8')) as { version?: unknown }).version;
    return typeof v === 'string' && VERSION.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Writes the version whole (a temporary name, then renamed): a power cut never leaves half a file. */
export function markSeen(dir: string, version: string): void {
  if (!VERSION.test(version)) return;
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, FILE + '.tmp');
  writeFileSync(tmp, JSON.stringify({ version }));
  renameSync(tmp, join(dir, FILE));
}

/**
 * At the start, before the company file is opened: the version run before this one, or null when there is nothing
 * new to say. With no record yet, books already there mean an update from a version before this record existed
 * ('earlier'); none mean a fresh install, which is recorded as seen at once.
 */
export function startVersion(dir: string, current: string, hadBooks: boolean): WhatsNew {
  const last = read(dir);
  if (last === null) {
    if (!hadBooks) {
      try { markSeen(dir, current); } catch { /* shown never anyway: there is no previous version */ }
      return { current, previous: null };
    }
    return { current, previous: 'earlier' };
  }
  return { current, previous: last === current ? null : last };
}

/** Were there books on this PC before this start (the first company's file, or another company's)? */
export function booksBefore(userDataDir: string): boolean {
  return existsSync(join(userDataDir, 'data', 'qasa.sqlite')) || existsSync(join(userDataDir, 'companies.json'));
}
