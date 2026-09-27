// Builds the Windows app: the screens (apps/web) and one bundled main process (server included).
//   node build.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const dist = join(here, 'dist');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const web = spawnSync(npm, ['run', 'build', '-w', '@qasa/web'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (web.status !== 0) throw new Error('web build failed');

// The Pro module lives in a private repository, checked out at ../../pro for official builds only.
const proEntry = join(root, 'pro', 'src', 'index.ts');
const withPro = existsSync(proEntry);
console.log(withPro ? 'Pro module: included' : 'Pro module: not present (public build)');

rmSync(dist, { recursive: true, force: true });
await build({
  configFile: false,
  root: here,
  logLevel: 'warn',
  resolve: { alias: { '@qasa/pro-module': withPro ? proEntry : join(here, 'src', 'pro-none.ts') } },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: join(here, 'src', 'main.ts'),
    outDir: dist,
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: 'main.cjs' }
    }
  }
});

cpSync(join(root, 'apps', 'web', 'dist'), join(dist, 'web'), { recursive: true });
copyFileSync(join(here, 'build', 'icon.png'), join(dist, 'icon.png'));
console.log('dist/ ready: main.cjs, web/, icon.png');
