import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import type { FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import type { RelatedRowDataPB } from '@shared/protobuf/flowy-database2/relation_entities_pb';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/reui/badge';
import { hyperRelationDatabase, type HyperCellValue } from './HyperDatabaseCells';
import type { HyperDatabaseRepository } from './HyperDatabaseRepository';
import { useHyperDatabaseText } from './HyperDatabaseI18n';
import { hyperDatabaseError } from './HyperDatabaseStore';

import type { HyperDatabaseDraftInputs } from './HyperDatabaseDraftCell';

interface HyperComplexCellProps {
  drafts?: HyperDatabaseDraftInputs;
  repository: HyperDatabaseRepository;
  viewId: string;
  rowId: string;
  field: FieldPB;
  value: HyperCellValue;
  editable: boolean;
  saving: boolean;
  save(operation: () => Promise<void>): Promise<boolean>;
}

export function HyperChecklistCell({ repository, viewId, rowId, field, value, editable, saving, save, drafts }: HyperComplexCellProps) {
  const text = useHyperDatabaseText();
  const [localName, setLocalName] = useState('');
  const name = drafts?.value('newTask') ?? localName;
  const setName = (value: string) => drafts ? drafts.change('newTask', value) : setLocalName(value);
  const checklist = value.checklist!;
  const write = (changes: Parameters<HyperDatabaseRepository['checklist']>[3]) => save(() => repository.checklist(viewId, rowId, field.id, changes));
  return <Popover><PopoverTrigger render={<Button variant="ghost" className="min-h-8 w-full justify-start px-2 font-normal" aria-label={field.name} />}>
    <Badge variant="secondary" size="sm">{checklist.completed.length}/{checklist.options.length}</Badge>
    <span className="max-w-60 truncate">{checklist.options.map(option => option.name).join(', ') || text('noValue')}</span>
  </PopoverTrigger><PopoverContent className="max-h-96 w-96 overflow-y-auto" aria-label={field.name}>
    {checklist.options.map((option, index) => <div key={`${option.id}:${option.name}`} className="flex items-center gap-1">
      <Checkbox aria-label={`${text('completeTask')}: ${option.name}`} disabled={!editable || saving} checked={checklist.completed.includes(option.id)} onCheckedChange={() => { void write({ completedTasks: [option.id] }); }} />
      <Input aria-label={text('taskName')} defaultValue={drafts ? undefined : option.name} value={drafts?.value('task:' + option.id, option.name)} onChange={drafts ? event => drafts.change('task:' + option.id, event.target.value, option.name) : undefined} disabled={!editable || saving} className="min-w-0 flex-1" onBlur={event => {
        const name = event.currentTarget.value.trim();
        if (name && name !== option.name) void write({ updateTasks: [{ ...option, name }] });
        else { event.currentTarget.value = option.name; drafts?.change('task:' + option.id, option.name, option.name); }
      }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = option.name; drafts?.change('task:' + option.id, option.name, option.name); event.currentTarget.blur(); } }} />
      {editable && <>
        <Button variant="ghost" size="icon-sm" aria-label={text('moveTaskUp')} disabled={saving || !index} onClick={() => { void write({ reorder: `${option.id} ${checklist.options[index - 1].id}` }); }}><ArrowUp /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={text('moveTaskDown')} disabled={saving || index === checklist.options.length - 1} onClick={() => { void write({ reorder: `${option.id} ${checklist.options[index + 1].id}` }); }}><ArrowDown /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={`${text('deleteTask')}: ${option.name}`} disabled={saving} onClick={() => { void write({ deleteTasks: [option.id] }); }}><Trash2 /></Button>
      </>}
    </div>)}
    {!checklist.options.length && <p className="p-2 text-xs text-muted-foreground">{text('noTasks')}</p>}
    {editable && <form className="flex gap-2 border-t pt-2" onSubmit={event => {
      event.preventDefault(); if (!name.trim() || saving) return;
      void write({ insertTask: [{ name: name.trim() }] }).then(saved => { if (saved) setName(''); });
    }}><Input aria-label={text('newTask')} placeholder={text('newTask')} value={name} disabled={saving} onChange={event => setName(event.target.value)} /><Button type="submit" size="sm" disabled={saving || !name.trim()}>{text('save')}</Button></form>}
  </PopoverContent></Popover>;
}

export function HyperRelationCell({ repository, viewId, rowId, field, value, editable, saving, save }: HyperComplexCellProps) {
  const text = useHyperDatabaseText();
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<RelatedRowDataPB[]>([]), [rows, setRows] = useState<RelatedRowDataPB[] | null>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  let databaseId = '';
  try { databaseId = hyperRelationDatabase(field); } catch { /* Invalid type options stay preserved. */ }
  const rowIds = value.rowIds ?? [];
  useEffect(() => {
    let active = true;
    setSelected([]); setError('');
    if (databaseId && rowIds.length) void repository.relatedRows(databaseId, rowIds).then(rows => { if (active) setSelected(rows); }).catch(error => { if (active) setError(hyperDatabaseError(error)); });
    return () => { active = false; };
  }, [repository, databaseId, value, attempt]);
  useEffect(() => {
    let active = true;
    setRows(null); setError('');
    if (open && databaseId && editable) void repository.relatedRows(databaseId).then(rows => { if (active) setRows(rows); }).catch(error => { if (active) setError(hyperDatabaseError(error)); });
    return () => { active = false; };
  }, [repository, databaseId, open, editable, attempt]);
  const available = editable ? rows ?? selected : selected;
  // Keep missing selected rows removable even after the related row was deleted.
  const choices = [...available, ...rowIds.filter(id => !available.some(row => row.rowId === id)).map(id => ({ rowId: id, name: id }))].filter(row => row.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || row.rowId.includes(query));
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger render={<Button variant="ghost" className="min-h-8 w-full justify-start overflow-hidden px-2 font-normal" aria-label={field.name} />}>
    {rowIds.length ? <span className="max-w-80 truncate">{rowIds.map(id => selected.find(row => row.rowId === id)?.name || id).join(', ')}</span> : <span className="text-muted-foreground">{text('noValue')}</span>}
  </PopoverTrigger><PopoverContent className="max-h-96 overflow-y-auto" aria-label={field.name}>
    {!databaseId ? <p className="text-xs text-muted-foreground">{text('configureRelation')}</p> : <>
      <Input aria-label={text('searchRows')} placeholder={text('searchRows')} value={query} onChange={event => { setQuery(event.target.value); setLimit(50); }} />
      {error && <div role="alert" className="text-xs text-destructive">{error}<Button size="xs" variant="ghost" onClick={() => setAttempt(attempt + 1)}>{text('retry')}</Button></div>}
      {editable && !rows && !error ? <Spinner className="size-4" /> : <>
        {choices.slice(0, limit).map(row => <label key={row.rowId} className="flex items-center gap-2 rounded-md p-2 hover:bg-accent"><Checkbox aria-label={row.name || row.rowId} disabled={!editable || saving} checked={rowIds.includes(row.rowId)} onCheckedChange={selected => { void save(() => repository.relation(viewId, rowId, field.id, row.rowId, selected)); }} /><span className="truncate">{row.name || text('untitledRow')}</span></label>)}
        {!choices.length && <p className="p-2 text-xs text-muted-foreground">{text('noRelatedRows')}</p>}
        {choices.length > limit && <Button variant="outline" size="sm" onClick={() => setLimit(limit + 50)}>{text('next')}</Button>}
      </>}
    </>}
  </PopoverContent></Popover>;
}
