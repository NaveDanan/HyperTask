import type { HyperComposerAttachment } from './composer';
import type { HyperOpenBotServiceState } from '@shared/HyperOpenBotService';

export type HyperDraftAttachment = HyperComposerAttachment & { mimeType: string };
export interface HyperConversationDraft {
  readonly text: string;
  readonly attachments: readonly HyperDraftAttachment[];
  readonly uploadGroup: string;
  readonly retry?: { readonly id: string; readonly text: string; readonly files: string };
}
const EMPTY: HyperConversationDraft = Object.freeze({ text: '', attachments: Object.freeze([]), uploadGroup: '' });
function snapshot(value: HyperConversationDraft): HyperConversationDraft {
  // Retain server references and display metadata, never File objects, bytes or credentials.
  return Object.freeze({ text: value.text, uploadGroup: value.uploadGroup, attachments: Object.freeze(value.attachments.map(file => Object.freeze({ id: file.id, name: file.name, mimeType: file.mimeType, status: file.status, ...(file.error ? { error: file.error } : {}) }))), ...(value.retry ? { retry: Object.freeze({ id: value.retry.id, text: value.retry.text, files: value.retry.files }) } : {}) });
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
    const update = (change: (current: HyperConversationDraft) => HyperConversationDraft) => {
      if (generation !== this.generation) return false;
      this.entries.set(channelId, snapshot(change(get())));
      for (const listener of this.listeners) listener();
      return true;
    };
    return {
      get,
      subscribe: (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; },
      update,
      prepareSubmission: (text: string, files: string) => {
        if (generation !== this.generation) throw new Error('The conversation identity changed. Reopen Chat before sending.');
        // Another page may have completed and cleared this retry since this page mounted.
        const previous = get().retry;
        const sent = previous?.text === text && previous.files === files ? previous : { id: crypto.randomUUID(), text, files };
        update(current => ({ ...current, retry: sent }));
        return sent;
      },
    };
  }
}

export function hyperObserveDraftIdentity(cache: HyperConversationDraftCache, subscribe: (listener: (state: HyperOpenBotServiceState) => void) => () => void) {
  return subscribe(state => { if (['signed_out', 'profile_required', 'unsupported'].includes(state.problem)) cache.invalidate(); });
}

export const HYPER_PENDING_ATTACHMENT = 'pending:';
type DraftAttachments = (change: (current: readonly HyperDraftAttachment[]) => readonly HyperDraftAttachment[]) => void;
/**
 * Reserve channel-scoped placeholders before uploading so a reopened composer still blocks Send.
 * A placeholder removed while its upload runs causes the uploaded server attachment to be discarded.
 */
export async function hyperUploadDraftFiles(files: readonly File[], upload: (file: File) => Promise<HyperDraftAttachment>, update: DraftAttachments, discard: (id: string) => void) {
  const pending = files.map(file => ({ id: HYPER_PENDING_ATTACHMENT + crypto.randomUUID(), name: file.name, mimeType: file.type || 'application/octet-stream', status: 'uploading' as const }));
  update(current => [...current, ...pending]);
  let index = 0;
  try {
    for (; index < files.length; index++) {
      const ready = await upload(files[index]), placeholder = pending[index].id;
      let kept = false;
      update(current => { kept = current.some(file => file.id === placeholder); return kept ? current.map(file => file.id === placeholder ? ready : file) : current; });
      if (!kept) discard(ready.id);
    }
  } finally {
    const unsettled = new Set(pending.slice(index).map(file => file.id));
    if (unsettled.size) update(current => current.filter(file => !unsettled.has(file.id)));
  }
}
