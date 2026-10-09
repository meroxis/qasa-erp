// Builds the Windows app: the screens (apps/web) and one bundled main process (server included).
//   node build.mjs
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// Pro: the worker thread that holds the connection to a company database on a MariaDB/MySQL server.
if (withPro) {
  await build({
    configFile: false,
    root: here,
    logLevel: 'warn',
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: join(root, 'pro', 'src', 'mysql', 'worker.ts'),
      outDir: dist,
      emptyOutDir: false,
      target: 'node24',
      minify: false,
      sourcemap: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'db-worker.cjs' } }
    }
  });
}

// The windows' bridges (preloads): the app window's (its language) and the "Connect to an office server" window's,
// whose page (below) has one script, allowed by hash.
for (const preload of ['app-preload', 'connect-preload']) {
  await build({
    configFile: false,
    root: here,
    logLevel: 'warn',
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: join(here, 'src', `${preload}.ts`),
      outDir: dist,
      emptyOutDir: false,
      target: 'node24',
      minify: false,
      sourcemap: false,
      rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: `${preload}.cjs` } }
    }
  });
}
// The browser reads a page with CRLF as LF and hashes the script that way; a Windows checkout has CRLF, so the page
// is written with LF and hashed as the browser will see it.
const page = readFileSync(join(here, 'src', 'connect.html'), 'utf8').replace(/\r\n?/g, '\n');
const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1];
if (script === undefined) throw new Error('connect.html has no script');
writeFileSync(join(dist, 'connect.html'), page.replace('{{scriptHash}}', createHash('sha256').update(script).digest('base64')));

cpSync(join(root, 'apps', 'web', 'dist'), join(dist, 'web'), { recursive: true });
copyFileSync(join(here, 'build', 'icon.png'), join(dist, 'icon.png'));
console.log(`dist/ ready: main.cjs${withPro ? ', db-worker.cjs' : ''}, app-preload.cjs, connect-preload.cjs, connect.html, web/, icon.png`);
