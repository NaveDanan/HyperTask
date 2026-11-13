import { UserDateFormatPB, UserTimeFormatPB } from '@shared/protobuf/flowy-user/date_time_pb';
import { hyperDocumentColorCss } from '../document-format/HyperDocumentColor';
import type { HyperTextRun } from '../document/HyperDocumentModel';
import type { HyperMentionSelection } from '../document/HyperDocumentMentions';
import { formatDate } from '../view-header/date-format';

/** Names and spelling match AppFlowy's ReminderOption enum. */
export const hyperDateReminderOptions = ['none', 'atTimeOfEvent', 'fiveMinsBefore', 'tenMinsBefore', 'fifteenMinsBefore', 'thirtyMinsBefore', 'oneHourBefore', 'twoHoursBefore', 'onDayOfEvent', 'oneDayBefore', 'twoDaysBefore', 'oneWeekBefore', 'custom'] as const;
export type HyperDateReminderOption = typeof hyperDateReminderOptions[number];
export interface HyperDateMention extends Record<string, unknown> { type: 'date' | 'reminder'; date: string; include_time?: unknown; reminder_id?: unknown; reminder_option?: unknown }
export interface HyperDateDraft { date: string; time: string; includeTime: boolean; reminderOption: string; customTime: string }
export interface HyperDateTarget { selection: HyperMentionSelection; mention: HyperDateMention; attributes: Record<string, unknown> }
/** Product-owned, versioned metadata makes custom-only timer edits native-undoable. */
export function hyperDocumentCustomSchedule(attributes: Record<string, unknown>): bigint | null {
  const value = attributes.hyper_reminder;
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('version' in value) || value.version !== 1) throw new Error('This custom reminder metadata is not supported. Its data was kept.');
  if (!('custom_scheduled_at_seconds' in value)) return null;
  const seconds = value.custom_scheduled_at_seconds;
  if (typeof seconds !== 'string' || !/^-?(?:0|[1-9]\d*)$/u.test(seconds) || seconds.length > 14 || BigInt(seconds) < -8_640_000_000_000n || BigInt(seconds) > 8_640_000_000_000n) throw new Error('This custom reminder schedule is invalid. Its data was kept.');
  return BigInt(seconds);
}
export function hyperDocumentDateAttributes(attributes: Record<string, unknown>, draft: HyperDateDraft, scheduledAt: bigint | null): Record<string, unknown> {
  const result = { ...attributes }, previous = attributes.hyper_reminder;
  if (draft.reminderOption === 'custom') {
    hyperDocumentCustomSchedule(attributes);
    if (scheduledAt === null) throw new Error('A custom reminder requires a schedule.');
    result.hyper_reminder = { ...(previous as object | undefined), version: 1, custom_scheduled_at_seconds: String(scheduledAt) };
  } else if (previous && typeof previous === 'object' && !Array.isArray(previous) && 'version' in previous && previous.version === 1) {
    const next = { ...previous } as Record<string, unknown>; delete next.custom_scheduled_at_seconds;
    if (Object.keys(next).length === 1) delete result.hyper_reminder; else result.hyper_reminder = next;
  }
  return result;
}
const pad = (n: number) => String(n).padStart(2, '0');
export const hyperLocalDateInput = (date: Date) => `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const hyperLocalTimeInput = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
export const hyperLocalDateTimeInput = (date: Date) => `${hyperLocalDateInput(date)}T${hyperLocalTimeInput(date)}`;
export function hyperParseMentionDate(value: string): Date {
  const part = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/u.exec(value);
  if (!part) return new Date(NaN);
  const [year, month, day] = part.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return new Date(NaN);
  if (value.length === 10) { try { return hyperParseLocalDateTime(value); } catch { return new Date(NaN); } }
  return new Date(value);
}
export function hyperDocumentDateMention(run: HyperTextRun): HyperDateMention | null {
  const mention = run.attributes?.mention;
  return typeof run.insert === 'string' && /^\$+$/u.test(run.insert) && !!mention && typeof mention === 'object' && !Array.isArray(mention) && 'type' in mention && ['date', 'reminder'].includes(String(mention.type)) && 'date' in mention && typeof mention.date === 'string' ? mention as HyperDateMention : null;
}
export function hyperDocumentDateLabel(mention: HyperDateMention, dateFormat = UserDateFormatPB.ISO, timeFormat = UserTimeFormatPB.TwentyFourHour): string {
  const date = hyperParseMentionDate(mention.date);
  return Number.isNaN(date.getTime()) ? '@Invalid date' : `@${formatDate(date, dateFormat, mention.include_time === true, timeFormat)}`;
}
/** Manual DOM is needed inside the existing contenteditable editor; attributes remain lossless. */
export function hyperCreateDocumentDateElement(run: HyperTextRun, dateFormat = UserDateFormatPB.ISO, timeFormat = UserTimeFormatPB.TwentyFourHour): HTMLButtonElement {
  const mention = hyperDocumentDateMention(run);
  if (!mention || run.insert !== '$') throw new Error('A date atom must contain one mention character.');
  const button = document.createElement('button'), a = run.attributes ?? {};
  button.type = 'button'; button.contentEditable = 'false'; button.tabIndex = 0;
  button.dataset.hyperAtomic = JSON.stringify('$'); button.dataset.hyperAttributes = JSON.stringify(a); button.dataset.hyperDateMention = 'true';
  button.className = ['rounded-md bg-muted px-1 text-primary', a.bold && 'font-semibold', a.italic && 'italic', a.underline && 'underline', a.strikethrough && 'line-through', a.code && 'font-mono text-sm'].filter(Boolean).join(' ');
  const foreground = hyperDocumentColorCss(a.font_color), background = hyperDocumentColorCss(a.bg_color);
  if (foreground) button.style.color = foreground; if (background) button.style.backgroundColor = background;
  button.textContent = hyperDocumentDateLabel(mention, dateFormat, timeFormat); button.setAttribute('aria-label', button.textContent); return button;
}
export function hyperDocumentDateDraft(mention?: HyperDateMention, scheduledAt?: bigint, now = new Date()): HyperDateDraft {
  const parsed = mention ? hyperParseMentionDate(mention.date) : now, valid = !Number.isNaN(parsed.getTime());
  const id = typeof mention?.reminder_id === 'string' && mention.reminder_id;
  return { date: valid ? hyperLocalDateInput(parsed) : '', time: valid ? hyperLocalTimeInput(parsed) : '09:00:00', includeTime: mention?.include_time === true,
    reminderOption: typeof mention?.reminder_option === 'string' ? mention.reminder_option : id ? 'custom' : 'none',
    customTime: scheduledAt !== undefined ? hyperLocalDateTimeInput(new Date(Number(scheduledAt) * 1000)) : '' };
}
export function hyperParseLocalDateTime(date: string, time = '00:00:00'): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date), t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(time);
  if (!d || !t) throw new Error('Enter a valid date and time.');
  const [year, month, day] = d.slice(1).map(Number), [hour, minute, second = 0] = t.slice(1).map(value => value === undefined ? 0 : Number(value));
  const result = new Date(0); result.setFullYear(year, month - 1, day); result.setHours(hour, minute, second, 0);
  if (year < 1000 || year > 9999 || result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day || result.getHours() !== hour || result.getMinutes() !== minute || result.getSeconds() !== second) throw new Error('Enter a valid date and time.');
  return result;
}
export function hyperDocumentDateValue(draft: HyperDateDraft, existing?: HyperDateMention): string {
  const initial = existing ? hyperDocumentDateDraft(existing) : null;
  if (initial && initial.date === draft.date && initial.time === draft.time && initial.includeTime === draft.includeTime && !Number.isNaN(hyperParseMentionDate(existing!.date).getTime())) return existing!.date;
  return hyperLocalDateTimeInput(hyperParseLocalDateTime(draft.date, draft.includeTime ? draft.time : '00:00:00')) + '.000';
}
export function hyperDocumentDateSchedule(draft: HyperDateDraft, date: string): bigint | null {
  if (!hyperDateReminderOptions.includes(draft.reminderOption as HyperDateReminderOption)) throw new Error('Choose a supported reminder option before saving.');
  if (draft.reminderOption === 'none') return null;
  let scheduled = hyperParseMentionDate(date);
  if (Number.isNaN(scheduled.getTime())) throw new Error('Enter a valid date.');
  if (draft.reminderOption === 'custom') {
    const [day, time] = draft.customTime.split('T'); scheduled = hyperParseLocalDateTime(day ?? '', time ?? '');
  } else if (['onDayOfEvent', 'oneDayBefore', 'twoDaysBefore', 'oneWeekBefore'].includes(draft.reminderOption)) {
    const days = { onDayOfEvent: 0, oneDayBefore: 1, twoDaysBefore: 2, oneWeekBefore: 7 }[draft.reminderOption]!;
    scheduled.setDate(scheduled.getDate() - days); scheduled.setHours(9, 0, 0, 0);
  } else {
    if (!draft.includeTime) throw new Error('Include a time or choose a reminder at 9:00 AM.');
    const minutes = { atTimeOfEvent: 0, fiveMinsBefore: 5, tenMinsBefore: 10, fifteenMinsBefore: 15, thirtyMinsBefore: 30, oneHourBefore: 60, twoHoursBefore: 120 }[draft.reminderOption]!;
    scheduled = new Date(scheduled.getTime() - minutes * 60_000);
  }
  return BigInt(Math.floor(scheduled.getTime() / 1000));
}
export function hyperBuildDocumentDateMention(draft: HyperDateDraft, existing?: HyperDateMention, reminderId?: string): HyperDateMention {
  const mention: HyperDateMention = { ...existing, type: existing?.type ?? 'date', date: hyperDocumentDateValue(draft, existing), include_time: draft.includeTime };
  const initial = existing ? hyperDocumentDateDraft(existing) : null;
  if (!initial || initial.reminderOption !== draft.reminderOption || existing?.reminder_option !== undefined) mention.reminder_option = draft.reminderOption;
  if (draft.reminderOption === 'none') delete mention.reminder_id;
  else { if (!reminderId) throw new Error('The reminder ID is missing.'); mention.reminder_id = reminderId; }
  return mention;
}
