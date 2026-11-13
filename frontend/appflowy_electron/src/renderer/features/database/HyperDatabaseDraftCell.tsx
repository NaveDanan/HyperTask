import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/reui/badge';
import { Spinner } from '@/components/ui/spinner';
import { hyperSelectOptions } from './HyperDatabaseCells';
import type { HyperDatabaseCellProps } from './HyperDatabaseCell';
import { useHyperDatabaseText } from './HyperDatabaseI18n';
import { HyperChecklistCell, HyperRelationCell } from './HyperDatabaseComplexCells';
import { HyperMediaCell } from './HyperDatabaseMediaCell';
import { HyperDatabaseDateCell } from './HyperDatabaseDateCell';
import { HyperDatabaseAICell } from './HyperDatabaseAICell';
import { hyperDatabaseDraftFieldKey, hyperDatabaseDraftOwnerKey, hyperDatabaseDrafts, type HyperDatabaseDraftLease, type HyperDatabaseDraftMethod, type HyperDatabaseDraftOwner } from './HyperDatabaseDraft';
import { hyperExecuteDatabaseDraft, hyperReadDatabaseDraft } from './HyperDatabaseDraftBackend';

export interface HyperDatabaseDraftScope { owner: HyperDatabaseDraftOwner; databaseId: string }
export interface HyperDatabaseDraftInputs {
  value(key: string, fallback?: string): string;
  change(key: string, value: string, fallback?: string): void;
  discard(): void;
  upload(paths: string[], workspaceId: string, workspaceType: number): Promise<boolean>;
}
const methods = new Set<HyperDatabaseDraftMethod>(['updateText', 'updateDate', 'updateDateDetails', 'updateSelect', 'createSelectOption', 'checklist', 'relation', 'attachMediaFiles', 'attachMediaLink', 'removeMedia', 'renameMedia']);
export function HyperDatabaseDraftCell({ repository, viewId, rowId, field, revision, editable, onSaved, onPendingChange, draftScope }: HyperDatabaseCellProps & { draftScope: HyperDatabaseDraftScope }) {
  const text = useHyperDatabaseText(), [attempt, setAttempt] = useState(0);
  const ownerKey = hyperDatabaseDraftOwnerKey(draftScope.owner), fieldKey = hyperDatabaseDraftFieldKey(field);
  const controller = useMemo(() => hyperDatabaseDrafts.get(draftScope.owner, draftScope.databaseId, rowId, field), [ownerKey, draftScope.databaseId, rowId, field.id, fieldKey]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const current = useRef({ mounted: true, editable, onSaved, onPendingChange });
  current.current = { ...current.current, editable, onSaved, onPendingChange };
  const lease = useMemo<HyperDatabaseDraftLease>(() => ({
    viewId, repository,
    current: () => current.current.mounted && current.current.editable && draftScope.owner.isCurrent(),
    saved: () => current.current.onSaved(),
    read: target => hyperReadDatabaseDraft(repository, viewId, target),
    execute: (mutation, prepared, check, sent) => hyperExecuteDatabaseDraft(repository, mutation, prepared, check, sent),
  }), [repository, viewId, controller]);
  const cancelBlur = useRef(false);
  useEffect(() => {
    current.current.mounted = true;
    const detach = controller.attach(lease);
    const report = () => current.current.onPendingChange?.(controller.key, controller.pending);
    const stop = controller.subscribe(report); report();
    return () => { current.current.mounted = false; stop(); detach(); current.current.onPendingChange?.(controller.key, false); hyperDatabaseDrafts.release(controller); };
  }, [controller, lease]);
  useEffect(() => { void controller.load(repository, viewId, field); }, [controller, repository, viewId, field, revision, attempt, state.dirty, state.saving]);
  const guardedRepository = useMemo(() => new Proxy(repository, {
    get(target, key, receiver) {
      if (methods.has(key as HyperDatabaseDraftMethod)) return (...args: unknown[]) => controller.executePrepared(lease, { method: key as HyperDatabaseDraftMethod, args });
      const value = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }), [controller, repository, lease]);
  const save = (operation: () => Promise<void>) => controller.run(lease, operation);
  const drafts: HyperDatabaseDraftInputs = {
    discard: () => { controller.discard(); },
    value: (key, fallback = '') => controller.form(key, fallback),
    change: (key, value, fallback = '') => controller.editForm(key, value, fallback),
    upload: (paths, workspaceId, workspaceType) => controller.runMutation(lease, { method: 'uploadMedia', args: [viewId, rowId, field.id, paths, workspaceId, workspaceType] }),
  };
  const value = state.value, error = state.error, saving = state.saving;
  const saveDraft = () => {
    if (cancelBlur.current) { cancelBlur.current = false; return; }
    if (controller.pending && !saving) void controller.saveText(lease);
  };
  if (!value) return <span className="flex min-h-8 items-center gap-2 px-2 text-xs text-muted-foreground">{error ? <><span title={error}>{text('cellError')}</span><Button variant="ghost" size="xs" onClick={() => setAttempt(attempt + 1)}>{text('retry')}</Button></> : <Spinner className="size-3" />}</span>;
  const enabled = editable && value.editable && !saving && draftScope.owner.isCurrent();
  const inputLabel = `${field.name} · ${rowId}`;
  const complexProps = { repository: guardedRepository, viewId, rowId, field, value, editable: editable && draftScope.owner.isCurrent(), saving, save, drafts };
  let control: React.ReactNode;
  if (field.fieldType === FieldType.Summary || field.fieldType === FieldType.Translate) control = <HyperDatabaseAICell {...complexProps} value={value.text} />;
  else if (field.fieldType === FieldType.DateTime && value.dateData) control = <HyperDatabaseDateCell {...complexProps} data={value.dateData} />;
  else if (field.fieldType === FieldType.Checklist) control = <HyperChecklistCell {...complexProps} />;
  else if (field.fieldType === FieldType.Relation) control = <HyperRelationCell {...complexProps} />;
  else if (field.fieldType === FieldType.Media) control = <HyperMediaCell {...complexProps} files={value.files ?? []} />;
  else if (field.fieldType === FieldType.Checkbox) control = <div className="px-2 py-2"><Checkbox aria-label={inputLabel} checked={value.checked} disabled={!enabled} onCheckedChange={checked => { void save(() => guardedRepository.updateText(viewId, rowId, field.id, checked ? 'Yes' : 'No')); }} /></div>;
  else if ((field.fieldType === FieldType.SingleSelect || field.fieldType === FieldType.MultiSelect) && enabled) {
    let options: ReturnType<typeof hyperSelectOptions>;
    try { options = hyperSelectOptions(field); } catch { options = []; }
    const optionName = drafts.value('newOption');
    control = <Popover><PopoverTrigger render={<Button variant="ghost" className="min-h-8 w-full justify-start overflow-hidden px-2 font-normal" aria-label={inputLabel} />}>
      {value.selected?.length ? value.selected.map(option => <Badge key={option.id} variant="secondary" size="sm">{option.name}</Badge>) : <span className="text-muted-foreground">{text('noValue')}</span>}
    </PopoverTrigger><PopoverContent className="max-h-72 overflow-auto">{options.map(option => <label key={option.id} className="flex items-center gap-2 rounded-md p-2 hover:bg-accent"><Checkbox checked={value.selected?.some(selected => selected.id === option.id)} aria-label={option.name} onCheckedChange={checked => {
      const previous = value.selected?.map(selected => selected.id) ?? [];
      const next = checked ? field.fieldType === FieldType.SingleSelect ? [option.id] : [...previous, option.id] : previous.filter(id => id !== option.id);
      void save(() => guardedRepository.updateSelect(viewId, rowId, field.id, previous, next));
    }} />{option.name}</label>)}<form className="flex gap-2 border-t pt-2" onSubmit={event => { event.preventDefault(); if (optionName.trim()) void save(() => guardedRepository.createSelectOption(viewId, rowId, field.id, optionName.trim())); }}><Input aria-label={text('newOption')} value={optionName} onChange={event => drafts.change('newOption', event.target.value)} /><Button size="sm" type="submit" disabled={saving || !optionName.trim()}>{text('save')}</Button></form></PopoverContent></Popover>;
  } else if (enabled) control = <Input aria-label={inputLabel} type={field.fieldType === FieldType.DateTime ? 'date' : 'text'} value={state.draft} disabled={saving} aria-invalid={!!error} className="min-w-32 rounded-none border-0 bg-transparent font-normal shadow-none focus-visible:ring-inset dark:bg-transparent" onChange={event => controller.edit(event.target.value)} onBlur={saveDraft} onKeyDown={event => {
    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
    if (event.key === 'Escape') { cancelBlur.current = true; controller.discard(); event.currentTarget.blur(); }
  }} />;
  else control = <span title={value.editable ? value.text : `${value.text} · ${text('fieldReadOnly')}`} className="block min-h-8 max-w-80 truncate px-2 py-1.5 text-sm">{value.text || <span className="text-muted-foreground">{text('noValue')}</span>}</span>;
  const readOnlyDraft = !editable && state.dirty;
  return <div className="min-w-0" aria-busy={saving}>{control}{readOnlyDraft && <p className="whitespace-pre-wrap break-words px-2 text-xs">{state.draft}</p>}{(error || readOnlyDraft) && <div className="flex items-center gap-1 px-2 pb-1 text-xs text-destructive"><span role="alert" title={error || text('readOnly')}>{text('cellSaveError')}</span><Button size="xs" variant="ghost" disabled={saving || !editable || !controller.retryable} onClick={() => void controller.retry(lease, true)}>{text('retry')}</Button><Button size="xs" variant="ghost" disabled={saving} onMouseDown={event => event.preventDefault()} onClick={() => { controller.discard(); setAttempt(value => value + 1); }}>{text('cancel')}</Button></div>}</div>;
}
