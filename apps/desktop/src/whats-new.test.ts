import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { booksBefore, markSeen, startVersion } from './whats-new.ts';

const root = mkdtempSync(join(tmpdir(), 'qasa-whats-new-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const fresh = () => { const d = join(root, Math.random().toString(16).slice(2)); mkdirSync(d, { recursive: true }); return d; };

describe("What's new after an update", () => {
  it('never shows after a fresh install, and records the version at once', () => {
    const d = fresh();
    expect(booksBefore(d)).toBe(false);
    expect(startVersion(d, '1.1.0', false)).toEqual({ current: '1.1.0', previous: null });
    expect(JSON.parse(readFileSync(join(d, 'last-version.json'), 'utf8'))).toEqual({ version: '1.1.0' });
    expect(startVersion(d, '1.1.0', true)).toEqual({ current: '1.1.0', previous: null });
  });

  it('shows once after an update: books from a version before this record, or a newer version than the one recorded', () => {
    const d = fresh();
    mkdirSync(join(d, 'data'));
    writeFileSync(join(d, 'data', 'qasa.sqlite'), '');
    expect(booksBefore(d)).toBe(true);
    expect(startVersion(d, '1.1.0', true)).toEqual({ current: '1.1.0', previous: 'earlier' });
    // until it is seen, every start asks again (a crash before it showed loses nothing)
    expect(startVersion(d, '1.1.0', true)).toEqual({ current: '1.1.0', previous: 'earlier' });
    markSeen(d, '1.1.0');
    expect(startVersion(d, '1.1.0', true)).toEqual({ current: '1.1.0', previous: null });
    expect(startVersion(d, '1.1.1', true)).toEqual({ current: '1.1.1', previous: '1.1.0' });
  });

  it('reads a damaged record as none, and writes only version-shaped text', () => {
    const d = fresh();
    writeFileSync(join(d, 'last-version.json'), '{"version": "<b>x</b>"}');
    expect(startVersion(d, '1.1.0', true).previous).toBe('earlier');
    markSeen(d, '../../evil');
    expect(readFileSync(join(d, 'last-version.json'), 'utf8')).toBe('{"version": "<b>x</b>"}');
  });
});
