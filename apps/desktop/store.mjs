// Builds the Microsoft Store package (MSIX, not signed: the Store signs it when it accepts it) from dist/:
//   node build.mjs && node store.mjs
// makeappx comes from the installed Windows SDK: the copies bundled with electron-builder don't start on current Windows
// (their side-by-side manifests are incomplete).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
const versions = existsSync(bin) ? readdirSync(bin).filter((v) => /^10\.\d+\.\d+\.\d+$/.test(v) && existsSync(join(bin, v, 'x64', 'makeappx.exe'))) : [];
versions.sort((a, b) => a.split('.').map(Number).reduce((r, n, i) => r || n - Number(b.split('.')[i]), 0));
const kit = versions.length ? join(bin, versions[versions.length - 1], 'x64') : null;
if (!kit) throw new Error('The Windows SDK (makeappx.exe) is needed for the Store package: install it with Visual Studio Installer or winget install Microsoft.WindowsSDK.10.0.26100');
console.log(`Windows SDK tools: ${kit}`);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = spawnSync(npx, ['electron-builder', '--win', 'appx', '--publish', 'never'], {
  cwd: here, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ELECTRON_BUILDER_WINDOWS_KITS_PATH: kit }
});
process.exit(run.status ?? 1);
