import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTr } from '@/i18n';
import { CalendarLayoutPB, type CalendarLayoutSettingPB } from '@shared/protobuf/flowy-database2/calendar_entities_pb';
import { HyperCalendarPeriodError, hyperCalendarPeriodFrame, hyperCalendarPeriodKind, hyperCalendarPeriodLabel, hyperCalendarPeriodLayouts, hyperCalendarPeriodMove, hyperCalendarPeriodSettingsEditable, hyperCalendarPeriodToday } from './HyperCalendarPeriodModel';

export const hyperCalendarPeriodStrings = {
  period: 'Calendar period', day: 'Day', week: 'Week', month: 'Month', previous: 'Previous period', next: 'Next period', today: 'Today',
  unsupportedPeriod: 'Unsupported period',
  unsupported: 'This calendar uses settings this version cannot edit. Its saved settings were kept.',
  invalidDate: 'This calendar period is outside the supported date range.',
  changed: 'This calendar changed. Refresh it before choosing a period again.',
  unavailable: 'This calendar is read-only or unavailable.',
  uncertain: 'The period change could not be confirmed. Refresh this calendar before choosing a period again.',
} as const;
export function useHyperCalendarPeriodText() {
  const { tr } = useTr();
  return (name: keyof typeof hyperCalendarPeriodStrings) => { const key = `hyperCalendarPeriod.${name}`, value = tr(key); return value === key ? hyperCalendarPeriodStrings[name] : value; };
}
/** Browsing is local. Only changing the saved period requires write permission. */
export function HyperCalendarPeriodControls({ anchorDay, setting, timezoneId, editable, writing = false, locale, onAnchorChange, onLayoutChange }: {
  anchorDay: string;
  setting: CalendarLayoutSettingPB | null;
  timezoneId: string;
  editable: boolean;
  writing?: boolean;
  locale?: string;
  onAnchorChange(day: string): void;
  onLayoutChange(layout: CalendarLayoutPB): void;
}) {
  const text = useHyperCalendarPeriodText(), raw = setting?.layoutTy ?? CalendarLayoutPB.MonthLayout;
  let frame: ReturnType<typeof hyperCalendarPeriodFrame> | null = null;
  let frameError: 'unsupportedPeriod' | 'invalidDate' = 'unsupportedPeriod', todayAvailable = true;
  try { frame = hyperCalendarPeriodFrame(anchorDay, raw, setting?.firstDayOfWeek ?? 0); } catch (error) { if (error instanceof HyperCalendarPeriodError && error.reason === 'invalidDate') frameError = 'invalidDate'; }
  try { hyperCalendarPeriodToday(timezoneId); } catch { todayAvailable = false; }
  const move = (direction: -1 | 1) => { try { return frame ? hyperCalendarPeriodMove(frame, direction) : null; } catch { return null; } };
  const previous = move(-1), next = move(1), kind = hyperCalendarPeriodKind(raw), supported = hyperCalendarPeriodSettingsEditable(setting);
  return <div className="flex flex-col gap-2" data-hyper-calendar-period>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="ghost" size="icon-sm" aria-label={text('previous')} title={text('previous')} disabled={!previous} onClick={() => { if (previous) onAnchorChange(previous); }}><ChevronLeft /></Button>
      <span className="min-w-32 text-sm font-medium" aria-live="polite">{frame ? hyperCalendarPeriodLabel(frame, locale) : text(frameError)}</span>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={text('next')} title={text('next')} disabled={!next} onClick={() => { if (next) onAnchorChange(next); }}><ChevronRight /></Button>
      <Button type="button" variant="outline" size="sm" disabled={!todayAvailable} onClick={() => { let day: string; try { day = hyperCalendarPeriodToday(timezoneId); } catch { return; } onAnchorChange(day); }}>{text('today')}</Button>
      <Select value={String(raw)} disabled={!editable || !supported} readOnly={writing} onValueChange={value => {
        if (!editable || writing || !supported || value === null) return;
        const layout = Number(value); if (hyperCalendarPeriodLayouts.includes(layout) && layout !== raw) onLayoutChange(layout);
      }}><SelectTrigger aria-label={text('period')}><SelectValue>{kind ? text(kind) : text('unsupportedPeriod')}</SelectValue></SelectTrigger><SelectContent>
        {!kind && <SelectItem value={String(raw)} disabled>{text('unsupportedPeriod')}</SelectItem>}
        {hyperCalendarPeriodLayouts.map(layout => <SelectItem key={layout} value={String(layout)}>{text(hyperCalendarPeriodKind(layout)!)}</SelectItem>)}
      </SelectContent></Select>
    </div>
    {setting && !supported && <p className="text-xs text-muted-foreground" role="status">{text('unsupported')}</p>}
  </div>;
}
