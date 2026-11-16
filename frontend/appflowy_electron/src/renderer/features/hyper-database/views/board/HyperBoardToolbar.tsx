import { ChevronDown, Columns3, ListFilter, Plus, Search, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import type { HyperField, HyperGroup } from '../../HyperDatabaseTypes';
import { hyperBoardGroupFields, hyperBoardGroupName } from './hyperBoardModel';
import { hyperBoardGroupDot } from './hyperBoardColors';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';

interface HyperBoardToolbarProps {
  fields: HyperField[]; groupField?: HyperField; groups: HyperGroup[]; visibleFields: HyperField[];
  search: string; onSearch: (value: string) => void;
  excluded: Set<string>; onExcluded: (id: string, excluded: boolean) => void;
  hideEmpty: boolean; onHideEmpty: (value: boolean) => void;
  onGroupField: (id: string) => void; onFieldVisibility: (id: string, visible: boolean) => void;
  onNew: () => void; loading?: boolean; disabled?: boolean; fieldsBusy?: boolean;
}
export function HyperBoardToolbar(props: HyperBoardToolbarProps) {
  const { fields, groupField, groups, visibleFields, search, onSearch, excluded, onExcluded, hideEmpty, onHideEmpty, onGroupField, onFieldVisibility, onNew, loading, disabled, fieldsBusy } = props;
  const checkbox = groupField?.type === FieldType.Checkbox;
  return <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4" aria-label="Board toolbar">
    <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={loading} className="min-w-0 shrink-0" />}><Columns3 className="size-4" /><span className="max-w-48 truncate">Group by: {groupField?.name ?? 'None'}</span><ChevronDown className="size-4" /></DropdownMenuTrigger>
      <DropdownMenuContent className="w-56"><DropdownMenuRadioGroup value={groupField?.id ?? ''} onValueChange={onGroupField}>{hyperBoardGroupFields(fields).map(field => <DropdownMenuRadioItem key={field.id} value={field.id}>{field.name}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
    </DropdownMenu>
    {loading ? <Spinner className="size-4 text-muted-foreground" /> : null}
    <div className="ml-auto flex min-w-0 items-center gap-2">
      <InputGroup className="h-8 w-56 max-w-56 min-w-24"><InputGroupAddon><Search className="size-4" /></InputGroupAddon><InputGroupInput aria-label="Search cards" placeholder="Search cards" value={search} onChange={event => onSearch(event.target.value)} /></InputGroup>
      <Popover><PopoverTrigger render={<Button variant="ghost" size="sm" />}><ListFilter className="size-4" />Filter{excluded.size || hideEmpty ? <span className="size-1.5 rounded-full bg-primary" /> : null}</PopoverTrigger>
        <PopoverContent align="end" className="w-56 gap-2 p-3"><PopoverTitle>Show groups</PopoverTitle>{groups.filter(group => group.isVisible).map(group => <label key={group.groupId} className="flex items-center gap-2 py-1 text-sm"><Checkbox checked={!excluded.has(group.groupId)} onCheckedChange={checked => onExcluded(group.groupId, !checked)} /><span className={`size-2 shrink-0 rounded-full ${hyperBoardGroupDot(group, checkbox)}`} /><span className="truncate">{hyperBoardGroupName(group, checkbox)}</span></label>)}<label className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">Hide empty groups<Switch size="sm" checked={hideEmpty} onCheckedChange={onHideEmpty} /></label></PopoverContent>
      </Popover>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Card fields" />}><Settings2 className="size-4" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56"><DropdownMenuGroup><DropdownMenuLabel>Card fields</DropdownMenuLabel>{fields.map(field => <DropdownMenuCheckboxItem key={field.id} checked={visibleFields.some(visible => visible.id === field.id)} disabled={field.isPrimary || fieldsBusy} closeOnClick={false} onCheckedChange={checked => onFieldVisibility(field.id, checked)}>{field.name}</DropdownMenuCheckboxItem>)}</DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" onClick={onNew} disabled={disabled || loading}><Plus className="size-4" />New</Button>
    </div>
  </div>;
}
