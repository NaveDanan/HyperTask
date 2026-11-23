import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ Tray: vi.fn(), Menu: { buildFromTemplate: vi.fn() }, nativeImage: { createFromPath: vi.fn(), createEmpty: vi.fn() } }));
import type { MenuItemConstructorOptions } from 'electron';
import { HyperTray, resolveHyperTrayIconPath } from './HyperTray';

function createFakeTray() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
  });
}

describe('HyperTray', () => {
  it('resolves platform-appropriate tray icons', () => {
    const existing = new Set<string>([
      'C:\\app\\resources\\hypertask.ico',
      '/app/resources/hypertask.ico',
      '/app/out/renderer/favicon.png',
    ]);
    const exists = (p: string) => existing.has(p) || existing.has(p.replace(/\//g, '\\')) || existing.has(p.replace(/\\/g, '/'));
    expect(resolveHyperTrayIconPath('C:\\app', 'win32', exists)).toMatch(/hypertask\.ico$/);
    expect(resolveHyperTrayIconPath('/app', 'linux', exists)).toMatch(/favicon\.png$/);
  });

  it('creates tray menu with Ask Hyper-Bot, Show/Hide, Settings, and Quit actions', () => {
    const fakeTray = createFakeTray();
    let visible = false;
    let lastTemplate: MenuItemConstructorOptions[] = [];
    const callbacks = {
      onAskVoice: vi.fn(),
      onShowMain: vi.fn(() => {
        visible = true;
      }),
      onHideMain: vi.fn(() => {
        visible = false;
      }),
      onOpenSettings: vi.fn(),
      onQuit: vi.fn(),
    };
    const fakeImage = { isEmpty: () => false, resize: vi.fn(() => fakeImage) };
    const tray = new HyperTray({
      appRoot: '/app',
      platform: 'win32',
      isMainVisible: () => visible,
      ...callbacks,
      createTray: () => fakeTray,
      buildMenu: (template) => {
        lastTemplate = template;
        return { template } as never;
      },
      createImageFromPath: () => fakeImage as never,
      createEmptyImage: () => fakeImage as never,
      exists: () => true,
    });

    tray.init();
    expect(fakeTray.setToolTip).toHaveBeenCalledWith('HyperTask');
    expect(lastTemplate.map((item) => item.label ?? item.type)).toEqual([
      'Ask Hyper-Bot (Ctrl+Alt+Space)',
      'Show HyperTask',
      'Settings',
      'separator',
      'Quit HyperTask',
    ]);

    // Click triggers Show; menu refreshes to Hide.
    fakeTray.emit('click');
    expect(callbacks.onShowMain).toHaveBeenCalledTimes(1);
    tray.refreshMenu();
    expect(lastTemplate[1]?.label).toBe('Hide HyperTask');

    // Trigger each context menu item.
    lastTemplate[0]?.click?.({} as never, undefined, {} as never);
    expect(callbacks.onAskVoice).toHaveBeenCalledTimes(1);
    lastTemplate[1]?.click?.({} as never, undefined, {} as never);
    expect(callbacks.onHideMain).toHaveBeenCalledTimes(1);
    lastTemplate[2]?.click?.({} as never, undefined, {} as never);
    expect(callbacks.onOpenSettings).toHaveBeenCalledTimes(1);
    lastTemplate[4]?.click?.({} as never, undefined, {} as never);
    expect(callbacks.onQuit).toHaveBeenCalledTimes(1);

    tray.dispose();
    expect(fakeTray.destroy).toHaveBeenCalledTimes(1);
  });
});
