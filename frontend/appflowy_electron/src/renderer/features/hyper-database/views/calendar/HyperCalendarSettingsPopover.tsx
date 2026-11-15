import { useId, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { showToast } from '@/ui';
import type { HyperDatabaseController } from '../../HyperDatabaseController';
import type { HyperField } from '../../HyperDatabaseTypes';
import { hyperCalendarError } from './HyperCalendarData';

interface HyperCalendarSettingsProps {
  controller: HyperDatabaseController;
  dateFields: HyperField[];
  dateFieldId: string;
  colorFields: HyperField[];
  colorFieldId: string;
  onColorByChange: (id: string) => void;
  showWeekends: boolean;
  firstDayOfWeek: number;
}
export function HyperCalendarSettingsPopover(props: HyperCalendarSettingsProps) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const write = async (patch: Parameters<HyperDatabaseController['updateCalendarSettings']>[0]) => {
    setBusy(true);
    try { await props.controller.updateCalendarSettings(patch); }
    catch (error) { showToast({ type: 'error', message: hyperCalendarError(error) }); }
    finally { setBusy(false); }
  };
  return <Popover open={open} onOpenChange={setOpen}>
    <Tooltip>
      <PopoverTrigger render={<TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Calendar settings" />} />}><Settings2 className="size-4" /></PopoverTrigger>
      {!open && <TooltipContent>Calendar settings</TooltipContent>}
    </Tooltip>
    <PopoverContent align="end" className={`${floatingSurfaceClass} w-80 gap-4 p-4`}>
      <PopoverTitle>Calendar settings</PopoverTitle>
      <Field><FieldLabel htmlFor={`${id}-date`}>Date field</FieldLabel>
        <Select value={props.dateFieldId} onValueChange={value => { if (value) void write({ fieldId: value }); }} disabled={busy} items={props.dateFields.map(field => ({ value: field.id, label: field.name }))}>
          <SelectTrigger id={`${id}-date`} size="sm" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent className={floatingSurfaceClass}>{props.dateFields.map(field => <SelectItem key={field.id} value={field.id}>{field.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field><FieldLabel htmlFor={`${id}-color`}>Colour by</FieldLabel>
        <Select value={props.colorFieldId} onValueChange={value => props.onColorByChange(value ?? '')} items={[{ value: '', label: 'None' }, ...props.colorFields.map(field => ({ value: field.id, label: field.name }))]}>
          <SelectTrigger id={`${id}-color`} size="sm" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent className={floatingSurfaceClass}><SelectItem value="">None</SelectItem>{props.colorFields.map(field => <SelectItem key={field.id} value={field.id}>{field.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field orientation="horizontal"><FieldLabel htmlFor={`${id}-weekends`}>Show weekends</FieldLabel><Switch id={`${id}-weekends`} checked={props.showWeekends} disabled={busy} onCheckedChange={checked => void write({ showWeekends: checked })} /></Field>
      <Field><FieldLabel id={`${id}-week-start`}>Week starts on</FieldLabel>
        <ToggleGroup aria-labelledby={`${id}-week-start`} value={[String(props.firstDayOfWeek)]} onValueChange={value => { if (value[0]) void write({ firstDayOfWeek: Number(value[0]) }); }} variant="outline" size="sm" disabled={busy}>
          <ToggleGroupItem value="0">Sun</ToggleGroupItem><ToggleGroupItem value="1">Mon</ToggleGroupItem>
        </ToggleGroup>
      </Field>
    </PopoverContent>
  </Popover>;
}
