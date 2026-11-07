/**
 * Qasa ERP for Windows. The accounting server (the same one the office edition runs) starts inside the app on
 * 127.0.0.1, the window shows the app from it, and the company file lives in the user's profile:
 *   %APPDATA%\Qasa ERP\data\qasa.sqlite
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, safeStorage, session, shell, utilityProcess, type MenuItemConstructorOptions, type UtilityProcess } from 'electron';
import electronUpdater from 'electron-updater';
import { channelOf, notesText, updaterOptions, type UpdateChannel, type UpdateState } from './updates-logic.ts';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Bridge } from './bridge.ts';
import { isLang, text, type Lang, type TextKey } from './texts.ts';
import { pair, parseAddress, parseOfficeId, pemFingerprint, startTunnel, type PairResult, type Remote } from './office.ts';

const { autoUpdater } = electronUpdater;
/** Installed from the Microsoft Store: the Store signs and updates it, so the app's own updater stays off. */
const FROM_STORE = process.windowsStore === true;
const STORE_PAGE = 'ms-windows-store://pdp/?productid=9NRTX5BBK9DW';
const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;
/** A new secret each launch. Only this app's window holds it (as a cookie), so other programs and other Windows users can't use the local server. */
const SESSION_KEY = randomBytes(32).toString('hex');

let win: BrowserWindow | null = null;
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

// ——— graphics acceleration ———
// On some laptops (old or unusual graphics drivers) Chromium's graphics process hangs or crashes, and the window
// freezes or goes blank. Settings → Language and display can turn acceleration off (it takes effect at the next
// start), the app turns it off by itself after the graphics process crashes twice, and `--disable-gpu` on the
// command line does the same for one start.
const graphicsFile = () => join(app.getPath('userData'), 'graphics.json');
function graphicsOn(): boolean {
  try {
    return (JSON.parse(readFileSync(graphicsFile(), 'utf8')) as { acceleration?: unknown }).acceleration !== false;
  } catch {
    return true;
  }
}
function saveGraphics(on: boolean, reason: string): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(graphicsFile(), JSON.stringify({ acceleration: on, reason, at: new Date().toISOString() }));
  } catch (error) {
    log('could not save the graphics setting:', error);
  }
}
/** What this start runs with (a change shows after a restart). */
const graphicsAtStart = graphicsOn() && !app.commandLine.hasSwitch('disable-gpu');
if (!graphicsAtStart) app.disableHardwareAcceleration();

let gpuCrashes = 0;
app.on('child-process-gone', (_event, details) => {
  if (details.type !== 'GPU' || details.reason === 'clean-exit') return;
  gpuCrashes += 1;
  log(`graphics process ended (${details.reason}, ${details.exitCode}), ${gpuCrashes} time(s)`);
  if (gpuCrashes < 2 || !graphicsOn()) return;
  saveGraphics(false, `gpu-${details.reason}`);
  if (!app.isReady()) return;
  void (async () => {
    const { response } = await dialog.showMessageBox({
      type: 'warning', title: t('gpuOffTitle'), message: t('gpuOff'), buttons: [t('restartNow'), t('later')], defaultId: 0, cancelId: 1, noLink: true
    });
    if (response === 0) await relaunchApp();
  })();
});

/** Stops the server process cleanly, then starts the app again. */
async function relaunchApp(): Promise<void> {
  await stopServer();
  app.relaunch();
  app.exit(0);
}

// ——— the server process ———
// The API server, the company database and the Pro module run in a process of their own (server-process.ts), so a
// heavy request never stops the window from answering. This process starts it, gives it what it needs, and answers
// what only it can do: dialogs and pickers, restarting the app.

const dataDir = () => join(app.getPath('userData'), 'data');
let child: UtilityProcess | null = null;
let bridge: Bridge | null = null;
/** True once this process asked the server process to stop (or to restart the app): its end is then expected. */
let childEnding = false;

/**
 * The server process's own key for the secrets it keeps (secrets.ts): made once, kept protected with safeStorage
 * (Windows DPAPI, this Windows user only) in secret-key.bin, handed to it at each start.
 */
function secretsKey(): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const file = join(app.getPath('userData'), 'secret-key.bin');
  try {
    if (existsSync(file)) return safeStorage.decryptString(readFileSync(file));
    const key = randomBytes(32).toString('hex');
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(file, safeStorage.encryptString(key), { mode: 0o600 });
    return key;
  } catch (error) {
    log('the secrets key could not be read or made:', error);
    return null;
  }
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
 * (Pro) The company's MariaDB/MySQL server can't be used: the admin can try again, quit, or go back to the company
 * file kept aside when the company moved. The server process does what is chosen.
 */
async function databaseProblem(problem: { code: string; host: string; database: string; localCopy: { file: string; since: string } | null }): Promise<'retry' | 'local' | 'quit'> {
  for (;;) {
    const buttons = [t('tryAgain'), ...(problem.localCopy ? [t('dbUseLocalCopy')] : []), t('quit')];
    const { response } = await dialog.showMessageBox({
      type: 'warning', title: 'Qasa ERP', message: t('dbServerProblem', { host: problem.host, database: problem.database }),
      detail: databaseReason(problem.code), buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true
    });
    if (response === 0) return 'retry';
    if (problem.localCopy && response === 1) {
      const sure = await dialog.showMessageBox({
        type: 'warning', title: 'Qasa ERP', message: t('dbLocalCopyConfirm', { date: problem.localCopy.since.slice(0, 10) }),
        buttons: [t('dbUseLocalCopy'), t('cancel')], defaultId: 1, cancelId: 1, noLink: true
      });
      if (sure.response !== 0) continue;
      return 'local';
    }
    childEnding = true;
    setImmediate(() => app.exit(0));
    return 'quit';
  }
}

/**
 * Windows draws message boxes left to right. Each Arabic or Kurdish line is embedded right to left, so a Latin word in
 * it (ERP, qasaerp.com, a version number) keeps its place in the sentence.
 */
const rtlLines = (s: string): string => (lang === 'en' ? s : s.split('\n').map((line) => `\u202B${line}\u202C`).join('\n'));

/**
 * Books from a newer Qasa ERP (the company file, or the company database on a server): this version leaves them as
 * they are, says so, and offers the way to the latest version — the Store page for the Store version, the website
 * for the installer. The app then quits.
 */
async function refuseNewerBooks(details: unknown): Promise<void> {
  log('the company books come from a newer Qasa ERP:', JSON.stringify(details ?? null), 'this is', app.getVersion(), FROM_STORE ? '(Microsoft Store)' : '');
  const buttons = [t('getLatest'), t('quit')];
  const { response } = await dialog.showMessageBox({
    type: 'warning', title: 'Qasa ERP', message: rtlLines(t('newerBooks', { v: app.getVersion() })),
    detail: rtlLines(t(FROM_STORE ? 'newerFromStore' : 'newerFromSite')), buttons, defaultId: 0, cancelId: 1, noLink: true
  });
  if (response === 0) {
    const url = FROM_STORE ? STORE_PAGE : `https://qasaerp.com${{ ar: '/', en: '/en/', ku: '/ku/' }[lang]}#download`;
    await shell.openExternal(url).catch((e: unknown) => log('could not open', url, e));
  }
  childEnding = true;
  app.exit(0);
}

/** Starts the server process and its server; resolves with the address the window loads. */
async function startServer(): Promise<string> {
  childEnding = false;
  const proc = utilityProcess.fork(join(__dirname, 'server-process.cjs'), [], { serviceName: 'Qasa ERP server', stdio: 'ignore' });
  child = proc;
  const link = new Bridge({ postMessage: (m) => proc.postMessage(m), listen: (fn) => proc.on('message', fn) });
  bridge = link;
  link
    .handle('dbProblem', ((problem: Parameters<typeof databaseProblem>[0]) => databaseProblem(problem)) as never)
    .handle('newerBooks', ((details: unknown) => refuseNewerBooks(details)) as never)
    .handle('chooseFolder', (async () => {
      const options = { title: t('backupFolder'), properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
      const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return r.canceled ? null : r.filePaths[0] ?? null;
    }) as never)
    .handle('chooseBackupFile', (async () => {
      const options = { title: t('restoreFile'), properties: ['openFile'] as 'openFile'[], filters: [{ name: 'Qasa ERP', extensions: ['qbak', 'sqlite'] }] };
      const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return r.canceled ? null : r.filePaths[0] ?? null;
    }) as never)
    // the server process has closed the company file (and moved files as asked): start again
    .handle('relaunch', (() => {
      childEnding = true;
      setImmediate(() => { app.relaunch(); app.exit(0); });
    }) as never);
  proc.on('exit', (code) => {
    link.close();
    if (child === proc) { child = null; bridge = null; }
    log(`server process ended (${code})`);
    if (!childEnding && win) void serverGone(code);
  });
  return link.call<string>('init', [{
    userDataDir: app.getPath('userData'), documentsDir: app.getPath('documents'), appVersion: app.getVersion(), sessionKey: SESSION_KEY,
    secretsKey: secretsKey(), resourcesPath: process.resourcesPath, fromStore: FROM_STORE
  }], { timeoutMs: 0 });
}

/** The server process ended by itself (a crash): say so plainly, keep the logs, offer a restart. */
async function serverGone(code: number): Promise<void> {
  log(`the server process stopped unexpectedly (${code}); see server.log`);
  const { response } = await dialog.showMessageBox({
    type: 'error', title: 'Qasa ERP', message: t('serverCrashed'), detail: t('serverCrashedDetail', { code: String(code) }),
    buttons: [t('restartNow'), t('openLogs'), t('quit')], defaultId: 0, cancelId: 2, noLink: true
  });
  if (response === 1) await shell.openPath(join(app.getPath('userData'), 'logs'));
  if (response === 2) return app.quit();
  app.relaunch();
  app.exit(0);
}

/** Asks the server process to close the company file and stop; ends it if it doesn't within a few seconds. */
async function stopServer(): Promise<void> {
  const proc = child;
  if (!proc) return;
  childEnding = true;
  try { await bridge?.call('stop', [], { timeoutMs: 8000 }); } catch (error) { log('the server process did not stop cleanly:', error); }
  proc.kill();
  child = null;
  bridge = null;
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
      // through Qasa Relay: the tunnel's local port is chosen when the app starts
      const relay = r.relay as { url?: unknown; office?: unknown } | undefined;
      if (relay && typeof relay.url === 'string' && /^https:\/\//.test(relay.url) && typeof relay.office === 'string' && parseOfficeId(relay.office)) {
        return { host: '127.0.0.1', port: 0, fingerprint: r.fingerprint, relay: { url: relay.url, office: parseOfficeId(relay.office)! } };
      }
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
    log(result.remote.relay ? `paired with office ${result.remote.relay.office} through Qasa Relay` : `paired with the office server ${result.remote.host}:${result.remote.port}`);
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

/** The origin the app window shows (this PC's server or the office server); nothing else may use its bridge. */
let appOrigin = '';
const originOf = (address: string) => { try { return new URL(address).origin; } catch { return ''; } };
/** A message from the app window's own page: its main frame, on the app's origin. */
function fromAppPage(event: Electron.IpcMainEvent): boolean {
  const frame = event.senderFrame;
  return !!win && event.sender === win.webContents && !!frame && frame === win.webContents.mainFrame && originOf(frame.url) === appOrigin;
}

// the app window says when the user picks another appearance: Electron's title bar, menus and dialogs follow
ipcMain.on('app:theme', (event, value: unknown) => {
  if (!fromAppPage(event) || !isThemeSource(value)) return;
  useTheme(value);
  win?.setBackgroundColor(windowBackground());
});

// the app window says when the user picks another language (app-preload.ts), so the menus follow at once
ipcMain.on('app:language', (event, value: unknown) => {
  if (!fromAppPage(event) || !isLang(value) || value === lang) return;
  useLanguage(value);
  buildMenu();
});

/** A call from the app window's own page (ipcMain.handle). */
function invokedByAppPage(event: Electron.IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return !!win && event.sender === win.webContents && !!frame && frame === win.webContents.mainFrame && originOf(frame.url) === appOrigin;
}

// Settings → Language and display → Graphics acceleration
ipcMain.handle('app:graphics', (event) => {
  if (!invokedByAppPage(event)) return null;
  return { on: graphicsOn(), running: graphicsAtStart };
});
ipcMain.handle('app:graphics:set', (event, on: unknown) => {
  if (!invokedByAppPage(event) || typeof on !== 'boolean') return null;
  saveGraphics(on, 'settings');
  log(`graphics acceleration ${on ? 'on' : 'off'} from the next start`);
  return { on: graphicsOn(), running: graphicsAtStart };
});
ipcMain.on('app:relaunch', (event) => {
  if (fromAppPage(event)) void relaunchApp();
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

/** Light, dark or as Windows: the title bar, the menus and the dialogs follow the app's choice (Settings → Appearance). */
type ThemeSource = typeof nativeTheme.themeSource;
const isThemeSource = (v: unknown): v is ThemeSource => v === 'light' || v === 'dark' || v === 'system';
const themeFile = () => join(app.getPath('userData'), 'theme.json');
function readSavedTheme(): void {
  try {
    const saved = (JSON.parse(readFileSync(themeFile(), 'utf8')) as { theme?: unknown }).theme;
    if (isThemeSource(saved)) nativeTheme.themeSource = saved;
  } catch { /* first start: as Windows */ }
}
function useTheme(next: ThemeSource): void {
  if (next === nativeTheme.themeSource) return;
  nativeTheme.themeSource = next;
  try {
    writeFileSync(themeFile(), JSON.stringify({ theme: next }));
  } catch (error) {
    log('could not save the appearance:', error);
  }
}
/** The window's colour before the page paints, so it never flashes white in dark mode. */
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#11151C' : '#EDF0F5');

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
            { label: t('connectedTo', { host: remote.relay ? `Qasa Relay · ${remote.relay.office.slice(0, 5)}-${remote.relay.office.slice(5)}` : `${remote.host}:${remote.port}` }), enabled: false },
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
    title: 'Qasa ERP', backgroundColor: windowBackground(), show: false, autoHideMenuBar: false,
    icon: join(__dirname, 'icon.png'),
    webPreferences: { preload: join(__dirname, 'app-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
  });

  // Only the app itself opens inside the window; web links go to the browser and email links to the mail app.
  const origin = new URL(url).origin;
  appOrigin = origin;
  // compare real origins: a text prefix would let "http://127.0.0.1:port@elsewhere/" into the app window
  const sameOrigin = (target: string) => originOf(target) === origin;
  const external = (target: string) => /^(https?:\/\/|mailto:)/.test(target) && !sameOrigin(target);
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (external(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!sameOrigin(target)) {
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
// The app window shows a calm banner (found → downloading → ready, with "Restart to update", "Later" and "What's new")
// and Settings → Updates (check now, join the beta). Nothing restarts by itself: an update downloaded in the background
// installs when the person clicks Restart, or when the app quits; the server process closes the company file first.

const updatesFile = () => join(app.getPath('userData'), 'updates.json');
let updateState: UpdateState = {
  current: app.getVersion(), fromStore: FROM_STORE, development: !app.isPackaged, channel: 'stable',
  status: 'idle', version: null, percent: null, notes: null, lastChecked: null, error: null
};

function readChannel(): UpdateChannel {
  try {
    return channelOf((JSON.parse(readFileSync(updatesFile(), 'utf8')) as { channel?: unknown }).channel, app.getVersion());
  } catch {
    return channelOf(undefined, app.getVersion());
  }
}

function saveChannel(channel: UpdateChannel): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(updatesFile(), JSON.stringify({ channel, at: new Date().toISOString() }));
  } catch (error) {
    log('could not save the update channel:', error);
  }
}

function applyChannel(channel: UpdateChannel): void {
  const options = updaterOptions(channel === 'beta');
  // the channel first: setting it turns allowDowngrade on, which the next line turns off again
  autoUpdater.channel = options.channel;
  autoUpdater.allowPrerelease = options.allowPrerelease;
  autoUpdater.allowDowngrade = options.allowDowngrade;
}

function setUpdateState(patch: Partial<UpdateState>): void {
  updateState = { ...updateState, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send('updates:state', updateState);
}

function setupUpdates(): void {
  updateState = { ...updateState, channel: readChannel() };
  if (!app.isPackaged || FROM_STORE) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  applyChannel(updateState.channel);

  autoUpdater.logger = { info: (m: unknown) => log('updater:', m), warn: (m: unknown) => log('updater warning:', m), error: (m: unknown) => log('updater error:', m), debug: () => {} };
  autoUpdater.on('checking-for-update', () => {
    if (updateState.status !== 'downloading' && updateState.status !== 'ready') setUpdateState({ status: 'checking', error: null });
  });
  autoUpdater.on('update-available', (info) => {
    log('update available:', info.version);
    setUpdateState({ status: 'downloading', version: info.version, percent: 0, notes: notesText(info.releaseNotes), lastChecked: new Date().toISOString() });
  });
  autoUpdater.on('download-progress', (progress) => {
    setUpdateState({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(progress.percent))) });
  });
  autoUpdater.on('update-not-available', () => {
    if (manualCheck && win) void dialog.showMessageBox(win, { type: 'info', title: 'Qasa ERP', message: t('upToDate', { v: app.getVersion() }), buttons: [t('ok')] });
    manualCheck = false;
    if (updateState.status !== 'ready') setUpdateState({ status: 'none', lastChecked: new Date().toISOString() });
  });
  autoUpdater.on('error', (error) => {
    log('update check failed:', error?.message ?? error);
    if (manualCheck && win) void dialog.showMessageBox(win, { type: 'warning', title: 'Qasa ERP', message: t('updateError'), buttons: [t('ok')] });
    manualCheck = false;
    // a failure while one is already downloaded keeps "ready": it still installs
    if (updateState.status !== 'ready') setUpdateState({ status: 'error', error: 'update_failed', percent: null, lastChecked: new Date().toISOString() });
  });
  autoUpdater.on('update-downloaded', (info) => {
    log('update downloaded:', info.version);
    manualCheck = false;
    // no dialog: the banner offers "Restart to update"; otherwise it installs when the app quits
    setUpdateState({ status: 'ready', version: info.version, percent: 100, notes: notesText(info.releaseNotes) ?? updateState.notes, lastChecked: new Date().toISOString() });
  });

  setTimeout(() => checkForUpdates(false), 15_000);
  setInterval(() => checkForUpdates(false), UPDATE_EVERY_MS);
}

/** From the menu (manual: a dialog says "up to date" or the error) or Settings and the timer (the banner and card show it). */
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
  if (updateState.status === 'downloading' || updateState.status === 'ready') {
    if (manual && win && updateState.status === 'ready') void dialog.showMessageBox(win, { type: 'info', title: 'Qasa ERP', message: t('updateWaiting', { v: updateState.version ?? '' }), buttons: [t('ok')] });
    return;
  }
  manualCheck = manual;
  autoUpdater.checkForUpdates().catch(() => { /* reported by the 'error' event */ });
}

/** "Restart to update": only on the person's click. The server process closes the company file first. */
async function installUpdate(): Promise<void> {
  if (updateState.status !== 'ready') return;
  log('installing update', updateState.version);
  await stopServer();
  autoUpdater.quitAndInstall();
}

// Settings → Updates and the banner (app-preload.ts → qasaUpdates)
ipcMain.handle('updates:get', (event) => (invokedByAppPage(event) ? updateState : null));
ipcMain.handle('updates:check', (event) => {
  if (!invokedByAppPage(event)) return null;
  checkForUpdates(false);
  return updateState;
});
ipcMain.handle('updates:install', async (event) => {
  if (!invokedByAppPage(event)) return null;
  await installUpdate();
  return updateState;
});
ipcMain.handle('updates:channel', (event, channel: unknown) => {
  if (!invokedByAppPage(event) || (channel !== 'stable' && channel !== 'beta')) return null;
  saveChannel(channel);
  log(`update channel: ${channel}`);
  setUpdateState({ channel });
  if (app.isPackaged && !FROM_STORE) {
    applyChannel(channel);
    // joining looks for a beta at once; leaving only changes what later checks take (no downgrade)
    if (channel === 'beta') checkForUpdates(false);
  }
  return updateState;
});
ipcMain.on('updates:store', (event) => {
  if (fromAppPage(event)) void shell.openExternal(STORE_PAGE);
});

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
    readSavedTheme();
    nativeTheme.on('updated', () => { if (win && !win.isDestroyed()) win.setBackgroundColor(windowBackground()); });
    remote = readRemote();
    buildMenu();
    try {
      if (remote) {
        // an office PC: the company file is on the office server; this PC's own server doesn't start
        if (remote.relay) {
          // over the internet: this PC's end of the tunnel through Qasa Relay, on 127.0.0.1 only
          const tunnel = await startTunnel(remote.relay);
          remote = { ...remote, port: tunnel.port };
          log(`Qasa Relay tunnel to office ${remote.relay!.office} on 127.0.0.1:${tunnel.port}`);
        }
        pinCertificate(remote);
        log(`Qasa ERP ${app.getVersion()} started — on the office server ${remote.host}:${remote.port}`);
        await createWindow(`https://${remote.host}:${remote.port}/`);
      } else {
        const url = await startServer();
        log(`Qasa ERP ${app.getVersion()}${FROM_STORE ? ' (Microsoft Store)' : ''} started — server process on ${url}, data in ${dataDir()}`);
        await createWindow(url);
      }
      setupUpdates();
    } catch (error) {
      if (childEnding) return; // the start was ended on purpose (a dialog's Quit, newer books)
      log('start failed:', error);
      dialog.showErrorBox(t('startFailed'), error instanceof Error ? error.message : String(error));
      app.quit();
    }
  });

  // let the server process close the company file before the app ends
  let quitReady = false;
  app.on('before-quit', (event) => {
    if (quitReady || !child) return;
    event.preventDefault();
    log('quitting');
    void stopServer().finally(() => { quitReady = true; app.quit(); });
  });
  app.on('window-all-closed', () => app.quit());
}
