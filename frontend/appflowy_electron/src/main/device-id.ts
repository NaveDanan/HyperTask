import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The device id the Flutter app sends to Rust: device_info_plus `windowsInfo.deviceId`,
 * the registry value HKLM\SOFTWARE\Microsoft\SQMClient\MachineId. It is re-read on each
 * call and never stored, exactly as in the Flutter app. Empty when unavailable.
 */
export async function readDeviceId(): Promise<string> {
  if (process.platform !== 'win32') return '';
  try {
    const { stdout } = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\SQMClient', '/v', 'MachineId'], {
      windowsHide: true,
    });
    return stdout.match(/MachineId\s+REG_SZ\s+(\S+)/)?.[1] ?? '';
  } catch {
    return '';
  }
}
