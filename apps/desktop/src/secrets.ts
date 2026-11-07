/**
 * Secrets the Pro module keeps for this Windows user (a backup password, a database server's password, cloud and
 * relay sign-ins, the phone link's key), in the server process. Electron's safeStorage (Windows DPAPI) only works in
 * the main process and the Pro module needs the answer at once, so the main process gives the server process one key
 * of its own, which it keeps protected with safeStorage (secret-key.bin in the app's data folder):
 *
 *   q1:<base64 of nonce (12) · AES-256-GCM ciphertext · tag (16)>
 *
 * Secrets saved before by the main process itself (safeStorage, base64) still open: Chromium's Windows format is
 * "v10" · nonce · ciphertext · tag under a key kept in the "Local State" file, protected with DPAPI, which is unwrapped
 * once (PowerShell's ProtectedData, for this Windows user) when the first such secret is read.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PREFIX = 'q1:';

export interface SecretBox {
  protect(plain: string): string;
  reveal(stored: string): string;
}

function seal(key: Buffer, plain: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64');
}

function open(key: Buffer, data: Buffer): string {
  if (data.length < 12 + 16) throw new Error('secret too short');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([decipher.update(data.subarray(12, data.length - 16)), decipher.final()]).toString('utf8');
}

/** Windows DPAPI for this user, through PowerShell (only for secrets from before the server process). */
function dpapiUnprotect(blob: Buffer): Buffer {
  if (process.platform !== 'win32') throw new Error('DPAPI is only on Windows');
  const script = 'Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd());'
    + "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))";
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: blob.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 15_000
  });
  return Buffer.from(out.trim(), 'base64');
}

export function makeSecretBox(keyHex: string | null, userDataDir: string, deps: { unprotect?: (blob: Buffer) => Buffer } = {}): SecretBox {
  const key = keyHex && /^[0-9a-f]{64}$/.test(keyHex) ? Buffer.from(keyHex, 'hex') : null;
  const unprotect = deps.unprotect ?? dpapiUnprotect;
  let legacyKey: Buffer | null = null;

  function chromiumKey(): Buffer {
    if (legacyKey) return legacyKey;
    const state = JSON.parse(readFileSync(join(userDataDir, 'Local State'), 'utf8')) as { os_crypt?: { encrypted_key?: string } };
    const wrapped = Buffer.from(state.os_crypt?.encrypted_key ?? '', 'base64');
    if (wrapped.subarray(0, 5).toString('latin1') !== 'DPAPI') throw new Error('no protected key in Local State');
    legacyKey = unprotect(wrapped.subarray(5));
    return legacyKey;
  }

  return {
    protect(plain) {
      if (!key) throw new Error('Windows cannot protect secrets here');
      return seal(key, plain);
    },
    reveal(stored) {
      if (stored.startsWith(PREFIX)) {
        if (!key) throw new Error('Windows cannot protect secrets here');
        return open(key, Buffer.from(stored.slice(PREFIX.length), 'base64'));
      }
      // from before: safeStorage's own output, base64
      const data = Buffer.from(stored, 'base64');
      if (data.subarray(0, 3).toString('latin1') === 'v10') return open(chromiumKey(), data.subarray(3));
      return unprotect(data).toString('utf8');
    }
  };
}

export { seal as sealForTests };
