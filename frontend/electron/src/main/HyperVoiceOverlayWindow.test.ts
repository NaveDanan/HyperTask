import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  screen: { getCursorScreenPoint: vi.fn(), getDisplayNearestPoint: vi.fn() },
  systemPreferences: { getMediaAccessStatus: vi.fn(), askForMediaAccess: vi.fn() },
}));
import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from 'electron';
import { HyperDesktopChannel } from '@shared/HyperDesktop';
import { HyperTrustedWindows } from './HyperTrustedWindows';
import { HyperVoiceOverlayWindow, clampOverlayBounds } from './HyperVoiceOverlayWindow';

function createFakeWindow() {
  const emitter = new EventEmitter();
  let visible = false;
  let destroyed = false;
  const webContents = Object.assign(new EventEmitter(), {
    mainFrame: {},
    isDestroyed: () => destroyed,
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    getURL: () => 'http://localhost:5173/?mode=voice-overlay',
  });
  return Object.assign(emitter, {
    webContents,
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setBounds: vi.fn(),
    show: vi.fn(() => {
      visible = true;
    }),
    hide: vi.fn(() => {
      visible = false;
    }),
    focus: vi.fn(),
    isVisible: vi.fn(() => visible),
    isDestroyed: vi.fn(() => destroyed),
    loadURL: vi.fn(async () => undefined),
    loadFile: vi.fn(async () => undefined),
    destroy: vi.fn(() => {
      destroyed = true;
      emitter.emit('closed');
    }),
  });
}

describe('HyperVoiceOverlayWindow', () => {
  it('clamps overlay bounds cleanly inside small and normal display workAreas', () => {
    const workArea: Rectangle = { x: 1920, y: 0, width: 1920, height: 1040 };
    const compact = clampOverlayBounds(workArea, { width: 320, height: 320 });
    expect(compact.width).toBe(320);
    expect(compact.height).toBe(320);
    expect(compact.x).toBe(1920 + (1920 - 320) / 2);
    expect(compact.y).toBeGreaterThanOrEqual(24);
    expect(compact.y + compact.height).toBeLessThanOrEqual(1040 - 24);

    const tinyArea: Rectangle = { x: 0, y: 0, width: 400, height: 400 };
    const expanded = clampOverlayBounds(tinyArea, { width: 520, height: 600 });
    expect(expanded.width).toBe(352);
    expect(expanded.height).toBe(352);
    expect(expanded.x).toBe(24);
    expect(expanded.y).toBe(24);
  });

  it('creates transparent always-on-top overlay, registers as trusted, triggers, resizes, hides without destroying, and destroys on dispose', async () => {
    const trustedWindows = new HyperTrustedWindows();
    let createdOptions: BrowserWindowConstructorOptions | undefined;
    const fakeWin = createFakeWindow();
    const overlay = new HyperVoiceOverlayWindow({
      preloadPath: '/app/out/preload/index.js',
      rendererHtmlPath: '/app/out/renderer/index.html',
      rendererUrl: 'http://localhost:5173',
      isPackaged: false,
      platform: 'win32',
      trustedWindows,
      createBrowserWindow: (opts) => {
        createdOptions = opts;
        return fakeWin as unknown as BrowserWindow;
      },
      getCursorWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1040 }),
    });

    await overlay.trigger('hotkey');

    expect(createdOptions).toMatchObject({
      transparent: true,
      frame: false,
      thickFrame: false,
      hasShadow: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
    });
    expect(fakeWin.loadURL).toHaveBeenCalledWith('http://localhost:5173?mode=voice-overlay');
    expect(fakeWin.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    expect(fakeWin.show).toHaveBeenCalledTimes(1);
    expect(fakeWin.focus).toHaveBeenCalledTimes(1);
    expect(fakeWin.webContents.send).toHaveBeenCalledWith(HyperDesktopChannel.OverlayEvent, {
      type: 'trigger',
      source: 'hotkey',
    });
    expect(
      trustedWindows.isTrustedSender({
        sender: fakeWin.webContents as never,
        senderFrame: fakeWin.webContents.mainFrame as never,
      }),
    ).toBe(true);

    // Resize updates bounds within active display.
    overlay.resize({ width: 460, height: 540 });
    expect(fakeWin.setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 460, height: 540 }),
      false,
    );

    // Close event hides instead of destroying while not disposing.
    const preventDefault = vi.fn();
    fakeWin.emit('close', { preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(fakeWin.hide).toHaveBeenCalledTimes(1);
    expect(fakeWin.webContents.send).toHaveBeenLastCalledWith(HyperDesktopChannel.OverlayEvent, {
      type: 'hidden',
    });
    expect(fakeWin.destroy).not.toHaveBeenCalled();

    // Dispose tears down window and removes from trusted registry.
    overlay.dispose();
    expect(fakeWin.destroy).toHaveBeenCalledTimes(1);
    expect(trustedWindows.webContents()).toHaveLength(0);
  });

  it('loads index.html with ?mode=voice-overlay query when packaged', async () => {
    const trustedWindows = new HyperTrustedWindows();
    const fakeWin = createFakeWindow();
    const overlay = new HyperVoiceOverlayWindow({
      preloadPath: '/app/out/preload/index.js',
      rendererHtmlPath: '/app/out/renderer/index.html',
      isPackaged: true,
      platform: 'win32',
      trustedWindows,
      createBrowserWindow: () => fakeWin as unknown as BrowserWindow,
      getCursorWorkArea: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
    });

    await overlay.prewarm();
    expect(fakeWin.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/index\.html$/),
      { query: { mode: 'voice-overlay' } },
    );
    expect(fakeWin.show).not.toHaveBeenCalled();
    overlay.dispose();
  });
});
