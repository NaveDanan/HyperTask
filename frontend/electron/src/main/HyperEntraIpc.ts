import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { IpcChannel as C } from '@shared/api';
import { HyperEntraBroker } from './HyperEntraBroker';
import { SettingsError, toIpcResult } from './settings-error';
export function registerHyperEntraIpc(window: () => BrowserWindow | null, broker = new HyperEntraBroker()) {
  const trusted = (event: IpcMainInvokeEvent) => event.sender === window()?.webContents && event.senderFrame === event.sender.mainFrame;
  ipcMain.handle(C.AuthEntraIdToken, (event, config: unknown) => toIpcResult(async () => {
    if (!trusted(event)) throw new SettingsError('state', 'Untrusted sign-in caller refused.');
    return broker.idToken(config, window()?.getNativeWindowHandle());
  }));
  ipcMain.handle(C.AuthEntraCancel, event => { if (trusted(event)) broker.cancel(); });
}
