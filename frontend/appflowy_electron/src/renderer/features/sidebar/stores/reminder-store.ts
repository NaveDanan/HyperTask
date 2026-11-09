import { create as createMessage } from '@bufbuild/protobuf';
import { create } from 'zustand';
import { ReminderPBSchema, type ReminderPB } from '@shared/protobuf/flowy-user/reminder_pb';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { DocumentEventOpenDocument, UserEventGetAllReminders, UserEventRemoveReminder, UserEventUpdateReminder } from '@/backend/events';
import { ViewBackendService } from '@/features/view/view-service';
import { isDatabaseLayout } from '@/features/view/view-ext';
import { blockDelta, deltaMentionsReminder, findBlock } from '../notifications/reminder-document';

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

/** checkReminderAvailable: due (or read), its view exists, and for documents the mention still exists. */
async function checkReminderAvailable(reminder: ReminderPB, reminderIds: Set<string>): Promise<boolean> {
  if (!(Date.now() > scheduledAtMs(reminder)) && !reminder.isRead) return false;
  const view = allViews.find((v) => v.id === reminder.objectId);
  if (!view) return false;
  if (isDatabaseLayout(view.layout)) return true;
  const blockId = reminder.meta[ReminderMetaKeys.blockId];
  if (blockId === undefined) return false;
  const doc = await DocumentEventOpenDocument({ documentId: view.id });
  if (!doc.ok) return false;
  const block = findBlock(doc.value, blockId);
  if (!block) return false;
  const delta = blockDelta(doc.value, block);
  if (!delta) return false;
  return deltaMentionsReminder(delta, reminderIds);
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
    window.clearInterval(timer);
    timer = undefined;
    if (onFocus) window.removeEventListener('focus', onFocus);
    onFocus = null;
    allViews = [];
    set({ reminders: [], serverReminders: [] });
  },

  async refresh() {
    const result = await UserEventGetAllReminders();
    const views = await ViewBackendService.getAllViews();
    if (views.ok) allViews = views.value.items;
    if (!result.ok) return;
    const reminders = result.value.items;
    const ids = new Set(reminders.map((r) => r.id));
    const available: ReminderPB[] = [];
    for (const r of reminders) {
      if (await checkReminderAvailable(r, ids)) available.push(r);
    }
    set({ reminders: normalizeReminders(available), serverReminders: reminders });
  },

  async removeReminder(reminderId: string) {
    const result = await UserEventRemoveReminder({ id: reminderId });
    if (result.ok) setReminders(get().reminders.filter((r) => r.id !== reminderId));
  },

  async update(update: ReminderUpdate) {
    const reminder = allReminders().find((r) => r.id === update.id);
    if (!reminder) return;
    const next = mergeReminderUpdate(update, reminder);
    const result = await UserEventUpdateReminder(next);
    if (!result.ok) return;
    const ids = new Set(allReminders().map((r) => r.id));
    const index = get().reminders.findIndex((r) => r.id === next.id);
    const available = await checkReminderAvailable(next, ids);
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
    for (const r of get().reminders.filter((r) => !r.isRead)) {
      await UserEventUpdateReminder({ ...r, isRead: true });
    }
    setReminders(get().reminders.map((r) => (r.isRead ? r : { ...r, isRead: true })));
  },

  /** archiveAll: archived reminders are also marked read. */
  async archiveAll() {
    const archive = (r: ReminderPB) => ({ ...r, isRead: true, meta: { ...r.meta, [ReminderMetaKeys.isArchived]: 'true' } });
    for (const r of get().reminders.filter((r) => !reminderIsArchived(r))) {
      await UserEventUpdateReminder(archive(r));
    }
    setReminders(get().reminders.map((r) => (reminderIsArchived(r) ? r : archive(r))));
  },

  /** pressReminder: mark past reminders read; the caller navigates to the reminder's page. */
  pressReminder(reminderId: string): ReminderPB | null {
    const reminder = get().reminders.find((r) => r.id === reminderId);
    if (!reminder) return null;
    const isPast = scheduledAtMs(reminder) < Date.now();
    void reminderActions.update({ id: reminderId, isRead: isPast });
    return reminder;
  },
};
