import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoginItemSettings } from 'electron';
import { HyperStartup } from './HyperStartup';
import { SharedPreferences } from './prefs';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

async function fixture(overrides: Partial<ConstructorParameters<typeof HyperStartup>[0]> = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-startup-'));
  dirs.push(home);
  const prefs = new SharedPreferences(path.join(home, 'prefs.json'));
  let login = false;
  const app = {
    isPackaged: true,
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: login, executableWillLaunchAtLogin: login }) as LoginItemSettings),
    setLoginItemSettings: vi.fn((settings: { openAtLogin?: boolean }) => { login = settings.openAtLogin ?? false; }),
  };
  const options = { app, prefs, platform: 'linux' as NodeJS.Platform, executable: '/opt/HyperTask/hypertask', home, ...overrides };
  return { startup: new HyperStartup(options), options, home, prefs, app, file: path.join(home, '.config/autostart/hypertask.desktop') };
}

describe('HyperStartup', () => {
  it('enables first-run startup, removes it when toggled off, and keeps it off after restart', async () => {
    const { startup, file, options } = await fixture();
    await startup.initialize();
    expect(await startup.get()).toEqual({ enabled: true, available: true });
    expect(await fs.readFile(file, 'utf8')).toContain('Exec=/usr/bin/env -- "/opt/HyperTask/hypertask" --background');
    await startup.set(false);
    await new HyperStartup(options).initialize();
    expect(await startup.get()).toEqual({ enabled: false, available: true });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses the persistent AppImage path and escapes desktop Exec metacharacters', async () => {
    const appImage = '/home/me/Hyper Task 100% "test" $HOME `command` \\.AppImage';
    const { startup, file } = await fixture({ appImage, executable: '/tmp/.mount_Hyper/usr/bin/hypertask' });
    await startup.set(true);
    const entry = await fs.readFile(file, 'utf8');
    expect(entry).not.toContain('/tmp/.mount_');
    // Decode desktop string escaping, then Exec argument quoting, as a launcher does.
    const exec = entry.split('\n').find((line) => line.startsWith('Exec='))!.slice(5).replace(/\\\\/g, '\\');
    const quotedPath = exec.slice('/usr/bin/env -- "'.length, -'" --background'.length);
    expect(quotedPath.replace(/\\([\\"`$])/g, '$1').replace(/%%/g, '%')).toBe(appImage);
  });

  it('refreshes an enabled entry when the AppImage moves', async () => {
    const { startup, options, file } = await fixture({ appImage: '/apps/old.AppImage' });
    await startup.initialize();
    await new HyperStartup({ ...options, appImage: '/apps/new.AppImage' }).initialize();
    expect(await fs.readFile(file, 'utf8')).toContain('"/apps/new.AppImage"');
  });

  it.each(['Hidden=true', 'X-GNOME-Autostart-enabled=false'])('respects externally disabled startup: %s', async (flag) => {
    const { startup, file } = await fixture();
    await startup.initialize();
    await fs.appendFile(file, `${flag}\n`);
    await startup.initialize();
    expect((await startup.get()).enabled).toBe(false);
  });

  it('uses XDG_CONFIG_HOME without changing other apps', async () => {
    const { options, home } = await fixture();
    const configHome = path.join(home, 'custom-config');
    const startup = new HyperStartup({ ...options, configHome });
    await fs.mkdir(path.join(configHome, 'autostart'), { recursive: true });
    const other = path.join(configHome, 'autostart/other.desktop');
    await fs.writeFile(other, 'other app');
    await startup.set(true);
    await fs.access(path.join(configHome, 'autostart/hypertask.desktop'));
    await startup.set(false);
    expect(await fs.readFile(other, 'utf8')).toBe('other app');
  });

  it('does not register development builds', async () => {
    const { options, app, file } = await fixture();
    app.isPackaged = false;
    const startup = new HyperStartup(options);
    await startup.initialize();
    expect((await startup.get()).available).toBe(false);
    await expect(startup.set(true)).rejects.toThrow('installed desktop app');
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it.each(['win32', 'darwin'] as const)('toggles native %s login items with matching read/write options', async (platform) => {
    const { startup, app } = await fixture({ platform, executable: 'C:\\Program Files\\HyperTask\\HyperTask.exe' });
    await startup.initialize();
    expect((await startup.get()).enabled).toBe(true);
    const options = platform === 'win32' ? { path: 'C:\\Program Files\\HyperTask\\HyperTask.exe', args: ['--background'] } : {};
    expect(app.getLoginItemSettings).toHaveBeenLastCalledWith(options);
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({ ...options, openAtLogin: true, ...(platform === 'win32' ? { enabled: true } : {}) });
    await startup.set(false);
    await startup.initialize();
    expect((await startup.get()).enabled).toBe(false);
    expect(app.setLoginItemSettings).toHaveBeenCalledTimes(2);
  });

  it('reports a native registration failure without persisting success', async () => {
    const { startup, app, prefs } = await fixture({ platform: 'darwin' });
    app.setLoginItemSettings.mockImplementation(() => {});
    await expect(startup.set(true)).rejects.toThrow('Could not change startup');
    expect(await prefs.get('hyperStartAtLogin')).toBeUndefined();
  });

  it('rejects malformed IPC values and control characters before writing anything', async () => {
    const { startup, file } = await fixture({ appImage: '/apps/Hyper\nTask.AppImage' });
    await expect(startup.set('true' as unknown as boolean)).rejects.toThrow('enabled or disabled');
    await expect(startup.set(true)).rejects.toThrow('control characters');
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects paths that env would treat as an assignment', async () => {
    const { startup, file } = await fixture({ appImage: '/apps/Hyper=Task.AppImage' });
    await expect(startup.set(true)).rejects.toThrow('equals sign');
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not persist success when the autostart directory cannot be written', async () => {
    const { options, home, prefs } = await fixture();
    const configHome = path.join(home, 'not-a-directory');
    await fs.writeFile(configHome, 'file');
    const startup = new HyperStartup({ ...options, configHome });
    await expect(startup.set(true)).rejects.toThrow();
    expect(await prefs.get('hyperStartAtLogin')).toBeUndefined();
  });
});
