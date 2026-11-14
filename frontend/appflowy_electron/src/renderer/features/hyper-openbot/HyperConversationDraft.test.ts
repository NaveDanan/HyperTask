import { expect, it, vi } from 'vitest';
import type { HyperOpenBotServiceState } from '@shared/HyperOpenBotService';
import { HyperConversationDraftCache, hyperObserveDraftIdentity } from './HyperConversationDraft';

it('restores a conversation draft and staged references in a new page without mixing channels', () => {
  const cache = new HyperConversationDraftCache(() => 'group');
  const first = cache.acquire('one');
  const file = { id: 'remote-file', name: 'notes.txt', mimeType: 'text/plain', status: 'ready' as const, bytes: new Uint8Array([1]) };
  first.update(current => ({ ...current, text: 'Unsent work', attachments: [file] }));
  file.name = 'Mutated caller object';
  expect(cache.acquire('one').get()).toEqual({ text: 'Unsent work', uploadGroup: 'group', attachments: [{ id: 'remote-file', name: 'notes.txt', mimeType: 'text/plain', status: 'ready' }] });
  expect(cache.acquire('two').get().text).toBe('');
});
it('an old send completion preserves newer text and attachments entered in the reopened conversation', () => {
  const cache = new HyperConversationDraftCache(() => 'group'), oldPage = cache.acquire('one');
  oldPage.update(current => ({ ...current, text: 'Submitted' }));
  const reopened = cache.acquire('one');
  reopened.update(current => ({ ...current, text: 'Newer draft', attachments: [{ id: 'new', name: 'new.txt', mimeType: 'text/plain', status: 'ready' }] }));
  oldPage.update(current => ({ ...current, text: current.text === 'Submitted' ? '' : current.text, attachments: current.attachments.filter(file => file.id !== 'old') }));
  expect(reopened.get().text).toBe('Newer draft'); expect(reopened.get().attachments.map(file => file.id)).toEqual(['new']);
});
it('retains failed-send identity on reopening and cannot clear a newer submission identity', () => {
  const cache = new HyperConversationDraftCache(() => 'group'), original = cache.acquire('one');
  const sent = { id: 'submitted-user-id', text: 'Retry this', files: 'file-id' };
  original.update(current => ({ ...current, text: sent.text, retry: sent }));
  const reopened = cache.acquire('one'); expect(reopened.get().retry).toEqual(sent);
  reopened.update(current => ({ ...current, retry: { ...sent, id: 'new-user-id' } }));
  original.update(current => current.retry?.id === sent.id ? { ...current, retry: undefined } : current);
  expect(reopened.get().retry?.id).toBe('new-user-id');
});
it('selects a fresh identity after an older page completes a reopened page pending send', () => {
  const cache = new HyperConversationDraftCache(() => 'group'), original = cache.acquire('one');
  const pending = original.prepareSubmission('Same text', 'file-id');
  const reopened = cache.acquire('one');
  expect(reopened.prepareSubmission('Same text', 'file-id').id).toBe(pending.id);
  original.update(current => current.retry?.id === pending.id ? { ...current, retry: undefined } : current);
  expect(reopened.prepareSubmission('Same text', 'file-id').id).not.toBe(pending.id);
});
it.each(['signed_out', 'profile_required', 'unsupported'] as const)('native %s clears drafts and rejects late upload completions', problem => {
  const cache = new HyperConversationDraftCache(() => 'group'), lease = cache.acquire('one');
  let onState!: (state: HyperOpenBotServiceState) => void;
  hyperObserveDraftIdentity(cache, listener => { onState = listener; return () => {}; });
  const listener = vi.fn(); lease.subscribe(listener);
  lease.update(current => ({ ...current, text: 'Private unsent text' }));
  onState({ problem: 'ssh_unavailable' } as HyperOpenBotServiceState); expect(lease.get().text).toBe('Private unsent text');
  onState({ problem } as HyperOpenBotServiceState); expect(lease.get().text).toBe('');
  expect(() => lease.prepareSubmission('Late send', '')).toThrow('identity changed');
  expect(lease.update(current => ({ ...current, text: 'Late response', attachments: [{ id: 'late', name: 'late.txt', mimeType: 'text/plain', status: 'ready' }] }))).toBe(false);
  expect(cache.acquire('one').get().attachments).toEqual([]); expect(cache.acquire('one').get().text).toBe(''); expect(listener).toHaveBeenCalled();
});
