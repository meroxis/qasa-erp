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
  /** This app can keep several companies (Settings → Companies; the routes are on its own server, admins only). */
  companies: true
});

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
