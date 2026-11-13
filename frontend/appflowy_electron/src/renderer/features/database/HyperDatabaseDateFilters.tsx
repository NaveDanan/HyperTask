import { clone } from '@bufbuild/protobuf';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { FieldPBSchema, FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FilterPBSchema, FilterType, type FilterPB } from '@shared/protobuf/flowy-database2/util_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { hyperDatabaseDateOptions, hyperDatabaseDateOptionsEditable } from './HyperDatabaseDate';
import { hyperDatabaseDateFilterCriteria, hyperDatabaseDateFilterForm, hyperDatabaseDateFilterNew, type HyperDatabaseDateFilterValue } from './HyperDatabaseDateFilter';
import { hyperDecodeDatabaseDateFilter, hyperEncodeDatabaseDateFilter } from './HyperDatabaseDateFilterBinding';
import { HyperDatabaseDateFilterEditor, hyperDatabaseDateFilterLabels } from './HyperDatabaseDateFilterEditor';
import { useHyperDatabaseDateFilterText } from './HyperDatabaseDateFilterStrings';
import { hyperDatabaseFindDateFilters, hyperWriteDatabaseDateFilter } from './HyperDatabaseDateFilterWrite';
import type { HyperDatabaseDraftOwner } from './HyperDatabaseDraft';
import type { HyperDatabaseStore } from './HyperDatabaseStore';
import { HyperDatabaseWindowNavigation, useHyperDatabaseWindow } from './HyperDatabaseWindow';

interface HyperDatabaseDateFilterEditing { field: FieldPB; source: FilterPB | null; value: HyperDatabaseDateFilterValue; zone: string; supported: boolean }
export function HyperDatabaseDateFilters({ store, owner, editable, canWrite }: { store: HyperDatabaseStore; owner: HyperDatabaseDraftOwner; editable: boolean; canWrite: boolean }) {
  const snapshot = useStore(store).snapshot!, text = useHyperDatabaseDateFilterText();
  const [fieldId, setFieldId] = useState(''), [editing, setEditing] = useState<HyperDatabaseDateFilterEditing | null>(null), [error, setError] = useState('');
  const mounted = useRef(true), current = useRef({ editing, canWrite }); current.current = { editing, canWrite };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const filters = hyperDatabaseFindDateFilters(snapshot.settings.filters?.items ?? []).filter(filter => filter.filterType === FilterType.Data && !filter.children.length);
  const window = useHyperDatabaseWindow(filters, JSON.stringify(filters.map(filter => filter.id)), 10);
  const fields = snapshot.fields.filter(field => field.fieldType === FieldType.DateTime);
  const explain = (error: unknown) => ['changed', 'unsupported', 'unavailable'].includes((error as Error).message) ? text((error as Error).message as 'changed' | 'unsupported' | 'unavailable') : (error as { msg?: string }).msg ?? (error as Error).message;
  const open = (field: FieldPB, source: FilterPB | null) => {
    try {
      const options = hyperDatabaseDateOptions(field.typeOptionData), decoded = source?.oneOfData.case === 'data' ? hyperDecodeDatabaseDateFilter(source.oneOfData.value.data) : null;
      setEditing({ field: clone(FieldPBSchema, field), source: source && clone(FilterPBSchema, source), value: decoded?.value ?? hyperDatabaseDateFilterNew(options.timezoneId), zone: options.timezoneId, supported: (!source?.$unknown?.length && !source?.oneOfData.value?.$unknown?.length && decoded?.editable !== false && hyperDatabaseDateOptionsEditable(options)) });
      setError('');
    } catch { setError(text('unsupported')); }
  };
  const write = async (target: HyperDatabaseDateFilterEditing, bytes: Uint8Array | null) => {
    const result = await store.write(async () => {
      try { return await hyperWriteDatabaseDateFilter(store.viewId, snapshot.database.id, target.field, target.source, bytes, owner, () => mounted.current && current.current.canWrite && current.current.editing === target); }
      catch (error) { throw Error(explain(error)); }
    });
    if (result === null) throw Error(explain(Error(store.getState().error ?? 'changed')));
    if (mounted.current && current.current.editing === target) setEditing(null);
    return result;
  };
  return <section className="flex flex-col gap-3 border-t pt-3" aria-label={text('title')}>
    <h3 className="text-sm font-medium">{text('title')}</h3>
    {!editing && <>
      {window.items.map(source => {
        const data = source.oneOfData.case === 'data' ? source.oneOfData.value : undefined;
        const field = fields.find(field => field.id === data?.fieldId);
        let label = text('unsupported');
        try { const value = hyperDecodeDatabaseDateFilter(source.oneOfData.case === 'data' ? source.oneOfData.value.data : new Uint8Array()).value, form = hyperDatabaseDateFilterForm(value); label = `${hyperDatabaseDateFilterLabels[value.condition] ? text(hyperDatabaseDateFilterLabels[value.condition]) : text('unsupported')} ${hyperDatabaseDateFilterCriteria(form)}`; } catch { /* Leave future bytes intact. */ }
        return <Button key={source.id} type="button" variant="outline" size="sm" className="h-auto min-h-8 justify-start whitespace-normal text-left" disabled={!field} aria-label={`${text('edit')}: ${field?.name ?? source.id}`} onClick={() => { if (field) open(field, source); }}><span className="min-w-0"><span className="block truncate font-medium">{field?.name ?? source.id}</span><span className="block text-xs text-muted-foreground">{label}</span></span></Button>;
      })}
      <HyperDatabaseWindowNavigation window={window} label={text('title')} onPage={window.setPage} compact />
      <Select value={fieldId} disabled={!editable} onValueChange={id => setFieldId(id ?? '')}><SelectTrigger aria-label={text('field')} className="w-full"><SelectValue placeholder={text('noProperty')}>{fields.find(field => field.id === fieldId)?.name}</SelectValue></SelectTrigger><SelectContent>{fields.map(field => <SelectItem key={field.id} value={field.id}>{field.name}</SelectItem>)}</SelectContent></Select>
      <Button type="button" size="sm" disabled={!editable || !fields.some(field => field.id === fieldId)} onClick={() => { const field = fields.find(field => field.id === fieldId); if (field) open(field, null); }}>{text('add')}</Button>
    </>}
    {editing && <>
      <p className="text-sm font-medium">{editing.field.name}</p>
      {!editing.supported && <Alert variant="info"><AlertDescription>{text('unsupported')}</AlertDescription></Alert>}
      <HyperDatabaseDateFilterEditor value={editing.value} timezoneId={editing.zone} creating={!editing.source} disabled={!editable || !editing.supported} onCancel={() => setEditing(null)} onSave={async value => write(editing, hyperEncodeDatabaseDateFilter(value, editing.source?.oneOfData.case === 'data' ? editing.source.oneOfData.value.data : undefined))} />
      {editing.source && <Button type="button" variant="ghost" size="sm" disabled={!editable} onClick={() => { setError(''); void write(editing, null).catch(error => setError(explain(error))); }}>{text('remove')}</Button>}
    </>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </section>;
}
