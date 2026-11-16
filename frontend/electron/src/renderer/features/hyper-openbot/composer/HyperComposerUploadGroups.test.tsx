import { expect, it, vi } from 'vitest';
import { HyperHandlerHarness, hyperFind, hyperFormSubmit, hyperPickFiles } from './HyperComposerHandlerHarness';
import { HyperComposer, type HyperComposerProps } from './hyper-composer';
import { HyperConversationDraftCache, hyperUploadDraftFiles, type HyperDraftAttachment } from '../HyperConversationDraft';

it('stages eight follow-up files through the production upload helper in a separate server bucket and retains retry refs', async () => {
  let group = 0;
  const cache = new HyperConversationDraftCache(() => `group-${++group}`), lease = cache.acquire('channel');
  // Contract fixture for pinned server/src/channels/attachments.ts: staged rows are
  // capped at eight per uploadGroup and 32 per uploader. No rows are stamped early.
  const server = new Map<string, string>();
  const upload = vi.fn(async (file: File, uploadGroup: string): Promise<HyperDraftAttachment> => {
    if ([...server.values()].filter(value => value === uploadGroup).length >= 8 || server.size >= 32) throw new Error('server staged cap');
    server.set(file.name, uploadGroup); return { id: file.name, name: file.name, mimeType: 'text/plain', status: 'ready' };
  });
  const update = (change: (current: readonly HyperDraftAttachment[]) => readonly HyperDraftAttachment[]) => lease.update(current => ({ ...current, attachments: change(current.attachments) }));
  const discard = vi.fn();
  // Required parent adapter: read once at batch entry, never from a captured render
  // or anew for each file after another send could rotate the group.
  const stage = (files: readonly File[]) => {
    lease.assertCurrent(); const uploadGroup = lease.get().uploadGroup;
    return hyperUploadDraftFiles(files, file => upload(file, uploadGroup), update, discard, lease.assertCurrent);
  };
  const batch = (prefix: string) => Array.from({ length: 8 }, (_, i) => new File(['x'], `${prefix}-${i}.txt`, { type: 'text/plain' }));
  await stage(batch('first'));
  const sent = lease.prepareSubmission('first', lease.get().attachments.map(file => file.id).join(','));
  const finish = lease.beginAttachmentSend(sent.id, lease.get().attachments.map(file => file.id));
  const nextGroup = lease.get().uploadGroup;
  const onFiles = vi.fn(stage), h = new HyperHandlerHarness();
  const props = (): HyperComposerProps => ({ value: 'next', pending: true, attachments: lease.get().attachments, activeAttachmentIds: lease.get().activeAttachments?.ids,
    getAttachmentCount: () => lease.get().attachments.length, onFiles, onSubmit: vi.fn(), onRemoveAttachment: vi.fn(), onRestoreQueued: lease.restoreQueued,
    onConsumeAttachments: ids => update(current => current.filter(file => !ids.includes(file.id))),
  });
  try {
    const tree = h.render(HyperComposer, props()); h.flush(); hyperPickFiles(tree, batch('next'));
    await onFiles.mock.results[0].value;
    expect(server.size).toBe(16); expect(server.get('first-0.txt')).toBe(sent.uploadGroup); expect(server.get('next-7.txt')).toBe(nextGroup);
    const current = h.render(HyperComposer, props()); h.flush();
    hyperPickFiles(current, [new File(['x'], 'ninth.txt', { type: 'text/plain' })]); expect(onFiles).toHaveBeenCalledTimes(1);
    expect(hyperFind(current, element => element.props['aria-label'] === 'Queue message')!.props.disabled).toBe(false);
    hyperFormSubmit(current); h.unmount();
    expect(lease.get().attachments).toHaveLength(16); expect(discard).not.toHaveBeenCalled();
    finish(); const reopened = cache.acquire('channel'), retry = reopened.prepareSubmission(sent.text, sent.files);
    expect(retry).toEqual(sent); expect(reopened.get().uploadGroup).toBe(nextGroup);
    // Failure returns the first eight to the strip beside the next eight. Keep
    // all refs and refuse an oversized explicit send rather than silently trim.
    const remount = new HyperHandlerHarness(), submit = vi.fn();
    const recovered = remount.render(HyperComposer, { value: reopened.get().text, attachments: reopened.get().attachments, onSubmit: submit }); remount.flush();
    expect(hyperFind(recovered, element => element.props['aria-label'] === 'Send message')!.props.disabled).toBe(true);
    hyperFormSubmit(recovered); expect(submit).not.toHaveBeenCalled(); remount.unmount();
  } finally { h.unmount(); finish(); }
});
