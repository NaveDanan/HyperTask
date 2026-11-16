import { expect, it, vi } from 'vitest';
const ipc = vi.hoisted(() => ({ handlers: new Map<string, Function>(), once: vi.fn() }));
vi.mock('electron', () => ({ app: { once: ipc.once }, ipcMain: { handle: (id: string, fn: Function) => ipc.handlers.set(id, fn) } }));
import { registerHyperOpenBotServiceIpc } from './HyperOpenBotServiceIpc';
it('permits only closed service actions from the native main frame', () => {
  const frame = {}, sender = { mainFrame: frame, isDestroyed: () => false, send: vi.fn() };
  const service = { snapshot: vi.fn(), run: vi.fn(), configure: vi.fn(), subscribe: vi.fn(), invalidate: vi.fn() };
  registerHyperOpenBotServiceIpc(() => ({ webContents: sender }) as never, service as never);
  const handler = ipc.handlers.get('hyper-openbot:service-action')!;
  expect(() => handler({ sender, senderFrame: {} }, 'start')).toThrow('refused');
  expect(() => handler({ sender: {}, senderFrame: frame }, 'start')).toThrow('refused');
  for (const action of ['ssh', 'start; id', '/bin/bash', { action: 'start' }, null]) expect(() => handler({ sender, senderFrame: frame }, action)).toThrow('refused');
  expect(service.run).not.toHaveBeenCalled();
  handler({ sender, senderFrame: frame }, 'start'); expect(service.run).toHaveBeenCalledExactlyOnceWith('start');
  const configure = ipc.handlers.get('hyper-openbot:service-configure')!;
  expect(() => configure({ sender, senderFrame: frame }, { host: 'other' })).toThrow('refused');
  configure({ sender, senderFrame: frame }, false); expect(service.configure).toHaveBeenCalledExactlyOnceWith(false);
});
