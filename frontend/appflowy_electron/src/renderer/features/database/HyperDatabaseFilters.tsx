import { clone } from '@bufbuild/protobuf';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { FieldPBSchema, FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FilterPBSchema, type FilterPB } from '@shared/protobuf/flowy-database2/util_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { hyperDatabaseFilterFieldEditable, hyperDatabaseFilterKind, hyperDatabaseFilterNew, hyperDecodeDatabaseFilter, hyperEncodeDatabaseFilter, type HyperDatabaseFilterValue } from './HyperDatabaseFilter';
import { HyperDatabaseFilterEditor, hyperDatabaseFilterLabels } from './HyperDatabaseFilterEditor';
import { useHyperDatabaseFilterText } from './HyperDatabaseFilterStrings';
import { hyperDatabaseFindFilters, hyperWriteDatabaseFilter } from './HyperDatabaseFilterWrite';
import type { HyperDatabaseDraftOwner } from './HyperDatabaseDraft';
import type { HyperDatabaseStore } from './HyperDatabaseStore';
import { HyperDatabaseWindowNavigation, useHyperDatabaseWindow } from './HyperDatabaseWindow';
import { hyperDatabaseDateFilterCriteria } from './HyperDatabaseDateFilter';
import { hyperDatabaseTimestampFilterForm } from './HyperDatabaseTimestampFilter';
import { hyperDatabaseDateFilterLabels } from './HyperDatabaseDateFilterEditor';
import { useHyperDatabaseDateFilterText } from './HyperDatabaseDateFilterStrings';
import { hyperSelectOptions } from './HyperDatabaseCells';
interface HyperDatabaseFilterEditing { field: FieldPB | null; source: FilterPB | null; value: HyperDatabaseFilterValue | null; supported: boolean }
export function HyperDatabaseFilters({ store, owner, editable, canWrite }: { store: HyperDatabaseStore; owner: HyperDatabaseDraftOwner; editable: boolean; canWrite: boolean }) {
  const snapshot = useStore(store).snapshot!, text = useHyperDatabaseFilterText(), dateText = useHyperDatabaseDateFilterText();
  const [fieldId, setFieldId] = useState(''), [query, setQuery] = useState(''), [editing, setEditing] = useState<HyperDatabaseFilterEditing | null>(null), [error, setError] = useState('');
  const mounted = useRef(true), current = useRef({ editing, canWrite }); current.current = { editing, canWrite };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const filters = hyperDatabaseFindFilters(snapshot.settings.filters?.items ?? []).filter(filter => filter.oneOfData.value?.fieldType !== FieldType.DateTime);
  const window = useHyperDatabaseWindow(filters, JSON.stringify(filters.map(filter => filter.id)), 10);
  const fields = snapshot.fields.filter(field => hyperDatabaseFilterKind(field.fieldType));
  const choices = useHyperDatabaseWindow(fields.filter(field => field.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())), `${query}:${fields.map(field => field.id).join(',')}`, 20);
  const explain = (error: unknown) => ['changed', 'unsupported', 'unavailable'].includes((error as Error).message) ? text((error as Error).message as 'changed' | 'unsupported' | 'unavailable') : (error as { msg?: string }).msg ?? (error as Error).message;
  const open = (field: FieldPB | null, source: FilterPB | null) => {
    let value: HyperDatabaseFilterValue | null = null, supported = false;
    try {
      if (field) { const decoded = source?.oneOfData.case === 'data' ? hyperDecodeDatabaseFilter(field.fieldType, source.oneOfData.value.data) : null; value = decoded?.value ?? hyperDatabaseFilterNew(field.fieldType); supported = hyperDatabaseFilterFieldEditable(field) && !source?.$unknown?.length && !source?.oneOfData.value?.$unknown?.length && decoded?.editable !== false && (!source || source.oneOfData.value?.fieldType === field.fieldType); }
    } catch { /* Unknown values can be inspected and intentionally removed without rewriting them. */ }
    setEditing({ field: field && clone(FieldPBSchema, field), source: source && clone(FilterPBSchema, source), value, supported }); setError('');
  };
  const write = async (target: HyperDatabaseFilterEditing, bytes: Uint8Array | null) => {
    if (!target.field) throw Error(text('changed'));
    const result = await store.write(async () => {
      try { return await hyperWriteDatabaseFilter(store.viewId, snapshot.database.id, target.field!, target.source, bytes, owner, () => mounted.current && current.current.canWrite && current.current.editing === target); }
      catch (error) { throw Error(explain(error)); }
    });
    if (result === null) throw Error(store.getState().error ?? text('changed'));
    if (mounted.current && current.current.editing === target) setEditing(null);
    return result;
  };
  return <section className="flex flex-col gap-3" aria-label={text('title')}>
    <h3 className="text-sm font-medium">{text('title')}</h3>
    {!editing && <>
      {!window.total && <p className="text-xs text-muted-foreground">{text('empty')}</p>}
      {window.items.map(source => {
        const field = snapshot.fields.find(field => field.id === source.oneOfData.value?.fieldId);
        let label = text('unsupported');
        try { if (field && source.oneOfData.value?.fieldType === field.fieldType) {
          const decoded = hyperDecodeDatabaseFilter(field.fieldType, source.oneOfData.value.data), value = decoded.value, kind = decoded.editable ? hyperDatabaseFilterKind(field.fieldType) : null;
          if (kind === 'timestamp' && value.date) label = `${hyperDatabaseDateFilterLabels[value.condition] ? dateText(hyperDatabaseDateFilterLabels[value.condition]) : text('unsupported')} ${hyperDatabaseDateFilterCriteria(hyperDatabaseTimestampFilterForm(value.date))}`;
          else if (kind && kind !== 'timestamp') {
            let content = value.content;
            if (kind === 'time' && value.condition < 6 && content) content = text('timeValue', { value: content });
            if (kind === 'select' && value.condition < 4) { const options = hyperSelectOptions(field); content = value.optionIds.slice(0, 3).map(id => options.find(option => option.id === id)?.name ?? text('missingOption', { id })).join(', '); if (value.optionIds.length > 3) content += ` · ${text('selected', { count: value.optionIds.length })}`; }
            label = `${hyperDatabaseFilterLabels[kind][value.condition] ? text(hyperDatabaseFilterLabels[kind][value.condition]) : text('unsupported')} ${content.slice(0, 80)}`;
          }
        } } catch { /* Preserve unknown bytes. */ }
        return <Button type="button" key={source.id} variant="outline" size="sm" className="h-auto min-h-8 justify-start whitespace-normal text-left" aria-label={`${text('edit')}: ${field?.name ?? source.id}`} onClick={() => open(field ?? null, source)}><span className="min-w-0"><span className="block truncate font-medium">{field?.name ?? source.id}</span><span className="block text-xs text-muted-foreground">{label}</span></span></Button>;
      })}
      <HyperDatabaseWindowNavigation window={window} label={text('title')} onPage={window.setPage} compact />
      <Input aria-label={text('searchProperties')} placeholder={text('searchProperties')} value={query} onChange={event => setQuery(event.target.value)} />
      <Select value={fieldId} disabled={!editable} onValueChange={id => setFieldId(id ?? '')}><SelectTrigger aria-label={text('field')} className="w-full"><SelectValue placeholder={text('noProperty')}>{fields.find(field => field.id === fieldId)?.name}</SelectValue></SelectTrigger><SelectContent>{choices.items.map(field => <SelectItem key={field.id} value={field.id}>{field.name}</SelectItem>)}</SelectContent></Select>
      <HyperDatabaseWindowNavigation window={choices} label={text('properties')} onPage={choices.setPage} compact />
      <Button type="button" size="sm" disabled={!editable || !fields.some(field => field.id === fieldId)} onClick={() => { const field = fields.find(field => field.id === fieldId); if (field) open(field, null); }}>{text('add')}</Button>
    </>}
    {editing && <>
      <p className="text-sm font-medium">{editing.field?.name ?? editing.source?.id}</p>
      {!editing.supported && <Alert variant="info"><AlertDescription>{text('unsupported')}</AlertDescription></Alert>}
      {editing.field && editing.value ? <HyperDatabaseFilterEditor field={editing.field} value={editing.value} disabled={!editable || !editing.supported} creating={!editing.source} onCancel={() => setEditing(null)} onSave={async value => write(editing, hyperEncodeDatabaseFilter(editing.field!.fieldType, value, editing.source?.oneOfData.case === 'data' ? editing.source.oneOfData.value.data : undefined))} /> : <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>{text('cancel')}</Button>}
      {editing.source && <Button type="button" size="sm" variant="ghost" disabled={!editable || !editing.field} onClick={() => { setError(''); void write(editing, null).catch(error => setError(explain(error))); }}>{text('remove')}</Button>}
    </>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </section>;
}
export { HyperDatabaseFilterGroups } from './HyperDatabaseFilterGroups';
