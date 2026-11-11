import { HyperDatabaseDraftCell, type HyperDatabaseDraftScope } from './HyperDatabaseDraftCell';
import { useEffect, useId, useRef, useState } from 'react';
import { FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/reui/badge';
import { Spinner } from '@/components/ui/spinner';
import { hyperDecodeCell, hyperSelectOptions, type HyperCellValue } from './HyperDatabaseCells';
import type { HyperDatabaseRepository } from './HyperDatabaseRepository';
import { useHyperDatabaseText } from './HyperDatabaseI18n';
import { hyperDatabaseError } from './HyperDatabaseStore';
import { HyperChecklistCell, HyperRelationCell } from './HyperDatabaseComplexCells';
import { HyperMediaCell } from './HyperDatabaseMediaCell';
import { HyperDatabaseDateCell } from './HyperDatabaseDateCell';
import { HyperDatabaseAICell } from './HyperDatabaseAICell';

export interface HyperDatabaseCellProps {
  draftScope?: HyperDatabaseDraftScope;
  repository: HyperDatabaseRepository;
  viewId: string;
  rowId: string;
  field: FieldPB;
  revision: number;
  editable: boolean;
  onSaved(): void;
  onPendingChange?(id: string, pending: boolean): void;
}
export function HyperDatabaseCell(props: HyperDatabaseCellProps) {
  return props.draftScope ? <HyperDatabaseDraftCell {...props} draftScope={props.draftScope} /> : <HyperDatabaseUnscopedCell {...props} />;
}
function HyperDatabaseUnscopedCell({ repository, viewId, rowId, field, revision, editable, onSaved, onPendingChange }: HyperDatabaseCellProps) {
  const text = useHyperDatabaseText();
  const [value, setValue] = useState<HyperCellValue | null>(null);
  const [loadedIdentity, setLoadedIdentity] = useState('');
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [optionName, setOptionName] = useState('');
  const failedOperation = useRef<(() => Promise<void>) | null>(null);
  const savingNow = useRef(false), cancelBlur = useRef(false);
  const pendingId = useId(), draftPending = useRef(false), draftValue = useRef(''), draftVersion = useRef(0), pendingListener = useRef(onPendingChange);
  pendingListener.current = onPendingChange;
  const reportPending = (pending: boolean) => pendingListener.current?.(pendingId, pending);
  const identity = JSON.stringify([viewId, rowId, field.id, field.fieldType]);
  const scope = useRef({ repository, identity, editable, mounted: true });
  scope.current = { ...scope.current, repository, identity, editable };
  useEffect(() => { scope.current.mounted = true; return () => { scope.current.mounted = false; reportPending(false); }; }, []);
  useEffect(() => {
    setValue(null); setLoadedIdentity(''); setDraft(''); setDirty(false); setError(null);
    failedOperation.current = null; cancelBlur.current = false;
    draftPending.current = false; draftValue.current = ''; draftVersion.current++; reportPending(false);
  }, [repository, identity]);
  useEffect(() => {
    let active = true;
    if (dirty || saving) return;
    void repository.cell(viewId, rowId, field.id).then(cell => {
      if (!active || draftPending.current || savingNow.current) return;
      const next = hyperDecodeCell(field, cell);
      draftValue.current = next.date ?? next.text;
      setValue(next); setLoadedIdentity(identity); setDraft(draftValue.current); setError(null);
    }).catch(error => { if (active) setError(hyperDatabaseError(error)); });
    return () => { active = false; };
  }, [repository, viewId, rowId, field, revision, dirty, saving, attempt, identity]);

  const save = async (operation: () => Promise<void>) => {
    const current = () => scope.current.mounted && scope.current.repository === repository && scope.current.identity === identity && scope.current.editable;
    if (!current() || savingNow.current) return false;
    const version = draftVersion.current;
    savingNow.current = true; reportPending(true); setSaving(true);
    try { await operation(); if (!current()) return false; draftPending.current = draftVersion.current !== version; setDirty(draftPending.current); setError(null); failedOperation.current = null; onSaved(); return true; }
    catch (error) { if (current()) { failedOperation.current = operation; setError(`${text('cellSaveError')} ${hyperDatabaseError(error)}`); } return false; }
    finally { savingNow.current = false; if (scope.current.mounted) { setSaving(false); reportPending(draftPending.current || !!failedOperation.current); } }
  };
  const saveDraft = () => {
    if (cancelBlur.current) { cancelBlur.current = false; return; }
    if (!draftPending.current) return;
    const draft = draftValue.current;
    void save(() => field.fieldType === FieldType.DateTime ? repository.updateDate(viewId, rowId, field.id, draft) : repository.updateText(viewId, rowId, field.id, draft));
  };
  if (!value || loadedIdentity !== identity) return <span className="flex min-h-8 items-center gap-2 px-2 text-xs text-muted-foreground">{error ? <><span title={error}>{text('cellError')}</span><Button variant="ghost" size="xs" onClick={() => setAttempt(attempt + 1)}>{text('retry')}</Button></> : <Spinner className="size-3" />}</span>;
  const enabled = editable && value.editable && !saving;
  const inputLabel = `${field.name} · ${rowId}`;
  let control: React.ReactNode;
  const complexProps = { repository, viewId, rowId, field, value, editable, saving, save };
  if (field.fieldType === FieldType.Summary || field.fieldType === FieldType.Translate) control = <HyperDatabaseAICell {...complexProps} value={value.text} />;
  else if (field.fieldType === FieldType.DateTime && value.dateData) control = <HyperDatabaseDateCell {...complexProps} data={value.dateData} />;
  else if (field.fieldType === FieldType.Checklist) control = <HyperChecklistCell {...complexProps} />;
  else if (field.fieldType === FieldType.Relation) control = <HyperRelationCell {...complexProps} />;
  else if (field.fieldType === FieldType.Media) control = <HyperMediaCell {...complexProps} files={value.files ?? []} />;
  else if (field.fieldType === FieldType.Checkbox) control = <div className="px-2 py-2"><Checkbox aria-label={inputLabel} checked={value.checked} disabled={!enabled} onCheckedChange={checked => { void save(() => repository.updateText(viewId, rowId, field.id, checked ? 'Yes' : 'No')); }} /></div>;
  else if ((field.fieldType === FieldType.SingleSelect || field.fieldType === FieldType.MultiSelect) && enabled) {
    let options: ReturnType<typeof hyperSelectOptions>;
    try { options = hyperSelectOptions(field); } catch { options = []; }
    control = <Popover><PopoverTrigger render={<Button variant="ghost" className="min-h-8 w-full justify-start overflow-hidden px-2 font-normal" aria-label={inputLabel} />}>
      {value.selected?.length ? value.selected.map(option => <Badge key={option.id} variant="secondary" size="sm">{option.name}</Badge>) : <span className="text-muted-foreground">{text('noValue')}</span>}
    </PopoverTrigger><PopoverContent className="max-h-72 overflow-auto">{options.map(option => <label key={option.id} className="flex items-center gap-2 rounded-md p-2 hover:bg-accent"><Checkbox checked={value.selected?.some(selected => selected.id === option.id)} aria-label={option.name} onCheckedChange={checked => {
      const previous = value.selected?.map(selected => selected.id) ?? [];
      const next = checked ? field.fieldType === FieldType.SingleSelect ? [option.id] : [...previous, option.id] : previous.filter(id => id !== option.id);
      void save(() => repository.updateSelect(viewId, rowId, field.id, previous, next));
    }} />{option.name}</label>)}<form className="flex gap-2 border-t pt-2" onSubmit={event => {
      event.preventDefault(); if (!optionName.trim()) return;
      void save(() => repository.createSelectOption(viewId, rowId, field.id, optionName.trim())).then(saved => { if (saved) setOptionName(''); });
    }}><Input aria-label={text('newOption')} value={optionName} onChange={event => setOptionName(event.target.value)} /><Button size="sm" type="submit" disabled={saving || !optionName.trim()}>{text('save')}</Button></form></PopoverContent></Popover>;
  } else if (enabled) control = <Input aria-label={inputLabel} type={field.fieldType === FieldType.DateTime ? 'date' : 'text'} value={draft} disabled={saving} aria-invalid={!!error} className="min-w-32 rounded-none border-0 bg-transparent font-normal shadow-none focus-visible:ring-inset dark:bg-transparent" onChange={event => { draftValue.current = event.target.value; draftVersion.current++; draftPending.current = true; reportPending(true); setDraft(draftValue.current); setDirty(true); }} onBlur={saveDraft} onKeyDown={event => {
    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
    if (event.key === 'Escape') { cancelBlur.current = true; draftPending.current = false; draftValue.current = value.date ?? value.text; failedOperation.current = null; reportPending(false); setDraft(draftValue.current); setDirty(false); setError(null); event.currentTarget.blur(); }
  }} />;
  else control = <span title={value.editable ? value.text : `${value.text} · ${text('fieldReadOnly')}`} className="block min-h-8 max-w-80 truncate px-2 py-1.5 text-sm">{value.text || <span className="text-muted-foreground">{text('noValue')}</span>}</span>;
  const readOnlyDraft = !editable && dirty;
  return <div className="min-w-0" aria-busy={saving}>{control}{readOnlyDraft && <p className="whitespace-pre-wrap break-words px-2 text-xs">{draft}</p>}{(error || readOnlyDraft) && <div className="flex items-center gap-1 px-2 pb-1 text-xs text-destructive"><span role="alert" title={error || text('readOnly')}>{text('cellSaveError')}</span><Button size="xs" variant="ghost" disabled={saving || !editable} onClick={() => { if (draftPending.current) saveDraft(); else if (failedOperation.current) void save(failedOperation.current); }}>{text('retry')}</Button><Button size="xs" variant="ghost" disabled={saving} onMouseDown={event => event.preventDefault()} onClick={() => {
    failedOperation.current = null; draftPending.current = false; draftValue.current = value.date ?? value.text; cancelBlur.current = false; reportPending(false); setDraft(draftValue.current); setDirty(false); setError(null); setAttempt(attempt => attempt + 1);
  }}>{text('cancel')}</Button></div>}</div>;
}
