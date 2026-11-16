import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ExternalLink, Plus } from 'lucide-react';
import { cn } from 'cn';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { HyperCell, HyperField } from '../../HyperDatabaseTypes';
import { useHyperGrid } from './HyperGridContext';
import { HyperGridDateInput, HyperGridDateSeconds, HyperGridFormatDate, HyperGridTextMutation } from './HyperGridModel';
import { HyperGridSelectColor } from './selectColor';

type HyperGridCellProps = {
  rowId: string;
  field: HyperField;
  property?: boolean;
};

export function HyperGridCellDisplay(
  {
    cell,
    wrap = false,
  }: {
    cell: HyperCell;
    wrap?: boolean;
  },
) {
  const textClass = cn('block min-w-0', wrap ? 'whitespace-pre-wrap break-words' : 'truncate');

  switch (cell.kind) {
  case 'singleSelect':
  case 'multiSelect':
    return (
      <span className='flex min-w-0 items-center gap-1 overflow-hidden'>{cell.selected.slice(0, wrap ? cell.selected.length : 2).map(option => <Badge
          key={option.id}
          variant={HyperGridSelectColor(option.color)}
          size='sm'
          className='max-w-32 truncate'>
          <span className='size-1.5 shrink-0 rounded-full bg-current' />{option.name}</Badge>)}{!wrap && cell.selected.length > 2 ? <Badge variant='secondary' size='sm'>+{cell.selected.length - 2}</Badge> : null}</span>
    );
  case 'number':
    return <span className={cn(textClass, 'text-right tabular-nums')}>{cell.display}</span>;
  case 'checkbox':
    return (
      <span className='flex justify-center'>
        <Checkbox checked={cell.checked} aria-label='Checked' tabIndex={-1} />
      </span>
    );
  case 'date':
    return <span className={textClass}>{HyperGridFormatDate(cell.timestamp, cell.includeTime)}{cell.isRange && cell.endTimestamp !== null ? ` → ${HyperGridFormatDate(cell.endTimestamp, cell.includeTime)}` : ''}</span>;
  case 'createdTime':
  case 'lastEditedTime':
    return <span className={cn(textClass, 'text-muted-foreground')}>{HyperGridFormatDate(cell.timestamp)}</span>;
  case 'checklist':
    return (
      <span className='flex items-center gap-2'>
        <Progress
          aria-label='Checklist completion'
          value={cell.progress * 100}
          className='w-16 [&_[data-slot=progress-track]]:h-1.5' />
        <span className='text-xs text-muted-foreground tabular-nums'>{cell.items.filter(item => item.completed).length}/{cell.items.length}</span>
      </span>
    );
  case 'url':
    return <span className={cn(textClass, 'text-info underline-offset-2 hover:underline')}>{cell.url}</span>;
  case 'text':
    return <span className={textClass}>{cell.text}</span>;
  default:
    return <span className={cn(textClass, 'text-muted-foreground')}>{cell.display}</span>;
  }
}

function HyperGridTextEditor(
  {
    rowId,
    field,
    cell,
    property,
  }: HyperGridCellProps & {
    cell: HyperCell;
  },
) {
  const grid = useHyperGrid();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(grid.editing?.initial ?? (cell.kind === 'number' ? cell.value?.toString() ?? '' : cell.display));
  const [invalid, setInvalid] = useState(false);
  const committed = useRef(false);

  useEffect(() => {
    input.current?.focus();

    if (grid.editing?.initial === undefined)
      input.current?.select();
  }, []);

  const commit = (direction = 0) => {
    if (committed.current)
      return;

    const mutation = HyperGridTextMutation(cell, draft);

    if (!mutation) {
      setInvalid(true);
      input.current?.focus();
      return;
    }

    committed.current = true;

    const optimistic: HyperCell = cell.kind === 'text' ? {
      ...cell,
      text: draft,
      display: draft,
    } : cell.kind === 'url' ? {
      ...cell,
      url: draft,
      display: draft,
    } : cell.kind === 'number' && mutation.kind === 'number' ? {
      ...cell,
      value: mutation.value,
      display: draft,
    } : cell;

    void grid.write(rowId, field.id, mutation, optimistic);
    grid.edit(null, direction);
  };

  return (
    <Input
      data-hyper-grid-editor
      ref={input}
      aria-label={`Edit ${field.name}`}
      aria-invalid={invalid}
      inputMode={cell.kind === 'number' ? 'decimal' : undefined}
      value={draft}
      onChange={event => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={() => commit()}
      onKeyDown={event => {
        event.stopPropagation();

        if (event.key === 'Escape') {
          event.preventDefault();
          committed.current = true;
          grid.edit(null);
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          commit(event.key === 'Tab' ? event.shiftKey ? -1 : 1 : 0);
        }
      }}
      className={cn(
        'w-full rounded-none border-0 bg-background px-3 shadow-none ring-2 ring-inset ring-ring focus-visible:ring-2 focus-visible:ring-inset dark:bg-background',
        property ? 'h-8' : 'absolute inset-0 z-10 h-full',
        invalid && 'text-destructive ring-destructive focus-visible:ring-destructive',
      )} />
  );
}

function HyperGridSelectEditor(
  {
    rowId,
    field,
    cell,
  }: HyperGridCellProps & {
    cell: Extract<HyperCell, {
      kind: 'singleSelect' | 'multiSelect';
    }>;
  },
) {
  const grid = useHyperGrid();
  const [query, setQuery] = useState(grid.editing?.initial ?? '');
  const [busy, setBusy] = useState(false);

  const select = async (id: string) => {
    if (busy)
      return;

    setBusy(true);
    const selected = cell.selected.some(option => option.id === id);
    const next = selected ? cell.selected.filter(option => option.id !== id) : cell.kind === 'singleSelect' ? field.options.filter(option => option.id === id) : [...cell.selected, ...field.options.filter(option => option.id === id)];

    if (cell.kind === 'singleSelect') grid.edit(null);
    await grid.write(rowId, field.id, {
      kind: cell.kind,
      insertOptionIds: selected ? [] : [id],
      deleteOptionIds: selected ? [id] : cell.kind === 'singleSelect' ? cell.selected.map(option => option.id) : [],
    }, {
      ...cell,
      selected: next,
      display: next.map(option => option.name).join(', '),
    });

    setBusy(false);

  };

  return (
    <Popover
      open
      onOpenChange={open => {
        if (!open)
          grid.edit(null);
      }}>
      <PopoverTrigger
        render={<Button
          data-hyper-grid-editor
          variant='ghost'
          tabIndex={-1}
          className='h-10 w-full justify-start rounded-none bg-background px-3' />}>
        <HyperGridCellDisplay cell={cell} />
      </PopoverTrigger>
      <PopoverContent className='w-64 p-0' align='start' onKeyDown={event => event.stopPropagation()}>
        <Command>
          <CommandInput
            aria-label={`Search ${field.name} options`}
            placeholder='Search options'
            value={query}
            onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No options found.</CommandEmpty>
            <CommandGroup>{field.options.map(option => <CommandItem
                key={option.id}
                value={option.name}
                disabled={busy}
                data-checked={cell.selected.some(selected => selected.id === option.id)}
                onSelect={() => void select(option.id)}>
                <Badge size='sm' variant={HyperGridSelectColor(option.color)}>{option.name}</Badge>
              </CommandItem>)}{query.trim() && !field.options.some(option => option.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase()) ? <CommandItem
                value={`Create ${query}`}
                disabled={busy}
                onSelect={async () => {
                  setBusy(true);
                  if (cell.kind === 'singleSelect') grid.edit(null);
                  const success = await grid.run(() => grid.controller.createSelectOption(field.id, query.trim(), rowId));
                  setBusy(false);

                  if (success && cell.kind !== 'singleSelect')
                    setQuery('');
                }}>
                <Plus className='size-4' />Create “{query.trim()}”</CommandItem> : null}</CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function HyperGridDateEditor(
  {
    rowId,
    field,
    cell,
  }: HyperGridCellProps & {
    cell: Extract<HyperCell, {
      kind: 'date';
    }>;
  },
) {
  const grid = useHyperGrid();
  const [includeTime, setIncludeTime] = useState(cell.includeTime);
  const [range, setRange] = useState(cell.isRange);
  const [start, setStart] = useState(HyperGridDateInput(cell.timestamp, cell.includeTime));
  const [end, setEnd] = useState(HyperGridDateInput(cell.endTimestamp, cell.includeTime));
  const [invalid, setInvalid] = useState(false);

  const save = async () => {
    const timestamp = HyperGridDateSeconds(start);
    const endTimestamp = HyperGridDateSeconds(end);

    if (timestamp === undefined || (range && (endTimestamp === undefined || endTimestamp < timestamp))) {
      setInvalid(true);
      return;
    }

    grid.edit(null);
    await grid.write(rowId, field.id, {
      kind: 'date',
      timestamp,
      endTimestamp: range ? endTimestamp : undefined,
      includeTime,
      isRange: range,
    }, {
      ...cell,
      timestamp,
      endTimestamp: range ? endTimestamp ?? null : null,
      includeTime,
      isRange: range,
    });

  };

  return (
    <Popover
      open
      onOpenChange={open => {
        if (!open)
          grid.edit(null);
      }}>
      <PopoverTrigger
        render={<Button
          data-hyper-grid-editor
          variant='ghost'
          tabIndex={-1}
          className='h-10 w-full justify-start rounded-none bg-background px-3' />}>
        <HyperGridCellDisplay cell={cell} />
      </PopoverTrigger>
      <PopoverContent className='w-72 p-3' align='start' onKeyDown={event => event.stopPropagation()}>
        <label className='text-xs font-medium' htmlFor={`hyper-date-${rowId}`}>Start date</label>
        <Input
          id={`hyper-date-${rowId}`}
          aria-invalid={invalid}
          type={includeTime ? 'datetime-local' : 'date'}
          value={start}
          onChange={event => {
            setStart(event.target.value);
            setInvalid(false);
          }} />{range ? <>
          <label className='text-xs font-medium' htmlFor={`hyper-end-${rowId}`}>End date</label>
          <Input
            id={`hyper-end-${rowId}`}
            aria-invalid={invalid}
            type={includeTime ? 'datetime-local' : 'date'}
            value={end}
            onChange={event => {
              setEnd(event.target.value);
              setInvalid(false);
            }} />
        </> : null}<label className='flex items-center justify-between gap-2 text-sm'>Include time<Switch
            checked={includeTime}
            onCheckedChange={checked => {
              setIncludeTime(checked);
              setStart(start ? checked ? `${start.slice(0, 10)}T00:00` : start.slice(0, 10) : '');
              setEnd(end ? checked ? `${end.slice(0, 10)}T00:00` : end.slice(0, 10) : '');
            }} />
        </label>
        <label className='flex items-center justify-between gap-2 text-sm'>End date<Switch
            checked={range}
            onCheckedChange={checked => {
              setRange(checked);

              if (checked && !end)
                setEnd(start);
            }} />
        </label>{invalid ? <p role='alert' className='text-xs text-destructive'>Choose valid dates. End must be on or after start.</p> : null}<div className='flex justify-between gap-2'>
          <Button
            variant='ghost'
            onClick={() => {
              void grid.write(rowId, field.id, {
                kind: 'date',
                clear: true,
              }, {
                ...cell,
                timestamp: null,
                endTimestamp: null,
                display: '',
              });

              grid.edit(null);
            }}>Clear</Button>
          <Button onClick={() => void save()}>Apply</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function HyperGridCell(
  {
    rowId,
    field,
    property,
  }: HyperGridCellProps,
) {
  const grid = useHyperGrid();
  const cell = grid.cell(rowId, field.id);
  const editing = grid.editing?.rowId === rowId && grid.editing.fieldId === field.id;

  if (!cell)
    return <Skeleton className='h-4 w-16' />;

  if (cell.error) return (
    <Tooltip>
      <TooltipTrigger
        render={<Button
          variant='ghost'
          size='sm'
          className='text-destructive'
          onClick={() => void grid.run(() => grid.controller.loadCell(rowId, field.id, true))} />}>
        <AlertCircle className='size-3.5' />Retry</TooltipTrigger>
      <TooltipContent>{cell.error}</TooltipContent>
    </Tooltip>
  );

  if (editing && (cell.kind === 'text' || cell.kind === 'url' || cell.kind === 'number'))
    return <HyperGridTextEditor key={`${rowId}:${field.id}`} rowId={rowId} field={field} cell={cell} property={property} />;

  if (editing && (cell.kind === 'singleSelect' || cell.kind === 'multiSelect'))
    return <HyperGridSelectEditor rowId={rowId} field={field} cell={cell} property={property} />;

  if (editing && cell.kind === 'date')
    return <HyperGridDateEditor rowId={rowId} field={field} cell={cell} property={property} />;

  if (cell.kind === 'checkbox') return (
    <span className='flex h-10 items-center justify-center'>
      <Checkbox
        tabIndex={-1}
        checked={cell.checked}
        aria-label={`${field.name} for row`}
        onCheckedChange={checked => void grid.write(rowId, field.id, {
          kind: 'checkbox',
          checked,
        }, {
          ...cell,
          checked,
          display: checked ? 'Yes' : 'No',
        })} />
    </span>
  );

  const editable = ['text', 'url', 'number', 'date', 'singleSelect', 'multiSelect', 'checklist'].includes(cell.kind);

  return (
    <span className='group/hyper-cell flex min-w-0 items-center gap-1'>
      <Button
        variant='ghost'
        tabIndex={property ? 0 : -1}
        aria-label={`${editable ? 'Edit' : 'Read'} ${field.name}: ${cell.display || 'empty'}`}
        disabled={!editable}
        onClick={() => cell.kind === 'checklist' ? grid.expand(rowId) : grid.edit({
          rowId,
          fieldId: field.id,
        })}
        className={cn(
          'min-h-10 w-full min-w-0 justify-start rounded-none px-3 text-left font-normal hover:bg-transparent disabled:opacity-100',
          field.settings.wrapCellContent ? 'h-auto py-2' : 'h-10',
          property && 'min-h-8 rounded-md px-2',
          field.isPrimary && 'font-medium',
        )}>
        <span className='min-w-0 flex-1'>
          <HyperGridCellDisplay cell={cell} wrap={field.settings.wrapCellContent} />
        </span>
      </Button>{cell.kind === 'url' && /^https?:\/\//i.test(cell.url) ? <a
        href={cell.url}
        target='_blank'
        rel='noreferrer'
        aria-label={`Open ${cell.url}`}
        className='mr-2 shrink-0 text-info opacity-0 group-hover/hyper-cell:opacity-100 focus-visible:opacity-100'>
        <ExternalLink className='size-3' />
      </a> : null}</span>
  );
}
