import { expect, it, vi } from 'vitest';
import type { HyperOpenBotServiceState } from '@shared/HyperOpenBotService';
import { HyperConversationDraftCache, hyperObserveDraftIdentity, hyperUploadDraftFiles, type HyperDraftAttachment } from './HyperConversationDraft';

function leaseAttachments(lease: ReturnType<HyperConversationDraftCache['acquire']>) {
  return (change: (current: readonly HyperDraftAttachment[]) => readonly HyperDraftAttachment[]) => { lease.update(current => ({ ...current, attachments: change(current.attachments) })); };
}
it('stops an upload batch before sending another file after the draft identity changes', async () => {
  const cache = new HyperConversationDraftCache(() => 'group'), lease = cache.acquire('one');
  const upload = vi.fn(async (file: File) => ({ id: file.name, name: file.name, mimeType: 'text/plain', status: 'ready' as const }));
  const discard = vi.fn();
  lease.subscribe(() => { if (lease.get().attachments.some(file => file.id === 'first.txt')) cache.invalidate(); });
  await expect(hyperUploadDraftFiles([new File(['a'], 'first.txt'), new File(['b'], 'second.txt')], upload, leaseAttachments(lease), discard, lease.assertCurrent)).rejects.toThrow('identity changed');
  expect(upload).toHaveBeenCalledTimes(1);
  expect(discard).not.toHaveBeenCalled();
  expect(cache.acquire('replacement').get().attachments).toEqual([]);
});
it('reserves uploading placeholders in the channel draft so a reopened composer still blocks Send', async () => {
  const cache = new HyperConversationDraftCache(() => 'group'), original = cache.acquire('one');
  let finish!: (value: HyperDraftAttachment) => void;
  const upload = hyperUploadDraftFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })], () => new Promise(resolve => { finish = resolve; }), leaseAttachments(original), vi.fn(), original.assertCurrent);
  const reopened = cache.acquire('one');
  expect(reopened.get().attachments).toEqual([expect.objectContaining({ name: 'notes.txt', status: 'uploading' })]);
  finish({ id: 'server-id', name: 'notes.txt', mimeType: 'text/plain', status: 'ready' }); await upload;
  expect(reopened.get().attachments).toEqual([{ id: 'server-id', name: 'notes.txt', mimeType: 'text/plain', status: 'ready' }]);
});
it('discards an upload removed while pending and clears unsettled placeholders after a failure', async () => {
  const cache = new HyperConversationDraftCache(() => 'group'), lease = cache.acquire('one'), discard = vi.fn();
  let finish!: (value: HyperDraftAttachment) => void;
  const upload = hyperUploadDraftFiles([new File(['a'], 'a.txt'), new File(['b'], 'b.txt')], file => file.name === 'a.txt' ? new Promise(resolve => { finish = resolve; }) : Promise.reject(new Error('Attachment upload failed')), leaseAttachments(lease), discard, lease.assertCurrent);
  lease.update(current => ({ ...current, attachments: current.attachments.filter(file => file.name !== 'a.txt') }));
  finish({ id: 'server-a', name: 'a.txt', mimeType: 'text/plain', status: 'ready' });
  await expect(upload).rejects.toThrow('Attachment upload failed');
  expect(discard).toHaveBeenCalledExactlyOnceWith('server-a'); expect(lease.get().attachments).toEqual([]);
});

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
it('retains active file ownership across composer leases without mixing channels or caller arrays', () => {
  const cache = new HyperConversationDraftCache(() => 'group'), lease = cache.acquire('one'), ids = ['file-a'];
  const finish = lease.beginAttachmentSend('send-a', ids); ids.push('mutated');
  expect(cache.acquire('one').get().activeAttachments).toEqual({ submissionId: 'send-a', ids: ['file-a'] });
  expect(cache.acquire('two').get().activeAttachments).toBeUndefined();
  expect(() => cache.acquire('one').beginAttachmentSend('send-b', ['file-b'])).toThrow('pending');
  finish(); expect(cache.acquire('one').get().activeAttachments).toBeUndefined();
});
it('a finished old attachment send cannot clear newer ownership', () => {
  const cache = new HyperConversationDraftCache(() => 'group'), lease = cache.acquire('one');
  const finishA = lease.beginAttachmentSend('a', ['file-a']); finishA();
  lease.beginAttachmentSend('b', ['file-b']); finishA();
  expect(lease.get().activeAttachments).toEqual({ submissionId: 'b', ids: ['file-b'] });
});
it('does not reintroduce active attachment ownership after identity invalidation', () => {
  const cache = new HyperConversationDraftCache(() => 'group'), lease = cache.acquire('one');
  const finish = lease.beginAttachmentSend('a', ['file-a']); cache.invalidate(); finish();
  expect(() => lease.beginAttachmentSend('b', ['file-b'])).toThrow('identity');
  expect(cache.acquire('one').get().activeAttachments).toBeUndefined();
});
it('restores queued intent ahead of newer drafts without losing refs or reusing an active retry identity', () => {
  const cache = new HyperConversationDraftCache(() => 'group'), lease = cache.acquire('one');
  const active = lease.prepareSubmission('queued', '');
  const file = { id: 'file', name: 'queued.txt', mimeType: 'text/plain', status: 'ready' as const, previewUrl: 'blob:discard', bytes: new Uint8Array([1]) };
  lease.update(current => ({ ...current, text: 'newer draft', commandIds: ['later'], attachments: [{ id: 'newer', name: 'newer.txt', mimeType: 'text/plain', status: 'ready' }] }));
  expect(lease.restoreQueued([{ id: 'queued', text: 'queued', commandIds: ['first'], attachments: [file] }])).toBe(true);
  const reopened = cache.acquire('one');
  expect(reopened.get()).toMatchObject({ text: 'queued\nnewer draft', uploadGroup: 'group', commandIds: ['first', 'later'], attachments: [{ id: 'file', name: 'queued.txt', mimeType: 'text/plain', status: 'ready' }, { id: 'newer', name: 'newer.txt', mimeType: 'text/plain', status: 'ready' }] });
  expect(reopened.get().attachments[0]).not.toHaveProperty('previewUrl'); expect(reopened.get().attachments[0]).not.toHaveProperty('bytes');
  expect(reopened.prepareSubmission('queued', '').id).not.toBe(active.id);
});
it.each([undefined, 'failed-send'] as const)('does not restore queued content through a stale identity lease in mode %s', mode => {
  const cache = new HyperConversationDraftCache(() => 'group'), lease = cache.acquire('one'); cache.invalidate();
  expect(lease.restoreQueued([{ id: 'queued', text: 'private queued text', commandIds: [], attachments: [] }], mode)).toBe(false);
  expect(cache.acquire('one').get().text).toBe('');
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
