import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  HyperDesktopChannel,
  type HyperDesktopOpenMainTarget,
  type HyperDesktopOverlayBounds,
  type HyperDesktopSettingsPatch,
  type HyperDesktopSettingsSnapshot,
} from '@shared/HyperDesktop';
import type { HyperTrustedWindowRegistry } from './HyperTrustedWindows';

const settingsPatchSchema = z.strictObject({
  autoStart: z.boolean().optional(),
  closeToTray: z.boolean().optional(),
});

const overlayResizeSchema = z.strictObject({
  width: z.number().finite().positive().max(4096),
  height: z.number().finite().positive().max(4096),
});

const openMainSchema = z
  .strictObject({
    route: z.enum(['hyper-bots', 'settings']).optional(),
    roomId: z.string().min(1).max(128).optional(),
    settingsPage: z.string().min(1).max(128).optional(),
  })
  .optional();

export interface HyperDesktopIpcDeps {
  trustedWindows: HyperTrustedWindowRegistry;
  getSettings: () => Promise<HyperDesktopSettingsSnapshot> | HyperDesktopSettingsSnapshot;
  setSettings: (patch: HyperDesktopSettingsPatch) => Promise<HyperDesktopSettingsSnapshot>;
  resizeOverlay: (bounds: HyperDesktopOverlayBounds) => void | Promise<void>;
  hideOverlay: () => void | Promise<void>;
  openMain: (target?: HyperDesktopOpenMainTarget) => void | Promise<void>;
}

const CHANNELS = [
  HyperDesktopChannel.GetSettings,
  HyperDesktopChannel.SetSettings,
  HyperDesktopChannel.OverlayResize,
  HyperDesktopChannel.OverlayHide,
  HyperDesktopChannel.OverlayOpenMain,
] as const;

export function registerHyperDesktopIpc(deps: HyperDesktopIpcDeps): () => void {
  const assertTrusted = (event: IpcMainInvokeEvent) => {
    if (!deps.trustedWindows.isTrustedSender(event)) {
      throw new Error('Untrusted desktop caller refused.');
    }
  };

  ipcMain.handle(HyperDesktopChannel.GetSettings, async (event) => {
    assertTrusted(event);
    return await deps.getSettings();
  });

  ipcMain.handle(HyperDesktopChannel.SetSettings, async (event, rawPatch: unknown) => {
    assertTrusted(event);
    const parsed = settingsPatchSchema.safeParse(rawPatch);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? 'Invalid desktop settings update.');
    }
    return await deps.setSettings(parsed.data);
  });

  ipcMain.handle(HyperDesktopChannel.OverlayResize, async (event, rawBounds: unknown) => {
    assertTrusted(event);
    const parsed = overlayResizeSchema.safeParse(rawBounds);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? 'Invalid overlay size.');
    }
    await deps.resizeOverlay(parsed.data);
  });

  ipcMain.handle(HyperDesktopChannel.OverlayHide, async (event) => {
    assertTrusted(event);
    await deps.hideOverlay();
  });

  ipcMain.handle(HyperDesktopChannel.OverlayOpenMain, async (event, rawTarget?: unknown) => {
    assertTrusted(event);
    const parsed = openMainSchema.safeParse(rawTarget);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? 'Invalid main window target.');
    }
    await deps.openMain(parsed.data);
  });

  return () => {
    for (const channel of CHANNELS) {
      ipcMain.removeHandler(channel);
    }
  };
}
