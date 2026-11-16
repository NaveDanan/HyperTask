import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Keep the existing Windows registry identity. Linux uses its stable machine ID;
 * an empty ID prevents the Rust collaboration/folder service from reopening data.
 * IDs are read on each call and never regenerated or written to the data store.
 */
export async function readDeviceId(): Promise<string> {
  if (process.platform === 'linux') {
    for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try {
        const value = (await fs.readFile(file, 'utf8')).trim();
        if (/^[a-f0-9]{32}$/i.test(value) && !/^0+$/.test(value)) return value;
      } catch { /* The DBus location may remain available on older Linux systems. */ }
    }
    throw new Error('A valid Linux machine ID is required to open workspace data.');
  }
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
