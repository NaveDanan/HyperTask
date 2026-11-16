import { hyperIsPeopleField } from '@/features/hyper-people/HyperPeopleProperty';
"use no memo";
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Copy, EyeOff, PencilLine, Pin, PinOff, Trash2, WrapText } from 'lucide-react';
import { FieldVisibility } from '@shared/protobuf/hyper-database2/field_settings_entities_pb';
import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { SortConditionPB } from '@shared/protobuf/hyper-database2/sort_entities_pb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

import { MenuRow } from '@/components/app/menu-row';
import type { HyperField } from '../../HyperDatabaseTypes';
import { useHyperGrid } from './HyperGridContext';
import { HyperGridFieldIcon, HyperGridFieldTypes } from './HyperGridModel';

export async function HyperGridSetSort(controller: ReturnType<typeof useHyperGrid>['controller'], field: HyperField, descending: boolean) {
  const condition = descending ? SortConditionPB.Descending : SortConditionPB.Ascending;
  const sorts = controller.state.settings?.sorts?.items ?? [];
  const active = sorts.find(sort => sort.fieldId === field.id);
  const clear = active?.condition === condition;

  for (const sort of sorts) {
    if (sort.id !== active?.id || clear) await controller.updateSettings({
      oneOfDeleteSort: {
        case: 'deleteSort',

        value: {
          viewId: controller.viewId,
          sortId: sort.id,
        },
      },
    });
  }

  if (!clear) await controller.updateSettings({
    oneOfUpdateSort: {
      case: 'updateSort',

      value: {
        viewId: controller.viewId,
        fieldId: field.id,
        condition,

        ...(active ? {
          oneOfSortId: {
            case: 'sortId',
            value: active.id,
          },
        } : {}),
      },
    },
  });
}

export function HyperGridFieldMenu(
  {
    field,
    pin,
    pinned,
  }: {
    field: HyperField;
    pin: (position: false | 'start' | 'end') => void;
    pinned: false | 'start' | 'end';
  },
) {
  const grid = useHyperGrid();
  const [open, setOpen] = useState(false);
  const [rename, setRename] = useState(false);
  const [name, setName] = useState(field.name);
  const [remove, setRemove] = useState(false);
  const sort = grid.state.settings?.sorts?.items.find(sort => sort.fieldId === field.id);

  if (rename) return (
    <Input
      autoFocus
      aria-label={`Rename ${field.name}`}
      value={name}
      onChange={event => setName(event.target.value)}
      onBlur={() => {
        setRename(false);

        if (name.trim() && name !== field.name)
          void grid.run(() => grid.controller.renameField(field.id, name.trim()));
      }}
      onKeyDown={event => {
        if (event.key === 'Enter')
          event.currentTarget.blur();

        if (event.key === 'Escape') {
          setName(field.name);
          setRename(false);
        }
      }}
      className='h-8 w-full px-1 text-xs' />
  );

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={<Button
            variant='ghost'
            className='h-8 w-full min-w-0 justify-start gap-2 px-0 text-xs font-medium text-muted-foreground hover:bg-transparent'
            onContextMenu={event => {
              event.preventDefault();
              setOpen(true);
            }} />}>
          <HyperGridFieldIcon type={field.type} people={hyperIsPeopleField(field.proto)} />
          <span className={`truncate ${sort ? 'text-foreground' : ''}`}>{field.name}</span>{sort ? sort.condition === SortConditionPB.Ascending ? <ArrowUp className='size-3.5 shrink-0 text-foreground' /> : <ArrowDown className='size-3.5 shrink-0 text-foreground' /> : null}</DropdownMenuTrigger>
        <DropdownMenuContent className='w-56'>
          <DropdownMenuItem
            onClick={() => {
              setName(field.name);
              setRename(true);
            }}>
            <PencilLine />Rename</DropdownMenuItem>{!field.isPrimary ? <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <HyperGridFieldIcon type={field.type} people={hyperIsPeopleField(field.proto)} />Type</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className='max-h-80 overflow-y-auto'>{HyperGridFieldTypes.map(item => <DropdownMenuItem
                key={item.label}
                onClick={() => void grid.run(() => grid.controller.changeFieldType(field.id, item.type, item.people))}>
                <item.icon />{item.label}</DropdownMenuItem>)}</DropdownMenuSubContent>
          </DropdownMenuSub> : null}<DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void grid.run(() => HyperGridSetSort(grid.controller, field, false))}>
            <ArrowUp />{sort?.condition === SortConditionPB.Ascending ? 'Clear sort' : 'Sort ascending'}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void grid.run(() => HyperGridSetSort(grid.controller, field, true))}>
            <ArrowDown />{sort?.condition === SortConditionPB.Descending ? 'Clear sort' : 'Sort descending'}</DropdownMenuItem>{!field.isPrimary ? <>
            <DropdownMenuItem
              onClick={() => void grid.run(() => grid.controller.updateFieldSettings(field.id, {
                visibility: FieldVisibility.AlwaysHidden,
              }))}>
              <EyeOff />Hide</DropdownMenuItem>
            <DropdownMenuItem onClick={() => pin(pinned ? false : 'start')}>{pinned ? <PinOff /> : <Pin />}{pinned ? 'Unpin' : 'Pin to start'}</DropdownMenuItem>
          </> : null}<DropdownMenuItem
            onClick={() => void grid.run(() => grid.controller.updateFieldSettings(field.id, {
              wrapCellContent: !field.settings.wrapCellContent,
            }))}>
            <WrapText />{field.settings.wrapCellContent ? 'Unwrap text' : 'Wrap text'}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void grid.run(() => grid.controller.duplicateField(field.id))}>
            <Copy />Duplicate</DropdownMenuItem>{!field.isPrimary ? <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant='destructive' onClick={() => setRemove(true)}>
              <Trash2 />Delete</DropdownMenuItem>
          </> : null}</DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={remove} onOpenChange={setRemove}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete “{field.name}”?</AlertDialogTitle>
          <AlertDialogDescription>This removes the field and its values from every row in this database.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={async () => {
                if (await grid.run(() => grid.controller.deleteField(field.id)))
                  setRemove(false);
              }}>Delete field</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function HyperGridAddField(
  {
    children,
    onCreated,
  }: {
    children: ReactNode;
    onCreated?: (id: string) => void;
  },
) {
  const grid = useHyperGrid();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async (type: FieldType, people = false) => {
    if (busy)
      return;

    setBusy(true);

    const success = await grid.run(async () => {
      const field = people ? await grid.controller.createHyperPeopleField(name.trim() || 'People') : await grid.controller.createField(name.trim() || HyperGridFieldTypes.find(item => item.type === type)?.label || 'Field', type);
      onCreated?.(field.id);
    });

    setBusy(false);

    if (success) {
      setOpen(false);
      setName('');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant='ghost' size='icon-xs' aria-label='Add field' />}>{children}</PopoverTrigger>
      <PopoverContent className='w-64 p-2' align='end'>
        <label className='text-xs font-medium' htmlFor='hyper-grid-field-name'>Field name</label>
        <Input
          id='hyper-grid-field-name'
          autoFocus
          placeholder='Field name'
          value={name}
          onChange={event => setName(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter')
              void create(FieldType.RichText);
          }} />
        <div className='max-h-72 overflow-y-auto p-1'>{HyperGridFieldTypes.map(item => <MenuRow
            key={item.label}
            disabled={busy}
            onClick={() => void create(item.type, item.people)}
            icon={<item.icon className='size-4 text-muted-foreground' />}
            label={item.label} />)}</div>
      </PopoverContent>
    </Popover>
  );
}
