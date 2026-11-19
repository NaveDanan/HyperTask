import { clipboard, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { HyperBotsChannel as B, type HyperBotsEvent } from '@shared/HyperBots';
import { createHyperBotsRpc, HYPER_BOTS_RPC_CHANNELS, hyperBotsFailure, type HyperBotsRpcDeps } from './HyperBotsRpc';
import type { HyperBotsHostClient } from './HyperBotsHostClient';
import type { HyperBotsRuntime } from './HyperBotsRuntime';
import type { HyperBotsHub } from './HyperBotsHub';
import { SettingsError, toIpcResult } from './settings-error';

export { HyperBotsArgs, hyperBotsFailure } from './HyperBotsRpc';

/** When HyperBots could not start (e.g. its state file is unreadable), every call answers with why; the app keeps running. */
export function registerHyperBotsUnavailable(problem: string): () => void {
  for (const channel of HYPER_BOTS_RPC_CHANNELS) ipcMain.handle(channel, () => toIpcResult(async () => { throw new SettingsError('state', `HyperBots could not start. ${problem}`); }));
  return () => { for (const channel of HYPER_BOTS_RPC_CHANNELS) ipcMain.removeHandler(channel); };
}

/**
 * Every call first asks the hub who is signed in (verified with the core in main) and acts only on that account's
 * runtime; events are forwarded only from the active runtime.
 */
export function registerHyperBotsIpc(window: () => BrowserWindow | null, deps: HyperBotsRpcDeps & { hub: Pick<HyperBotsHub, 'current' | 'onSwitch'>; onOutlookPresenceChange?: (listener: () => void) => () => void; host?: HyperBotsHostClient }): () => void {
  const trusted = (event: IpcMainInvokeEvent) => event.sender === window()?.webContents && event.senderFrame === event.sender.mainFrame;
  const rpc = createHyperBotsRpc(deps);
  let remoteLease: AbortController | undefined;
  for (const [channel, prepare] of rpc.handlers) {
    ipcMain.handle(channel, (event, args: unknown) => toIpcResult(async () => {
      if (!trusted(event)) throw new SettingsError('state', 'Untrusted HyperBots caller refused.');
      try {
        const request = prepare(args);
        const active = await deps.hub.current();
        const owner = window();
        if (channel === B.VaultCopy) {
          if (!owner || owner.isDestroyed()) throw new SettingsError('state', 'The HyperTask window is unavailable.');
          const answer = await dialog.showMessageBox(owner, {
            type: 'question', message: 'Copy this password to the clipboard?',
            detail: 'HyperTask clears the clipboard after 30 seconds if the password is still there.',
            buttons: ['Cancel', 'Copy password'], defaultId: 0, cancelId: 0,
          });
          if (answer.response !== 1) return false;
          const current = await deps.hub.current();
          if (!trusted(event) || current.runtime !== active.runtime) throw new SettingsError('state', 'The account or window changed.');
        }
        let result: unknown;
        if (deps.host) {
          deps.host.assertOwner(active.user.key);
          if (!remoteLease) {
            remoteLease = new AbortController();
            deps.host.follow(remoteLease.signal, forward);
          }
          result = await deps.host.call(channel, request.input, remoteLease.signal);
        } else {
          follow(active.runtime);
          result = await request.run(active);
        }
        if (channel !== B.VaultCopy) return result;
        if (typeof result !== 'string' || !result || !trusted(event)) throw new SettingsError('state', 'The password could not be copied.');
        await clipboard.writeText(result);
        setTimeout(() => {
          void clipboard.readText().then(value => value === result ? clipboard.clear() : undefined).catch(() => {});
        }, 30_000).unref();
        return true;
      } catch (error) { throw hyperBotsFailure(error); }
    }));
  }
  const forward = (event: HyperBotsEvent) => {
    const owner = window();
    try { if (owner && !owner.isDestroyed() && !owner.webContents.isDestroyed()) owner.webContents.send(B.Event, event); } catch { /* the window is going away */ }
  };
  let followed: HyperBotsRuntime | null = null;
  const follow = (runtime: HyperBotsRuntime | null) => {
    if (followed === runtime) return;
    followed?.events.off('event', forward);
    followed = runtime;
    followed?.events.on('event', forward);
  };
  const unsubscribe = deps.hub.onSwitch(runtime => {
    remoteLease?.abort();
    remoteLease = undefined;
    follow(deps.host ? null : runtime);
  });
  const unsubscribePresence = deps.onOutlookPresenceChange?.(() => { rpc.clearConnections(); forward({ type: 'settings' }); });
  return () => {
    unsubscribe();
    unsubscribePresence?.();
    remoteLease?.abort();
    follow(null);
    for (const channel of HYPER_BOTS_RPC_CHANNELS) ipcMain.removeHandler(channel);
  };
}
