import { clone, equals } from '@bufbuild/protobuf';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { FieldPBSchema, FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { HyperDatabaseStore } from './HyperDatabaseStore';
import { hyperDatabaseError } from './HyperDatabaseStore';
import { hyperRelationDatabase } from './HyperDatabaseCells';
import type { HyperDatabaseRepository } from './HyperDatabaseRepository';
import { DateTypeOptionPBSchema, type DateTypeOptionPB } from '@shared/protobuf/flowy-database2/date_entities_pb';
import { hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { HyperDatabaseDraftBlocked, hyperDatabaseDrafts } from './HyperDatabaseDraft';
import { HyperDatabaseDateOptions } from './HyperDatabaseDateOptions';
import { HyperDatabaseDateError, hyperDatabaseDateOptions, hyperDatabaseDateOptionsEditable, hyperDatabaseDateZone } from './HyperDatabaseDate';
import { hyperUpdateDatabaseDateSettings } from './HyperDatabaseDateSettings';
import { useHyperDatabaseDateText } from './HyperDatabaseDateStrings';
import { useHyperDatabaseText } from './HyperDatabaseI18n';

export function HyperRelationTarget({ repository, value, disabled, onChange }: { repository: HyperDatabaseRepository; value: string; disabled: boolean; onChange(value: string): void }) {
  const text = useHyperDatabaseText();
  const [databases, setDatabases] = useState<Awaited<ReturnType<HyperDatabaseRepository['databases']>> | null>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void repository.databases().then(databases => { if (active) setDatabases(databases); }).catch(error => { if (active) setError(hyperDatabaseError(error)); });
    return () => { active = false; };
  }, [repository, attempt]);
  return <div className="flex flex-col gap-2"><span className="text-sm">{text('relatedDatabase')}</span>
    {error ? <div role="alert" className="text-xs text-destructive">{error}<Button variant="ghost" size="xs" onClick={() => setAttempt(attempt + 1)}>{text('retry')}</Button></div> : !databases ? <Spinner className="size-4" /> : <>
      <Select value={value} disabled={disabled} onValueChange={value => { if (value) onChange(value); }}><SelectTrigger className="w-full" aria-label={text('relatedDatabase')}><SelectValue placeholder={text('chooseDatabase')} /></SelectTrigger><SelectContent>{databases.map(database => <SelectItem key={database.databaseId} value={database.databaseId}>{database.name}</SelectItem>)}</SelectContent></Select>
      {!databases.length && <p className="text-xs text-muted-foreground">{text('noDatabases')}</p>}
    </>}
  </div>;
}

export function HyperDatabaseFieldSettings({ store, field, editable }: { store: HyperDatabaseStore; field: FieldPB; editable: boolean }) {
  const text = useHyperDatabaseText(), [open, setOpen] = useState(false), [name, setName] = useState(field.name), [databaseId, setDatabaseId] = useState('');
  const writing = useStore(store, state => state.writing), dateText = useHyperDatabaseDateText();
  const [dateSettings, setDateSettings] = useState<{ source: FieldPB; original: DateTypeOptionPB; value: DateTypeOptionPB; owner: HyperDocumentOwner | null } | null>(null);
  const live = useRef({ mounted: true, editable, viewId: store.viewId, fieldId: field.id });
  live.current = { ...live.current, editable, viewId: store.viewId, fieldId: field.id };
  useEffect(() => { live.current.mounted = true; return () => { live.current.mounted = false; }; }, []);
  useEffect(() => {
    if (!open || field.fieldType !== FieldType.DateTime) { setDateSettings(null); return; }
    try { const original = hyperDatabaseDateOptions(field.typeOptionData); setDateSettings({ source: clone(FieldPBSchema, field), original, value: clone(DateTypeOptionPBSchema, original), owner: hyperGetDocumentOwner() }); }
    catch { setDateSettings(null); }
  }, [open]);
  const dateChanged = !!dateSettings && !equals(DateTypeOptionPBSchema, dateSettings.original, dateSettings.value);
  const pendingDate = !!dateSettings?.owner && hyperDatabaseDrafts.pending(dateSettings.owner, store.getState().snapshot?.database.id ?? '').some(record => record.target.fieldId === field.id);
  let dateValid = true; try { if (dateSettings) hyperDatabaseDateZone(dateSettings.value.timezoneId); } catch { dateValid = false; }
  const saveDisabled = writing || !name.trim() || dateChanged && (!dateValid || pendingDate || !dateSettings?.owner);
  let configured = '';
  try { if (field.fieldType === FieldType.Relation) configured = hyperRelationDatabase(field); } catch { /* Preserve unrecognized options. */ }
  useEffect(() => { setName(field.name); setDatabaseId(configured); }, [field.name, configured, open]);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger render={<Button variant="ghost" size="sm" className="w-full justify-start px-0 text-xs font-medium" aria-label={`${text('propertySettings')}: ${field.name}`} />}>{field.name}</PopoverTrigger><PopoverContent>
    <form className="flex flex-col gap-3" onSubmit={event => {
      event.preventDefault(); if (!editable || saveDisabled) return;
      void store.write(async () => {
        if (name.trim() !== field.name) await store.repository.renameField(store.viewId, field.id, name.trim());
        if (dateChanged && dateSettings?.owner) {
          const target = dateSettings;
          try { await hyperUpdateDatabaseDateSettings(store.viewId, store.getState().snapshot?.database.id ?? '', target.source, target.value, target.owner!, () => live.current.mounted && live.current.editable && live.current.viewId === store.viewId && live.current.fieldId === target.source.id); }
          catch (error) { throw new Error(error instanceof HyperDatabaseDateError ? dateText(error.reason) : error instanceof HyperDatabaseDraftBlocked ? dateText('readOnly') : hyperDatabaseError(error)); }
        }
        if (!configured && field.fieldType === FieldType.Relation && databaseId) await store.repository.relationDatabase(store.viewId, field.id, databaseId);
        return true;
      }).then(saved => { if (saved) setOpen(false); });
    }}>
      <label className="flex flex-col gap-2 text-sm">{text('fieldName')}<Input required value={name} disabled={!editable || writing} onChange={event => setName(event.target.value)} /></label>
      <p className="text-xs text-muted-foreground">{FieldType[field.fieldType]}</p>
      {field.fieldType === FieldType.Relation && <><HyperRelationTarget repository={store.repository} value={databaseId} disabled={!editable || writing || !!configured} onChange={setDatabaseId} />{!!configured && <p className="text-xs text-muted-foreground">{text('relationTargetFixed')}</p>}</>}
      {field.fieldType === FieldType.DateTime && (dateSettings ? <><HyperDatabaseDateOptions value={dateSettings.value} disabled={!editable || writing || pendingDate || !hyperDatabaseDateOptionsEditable(dateSettings.value)} onChange={value => setDateSettings(previous => previous ? { ...previous, value } : previous)} />{pendingDate && <p className="text-xs text-muted-foreground">{dateText('pending')}</p>}</> : <p className="text-xs text-muted-foreground">{dateText('unsupported')}</p>)}
      {editable && <Button type="submit" size="sm" disabled={saveDisabled}>{text('save')}</Button>}
    </form>
  </PopoverContent></Popover>;
}
