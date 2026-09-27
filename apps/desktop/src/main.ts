/**
 * Qasa ERP for Windows. The accounting server (the same one the office edition runs) starts inside the app on
 * 127.0.0.1, the window shows the app from it, and the company file lives in the user's profile:
 *   %APPDATA%\Qasa ERP\data\qasa.sqlite
 */
import { app, BrowserWindow, dialog, Menu, session, shell, type MenuItemConstructorOptions } from 'electron';
import electronUpdater from 'electron-updater';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, openDatabase, type Db } from '@qasa/server';
import { isLang, text, type Lang, type TextKey } from './texts.ts';

const { autoUpdater } = electronUpdater;
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
function log(...parts: unknown[]): void {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack ?? p.message : String(p))).join(' ')}`;
  console.log(line);
  try {
    const dir = join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'main.log'), line + '\n');
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

async function startServer(): Promise<string> {
  const dataDir = join(app.getPath('userData'), 'data');
  mkdirSync(dataDir, { recursive: true });
  db = openDatabase(join(dataDir, 'qasa.sqlite'));
  server = buildApp(db);

  server.addHook('onRequest', async (req, reply) => {
    const cookies = (req.headers.cookie ?? '').split(';').map((c) => c.trim());
    if (!cookies.includes(`qasa_session=${SESSION_KEY}`)) return reply.status(403).send({ error: 'forbidden', details: null });
  });
  server.addHook('onSend', async (_req, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
  });

  // The app's screens are served by the same server, so /api is same-origin.
  server.setNotFoundHandler((req, reply) => {
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

  await server.listen({ host: '127.0.0.1', port: await choosePort() });
  const address = server.server.address();
  if (!address || typeof address === 'string') throw new Error('The local server has no port');
  return `http://127.0.0.1:${address.port}`;
}

async function stopServer(): Promise<void> {
  try { await server?.close(); } catch { /* already closed */ }
  try { db?.close(); } catch { /* already closed */ }
  server = null;
  db = null;
}

// ——— window and menu ———

async function readLanguage(): Promise<void> {
  try {
    const saved = await win?.webContents.executeJavaScript("localStorage.getItem('qasa.lang')", true);
    if (isLang(saved)) lang = saved;
  } catch { /* keep the default */ }
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: t('file'),
      submenu: [
        { label: t('openData'), click: () => void shell.openPath(join(app.getPath('userData'), 'data')) },
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
          click: () => void dialog.showMessageBox(win!, { type: 'info', title: 'Qasa ERP', message: t('aboutText', { v: app.getVersion() }), buttons: [t('ok')] })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(url: string): Promise<void> {
  const ses = session.defaultSession;
  await ses.cookies.set({ url, name: 'qasa_session', value: SESSION_KEY, httpOnly: true, sameSite: 'strict' });
  // Qasa needs no camera, microphone, location, notifications or other device access.
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);

  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1024, minHeight: 640,
    title: 'Qasa ERP', backgroundColor: '#F4F6FA', show: false, autoHideMenuBar: false,
    icon: join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
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
  await win.loadURL(url);
}

// ——— updates (GitHub releases of meroxis/qasa-erp) ———

function setupUpdates(): void {
  if (!app.isPackaged) return;
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
  if (!app.isPackaged) {
    if (manual && win) void dialog.showMessageBox(win, { type: 'info', title: 'Qasa ERP', message: t('upToDate', { v: app.getVersion() }), buttons: [t('ok')] });
    return;
  }
  manualCheck = manual;
  autoUpdater.checkForUpdates().catch(() => { /* reported by the 'error' event */ });
}

// ——— app lifecycle ———

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
    buildMenu();
    try {
      const url = await startServer();
      log(`Qasa ERP ${app.getVersion()} started — server on ${url}, data in ${join(app.getPath('userData'), 'data')}`);
      await createWindow(url);
      setupUpdates();
    } catch (error) {
      dialog.showErrorBox(t('startFailed'), error instanceof Error ? error.message : String(error));
      app.quit();
    }
  });

  app.on('before-quit', () => { log('quitting'); void stopServer(); });
  app.on('window-all-closed', () => app.quit());
}
