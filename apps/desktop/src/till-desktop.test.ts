import { describe, expect, it, vi } from 'vitest';
import { customerDisplayUrl, customerScreenBounds, DRAWER_SCRIPT, drawerHandler, receiptPrinter } from './till-desktop.ts';

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
