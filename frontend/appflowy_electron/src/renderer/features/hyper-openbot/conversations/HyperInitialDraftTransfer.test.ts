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
