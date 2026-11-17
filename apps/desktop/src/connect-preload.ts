import { contextBridge, ipcRenderer } from 'electron';

/**
 * The connect window's only way into the app: pair with an office server, list the offices this PC remembers, go back
 * to one or forget it (by its id only), or close the window.
 */
contextBridge.exposeInMainWorld('qasaConnect', {
  pair: (address: string, code: string, remember: boolean) => ipcRenderer.invoke('network:pair', String(address), String(code), remember === true),
  offices: () => ipcRenderer.invoke('network:offices'),
  useOffice: (id: string) => ipcRenderer.invoke('network:useOffice', String(id)),
  forgetOffice: (id: string) => ipcRenderer.invoke('network:forgetOffice', String(id)),
  close: () => ipcRenderer.send('network:close')
});
