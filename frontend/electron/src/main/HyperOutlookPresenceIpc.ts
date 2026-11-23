import { ipcMain } from 'electron';
import { IpcChannel as C } from '@shared/api';
import type { HyperOutlookPresence } from './HyperOutlookPresence';
import { SettingsError, toIpcResult } from './settings-error';
import { hyperTrustedWindowAdapter, type HyperWindowSource } from './HyperTrustedWindows';

export function registerHyperOutlookPresenceIpc(presence: Pick<HyperOutlookPresence, 'current' | 'launch' | 'onChange'>, window: HyperWindowSource) {
  const registry = hyperTrustedWindowAdapter(window);
  for (const channel of [C.OutlookPresenceRead, C.OutlookLaunch]) ipcMain.handle(channel, (event, ...args: unknown[]) => toIpcResult(async () => {
    if (!registry.isTrustedSender(event)) throw new SettingsError('state', 'Untrusted Outlook caller refused.');
    if (args.length) throw new SettingsError('format', 'This Outlook request takes no arguments.');
    return channel === C.OutlookLaunch ? presence.launch() : presence.current();
  }));
  const unsubscribe = presence.onChange(state => {
    registry.broadcast(C.OutlookPresence, state);
  });
  return () => { unsubscribe(); ipcMain.removeHandler(C.OutlookPresenceRead); ipcMain.removeHandler(C.OutlookLaunch); };
}
