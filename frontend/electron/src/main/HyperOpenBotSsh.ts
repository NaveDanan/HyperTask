import path from 'node:path';

/** Both addresses identify the existing MMEMS-mems01 backend; host keys remain OS-managed. */
export function hyperOpenBotSshTarget() {
  return process.platform === 'win32'
    ? { command: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe'), host: 'agent@mmems-mems01' }
    : { command: '/usr/bin/ssh', host: 'agent@100.104.170.51' };
}
