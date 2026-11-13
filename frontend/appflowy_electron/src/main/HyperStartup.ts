import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { App } from 'electron';
import type { HyperStartupState } from '@shared/api';
import type { SharedPreferences } from './prefs';

const PREFERENCE = 'hyperStartAtLogin';
const DESKTOP_FILE = 'hypertask.desktop';

interface HyperStartupOptions {
  app: Pick<App, 'isPackaged' | 'getLoginItemSettings' | 'setLoginItemSettings'>;
  prefs: Pick<SharedPreferences, 'get' | 'set'>;
  platform: NodeJS.Platform;
  executable: string;
  appImage?: string;
  home: string;
  configHome?: string;
}

// Desktop Exec values use two levels of escaping, not shell quoting. As in
// CPA-Desktop, env avoids GLib's executable check before %% expansion.
function desktopArgument(value: string): string {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('The startup path contains control characters.');
  const quoted = '"' + value.replace(/%/g, '%%').replace(/[\\"`$]/g, '\\$&') + '"';
  return quoted.replace(/\\/g, '\\\\');
}

export class HyperStartup {
  private readonly file: string;

  constructor(private readonly options: HyperStartupOptions) {
    const { configHome, home } = options;
    this.file = path.join(configHome && path.isAbsolute(configHome) ? configHome : path.join(home, '.config'), 'autostart', DESKTOP_FILE);
  }

  private unavailable(): string | null {
    if (!this.options.app.isPackaged) return 'Available in the installed desktop app.';
    if (!['win32', 'darwin', 'linux'].includes(this.options.platform)) return 'Startup is unavailable on this system.';
    return null;
  }

  private loginOptions() {
    return this.options.platform === 'win32' ? { path: this.options.executable, args: ['--background'] } : {};
  }

  async get(): Promise<HyperStartupState> {
    const reason = this.unavailable();
    if (reason) return { enabled: false, available: false, reason };
    if (this.options.platform !== 'linux') {
      const settings = this.options.app.getLoginItemSettings(this.loginOptions());
      const enabled = settings.openAtLogin &&
        (this.options.platform !== 'win32' || settings.executableWillLaunchAtLogin !== false);
      return { enabled, available: true };
    }
    try {
      const entry = await fs.readFile(this.file, 'utf8');
      return { enabled: !/^Hidden\s*=\s*true\s*$/mi.test(entry) && !/^X-GNOME-Autostart-enabled\s*=\s*false\s*$/mi.test(entry), available: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { enabled: false, available: true };
    }
  }

  async set(enabled: boolean): Promise<HyperStartupState> {
    if (typeof enabled !== 'boolean') throw new Error('Startup must be enabled or disabled.');
    const reason = this.unavailable();
    if (reason) throw new Error(reason);
    if (this.options.platform === 'linux') {
      if (enabled) {
        // AppImage's process.execPath is inside a temporary mount. Register the
        // original AppImage so the entry also works after a reboot or update.
        const executable = this.options.appImage || this.options.executable;
        if (!path.isAbsolute(executable)) throw new Error('Startup requires an absolute executable path.');
        // env treats an argument containing '=' as an environment assignment.
        if (executable.includes('=')) throw new Error('Move HyperTask to a path without an equals sign to enable startup.');
        const entry = '[Desktop Entry]\nType=Application\nName=HyperTask\n' +
          `Exec=/usr/bin/env -- ${desktopArgument(executable)} --background\n` +
          'Terminal=false\nStartupNotify=false\nX-GNOME-Autostart-enabled=true\n';
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const temp = `${this.file}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temp, entry, { mode: 0o644, flag: 'wx' });
          await fs.rename(temp, this.file);
        } finally {
          await fs.rm(temp, { force: true });
        }
      } else {
        await fs.rm(this.file, { force: true });
      }
    } else {
      this.options.app.setLoginItemSettings({
        ...this.loginOptions(), openAtLogin: enabled,
        ...(this.options.platform === 'win32' ? { enabled } : {}),
      });
    }
    const state = await this.get();
    if (state.enabled !== enabled) throw new Error('Could not change startup. Check your system login-item settings.');
    await this.options.prefs.set(PREFERENCE, enabled);
    return state;
  }

  async initialize(): Promise<void> {
    if (this.unavailable()) return;
    const saved = await this.options.prefs.get(PREFERENCE);
    if (saved === undefined) {
      await this.set(true);
    } else if (this.options.platform === 'linux' && (await this.get()).enabled) {
      // Refresh a moved AppImage without re-enabling an entry disabled outside the app.
      await this.set(true);
    }
  }
}
