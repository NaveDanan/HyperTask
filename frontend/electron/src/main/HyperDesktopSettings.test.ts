import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { isPackaged: false, setLoginItemSettings: vi.fn() } }));
import { HYPER_DESKTOP_AUTOSTART_ARG } from '@shared/HyperDesktop';
import {
  HYPER_DESKTOP_PREF_AUTO_START,
  HYPER_DESKTOP_PREF_CLOSE_TO_TRAY,
  HyperDesktopSettings,
  isHyperAutoStartLaunch,
} from './HyperDesktopSettings';

function createMemoryPrefs(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
}

describe('HyperDesktopSettings', () => {
  it('defaults autoStart and closeToTray to true and applies Windows login item when packaged', async () => {
    const prefs = createMemoryPrefs();
    const setLoginItemSettings = vi.fn();
    const settings = new HyperDesktopSettings({
      prefs,
      isPackaged: true,
      platform: 'win32',
      execPath: 'C:\\Program Files\\HyperTask\\HyperTask.exe',
      setLoginItemSettings,
      hotkeyStatus: () => ({ hotkey: 'Ctrl+Alt+Space', registered: true }),
    });

    const snapshot = await settings.init();
    expect(snapshot).toEqual({
      autoStart: true,
      closeToTray: true,
      autoStartSupported: true,
      autoStartApplied: true,
      hotkey: 'Ctrl+Alt+Space',
      hotkeyRegistered: true,
    });
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      path: 'C:\\Program Files\\HyperTask\\HyperTask.exe',
      args: [HYPER_DESKTOP_AUTOSTART_ARG],
    });
  });

  it('does not touch OS login items when unpackaged (dev mode), while still persisting toggles', async () => {
    const prefs = createMemoryPrefs();
    const setLoginItemSettings = vi.fn();
    const settings = new HyperDesktopSettings({
      prefs,
      isPackaged: false,
      platform: 'win32',
      execPath: 'C:\\dev\\electron.exe',
      setLoginItemSettings,
    });

    const initial = await settings.init();
    expect(initial.autoStart).toBe(true);
    expect(initial.autoStartApplied).toBe(false);
    expect(setLoginItemSettings).not.toHaveBeenCalled();

    const updated = await settings.update({ autoStart: false, closeToTray: false });
    expect(updated.autoStart).toBe(false);
    expect(updated.closeToTray).toBe(false);
    expect(prefs.store.get(HYPER_DESKTOP_PREF_AUTO_START)).toBe(false);
    expect(prefs.store.get(HYPER_DESKTOP_PREF_CLOSE_TO_TRAY)).toBe(false);
    expect(setLoginItemSettings).not.toHaveBeenCalled();
  });

  it('applies macOS login item settings and removes login item when toggled off', async () => {
    const prefs = createMemoryPrefs();
    const setLoginItemSettings = vi.fn();
    const settings = new HyperDesktopSettings({
      prefs,
      isPackaged: true,
      platform: 'darwin',
      execPath: '/Applications/HyperTask.app/Contents/MacOS/HyperTask',
      setLoginItemSettings,
    });

    await settings.init();
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({
      openAtLogin: true,
    });

    await settings.update({ autoStart: false });
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({
      openAtLogin: false,
    });
  });

  it('writes and removes the XDG desktop entry on Linux packaged builds', async () => {
    const prefs = createMemoryPrefs();
    const fsOps = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    };
    const settings = new HyperDesktopSettings({
      prefs,
      isPackaged: true,
      platform: 'linux',
      homeDir: '/home/tester',
      execPath: '/opt/HyperTask/hypertask',
      fsOps: fsOps as never,
    });

    const snap = await settings.init();
    expect(snap.autoStartApplied).toBe(true);
    expect(fsOps.mkdir).toHaveBeenCalled();
    expect(fsOps.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/autostart[\\/]hypertask\.desktop$/),
      expect.stringContaining(`Exec="/opt/HyperTask/hypertask" ${HYPER_DESKTOP_AUTOSTART_ARG}`),
      'utf8',
    );

    await settings.update({ autoStart: false });
    expect(fsOps.unlink).toHaveBeenCalledWith(expect.stringMatching(/autostart[\\/]hypertask\.desktop$/));
  });

  it('detects auto-start launches via CLI arg or macOS wasOpenedAtLogin', () => {
    expect(isHyperAutoStartLaunch(['HyperTask.exe', HYPER_DESKTOP_AUTOSTART_ARG], 'win32', false)).toBe(true);
    expect(isHyperAutoStartLaunch(['HyperTask.exe'], 'win32', false)).toBe(false);
    expect(isHyperAutoStartLaunch(['HyperTask'], 'darwin', true)).toBe(true);
    expect(isHyperAutoStartLaunch(['HyperTask'], 'win32', true)).toBe(false);
  });
});
