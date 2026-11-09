import { useEffect, useMemo, useState } from 'react';
import { AlarmClock, Archive, ArchiveRestore, AtSign, Bell, CheckCheck, Lock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ReminderPB } from '@shared/protobuf/flowy-user/reminder_pb';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { DocumentEventOpenDocument } from '@/backend/events';
import { useTr } from '@/i18n';
import { useAppearanceStore } from '@/theme/appearance-store';
import { Tooltip, showToast } from '@/ui';
import { homeSettingActions } from '@/features/home/home-setting-store';
import { isDatabaseLayout, isViewLocked, nameOrDefault } from '@/features/view/view-ext';
import { ViewBackendService } from '@/features/view/view-service';
import { hintTooltip, isMac } from '../components';
import { performOpenViewAction } from '../navigation';
import {
  ReminderMetaKeys,
  reminderActions,
  scheduledAtMs,
  useReminderStore,
} from '../stores/reminder-store';
import { blockDelta, deltaPlainText, findBlock, topLevelIndex } from './reminder-document';
import { filterReminders, formatReminderTimestamp, formatUserDate, formatUserTime, type NotificationTabType } from './notification-utils';

const TABS: NotificationTabType[] = ['inbox', 'unread', 'archive'];
const TAB_KEYS: Record<NotificationTabType, string> = {
  inbox: 'settings.notifications.tabs.inbox',
  unread: 'settings.notifications.tabs.unread',
  archive: 'settings.notifications.tabs.archived',
};

/** NotificationPanel (workspace/presentation/notifications/notification_panel.dart). */
export function NotificationPanel({ left, top }: { left: number; top: number }) {
  const { tr } = useTr();
  const [tab, setTab] = useState<NotificationTabType>('inbox');
  const close = () => homeSettingActions.collapseNotificationPanel();
  return (
    // The transparent backdrop covers the rest of the window: tapping it closes the panel.
    <div className="absolute right-0 bottom-0 z-[1]" style={{ left, top }} onClick={close}>
      <div className="flex h-full w-[22rem] flex-col border-r bg-background shadow-lg"
        onClick={(event) => event.stopPropagation()}>
        <div className="flex h-12 shrink-0 items-center gap-2 px-4">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tr('notificationHub.title')}</span>
          <Tooltip message={tr('settings.notifications.settings.markAllAsRead')}>
            <Button variant="ghost" size="icon-sm" aria-label={tr('settings.notifications.settings.markAllAsRead')}
              onClick={() => {
                showToast({ message: tr('notificationHub.markAllAsReadSucceedToast') });
                void reminderActions.markAllRead();
              }}><CheckCheck /></Button>
          </Tooltip>
          <Tooltip message={tr('settings.notifications.settings.archiveAll')}>
            <Button variant="ghost" size="icon-sm" aria-label={tr('settings.notifications.settings.archiveAll')}
              onClick={() => {
                showToast({ message: tr('notificationHub.markAllAsArchivedSucceedToast') });
                void reminderActions.archiveAll();
              }}><Archive /></Button>
          </Tooltip>
          <Tooltip rich={hintTooltip(tr('notificationHub.closeNotification'), isMac ? '⌘+.' : 'Ctrl+\\')}>
            <Button variant="ghost" size="icon-sm" aria-label={tr('notificationHub.closeNotification')} onClick={close}><X /></Button>
          </Tooltip>
        </div>
        <Tabs value={tab} onValueChange={(value) => setTab(value as NotificationTabType)} className="min-h-0 flex-1 gap-0">
          <TabsList variant="line" className="w-full shrink-0 justify-start rounded-none border-b px-2">
            {TABS.map((t) => <TabsTrigger key={t} value={t} className="flex-none">{tr(TAB_KEYS[t])}</TabsTrigger>)}
          </TabsList>
          <TabsContent value={tab} className="flex min-h-0 flex-col">
            <NotificationTab key={tab} tab={tab} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function NotificationTab({ tab }: { tab: NotificationTabType }) {
  const { tr } = useTr();
  const reminders = useReminderStore((s) => s.reminders);
  const filtered = useMemo(() => filterReminders(reminders, tab), [reminders, tab]);
  if (filtered.length === 0) return <EmptyNotification tab={tab} />;
  const now = Date.now();
  const today = filtered.filter((r) => now - scheduledAtMs(r) < 86_400_000);
  const older = filtered.filter((r) => now - scheduledAtMs(r) >= 86_400_000);
  const group = (title: string, items: ReminderPB[]) => items.length === 0 ? null : (
    <div className="flex flex-col">
      <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">{title}</div>
      {items.map((reminder) => <NotificationItem key={`${tab}_${reminder.id}`} tab={tab} reminder={reminder} />)}
    </div>
  );
  return <div className="min-h-0 flex-1 overflow-y-auto">
    {group(tr('notificationHub.today'), today)}
    {group(tr('notificationHub.older'), older)}
  </div>;
}

function EmptyNotification({ tab }: { tab: NotificationTabType }) {
  const { tr } = useTr();
  const key = tab === 'inbox' ? 'emptyInbox' : tab === 'archive' ? 'emptyArchived' : 'emptyUnread';
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon"><Bell className="size-5" /></EmptyMedia>
        <EmptyTitle>{tr(`settings.notifications.${key}.title`)}</EmptyTitle>
        <EmptyDescription>{tr(`settings.notifications.${key}.description`)}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

interface LoadedReminder {
  view: ViewPB;
  scheduledAt: string;
  pageTitle: string;
  isLocked: boolean;
  /** Document: the reminder's block text; database: the reminder message. */
  content: string;
  nodePath: number | null;
}

/** NotificationReminderBloc: the view, its title, and the block (documents) or message (databases). */
function useLoadedReminder(reminder: ReminderPB): LoadedReminder | null {
  const dateFormat = useAppearanceStore((s) => s.dateTime.dateFormat);
  const timeFormat = useAppearanceStore((s) => s.dateTime.timeFormat);
  const [loaded, setLoaded] = useState<LoadedReminder | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const scheduledAt = formatReminderTimestamp(scheduledAtMs(reminder), dateFormat, timeFormat);
      const viewResult = await ViewBackendService.getView(reminder.objectId);
      if (!viewResult.ok) return;
      const view = viewResult.value;
      const base = { view, scheduledAt, pageTitle: nameOrDefault(view), isLocked: isViewLocked(view) };
      if (isDatabaseLayout(view.layout)) {
        if (alive) setLoaded({ ...base, content: reminder.message, nodePath: null });
        return;
      }
      const blockId = reminder.meta[ReminderMetaKeys.blockId];
      if (blockId === undefined) return;
      const doc = await DocumentEventOpenDocument({ documentId: reminder.objectId });
      if (!doc.ok) return;
      const block = findBlock(doc.value, blockId);
      if (!block) return;
      const delta = blockDelta(doc.value, block) ?? [];
      const content = deltaPlainText(delta, (mention) => {
        const date = typeof mention.date === 'string' ? new Date(mention.date) : null;
        if (date && !Number.isNaN(date.getTime())) {
          const withTime = mention.include_time === true;
          return `@${formatUserDate(date, dateFormat)}${withTime ? ` ${formatUserTime(date, timeFormat)}` : ''}`;
        }
        return '@';
      });
      if (alive) setLoaded({ ...base, content, nodePath: topLevelIndex(doc.value, blockId) });
    })();
    return () => {
      alive = false;
    };
  }, [reminder, dateFormat, timeFormat]);
  return loaded;
}

/** NotificationItemV2: hidden until its page loads; hover shows read/archive actions. */
function NotificationItem({ tab, reminder }: { tab: NotificationTabType; reminder: ReminderPB }) {
  const { tr } = useTr();
  const loaded = useLoadedReminder(reminder);
  const [hover, setHover] = useState(false);
  if (!loaded) return null;

  return (
    <Item className="relative flex-nowrap items-start gap-3 rounded-none border-0 border-b px-4 py-3 hover:bg-muted/50"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" aria-label={loaded.pageTitle}
        className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => {
          homeSettingActions.collapseNotificationPanel();
          // pressReminder: mark past reminders read, then open the page at the block / row.
          const pressed = reminderActions.pressReminder(reminder.id);
          if (!pressed) return;
          const rowId = reminder.meta[ReminderMetaKeys.rowId] ?? null;
          void performOpenViewAction({ objectId: reminder.objectId, nodePath: loaded.nodePath, rowId });
        }} />
      <ItemMedia className="pointer-events-none"><NotificationIcon /></ItemMedia>
      <ItemContent className="pointer-events-none min-w-0 gap-1">
        <div className="flex items-center gap-2">
          <ItemTitle className="min-w-0 flex-1 text-sm font-medium">{tr('settings.notifications.titles.reminder')}</ItemTitle>
          {loaded.scheduledAt && <span className="shrink-0 text-2xs text-muted-foreground">{loaded.scheduledAt}</span>}
        </div>
        <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="shrink-0">{tr('notificationHub.mentionedYou')}</span>
          <span className="size-0.5 shrink-0 rounded-full bg-muted-foreground" />
          {loaded.isLocked && <Lock className="size-3 shrink-0" />}
          <span className="truncate">{loaded.pageTitle}</span>
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">{loaded.content}</p>
      </ItemContent>
      {!reminder.isRead && <span className="pointer-events-none mt-1.5 size-2 shrink-0 rounded-full bg-info" />}
      {hover && (
        <div className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-background"
          onClick={(event) => event.stopPropagation()}>
          {tab === 'archive' ? (
            <Tooltip message={tr('notificationHub.unarchiveTooltip')}>
              <Button variant="ghost" size="icon-xs" aria-label={tr('notificationHub.unarchiveTooltip')}
                onClick={() => void reminderActions.update({ id: reminder.id, isArchived: false })}><ArchiveRestore /></Button>
            </Tooltip>
          ) : <>
            {!reminder.isRead && (
              <Tooltip message={tr('notificationHub.markAsReadTooltip')}>
                <Button variant="ghost" size="icon-xs" aria-label={tr('notificationHub.markAsReadTooltip')}
                  onClick={() => {
                    void reminderActions.update({ id: reminder.id, isRead: true });
                    showToast({ message: tr('notificationHub.markAsReadSucceedToast') });
                  }}><CheckCheck /></Button>
              </Tooltip>
            )}
            <Tooltip message={tr('notificationHub.archivedTooltip')}>
              <Button variant="ghost" size="icon-xs" aria-label={tr('notificationHub.archivedTooltip')}
                onClick={() => {
                  void reminderActions.update({ id: reminder.id, isArchived: true, isRead: true });
                  showToast({ message: tr('notificationHub.markAsArchivedSucceedToast') });
                }}><Archive /></Button>
            </Tooltip>
          </>}
        </div>
      )}
    </Item>
  );
}

/** Reminder tile with its mention badge. */
function NotificationIcon() {
  return (
    <div className="relative flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <AlarmClock className="size-4" />
      <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-muted text-foreground">
        <AtSign className="size-3" />
      </span>
    </div>
  );
}
