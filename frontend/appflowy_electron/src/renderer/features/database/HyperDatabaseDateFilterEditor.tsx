import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { hyperDatabaseDateZone } from './HyperDatabaseDate';
import { hyperDatabaseDateFilterChanged, hyperDatabaseDateFilterConditions, hyperDatabaseDateFilterEdit, hyperDatabaseDateFilterEmpty, hyperDatabaseDateFilterForm, hyperDatabaseDateFilterRange, type HyperDatabaseDateFilterValue } from './HyperDatabaseDateFilter';
import { useHyperDatabaseDateFilterText, type hyperDatabaseDateFilterStrings } from './HyperDatabaseDateFilterStrings';
import { hyperDatabaseTimestampFilterEdit, hyperDatabaseTimestampFilterForm } from './HyperDatabaseTimestampFilter';
export const hyperDatabaseDateFilterLabels: (keyof typeof hyperDatabaseDateFilterStrings)[] = ['startOn', 'startBefore', 'startAfter', 'startOnOrBefore', 'startOnOrAfter', 'startBetween', 'startEmpty', 'startNotEmpty', 'endOn', 'endBefore', 'endAfter', 'endOnOrBefore', 'endOnOrAfter', 'endBetween', 'endEmpty', 'endNotEmpty'];
export function HyperDatabaseDateFilterEditor({ value, timezoneId, disabled, creating = false, legacyOnly = false, onSave, onCancel }: {
  value: HyperDatabaseDateFilterValue; timezoneId: string; disabled: boolean; creating?: boolean; legacyOnly?: boolean; onSave(value: HyperDatabaseDateFilterValue): Promise<boolean>; onCancel(): void;
}) {
  const text = useHyperDatabaseDateFilterText(), [form, setForm] = useState(() => legacyOnly ? hyperDatabaseTimestampFilterForm(value) : hyperDatabaseDateFilterForm(value)), [optIn, setOptIn] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const conditions = legacyOnly ? hyperDatabaseDateFilterConditions.slice(0, 8) : hyperDatabaseDateFilterConditions;
  const changed = !legacyOnly && hyperDatabaseDateFilterChanged(value, form), supported = conditions.includes(value.condition), locked = disabled || saving || !supported;
  let result: ReturnType<typeof hyperDatabaseDateFilterEdit> | null = null, validation = '', zone = timezoneId;
  try { zone = hyperDatabaseDateZone(timezoneId); result = legacyOnly ? hyperDatabaseTimestampFilterEdit(value, form) : hyperDatabaseDateFilterEdit(value, form, optIn); }
  catch (error) { validation = (error as Error).message === 'endBeforeStart' ? text('endBeforeStart') : ['unsupported', 'invalidZone'].includes((error as Error).message) ? text('unsupported') : text('invalidDate'); }
  const policy = creating || value.useFieldTimezone || changed || optIn;
  return <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); if (locked || !result || !creating && !result.changed) return; const next = result.value; setSaving(true); setError(''); void onSave(next).catch(error => { setError((error as { msg?: string; message?: string }).msg ?? (error as Error).message ?? String(error)); }).finally(() => setSaving(false)); }}>
    {!supported && <Alert variant="info"><AlertDescription>{text('unsupported')}</AlertDescription></Alert>}
    <p className="text-xs text-muted-foreground">{legacyOnly ? text('systemOnly') : policy ? text('property', { zone }) : text('legacy')}</p>
    {!legacyOnly && !value.useFieldTimezone && !creating && <label className="flex items-center gap-2 text-xs"><Checkbox checked={policy} disabled={locked || changed} aria-label={text('optIn')} onCheckedChange={checked => setOptIn(checked === true)} />{text('optIn')}</label>}
    {!legacyOnly && !value.useFieldTimezone && policy && !creating && <p className="text-xs text-muted-foreground">{text('edited')}</p>}
    <label className="flex flex-col gap-1 text-xs">{text('operator')}<Select value={String(form.condition)} disabled={locked} onValueChange={condition => { if (condition !== null) setForm(previous => ({ ...previous, condition: Number(condition) })); }}><SelectTrigger aria-label={text('operator')} className="w-full"><SelectValue>{hyperDatabaseDateFilterLabels[form.condition] ? text(hyperDatabaseDateFilterLabels[form.condition]) : text('unsupported')}</SelectValue></SelectTrigger><SelectContent>{conditions.map(condition => <SelectItem key={condition} value={String(condition)}>{text(hyperDatabaseDateFilterLabels[condition])}</SelectItem>)}</SelectContent></Select></label>
    {form.condition >= 8 && form.condition <= 15 && <p className="text-xs text-muted-foreground">{text('endFallback')}</p>}
    {!hyperDatabaseDateFilterEmpty(form.condition) && (hyperDatabaseDateFilterRange(form.condition) ? <><label className="flex flex-col gap-1 text-xs">{text('start')}<Input aria-label={text('start')} type="date" required value={form.start} disabled={locked} onChange={event => setForm(previous => ({ ...previous, start: event.target.value }))} /></label><label className="flex flex-col gap-1 text-xs">{text('end')}<Input aria-label={text('end')} type="date" required value={form.end} disabled={locked} onChange={event => setForm(previous => ({ ...previous, end: event.target.value }))} /></label></> : <label className="flex flex-col gap-1 text-xs">{text('day')}<Input aria-label={text('day')} type="date" required value={form.day} disabled={locked} onChange={event => setForm(previous => ({ ...previous, day: event.target.value }))} /></label>)}
    {(error || validation && (legacyOnly || changed || creating || optIn)) && <Alert variant="destructive"><AlertDescription>{error || validation}</AlertDescription></Alert>}
    <div className="flex gap-2"><Button type="submit" size="sm" disabled={locked || !result || !creating && !result.changed}>{text(creating ? 'add' : 'save')}</Button><Button type="button" size="sm" variant="outline" disabled={saving} onClick={onCancel}>{text('cancel')}</Button></div>
  </form>;
}
