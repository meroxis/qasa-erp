import { describe, expect, it, vi } from 'vitest';
import { customerDisplayUrl, customerScreenBounds, DRAWER_BUILD_SCRIPT, DRAWER_FAST_SCRIPT, DRAWER_SCRIPT, drawerBlocked, drawerHandler, receiptPrinter } from './till-desktop.ts';

const file = (printer: string | null) => JSON.stringify({ choices: { receipt: { printer, paper: 'auto', margins: 'default', copies: 1, silent: true } } });

function deps(over: Partial<Parameters<typeof drawerHandler>[0]> = {}) {
  let t = 0;
  const d = {
    fromAppPage: () => true,
    readPrintersFile: () => file('XP-80'),
    printers: async () => [{ name: 'XP-80' }, { name: 'Office A4' }],
    run: vi.fn(async () => 'opened\r\n'),
    log: () => {},
    now: () => (t += 2_000),
    ...over
  };
  return d;
}

describe('the cash drawer', () => {
  it('kicks the receipt printer Windows lists, with its name outside the script', async () => {
    const d = deps();
    expect(await drawerHandler(d)({ sender: 1 })).toEqual({ status: 'opened' });
    expect(d.run).toHaveBeenCalledWith(DRAWER_SCRIPT, 'XP-80');
    expect(DRAWER_SCRIPT).toContain('$env:QASA_DRAWER_PRINTER');
    expect(DRAWER_SCRIPT).toContain('27, 112, 0, 25, 250');
    expect(DRAWER_SCRIPT).not.toContain('XP-80');
  });
  it('refuses another page, needs a chosen and listed printer, and reports a failure', async () => {
    expect(await drawerHandler(deps({ fromAppPage: () => false }))({ sender: 1 })).toEqual({ status: 'refused' });
    expect(await drawerHandler(deps({ readPrintersFile: () => file(null) }))({ sender: 1 })).toEqual({ status: 'no_printer' });
    expect(await drawerHandler(deps({ printers: async () => [{ name: 'Office A4' }] }))({ sender: 1 })).toEqual({ status: 'no_printer' });
    expect(await drawerHandler(deps({ run: vi.fn(async () => 'failed') }))({ sender: 1 })).toEqual({ status: 'failed' });
    expect(await drawerHandler(deps({ run: vi.fn(async () => { throw new Error('no'); }) }))({ sender: 1 })).toEqual({ status: 'failed' });
  });
  it('kicks at most once each 1.5 s', async () => {
    let t = 0;
    const open = drawerHandler(deps({ now: () => t }));
    expect((await open({ sender: 1 })).status).toBe('opened');
    t = 1_000;
    expect((await open({ sender: 1 })).status).toBe('busy');
    t = 3_000;
    expect((await open({ sender: 1 })).status).toBe('opened');
  });
  it('compiles its helper once for the run and kicks through it after, never compiling on each sale', async () => {
    let t = 0;
    const run = vi.fn(async (script: string) => (script === DRAWER_BUILD_SCRIPT ? 'ready\r\n' : 'opened\r\n'));
    const open = drawerHandler(deps({ run, helperFile: () => 'C:\\Temp\\qasa-drawer-x\\QasaRaw.dll', fileHash: () => 'abc', now: () => (t += 2_000) }));
    expect((await open({ sender: 1 })).status).toBe('opened');
    expect((await open({ sender: 1 })).status).toBe('opened');
    expect((await open({ sender: 1 })).status).toBe('opened');
    expect(run.mock.calls.map((c) => c[0])).toEqual([DRAWER_BUILD_SCRIPT, DRAWER_FAST_SCRIPT, DRAWER_FAST_SCRIPT, DRAWER_FAST_SCRIPT]);
    // the build names no printer and sends nothing; the kick has the printer and the helper in its environment only
    expect(run.mock.calls[0]).toEqual([DRAWER_BUILD_SCRIPT, '', 'C:\\Temp\\qasa-drawer-x\\QasaRaw.dll']);
    expect(run.mock.calls[1]).toEqual([DRAWER_FAST_SCRIPT, 'XP-80', 'C:\\Temp\\qasa-drawer-x\\QasaRaw.dll']);
    expect(DRAWER_BUILD_SCRIPT).toContain('-OutputAssembly $env:QASA_DRAWER_HELPER');
    expect(DRAWER_BUILD_SCRIPT).not.toContain('::Send(');
    expect(DRAWER_FAST_SCRIPT).toContain('Add-Type -LiteralPath $env:QASA_DRAWER_HELPER');
    expect(DRAWER_FAST_SCRIPT).not.toContain('-TypeDefinition');
    for (const script of [DRAWER_BUILD_SCRIPT, DRAWER_FAST_SCRIPT]) { expect(script).not.toContain('XP-80'); expect(script).not.toContain('QasaRaw.dll'); }
  });
  it('can be made ready ahead of the first sale, only on a PC with a receipt printer chosen', async () => {
    const run = vi.fn(async (script: string) => (script === DRAWER_BUILD_SCRIPT ? 'ready' : 'opened'));
    const open = drawerHandler(deps({ run, helperFile: () => 'h.dll', fileHash: () => 'abc' }));
    expect(await open.prepare()).toBe(true);
    expect(await open.prepare()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect((await open({ sender: 1 })).status).toBe('opened');
    expect(run.mock.calls.map((c) => c[0])).toEqual([DRAWER_BUILD_SCRIPT, DRAWER_FAST_SCRIPT]);
    const none = vi.fn(async () => 'ready');
    expect(await drawerHandler(deps({ run: none, readPrintersFile: () => file(null), helperFile: () => 'h.dll', fileHash: () => 'abc' })).prepare()).toBe(false);
    expect(none).not.toHaveBeenCalled();
  });
  it('never loads a helper that is not the file it compiled, and goes the in-memory way when the helper fails', async () => {
    let t = 0;
    let hash = 'abc';
    const run = vi.fn(async (script: string) => (script === DRAWER_BUILD_SCRIPT ? 'ready' : 'opened'));
    const open = drawerHandler(deps({ run, helperFile: () => 'h.dll', fileHash: () => hash, now: () => (t += 2_000) }));
    expect((await open({ sender: 1 })).status).toBe('opened');
    hash = 'someone-else';
    expect((await open({ sender: 1 })).status).toBe('opened');
    hash = 'abc';
    expect((await open({ sender: 1 })).status).toBe('opened');
    // built once, used once; after the change, in memory for the rest of the run (never built again)
    expect(run.mock.calls.map((c) => c[0])).toEqual([DRAWER_BUILD_SCRIPT, DRAWER_FAST_SCRIPT, DRAWER_SCRIPT, DRAWER_SCRIPT]);

    // the helper cannot be made (no folder, the compiler may not write): as before 2.0's fix, and tried once only
    const noBuild = vi.fn(async (script: string) => { if (script === DRAWER_BUILD_SCRIPT) throw new Error('Access is denied'); return 'opened'; });
    const plain = drawerHandler(deps({ run: noBuild, helperFile: () => 'h.dll', fileHash: () => 'abc', now: () => (t += 2_000) }));
    expect((await plain({ sender: 1 })).status).toBe('opened');
    expect((await plain({ sender: 1 })).status).toBe('opened');
    expect(noBuild.mock.calls.map((c) => c[0])).toEqual([DRAWER_BUILD_SCRIPT, DRAWER_SCRIPT, DRAWER_SCRIPT]);
    // the helper will not load: this kick still opens the drawer, in memory
    const noLoad = vi.fn(async (script: string) => { if (script === DRAWER_FAST_SCRIPT) throw new Error('could not load file or assembly'); return script === DRAWER_BUILD_SCRIPT ? 'ready' : 'opened'; });
    const second = drawerHandler(deps({ run: noLoad, helperFile: () => 'h.dll', fileHash: () => 'abc', now: () => (t += 2_000) }));
    expect((await second({ sender: 1 })).status).toBe('opened');
    expect(noLoad.mock.calls.map((c) => c[0])).toEqual([DRAWER_BUILD_SCRIPT, DRAWER_FAST_SCRIPT, DRAWER_SCRIPT]);
  });
  it('says when Windows blocks PowerShell, apart from a printer that did not answer', async () => {
    const policy = new Error('Add-Type : Cannot add type. Definition of new types is not supported in this language mode.');
    const blocked = drawerHandler(deps({ run: vi.fn(async () => { throw policy; }), helperFile: () => 'h.dll', fileHash: () => 'abc' }));
    expect(await blocked({ sender: 1 })).toEqual({ status: 'blocked' });
    expect(drawerBlocked(policy)).toBe(true);
    expect(drawerBlocked(new Error('This program is blocked by group policy. For more information, contact your system administrator.'))).toBe(true);
    expect(drawerBlocked(Object.assign(new Error('spawn powershell.exe ENOENT'), { code: 'ENOENT' }))).toBe(true);
    expect(drawerBlocked(Object.assign(new Error('failed'), { code: 'EPERM' }))).toBe(true);
    expect(drawerBlocked(new Error('timed out'))).toBe(false);
    expect(drawerBlocked(new Error('the cash drawer is opened on Windows only'))).toBe(false);
    expect(drawerBlocked(null)).toBe(false);
    // the scripts' own text never reads as a refusal (main.ts passes what PowerShell said, not the command)
    for (const script of [DRAWER_SCRIPT, DRAWER_BUILD_SCRIPT, DRAWER_FAST_SCRIPT]) expect(drawerBlocked(new Error(script))).toBe(false);
  });
  it('reads the receipt printer only', () => {
    expect(receiptPrinter(null)).toBeNull();
    expect(receiptPrinter('not json')).toBeNull();
    expect(receiptPrinter(file('XP-80'))).toBe('XP-80');
  });
});

describe('the customer screen', () => {
  it('goes full screen on a second screen, else none', () => {
    const one = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
    const two = { id: 2, bounds: { x: 1920, y: 0, width: 1024, height: 768 } };
    expect(customerScreenBounds([one, two], 1)).toEqual(two.bounds);
    expect(customerScreenBounds([one], 1)).toBeNull();
  });
  it('opens only the app page’s own route', () => {
    expect(customerDisplayUrl('http://127.0.0.1:4100')).toBe('http://127.0.0.1:4100/#/customer-display');
    expect(customerDisplayUrl('https://office.local:8443/x')).toBe('https://office.local:8443/#/customer-display');
  });
});
