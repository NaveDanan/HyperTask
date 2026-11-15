import type { HyperComposerAttachment } from './composer';
import type { HyperOpenBotServiceState } from '@shared/HyperOpenBotService';
import type { HyperQueuedMessage } from './composer/HyperQueue';

export type HyperDraftAttachment = HyperComposerAttachment & { mimeType: string };
export interface HyperConversationDraft {
  readonly commandIds?: readonly string[];
  readonly text: string;
  readonly attachments: readonly HyperDraftAttachment[];
  readonly uploadGroup: string;
  readonly retry?: { readonly id: string; readonly text: string; readonly files: string };
}
const EMPTY: HyperConversationDraft = Object.freeze({ text: '', attachments: Object.freeze([]), uploadGroup: '' });
function snapshot(value: HyperConversationDraft): HyperConversationDraft {
  // Retain server references and display metadata, never File objects, bytes or credentials.
  return Object.freeze({ text: value.text, ...(value.commandIds ? { commandIds: Object.freeze([...value.commandIds]) } : {}), uploadGroup: value.uploadGroup, attachments: Object.freeze(value.attachments.map(file => Object.freeze({ id: file.id, name: file.name, mimeType: file.mimeType, status: file.status, ...(file.error ? { error: file.error } : {}) }))), ...(value.retry ? { retry: Object.freeze({ id: value.retry.id, text: value.retry.text, files: value.retry.files }) } : {}) });
}

/** Renderer-session drafts survive native page navigation and expire at the main auth boundary. */
export class HyperConversationDraftCache {
  private generation = 0;
  private entries = new Map<string, HyperConversationDraft>();
  private listeners = new Set<() => void>();
  constructor(private readonly groupId: () => string = () => crypto.randomUUID()) {}
  invalidate() { this.generation++; this.entries.clear(); for (const listener of this.listeners) listener(); }
  acquire(channelId: string) {
    const generation = this.generation;
    if (!this.entries.has(channelId)) this.entries.set(channelId, snapshot({ text: '', attachments: [], uploadGroup: this.groupId() }));
    const get = () => generation === this.generation ? this.entries.get(channelId) ?? EMPTY : EMPTY;
    const assertCurrent = () => { if (generation !== this.generation) throw new Error('The conversation identity changed. Reopen Chat before sending.'); };
    const update = (change: (current: HyperConversationDraft) => HyperConversationDraft) => {
      if (generation !== this.generation) return false;
      this.entries.set(channelId, snapshot(change(get())));
      for (const listener of this.listeners) listener();
      return true;
    };
    return {
      get,
      assertCurrent,
      subscribe: (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; },
      update,
      /** Navigation restores unsent queued intent; only this still-current owner can retain it. */
      restoreQueued: (messages: readonly HyperQueuedMessage[]) => {
        if (generation !== this.generation) return false;
        if (!messages.length) return true;
        return update(current => {
          const attachments = new Map<string, HyperDraftAttachment>();
          for (const file of messages.flatMap(message => message.attachments)) attachments.set(file.id, {
            id: file.id, name: file.name, status: file.status,
            mimeType: 'mimeType' in file && typeof file.mimeType === 'string' ? file.mimeType : 'application/octet-stream',
            ...(file.error ? { error: file.error } : {}),
          });
          for (const file of current.attachments) attachments.set(file.id, file);
          return { ...current, text: [...messages.map(message => message.text), current.text].filter(line => line.trim()).join('\n'),
            attachments: [...attachments.values()], commandIds: [...new Set([...messages.flatMap(message => message.commandIds), ...(current.commandIds ?? [])])], retry: undefined };
        });
      },
      prepareSubmission: (text: string, files: string) => {
        assertCurrent();
        // Another page may have completed and cleared this retry since this page mounted.
        const previous = get().retry;
        const sent = previous?.text === text && previous.files === files ? previous : { id: crypto.randomUUID(), text, files };
        update(current => ({ ...current, retry: sent }));
        return sent;
      },
    };
  }
}

export function hyperObserveDraftIdentity(cache: Pick<HyperConversationDraftCache, 'invalidate'>, subscribe: (listener: (state: HyperOpenBotServiceState) => void) => () => void) {
  return subscribe(state => { if (['signed_out', 'profile_required', 'unsupported'].includes(state.problem)) cache.invalidate(); });
}

export const HYPER_PENDING_ATTACHMENT = 'pending:';
type DraftAttachments = (change: (current: readonly HyperDraftAttachment[]) => readonly HyperDraftAttachment[]) => void;
/**
 * Reserve channel-scoped placeholders before uploading so a reopened composer still blocks Send.
 * A placeholder removed while its upload runs causes the uploaded server attachment to be discarded.
 */
export async function hyperUploadDraftFiles(files: readonly File[], upload: (file: File) => Promise<HyperDraftAttachment>, update: DraftAttachments, discard: (id: string) => void, assertCurrent: () => void) {
  assertCurrent();
  const pending = files.map(file => ({ id: HYPER_PENDING_ATTACHMENT + crypto.randomUUID(), name: file.name, mimeType: file.type || 'application/octet-stream', status: 'uploading' as const }));
  update(current => [...current, ...pending]);
  let index = 0;
  try {
    for (; index < files.length; index++) {
      assertCurrent();
      const ready = await upload(files[index]), placeholder = pending[index].id;
      assertCurrent();
      let kept = false;
      update(current => { kept = current.some(file => file.id === placeholder); return kept ? current.map(file => file.id === placeholder ? ready : file) : current; });
      if (!kept) { assertCurrent(); discard(ready.id); }
    }
  } finally {
    const unsettled = new Set(pending.slice(index).map(file => file.id));
    if (unsettled.size) update(current => current.filter(file => !unsettled.has(file.id)));
  }
}
