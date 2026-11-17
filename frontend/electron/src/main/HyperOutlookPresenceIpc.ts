import { ipcMain, type BrowserWindow } from 'electron';
import { IpcChannel as C } from '@shared/api';
import type { HyperOutlookPresence } from './HyperOutlookPresence';
import { SettingsError, toIpcResult } from './settings-error';

export function registerHyperOutlookPresenceIpc(presence: Pick<HyperOutlookPresence, 'current' | 'launch' | 'onChange'>, window: () => BrowserWindow | null) {
  for (const channel of [C.OutlookPresenceRead, C.OutlookLaunch]) ipcMain.handle(channel, (event, ...args: unknown[]) => toIpcResult(async () => {
    if (event.sender !== window()?.webContents || event.senderFrame !== event.sender.mainFrame) throw new SettingsError('state', 'Untrusted Outlook caller refused.');
    if (args.length) throw new SettingsError('format', 'This Outlook request takes no arguments.');
    return channel === C.OutlookLaunch ? presence.launch() : presence.current();
  }));
  const unsubscribe = presence.onChange(state => {
    const owner = window();
    try { if (owner && !owner.isDestroyed() && !owner.webContents.isDestroyed()) owner.webContents.send(C.OutlookPresence, state); } catch { /* Window is closing. */ }
  });
  return () => { unsubscribe(); ipcMain.removeHandler(C.OutlookPresenceRead); ipcMain.removeHandler(C.OutlookLaunch); };
}
