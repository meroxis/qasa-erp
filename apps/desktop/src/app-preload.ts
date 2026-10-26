import { contextBridge, ipcRenderer } from 'electron';

/** The app window's only way to the desktop shell: the language and the appearance the user picks. */
contextBridge.exposeInMainWorld('qasaDesktop', {
  setLanguage: (lang: string) => ipcRenderer.send('app:language', String(lang)),
  setTheme: (theme: string) => ipcRenderer.send('app:theme', String(theme))
});
