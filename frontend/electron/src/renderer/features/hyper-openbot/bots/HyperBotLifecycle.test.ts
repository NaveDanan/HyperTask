import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
import { hyperOpenBotRequest } from '../transport';
import { HyperBotLifecycleStore } from './HyperBotLifecycle';
const paused = { lifecycle: { paused: true, notify: 'none' as const } };
const active = { lifecycle: { paused: false, notify: 'all' as const } };
function deferred() {
  let resolve!: (value: typeof active | typeof paused) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<typeof active | typeof paused>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => vi.resetAllMocks());
it('ignores late A after switching to B and blocks controls while B is pending', async () => {
  const a = deferred(); const b = deferred();
  vi.mocked(hyperOpenBotRequest).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const store = new HyperBotLifecycleStore();
  const first = store.load('A');
  const second = store.load('B');
  expect(store.getSnapshot()).toEqual({ botId: 'B', pending: true });
  await store.change('B', 'pause');
  expect(hyperOpenBotRequest).toHaveBeenCalledTimes(2);
  b.resolve(active); await second;
  a.resolve(paused); await first;
  expect(store.getSnapshot()).toEqual({ botId: 'B', pending: false, data: active.lifecycle });
});
it('clears previous data immediately and ignores stale errors', async () => {
  vi.mocked(hyperOpenBotRequest).mockResolvedValueOnce(active);
  const store = new HyperBotLifecycleStore(); await store.load('A');
  const a = deferred(); const b = deferred();
  vi.mocked(hyperOpenBotRequest).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const retry = store.load('A'); const next = store.load('B');
  expect(store.getSnapshot().data).toBeUndefined();
  a.reject(new Error('A failed')); await retry;
  expect(store.getSnapshot()).toEqual({ botId: 'B', pending: true });
  b.resolve(active); await next;
});
it('ignores a late mutation response for A after opening B', async () => {
  vi.mocked(hyperOpenBotRequest).mockResolvedValueOnce(active);
  const store = new HyperBotLifecycleStore(); await store.load('A');
  const mutation = deferred(); const b = deferred();
  vi.mocked(hyperOpenBotRequest).mockReturnValueOnce(mutation.promise).mockReturnValueOnce(b.promise);
  const changing = store.change('A', 'pause');
  const opening = store.load('B'); b.resolve(active); await opening;
  mutation.resolve(paused); await changing;
  expect(store.getSnapshot()).toEqual({ botId: 'B', pending: false, data: active.lifecycle });
  await store.change('A', 'resume');
  expect(hyperOpenBotRequest).toHaveBeenCalledTimes(3);
});
it('invalidates pending work on editor cleanup and supports retry after failure', async () => {
  const pending = deferred();
  vi.mocked(hyperOpenBotRequest).mockReturnValueOnce(pending.promise);
  const store = new HyperBotLifecycleStore(); const opening = store.load('A');
  store.cancel(); pending.resolve(active); await opening;
  expect(store.getSnapshot().data).toBeUndefined();
  vi.mocked(hyperOpenBotRequest).mockRejectedValueOnce(new Error('Offline'));
  await store.load('B');
  expect(store.getSnapshot()).toEqual({ botId: 'B', pending: false, error: 'Offline' });
  vi.mocked(hyperOpenBotRequest).mockResolvedValueOnce(active);
  await store.load('B');
  expect(store.getSnapshot()).toEqual({ botId: 'B', pending: false, data: active.lifecycle });
});
