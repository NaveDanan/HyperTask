import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReminderPB } from '@shared/protobuf/flowy-user/reminder_pb';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { DocumentEventOpenDocument } from '@/backend/events';
import { useTr } from '@/i18n';
import { useAppearanceStore } from '@/theme/appearance-store';
import { AppFlowyPopover, FlowyButton, FlowySvg, FlowyText, VSpace, showToast, type PopoverController } from '@/ui';
import { homeSettingActions } from '@/features/home/home-setting-store';
import { isDatabaseLayout, isViewLocked, nameOrDefault } from '@/features/view/view-ext';
import { ViewBackendService } from '@/features/view/view-service';
import { SbIconButton, hintTooltip, isMac } from '../components';
import { performOpenViewAction } from '../navigation';
import {
  ReminderMetaKeys,
  reminderActions,
  scheduledAtMs,
  useReminderStore,
} from '../stores/reminder-store';
import { blockDelta, deltaPlainText, findBlock, topLevelIndex } from './reminder-document';
import { filterReminders, formatReminderTimestamp, formatUserDate, formatUserTime, type NotificationTabType } from './notification-utils';
import '../sidebar.css';

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
  const moreController = useRef<PopoverController>(null);
  const close = () => homeSettingActions.collapseNotificationPanel();

  return (
    // The transparent backdrop covers the rest of the window: tapping it closes the panel.
    <div style={{ position: 'absolute', left, top, right: 0, bottom: 0, zIndex: 1 }} onClick={close}>
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 380,
          height: '100%',
          background: 'var(--af-background-primary)',
          boxShadow: 'var(--af-shadow-small)',
          padding: '14px 0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ height: 24, padding: '0 16px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <FlowyText fontWeight={500} fontSize={16} lineHeight={24}>
            {tr('notificationHub.title')}
          </FlowyText>
          <div style={{ flex: 1 }} />
          <SbIconButton
            width={24}
            icon={<FlowySvg svg="double_back_arrow_m" color="var(--af-icon-secondary)" />}
            tooltip={hintTooltip(tr('notificationHub.closeNotification'), isMac ? '⌘+.' : 'Ctrl+\\')}
            onPressed={close}
          />
          <div style={{ width: 8 }} />
          <AppFlowyPopover
            controllerRef={moreController}
            trigger="none"
            constraints={{ maxWidth: 240, maxHeight: 78 }}
            offset={{ x: -24, y: 24 }}
            margin={0}
            plain
            popup={(closeMenu) => (
              <div
                style={{
                  padding: 8,
                  borderRadius: 8,
                  background: 'var(--th-card)',
                  boxShadow: '0 4px 24px #0000001F',
                  display: 'flex',
                  flexDirection: 'column',
                  width: 240,
                }}
              >
                <div style={{ height: 30 }}>
                  <FlowyButton
                    style={{ height: 30 }}
                    leftIcon={<FlowySvg svg="m_notification_mark_as_read_s" />}
                    text={<FlowyText>{tr('settings.notifications.settings.markAllAsRead')}</FlowyText>}
                    onTap={() => {
                      showToast({ message: tr('notificationHub.markAllAsReadSucceedToast') });
                      void reminderActions.markAllRead();
                      closeMenu();
                    }}
                  />
                </div>
                <VSpace size={2} />
                <div style={{ height: 30 }}>
                  <FlowyButton
                    style={{ height: 30 }}
                    leftIcon={<FlowySvg svg="m_notification_archived_s" />}
                    text={<FlowyText>{tr('settings.notifications.settings.archiveAll')}</FlowyText>}
                    onTap={() => {
                      showToast({ message: tr('notificationHub.markAllAsArchivedSucceedToast') });
                      void reminderActions.archiveAll();
                      closeMenu();
                    }}
                  />
                </div>
              </div>
            )}
          >
            <div style={{ display: 'flex' }}>
              <SbIconButton
                width={24}
                icon={<FlowySvg svg="three_dots_m" color="var(--af-icon-secondary)" />}
                onPressed={() => moreController.current?.show()}
              />
            </div>
          </AppFlowyPopover>
        </div>
        <VSpace size={12} />
        <div style={{ height: 32, paddingLeft: 16, display: 'flex', flexShrink: 0 }}>
          {TABS.map((t) => (
            <div key={t} className="sb-tab" style={{ paddingRight: 20 }} onClick={() => setTab(t)}>
              <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: `calc(${t === tab ? 16 : 15}px * var(--text-scale, 1))`,
                    fontWeight: t === tab ? 500 : 400,
                    lineHeight: '22px',
                    color: 'var(--text-color)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tr(TAB_KEYS[t])}
                </span>
                {t === tab && <div className="sb-tab-indicator" style={{ width: 28, background: '#00C8FF' }} />}
              </div>
            </div>
          ))}
        </div>
        <VSpace size={14} />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <NotificationTab key={tab} tab={tab} />
        </div>
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
  const group = (title: string, items: ReminderPB[]) =>
    items.length === 0 ? null : (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '0 16px' }}>
          <FlowyText lineHeight={18}>{title}</FlowyText>
        </div>
        <VSpace size={4} />
        {items.map((reminder) => (
          <NotificationItem key={`${tab}_${reminder.id}`} tab={tab} reminder={reminder} />
        ))}
      </div>
    );
  return (
    <div className="sb-scroll" style={{ flex: 1 }}>
      {group(tr('notificationHub.today'), today)}
      {group(tr('notificationHub.older'), older)}
    </div>
  );
}

function EmptyNotification({ tab }: { tab: NotificationTabType }) {
  const { tr } = useTr();
  const key = tab === 'inbox' ? 'emptyInbox' : tab === 'archive' ? 'emptyArchived' : 'emptyUnread';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <FlowySvg svg="m_empty_notification_xl" />
      <VSpace size={12} />
      <FlowyText fontSize={16} lineHeight={24} fontWeight={500}>
        {tr(`settings.notifications.${key}.title`)}
      </FlowyText>
      <VSpace size={4} />
      <div style={{ opacity: 0.45 }}>
        <FlowyText fontSize={15} lineHeight={22}>
          {tr(`settings.notifications.${key}.description`)}
        </FlowyText>
      </div>
    </div>
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

  const actionBox = {
    border: '1px solid var(--af-border-primary)',
    borderRadius: 6,
    background: 'var(--af-surface-primary)',
  } as const;

  return (
    <div style={{ padding: '0 8px' }}>
      <div
        className="flowy-hover"
        style={{ position: 'relative', borderRadius: 8, cursor: 'pointer' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => {
          homeSettingActions.collapseNotificationPanel();
          // pressReminder: mark past reminders read, then open the page at the block / row.
          const pressed = reminderActions.pressReminder(reminder.id);
          if (!pressed) return;
          const rowId = reminder.meta[ReminderMetaKeys.rowId] ?? null;
          void performOpenViewAction({ objectId: reminder.objectId, nodePath: loaded.nodePath, rowId });
        }}
      >
        <div style={{ padding: '14px 14px 10px 16px', display: 'flex', alignItems: 'flex-start' }}>
          <NotificationIcon />
          <div style={{ width: 12, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 22, display: 'flex', alignItems: 'center' }}>
              <FlowyText fontWeight={500} lineHeight={22} color="var(--af-text-primary)">
                {tr('settings.notifications.titles.reminder')}
              </FlowyText>
              <div style={{ flex: 1 }} />
              {loaded.scheduledAt && (
                <FlowyText fontSize={12} lineHeight={16} color="var(--af-text-secondary)">
                  {loaded.scheduledAt}
                </FlowyText>
              )}
              {!reminder.isRead && (
                <>
                  <div style={{ width: 4 }} />
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--af-border-error-thick)', flexShrink: 0 }} />
                </>
              )}
            </div>
            <div style={{ height: 18, display: 'flex', alignItems: 'center', minWidth: 0 }}>
              <FlowyText fontSize={12} lineHeight={18} color="var(--af-text-secondary)">
                {tr('notificationHub.mentionedYou')}
              </FlowyText>
              <div style={{ width: 2.5, height: 2.5, borderRadius: '50%', margin: '0 6px', background: 'var(--af-text-secondary)', flexShrink: 0 }} />
              {loaded.isLocked && (
                <div style={{ paddingRight: 5, display: 'flex' }}>
                  <FlowySvg svg="notification_lock_s" color="var(--af-icon-secondary)" />
                </div>
              )}
              <FlowyText fontSize={12} lineHeight={18} ellipsis color="var(--af-text-secondary)" style={{ flexShrink: 1 }}>
                {loaded.pageTitle}
              </FlowyText>
            </div>
            <FlowyText lineHeight={22} maxLines={3} ellipsis color="var(--af-text-primary)">
              {loaded.content}
            </FlowyText>
          </div>
        </div>
        {hover && (
          <div style={{ position: 'absolute', top: 8, right: 8 }} onClick={(event) => event.stopPropagation()}>
            {tab === 'archive' ? (
              <div style={{ ...actionBox, width: 32, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SbIconButton
                  width={24}
                  tooltip={tr('notificationHub.unarchiveTooltip')}
                  icon={<FlowySvg svg="notification_unarchive_s" />}
                  onPressed={() => void reminderActions.update({ id: reminder.id, isArchived: false })}
                />
              </div>
            ) : (
              <div style={{ ...actionBox, padding: '2px 4px', display: 'flex', alignItems: 'center' }}>
                {!reminder.isRead && (
                  <>
                    <SbIconButton
                      width={24}
                      tooltip={tr('notificationHub.markAsReadTooltip')}
                      icon={<FlowySvg svg="notification_markasread_s" />}
                      onPressed={() => {
                        void reminderActions.update({ id: reminder.id, isRead: true });
                        showToast({ message: tr('notificationHub.markAsReadSucceedToast') });
                      }}
                    />
                    <div style={{ width: 6 }} />
                  </>
                )}
                <SbIconButton
                  width={24}
                  tooltip={tr('notificationHub.archivedTooltip')}
                  icon={<FlowySvg svg="notification_archive_s" />}
                  onPressed={() => {
                    void reminderActions.update({ id: reminder.id, isArchived: true, isRead: true });
                    showToast({ message: tr('notificationHub.markAsArchivedSucceedToast') });
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** NotificationIcon: the reminder badge with an "@" bubble (42×36). */
function NotificationIcon() {
  return (
    <div style={{ width: 42, height: 36, position: 'relative', flexShrink: 0 }}>
      <FlowySvg svg="m_notification_reminder_s" size={32} blendMode={null} />
      <div
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'var(--af-fill-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <FlowySvg svg="notification_icon_at_s" size={14} color="var(--af-icon-primary)" />
      </div>
    </div>
  );
}

