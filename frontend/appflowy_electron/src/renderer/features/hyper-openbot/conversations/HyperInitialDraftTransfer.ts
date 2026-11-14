import type { HyperInitialDraft as HyperHomeInitialDraft } from '../onboarding/HyperHomeApi';
export type HyperInitialDraft = HyperHomeInitialDraft & { modelPick?: { model: string; effort: string | null } };
/** One memory-only start transaction, retained after refusal so retry reuses its server channel. */
export class HyperInitialDraftTransfer<T> {
  private active?: AbortController;
  private held?: { ids: string[]; draft?: HyperInitialDraft; channel?: T };
  cancel() { this.active?.abort(); }
  forget(channel: T) { if (this.held?.channel === channel) this.held = undefined; }
  async start(ids: string[], draft: HyperInitialDraft | undefined, deps: {
    create(ids: string[]): Promise<T>;
    receive(channel: T, draft: HyperInitialDraft, signal: AbortSignal): Promise<void>;
    navigate(channel: T): void;
  }) {
    if (this.active) throw new Error('A conversation is already being started.');
    const same = this.held && this.held.ids.join('\0') === ids.join('\0') && JSON.stringify(this.held.draft?.modelPick) === JSON.stringify(draft?.modelPick) && this.held.draft?.text === draft?.text && this.held.draft?.submit === draft?.submit && this.held.draft?.commandIds.join('\0') === draft?.commandIds.join('\0') && this.held.draft?.files.length === draft?.files.length && this.held.draft?.files.every((file, index) => file === draft?.files[index]);
    const held = same ? this.held! : { ids: [...ids], draft, channel: undefined as T | undefined };
    this.held = held;
    const controller = new AbortController(); this.active = controller;
    try {
      controller.signal.throwIfAborted();
      held.channel ??= await deps.create(ids);
      controller.signal.throwIfAborted();
      if (draft) await deps.receive(held.channel, draft, controller.signal);
      controller.signal.throwIfAborted();
      deps.navigate(held.channel); this.held = undefined;
    } finally { this.active = undefined; }
  }
}
export type HyperInitialDraftReceiver = (draft: HyperInitialDraft, signal: AbortSignal) => Promise<void>;

import { hyperUploadDraftFiles, type HyperConversationDraft, type HyperDraftAttachment } from '../HyperConversationDraft';
import { hyperOpenBotFetch, HYPER_OPENBOT_ORIGIN, hyperOpenBotRequest } from '../transport';
/** Consume a Home draft through the same placeholder and retry machinery as the visible composer. */
export async function hyperReceiveInitialDraft(channelId: string, initial: HyperInitialDraft, signal: AbortSignal, deps: {
  get(): HyperConversationDraft;
  assertCurrent(): void;
  update(change: (draft: HyperConversationDraft) => HyperConversationDraft): unknown;
  uploaded: Map<File, HyperDraftAttachment>;
  send(draft: HyperConversationDraft): Promise<void>;
}) {
  signal.throwIfAborted();
  deps.assertCurrent();
  deps.update(current => ({ ...current, text: initial.text, commandIds: [...initial.commandIds] }));
  await hyperUploadDraftFiles(initial.files.filter(file => !deps.uploaded.has(file)), async file => {
    signal.throwIfAborted();
    const form = new FormData(); form.append('file', file); form.append('uploadGroup', deps.get().uploadGroup);
    const response = await hyperOpenBotFetch(`${HYPER_OPENBOT_ORIGIN}/api/channels/${encodeURIComponent(channelId)}/attachments`, { method: 'POST', body: form, signal });
    const saved = await response.json();
    if (!response.ok || typeof saved.id !== 'string' || typeof saved.name !== 'string' || typeof saved.mimeType !== 'string') throw new Error('Attachment upload failed');
    const attachment: HyperDraftAttachment = { id: saved.id, name: saved.name, mimeType: saved.mimeType, status: 'ready' };
    signal.throwIfAborted(); deps.assertCurrent();
    deps.uploaded.set(file, attachment); return attachment;
  }, change => deps.update(current => ({ ...current, attachments: change(current.attachments) })), id => { void hyperOpenBotRequest(`/api/attachments/${encodeURIComponent(id)}`, 'DELETE').catch(() => {}); }, () => { signal.throwIfAborted(); deps.assertCurrent(); });
  signal.throwIfAborted();
  if (initial.submit) {
    await deps.send(deps.get()); signal.throwIfAborted();
    deps.update(current => ({ ...current, text: '', attachments: [], commandIds: [] }));
  }
}
