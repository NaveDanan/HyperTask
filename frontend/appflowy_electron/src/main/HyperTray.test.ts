import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { HyperTray } from './HyperTray';

const mocks = vi.hoisted(() => ({ trays: [] as unknown[] }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Menu: { buildFromTemplate: (items: unknown[]) => items },
    Tray: class extends EventEmitter {
      menu: MenuItemConstructorOptions[] = [];
      destroyed = false;
      constructor() { super(); mocks.trays.push(this); }
      setToolTip() {}
      setContextMenu(menu: MenuItemConstructorOptions[]) { this.menu = menu; }
      isDestroyed() { return this.destroyed; }
      destroy() { this.destroyed = true; }
    },
  };
});

describe('HyperTray', () => {
  it('hides on close, opens from the tray, and lets Quit close the window', () => {
    let quitting = false;
    const open = vi.fn();
    const quit = vi.fn(() => { quitting = true; });
    const window = Object.assign(new EventEmitter(), { hide: vi.fn() });
    const tray = new HyperTray('icon.png', open, quit);
    tray.attach(window as unknown as BrowserWindow, () => quitting);
    const native = mocks.trays.at(-1) as EventEmitter & { menu: Array<{ click?: () => void }> };
    const event = { preventDefault: vi.fn() };
    window.emit('close', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();

    native.emit('click');
    native.emit('double-click');
    native.menu[0].click?.();
    expect(open).toHaveBeenCalledTimes(3);
    native.menu[2].click?.();
    expect(quit).toHaveBeenCalledOnce();
    event.preventDefault.mockClear();
    window.emit('close', event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    tray.destroy();
  });

  it('does not trap a window when its tray has been destroyed', () => {
    const window = Object.assign(new EventEmitter(), { hide: vi.fn() });
    const tray = new HyperTray('icon.png', vi.fn(), vi.fn());
    tray.attach(window as unknown as BrowserWindow, () => false);
    tray.destroy();
    const event = { preventDefault: vi.fn() };
    window.emit('close', event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  });
});
