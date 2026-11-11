import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { App } from 'electron';
import { HYPER_DESKTOP_APP_ID, HYPER_DESKTOP_FILE } from '../shared/HyperDesktopIdentity';
function nativeBundleId(): string {
  return execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.resolve(process.resourcesPath, '../Info.plist')], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}
/** Call before app.ready. Does not change app.name, userData, credentials or protocols.
 * A stock macOS Electron.app must not claim a HyperTask bundle identity. */
export function hyperBindDesktopIdentity(app: Pick<App, 'setDesktopName' | 'setAppUserModelId'>, platform: NodeJS.Platform, bundleId: () => string = nativeBundleId): boolean {
  if (platform === 'linux') { app.setDesktopName(HYPER_DESKTOP_FILE); return true; }
  if (platform === 'win32') { app.setAppUserModelId(HYPER_DESKTOP_APP_ID); return true; }
  if (platform === 'darwin') { try { return bundleId() === HYPER_DESKTOP_APP_ID; } catch { return false; } }
  return false;
}
