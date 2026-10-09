/**
 * Qasa ERP for Windows. The accounting server (the same one the office edition runs) starts inside the app on
 * 127.0.0.1, the window shows the app from it, and the company file lives in the user's profile:
 *   %APPDATA%\Qasa ERP\data\qasa.sqlite
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, session, shell, type MenuItemConstructorOptions } from 'electron';
import electronUpdater from 'electron-updater';
import { randomBytes } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, openDatabase, type Db } from '@qasa/server';
import { isLang, text, type Lang, type TextKey } from './texts.ts';
import type { DatabaseStartContext, ProContext, RestartOptions } from './pro-types.ts';
import { pair, parseAddress, pemFingerprint, type PairResult, type Remote } from './office.ts';
// the official builds include the Pro module; public builds get pro-none.ts (see build.mjs)
import { proModule } from '@qasa/pro-module';

const { autoUpdater } = electronUpdater;
/** Installed from the Microsoft Store: the Store signs and updates it, so the app's own updater stays off. */
const FROM_STORE = process.windowsStore === true;
const STORE_PAGE = 'ms-windows-store://pdp/?productid=9NRTX5BBK9DW';
const WEB_DIR = join(__dirname, 'web');
const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;
const DEFAULT_PORT = 47417;
/** A new secret each launch. Only this app's window holds it (as a cookie), so other programs and other Windows users can't use the local server. */
const SESSION_KEY = randomBytes(32).toString('hex');
const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer'
};

let win: BrowserWindow | null = null;
let server: FastifyInstance | null = null;
let db: Db | null = null;
let lang: Lang = 'ar';
let manualCheck = false;

const t = (key: TextKey, vars?: Record<string, string>) => text(lang, key, vars);

/** A plain log for support: %APPDATA%\Qasa ERP\logs\main.log */
let logFallback: string | null = null;
function log(...parts: unknown[]): void {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack ?? p.message : String(p))).join(' ')}`;
  try { console.log(line); } catch { /* no console in the installed app */ }
  try {
    const dir = join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    if (!logFallback) {
      try {
        appendFileSync(join(dir, 'main.log'), line + '\n');
        return;
      } catch (error) {
        // main.log can't be written: a dated file next to it, which says why once
        logFallback = join(dir, `main-${new Date().toISOString().slice(0, 10)}.log`);
        appendFileSync(logFallback, `${new Date().toISOString()} main.log could not be written: ${(error as NodeJS.ErrnoException).code ?? String(error)}\n`);
      }
    }
    appendFileSync(logFallback, line + '\n');
  } catch { /* logging must never stop the app */ }
}
process.on('uncaughtException', (error) => log('uncaught exception:', error));
process.on('unhandledRejection', (error) => log('unhandled rejection:', error));

// ——— the local server ———

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm'
};

/** The port stays the same per installation, so the window keeps its saved settings (they belong to the address). */
function portFile(): string {
  return join(app.getPath('userData'), 'port.json');
}

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

const dataDir = () => join(app.getPath('userData'), 'data');

// DPAPI: only this Windows user on this PC can read it back
function protectSecret(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows cannot protect secrets here');
  return safeStorage.encryptString(plain).toString('base64');
}
const revealSecret = (stored: string) => safeStorage.decryptString(Buffer.from(stored, 'base64'));

/**
 * The database worker for a company database on a server (built into dist/ with Pro). It runs from its text: a
 * worker thread can't load its script from inside the app's package, but reading the text works.
 */
function workerSource(): { code: string } {
  return { code: readFileSync(join(__dirname, 'db-worker.cjs'), 'utf8') };
}

function startContext(): DatabaseStartContext {
  return { userDataDir: app.getPath('userData'), dataDir: dataDir(), get workerSource() { return workerSource(); }, revealSecret, log };
}

const stampNow = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
/** Only plain file names of the data folder (the Pro module names them). */
const SAFE_NAME = /^qasa-[\w.-]{1,80}\.sqlite$/;

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

/** The reason a server database didn't open, in words for the dialog. */
function databaseReason(code: string): string {
  if (/^(ECONN|ETIMEDOUT|EHOST|ENET|ENOTFOUND|EAI_AGAIN|EPIPE|PROTOCOL_|database_timeout|database_worker_failed|ER_SERVER_SHUTDOWN|ER_CON_COUNT|ER_TOO_MANY|ER_NET_)/.test(code)) return t('dbWhyUnavailable');
  if (/^(ER_ACCESS_DENIED|ER_DBACCESS_DENIED|ER_BAD_DB|ER_HOST_NOT_PRIVILEGED|ER_HOST_IS_BLOCKED)/.test(code)) return t('dbWhyLogin');
  if (code === 'database_in_use') return t('dbWhyInUse');
  if (/CERT|SSL|TLS|SIGNATURE|LEAF/.test(code)) return t('dbWhyCertificate');
  if (code === 'password_unreadable') return t('dbWhyPassword');
  if (code === 'config_unreadable') return t('dbWhyConfig');
  return t('dbWhyOther', { code });
}

/**
 * The company database: the company file, or (Pro) the company's MariaDB/MySQL server. When the server can't be
 * used, the admin can try again, quit, or go back to the company file kept aside when the company moved.
 */
async function openCompanyDatabase(): Promise<Db> {
  const file = join(dataDir(), 'qasa.sqlite');
  for (;;) {
    try {
      return proModule?.openDatabase?.(startContext()) ?? openDatabase(file);
    } catch (error) {
      const problem = error as { code?: string; host?: string; database?: string; localCopy?: { file: string; since: string } | null };
      if (problem.code === 'database_newer') return refuseNewerBooks(error);
      if (!proModule?.openDatabase || typeof problem.host !== 'string') throw error;
      const buttons = [t('tryAgain'), ...(problem.localCopy ? [t('dbUseLocalCopy')] : []), t('quit')];
      const { response } = await dialog.showMessageBox({
        type: 'warning', title: 'Qasa ERP', message: t('dbServerProblem', { host: problem.host, database: problem.database ?? '' }),
        detail: databaseReason(problem.code ?? ''), buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true
      });
      if (response === 0) continue;
      if (problem.localCopy && response === 1) {
        const sure = await dialog.showMessageBox({
          type: 'warning', title: 'Qasa ERP', message: t('dbLocalCopyConfirm', { date: problem.localCopy.since.slice(0, 10) }),
          buttons: [t('dbUseLocalCopy'), t('cancel')], defaultId: 1, cancelId: 1, noLink: true
        });
        if (sure.response !== 0) continue;
        const name = proModule.useLocalCopyInstead?.(startContext());
        if (name) placeCompanyFile(name);
        continue;
      }
      app.exit(0);
      throw new Quitting();
    }
  }
}

/** Thrown after app.exit() from a start dialog, so the start stops without an error box. */
class Quitting extends Error {}

/**
 * Windows draws message boxes left to right. Each Arabic or Kurdish line is embedded right to left, so a Latin word in
 * it (ERP, qasaerp.com, a version number) keeps its place in the sentence.
 */
const rtlLines = (s: string): string => (lang === 'en' ? s : s.split('\n').map((line) => `\u202B${line}\u202C`).join('\n'));

/**
 * Books from a newer Qasa ERP (the company file, or the company database on a server): this version leaves them as
 * they are, says so, and offers the way to the latest version — the Store page for the Store version, the website
 * for the installer. It never returns: the app quits.
 */
async function refuseNewerBooks(error: unknown): Promise<never> {
  log('the company books come from a newer Qasa ERP:', JSON.stringify((error as { details?: unknown }).details ?? null),
    'this is', app.getVersion(), FROM_STORE ? '(Microsoft Store)' : '');
  const buttons = [t('getLatest'), t('quit')];
  const { response } = await dialog.showMessageBox({
    type: 'warning', title: 'Qasa ERP', message: rtlLines(t('newerBooks', { v: app.getVersion() })),
    detail: rtlLines(t(FROM_STORE ? 'newerFromStore' : 'newerFromSite')), buttons, defaultId: 0, cancelId: 1, noLink: true
  });
  if (response === 0) {
    const url = FROM_STORE ? STORE_PAGE : `https://qasaerp.com${{ ar: '/', en: '/en/', ku: '/ku/' }[lang]}#download`;
    await shell.openExternal(url).catch((e: unknown) => log('could not open', url, e));
  }
  app.exit(0);
  throw new Quitting();
}

/** Restarts the app, moving company files as the Pro module asks (moving to a database server and back). */
async function restartWith(options: RestartOptions = {}): Promise<void> {
  await stopServer();
  const live = join(dataDir(), 'qasa.sqlite');
  if (options.setAsideCompanyFile && SAFE_NAME.test(options.setAsideCompanyFile)) moveCompanyFile(live, join(dataDir(), options.setAsideCompanyFile));
  if (options.useCompanyFile) placeCompanyFile(options.useCompanyFile);
  app.relaunch();
  app.exit(0);
}

async function startServer(): Promise<string> {
  mkdirSync(dataDir(), { recursive: true });
  db = await openCompanyDatabase();
  server = buildApp(db, { extensions: proModule?.apiExtensions ?? [] });

  server.addHook('onRequest', async (req, reply) => {
    const cookies = (req.headers.cookie ?? '').split(';').map((c) => c.trim());
    if (!cookies.includes(`qasa_session=${SESSION_KEY}`)) return reply.status(403).send({ error: 'forbidden', details: null });
  });
  server.addHook('onSend', async (_req, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
  });
  serveWeb(server);

  // the Pro module adds its routes now: a server takes no more once it listens
  const ctx: ProContext = {
    db, server, userDataDir: app.getPath('userData'), dataDir: dataDir(), appVersion: app.getVersion(), serveWeb, securityHeaders: SECURITY_HEADERS, log,
    documentsDir: app.getPath('documents'),
    get workerSource() { return workerSource(); },
    restart: restartWith,
    chooseFolder: async () => {
      const options = { title: t('backupFolder'), properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
      const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
    chooseBackupFile: async () => {
      const options = { title: t('restoreFile'), properties: ['openFile'] as 'openFile'[], filters: [{ name: 'Qasa ERP', extensions: ['qbak', 'sqlite'] }] };
      const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
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
  return `http://127.0.0.1:${address.port}`;
}

/**
 * Puts a (checked) backup in place of the company file and restarts. Nothing is deleted: the current file, with its
 * write-ahead log, is kept in the data folder as qasa-before-restore-<time>.sqlite.
 */
async function restoreDatabase(file: string): Promise<void> {
  const live = join(dataDir(), 'qasa.sqlite');
  log('restoring the company file from', file);
  await stopServer();
  moveCompanyFile(live, join(dataDir(), `qasa-before-restore-${stampNow()}.sqlite`));
  copyFileSync(file, live);
  app.relaunch();
  app.exit(0);
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

async function stopServer(): Promise<void> {
  try { await proModule?.stop?.(); } catch { /* stopping anyway */ }
  try { await server?.close(); } catch { /* already closed */ }
  try { db?.close(); } catch { /* already closed */ }
  server = null;
  db = null;
}

// ——— the office network: this PC works on another PC's company file ———

/** The office server this PC uses instead of its own company file, pinned to its certificate. */
let remote: Remote | null = null;
let connectWin: BrowserWindow | null = null;

function networkFile(): string {
  return join(app.getPath('userData'), 'network.json');
}

function readRemote(): Remote | null {
  try {
    const r = JSON.parse(readFileSync(networkFile(), 'utf8')) as Record<string, unknown>;
    if (r.mode === 'remote' && typeof r.host === 'string' && parseAddress(r.host) && Number.isInteger(r.port) && typeof r.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(r.fingerprint)) {
      return { host: r.host, port: r.port as number, fingerprint: r.fingerprint };
    }
  } catch { /* no file: this PC works on its own company file */ }
  return null;
}

function saveRemote(next: Remote | null): void {
  writeFileSync(networkFile(), JSON.stringify(next ? { mode: 'remote', ...next } : { mode: 'local' }));
}

/** The window accepts the office server only with exactly the certificate it was paired with. */
function pinCertificate(target: Remote): void {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.hostname !== target.host) return callback(-3); // anything else: Chromium's own checks
    callback(pemFingerprint(request.certificate.data) === target.fingerprint ? 0 : -2);
  });
}

/** Pairing (office.ts), then this PC remembers the server and restarts on it. */
async function pairAndSave(address: string, code: string): Promise<PairResult> {
  const result = await pair(address, code);
  if ('ok' in result) {
    saveRemote(result.remote);
    log(`paired with the office server ${result.remote.host}:${result.remote.port}`);
  }
  return result;
}

/** Restarts the app, on the office server or on this PC's own company file. */
async function restartApp(): Promise<void> {
  await stopServer();
  app.relaunch();
  app.exit(0);
}

function openConnectWindow(): void {
  if (connectWin) return void connectWin.focus();
  connectWin = new BrowserWindow({
    width: 480, height: 560, resizable: false, minimizable: false, maximizable: false, parent: win ?? undefined, modal: !!win,
    title: t('connect'), backgroundColor: '#F4F6FA', autoHideMenuBar: true, icon: join(__dirname, 'icon.png'),
    webPreferences: { preload: join(__dirname, 'connect-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
  });
  connectWin.setMenu(null);
  connectWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  connectWin.webContents.on('will-navigate', (event) => event.preventDefault());
  connectWin.on('closed', () => { connectWin = null; });
  void connectWin.loadURL(`${APP_SCHEME}://connect/connect.html?lang=${lang}`).catch((error) => log('connect window did not load:', error));
}

ipcMain.handle('network:pair', async (event, address: unknown, code: unknown) => {
  if (!connectWin || event.sender !== connectWin.webContents) return { error: 'address' };
  const result = await pairAndSave(String(address ?? ''), String(code ?? ''));
  if ('ok' in result) setTimeout(() => void restartApp(), 900);
  return result;
});
// the app window says when the user picks another language (app-preload.ts), so the menus follow at once
ipcMain.on('app:language', (event, value: unknown) => {
  if (!win || event.sender !== win.webContents || !isLang(value) || value === lang) return;
  useLanguage(value);
  buildMenu();
});

ipcMain.on('network:close', (event) => {
  if (connectWin && event.sender === connectWin.webContents) connectWin.close();
});

async function workHere(): Promise<void> {
  saveRemote(null);
  log('back to this PC’s own company file');
  await restartApp();
}

/** The office server doesn't answer, or its certificate changed: say so and offer the ways out. */
async function officeServerProblem(certificate: boolean): Promise<void> {
  if (!win || !remote) return;
  win.show();
  const host = `${remote.host}:${remote.port}`;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', title: 'Qasa ERP', message: t(certificate ? 'serverChanged' : 'serverDown', { host }),
    buttons: certificate ? [t('connect'), t('workHere'), t('quit')] : [t('tryAgain'), t('workHere'), t('quit')], defaultId: 0, cancelId: 2
  });
  if (response === 0) {
    if (certificate) openConnectWindow();
    else void win.loadURL(`https://${remote.host}:${remote.port}/`);
  } else if (response === 1) {
    await workHere();
  } else {
    app.quit();
  }
}

// ——— window and menu ———

async function readLanguage(): Promise<void> {
  try {
    const saved = await win?.webContents.executeJavaScript("localStorage.getItem('qasa.lang')", true);
    if (isLang(saved)) useLanguage(saved);
  } catch { /* keep the default */ }
}

/** The language the user picked: for the menus now and, saved, for the dialogs at the next start. */
function useLanguage(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try {
    writeFileSync(languageFile(), JSON.stringify({ lang }));
  } catch (error) {
    log('could not save the language:', error);
  }
}

/** The app's language is in the window; a copy here lets the dialogs before the window (at start) use it too. */
const languageFile = () => join(app.getPath('userData'), 'language.json');
function readSavedLanguage(): void {
  try {
    const saved = (JSON.parse(readFileSync(languageFile(), 'utf8')) as { lang?: unknown }).lang;
    if (isLang(saved)) lang = saved;
  } catch { /* first start: Arabic */ }
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: t('file'),
      submenu: remote
        ? [
            { label: t('connectedTo', { host: `${remote.host}:${remote.port}` }), enabled: false },
            { label: t('connect'), click: () => openConnectWindow() },
            { label: t('workHere'), click: () => void workHere() },
            { type: 'separator' },
            { label: t('quit'), role: 'quit' }
          ]
        : [
            { label: t('openData'), click: () => void shell.openPath(join(app.getPath('userData'), 'data')) },
            { label: t('connect'), click: () => openConnectWindow() },
            { type: 'separator' },
            { label: t('quit'), role: 'quit' }
          ]
    },
    {
      label: t('view'),
      submenu: [
        { label: t('reload'), role: 'reload' },
        { type: 'separator' },
        { label: t('zoomIn'), role: 'zoomIn' },
        { label: t('zoomOut'), role: 'zoomOut' },
        { label: t('zoomReset'), role: 'resetZoom' },
        { type: 'separator' },
        { label: t('fullScreen'), role: 'togglefullscreen' }
      ]
    },
    {
      label: t('help'),
      submenu: [
        { label: t('checkUpdates'), click: () => checkForUpdates(true) },
        { label: t('website'), click: () => void shell.openExternal('https://qasaerp.com') },
        { type: 'separator' },
        {
          label: t('about'),
          click: () => void dialog.showMessageBox(win!, { type: 'info', title: 'Qasa ERP', message: rtlLines(t('aboutText', { v: `${app.getVersion()}${FROM_STORE ? ' (Microsoft Store)\u200E' : ''}` })), buttons: [t('ok')] })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(url: string): Promise<void> {
  const ses = session.defaultSession;
  // the key that opens this PC's own server; the office server needs none (everyone signs in there)
  if (!remote) await ses.cookies.set({ url, name: 'qasa_session', value: SESSION_KEY, httpOnly: true, sameSite: 'strict' });
  // Qasa needs no camera, microphone, location, notifications or other device access.
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);

  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1024, minHeight: 640,
    title: 'Qasa ERP', backgroundColor: '#F4F6FA', show: false, autoHideMenuBar: false,
    icon: join(__dirname, 'icon.png'),
    webPreferences: { preload: join(__dirname, 'app-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
  });

  // Only the app itself opens inside the window; web links go to the browser and email links to the mail app.
  const origin = new URL(url).origin;
  const external = (target: string) => /^(https?:\/\/|mailto:)/.test(target) && !target.startsWith(origin);
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (external(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(origin)) {
      event.preventDefault();
      if (external(target)) void shell.openExternal(target);
    }
  });

  win.once('ready-to-show', () => win?.show());
  win.webContents.on('did-finish-load', async () => {
    await readLanguage();
    buildMenu();
  });
  win.on('closed', () => { log('window closed'); win = null; });
  win.webContents.on('render-process-gone', (_e, details) => log('screen process ended:', details.reason));
  if (remote) {
    // Chromium's certificate errors are -200 to -299
    win.webContents.on('did-fail-load', (_e, code, description, _url, mainFrame) => {
      if (!mainFrame || code === -3) return; // -3: a navigation was replaced, not a failure
      log('office server did not load:', code, description);
      void officeServerProblem(code <= -200 && code > -300);
    });
    await win.loadURL(url).catch(() => { /* reported by did-fail-load */ });
    return;
  }
  await win.loadURL(url);
}

// ——— updates (GitHub releases of meroxis/qasa-erp) ———

function setupUpdates(): void {
  if (!app.isPackaged || FROM_STORE) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.logger = { info: (m: unknown) => log('updater:', m), warn: (m: unknown) => log('updater warning:', m), error: (m: unknown) => log('updater error:', m), debug: () => {} };
  autoUpdater.on('update-available', (info) => {
    log('update available:', info.version);
    if (manualCheck && win) void dialog.showMessageBox(win, { type: 'info', title: 'Qasa ERP', message: t('downloading', { v: info.version }), buttons: [t('ok')] });
  });
  autoUpdater.on('update-not-available', () => {
    if (manualCheck && win) void dialog.showMessageBox(win, { type: 'info', title: 'Qasa ERP', message: t('upToDate', { v: app.getVersion() }), buttons: [t('ok')] });
    manualCheck = false;
  });
  autoUpdater.on('error', (error) => {
    log('update check failed:', error?.message ?? error);
    if (manualCheck && win) void dialog.showMessageBox(win, { type: 'warning', title: 'Qasa ERP', message: t('updateError'), buttons: [t('ok')] });
    manualCheck = false;
  });
  autoUpdater.on('update-downloaded', async (info) => {
    log('update downloaded:', info.version);
    manualCheck = false;
    if (!win) return;
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', title: t('updateReadyTitle'), message: t('updateReady', { v: info.version }),
      buttons: [t('restartNow'), t('later')], defaultId: 0, cancelId: 1
    });
    if (response === 0) {
      await stopServer();
      autoUpdater.quitAndInstall();
    }
  });

  setTimeout(() => checkForUpdates(false), 15_000);
  setInterval(() => checkForUpdates(false), UPDATE_EVERY_MS);
}

function checkForUpdates(manual: boolean): void {
  if (FROM_STORE) {
    // the Store's page shows whether an update is waiting, and installs it
    if (manual) void shell.openExternal(STORE_PAGE);
    return;
  }
  if (!app.isPackaged) {
    if (manual && win) void dialog.showMessageBox(win, { type: 'info', title: 'Qasa ERP', message: t('upToDate', { v: app.getVersion() }), buttons: [t('ok')] });
    return;
  }
  manualCheck = manual;
  autoUpdater.checkForUpdates().catch(() => { /* reported by the 'error' event */ });
}

// ——— app lifecycle ———

// The connect window's page comes from this private scheme: with the grantFileProtocolExtraPrivileges fuse off,
// file:// can't read inside app.asar. It serves that one page and nothing else.
const APP_SCHEME = 'qasa-app';
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true } }]);

function serveAppScheme(): void {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.host !== 'connect' || url.pathname !== '/connect.html') return new Response('Not found', { status: 404 });
    return new Response(readFileSync(join(__dirname, 'connect.html')), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }
    });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.meroxis.qasaerp');
    serveAppScheme();
    readSavedLanguage();
    remote = readRemote();
    buildMenu();
    try {
      if (remote) {
        // an office PC: the company file is on the office server; this PC's own server doesn't start
        pinCertificate(remote);
        log(`Qasa ERP ${app.getVersion()} started — on the office server ${remote.host}:${remote.port}`);
        await createWindow(`https://${remote.host}:${remote.port}/`);
      } else {
        const url = await startServer();
        log(`Qasa ERP ${app.getVersion()}${FROM_STORE ? ' (Microsoft Store)' : ''} started — server on ${url}, data in ${join(app.getPath('userData'), 'data')}`);
        await createWindow(url);
      }
      setupUpdates();
    } catch (error) {
      if (error instanceof Quitting) return;
      dialog.showErrorBox(t('startFailed'), error instanceof Error ? error.message : String(error));
      app.quit();
    }
  });

  app.on('before-quit', () => { log('quitting'); void stopServer(); });
  app.on('window-all-closed', () => app.quit());
}
