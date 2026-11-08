// The app.asar self-check is off in 1.0: one flag (INTEGRITY_CHECK in after-pack.cjs) keeps the build step from signing
// anything, and nothing in the app reads a signature.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const afterPack = require('../after-pack.cjs') as { default: (context: { appOutDir: string }) => Promise<void>; INTEGRITY_CHECK: boolean };
const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('the app.asar integrity check in 1.0', () => {
  let dir: string | null = null;
  afterEach(() => {
    vi.unstubAllEnvs();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('is switched off by its one flag', () => {
    expect(afterPack.INTEGRITY_CHECK).toBe(false);
  });

  it('does nothing in a build, even with the signing key set: no app.asar.sig is written', async () => {
    dir = mkdtempSync(join(tmpdir(), 'qasa-afterpack-'));
    mkdirSync(join(dir, 'resources'));
    writeFileSync(join(dir, 'resources', 'app.asar'), 'packed app');
    const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    vi.stubEnv('QASA_INTEGRITY_KEY', pem);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await afterPack.default({ appOutDir: dir });
    expect(existsSync(join(dir, 'resources', 'app.asar.sig'))).toBe(false);
    expect(readdirSync(join(dir, 'resources'))).toEqual(['app.asar']);
    expect(readFileSync(join(dir, 'resources', 'app.asar'), 'utf8')).toBe('packed app');
  });

  it('gives the release build no signing key while the check is off (least privilege)', () => {
    const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
    expect(workflow).not.toMatch(/QASA_INTEGRITY_KEY:\s*\$\{\{\s*secrets\./);
    expect(readFileSync(join(root, 'apps/desktop/electron-builder.yml'), 'utf8')).not.toMatch(/app\.asar signature they check/);
  });

  it('is checked nowhere in the app: no source outside the addon and its tests calls verifyIntegrity or reads app.asar.sig', () => {
    const found: string[] = [];
    const walk = (folder: string) => {
      for (const name of readdirSync(folder)) {
        if (['node_modules', 'dist', 'dist-demo', 'release', 'native-out', 'target'].includes(name)) continue;
        const path = join(folder, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx|cjs|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const text = readFileSync(path, 'utf8');
          if (/verifyIntegrity\(|app\.asar\.sig/.test(text)) found.push(path.slice(root.length).replace(/\\/g, '/'));
        }
      }
    };
    for (const folder of ['apps/desktop/src', 'apps/web/src', 'packages', 'pro/src']) if (existsSync(join(root, folder))) walk(join(root, folder));
    // the addon's type declaration names the function; nothing calls it
    expect(found.filter((f) => f !== 'packages/server/src/native-licence.ts')).toEqual([]);
    expect(readFileSync(join(root, 'packages/server/src/native-licence.ts'), 'utf8')).not.toMatch(/\.verifyIntegrity\(/);
  });
});
