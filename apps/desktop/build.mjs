// Builds the Windows app: the screens (apps/web), the main process and the server process.
//   node build.mjs
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { cloudIds } from './cloud-ids.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const dist = join(here, 'dist');

/**
 * npm's own script (npm-cli.js), run by this Node with no shell: arguments are never joined into a shell command line
 * (Node's DEP0190), and no npm.cmd is needed on Windows. npm_execpath is set when this runs from an npm script.
 */
function npmCli() {
  const nodeDir = dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ];
  const found = candidates.find((p) => p && /[\\/]npm-cli\.js$/.test(p) && existsSync(p));
  if (!found) throw new Error(`npm-cli.js not found next to Node (${process.execPath}); install npm with Node`);
  return found;
}

const web = spawnSync(process.execPath, [npmCli(), 'run', 'build', '-w', '@qasa/web'], { cwd: root, stdio: 'inherit', shell: false });
if (web.error) throw web.error;
if (web.status !== 0) throw new Error('web build failed');

// The Pro module lives in a private repository, checked out at ../../pro for official builds only.
const proEntry = join(root, 'pro', 'src', 'index.ts');
const withPro = existsSync(proEntry);
console.log(withPro ? 'Pro module: included' : 'Pro module: not present (public build)');

rmSync(dist, { recursive: true, force: true });

const defines = {
  // Pro cloud backup: the OAuth client IDs of the Google and Microsoft apps (from the release's secrets; empty in other
  // builds, which then say "Not available in this build"). Google's desktop "secret" ships in every copy by design.
  // (cleaned of invisible characters such as a byte order mark, and checked: see cloud-ids.mjs)
  __QASA_CLOUD_IDS__: JSON.stringify(cloudIds()),
  // Qasa Relay (the office network over the internet); empty means the default, https://relay.qasaerp.com
  __QASA_RELAY_URL__: JSON.stringify(process.env.QASA_RELAY_URL ?? '')
};

/**
 * Two processes, one bundle each: main.cjs (Electron's main process: windows, menus, dialogs, updates) and
 * server-process.cjs (a utilityProcess: the API server, the company database and the Pro module), so heavy work never
 * freezes the window.
 */
for (const [entry, out] of [['main.ts', 'main.cjs'], ['server-process.ts', 'server-process.cjs']]) {
  await build({
    configFile: false,
    root: here,
    logLevel: 'warn',
    resolve: { alias: { '@qasa/pro-module': withPro ? proEntry : join(here, 'src', 'pro-none.ts') } },
    ssr: { noExternal: true, target: 'node' },
    define: defines,
    build: {
      ssr: join(here, 'src', entry),
      outDir: dist,
      emptyOutDir: false,
      target: 'node24',
      minify: false,
      sourcemap: false,
      rollupOptions: {
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: out }
      }
    }
  });
}

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

// The windows' bridges (preloads): the app window's (its language), the "Connect to an office server" window's and
// the "Reset admin password" window's, whose pages (below) each have one script, allowed by hash.
for (const preload of ['app-preload', 'connect-preload', 'recover-preload']) {
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
// (the same for the "Reset admin password" window's page)
for (const name of ['connect.html', 'recover.html']) {
  const page = readFileSync(join(here, 'src', name), 'utf8').replace(/\r\n?/g, '\n');
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1];
  if (script === undefined) throw new Error(`${name} has no script`);
  writeFileSync(join(dist, name), page.replace('{{scriptHash}}', createHash('sha256').update(script).digest('base64')));
}

cpSync(join(root, 'apps', 'web', 'dist'), join(dist, 'web'), { recursive: true });
copyFileSync(join(here, 'build', 'icon.png'), join(dist, 'icon.png'));

// The compiled licence checks (native/licence, Rust): built beforehand with `node native/licence/build.mjs`, shipped
// next to app.asar (electron-builder extraResources from native-out/) where packages/server/src/native-licence.ts
// finds it. A build without it (public source, no Rust) still works; callers decide what a missing addon means.
const nativeOut = join(here, 'native-out');
rmSync(nativeOut, { recursive: true, force: true });
mkdirSync(nativeOut, { recursive: true });
const addon = join(root, 'native', 'licence', 'dist', 'qasa_licence.node');
const withNative = existsSync(addon);
if (withNative) copyFileSync(addon, join(nativeOut, 'qasa_licence.node'));
console.log(withNative ? 'Licence addon: included' : 'Licence addon: not built (node native/licence/build.mjs)');
console.log(`dist/ ready: main.cjs, server-process.cjs${withPro ? ', db-worker.cjs' : ''}, app-preload.cjs, connect-preload.cjs, recover-preload.cjs, connect.html, recover.html, web/, icon.png`);
