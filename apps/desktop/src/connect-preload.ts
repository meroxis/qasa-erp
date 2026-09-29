import { contextBridge, ipcRenderer } from 'electron';

/** The connect window's only way into the app: pair with an office server, or close the window. */
contextBridge.exposeInMainWorld('qasaConnect', {
  pair: (address: string, code: string) => ipcRenderer.invoke('network:pair', String(address), String(code)),
  close: () => ipcRenderer.send('network:close')
});
