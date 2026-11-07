import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { Bridge, BridgeError, type Carrier } from './bridge.ts';

const channels: MessageChannel[] = [];
/** Two bridges joined by a MessageChannel, as the main and server processes are by Electron. */
function pair(options: { timeoutMs?: number } = {}): [Bridge, Bridge] {
  const ch = new MessageChannel();
  channels.push(ch);
  const carrier = (port: MessageChannel['port1']): Carrier => ({ postMessage: (m) => port.postMessage(m), listen: (fn) => port.on('message', fn) });
  return [new Bridge(carrier(ch.port1), options), new Bridge(carrier(ch.port2), options)];
}
afterEach(() => { for (const ch of channels.splice(0)) { ch.port1.close(); ch.port2.close(); } });

describe('the bridge between the window process and the server process', () => {
  it('answers calls both ways, with any number of arguments, and async handlers', async () => {
    const [main, server] = pair();
    main.handle('add', ((a: number, b: number) => a + b) as never);
    server.handle('later', (async (x: string) => { await new Promise((r) => setTimeout(r, 5)); return `${x}!`; }) as never);
    expect(await server.call('add', [2, 3])).toBe(5);
    expect(await main.call('later', ['ok'])).toBe('ok!');
    // many at once come back to the right callers
    expect(await Promise.all([1, 2, 3].map((n) => server.call('add', [n, n])))).toEqual([2, 4, 6]);
  });

  it('passes errors back with their code; an unknown method says so', async () => {
    const [main, server] = pair();
    main.handle('fail', (() => { throw Object.assign(new Error('the disk is full'), { code: 'ENOSPC' }); }) as never);
    main.handle('plain', (() => { throw new Error('just wrong'); }) as never);
    await expect(server.call('fail')).rejects.toMatchObject({ name: 'BridgeError', code: 'ENOSPC', message: 'the disk is full' });
    await expect(server.call('plain')).rejects.toMatchObject({ code: 'error', message: 'just wrong' });
    await expect(server.call('nothing')).rejects.toMatchObject({ code: 'bridge_no_method' });
  });

  it('times out a call that gets no answer, unless asked to wait (a person picking a folder)', async () => {
    const [main, server] = pair({ timeoutMs: 30 });
    main.handle('slow', (() => new Promise((r) => setTimeout(() => r('done'), 80))) as never);
    await expect(server.call('slow')).rejects.toMatchObject({ code: 'bridge_timeout' });
    expect(await server.call('slow', [], { timeoutMs: 0 })).toBe('done');
  });

  it('fails waiting calls when the other process is gone, and refuses new ones', async () => {
    const [main, server] = pair();
    main.handle('never', (() => new Promise(() => {})) as never);
    const waiting = server.call('never', [], { timeoutMs: 0 });
    server.close();
    await expect(waiting).rejects.toBeInstanceOf(BridgeError);
    await expect(server.call('never')).rejects.toMatchObject({ code: 'bridge_closed' });
  });

  it('delivers events, and ignores messages that are not its own', async () => {
    const [main, server] = pair();
    const got: unknown[] = [];
    main.on('ready', (d) => got.push(d));
    server.emit('ready', { port: 47417 });
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toEqual([{ port: 47417 }]);
  });
});
