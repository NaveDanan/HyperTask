import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { hyperOpenBotSshTarget } from './HyperOpenBotSsh';
import { hyperOpenBotSocketPath, closeHyperOpenBotTunnel } from './HyperOpenBotTunnel';
vi.mock('electron', () => ({ app: { once() {} } }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(() => { closeHyperOpenBotTunnel(); Object.defineProperty(process, 'platform', platform); });
it('uses native Windows OpenSSH and the reachable internal address of the existing VM', () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  expect(hyperOpenBotSshTarget()).toEqual({ command: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe'), host: 'agent@mmems-mems01' });
});
it('keeps the existing Linux SSH address', () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  expect(hyperOpenBotSshTarget()).toEqual({ command: '/usr/bin/ssh', host: 'agent@100.104.170.51' });
});
it.skipIf(process.platform !== 'win32')('creates a private named pipe on Windows instead of refusing the platform', async () => {
  const pipe = await hyperOpenBotSocketPath();
  expect(pipe).toMatch(/^\\\\\.\\pipe\\hypertask-openbot-/);
});
it.skipIf(process.platform !== 'win32')('cancels a pending Windows pipe startup and allows a fresh connection', async () => {
  const pending = hyperOpenBotSocketPath();
  const rejected = expect(pending).rejects.toThrow('cancelled');
  closeHyperOpenBotTunnel();
  await rejected;
  expect(await hyperOpenBotSocketPath()).toMatch(/^\\\\\.\\pipe\\hypertask-openbot-/);
}, 5000);
