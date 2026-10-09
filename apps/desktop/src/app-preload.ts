import { contextBridge, ipcRenderer } from 'electron';

/** The app window's only way to the desktop shell: the language the user picks, for its menus and the dialogs at start. */
contextBridge.exposeInMainWorld('qasaDesktop', {
  setLanguage: (lang: string) => ipcRenderer.send('app:language', String(lang))
});
