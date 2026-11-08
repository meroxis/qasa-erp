import { contextBridge, ipcRenderer } from 'electron';

/** The "Reset admin password" window's only way into the app: the admins, a reset, or closing the window. */
contextBridge.exposeInMainWorld('qasaRecover', {
  admins: () => ipcRenderer.invoke('recover:admins'),
  withCode: (username: string, code: string, password: string) => ipcRenderer.invoke('recover:code', String(username), String(code), String(password)),
  withWindows: (username: string, password: string) => ipcRenderer.invoke('recover:windows', String(username), String(password)),
  close: () => ipcRenderer.send('recover:close')
});
