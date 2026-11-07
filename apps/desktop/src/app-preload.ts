import { contextBridge, ipcRenderer } from 'electron';

/** The app window's only way to the desktop shell: the language and appearance the user picks, graphics acceleration. */
contextBridge.exposeInMainWorld('qasaDesktop', {
  setLanguage: (lang: string) => ipcRenderer.send('app:language', String(lang)),
  setTheme: (theme: string) => ipcRenderer.send('app:theme', String(theme)),
  getGraphics: () => ipcRenderer.invoke('app:graphics') as Promise<{ on: boolean; running: boolean } | null>,
  setGraphics: (on: boolean) => ipcRenderer.invoke('app:graphics:set', on === true) as Promise<{ on: boolean; running: boolean } | null>,
  relaunch: () => ipcRenderer.send('app:relaunch')
});
