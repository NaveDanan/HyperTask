import { createStore, type StoreApi } from 'zustand';
import { clone, create } from '@bufbuild/protobuf';
import { ReminderPBSchema, type ReminderPB } from '@shared/protobuf/flowy-user/reminder_pb';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { RowMetaPB } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { UserEventCreateReminder, UserEventGetAllReminders, UserEventGetUserProfile, UserEventRemoveReminder, UserEventUpdateReminder } from '@/backend/events/flowy-user';
import { FolderEventGetView, FolderEventReadCurrentWorkspace } from '@/backend/events/flowy-folder';
import { DatabaseEventGetRowMeta } from '@/backend/events/flowy-database2';
import { unwrap } from '@/backend/dispatch';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import type { HyperMentionSelection } from '../document/HyperDocumentMentions';
import { hyperCaptureMentionSelection } from '../document/HyperDocumentMentions';
import { viewIsLocked } from '../view-header/page-access-level-store';
import { rowDocumentIdForRow } from '../templates/converter';
import { reminderActions } from '../sidebar/stores/reminder-store';
import { hyperApplyDocumentDate, hyperBuildDocumentDateMention, hyperDocumentDateAttributes, hyperDocumentDateDraft, hyperDocumentDateSchedule, hyperParseMentionDate, type HyperDateDraft, type HyperDateTarget } from './HyperDocumentDateModel';
import { hyperDocumentReminderHistory, type HyperDocumentReminderHistory } from './HyperDocumentReminderHistory';

export interface HyperDocumentDateContext { session: HyperDocumentSession; owner: HyperDocumentOwner; editable(): boolean; canWrite?(): boolean; rowScope?: { viewId: string; rowId: string }; currentOwner?(): HyperDocumentOwner | null }
export interface HyperDocumentDateBackend {
  identity(): Promise<{ workspaceId: string; actorId: string }>;
  view(id: string): Promise<ViewPB>;
  row(viewId: string, rowId: string): Promise<RowMetaPB>;
  reminders(): Promise<ReminderPB[]>;
  create(reminder: ReminderPB): Promise<void>;
  update(reminder: ReminderPB): Promise<void>;
  remove(id: string): Promise<void>;
  changed(): void;
}
export const hyperDocumentDateBackend: HyperDocumentDateBackend = {
  identity: async () => ({ workspaceId: unwrap(await FolderEventReadCurrentWorkspace()).id, actorId: String(unwrap(await UserEventGetUserProfile()).id) }),
  view: async value => unwrap(await FolderEventGetView({ value })), row: async (viewId, rowId) => unwrap(await DatabaseEventGetRowMeta({ viewId, rowId })),
  reminders: async () => unwrap(await UserEventGetAllReminders()).items,
  create: async reminder => unwrap(await UserEventCreateReminder(reminder)), update: async reminder => unwrap(await UserEventUpdateReminder(reminder)), remove: async id => unwrap(await UserEventRemoveReminder({ id })),
  changed: () => { void reminderActions.refresh(); },
};
interface HyperDocumentDateState { status: 'idle' | 'loading' | 'editing' | 'saving' | 'saved' | 'partial' | 'error'; draft: HyperDateDraft; error: string | null; recovery: string; editingExisting: boolean }
export interface HyperDocumentDateStore extends StoreApi<HyperDocumentDateState> {
  history: HyperDocumentReminderHistory;
  start(): () => void;
  open(target: HyperDateTarget | null, insertion?: HyperMentionSelection | null): Promise<void>;
  save(draft: HyperDateDraft): Promise<{ id: string; offset: number } | undefined>;
  close(): void;
  dispose(): void;
}
const message = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);
const serial = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
/** Date text saves first. A reminder failure is explicit and is never automatically replayed. */
export function createHyperDocumentDateStore(context: HyperDocumentDateContext, backend = hyperDocumentDateBackend): HyperDocumentDateStore {
  const { session } = context, owner = { ...context.owner }, key = hyperDocumentOwnerKey(owner);
  const history = hyperDocumentReminderHistory(context, backend);
  const store = createStore<HyperDocumentDateState>(() => ({ status: 'idle', draft: hyperDocumentDateDraft(), error: null, recovery: '', editingExisting: false }));
  let disposed = false, lost = false, version = 0, target: HyperDateTarget | null = null, insertion: HyperMentionSelection | null = null;
  let releaseHistory: (() => void) | undefined;
  const set = (values: Partial<HyperDocumentDateState>) => { if (!disposed) store.setState(values); };
  const current = () => {
    const state = session.store.getState();
    if (disposed || lost || !owner.isCurrent() || hyperDocumentOwnerKey((context.currentOwner ?? hyperGetDocumentOwner)()) !== key || !session.belongsTo(owner) || !session.isCurrentOwner()) { lost = true; throw new Error('The document, workspace or account changed. Reopen the date picker.'); }
    if (!context.editable() || !state.document || state.historyPending || ['loading', 'error'].includes(state.status)) throw new Error('This document is read-only or unavailable.');
    return state.document;
  };
  const validate = async () => {
    current(); const identity = await backend.identity(); current();
    if (identity.workspaceId !== owner.workspaceId || identity.actorId !== owner.actorId) { lost = true; throw new Error('The active workspace or account changed.'); }
    const rowScope = context.rowScope, view = await backend.view(rowScope?.viewId ?? session.id); current();
    if (view.id !== (rowScope?.viewId ?? session.id) || viewIsLocked(view)) throw new Error('This page is unavailable or locked.');
    if (rowScope) {
      if (![ViewLayoutPB.Grid, ViewLayoutPB.Board, ViewLayoutPB.Calendar].includes(view.layout)) throw new Error('The row database is unavailable.');
      const row = await backend.row(rowScope.viewId, rowScope.rowId); current();
      const id = row.oneOfDocumentId.case === 'documentId' && row.oneOfDocumentId.value ? row.oneOfDocumentId.value : rowDocumentIdForRow(row.id);
      if (row.id !== rowScope.rowId || id !== session.id || row.oneOfIsDocumentEmpty.case === 'isDocumentEmpty' && row.oneOfIsDocumentEmpty.value) throw new Error('The row document changed or was removed.');
    } else if (view.layout !== ViewLayoutPB.Document) throw new Error('This page is no longer a document.');
    const latest = await backend.identity(); current();
    if (latest.workspaceId !== owner.workspaceId || latest.actorId !== owner.actorId) { lost = true; throw new Error('The active workspace or account changed.'); }
  };
  const boundReminder = (all: ReminderPB[], id: string, blockId: string): ReminderPB | undefined => {
    const found = all.filter(item => item.id === id);
    if (found.length > 1) throw new Error('This reminder ID is duplicated. Copy the recovery details before changing it.');
    const reminder = found[0];
    if (reminder && (![session.id, context.rowScope?.viewId].includes(reminder.objectId) || reminder.meta.block_id && reminder.meta.block_id !== blockId || context.rowScope && reminder.meta.row_id && reminder.meta.row_id !== context.rowScope.rowId)) throw new Error('The reminder belongs to another page or block.');
    return reminder;
  };
  return Object.assign(store, {
    history,
    start() { disposed = false; releaseHistory?.(); releaseHistory = history.connect(context); return () => this.dispose(); },
    async open(next: HyperDateTarget | null, nextInsertion: HyperMentionSelection | null = null) {
      if (disposed || store.getState().status === 'saving') return;
      const run = ++version; target = next; insertion = nextInsertion;
      set({ status: 'loading', error: null, recovery: '', editingExisting: !!next, draft: hyperDocumentDateDraft(next?.mention) });
      try {
        if (history.blocked()) throw new Error('Finish reminder recovery before changing another date.');
        await validate(); const id = typeof next?.mention.reminder_id === 'string' ? next.mention.reminder_id : '';
        const reminder = id ? boundReminder(await backend.reminders(), id, next!.selection.id) : undefined; current();
        if (run === version) set({ status: 'editing', draft: hyperDocumentDateDraft(next?.mention, reminder?.scheduledAt) });
      } catch (error) { if (run === version) set({ status: 'error', error: message(error) }); }
    },
    async save(draft: HyperDateDraft) {
      if (disposed || store.getState().status !== 'editing') throw new Error('Reopen the date picker before saving.');
      const finishDate = history.beginDate();
      const run = version, original = target, selection = target?.selection ?? insertion;
      let accepted = false, dateSaved = false, recovery = '';
      let beforeDoc: ReturnType<typeof current> | undefined, afterDoc: ReturnType<typeof current> | undefined, beforeSidecars: ReminderPB[] = [];
      set({ status: 'saving', error: null });
      try {
        const oldId = typeof original?.mention.reminder_id === 'string' ? original.mention.reminder_id : '';
        const id = draft.reminderOption === 'none' ? undefined : oldId || crypto.randomUUID();
        const mention = hyperBuildDocumentDateMention(draft, original?.mention, id), scheduledAt = hyperDocumentDateSchedule(draft, mention.date);
        await validate(); await session.flush(); current(); if (run !== version) throw new Error('The date picker was closed.');
        beforeSidecars = (await backend.reminders()).map(item => clone(ReminderPBSchema, item)); beforeDoc = current();
        if (oldId) boundReminder(beforeSidecars, oldId, original!.selection.id);
        history.remember(beforeDoc, beforeSidecars);
        const attributes = hyperDocumentDateAttributes(original?.attributes ?? {}, draft, scheduledAt);
        const change = session.change(doc => { current(); return hyperApplyDocumentDate(doc, selection, mention, attributes); });
        if (!change?.focus) throw new Error('The date could not be saved.'); accepted = true;
        afterDoc = change.document;
        const focus = change.focus, written = hyperCaptureMentionSelection(change.document, { id: focus.id, selection: { start: focus.offset - 1, end: focus.offset } })!;
        recovery = serial({ documentId: session.id, workspaceId: owner.workspaceId, actorId: owner.actorId, blockId: focus.id, mention, scheduledAtSeconds: scheduledAt, reminderAction: scheduledAt === null ? 'remove' : 'create-or-update', previousReminderId: oldId || null });
        set({ recovery }); await session.flush(); dateSaved = true;
        await validate(); if (run !== version) throw new Error('The date picker was closed after saving the date.');
        const all = await backend.reminders(); current();
        if (hyperCaptureMentionSelection(current(), written)?.runs !== written.runs) throw new Error('The text changed after saving the date. The reminder was not changed.');
        const previous = oldId ? boundReminder(all, oldId, focus.id) : undefined;
        let resulting = all.map(item => clone(ReminderPBSchema, item));
        if (scheduledAt === null) { if (previous) { await validate(); await backend.remove(previous.id); resulting = resulting.filter(item => item.id !== previous.id); } }
        else {
          const existing = id ? boundReminder(all, id, focus.id) : undefined;
          const next = create(ReminderPBSchema, { ...existing, id: id!, objectId: context.rowScope?.viewId ?? session.id, scheduledAt, title: existing?.title || 'Reminder', message: existing?.message || 'You have a reminder.', isAck: Number(scheduledAt) * 1000 < Date.now(), isRead: existing?.isRead ?? false,
            meta: { ...existing?.meta, block_id: focus.id, include_time: String(draft.includeTime), created_at: existing?.meta.created_at ?? String(Date.now()), date: String(hyperParseMentionDate(mention.date).getTime()), ...(context.rowScope ? { row_id: context.rowScope.rowId } : {}) } });
          await validate(); if (existing) await backend.update(next); else await backend.create(next);
          resulting = [...resulting.filter(item => item.id !== next.id), next];
        }
        current(); if (run !== version) throw new Error('The date picker was closed after saving.');
        history.remember(change.document, resulting); backend.changed(); set({ status: 'saved', recovery: '', error: null }); return focus;
      } catch (error) {
        if (dateSaved && beforeDoc && afterDoc) await history.dateFailed(beforeDoc, afterDoc, beforeSidecars, error);
        set({ status: accepted ? 'partial' : 'editing', error: accepted ? `${dateSaved ? 'The date was saved, but its reminder was not confirmed.' : 'The date save was not confirmed.'} ${message(error)} Copy the recovery details. No operation will be retried automatically.` : message(error), recovery }); throw error;
      } finally { finishDate(); }
    },
    close() { if (store.getState().status !== 'saving') { version++; target = null; insertion = null; } },
    dispose() { disposed = true; version++; target = null; insertion = null; releaseHistory?.(); releaseHistory = undefined; },
  });
}
