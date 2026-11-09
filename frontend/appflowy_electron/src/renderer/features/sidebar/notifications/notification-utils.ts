// Notification panel helpers: tab filtering and reminder timestamps.
import type { ReminderPB } from '@shared/protobuf/flowy-user/reminder_pb';
import { UserDateFormatPB, UserTimeFormatPB } from '@shared/protobuf/flowy-user/date_time_pb';
import { tr as translate } from '@/i18n';
import { reminderIsArchived } from '../stores/reminder-store';

export type NotificationTabType = 'inbox' | 'unread' | 'archive';

/** NotificationTab._filterReminders: newest first, unique by id. */
export function filterReminders(reminders: ReminderPB[], tab: NotificationTabType): ReminderPB[] {
  const reversed = [...reminders].reverse();
  const filtered = reversed.filter((r) =>
    tab === 'inbox' ? !reminderIsArchived(r) : tab === 'archive' ? reminderIsArchived(r) : !r.isRead,
  );
  const seen = new Set<string>();
  return filtered.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

// ---- date formatting (date_format_ext.dart / time_format_ext.dart, intl en_US patterns) ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export function formatUserDate(date: Date, format: UserDateFormatPB): string {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  switch (format) {
    case UserDateFormatPB.Locally:
      return `${m}/${d}/${y}`;
    case UserDateFormatPB.US:
      return `${y}/${m}/${d}`;
    case UserDateFormatPB.ISO:
      return `${y}-${m}-${d}`;
    case UserDateFormatPB.DayMonthYear:
      return `${d}/${m}/${y}`;
    default:
      return `${MONTHS[date.getMonth()]} ${d}, ${y}`;
  }
}

export function formatUserTime(date: Date, format: UserTimeFormatPB): string {
  if (format === UserTimeFormatPB.TwentyFourHour) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const h = date.getHours() % 12 || 12;
  return `${h}:${pad(date.getMinutes())} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
}

const isToday = (date: Date, now = new Date()) =>
  date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();

/** NotificationReminderBloc._formatTimestamp. */
export function formatReminderTimestamp(ms: number, dateFormat: UserDateFormatPB, timeFormat: UserTimeFormatPB, now = new Date()): string {
  const date = new Date(ms);
  const diff = now.getTime() - ms;
  if (diff < 60_000) return translate('sideBar.justNow');
  if (diff < 3_600_000 && isToday(date, now)) {
    return translate('sideBar.minutesAgo', { namedArgs: { count: Math.floor(diff / 60_000) } });
  }
  if (diff >= 3_600_000 && isToday(date, now)) return formatUserTime(date, timeFormat);
  return formatUserDate(date, dateFormat);
}

