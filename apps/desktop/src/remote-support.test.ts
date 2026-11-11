import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { isAllowedExternal, isRemoteSupportUrl, QUICK_ASSIST_STORE_URL, QUICK_ASSIST_URL } from './external-links.ts';
import { errorLines, remoteSupportHandlers, type RemoteSupportDeps } from './remote-support.ts';

const APP_PAGE = { from: 'app' };
function deps(over: Partial<RemoteSupportDeps> = {}) {
  const opened: string[] = [];
  const d: RemoteSupportDeps = {
    fromAppPage: (event) => event === APP_PAGE,
    openExternal: vi.fn(async (url: string) => { opened.push(url); }),
    readLog: () => null,
    edition: () => 'installer',
    windows: () => '10.0.26100',
    client: () => false,
    scrub: () => ({}),
    log: () => {},
    ...over
  };
  return { d, opened, handlers: remoteSupportHandlers(d) };
}

describe('Start Quick Assist', () => {
  it('opens only Quick Assist, whatever address the page passes', async () => {
    const { opened, handlers } = deps();
    for (const evil of ['https://evil.example/', 'file:///C:/Windows/System32/calc.exe', 'ms-settings:privacy', QUICK_ASSIST_STORE_URL]) {
      expect(await handlers.start(APP_PAGE, evil, { url: evil })).toBe('opened');
    }
    expect(opened).toEqual(Array(4).fill(QUICK_ASSIST_URL));
  });

  it('opens Quick Assist’s Store page when Quick Assist isn’t installed, and says when neither opened', async () => {
    const store = deps({ openExternal: vi.fn(async (url: string) => { if (url === QUICK_ASSIST_URL) throw new Error('no handler'); }) });
    expect(await store.handlers.start(APP_PAGE, 'https://evil.example/')).toBe('store');
    expect(vi.mocked(store.d.openExternal).mock.calls.map((c) => c[0])).toEqual([QUICK_ASSIST_URL, QUICK_ASSIST_STORE_URL]);
    const none = deps({ openExternal: vi.fn(async () => { throw new Error('no handler'); }) });
    expect(await none.handlers.start(APP_PAGE)).toBe('failed');
  });

  it('does nothing for a caller other than the app window’s own page', async () => {
    const { opened, handlers } = deps();
    expect(await handlers.start({ from: 'elsewhere' })).toBeNull();
    expect(handlers.info({ from: 'elsewhere' })).toBeNull();
    expect(opened).toEqual([]);
  });

  it('keeps the two fixed addresses out of reach of links, new windows and navigations', () => {
    expect(QUICK_ASSIST_URL).toBe('ms-quick-assist:');
    expect(QUICK_ASSIST_STORE_URL).toBe('ms-windows-store://pdp/?productid=9P7BP5VNWKX5');
    for (const url of [QUICK_ASSIST_URL, QUICK_ASSIST_STORE_URL, 'ms-quick-assist:?x=1', 'ms-windows-store://pdp/?productid=9NRTX5BBK9DW']) {
      expect(isAllowedExternal(url), url).toBe(false);
    }
    expect(isRemoteSupportUrl(QUICK_ASSIST_URL)).toBe(true);
    expect(isRemoteSupportUrl('ms-quick-assist:?x=1')).toBe(false);
    expect(isRemoteSupportUrl('https://evil.example/')).toBe(false);
  });

  it('crosses the bridge with no argument at all', () => {
    const preload = readFileSync(new URL('./app-preload.ts', import.meta.url), 'utf8');
    expect(preload).toMatch(/remoteSupport: \(\) => ipcRenderer\.invoke\('app:remoteSupport'\)/);
    expect(preload).toMatch(/supportInfo: \(\) => ipcRenderer\.invoke\('app:supportInfo'\)/);
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/ipcMain\.handle\('app:remoteSupport', \(event\) => remoteSupport\.start\(event\)\)/);
  });
});

describe('the facts for Copy support details', () => {
  it('answers the edition, Windows, the role and the log’s last error lines, scrubbed', () => {
    const log = [
      '2026-11-11T09:00:00.000Z Qasa ERP 1.2.0 started — server process on http://127.0.0.1:47420, data in C:\\Users\\Raz\\AppData\\Roaming\\Qasa ERP\\data',
      '2026-11-11T09:01:00.000Z could not open https://my.qasaerp.com/x?token=abc, code=4e1a9c0b7d2f4a6e8b3c5d7f9a1b3c5d',
      '2026-11-11T09:02:00.000Z all fine'
    ].join('\n');
    const { handlers } = deps({ readLog: () => log, client: () => true, edition: () => 'store', scrub: () => ({ homeDir: 'C:\\Users\\Raz', names: ['Raz'] }) });
    const info = handlers.info(APP_PAGE)!;
    expect(info).toMatchObject({ edition: 'store', windows: '10.0.26100', role: 'client' });
    expect(info.logLines).toHaveLength(1);
    expect(info.logLines[0]).not.toMatch(/token|4e1a9c|Raz/);
  });

  it('keeps at most five short lines', () => {
    const lines = errorLines(Array.from({ length: 20 }, (_, i) => `error ${i} ${'x'.repeat(500)}`).join('\n'));
    expect(lines).toHaveLength(5);
    expect(lines[4]).toMatch(/^error 19 /);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(240);
  });

  it('answers no Windows version it can’t trust', () => {
    expect(deps({ windows: () => 'C:\\Users\\Mer' }).handlers.info(APP_PAGE)!.windows).toBe('');
  });
});
