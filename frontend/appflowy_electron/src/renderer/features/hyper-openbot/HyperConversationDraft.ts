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
    return {
      get,
      subscribe: (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; },
      update: (change: (current: HyperConversationDraft) => HyperConversationDraft) => {
        if (generation !== this.generation) return false;
        this.entries.set(channelId, snapshot(change(get())));
        for (const listener of this.listeners) listener();
        return true;
      },
    };
  }
}

export function hyperObserveDraftIdentity(cache: HyperConversationDraftCache, subscribe: (listener: (state: HyperOpenBotServiceState) => void) => () => void) {
  return subscribe(state => { if (['signed_out', 'profile_required', 'unsupported'].includes(state.problem)) cache.invalidate(); });
}
