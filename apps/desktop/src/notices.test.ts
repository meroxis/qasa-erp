// Settings → About → Legal in the Windows app: the third-party notices installed with it, opened through the bridge.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NOTICES_FILE, openNotices } from './notices.ts';

const source = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const RESOURCES = join('C:', 'Program Files', 'Qasa ERP', 'resources');

describe('opening the installed third-party notices', () => {
  it('opens the one file next to app.asar, the name electron-builder.yml installs it under', async () => {
    expect(NOTICES_FILE).toBe('THIRD_PARTY_NOTICES.md');
    expect(source('../electron-builder.yml')).toContain(`to: ${NOTICES_FILE}`);
    const opened: string[] = [];
    expect(await openNotices(RESOURCES, async (path) => { opened.push(path); return ''; })).toBe(true);
    expect(opened).toEqual([join(RESOURCES, 'THIRD_PARTY_NOTICES.md')]);
  });

  it('says false, and logs why, when Windows could not open it; opens nothing without a resources folder', async () => {
    const logged: unknown[][] = [];
    const log = (...parts: unknown[]) => void logged.push(parts);
    expect(await openNotices(RESOURCES, async () => 'Failed to open path', log)).toBe(false);
    expect(await openNotices(RESOURCES, () => Promise.reject(new Error('no viewer')), log)).toBe(false);
    expect(logged).toHaveLength(2);
    expect(String(logged[0])).toContain('Failed to open path');
    let called = false;
    expect(await openNotices('', async () => { called = true; return ''; }, log)).toBe(false);
    expect(called).toBe(false);
  });
});

describe('the window bridge for the notices', () => {
  it('the app window gets qasaDesktop.openNotices(), which sends the main process nothing but the request', () => {
    expect(source('app-preload.ts')).toMatch(/\n {2}openNotices: \(\) => ipcRenderer\.invoke\('app:notices'\) as Promise<boolean>,\n/);
  });

  it('the main process answers only the app window’s own page, and opens only the file in process.resourcesPath', () => {
    const main = source('main.ts');
    const handler = /\nipcMain\.handle\('app:notices', [^\n]*\n(?: {2}[^\n]*\n)*\}\);\n/.exec(main)?.[0] ?? '';
    // the same check as the other app-window calls (main frame, app window, app origin); the page's arguments are ignored
    expect(handler).toMatch(/^\nipcMain\.handle\('app:notices', async \(event\) => \{\n {2}if \(!invokedByAppPage\(event\)\) return false;\n/);
    expect(handler).toContain('openNotices(process.resourcesPath, (path) => shell.openPath(path), log)');
    expect(main).toMatch(/import \{ openNotices \} from '\.\/notices\.ts';/);
  });
});
