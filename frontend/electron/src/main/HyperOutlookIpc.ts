import { z } from 'zod';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IpcChannel as C } from '@shared/api';
import type { HyperOutlookBridge } from './HyperOutlookBridge';
import { HyperOutlookArgs, type HyperOutlookOp } from './HyperOutlookSchema';
import { SettingsError, toIpcResult } from './settings-error';
import { hyperTrustedWindowAdapter, type HyperWindowSource } from './HyperTrustedWindows';
export function registerHyperOutlookIpc(bridge: HyperOutlookBridge, window: HyperWindowSource, calendar?: import('./HyperOutlookCalendarCache').HyperOutlookCalendarCache) {
  const registry = hyperTrustedWindowAdapter(window);
  const trusted = (event: IpcMainInvokeEvent) => registry.isTrustedSender(event);
  if (calendar) {
    const handle = <T>(channel: string, schema: z.ZodType<T>, run: (event: IpcMainInvokeEvent, value: T) => unknown) =>
      ipcMain.handle(channel, (event, raw: unknown) => toIpcResult(async () => {
        if (!trusted(event)) throw new SettingsError('state', 'Untrusted Outlook caller refused.');
        const parsed = schema.safeParse(raw);
        if (!parsed.success) throw new SettingsError('format', 'Invalid calendar request.');
        const result = await run(event, parsed.data);
        if (!trusted(event)) throw new SettingsError('state', 'Outlook document changed.');
        return result;
      }));
    handle(C.OutlookSubscribeRange, z.strictObject({ id: z.uuid(), range: HyperOutlookArgs.list, refresh: z.boolean() }), (event, v) => {
      const frame = event.senderFrame!;
      const current = () => !frame.detached && frame === event.sender.mainFrame && trusted(event);
      return calendar.subscribe(v.id, v.range, frame, () => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return !!win?.isVisible() && !win.isMinimized();
      }, current, (items, error) => { if (current()) event.sender.send(C.OutlookRangeChanged, { id: v.id, items, error }); }, v.refresh);
    });
    handle(C.OutlookUnsubscribeRange, z.uuid(), (event, id) => calendar.stop(id, event.senderFrame!));
    handle(C.OutlookResolveOccurrence, z.uuid(), (event, handle) => calendar.resolve(handle, event.senderFrame!));
  }
  // Calendar view ops only. Mail and the other HyperBots ops (HyperBotsOutlookTools) have no renderer channel.
  const channels = { 'people.search': C.OutlookPeopleSearch, 'people.lookup': C.OutlookPeopleLookup, status: C.OutlookStatus, list: C.OutlookList, create: C.OutlookCreate, update: C.OutlookUpdate, delete: C.OutlookDelete, respond: C.OutlookRespond, open: C.OutlookOpen } satisfies Partial<Record<HyperOutlookOp, string>>;
  for (const op of Object.keys(channels) as (keyof typeof channels)[]) ipcMain.handle(channels[op], (event, args: unknown) => toIpcResult(async () => {
    if (!trusted(event)) throw new SettingsError('state', 'Untrusted Outlook caller refused.');
    const valid = HyperOutlookArgs[op].safeParse(args);
    if (!valid.success) throw new SettingsError('format', valid.error.issues[0]?.message ?? 'Invalid Outlook request.');
    if (!calendar || !['create', 'update', 'delete', 'respond'].includes(op)) return bridge.request(op, valid.data);
    const id = valid.data && 'id' in valid.data ? valid.data.id : undefined;
    try {
      const result = await bridge.request(op, valid.data);
      const saved = result && 'start' in result && 'isRecurring' in result ? result : undefined;
      calendar.edited(id, saved);
      return result;
    } catch (error) {
      calendar.edited(id, undefined, true);
      throw error;
    }
  }));
}
