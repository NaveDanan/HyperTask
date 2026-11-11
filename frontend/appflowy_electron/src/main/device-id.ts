import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The device id the Flutter app sends to Rust: device_info_plus `windowsInfo.deviceId`
 * (the registry value HKLM\SOFTWARE\Microsoft\SQMClient\MachineId) on Windows, the
 * `linuxInfo.deviceId` (/etc/machine-id) on Linux and the `macOsInfo.systemGUID`
 * (IOPlatformUUID) on macOS. It is re-read on each call and never stored, exactly as
 * in the Flutter app. Empty when unavailable (the core rejects an empty device id).
 */

const DMI_LINUX_IDS = ['/etc/machine-id', '/var/lib/dbus/machine-id'];

export async function readDeviceId(): Promise<string> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\SQMClient', '/v', 'MachineId'], {
        windowsHide: true,
      });
      return stdout.match(/MachineId\s+REG_SZ\s+(\S+)/)?.[1] ?? '';
    } catch {
      return '';
    }
  }
  if (process.platform === 'linux') {
    try {
      for (const file of DMI_LINUX_IDS) {
        const id = (await fs.readFile(file, 'utf8')).trim();
        if (id) return id;
      }
    } catch {
      // fall through: unavailable
    }
    return '';
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { windowsHide: true });
      return stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? '';
    } catch {
      return '';
    }
  }
  return '';
}
