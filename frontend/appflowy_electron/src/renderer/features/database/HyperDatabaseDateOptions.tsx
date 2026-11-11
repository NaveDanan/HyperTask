import { clone } from '@bufbuild/protobuf';
import { DateFormatPB, DateTypeOptionPBSchema, TimeFormatPB, type DateTypeOptionPB } from '@shared/protobuf/flowy-database2/date_entities_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { hyperDatabaseDateFormats, hyperDatabaseDateOptionsEditable, hyperDatabaseDateZone } from './HyperDatabaseDate';
import { useHyperDatabaseDateText } from './HyperDatabaseDateStrings';
const examples: Record<DateFormatPB, string> = { [DateFormatPB.Local]: '11/23/2026', [DateFormatPB.US]: '2026/11/23', [DateFormatPB.ISO]: '2026-11-23', [DateFormatPB.Friendly]: 'Nov 23, 2026', [DateFormatPB.DayMonthYear]: '23/11/2026', [DateFormatPB.FriendlyFull]: 'November 23, 2026' };
export function HyperDatabaseDateOptions({ value, disabled, onChange }: { value: DateTypeOptionPB; disabled: boolean; onChange(value: DateTypeOptionPB): void }) {
  const text = useHyperDatabaseDateText(), supported = hyperDatabaseDateOptionsEditable(value), system = hyperDatabaseDateZone('');
  let validZone = true; try { hyperDatabaseDateZone(value.timezoneId); } catch { validZone = false; }
  const change = (changes: Partial<DateTypeOptionPB>) => { const next = clone(DateTypeOptionPBSchema, value); Object.assign(next, changes); onChange(next); };
  return <div className="flex flex-col gap-3 border-t pt-3">
    {!supported && <Alert variant="info"><AlertDescription>{text('unsupported')}</AlertDescription></Alert>}
    <label className="flex flex-col gap-1 text-xs">{text('dateFormat')}<Select value={String(value.dateFormat)} disabled={disabled || !supported} onValueChange={format => { if (format !== null) change({ dateFormat: Number(format) }); }}><SelectTrigger aria-label={text('dateFormat')} className="w-full"><SelectValue>{examples[value.dateFormat] ?? String(value.dateFormat)}</SelectValue></SelectTrigger><SelectContent>{hyperDatabaseDateFormats.map(format => <SelectItem value={String(format)} key={format}>{examples[format]}</SelectItem>)}</SelectContent></Select></label>
    <label className="flex flex-col gap-1 text-xs">{text('timeFormat')}<Select value={String(value.timeFormat)} disabled={disabled || !supported} onValueChange={format => { if (format !== null) change({ timeFormat: Number(format) }); }}><SelectTrigger aria-label={text('timeFormat')} className="w-full"><SelectValue>{text(value.timeFormat === TimeFormatPB.TwelveHour ? 'twelveHour' : 'twentyFourHour')}</SelectValue></SelectTrigger><SelectContent><SelectItem value={String(TimeFormatPB.TwelveHour)}>{text('twelveHour')}</SelectItem><SelectItem value={String(TimeFormatPB.TwentyFourHour)}>{text('twentyFourHour')}</SelectItem></SelectContent></Select></label>
    <label className="flex flex-col gap-1 text-xs">{text('timezone')}<Input aria-label={text('timezone')} value={value.timezoneId} placeholder={system} disabled={disabled || !supported} aria-invalid={!validZone} onChange={event => change({ timezoneId: event.target.value })} /></label>
    {!validZone && <p role="alert" className="text-xs text-destructive">{text('invalidZone')}</p>}
    <p className="text-xs text-muted-foreground">{text('systemZone', { zone: system })}</p>
    {validZone && <p className="text-xs text-muted-foreground">{text('filterZone')}</p>}
  </div>;
}
