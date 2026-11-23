import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HyperDesktopChannel, type HyperDesktopSettingsSnapshot } from '@shared/HyperDesktop';

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(name, fn),
    removeHandler: (name: string) => ipc.handlers.delete(name),
  },
  ipcRenderer: {
    on: vi.fn(),
    off: vi.fn(),
    invoke: vi.fn(),
    send: vi.fn(),
  },
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
}));

import { HyperTrustedWindows, hyperTrustedWindowAdapter } from './HyperTrustedWindows';
import { registerHyperDesktopIpc } from './HyperDesktopIpc';
import { createHyperBufferedListener } from '../preload/index';

const SNAPSHOT: HyperDesktopSettingsSnapshot = {
  autoStart: true,
  closeToTray: true,
  autoStartSupported: true,
  autoStartApplied: true,
  hotkey: 'Ctrl+Alt+Space',
  hotkeyRegistered: true,
};

describe('HyperDesktopIpc', () => {
  let dispose: (() => void) | undefined;
  const trustedWindows = new HyperTrustedWindows();
  const mainContents = { mainFrame: {}, isDestroyed: () => false, send: vi.fn() };
  const overlayContents = { mainFrame: {}, isDestroyed: () => false, send: vi.fn() };
  const mainWin = { webContents: mainContents, isDestroyed: () => false };
  const overlayWin = { webContents: overlayContents, isDestroyed: () => false };
  const deps = {
    trustedWindows,
    getSettings: vi.fn(() => SNAPSHOT),
    setSettings: vi.fn(async (patch) => ({ ...SNAPSHOT, ...patch })),
    resizeOverlay: vi.fn(),
    hideOverlay: vi.fn(),
    openMain: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ipc.handlers.clear();
    trustedWindows.add(mainWin as never);
    trustedWindows.add(overlayWin as never);
    dispose = registerHyperDesktopIpc(deps);
  });

  afterEach(() => {
    dispose?.();
    trustedWindows.remove(mainWin as never);
    trustedWindows.remove(overlayWin as never);
  });

  it('refuses untrusted windows and subframes across all desktop channels', async () => {
    const badEvents = [
      { sender: mainContents, senderFrame: {} },
      { sender: { mainFrame: {}, isDestroyed: () => false }, senderFrame: mainContents.mainFrame },
    ];
    for (const bad of badEvents) {
      for (const channel of [
        HyperDesktopChannel.GetSettings,
        HyperDesktopChannel.SetSettings,
        HyperDesktopChannel.OverlayResize,
        HyperDesktopChannel.OverlayHide,
        HyperDesktopChannel.OverlayOpenMain,
      ]) {
        await expect(ipc.handlers.get(channel)!(bad, {})).rejects.toThrow('Untrusted desktop caller refused.');
      }
    }
    expect(deps.getSettings).not.toHaveBeenCalled();
  });

  it('allows both main and overlay windows, validates payloads, and cleans up handlers on dispose', async () => {
    const mainEvent = { sender: mainContents, senderFrame: mainContents.mainFrame };
    const overlayEvent = { sender: overlayContents, senderFrame: overlayContents.mainFrame };

    expect(await ipc.handlers.get(HyperDesktopChannel.GetSettings)!(mainEvent)).toEqual(SNAPSHOT);
    expect(
      await ipc.handlers.get(HyperDesktopChannel.SetSettings)!(mainEvent, { autoStart: false }),
    ).toEqual({ ...SNAPSHOT, autoStart: false });

    await expect(
      ipc.handlers.get(HyperDesktopChannel.SetSettings)!(mainEvent, { autoStart: 'yes' }),
    ).rejects.toThrow();

    await ipc.handlers.get(HyperDesktopChannel.OverlayResize)!(overlayEvent, { width: 460, height: 540 });
    expect(deps.resizeOverlay).toHaveBeenCalledWith({ width: 460, height: 540 });

    await expect(
      ipc.handlers.get(HyperDesktopChannel.OverlayResize)!(overlayEvent, { width: -10, height: 100 }),
    ).rejects.toThrow();

    await ipc.handlers.get(HyperDesktopChannel.OverlayHide)!(overlayEvent);
    expect(deps.hideOverlay).toHaveBeenCalledTimes(1);

    await ipc.handlers.get(HyperDesktopChannel.OverlayOpenMain)!(overlayEvent, {
      route: 'hyper-bots',
      roomId: 'dm-abby',
    });
    expect(deps.openMain).toHaveBeenCalledWith({ route: 'hyper-bots', roomId: 'dm-abby' });

    dispose?.();
    dispose = undefined;
    expect(ipc.handlers.size).toBe(0);
  });
});

describe('HyperTrustedWindows', () => {
  it('broadcasts to all live windows, isolates send failures, and supports legacy getter adapter', () => {
    const registry = new HyperTrustedWindows();
    const firstContents = { mainFrame: {}, isDestroyed: () => false, send: vi.fn(() => { throw new Error('disposed'); }) };
    const secondContents = { mainFrame: {}, isDestroyed: () => false, send: vi.fn() };
    const firstWin = { webContents: firstContents, isDestroyed: () => false };
    const secondWin = { webContents: secondContents, isDestroyed: () => false };

    registry.add(firstWin as never);
    registry.add(secondWin as never);

    expect(registry.webContents()).toEqual([firstContents, secondContents]);
    expect(registry.hasWebContents(firstContents as never)).toBe(true);
    expect(registry.hasWebContents(secondContents as never)).toBe(true);

    expect(() => registry.broadcast('hyper-bots:event', { type: 'settings' })).not.toThrow();
    expect(secondContents.send).toHaveBeenCalledWith('hyper-bots:event', { type: 'settings' });

    registry.remove(firstWin as never);
    expect(registry.isTrustedSender({ sender: firstContents as never, senderFrame: firstContents.mainFrame as never })).toBe(false);
    expect(registry.isTrustedSender({ sender: secondContents as never, senderFrame: secondContents.mainFrame as never })).toBe(true);

    const legacy = hyperTrustedWindowAdapter(() => secondWin as never);
    expect(legacy.isTrustedSender({ sender: secondContents as never, senderFrame: secondContents.mainFrame as never })).toBe(true);
    legacy.broadcast('ping', 1);
    expect(secondContents.send).toHaveBeenCalledWith('ping', 1);
  });
});

describe('createHyperBufferedListener', () => {
  it('buffers cold pre-mount overlay triggers and delivers once across StrictMode double-effect', async () => {
    const bus = new EventEmitter();
    const subscribe = createHyperBufferedListener<{ type: string; source?: string }>(
      HyperDesktopChannel.OverlayEvent,
      bus as never,
    );

    // Cold trigger arrives before React.lazy mounts the overlay app.
    bus.emit(HyperDesktopChannel.OverlayEvent, {}, { type: 'trigger', source: 'hotkey' });

    // Simulate React StrictMode mount -> cleanup -> remount within the same tick.
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const unsub1 = subscribe(firstListener);
    unsub1();
    const unsub2 = subscribe(secondListener);

    await Promise.resolve();
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledWith({ type: 'trigger', source: 'hotkey' });

    // Subsequent warm triggers deliver immediately without duplication.
    bus.emit(HyperDesktopChannel.OverlayEvent, {}, { type: 'hidden' });
    expect(secondListener).toHaveBeenCalledTimes(2);
    expect(secondListener).toHaveBeenLastCalledWith({ type: 'hidden' });
    unsub2();
  });
});
