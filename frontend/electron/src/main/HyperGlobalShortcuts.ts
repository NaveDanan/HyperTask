import { globalShortcut } from 'electron';
import { HYPER_DESKTOP_DEFAULT_HOTKEY, HYPER_DESKTOP_HOTKEY_LABEL } from '@shared/HyperDesktop';
import type { HyperDesktopHotkeyStatus } from './HyperDesktopSettings';

export interface HyperGlobalShortcutBackend {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  isRegistered?(accelerator: string): boolean;
}

export interface HyperGlobalShortcutsDeps {
  accelerator?: string;
  label?: string;
  onTrigger: () => void;
  backend?: HyperGlobalShortcutBackend;
}

/** Registers and tracks the global Ctrl+Alt+Space shortcut that summons the Hyper-Bot voice sphere. */
export class HyperGlobalShortcuts {
  private readonly accelerator: string;
  private readonly label: string;
  private readonly backend: HyperGlobalShortcutBackend;
  private registered = false;
  private error: string | undefined;

  constructor(private readonly deps: HyperGlobalShortcutsDeps) {
    this.accelerator = deps.accelerator ?? HYPER_DESKTOP_DEFAULT_HOTKEY;
    this.label = deps.label ?? HYPER_DESKTOP_HOTKEY_LABEL;
    this.backend = deps.backend ?? globalShortcut;
  }

  register(): HyperDesktopHotkeyStatus {
    this.dispose();
    try {
      const ok = this.backend.register(this.accelerator, () => {
        this.deps.onTrigger();
      });
      this.registered = ok === true;
      this.error = this.registered
        ? undefined
        : `Global shortcut ${this.label} could not be registered. Another application may already be using it.`;
      if (!this.registered) {
        console.warn(`[hyper-desktop] ${this.error}`);
      }
    } catch (cause) {
      this.registered = false;
      this.error = cause instanceof Error ? cause.message : String(cause);
      console.warn(`[hyper-desktop] failed to register ${this.label}`, cause);
    }
    return this.status();
  }

  status(): HyperDesktopHotkeyStatus {
    return {
      hotkey: this.label,
      registered: this.registered,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  dispose(): void {
    if (!this.registered) return;
    this.registered = false;
    try {
      this.backend.unregister(this.accelerator);
    } catch {
      /* Ignore unregister errors during app teardown. */
    }
  }
}
