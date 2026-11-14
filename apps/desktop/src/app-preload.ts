import { contextBridge, ipcRenderer } from 'electron';

/**
 * The app window's only way to the desktop shell: the language and appearance the user picks, graphics acceleration,
 * the third-party notices installed with the app, remote support with Quick Assist.
 */
contextBridge.exposeInMainWorld('qasaDesktop', {
  setLanguage: (lang: string) => ipcRenderer.send('app:language', String(lang)),
  setTheme: (theme: string) => ipcRenderer.send('app:theme', String(theme)),
  getGraphics: () => ipcRenderer.invoke('app:graphics') as Promise<{ on: boolean; running: boolean } | null>,
  setGraphics: (on: boolean) => ipcRenderer.invoke('app:graphics:set', on === true) as Promise<{ on: boolean; running: boolean } | null>,
  relaunch: () => ipcRenderer.send('app:relaunch'),
  /** Settings → About → Legal: opens the installed THIRD_PARTY_NOTICES.md (main.ts, notices.ts). False when it could not. */
  openNotices: () => ipcRenderer.invoke('app:notices') as Promise<boolean>,
  /** "What's new" after an update (1.1): the version now and the one before (null: nothing new), and "seen". */
  whatsNew: () => ipcRenderer.invoke('app:whatsNew') as Promise<{ current: string; previous: string | null } | null>,
  whatsNewSeen: () => ipcRenderer.invoke('app:whatsNewSeen') as Promise<boolean>,
  /**
   * Remote support (main.ts, remote-support.ts): opens Windows' Quick Assist (else its Store page). No argument
   * crosses: the main process opens only its two fixed addresses. Answers 'opened', 'store' or 'failed'.
   */
  remoteSupport: () => ipcRenderer.invoke('app:remoteSupport') as Promise<unknown>,
  /** The edition, Windows' version, office-server client or not, and the log's last error lines, already scrubbed. */
  supportInfo: () => ipcRenderer.invoke('app:supportInfo') as Promise<unknown>,
  /** Help → Remote support… asks the page to show its Remote support screen. */
  onRemoteSupport: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('app:remoteSupport:show', handler);
    return () => { ipcRenderer.removeListener('app:remoteSupport:show', handler); };
  },
  /**
   * 1.4: where the company's data is (main.ts, data-place.ts): on this PC, or on the office PC this one is connected
   * to, by the name the File menu shows. No argument crosses.
   */
  dataPlace: () => ipcRenderer.invoke('app:dataPlace') as Promise<unknown>,
  /**
   * 1.4: Settings → Backups → "Ask to back up when I close" (main.ts, close-backup.ts). Only true or false crosses;
   * null on a PC connected to an office server (its books are not here).
   */
  closeAsk: {
    get: () => ipcRenderer.invoke('app:closeAsk') as Promise<unknown>,
    set: (on: boolean) => ipcRenderer.invoke('app:closeAsk:set', on === true) as Promise<unknown>
  },
  /** This app can keep several companies (Settings → Companies; the routes are on its own server, admins only). */
  companies: true,
  /**
   * Settings → Start over with empty books (1.1): an admin's user name and password and the company's name typed. The
   * main process refuses it on a PC connected to an office server; the app makes a backup first and restarts.
   */
  startOver: (username: string, password: string, confirmation: string) =>
    ipcRenderer.invoke('app:startOver', String(username), String(password), String(confirmation)) as Promise<{ ok: boolean; error?: string; retryAfterSeconds?: number }>,
  /**
   * The outbox (1.2, main.ts and outbox.ts): on a PC connected to an office server, the till's sales and the receipts
   * that could not reach it wait on this PC, encrypted, until the app sends them again. Elsewhere it says it isn't there.
   * Every call answers { ok, value } or { ok: false, error }; the main process checks what it gets.
   */
  outbox: {
    status: () => ipcRenderer.invoke('outbox:status') as Promise<unknown>,
    list: () => ipcRenderer.invoke('outbox:list') as Promise<unknown>,
    add: (entry: unknown) => ipcRenderer.invoke('outbox:add', plain(entry)) as Promise<unknown>,
    result: (id: string, outcome: unknown) => ipcRenderer.invoke('outbox:result', String(id), plain(outcome)) as Promise<unknown>,
    retry: (id: string) => ipcRenderer.invoke('outbox:retry', String(id)) as Promise<unknown>,
    discard: (id: string) => ipcRenderer.invoke('outbox:discard', String(id)) as Promise<unknown>,
    onChange: (listener: (status: unknown) => void) => {
      const handler = (_event: unknown, status: unknown) => listener(status);
      ipcRenderer.on('outbox:changed', handler);
      return () => { ipcRenderer.removeListener('outbox:changed', handler); };
    }
  },
  /**
   * Settings → Printers and the Print buttons (main.ts, printing.ts): four fixed calls. The page names a kind of paper;
   * the main process checks everything it gets and prints only this window, with the choice saved for that kind.
   */
  printers: {
    // fresh (the Refresh button): Windows is asked again about the default printer and each one's state
    list: (fresh?: boolean) => ipcRenderer.invoke('printers:list', fresh === true) as Promise<unknown>,
    get: () => ipcRenderer.invoke('printers:get') as Promise<unknown>,
    set: (kind: string, choice: unknown) => ipcRenderer.invoke('printers:set', String(kind), choiceOf(choice)) as Promise<unknown>,
    // labels may name the layout picked on the labels page (its paper is used); the main process checks it
    print: (kind: string, layout?: string) =>
      (layout === undefined ? ipcRenderer.invoke('printers:print', String(kind)) : ipcRenderer.invoke('printers:print', String(kind), String(layout))) as Promise<unknown>
  },
  /**
   * Send on WhatsApp as a PDF (main.ts, share-pdf.ts): this window as it prints now, saved as "<kind>-<number>.pdf" in
   * the app's own folder and shown in File Explorer. Only a kind and a number cross; the main process checks both.
   */
  sharePdf: (kind: string, ref: string) => ipcRenderer.invoke('share:pdf', String(kind), String(ref)) as Promise<unknown>
});

/** Plain data only (JSON), at most 1 MB: no functions or objects of the page's own cross to the main process. */
function plain(value: unknown): unknown {
  const text = JSON.stringify(value ?? null);
  if (text.length > 1024 * 1024) return null; // refused by the main process
  return JSON.parse(text);
}

/** Only the fields of a printer choice cross to the main process (which checks each one again); null means "Ask every time". */
function choiceOf(choice: unknown): unknown {
  if (choice === null) return null;
  if (typeof choice !== 'object') return {}; // refused by the main process
  const c = choice as Record<string, unknown>;
  return { printer: c.printer ?? null, paper: c.paper, margins: c.margins, copies: c.copies, silent: c.silent };
}

/** Updates: the banner and Settings → Updates (main.ts, "updates"). Nothing installs without the person's click. */
contextBridge.exposeInMainWorld('qasaUpdates', {
  get: () => ipcRenderer.invoke('updates:get') as Promise<unknown>,
  check: () => ipcRenderer.invoke('updates:check') as Promise<unknown>,
  install: () => ipcRenderer.invoke('updates:install') as Promise<unknown>,
  setChannel: (channel: 'stable' | 'beta') => ipcRenderer.invoke('updates:channel', channel === 'beta' ? 'beta' : 'stable') as Promise<unknown>,
  openStore: () => ipcRenderer.send('updates:store'),
  onState: (listener: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown) => listener(state);
    ipcRenderer.on('updates:state', handler);
    return () => { ipcRenderer.removeListener('updates:state', handler); };
  }
});
