import { MessageChannel } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Bridge, type Carrier } from './bridge.ts';
import { serve, stopServer } from './server-process.ts';

const dir = mkdtempSync(join(tmpdir(), 'qasa-server-process-'));
const ch = new MessageChannel();
afterAll(async () => {
  await stopServer();
  ch.port1.close();
  ch.port2.close();
  rmSync(dir, { recursive: true, force: true });
});

const carrier = (port: MessageChannel['port1']): Carrier => ({ postMessage: (m) => port.postMessage(m), listen: (fn) => port.on('message', fn) });

describe('the server process', () => {
  it('starts the API server on 127.0.0.1 when the main process asks, only for the window holding the session key, and stops', async () => {
    process.env.QASA_NO_PING = '1';
    serve(carrier(ch.port2));
    const main = new Bridge(carrier(ch.port1));
    const url = await main.call<string>('init', [{
      userDataDir: dir, documentsDir: dir, appVersion: '1.0.0-test', sessionKey: 'k'.repeat(64), secretsKey: null, resourcesPath: dir, fromStore: false
    }], { timeoutMs: 20_000 });
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const ok = await fetch(`${url}/api/health`, { headers: { cookie: `qasa_session=${'k'.repeat(64)}` } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-frame-options')).toBe('DENY');
    expect((await fetch(`${url}/api/health`)).status).toBe(403);
    await main.call('stop');
    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  }, 30_000);
});
