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
it.each(['signed_out', 'profile_required', 'unsupported'] as const)('native %s clears drafts and rejects late upload completions', problem => {
  const cache = new HyperConversationDraftCache(() => 'group'), lease = cache.acquire('one');
  let onState!: (state: HyperOpenBotServiceState) => void;
  hyperObserveDraftIdentity(cache, listener => { onState = listener; return () => {}; });
  const listener = vi.fn(); lease.subscribe(listener);
  lease.update(current => ({ ...current, text: 'Private unsent text' }));
  onState({ problem: 'ssh_unavailable' } as HyperOpenBotServiceState); expect(lease.get().text).toBe('Private unsent text');
  onState({ problem } as HyperOpenBotServiceState); expect(lease.get().text).toBe('');
  expect(lease.update(current => ({ ...current, text: 'Late response', attachments: [{ id: 'late', name: 'late.txt', mimeType: 'text/plain', status: 'ready' }] }))).toBe(false);
  expect(cache.acquire('one').get().attachments).toEqual([]); expect(cache.acquire('one').get().text).toBe(''); expect(listener).toHaveBeenCalled();
});
