import { afterEach, expect, it, vi } from 'vitest';
import { HyperHandlerHarness, hyperFind, hyperFormSubmit, hyperPickFiles } from './HyperComposerHandlerHarness';
import { HyperAttachmentStrip, HyperComposer, type HyperComposerProps } from './hyper-composer';
import { HyperDictationControl } from './HyperDictationControl';
import { HyperConversationDraftCache, hyperUploadDraftFiles } from '../HyperConversationDraft';

const harnesses: HyperHandlerHarness[] = [];
function harness() { const h = new HyperHandlerHarness(); harnesses.push(h); return h; }
afterEach(() => { harnesses.forEach(h => h.unmount()); harnesses.length = 0; });
const files = (prefix: string) => Array.from({ length: 8 }, (_, i) => ({ id: `${prefix}-${i}`, name: `${prefix}-${i}.txt`, mimeType: 'text/plain', status: 'ready' as const }));

it.each(['disabled', 'submitDisabled', 'allowQueue'] as const)('holds the real queue drain at the current %s gate and resumes only when ready', async gate => {
  const h = harness(), sent = vi.fn().mockResolvedValue(undefined);
  const props: HyperComposerProps = { value: 'correction', pending: true, onSubmit: sent };
  hyperFormSubmit(h.render(HyperComposer, props)); h.flush();
  h.render(HyperComposer, { ...props, value: '', pending: false, [gate]: gate !== 'allowQueue' }); h.flush();
  expect(sent).not.toHaveBeenCalled();
  h.render(HyperComposer, { ...props, value: '', pending: false }); h.flush();
  await Promise.resolve(); expect(sent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: 'correction' }));
});

it('a cached form callback cannot bypass new readiness or submit after unmount', () => {
  const h = harness(), sent = vi.fn(), props = { value: 'draft', onSubmit: sent };
  const old = h.render(HyperComposer, props); h.flush();
  h.render(HyperComposer, { ...props, submitDisabled: true }); h.flush(); hyperFormSubmit(old);
  expect(sent).not.toHaveBeenCalled();
  h.render(HyperComposer, props); h.flush(); h.unmount(); hyperFormSubmit(old);
  expect(sent).not.toHaveBeenCalled();
});

it('the common form path stops active dictation without sending partial text', () => {
  const h = harness(), sent = vi.fn(), stop = vi.fn(() => true);
  const tree = h.render(HyperComposer, { value: 'partial words', onSubmit: sent }); h.flush();
  hyperFind(tree, element => element.type === HyperDictationControl)!.props.registerStop(stop);
  hyperFormSubmit(tree);
  expect(stop).toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled();
});

it('cached dictation completion cannot refill the submitted or edited draft', async () => {
  const h = harness(), sent = vi.fn().mockResolvedValue(undefined);
  const tree = h.render(HyperComposer, { initialValue: 'ready words', onSubmit: sent }); h.flush();
  const dictation = hyperFind(tree, element => element.type === HyperDictationControl)!;
  dictation.props.onLiveStart(); hyperFormSubmit(tree); await Promise.resolve();
  dictation.props.onLiveText('late words'); dictation.props.onText('late transcript');
  let current = h.render(HyperComposer, { onSubmit: sent }); h.flush();
  expect(hyperFind(current, element => element.props['data-slot'] === 'composer-input')!.props.value).toBe('');
  const old = hyperFind(current, element => element.type === HyperDictationControl)!;
  hyperFind(current, element => element.props['data-slot'] === 'composer-input')!.props.onChange({ target: { value: 'edited' } });
  old.props.onText('outdated'); current = h.render(HyperComposer, { onSubmit: sent });
  expect(hyperFind(current, element => element.props['data-slot'] === 'composer-input')!.props.value).toBe('edited');
});

it.each([false, true])('gives the follow-up eight slots while protecting active refs, remount=%s', async remount => {
  let h = harness(); const cache = new HyperConversationDraftCache(), lease = cache.acquire('channel');
  lease.update(current => ({ ...current, attachments: files('active') }));
  let finish!: () => void; const sent = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  hyperFormSubmit(h.render(HyperComposer, { value: 'first', onSubmit: sent, attachments: lease.get().attachments })); h.flush();
  const release = lease.beginAttachmentSend('first', files('active').map(file => file.id));
  if (remount) { h.unmount(); h = harness(); }
  const onFiles = vi.fn(async (picked: readonly File[]) => hyperUploadDraftFiles(picked, async file => ({ id: file.name, name: file.name, mimeType: 'text/plain', status: 'ready' }), change => lease.update(current => ({ ...current, attachments: change(current.attachments) })), vi.fn(), lease.assertCurrent));
  const props = (): HyperComposerProps => ({ value: 'follow-up', pending: true, onSubmit: sent, attachments: lease.get().attachments, activeAttachmentIds: lease.get().activeAttachments?.ids, getAttachmentCount: () => lease.get().attachments.length, onFiles });
  const tree = h.render(HyperComposer, props()); h.flush();
  hyperPickFiles(tree, Array.from({ length: 8 }, (_, i) => new File(['x'], `next-${i}.txt`, { type: 'text/plain' })));
  expect(onFiles).toHaveBeenCalledTimes(1); expect(onFiles.mock.calls[0][0]).toHaveLength(8);
  await onFiles.mock.results[0].value;
  const current = h.render(HyperComposer, props()); h.flush();
  expect(hyperFind(current, element => element.props['aria-label'] === 'Queue message')!.props.disabled).toBe(false);
  hyperFormSubmit(current); expect(sent).toHaveBeenCalledTimes(1);
  release(); finish(); await Promise.resolve();
});

it('separates server upload groups at send start and retains the retry and old lease identities', () => {
  let group = 0; const cache = new HyperConversationDraftCache(() => `group-${++group}`), lease = cache.acquire('channel');
  lease.update(current => ({ ...current, attachments: files('active') }));
  const originalGroup = lease.get().uploadGroup, retry = lease.prepareSubmission('first', files('active').map(file => file.id).join(','));
  const finish = lease.beginAttachmentSend(retry.id, files('active').map(file => file.id));
  const reopened = cache.acquire('channel');
  expect(reopened.get().uploadGroup).not.toBe(originalGroup);
  expect(reopened.prepareSubmission(retry.text, retry.files).id).toBe(retry.id);
  finish(); expect(lease.get().uploadGroup).toBe(reopened.get().uploadGroup);
  expect(lease.get().attachments).toHaveLength(8);
});

it('holds a scheduled queue drain if dictation starts before its effect executes', () => {
  const h = harness(), sent = vi.fn();
  hyperFormSubmit(h.render(HyperComposer, { value: 'queued', pending: true, onSubmit: sent })); h.flush();
  const idle = h.render(HyperComposer, { value: '', pending: false, onSubmit: sent });
  hyperFind(idle, element => element.type === HyperDictationControl)!.props.onBusyChange(true);
  h.flush(); expect(sent).not.toHaveBeenCalled();
});

it('a cached removal callback cannot discard files taken by an active send', async () => {
  const h = harness(), remove = vi.fn(); let finish!: () => void;
  const tree = h.render(HyperComposer, { value: 'first', attachments: files('first'), onRemoveAttachment: remove, onSubmit: () => new Promise<void>(resolve => { finish = resolve; }) }); h.flush();
  const strip = hyperFind(tree, element => element.type === HyperAttachmentStrip)!;
  hyperFormSubmit(tree); strip.props.onRemove('first-0'); expect(remove).not.toHaveBeenCalled();
  finish(); await Promise.resolve();
});

it('clearing a controlled draft rejects its cached dictation completion', () => {
  const h = harness(), setText = vi.fn(), props = { value: 'partial', onTextChange: setText, onSubmit: vi.fn() };
  const old = h.render(HyperComposer, props); h.flush();
  h.render(HyperComposer, { ...props, value: '' }); h.flush();
  hyperFind(old, element => element.type === HyperDictationControl)!.props.onText('stale words');
  expect(setText).not.toHaveBeenCalled();
});

it('focuses each requested recipient transition once and defers requests while disabled', () => {
  const h = harness(), focus = vi.fn(), props = { onSubmit: vi.fn(), focusRequest: 1 };
  const render = (extra: Partial<HyperComposerProps> = {}) => {
    const tree = h.render(HyperComposer, { ...props, ...extra });
    hyperFind(tree, element => element.props['data-slot'] === 'composer-input')!.props.ref({ focus }); h.flush();
  };
  render(); render(); expect(focus).toHaveBeenCalledTimes(1);
  render({ disabled: true, focusRequest: 2 }); expect(focus).toHaveBeenCalledTimes(1);
  render({ focusRequest: 2 }); render({ focusRequest: 2 }); expect(focus).toHaveBeenCalledTimes(2);
});

it('retains the follow-up upload bucket across retries and ignores an older completion of the same retry', () => {
  let group = 0; const cache = new HyperConversationDraftCache(() => `group-${++group}`), lease = cache.acquire('channel');
  const sent = lease.prepareSubmission('first', 'file'); const oldFinish = lease.beginAttachmentSend(sent.id, ['file']);
  const nextGroup = lease.get().uploadGroup; oldFinish();
  const reopened = cache.acquire('channel'), retry = reopened.prepareSubmission('first', 'file');
  expect(retry).toEqual(sent);
  const finishRetry = reopened.beginAttachmentSend(retry.id, ['file']);
  expect(reopened.get().uploadGroup).toBe(nextGroup); oldFinish();
  expect(reopened.get().activeAttachments?.submissionId).toBe(retry.id);
  cache.invalidate(); finishRetry();
  expect(cache.acquire('channel').get().activeAttachments).toBeUndefined();
  expect(() => reopened.prepareSubmission('private', '')).toThrow('identity changed');
});

it('cached form submissions cannot reuse active files before rerender or refill the queue after success', async () => {
  const h = harness(), consume = vi.fn(); let finish!: () => void;
  const sent = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const tree = h.render(HyperComposer, { value: 'first', attachments: files('first'), onConsumeAttachments: consume, onSubmit: sent }); h.flush();
  hyperFormSubmit(tree); hyperFormSubmit(tree);
  expect(consume).not.toHaveBeenCalled();
  finish(); await Promise.resolve(); await Promise.resolve();
  hyperFormSubmit(tree); expect(sent).toHaveBeenCalledTimes(1);
});

it.each([false, true])('restores disabled queued intent to its current owner on unmount, invalidated=%s', invalidated => {
  const h = harness(), cache = new HyperConversationDraftCache(), lease = cache.acquire('channel'), sent = vi.fn(), discard = vi.fn();
  const props = { value: 'queued', pending: true, onSubmit: sent, attachments: files('queued'), onRestoreQueued: lease.restoreQueued, onDiscardAttachment: discard };
  hyperFormSubmit(h.render(HyperComposer, props)); h.flush();
  h.render(HyperComposer, { ...props, value: '', attachments: [], pending: false, disabled: true }); h.flush();
  if (invalidated) cache.invalidate(); h.unmount();
  const reopened = cache.acquire('channel');
  expect(reopened.get().text).toBe(invalidated ? '' : 'queued'); expect(reopened.get().attachments).toHaveLength(invalidated ? 0 : 8);
  expect(sent).not.toHaveBeenCalled(); expect(discard).not.toHaveBeenCalled();
  const remounted = harness(); remounted.render(HyperComposer, { value: reopened.get().text, attachments: reopened.get().attachments, onSubmit: sent }); remounted.flush();
  expect(sent).not.toHaveBeenCalled();
});
