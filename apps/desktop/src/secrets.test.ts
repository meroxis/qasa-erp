import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeSecretBox } from './secrets.ts';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'qasa-secrets-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const KEY = randomBytes(32).toString('hex');

describe("the server process's secrets", () => {
  it('protects and reveals with its own key; another key or an edit is refused', () => {
    const box = makeSecretBox(KEY, tmp());
    const sealed = box.protect('backup password ١٢٣');
    expect(sealed).toMatch(/^q1:/);
    expect(sealed).not.toContain('backup');
    expect(box.reveal(sealed)).toBe('backup password ١٢٣');
    expect(() => makeSecretBox(randomBytes(32).toString('hex'), tmp()).reveal(sealed)).toThrow();
    const raw = Buffer.from(sealed.slice(3), 'base64');
    raw[20] = (raw[20] ?? 0) ^ 1;
    expect(() => box.reveal('q1:' + raw.toString('base64'))).toThrow();
  });

  it('without a key (Windows could not protect one) it refuses rather than keep a secret in the clear', () => {
    const box = makeSecretBox(null, tmp());
    expect(() => box.protect('x')).toThrow(/cannot protect/);
  });

  it("still opens what the main process saved before with Electron's safeStorage (Chromium's v10 format)", () => {
    const dir = tmp();
    // Chromium's key, wrapped with DPAPI in Local State ("DPAPI" + blob); the stand-in DPAPI just reverses bytes
    const chromium = randomBytes(32);
    const unprotect = (blob: Buffer) => Buffer.from([...blob].reverse());
    writeFileSync(join(dir, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), Buffer.from([...chromium].reverse())]).toString('base64') } }));
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', chromium, nonce);
    const body = Buffer.concat([cipher.update('old relay secret', 'utf8'), cipher.final()]);
    const legacy = Buffer.concat([Buffer.from('v10'), nonce, body, cipher.getAuthTag()]).toString('base64');
    const box = makeSecretBox(KEY, dir, { unprotect });
    expect(box.reveal(legacy)).toBe('old relay secret');
    // and plain DPAPI output (from before Chromium's key)
    expect(box.reveal(Buffer.from([...Buffer.from('dpapi only')].reverse()).toString('base64'))).toBe('dpapi only');
  });
});
