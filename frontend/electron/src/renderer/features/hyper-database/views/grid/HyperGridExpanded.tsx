import { HyperMentionTextarea } from '@/features/hyper-people/HyperMentionInput';
import { HyperMentionText } from '@/features/hyper-people/HyperMentionText';
import { hyperIsPeopleField } from '@/features/hyper-people/HyperPeopleProperty';
import { useEffect, useRef, useState } from 'react';
import { ListChecks, Plus, X } from 'lucide-react';
import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { FieldVisibility } from '@shared/protobuf/hyper-database2/field_settings_entities_pb';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Item } from '@/components/ui/item';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import type { HyperCell, HyperField } from '../../HyperDatabaseTypes';
import { HyperGridCell } from './HyperGridCell';
import { useHyperGrid } from './HyperGridContext';
import { HyperGridFieldIcon } from './HyperGridModel';

function HyperGridChecklistName(
  {
    name,
    save,
  }: {
    name: string;
    save: (name: string) => void;
  },
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const done = useRef(false);

  if (!editing) return (
    <button
      type='button'
      onClick={() => {
        setDraft(name);
        done.current = false;
        setEditing(true);
      }}
      className='min-w-0 flex-1 truncate text-left text-sm hover:underline'>{name}</button>
  );

  const commit = () => {
    if (done.current)
      return;

    done.current = true;
    setEditing(false);

    if (draft.trim() && draft.trim() !== name)
      save(draft.trim());
  };

  return (
    <Input
      autoFocus
      aria-label='Item name'
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter')
          commit();

        if (event.key === 'Escape') {
          done.current = true;
          setEditing(false);
        }
      }}
      className='h-7 min-w-0 flex-1 px-1' />
  );
}

function HyperGridChecklist(
  {
    rowId,
    field,
  }: {
    rowId: string;
    field: HyperField;
  },
) {
  const grid = useHyperGrid();
  const cell = grid.cell(rowId, field.id);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (!cell)
    return <Skeleton className='h-16 w-full' />;

  if (cell.kind !== 'checklist' || cell.error)
    return <HyperGridCell rowId={rowId} field={field} property />;

  const completed = cell.items.filter(item => item.completed).length;

  const write = (items: typeof cell.items, mutation: Parameters<typeof grid.write>[2]) => grid.write(rowId, field.id, mutation, {
    ...cell,
    items,
    progress: items.length ? items.filter(item => item.completed).length / items.length : 0,
  });

  return (
    <section className='min-w-0 space-y-2' aria-label={field.name}>
      <div className='flex flex-wrap items-baseline gap-2'>
        <h3 className='text-sm font-medium'>{field.name}</h3>
        <span className='text-xs text-muted-foreground'>{`${completed} of ${cell.items.length} done · ${cell.items.length - completed} open`}</span>
      </div>
      <Progress
        aria-label={`${field.name} completion`}
        value={cell.progress * 100}
        className='[&_[data-slot=progress-track]]:h-1.5' />
      <div
        className='grid grid-cols-1 gap-2 @min-[1100px]/hyper-grid:grid-cols-3 @min-[700px]/hyper-grid:grid-cols-2'>{cell.items.map(item => <Item
          key={item.id}
          variant='outline'
          size='sm'
          className='group/hyper-item flex-nowrap gap-2 rounded-lg bg-background px-2 py-2'>
          <Checkbox
            aria-label={`Complete ${item.name}`}
            checked={item.completed}
            onCheckedChange={checked => void grid.run(() => grid.controller.setChecklistItemCompleted(rowId, field.id, item.id, checked))} />
          <HyperGridChecklistName
            name={item.name}
            save={name => void write(cell.items.map(existing => existing.id === item.id ? {
              ...existing,
              name,
            } : existing), {
              kind: 'checklist',

              update: [{
                ...item,
                name,
              }],
            })} />
          <Button
            aria-label={`Delete ${item.name}`}
            variant='ghost'
            size='icon-xs'
            className='shrink-0 opacity-0 group-hover/hyper-item:opacity-100 focus-visible:opacity-100'
            onClick={() => void write(cell.items.filter(existing => existing.id !== item.id), {
              kind: 'checklist',
              deleteIds: [item.id],
            })}>
            <X className='size-3' />
          </Button>
        </Item>)}<Item variant='outline' size='sm' className='flex-nowrap gap-1 border-dashed px-2 py-2'>
          <Plus className='size-3.5 shrink-0 text-muted-foreground' />
          <Input
            aria-label={`Add item to ${field.name}`}
            placeholder='Add item'
            disabled={busy}
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={async event => {
              if (event.key !== 'Enter' || !name.trim() || busy)
                return;

              setBusy(true);

              if (await grid.run(() => grid.controller.updateCell(rowId, field.id, {
                kind: 'checklist',

                insert: [{
                  name: name.trim(),
                }],
              })))
                setName('');

              setBusy(false);
            }}
            className='h-7 min-w-0 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0' />
        </Item>
      </div>
    </section>
  );
}

function HyperGridNotes(
  {
    rowId,
    field,
    cell,
  }: {
    rowId: string;
    field: HyperField;
    cell: Extract<HyperCell, {
      text: string;
    }>;
  },
) {
  const grid = useHyperGrid();
  const [draft, setDraft] = useState(cell.text);
  const cancelled = useRef(false);

  useEffect(() => {
    setDraft(cell.text);
  }, [cell.text]);

  return (
    <label className='block space-y-2 text-xs text-muted-foreground'>Notes · {field.name}<HyperMentionTextarea
        aria-label={`Notes: ${field.name}`}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => {
          if (cancelled.current) { cancelled.current = false; return; }
          if (draft !== cell.text) void grid.write(rowId, field.id, {
            kind: 'text',
            text: draft,
          }, {
            ...cell,
            text: draft,
            display: draft,
          });
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            cancelled.current = true;
            setDraft(cell.text);
            event.currentTarget.blur();
          }
        }}
        className='mt-2 min-h-20 whitespace-pre-wrap border-0 bg-background px-2 text-sm text-foreground shadow-none' />
    </label>
  );
}

export function HyperGridExpanded(
  {
    rowId,
  }: {
    rowId: string;
  },
) {
  const grid = useHyperGrid();

  const {
    fields,
    rows,
  } = grid.state;

  useEffect(() => {
    void grid.run(() => grid.controller.loadRows([rowId]));
  }, [grid.controller, rowId]);

  const hidden = fields.filter(
    field => !field.isPrimary && field.settings.visibility === FieldVisibility.AlwaysHidden && field.type !== FieldType.Checklist,
  );

  const checklists = fields.filter(field => field.type === FieldType.Checklist);
  const primary = fields.find(field => field.isPrimary);
  const title = primary ? grid.cell(rowId, primary.id)?.display : '';

  return (
    <div
      data-hyper-grid-expanded={rowId}
      className='w-[calc(100cqw-2px)] max-w-full border-b bg-muted/20 py-3 pr-4 pl-18'>
      <div className='mb-3 flex items-center gap-2 text-sm font-medium'>{rows[rowId]?.icon ? <span>{rows[rowId].icon}</span> : null}<span className='truncate'><HyperMentionText value={title || 'Untitled row'} /></span>
      </div>
      <div className='grid grid-cols-1 gap-6 @min-[900px]/hyper-grid:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]'>
        <section className='min-w-0 space-y-3'>
          <h3 className='text-xs font-medium text-muted-foreground'>Properties</h3>{hidden.length ? <div className='space-y-1'>{hidden.map(
              field => <div key={field.id} className='grid min-h-8 grid-cols-[8rem_minmax(0,1fr)] items-center gap-2'>
                <span className='flex items-center gap-2 text-xs text-muted-foreground'>
                  <HyperGridFieldIcon type={field.type} people={hyperIsPeopleField(field.proto)} />
                  <span className='truncate'>{field.name}</span>
                </span>
                <HyperGridCell rowId={rowId} field={field} property />
              </div>,
            )}</div> : <p className='text-sm text-muted-foreground'>All fields are shown in the grid.</p>}{fields.map(field => {
            const cell = grid.cell(rowId, field.id);
            return cell?.kind === 'text' && !hyperIsPeopleField(field.proto) && !field.isPrimary ? <HyperGridNotes key={field.id} rowId={rowId} field={field} cell={cell} /> : null;
          })}</section>
        <div className='min-w-0 space-y-4'>{checklists.length ? checklists.map(field => <HyperGridChecklist key={field.id} rowId={rowId} field={field} />) : <Item variant='outline' size='sm' className='bg-background'>
            <ListChecks className='size-4 text-muted-foreground' />
            <span className='text-sm text-muted-foreground'>No checklist field</span>
            <Button
              variant='ghost'
              onClick={() => void grid.run(() => grid.controller.createField('Checklist', FieldType.Checklist))}>Add checklist field</Button>
          </Item>}</div>
      </div>
    </div>
  );
}
