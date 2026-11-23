import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, type Settings as ElectronLoginSettings } from 'electron';
import {
  HYPER_DESKTOP_AUTOSTART_ARG,
  HYPER_DESKTOP_HOTKEY_LABEL,
  type HyperDesktopSettingsPatch,
  type HyperDesktopSettingsSnapshot,
} from '@shared/HyperDesktop';
import type { SharedPreferences } from './prefs';

export const HYPER_DESKTOP_PREF_AUTO_START = 'hyperDesktop.autoStart';
export const HYPER_DESKTOP_PREF_CLOSE_TO_TRAY = 'hyperDesktop.closeToTray';

export interface HyperDesktopHotkeyStatus {
  hotkey: string;
  registered: boolean;
  error?: string;
}

export interface HyperDesktopSettingsDeps {
  prefs: Pick<SharedPreferences, 'get' | 'set'>;
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  execPath?: string;
  homeDir?: string;
  appName?: string;
  setLoginItemSettings?: (settings: ElectronLoginSettings) => void;
  fsOps?: Pick<typeof fs, 'mkdir' | 'writeFile' | 'unlink'>;
  hotkeyStatus?: () => HyperDesktopHotkeyStatus;
}

function parseBoolPref(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function escapeDesktopExec(execPath: string): string {
  return execPath.replace(/(["\\`$])/g, '\\$1');
}

export function isHyperAutoStartLaunch(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
  wasOpenedAtLogin = false,
): boolean {
  if (argv.includes(HYPER_DESKTOP_AUTOSTART_ARG)) return true;
  return platform === 'darwin' && wasOpenedAtLogin;
}

/**
 * Manages persisted desktop shell preferences (OS auto-start default ON, close-to-tray default ON)
 * and applies OS login-item registration on packaged builds across Windows, macOS, and Linux.
 */
export class HyperDesktopSettings {
  private autoStart = true;
  private closeToTray = true;
  private autoStartApplied = false;
  private loaded = false;
  private readonly listeners = new Set<(snapshot: HyperDesktopSettingsSnapshot) => void>();

  private readonly isPackaged: boolean;
  private readonly platform: NodeJS.Platform;
  private readonly execPath: string;
  private readonly homeDir: string;
  private readonly appName: string;
  private readonly setLoginItemSettings: (settings: ElectronLoginSettings) => void;
  private readonly fsOps: Pick<typeof fs, 'mkdir' | 'writeFile' | 'unlink'>;
  private readonly hotkeyStatus: () => HyperDesktopHotkeyStatus;

  constructor(private readonly deps: HyperDesktopSettingsDeps) {
    this.isPackaged = deps.isPackaged ?? app.isPackaged;
    this.platform = deps.platform ?? process.platform;
    this.execPath = deps.execPath ?? process.execPath;
    this.homeDir = deps.homeDir ?? os.homedir();
    this.appName = deps.appName ?? 'HyperTask';
    this.setLoginItemSettings = deps.setLoginItemSettings ?? ((settings) => app.setLoginItemSettings(settings));
    this.fsOps = deps.fsOps ?? {
      mkdir: fs.mkdir,
      writeFile: fs.writeFile,
      unlink: fs.unlink,
    };
    this.hotkeyStatus = deps.hotkeyStatus ?? (() => ({ hotkey: HYPER_DESKTOP_HOTKEY_LABEL, registered: false }));
  }

  get autoStartSupported(): boolean {
    return this.platform === 'win32' || this.platform === 'darwin' || this.platform === 'linux';
  }

  get shouldCloseToTray(): boolean {
    return this.closeToTray;
  }

  get autoStartEnabled(): boolean {
    return this.autoStart;
  }

  onChange(listener: (snapshot: HyperDesktopSettingsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snap);
      } catch {
        /* Listener errors must not break settings updates. */
      }
    }
  }

  async init(): Promise<HyperDesktopSettingsSnapshot> {
    if (!this.loaded) {
      const [rawAutoStart, rawCloseToTray] = await Promise.all([
        this.deps.prefs.get(HYPER_DESKTOP_PREF_AUTO_START),
        this.deps.prefs.get(HYPER_DESKTOP_PREF_CLOSE_TO_TRAY),
      ]);
      this.autoStart = parseBoolPref(rawAutoStart, true);
      this.closeToTray = parseBoolPref(rawCloseToTray, true);
      this.loaded = true;
      await this.applyAutoStart(this.autoStart);
    }
    return this.getSnapshot();
  }

  getSnapshot(): HyperDesktopSettingsSnapshot {
    const hotkey = this.hotkeyStatus();
    return {
      autoStart: this.autoStart,
      closeToTray: this.closeToTray,
      autoStartSupported: this.autoStartSupported,
      autoStartApplied: this.autoStartApplied,
      hotkey: hotkey.hotkey,
      hotkeyRegistered: hotkey.registered,
      ...(hotkey.error ? { hotkeyError: hotkey.error } : {}),
    };
  }

  async update(patch: HyperDesktopSettingsPatch): Promise<HyperDesktopSettingsSnapshot> {
    if (!this.loaded) await this.init();
    let changed = false;
    if (typeof patch.autoStart === 'boolean') {
      if (patch.autoStart !== this.autoStart) changed = true;
      this.autoStart = patch.autoStart;
      await this.deps.prefs.set(HYPER_DESKTOP_PREF_AUTO_START, this.autoStart);
      await this.applyAutoStart(this.autoStart);
    }
    if (typeof patch.closeToTray === 'boolean') {
      if (patch.closeToTray !== this.closeToTray) changed = true;
      this.closeToTray = patch.closeToTray;
      await this.deps.prefs.set(HYPER_DESKTOP_PREF_CLOSE_TO_TRAY, this.closeToTray);
    }
    if (changed) this.emit();
    return this.getSnapshot();
  }

  private linuxAutostartFile(): string {
    return path.join(this.homeDir, '.config', 'autostart', 'hypertask.desktop');
  }

  private async applyAutoStart(enabled: boolean): Promise<void> {
    if (!this.autoStartSupported || !this.isPackaged) {
      this.autoStartApplied = false;
      return;
    }
    try {
      if (this.platform === 'win32') {
        this.setLoginItemSettings({
          openAtLogin: enabled,
          path: this.execPath,
          args: enabled ? [HYPER_DESKTOP_AUTOSTART_ARG] : [],
        });
        this.autoStartApplied = true;
        return;
      }
      if (this.platform === 'darwin') {
        this.setLoginItemSettings({
          openAtLogin: enabled,
        });
        this.autoStartApplied = true;
        return;
      }
      if (this.platform === 'linux') {
        const desktopFile = this.linuxAutostartFile();
        if (enabled) {
          await this.fsOps.mkdir(path.dirname(desktopFile), { recursive: true });
          const content = [
            '[Desktop Entry]',
            'Type=Application',
            `Name=${this.appName}`,
            `Exec="${escapeDesktopExec(this.execPath)}" ${HYPER_DESKTOP_AUTOSTART_ARG}`,
            'X-GNOME-Autostart-enabled=true',
            'NoDisplay=false',
            '',
          ].join('\n');
          await this.fsOps.writeFile(desktopFile, content, 'utf8');
        } else {
          await this.fsOps.unlink(desktopFile).catch((error: NodeJS.ErrnoException) => {
            if (error?.code !== 'ENOENT') throw error;
          });
        }
        this.autoStartApplied = true;
      }
    } catch (error) {
      this.autoStartApplied = false;
      console.warn('[hyper-desktop] failed to apply OS auto-start setting', error);
    }
  }
}
