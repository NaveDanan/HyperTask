import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ globalShortcut: { register: vi.fn(), unregister: vi.fn() } }));
import { HYPER_DESKTOP_DEFAULT_HOTKEY, HYPER_DESKTOP_HOTKEY_LABEL } from '@shared/HyperDesktop';
import { HyperGlobalShortcuts } from './HyperGlobalShortcuts';

describe('HyperGlobalShortcuts', () => {
  it('registers Control+Alt+Space, invokes onTrigger, and unregisters on dispose', () => {
    let callback: (() => void) | undefined;
    const backend = {
      register: vi.fn((_acc: string, cb: () => void) => {
        callback = cb;
        return true;
      }),
      unregister: vi.fn(),
    };
    const onTrigger = vi.fn();
    const shortcuts = new HyperGlobalShortcuts({ onTrigger, backend });

    const status = shortcuts.register();
    expect(status).toEqual({ hotkey: HYPER_DESKTOP_HOTKEY_LABEL, registered: true });
    expect(backend.register).toHaveBeenCalledWith(HYPER_DESKTOP_DEFAULT_HOTKEY, expect.any(Function));

    callback?.();
    expect(onTrigger).toHaveBeenCalledTimes(1);

    shortcuts.dispose();
    expect(backend.unregister).toHaveBeenCalledWith(HYPER_DESKTOP_DEFAULT_HOTKEY);
    expect(shortcuts.status().registered).toBe(false);
  });

  it('reports conflict error cleanly when shortcut registration returns false', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const backend = {
      register: vi.fn(() => false),
      unregister: vi.fn(),
    };
    const shortcuts = new HyperGlobalShortcuts({ onTrigger: vi.fn(), backend });
    const status = shortcuts.register();
    expect(status.registered).toBe(false);
    expect(status.error).toContain(HYPER_DESKTOP_HOTKEY_LABEL);
    shortcuts.dispose();
    expect(backend.unregister).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
