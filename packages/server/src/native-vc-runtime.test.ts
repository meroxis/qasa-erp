import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script of the addon's build, with no types of its own
import { vcRuntimeNeeded } from '../../../native/licence/vc-runtime.mjs';

// (line ends as Linux has them: a Windows checkout, as the release build's, gives the files \r\n)
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const needed = vcRuntimeNeeded as (file: Buffer) => string[];

describe('the Windows licence addon needs no Visual C++ runtime (a new PC has none)', () => {
  it('finds the runtime files an addon asks Windows for, by the names in its import table', () => {
    // what the addon of 1.6.0 named: with it, a new PC loaded no addon, called every key "not valid" and the free month "ended"
    const old = Buffer.from('\0VCRUNTIME140.dll\0advapi32.dll\0api-ms-win-crt-heap-l1-1-0.dll\0api-ms-win-crt-runtime-l1-1-0.dll\0kernel32.dll\0ntdll.dll\0', 'latin1');
    expect(needed(old)).toEqual(['api-ms-win-crt-heap-l1-1-0.dll', 'api-ms-win-crt-runtime-l1-1-0.dll', 'vcruntime140.dll']);
    expect(needed(Buffer.from('\0MSVCP140.dll\0vcruntime140_1.dll\0', 'latin1'))).toEqual(['msvcp140.dll', 'vcruntime140_1.dll']);
    // Windows' own files are fine
    expect(needed(Buffer.from('\0advapi32.dll\0bcryptprimitives.dll\0kernel32.dll\0ntdll.dll\0', 'latin1'))).toEqual([]);
  });

  it('is built with the runtime inside it, and a Windows build that still names one stops', () => {
    const cargo = read('native/licence/.cargo/config.toml');
    for (const target of ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc']) {
      expect(cargo).toContain(`[target.${target}]\nrustflags = ["-C", "target-feature=+crt-static"]`);
    }
    const build = read('native/licence/build.mjs');
    expect(build).toContain("if (process.platform === 'win32') {");
    expect(build).toContain('const needs = vcRuntimeNeeded(readFileSync(from));');
    expect(build).toMatch(/if \(needs\.length\) throw new Error\(/);
    // nothing sets RUSTFLAGS over the config (the variable replaces the config's flags)
    expect(read('.github/workflows/release.yml')).not.toContain('RUSTFLAGS');
    expect(read('.github/workflows/tests.yml')).not.toContain('RUSTFLAGS');
  });

  it('is built and loaded on Windows by the tests of every pull request, the way the release builds it', () => {
    const tests = read('.github/workflows/tests.yml');
    const job = tests.slice(tests.indexOf('  licence-windows:'), tests.indexOf('  # The phone app'));
    expect(job).toContain('runs-on: windows-latest');
    expect(job).toContain('node native/licence/build.mjs');
    expect(job).toContain("require('./native/licence/dist/qasa_licence.node')");
    expect(job).toContain('persist-credentials: false');
    // and the app's tests run there too, as on release day (2.0.0-beta.3's run failed on a test only Windows failed)
    expect(job).toMatch(/- run: npm ci\n\s+- run: npm test\n/);
    expect(read('.github/workflows/release.yml')).toContain('node native/licence/build.mjs');
  });

  it('a copy whose compiled checks did not load says so, instead of calling the key wrong', () => {
    const license = read('packages/server/src/license.ts');
    expect(license).toContain("if (!info && licensingConfig().requireNative && !loadNative()) throw new AppError(409, 'license_module_missing');");
    expect(license.indexOf("'license_module_missing'")).toBeLessThan(license.indexOf("throw new AppError(400, 'license_invalid')"));
    const texts = read('apps/web/src/i18n.ts');
    const line = texts.split('\n').find((l) => l.includes('err_license_module_missing:')) ?? '';
    expect(line).toContain('The key is not the cause.');
    expect(line).toContain('المفتاح ليس السبب.');
    expect(line).toContain('کلیلەکە هۆکار نییە.');
    expect(line.match(/Microsoft Visual C\+\+ Redistributable \(x64\)/g)).toHaveLength(3);
  });
});
