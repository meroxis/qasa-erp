import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from './version.ts';

describe('version', () => {
  it('matches the Windows app, which names the installer and the release tag', () => {
    const desktop = JSON.parse(readFileSync(new URL('../../../apps/desktop/package.json', import.meta.url), 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(desktop.version);
  });
});
