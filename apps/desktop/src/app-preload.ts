import { contextBridge, ipcRenderer } from 'electron';

/**
 * The app window's only way to the desktop shell: the language and appearance the user picks, graphics acceleration,
 * the third-party notices installed with the app.
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
  /** This app can keep several companies (Settings → Companies; the routes are on its own server, admins only). */
  companies: true,
  /**
   * Settings → Start over with empty books (1.1): an admin's user name and password and the company's name typed. The
   * main process refuses it on a PC connected to an office server; the app makes a backup first and restarts.
   */
  startOver: (username: string, password: string, confirmation: string) =>
    ipcRenderer.invoke('app:startOver', String(username), String(password), String(confirmation)) as Promise<{ ok: boolean; error?: string; retryAfterSeconds?: number }>,
  /**
   * Settings → Printers and the Print buttons (main.ts, printing.ts): four fixed calls. The page names a kind of paper;
   * the main process checks everything it gets and prints only this window, with the choice saved for that kind.
   */
  printers: {
    list: () => ipcRenderer.invoke('printers:list') as Promise<unknown>,
    get: () => ipcRenderer.invoke('printers:get') as Promise<unknown>,
    set: (kind: string, choice: unknown) => ipcRenderer.invoke('printers:set', String(kind), choiceOf(choice)) as Promise<unknown>,
    // labels may name the layout picked on the labels page (its paper is used); the main process checks it
    print: (kind: string, layout?: string) =>
      (layout === undefined ? ipcRenderer.invoke('printers:print', String(kind)) : ipcRenderer.invoke('printers:print', String(kind), String(layout))) as Promise<unknown>
  }
});

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
