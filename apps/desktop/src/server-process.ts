/**
 * The server process: Qasa ERP's API server, the company database and the Pro module, in an Electron utilityProcess
 * of its own. Heavy work (a big report, an import, a backup, the year-end) runs here, so the window (the main
 * process) never stops answering. The main process starts it (main.ts), asks it to start the server ('init'), and
 * answers what only it can do: dialogs, pickers, restarting the app (bridge.ts).
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, configureLicensing, openDatabase, startUsagePings, type Db } from '@qasa/server';
import { Bridge, type Carrier } from './bridge.ts';
import { makeSecretBox, type SecretBox } from './secrets.ts';
import type { DatabaseStartContext, ProContext, RestartOptions } from './pro-types.ts';
// the official builds include the Pro module; public builds get pro-none.ts (see build.mjs)
import { proModule } from '@qasa/pro-module';

/** What the main process tells the server process at the start. */
export interface ServerInit {
  userDataDir: string;
  documentsDir: string;
  appVersion: string;
  /** The key the window's cookie holds: only that window may use this server. */
  sessionKey: string;
  /** The key of the server process's secrets (secrets.ts), or null when Windows can't protect one. */
  secretsKey: string | null;
  /** Where the licence addon is (resources\qasa_licence.node in the installed app). */
  resourcesPath: string;
  fromStore: boolean;
}

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer'
};

const WEB_DIR = join(__dirname, 'web');
const DEFAULT_PORT = 47417;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm'
};
/** Only plain file names of the data folder (the Pro module names them). */
const SAFE_NAME = /^qasa-[\w.-]{1,80}\.sqlite$/;

let init: ServerInit | null = null;
let secrets: SecretBox | null = null;
let server: FastifyInstance | null = null;
let db: Db | null = null;
let pings: { stop(): void } | null = null;
let stopping: Promise<void> | null = null;

const cfg = (): ServerInit => {
  if (!init) throw new Error('the server process has not been started');
  return init;
};
const dataDir = () => join(cfg().userDataDir, 'data');

/** %APPDATA%\Qasa ERP\logs\server.log (main.log is the window process's). */
export function log(...parts: unknown[]): void {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack ?? p.message : String(p))).join(' ')}`;
  try { console.log(line); } catch { /* no console in the installed app */ }
  if (!init) return;
  try {
    const dir = join(init.userDataDir, 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'server.log'), line + '\n');
  } catch { /* logging must never stop the server */ }
}

// ——— the port (the same per installation, so the window keeps its saved settings) ———

const portFile = () => join(cfg().userDataDir, 'port.json');

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

async function choosePort(): Promise<number> {
  let saved = DEFAULT_PORT;
  try { saved = Number(JSON.parse(readFileSync(portFile(), 'utf8')).port) || DEFAULT_PORT; } catch { /* first run */ }
  if (await isFree(saved)) return saved;
  for (let port = 47418; port < 47500; port += 1) {
    if (await isFree(port)) {
      try { writeFileSync(portFile(), JSON.stringify({ port })); } catch { /* keep going */ }
      return port;
    }
  }
  return 0;
}

// ——— company files ———

const protectSecret = (plain: string) => secrets!.protect(plain);
const revealSecret = (stored: string) => secrets!.reveal(stored);

/**
 * The database worker for a company database on a server (built into dist/ with Pro). It runs from its text: a
 * worker thread can't load its script from inside the app's package, but reading the text works.
 */
function workerSource(): { code: string } {
  return { code: readFileSync(join(__dirname, 'db-worker.cjs'), 'utf8') };
}

function startContext(): DatabaseStartContext {
  return { userDataDir: cfg().userDataDir, dataDir: dataDir(), get workerSource() { return workerSource(); }, revealSecret, log };
}

const stampNow = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/** Moves a company file (with SQLite's -wal and -shm files) to another name. */
function moveCompanyFile(from: string, to: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(from + suffix)) renameSync(from + suffix, to + suffix);
  }
}

/** Makes a file of the data folder the company file; a company file already there is kept aside, never deleted. */
function placeCompanyFile(name: string): void {
  if (!SAFE_NAME.test(name)) throw new Error(`not a company file name: ${name}`);
  const live = join(dataDir(), 'qasa.sqlite');
  if (existsSync(live)) moveCompanyFile(live, join(dataDir(), `qasa-before-${stampNow()}.sqlite`));
  moveCompanyFile(join(dataDir(), name), live);
}

/**
 * The company database: the company file, or (Pro) the company's MariaDB/MySQL server. When the server can't be
 * used, the main process asks the admin: try again, go back to the company file kept aside, or quit (it then ends the
 * app, this process included).
 */
async function openCompanyDatabase(bridge: Bridge): Promise<Db> {
  const file = join(dataDir(), 'qasa.sqlite');
  for (;;) {
    try {
      return proModule?.openDatabase?.(startContext()) ?? openDatabase(file);
    } catch (error) {
      const problem = error as { code?: string; host?: string; database?: string; localCopy?: { file: string; since: string } | null; details?: unknown };
      if (problem.code === 'database_newer') {
        // the main process says so and quits: this waits for the end
        await bridge.call('newerBooks', [problem.details ?? null], { timeoutMs: 0 });
        return new Promise<never>(() => {});
      }
      if (!proModule?.openDatabase || typeof problem.host !== 'string') throw error;
      const choice = await bridge.call<'retry' | 'local' | 'quit'>('dbProblem', [{
        code: problem.code ?? '', host: problem.host, database: problem.database ?? '', localCopy: problem.localCopy ?? null
      }], { timeoutMs: 0 });
      if (choice === 'local' && problem.localCopy) {
        const name = proModule.useLocalCopyInstead?.(startContext());
        if (name) placeCompanyFile(name);
      } else if (choice === 'quit') {
        return new Promise<never>(() => {});
      }
    }
  }
}

/** The app's screens come from the same server as the API, so /api is same-origin (here and on the office network). */
function serveWeb(target: FastifyInstance): void {
  target.setNotFoundHandler((req, reply) => {
    const path = decodeURIComponent((req.url.split('?')[0] ?? '/'));
    if (req.method !== 'GET' || path.startsWith('/api/')) return reply.status(404).send({ error: 'not_found', details: null });
    const file = normalize(join(WEB_DIR, path === '/' ? 'index.html' : path));
    const safe = file.startsWith(WEB_DIR + sep) || file === join(WEB_DIR, 'index.html');
    let target = join(WEB_DIR, 'index.html');
    try {
      if (safe && statSync(file).isFile()) target = file;
    } catch { /* unknown path: the app's own router handles it */ }
    return reply
      .header('content-type', TYPES[extname(target)] ?? 'application/octet-stream')
      .header('cache-control', target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable')
      .send(readFileSync(target));
  });
}

/** Closes everything (the Pro module, the server, the database). Safe to call more than once. */
export function stopServer(): Promise<void> {
  stopping ??= (async () => {
    pings?.stop();
    try { await proModule?.stop?.(); } catch { /* stopping anyway */ }
    try { await server?.close(); } catch { /* already closed */ }
    try { db?.close(); } catch { /* already closed */ }
    server = null;
    db = null;
    pings = null;
  })();
  return stopping;
}

async function startServer(bridge: Bridge, given: ServerInit): Promise<string> {
  init = given;
  secrets = makeSecretBox(given.secretsKey, given.userDataDir);
  // the licence addon (Rust) sits next to app.asar; tell native-licence.ts where, whatever this process knows itself
  const addon = join(given.resourcesPath, 'qasa_licence.node');
  if (!process.env.QASA_NATIVE_LICENCE && existsSync(addon)) process.env.QASA_NATIVE_LICENCE = addon;
  mkdirSync(dataDir(), { recursive: true });
  db = await openCompanyDatabase(bridge);
  // paid plans need an activation for this PC (online once, then a check every few weeks); official builds (with the
  // Pro module) also check every licence in the Rust module shipped beside app.asar
  configureLicensing({ strict: true, dataDir: given.userDataDir, requireNative: !!proModule });
  // the anonymous daily usage ping (Settings → Anonymous usage statistics; can be switched off)
  pings = startUsagePings(db, { dataDir: given.userDataDir, version: given.appVersion, os: process.platform === 'win32' ? 'windows' : process.platform });
  server = buildApp(db, { extensions: proModule?.apiExtensions ?? [] });

  server.addHook('onRequest', async (req, reply) => {
    const cookies = (req.headers.cookie ?? '').split(';').map((c) => c.trim());
    if (!cookies.includes(`qasa_session=${given.sessionKey}`)) return reply.status(403).send({ error: 'forbidden', details: null });
  });
  server.addHook('onSend', async (_req, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
  });
  serveWeb(server);

  /** Restarts the app, moving company files as the Pro module asks (moving to a database server and back). */
  const restart = async (options: RestartOptions = {}): Promise<void> => {
    await stopServer();
    const live = join(dataDir(), 'qasa.sqlite');
    if (options.setAsideCompanyFile && SAFE_NAME.test(options.setAsideCompanyFile)) moveCompanyFile(live, join(dataDir(), options.setAsideCompanyFile));
    if (options.useCompanyFile) placeCompanyFile(options.useCompanyFile);
    await bridge.call('relaunch', [], { timeoutMs: 0 });
  };
  /**
   * Puts a (checked) backup in place of the company file and restarts. Nothing is deleted: the current file, with
   * its write-ahead log, is kept in the data folder as qasa-before-restore-<time>.sqlite.
   */
  const restoreDatabase = async (file: string): Promise<void> => {
    const live = join(dataDir(), 'qasa.sqlite');
    log('restoring the company file from', file);
    await stopServer();
    moveCompanyFile(live, join(dataDir(), `qasa-before-restore-${stampNow()}.sqlite`));
    copyFileSync(file, live);
    await bridge.call('relaunch', [], { timeoutMs: 0 });
  };

  // the Pro module adds its routes now: a server takes no more once it listens
  const ctx: ProContext = {
    db, server, userDataDir: given.userDataDir, dataDir: dataDir(), appVersion: given.appVersion, serveWeb, securityHeaders: SECURITY_HEADERS, log,
    documentsDir: given.documentsDir,
    get workerSource() { return workerSource(); },
    restart,
    // a person picks: no timeout
    chooseFolder: () => bridge.call<string | null>('chooseFolder', [], { timeoutMs: 0 }),
    chooseBackupFile: () => bridge.call<string | null>('chooseBackupFile', [], { timeoutMs: 0 }),
    restoreDatabase,
    protectSecret,
    revealSecret
  };
  if (proModule) {
    log(`${proModule.name} ${proModule.version}`);
    try {
      proModule.register?.(ctx);
    } catch (error) {
      log('Pro module could not register:', error);
    }
  }

  await server.listen({ host: '127.0.0.1', port: await choosePort() });
  const address = server.server.address();
  if (!address || typeof address === 'string') throw new Error('The local server has no port');
  if (proModule) {
    try {
      await proModule.start?.(ctx);
    } catch (error) {
      log('Pro module did not start:', error);
    }
  }
  const url = `http://127.0.0.1:${address.port}`;
  log(`server ${given.appVersion}${given.fromStore ? ' (Microsoft Store)' : ''} on ${url}, data in ${dataDir()}`);
  return url;
}

/** Wires a bridge to this process's own handlers: 'init' starts the server, 'stop' closes everything. */
export function serve(carrier: Carrier): Bridge {
  const bridge = new Bridge(carrier);
  bridge.handle('init', ((given: ServerInit) => startServer(bridge, given)) as never);
  bridge.handle('stop', (() => stopServer()) as never);
  return bridge;
}

// In the utilityProcess: the main process's messages come through process.parentPort.
const parentPort = (process as unknown as { parentPort?: { postMessage(m: unknown): void; on(e: 'message', l: (e: { data: unknown }) => void): void } }).parentPort;
if (parentPort) {
  process.on('uncaughtException', (error) => log('uncaught exception:', error));
  process.on('unhandledRejection', (error) => log('unhandled rejection:', error));
  serve({ postMessage: (m) => parentPort.postMessage(m), listen: (fn) => parentPort.on('message', (e) => fn(e.data)) });
}
