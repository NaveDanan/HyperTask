import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import type { HyperField } from '../../HyperDatabaseTypes';
import { HyperGanttNone, type HyperGanttConfig } from './HyperGanttMapping';

export function HyperGanttFieldSelect({ label, value, fields, emptyLabel, onChange }: {
  label: string; value: string | null; fields: HyperField[]; emptyLabel?: string; onChange: (id: string | null) => void;
}) {
  const items = [...(emptyLabel ? [{ value: HyperGanttNone, label: emptyLabel }] : []), ...fields.map(f => ({ value: f.id, label: f.name }))];
  return <Field className="gap-1">
    <FieldLabel className="text-xs" htmlFor={`hyper-gantt-${label.replaceAll(' ', '-')}`}>{label}</FieldLabel>
    <Select
      value={value ?? (emptyLabel ? HyperGanttNone : null)}
      items={items}
      onValueChange={id => onChange(id === HyperGanttNone ? null : id)}
    >
      <SelectTrigger
        size="sm"
        id={`hyper-gantt-${label.replaceAll(' ', '-')}`}
        className="w-full text-xs"
      >
        <SelectValue placeholder="Choose a field" />
      </SelectTrigger>
      <SelectContent>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>

    </Select>

  </Field>;
}
export function HyperGanttSettings({ fields, config, save, open, onOpenChange }: {
  fields: HyperField[]; config: HyperGanttConfig; save: (patch: Partial<HyperGanttConfig>) => Promise<void>; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const update = (key: keyof HyperGanttConfig, value: string | null) => { void save({ [key]: value }).catch(() => {}); };
  const dates = fields.filter(f => f.type === FieldType.DateTime);
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger render={<Button variant="outline" size="sm" />}>
      <Settings2 className="size-4" />Settings
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 p-3">
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Gantt settings</h2>
        <HyperGanttFieldSelect
          label="Dates / Start"
          value={config.start_field_id}
          fields={dates}
          onChange={id => update('start_field_id', id)}
        />
        <HyperGanttFieldSelect
          label="End"
          value={config.end_field_id}
          fields={dates.filter(f => f.id !== config.start_field_id)}
          emptyLabel="Same field (range)"
          onChange={id => update('end_field_id', id)}
        />
        <HyperGanttFieldSelect
          label="Colour by"
          value={config.color_field_id}
          fields={fields.filter(f => f.type === FieldType.SingleSelect)}
          emptyLabel="None"
          onChange={id => update('color_field_id', id)}
        />
        <HyperGanttFieldSelect
          label="Progress"
          value={config.progress_field_id}
          fields={fields.filter(f => [FieldType.Number, FieldType.Checklist].includes(f.type))}
          emptyLabel="None"
          onChange={id => update('progress_field_id', id)}
        />
        <HyperGanttFieldSelect
          label="Assignee"
          value={config.assignee_field_id}
          fields={fields.filter(f => [FieldType.RichText, FieldType.SingleSelect, FieldType.MultiSelect].includes(f.type))}
          emptyLabel="None"
          onChange={id => update('assignee_field_id', id)}
        />

      </div>

    </PopoverContent>

  </Popover>;
}
