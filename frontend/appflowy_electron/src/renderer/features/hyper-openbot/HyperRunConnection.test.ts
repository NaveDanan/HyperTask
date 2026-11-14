import { afterEach, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { HyperRunConnectionError, hyperRunConnectionLost, hyperWithRunConnection } from './HyperRunConnection';
import { hyperRunWithRecovery } from './HyperRun';
import { HyperOpenBotSocket } from './socket';
import type { HyperOpenBotSocketEvent } from '@shared/api';
import type { BaseEvent } from '@ag-ui/core';

afterEach(() => vi.unstubAllGlobals());
it('fails only the matching canonical run and tears down its stream', () => {
  const source = new Subject<BaseEvent>(), error = vi.fn(), otherError = vi.fn();
  const own = hyperWithRunConnection({ threadId: 't', runId: 'requested' }, source).subscribe({ error });
  const unaffected = hyperWithRunConnection({ threadId: 'elsewhere', runId: 'canonical' }, new Subject<BaseEvent>()).subscribe({ error: otherError });
  source.next({ type: 'RUN_STARTED', threadId: 't', runId: 'canonical' } as BaseEvent);
  hyperRunConnectionLost({ threadId: 't', runId: 'requested' });
  expect(error).not.toHaveBeenCalled();
  hyperRunConnectionLost({ threadId: 't', runId: 'canonical' });
  expect(error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: expect.stringContaining('Reconnect') }));
  expect(own.closed).toBe(true); expect(source.observed).toBe(false); expect(otherError).not.toHaveBeenCalled();
  unaffected.unsubscribe();
});
it('does not fail a finished or unsubscribed run on a late socket close', () => {
  const source = new Subject<BaseEvent>(), error = vi.fn();
  hyperWithRunConnection({ threadId: 't', runId: 'r' }, source).subscribe({ error });
  source.complete(); hyperRunConnectionLost({ threadId: 't', runId: 'r' });
  const subscription = hyperWithRunConnection({ threadId: 't', runId: 'r' }, new Subject<BaseEvent>()).subscribe({ error });
  subscription.unsubscribe(); hyperRunConnectionLost({ threadId: 't', runId: 'r' });
  expect(error).not.toHaveBeenCalled();
});
function bridge() {
  let receive: (event: HyperOpenBotSocketEvent) => void;
  let id: string;
  const dispose = vi.fn();
  vi.stubGlobal('CloseEvent', class extends Event { constructor(type: string, public detail: unknown) { super(type); } });
  vi.stubGlobal('window', { appflowy: { hyperOpenBot: {
    onSocket: (fn: typeof receive) => { receive = fn; return dispose; },
    socketOpen: vi.fn(async (value: string) => { id = value; }), socketSend: vi.fn(), socketClose: vi.fn(),
  } } });
  const socket = new HyperOpenBotSocket('wss://hyper-openbot.invalid/api/intelligence/client/websocket?vsn=2.0.0');
  receive!({ id: id!, type: 'open' });
  socket.send(JSON.stringify(['1', '2', 'thread:t', 'phx_join', { stream_mode: 'run', run_id: 'r' }]));
  return { socket, close: () => receive({ id, type: 'close', code: 1006, reason: '' }), dispose };
}
it('turns an unexpected native socket close into an observable run failure once', () => {
  const error = vi.fn(), source = new Subject<BaseEvent>();
  hyperWithRunConnection({ threadId: 't', runId: 'r' }, source).subscribe({ error });
  const b = bridge(); b.close(); b.close();
  expect(error).toHaveBeenCalledOnce(); expect(b.dispose).toHaveBeenCalledOnce(); expect(source.observed).toBe(false);
});
it('does not mistake an intentional Stop or cleanup for a connection failure', () => {
  const error = vi.fn();
  const subscription = hyperWithRunConnection({ threadId: 't', runId: 'r' }, new Subject<BaseEvent>()).subscribe({ error });
  const b = bridge(); b.socket.close(); b.close();
  expect(error).not.toHaveBeenCalled(); subscription.unsubscribe();
});

it('preserves the connection failure type through a resolving SDK call for the reconnect barrier', async () => {
  let events: any;
  const error = new HyperRunConnectionError();
  const agent = { subscribe: (value: unknown) => { events = value; return { unsubscribe: vi.fn() }; } };
  await expect(hyperRunWithRecovery(agent as never, async () => { events.onRunInitialized(); events.onRunFailed({ error }); }, () => false)).rejects.toBe(error);
});
