import { useState } from 'react';
import type { FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { hyperSelectOptions } from './HyperDatabaseCells';
import { hyperDatabaseFilterConditions, hyperDatabaseFilterKind, hyperDatabaseFilterNeedsValue, hyperDatabaseFilterSame, hyperDatabaseFilterValidate, type HyperDatabaseFilterKind, type HyperDatabaseFilterValue } from './HyperDatabaseFilter';
import { HyperDatabaseDateFilterEditor } from './HyperDatabaseDateFilterEditor';
import { useHyperDatabaseFilterText, type hyperDatabaseFilterStrings } from './HyperDatabaseFilterStrings';
import { HyperDatabaseWindowNavigation, useHyperDatabaseWindow } from './HyperDatabaseWindow';
export const hyperDatabaseFilterLabels: Record<Exclude<HyperDatabaseFilterKind, 'timestamp'>, (keyof typeof hyperDatabaseFilterStrings)[]> = {
  text: ['textIs', 'textIsNot', 'contains', 'doesNotContain', 'startsWith', 'endsWith', 'emptyValue', 'notEmpty'],
  number: ['equal', 'notEqual', 'greater', 'less', 'atLeast', 'atMost', 'emptyValue', 'notEmpty'],
  time: ['equal', 'notEqual', 'greater', 'less', 'atLeast', 'atMost', 'emptyValue', 'notEmpty'],
  checkbox: ['checked', 'unchecked'], checklist: ['complete', 'incomplete'], select: ['textIs', 'textIsNot', 'contains', 'doesNotContain', 'emptyValue', 'notEmpty'], media: ['emptyValue', 'notEmpty'], relation: ['emptyValue', 'notEmpty'],
};
function HyperDatabaseFilterOptions({ field, ids, disabled, onChange }: { field: FieldPB; ids: string[]; disabled: boolean; onChange(ids: string[]): void }) {
  const text = useHyperDatabaseFilterText(), [query, setQuery] = useState('');
  let options: { id: string; name: string }[] = []; try { options = hyperSelectOptions(field); } catch { /* Keep unsupported metadata readable without rewriting it. */ }
  const known = new Set(options.map(option => option.id));
  const choices = [...options, ...[...new Set(ids.filter(id => !known.has(id)))].map(id => ({ id, name: text('missingOption', { id }) }))].filter(option => option.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const window = useHyperDatabaseWindow(choices, `${field.id}:${query}`, 20);
  return <div className="flex flex-col gap-2">
    <Input aria-label={text('searchOptions')} placeholder={text('searchOptions')} value={query} onChange={event => setQuery(event.target.value)} />
    <p className="text-xs text-muted-foreground">{text('selected', { count: new Set(ids).size })}</p>
    {!window.total && <p className="text-xs text-muted-foreground">{text('noOptions')}</p>}
    {window.items.map(option => <label key={option.id} className="flex items-center gap-2 text-xs"><Checkbox checked={ids.includes(option.id)} disabled={disabled} aria-label={option.name} onCheckedChange={checked => onChange(checked === true ? [...ids, option.id] : ids.filter(id => id !== option.id))} /><span className="min-w-0 truncate">{option.name}</span></label>)}
    <HyperDatabaseWindowNavigation window={window} label={text('options')} onPage={window.setPage} compact />
  </div>;
}
export function HyperDatabaseFilterEditor({ field, value, disabled, creating, onSave, onCancel }: { field: FieldPB; value: HyperDatabaseFilterValue; disabled: boolean; creating: boolean; onSave(value: HyperDatabaseFilterValue): Promise<boolean>; onCancel(): void }) {
  const text = useHyperDatabaseFilterText(), [form, setForm] = useState(value), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const kind = hyperDatabaseFilterKind(field.fieldType), supported = kind && (kind === 'select' ? value.condition >= 0 && value.condition <= 5 : hyperDatabaseFilterConditions(field.fieldType).includes(value.condition)), locked = disabled || saving || !supported;
  if (kind === 'timestamp' && value.date) return <HyperDatabaseDateFilterEditor value={value.date} timezoneId="" legacyOnly disabled={disabled} creating={creating} onCancel={onCancel} onSave={async date => onSave({ ...value, condition: date.condition, date })} />;
  if (!kind || kind === 'timestamp') return <Alert variant="info"><AlertDescription>{text('unsupported')}</AlertDescription></Alert>;
  const changed = !hyperDatabaseFilterSame(value, form);
  let validation = ''; try { if (creating || changed) hyperDatabaseFilterValidate(field.fieldType, form); } catch (error) { validation = text((error as Error).message as 'invalidNumber' | 'invalidTime' | 'selectValue' | 'unsupported'); }
  const labels = hyperDatabaseFilterLabels[kind];
  return <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); if (locked || validation || !creating && !changed) return; setSaving(true); setError(''); void onSave(form).catch(error => setError((error as { msg?: string }).msg ?? (error as Error).message)).finally(() => setSaving(false)); }}>
    {!supported && <Alert variant="info"><AlertDescription>{text('unsupported')}</AlertDescription></Alert>}
    <label className="flex flex-col gap-1 text-xs">{text('operator')}<Select value={String(form.condition)} disabled={locked} onValueChange={condition => { if (condition !== null) setForm(previous => ({ ...previous, condition: Number(condition) })); }}><SelectTrigger aria-label={text('operator')} className="w-full"><SelectValue>{labels[form.condition] ? text(labels[form.condition]) : text('unsupported')}</SelectValue></SelectTrigger><SelectContent>{hyperDatabaseFilterConditions(field.fieldType).map(condition => <SelectItem key={condition} value={String(condition)}>{text(labels[condition])}</SelectItem>)}</SelectContent></Select></label>
    {kind === 'text' && <p className="text-xs text-muted-foreground">{text('textHelp')}</p>}
    {kind === 'time' && <p className="text-xs text-muted-foreground">{text('timeHelp')}</p>}
    {kind === 'checklist' && <p className="text-xs text-muted-foreground">{text('checklistHelp')}</p>}
    {hyperDatabaseFilterNeedsValue(field.fieldType, form.condition) && (kind === 'select' ? <><p className="text-xs text-muted-foreground">{text('selectHelp')}</p><HyperDatabaseFilterOptions field={field} ids={form.optionIds} disabled={locked} onChange={optionIds => setForm(previous => ({ ...previous, optionIds }))} /></> : <label className="flex flex-col gap-1 text-xs">{text('value')}<Input aria-label={text('value')} value={form.content} inputMode={kind === 'number' ? 'decimal' : kind === 'time' ? 'numeric' : undefined} disabled={locked} onChange={event => setForm(previous => ({ ...previous, content: event.target.value }))} /></label>)}
    {(validation || error) && <Alert variant="destructive"><AlertDescription>{error || validation}</AlertDescription></Alert>}
    <div className="flex gap-2"><Button type="submit" size="sm" disabled={locked || !!validation || !creating && !changed}>{text(creating ? 'add' : 'save')}</Button><Button type="button" size="sm" variant="outline" disabled={saving} onClick={onCancel}>{text('cancel')}</Button></div>
  </form>;
}
