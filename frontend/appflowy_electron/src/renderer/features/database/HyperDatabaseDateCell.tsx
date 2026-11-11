import { useEffect, useState } from 'react';
import type { FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import type { DateCellDataPB } from '@shared/protobuf/flowy-database2/date_entities_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { HyperDatabaseRepository } from './HyperDatabaseRepository';
import type { HyperDatabaseDraftInputs } from './HyperDatabaseDraftCell';
import { HyperDatabaseDateError, hyperDatabaseDateCandidates, hyperDatabaseDateDisplay, hyperDatabaseDateEditable, hyperDatabaseDateInitial, hyperDatabaseDateMutation, hyperDatabaseDateOffset, hyperDatabaseDateParts, hyperDatabaseDateOptions, hyperDatabaseDateZone, type HyperDatabaseDateForm } from './HyperDatabaseDate';
import { useHyperDatabaseDateText } from './HyperDatabaseDateStrings';

export function HyperDatabaseDateCell({ repository, viewId, rowId, field, data, editable, saving, save, drafts }: {
  repository: HyperDatabaseRepository; viewId: string; rowId: string; field: FieldPB; data: DateCellDataPB;
  editable: boolean; saving: boolean; save(operation: () => Promise<void>): Promise<boolean>; drafts?: HyperDatabaseDraftInputs;
}) {
  const text = useHyperDatabaseDateText(), [open, setOpen] = useState(false), [local, setLocal] = useState<Partial<HyperDatabaseDateForm>>({});
  const options = hyperDatabaseDateOptions(field.typeOptionData);
  let zone = options.timezoneId, initial: HyperDatabaseDateForm;
  try { zone = hyperDatabaseDateZone(options.timezoneId); initial = hyperDatabaseDateInitial(data, options); }
  catch { initial = { start: '', end: '', startTime: '00:00:00', endTime: '00:00:00', includeTime: data.includeTime ? '1' : '0', isRange: data.isRange ? '1' : '0', startChoice: '', endChoice: '' }; }
  const form = Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, drafts ? drafts.value('date.' + key, value) : local[key as keyof HyperDatabaseDateForm] ?? value])) as unknown as HyperDatabaseDateForm;
  const changed = Object.entries(initial).some(([key, value]) => form[key as keyof HyperDatabaseDateForm] !== value);
  const allowed = editable && hyperDatabaseDateEditable(data, options), disabled = !allowed || saving;
  useEffect(() => { setLocal({}); }, [data]);
  const change = (key: keyof HyperDatabaseDateForm, value: string) => { if (disabled) return; if (drafts) drafts.change('date.' + key, value, initial[key]); else setLocal(previous => ({ ...previous, [key]: value })); };
  let mutation: ReturnType<typeof hyperDatabaseDateMutation> | undefined, issue: HyperDatabaseDateError['reason'] | null = null;
  try { if (open) mutation = hyperDatabaseDateMutation(data, options, form); } catch (error) { issue = error instanceof HyperDatabaseDateError ? error.reason : 'unsupported'; }
  const candidates = (end: boolean) => {
    try {
      const previous = end && data.oneOfEndTimestamp.case ? data.oneOfEndTimestamp : data.oneOfTimestamp;
      const time = form.includeTime === '1' ? end ? form.endTime : form.startTime : previous.case ? hyperDatabaseDateParts(previous.value, zone).time : '00:00:00';
      return hyperDatabaseDateCandidates(end ? form.end || form.start : form.start, time, zone);
    } catch { return []; }
  };
  const occurrence = (end: boolean) => {
    const choices = candidates(end); if (choices.length < 2) return null;
    const selected = choices.findIndex(value => String(value) === form[end ? 'endChoice' : 'startChoice']);
    const key = end ? 'endChoice' : 'startChoice', label = text(end ? 'endOccurrence' : 'startOccurrence');
    return <label className="flex flex-col gap-1 text-xs">{label}<Select value={choices.some(value => String(value) === form[key]) ? form[key] : ''} disabled={disabled} onValueChange={value => { if (value !== null) change(key, value); }}><SelectTrigger aria-label={label} className="w-full"><SelectValue>{selected < 0 ? text('chooseOccurrence') : `${text(selected ? 'later' : 'earlier')} · ${hyperDatabaseDateOffset(choices[selected], zone)}`}</SelectValue></SelectTrigger><SelectContent>{choices.map((value, index) => <SelectItem key={String(value)} value={String(value)}>{text(index ? 'later' : 'earlier')} · {hyperDatabaseDateOffset(value, zone)}</SelectItem>)}</SelectContent></Select></label>;
  };
  const display = hyperDatabaseDateDisplay(data, options);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger render={<Button variant="ghost" className="min-h-8 w-full justify-start overflow-hidden px-2 font-normal" aria-label={`${field.name} · ${rowId}`} />}><span className="truncate">{display || text('empty')}</span><span className="shrink-0 text-xs text-muted-foreground">{zone}</span></PopoverTrigger><PopoverContent className="max-h-[80vh] w-80 overflow-auto" aria-label={`${field.name} · ${rowId}`}>
    <p className="whitespace-pre-wrap text-sm">{display || text('empty')}</p><p className="text-xs text-muted-foreground">{zone}</p>
    {open && (!allowed ? <Alert variant="info"><AlertDescription>{text(data.reminderId ? 'reminder' : editable ? 'unsupported' : 'readOnly')}</AlertDescription></Alert> : <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); if (!mutation || disabled || !changed) return; const changes = mutation; void save(() => repository.updateDateDetails(viewId, rowId, field.id, changes)).then(saved => { if (saved) { setLocal({}); setOpen(false); } }); }}>
      <label className="flex flex-col gap-1 text-xs">{text('start')}<Input type="date" required aria-label={text('start')} value={form.start} disabled={disabled} onChange={event => { change('start', event.target.value); change('startChoice', ''); }} /></label>
      {form.includeTime === '1' && <label className="flex flex-col gap-1 text-xs">{text('startTime')}<Input type="time" step="1" required aria-label={text('startTime')} value={form.startTime} disabled={disabled} onChange={event => { change('startTime', event.target.value); change('startChoice', ''); }} /></label>}{occurrence(false)}
      <label className="flex items-center gap-2 text-xs"><Checkbox aria-label={text('includeTime')} checked={form.includeTime === '1'} disabled={disabled} onCheckedChange={checked => change('includeTime', checked ? '1' : '0')} />{text('includeTime')}</label>
      <label className="flex items-center gap-2 text-xs"><Checkbox aria-label={text('range')} checked={form.isRange === '1'} disabled={disabled} onCheckedChange={checked => { change('isRange', checked ? '1' : '0'); if (checked && !data.isRange) { change('end', form.start); change('endTime', form.startTime); change('endChoice', form.startChoice); } }} />{text('range')}</label>
      {form.isRange === '1' && <><label className="flex flex-col gap-1 text-xs">{text('end')}<Input type="date" required aria-label={text('end')} value={form.end} disabled={disabled} onChange={event => { change('end', event.target.value); change('endChoice', ''); }} /></label>{form.includeTime === '1' && <label className="flex flex-col gap-1 text-xs">{text('endTime')}<Input type="time" step="1" required aria-label={text('endTime')} value={form.endTime} disabled={disabled} onChange={event => { change('endTime', event.target.value); change('endChoice', ''); }} /></label>}{occurrence(true)}</>}
      {issue && changed && <p role="alert" className="text-xs text-destructive">{text(issue)}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={disabled || !mutation || !changed}>{text('save')}</Button><Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => { drafts?.discard(); setLocal({}); setOpen(false); }}>{text('cancel')}</Button><Button type="button" size="sm" variant="ghost" disabled={disabled || data.oneOfTimestamp.case !== 'timestamp'} onClick={() => { void save(() => repository.updateDateDetails(viewId, rowId, field.id, { clearFlag: true })).then(saved => { if (saved) setOpen(false); }); }}>{text('clear')}</Button></div>
    </form>)}
  </PopoverContent></Popover>;
}
