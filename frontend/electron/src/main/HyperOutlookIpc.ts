import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IpcChannel as C } from '@shared/api';
import type { HyperOutlookBridge } from './HyperOutlookBridge';
import { HyperOutlookArgs, type HyperOutlookOp } from './HyperOutlookSchema';
import { SettingsError, toIpcResult } from './settings-error';
import { hyperTrustedWindowAdapter, type HyperWindowSource } from './HyperTrustedWindows';
export function registerHyperOutlookIpc(bridge: HyperOutlookBridge, window: HyperWindowSource) {
  const registry = hyperTrustedWindowAdapter(window);
  const trusted = (event: IpcMainInvokeEvent) => registry.isTrustedSender(event);
  // Calendar view ops only. Mail and the other HyperBots ops (HyperBotsOutlookTools) have no renderer channel.
  const channels = { 'people.search': C.OutlookPeopleSearch, 'people.lookup': C.OutlookPeopleLookup, status: C.OutlookStatus, list: C.OutlookList, create: C.OutlookCreate, update: C.OutlookUpdate, delete: C.OutlookDelete, respond: C.OutlookRespond, open: C.OutlookOpen } satisfies Partial<Record<HyperOutlookOp, string>>;
  for (const op of Object.keys(channels) as (keyof typeof channels)[]) ipcMain.handle(channels[op], (event, args: unknown) => toIpcResult(async () => {
    if (!trusted(event)) throw new SettingsError('state', 'Untrusted Outlook caller refused.');
    const valid = HyperOutlookArgs[op].safeParse(args);
    if (!valid.success) throw new SettingsError('format', valid.error.issues[0]?.message ?? 'Invalid Outlook request.');
    return bridge.request(op, valid.data);
  }));
}
