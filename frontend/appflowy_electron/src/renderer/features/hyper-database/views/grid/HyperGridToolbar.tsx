import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FieldVisibility } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/reui/badge';
import { useHyperGrid } from './HyperGridContext';
import { HyperGridFieldIcon } from './HyperGridModel';
import { HyperGridAddField } from './HyperGridFieldMenu';
import { HyperGridSelectColor } from './selectColor';

export function HyperGridToolbar(
  {
    query,
    setQuery,
    option,
    setOption,
    selected,
    clearSelection,
  }: {
    query: string;
    setQuery: (value: string) => void;
    option: string;
    setOption: (value: string) => void;
    selected: string[];
    clearSelection: () => void;
  },
) {
  const grid = useHyperGrid();
  const [dragged, setDragged] = useState<string | null>(null);
  const firstSelect = grid.fields.find(field => field.type === FieldType.SingleSelect);

  if (selected.length) return (
    <div className='flex min-h-8 flex-wrap items-center gap-2' aria-label='Selected rows'>
      <span className='mr-2 text-sm font-medium'>{`${selected.length} selected`}</span>
      <Button
        variant='ghost'
        onClick={() => void grid.run(async () => {
          for (const id of selected)
            await grid.controller.duplicateRow(id);

          clearSelection();
        })}>
        <Copy className='size-4' />Duplicate</Button>
      <Button variant='destructive' onClick={() => grid.deleteRows(selected)}>
        <Trash2 className='size-4' />Delete</Button>
      <Button variant='ghost' size='icon-sm' aria-label='Clear selection' onClick={clearSelection}>
        <X className='size-4' />
      </Button>
    </div>
  );

  return (
    <div className='flex min-h-8 flex-wrap items-center gap-2'>
      <InputGroup className='h-8 w-56 bg-background'>
        <InputGroupAddon>
          <Search className='size-4' />
        </InputGroupAddon>
        <InputGroupInput
          aria-label='Search rows'
          placeholder='Search rows'
          value={query}
          onChange={event => setQuery(event.target.value)} />
      </InputGroup>{firstSelect ? <Select value={option} onValueChange={value => setOption(value ?? '')}>
        <SelectTrigger aria-label={`Filter ${firstSelect.name}`} size='sm' className='min-w-40 bg-background'>
          <SelectValue>{option ? firstSelect.options.find(item => item.id === option)?.name : `All ${firstSelect.name}`}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value=''>All {firstSelect.name}</SelectItem>{firstSelect.options.map(item => <SelectItem key={item.id} value={item.id}>
            <Badge variant={HyperGridSelectColor(item.color)} size='sm'>{item.name}</Badge>
          </SelectItem>)}</SelectContent>
      </Select> : null}<Popover>
        <PopoverTrigger render={<Button variant='outline' className='ml-auto bg-background' />}>
          <SlidersHorizontal className='size-4' />View settings</PopoverTrigger>
        <PopoverContent className='w-72 p-0' align='end'>
          <div className='border-b px-3 py-2 text-xs font-medium text-muted-foreground'>Fields</div>
          <div className='max-h-80 overflow-y-auto p-2'>{grid.fields.map((field, index) => <div
              key={field.id}
              className='flex min-h-9 items-center gap-2 rounded-md px-1 hover:bg-muted/40'
              onDragOver={event => {
                if (dragged && !field.isPrimary)
                  event.preventDefault();
              }}
              onDrop={event => {
                event.preventDefault();

                if (dragged && dragged !== field.id && !field.isPrimary)
                  void grid.moveField(dragged, field.id);

                setDragged(null);
              }}>
              <button
                type='button'
                aria-label={`Drag ${field.name}`}
                disabled={field.isPrimary}
                draggable={!field.isPrimary}
                onDragStart={event => {
                  setDragged(field.id);
                  event.dataTransfer.setData('text/plain', field.id);
                }}
                onDragEnd={() => setDragged(null)}
                className='cursor-grab text-muted-foreground disabled:opacity-30'>
                <GripVertical className='size-3.5' />
              </button>
              <HyperGridFieldIcon type={field.type} />
              <span className='min-w-0 flex-1 truncate text-sm'>{field.name}</span>{!field.isPrimary ? <span className='flex'>
                <Button
                  variant='ghost'
                  size='icon-xs'
                  aria-label={`Move ${field.name} up`}
                  disabled={index <= 1}
                  onClick={() => void grid.moveField(field.id, grid.fields[index - 1].id)}>
                  <ArrowUp className='size-3' />
                </Button>
                <Button
                  variant='ghost'
                  size='icon-xs'
                  aria-label={`Move ${field.name} down`}
                  disabled={index === grid.fields.length - 1}
                  onClick={() => void grid.moveField(field.id, grid.fields[index + 1].id)}>
                  <ArrowDown className='size-3' />
                </Button>
              </span> : null}<Switch
                aria-label={`Show ${field.name}`}
                disabled={field.isPrimary}
                checked={field.isPrimary || field.settings.visibility !== FieldVisibility.AlwaysHidden}
                onCheckedChange={checked => void grid.run(() => grid.controller.updateFieldSettings(field.id, {
                  visibility: checked ? FieldVisibility.AlwaysShown : FieldVisibility.AlwaysHidden,
                }))} />
            </div>)}</div>
          <div className='flex items-center gap-1 border-t px-3 py-1'>
            <HyperGridAddField>
              <Plus className='size-4' />
            </HyperGridAddField>
            <span className='text-sm'>Add field</span>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
