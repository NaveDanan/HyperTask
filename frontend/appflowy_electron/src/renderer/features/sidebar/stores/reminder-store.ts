import { create as createMessage } from '@bufbuild/protobuf';
import { create } from 'zustand';
import { ReminderPBSchema, type ReminderPB } from '@shared/protobuf/flowy-user/reminder_pb';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { DocumentEventOpenDocument, UserEventGetAllReminders, UserEventRemoveReminder, UserEventUpdateReminder } from '@/backend/events';
import { ViewBackendService } from '@/features/view/view-service';
import { isDatabaseLayout } from '@/features/view/view-ext';
import { blockDelta, deltaMentionsReminder, findBlock } from '../notifications/reminder-document';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner } from '../../document/HyperDocumentOwner';

/** ReminderMetaKeys (user/application/reminder/reminder_extension.dart). */
export const ReminderMetaKeys = {
  includeTime: 'include_time',
  blockId: 'block_id',
  rowId: 'row_id',
  createdAt: 'created_at',
  isArchived: 'is_archived',
  date: 'date',
} as const;

export const reminderIsArchived = (r: ReminderPB) => r.meta[ReminderMetaKeys.isArchived] === 'true';
const reminderIncludeTime = (r: ReminderPB): boolean | null => {
  const value = r.meta[ReminderMetaKeys.includeTime];
  return value === undefined ? null : value === 'true';
};
const reminderDate = (r: ReminderPB): number | null => {
  const value = r.meta[ReminderMetaKeys.date];
  return value === undefined ? null : Number.parseInt(value, 10);
};
/** scheduledAt is in seconds. */
export const scheduledAtMs = (r: ReminderPB) => Number(r.scheduledAt) * 1000;

const uniqueReminders = (list: ReminderPB[]) => {
  const seen = new Set<string>();
  return list.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
};

/** ReminderState's constructor: past reminders, then upcoming ones, each by scheduledAt ascending. */
export function normalizeReminders(list: ReminderPB[], now = Date.now()): ReminderPB[] {
  const past = list.filter((r) => scheduledAtMs(r) < now).sort((a, b) => Number(a.scheduledAt - b.scheduledAt));
  const upcoming = list.filter((r) => scheduledAtMs(r) >= now).sort((a, b) => Number(a.scheduledAt - b.scheduledAt));
  return uniqueReminders([...past, ...upcoming]);
}

/** ReminderUpdate (reminder_bloc.dart). Unset fields are null, as in Dart. */
export interface ReminderUpdate {
  id: string;
  isAck?: boolean | null;
  isRead?: boolean | null;
  /** ms since epoch */
  scheduledAt?: number | null;
  includeTime?: boolean | null;
  isArchived?: boolean | null;
  /** ms since epoch */
  date?: number | null;
}

/**
 * ReminderUpdate.merge, including its quirks: a null includeTime/isArchived that differs from the
 * reminder's value is written as the string "null", and isAck is only recomputed from a new
 * scheduledAt.
 */
export function mergeReminderUpdate(update: ReminderUpdate, a: ReminderPB, now = Date.now()): ReminderPB {
  const isAck = (update.isAck ?? null) === null && update.scheduledAt != null ? update.scheduledAt < now : a.isAck;
  const meta = { ...a.meta };
  const includeTime = update.includeTime ?? null;
  if (includeTime !== reminderIncludeTime(a)) meta[ReminderMetaKeys.includeTime] = String(includeTime);
  const isArchived = update.isArchived ?? null;
  if (isArchived !== reminderIsArchived(a)) meta[ReminderMetaKeys.isArchived] = String(isArchived);
  if (update.date != null && update.date !== reminderDate(a)) meta[ReminderMetaKeys.date] = String(update.date);
  return createMessage(ReminderPBSchema, {
    id: a.id,
    objectId: a.objectId,
    scheduledAt: update.scheduledAt != null ? BigInt(Math.floor(update.scheduledAt / 1000)) : a.scheduledAt,
    isAck,
    isRead: update.isRead ?? a.isRead,
    title: a.title,
    message: a.message,
    meta,
  });
}

export interface ReminderState {
  /** ReminderState.reminders: available reminders, past first. */
  reminders: ReminderPB[];
  serverReminders: ReminderPB[];
}

/** ReminderBloc (user/application/reminder/reminder_bloc.dart): an app-wide singleton. */
export const useReminderStore = create<ReminderState>(() => ({ reminders: [], serverReminders: [] }));
const get = useReminderStore.getState;
const set = useReminderStore.setState;

const setReminders = (reminders: ReminderPB[]) => set({ reminders: normalizeReminders(reminders) });
const allReminders = () => uniqueReminders([...get().serverReminders, ...get().reminders]);
export const unreadReminderCount = (state: ReminderState) => state.reminders.filter((r) => !r.isRead).length;

let allViews: ViewPB[] = [];
let timer: number | undefined;
let onFocus: (() => void) | null = null;
let activeOwner = '', ownerVersion = 0, refreshVersion = 0;
function captureOwner() {
  const owner = hyperGetDocumentOwner(), key = hyperDocumentOwnerKey(owner);
  if (key !== activeOwner) { activeOwner = key; ownerVersion++; refreshVersion++; allViews = []; set({ reminders: [], serverReminders: [] }); }
  const version = ownerVersion;
  return { valid: () => !!owner && owner.isCurrent() && version === ownerVersion && key === hyperDocumentOwnerKey(hyperGetDocumentOwner()) };
}

/** checkReminderAvailable: due (or read), its view exists, and for documents the mention still exists. */
async function checkReminderAvailable(reminder: ReminderPB, views: ViewPB[], current: () => boolean): Promise<boolean> {
  if (!current()) return false;
  if (!(Date.now() > scheduledAtMs(reminder)) && !reminder.isRead) return false;
  const view = views.find((v) => v.id === reminder.objectId);
  if (!view) return false;
  if (isDatabaseLayout(view.layout)) return true;
  const blockId = reminder.meta[ReminderMetaKeys.blockId];
  if (blockId === undefined) return false;
  const doc = await DocumentEventOpenDocument({ documentId: view.id });
  if (!current() || !doc.ok) return false;
  const block = findBlock(doc.value, blockId);
  if (!block) return false;
  const delta = blockDelta(doc.value, block);
  if (!delta) return false;
  return deltaMentionsReminder(delta, new Set([reminder.id]));
}

function periodicCheck() {
  window.clearInterval(timer);
  timer = window.setInterval(() => void reminderActions.refresh(), 30_000);
}

export const reminderActions = {
  /** ReminderEvent.started → refresh. Also starts the 30 s refresh timer the bloc owns. */
  started() {
    if (timer === undefined) {
      periodicCheck();
      // AppLifecycleListener.onResume → resetTimer.
      onFocus = () => periodicCheck();
      window.addEventListener('focus', onFocus);
    }
    void reminderActions.refresh();
  },

  dispose() {
    ownerVersion++; refreshVersion++; activeOwner = '';
    window.clearInterval(timer);
    timer = undefined;
    if (onFocus) window.removeEventListener('focus', onFocus);
    onFocus = null;
    allViews = [];
    set({ reminders: [], serverReminders: [] });
  },

  async refresh() {
    const owner = captureOwner(), requestVersion = ++refreshVersion;
    const current = () => owner.valid() && requestVersion === refreshVersion;
    if (!current()) return;
    const result = await UserEventGetAllReminders();
    if (!current()) return;
    const views = await ViewBackendService.getAllViews();
    if (!current() || !views.ok || !result.ok) return;
    const visibleViews = views.value.items;
    const reminders = result.value.items;
    const available: ReminderPB[] = [];
    for (const r of reminders) {
      if (await checkReminderAvailable(r, visibleViews, current)) available.push(r);
      if (!current()) return;
    }
    allViews = visibleViews;
    set({ reminders: normalizeReminders(available), serverReminders: reminders });
  },

  async removeReminder(reminderId: string) {
    const owner = captureOwner(); if (!owner.valid() || !allReminders().some(item => item.id === reminderId)) return;
    const result = await UserEventRemoveReminder({ id: reminderId });
    if (result.ok && owner.valid()) set({ reminders: get().reminders.filter((r) => r.id !== reminderId), serverReminders: get().serverReminders.filter(r => r.id !== reminderId) });
  },

  async update(update: ReminderUpdate) {
    const owner = captureOwner(); if (!owner.valid()) return;
    const reminder = allReminders().find((r) => r.id === update.id);
    if (!reminder) return;
    const next = mergeReminderUpdate(update, reminder);
    const result = await UserEventUpdateReminder(next);
    if (!result.ok || !owner.valid()) return;
    set({ serverReminders: get().serverReminders.map(item => item.id === next.id ? next : item) });
    const index = get().reminders.findIndex((r) => r.id === next.id);
    const available = await checkReminderAvailable(next, [...allViews], owner.valid);
    if (!owner.valid()) return;
    if (index === -1) {
      if (available) setReminders([...get().reminders, next]);
      return;
    }
    const reminders = [...get().reminders];
    if (available) reminders.splice(index, 1, next);
    else reminders.splice(index, 1);
    setReminders(reminders);
  },

  /** markAllRead: every unread reminder is updated one by one. */
  async markAllRead() {
    const owner = captureOwner(); if (!owner.valid()) return;
    for (const r of get().reminders.filter((r) => !r.isRead)) {
      if (!owner.valid()) return;
      const result = await UserEventUpdateReminder({ ...r, isRead: true });
      if (!owner.valid()) return;
      if (result.ok) set({ reminders: get().reminders.map(item => item.id === r.id ? { ...item, isRead: true } : item), serverReminders: get().serverReminders.map(item => item.id === r.id ? { ...item, isRead: true } : item) });
    }
  },

  /** archiveAll: archived reminders are also marked read. */
  async archiveAll() {
    const owner = captureOwner(); if (!owner.valid()) return;
    const archive = (r: ReminderPB) => ({ ...r, isRead: true, meta: { ...r.meta, [ReminderMetaKeys.isArchived]: 'true' } });
    for (const r of get().reminders.filter((r) => !reminderIsArchived(r))) {
      if (!owner.valid()) return;
      const result = await UserEventUpdateReminder(archive(r));
      if (!owner.valid()) return;
      if (result.ok) set({ reminders: get().reminders.map(item => item.id === r.id ? archive(item) : item), serverReminders: get().serverReminders.map(item => item.id === r.id ? archive(item) : item) });
    }
  },

  /** pressReminder: mark past reminders read; the caller navigates to the reminder's page. */
  pressReminder(reminderId: string): ReminderPB | null {
    const owner = captureOwner(); if (!owner.valid()) return null;
    const reminder = get().reminders.find((r) => r.id === reminderId);
    if (!reminder) return null;
    const isPast = scheduledAtMs(reminder) < Date.now();
    void reminderActions.update({ id: reminderId, isRead: isPast });
    return reminder;
  },
};
