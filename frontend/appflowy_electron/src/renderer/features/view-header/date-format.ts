// DateFormatter on UserDateFormatPB (workspace/application/settings/date_time/date_format_ext.dart)
// with intl's en DateFormat patterns.
import { UserDateFormatPB, UserTimeFormatPB } from '@shared/protobuf/flowy-user/date_time_pb';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function formatDay(date: Date, format: UserDateFormatPB): string {
  const y = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  switch (format) {
    case UserDateFormatPB.Locally:
      return `${MM}/${dd}/${y}`; // MM/dd/y
    case UserDateFormatPB.US:
      return `${y}/${MM}/${dd}`; // y/MM/dd
    case UserDateFormatPB.ISO:
      return `${y}-${MM}-${dd}`; // y-MM-dd
    case UserDateFormatPB.DayMonthYear:
      return `${dd}/${MM}/${y}`; // dd/MM/y
    default:
      return `${MONTHS[date.getMonth()]} ${dd}, ${y}`; // MMM dd, y
  }
}

/** add_Hm → "HH:mm"; add_jm → "h:mm AM" (en). */
export function formatTime(date: Date, timeFormat: UserTimeFormatPB): string {
  if (timeFormat === UserTimeFormatPB.TwentyFourHour) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const h = date.getHours() % 12 || 12;
  return `${h}:${pad(date.getMinutes())} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** UserDateFormatPB.formatDate(date, includeTime, timeFormat). */
export function formatDate(date: Date, format: UserDateFormatPB, includeTime: boolean, timeFormat?: UserTimeFormatPB): string {
  const day = formatDay(date, format);
  if (!includeTime || timeFormat === undefined) return day;
  return `${day} ${formatTime(date, timeFormat)}`;
}

/** DateFormat('MM/dd/yyyy hh:mm a') (trash cells). */
export function formatTrashDate(seconds: bigint): string {
  const date = new Date(Number(seconds) * 1000);
  const h = date.getHours() % 12 || 12;
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()} ${pad(h)}:${pad(date.getMinutes())} ${
    date.getHours() < 12 ? 'AM' : 'PM'
  }`;
}
