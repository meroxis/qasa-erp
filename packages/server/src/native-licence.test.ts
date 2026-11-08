import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadNative, nativeCandidates } from './native-licence.ts';

describe('where the licence addon is loaded from', () => {
  it('never takes QASA_NATIVE_LICENCE in the installed app, and never a script', () => {
    const resources = join('C:', 'Program Files', 'Qasa ERP', 'resources');
    // the installed app: only the addon next to app.asar (and the module's own folder)
    expect(nativeCandidates(join(tmpdir(), 'forged.node'), resources, [])).toEqual([join(resources, 'qasa_licence.node')]);
    // development: the variable may name a build, but only a .node file
    expect(nativeCandidates(join(tmpdir(), 'forged.js'), undefined, [])).toEqual([]);
    expect(nativeCandidates(join(tmpdir(), 'dev.node'), undefined, ['x'])).toEqual([join(tmpdir(), 'dev.node'), join('x', 'qasa_licence.node')]);
  });
});

// The addon is built with `node native/licence/build.mjs` (needs Rust); without it these tests are skipped.
const native = loadNative();
const d = native ? describe : describe.skip;

const b64url = (x: Buffer | string) => Buffer.from(x).toString('base64url');
const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { privateKey, x: publicKey.export({ format: 'jwk' }).x! };
};
const token = (tag: string, payload: object, privateKey: ReturnType<typeof pair>['privateKey']) => {
  const body = `${tag}.${b64url(JSON.stringify(payload))}`;
  return `${body}.${b64url(sign(null, Buffer.from(body), privateKey))}`;
};

d('the compiled licence checks (native/licence)', () => {
  it('has the same licence keys as license.ts', () => {
    const source = readFileSync(new URL('./license.ts', import.meta.url), 'utf8');
    const list = source.slice(source.indexOf('LICENSE_PUBLIC_KEYS'), source.indexOf('];', source.indexOf('LICENSE_PUBLIC_KEYS')));
    const keys = [...list.matchAll(/'([A-Za-z0-9_-]{43})'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect(native!.publicKeys()).toEqual(keys);
    // the portal signs activations; its key is one of the licence keys today
    for (const k of native!.activationKeys()) expect(keys).toContain(k);
  });

  it('checks Ed25519 signatures strictly with a given key', () => {
    const { privateKey, x } = pair();
    const message = Buffer.from('QASA1.e30');
    const signature = b64url(sign(null, message, privateKey));
    expect(native!.verifyEd25519(x, message, signature)).toBe(true);
    expect(native!.verifyEd25519(x, Buffer.from('QASA1.e31'), signature)).toBe(false);
    expect(native!.verifyEd25519(pair().x, message, signature)).toBe(false);
    expect(native!.verifyEd25519('not-a-key', message, signature)).toBe(false);
    expect(native!.verifyEd25519(x, message, 'AAAA')).toBe(false);
  });

  it('refuses licence keys and activations signed with any other key, edited ones and junk', () => {
    const { privateKey } = pair();
    const forged = token('QASA1', { v: 1, id: 'QL-0001', plan: 'business', to: 'Someone', issued: '2026-01-01', expires: null }, privateKey);
    expect(native!.verifyLicence(forged)).toBeNull();
    const [tag, , sig] = forged.split('.');
    expect(native!.verifyLicence(`${tag}.${b64url('{"plan":"business"}')}.${sig}`)).toBeNull();
    for (const junk of ['', 'QASA1', 'QASA1.e30', 'QASA1.e30.e30.e30', 'QASA2.e30.AAAA']) expect(native!.verifyLicence(junk)).toBeNull();
    const activation = token('QACT1', { machine: 'abc' }, privateKey);
    expect(native!.verifyActivation(activation, 'abc')).toBeNull();
  });

  it('gives this PC a stable 32-character ID per installation', () => {
    const a = native!.machineId('install-1');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(native!.machineId('install-1')).toBe(a);
    expect(native!.machineId('install-2')).not.toBe(a);
  });

  it('seals state so an edit is detected', () => {
    const sealed = native!.seal('{"trial":"2026-11-07","seen":"2026-11-07"}', 'qasa-trial');
    expect(native!.open(sealed, 'qasa-trial')).toBe('{"trial":"2026-11-07","seen":"2026-11-07"}');
    expect(native!.open(sealed, 'other-purpose')).toBeNull();
    const [, tag] = sealed.split('.');
    expect(native!.open(`${b64url('{"trial":"2030-01-01","seen":"2030-01-01"}')}.${tag}`, 'qasa-trial')).toBeNull();
    expect(native!.open('garbage', 'qasa-trial')).toBeNull();
  });

  it('hashes a file (the app.asar) with SHA-256', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-native-'));
    try {
      const file = join(dir, 'app.asar');
      writeFileSync(file, 'abc');
      expect(native!.integrity(file)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      expect(native!.integrity(join(dir, 'missing'))).toBeNull();
      // signed with a key the addon doesn't embed (or none embedded yet): never accepted
      const { privateKey } = pair();
      const sig = b64url(sign(null, Buffer.from(`QINT1.${native!.integrity(file)}`), privateKey));
      expect(native!.verifyIntegrity(file, sig)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
