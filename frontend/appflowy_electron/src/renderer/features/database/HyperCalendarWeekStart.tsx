import { CalendarLayoutPB, type CalendarLayoutSettingPB } from '@shared/protobuf/flowy-database2/calendar_entities_pb';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTr } from '@/i18n';
import { hyperCalendarPeriodSettingsEditable, hyperCalendarWeekdayLabel, hyperCalendarWeekStartChoices } from './HyperCalendarPeriodModel';

export const hyperCalendarWeekStartStrings = {
  firstDay: 'First day of week',
  changed: 'This calendar changed. Refresh it before choosing the first day again.',
  unavailable: 'This calendar is read-only or unavailable.',
  unsupported: 'This calendar uses settings this version cannot edit. Its saved settings were kept.',
  uncertain: 'The first-day change could not be confirmed. Refresh this calendar before choosing it again.',
} as const;
export function useHyperCalendarWeekStartText() {
  const { tr } = useTr();
  return (name: keyof typeof hyperCalendarWeekStartStrings) => { const key = `hyperCalendarWeekStart.${name}`, translated = tr(key); return translated === key ? hyperCalendarWeekStartStrings[name] : translated; };
}
export function HyperCalendarWeekStart({ setting, editable, writing = false, locale, onChange }: {
  setting: CalendarLayoutSettingPB | null; editable: boolean; writing?: boolean; locale?: string; onChange(day: 0 | 1): void;
}) {
  const text = useHyperCalendarWeekStartText();
  if (!setting || ![CalendarLayoutPB.WeekLayout, CalendarLayoutPB.MonthLayout].includes(setting.layoutTy)) return null;
  const supported = hyperCalendarPeriodSettingsEditable(setting), language = locale ?? (typeof document === 'undefined' ? undefined : document.documentElement.lang || undefined);
  const label = (day: number) => { try { return hyperCalendarWeekdayLabel(day, language); } catch { return text('unsupported'); } };
  return <Select value={String(setting.firstDayOfWeek)} disabled={!editable || !supported} readOnly={writing} onValueChange={value => {
    if (!editable || !supported || writing || value === null) return;
    const day = Number(value); if ((day === 0 || day === 1) && day !== setting.firstDayOfWeek) onChange(day);
  }}><SelectTrigger aria-label={text('firstDay')} title={text('firstDay')}><SelectValue>{label(setting.firstDayOfWeek)}</SelectValue></SelectTrigger><SelectContent>
    {setting.firstDayOfWeek !== 0 && setting.firstDayOfWeek !== 1 && <SelectItem value={String(setting.firstDayOfWeek)} disabled>{label(setting.firstDayOfWeek)}</SelectItem>}
    {hyperCalendarWeekStartChoices.map(day => <SelectItem key={day} value={String(day)}>{label(day)}</SelectItem>)}
  </SelectContent></Select>;
}
