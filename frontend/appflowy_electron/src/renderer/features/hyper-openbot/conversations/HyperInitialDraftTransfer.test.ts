import { expect, it, vi } from 'vitest';
import type { HyperInitialDraft } from '../onboarding/HyperHomeApi';
import { HyperInitialDraftTransfer } from './HyperInitialDraftTransfer';
import { hyperDeferred } from './HyperVoiceDeferred';
it('awaits creation and receiving before navigation and preserves File identity and commands', async () => {
  const transfer = new HyperInitialDraftTransfer<string>();
  const file = new File(['body'], 'a.txt');
  const initial = { text: '/skill task', files: [file], commandIds: ['skill'], submit: true };
  const received = hyperDeferred<void>(); const navigate = vi.fn(); const receive = vi.fn((_channel: string, _draft: HyperInitialDraft, _signal: AbortSignal) => received.promise);
  const result = transfer.start(['bot'], initial, { create: async () => 'channel', receive, navigate });
  await Promise.resolve();
  expect(receive.mock.calls[0][1]).toBe(initial); expect(initial.files[0]).toBe(file); expect(navigate).not.toHaveBeenCalled();
  received.resolve(); await result; expect(navigate).toHaveBeenCalledWith('channel');
});
it('rejects failures and retries the same channel without duplicate creation', async () => {
  const transfer = new HyperInitialDraftTransfer<string>(); const create = vi.fn(async () => 'channel');
  const initial = { text: 'task', files: [], commandIds: [], submit: false };
  const receive = vi.fn().mockRejectedValueOnce(new Error('upload refused')).mockResolvedValueOnce(undefined); const navigate = vi.fn();
  await expect(transfer.start(['bot'], initial, { create, receive, navigate })).rejects.toThrow('upload refused');
  expect(navigate).not.toHaveBeenCalled(); await transfer.start(['bot'], { ...initial }, { create, receive, navigate });
  expect(create).toHaveBeenCalledTimes(1); expect(receive.mock.calls[1][1].submit).toBe(false);
});
it('locks duplicate starts and blocks navigation after cancellation during creation', async () => {
  const transfer = new HyperInitialDraftTransfer<string>(); const created = hyperDeferred<string>(); const receive = vi.fn(); const navigate = vi.fn();
  const deps = { create: () => created.promise, receive, navigate };
  const result = transfer.start(['bot'], undefined, deps);
  await expect(transfer.start(['bot'], undefined, deps)).rejects.toThrow('already');
  transfer.cancel(); created.resolve('channel'); await expect(result).rejects.toThrow();
  expect(receive).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
});
it('does not navigate when cancellation arrives during upload/send', async () => {
  const transfer = new HyperInitialDraftTransfer<string>(); const done = hyperDeferred<void>(); const navigate = vi.fn();
  const result = transfer.start(['bot'], { text: 'task', files: [], commandIds: [], submit: true }, { create: async () => 'channel', receive: () => done.promise, navigate });
  await Promise.resolve(); transfer.cancel(); done.resolve(); await expect(result).rejects.toThrow(); expect(navigate).not.toHaveBeenCalled();
});
it('does not reuse a channel configured for a different first-message model', async () => {
  const transfer = new HyperInitialDraftTransfer<string>(); const create = vi.fn().mockResolvedValueOnce('one').mockResolvedValueOnce('two'); const receive = vi.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValueOnce(undefined);
  const draft = { text: 'task', files: [], commandIds: [], submit: true, modelPick: { model: 'one', effort: null } };
  await expect(transfer.start(['bot'], draft, { create, receive, navigate: vi.fn() })).rejects.toThrow();
  await transfer.start(['bot'], { ...draft, modelPick: { model: 'two', effort: null } }, { create, receive, navigate: vi.fn() }); expect(create).toHaveBeenCalledTimes(2);
});
it('ordinary cancellation still preserves the channel for an actual retry', async () => {
  const transfer = new HyperInitialDraftTransfer<string>(), create = vi.fn(async () => 'same-channel');
  const draft = { text: 'Hello', files: [], commandIds: [], submit: true };
  const receive = vi.fn().mockRejectedValueOnce(new Error('send failed')).mockResolvedValueOnce(undefined), navigate = vi.fn();
  await expect(transfer.start(['bot'], draft, { create, receive, navigate })).rejects.toThrow('send failed');
  transfer.cancel(); await transfer.start(['bot'], { ...draft }, { create, receive, navigate });
  expect(create).toHaveBeenCalledOnce(); expect(navigate).toHaveBeenCalledWith('same-channel');
});
it('fresh reset releases abandoned creation and old settlement cannot unlock a newer start', async () => {
  const transfer = new HyperInitialDraftTransfer<string>(), oldCreated = hyperDeferred<string>(), newReceived = hyperDeferred<void>();
  const create = vi.fn().mockImplementationOnce(() => oldCreated.promise).mockResolvedValueOnce('new-channel'), receive = vi.fn((_channel: string, _draft: HyperInitialDraft, _signal: AbortSignal) => newReceived.promise), navigate = vi.fn();
  const draft = { text: 'Hello', files: [], commandIds: [], submit: true };
  const old = transfer.start(['bot'], draft, { create, receive, navigate }); const oldRejected = expect(old).rejects.toThrow();
  transfer.resetComposition(); const fresh = transfer.start(['bot'], draft, { create, receive, navigate }); await Promise.resolve();
  oldCreated.resolve('old-channel'); await oldRejected;
  await expect(transfer.start(['bot'], draft, { create, receive, navigate })).rejects.toThrow('already');
  expect(receive.mock.calls.map(call => call[0])).toEqual(['new-channel']); expect(navigate).not.toHaveBeenCalled();
  newReceived.resolve(); await fresh; expect(navigate).toHaveBeenCalledWith('new-channel');
});
it('fresh composition does not inherit the old upload-reference cache', async () => {
  const transfer = new HyperInitialDraftTransfer<string>(), maps: Map<File, unknown>[] = [];
  const file = new File(['body'], 'draft.txt'), draft = { text: 'Hello', files: [file], commandIds: [], submit: true };
  const create = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('fresh');
  const receive = vi.fn(async (_channel: string, _draft: HyperInitialDraft, _signal: AbortSignal, uploaded: Map<File, any>) => {
    maps.push(uploaded); if (maps.length === 1) { uploaded.set(file, { id: 'old-file' }); throw new Error('failed'); }
    expect(uploaded.size).toBe(0);
  });
  await expect(transfer.start(['bot'], draft, { create, receive, navigate: vi.fn() })).rejects.toThrow('failed');
  transfer.resetComposition(); await transfer.start(['bot'], draft, { create, receive, navigate: vi.fn() });
  expect(create).toHaveBeenCalledTimes(2); expect(maps[0]).not.toBe(maps[1]);
});
