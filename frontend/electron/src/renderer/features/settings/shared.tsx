import { isValidElement, useId, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { SettingsPageHeader, SettingsSection, SettingsGroup } from '@/components/app/settings-layout';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tooltip } from '@/ui';
import { cn } from '@/lib/utils';

/** Preserve child keys so conditional siblings do not remount page-local state. */
const childKey = (child: ReactNode, index: number) =>
  isValidElement(child) && child.key !== null ? 'k:' + child.key : 'i:' + index;

export const SettingsCategorySpacer = () => <div className="py-3"><Separator /></div>;

export function SettingsHeader({ title, description }: { title: string; description?: ReactNode }) {
  return <SettingsPageHeader title={title} description={description} />;
}

/** The dialog owns the ScrollArea and its page padding. */
export function SettingsBody({ title, description, autoSeparate = true, children }: {
  title: string; description?: ReactNode; autoSeparate?: boolean; children: ReactNode;
}) {
  const items = (Array.isArray(children) ? children.flat() : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return <div className="w-full">
    <SettingsHeader title={title} description={description} />
    {items.map((child, index) => <div key={childKey(child, index)} className={cn(index > 0 && autoSeparate && 'pt-3')}>{index > 0 && autoSeparate && <Separator className="mb-3" />}{child}</div>)}
  </div>;
}

export function SettingsCategory({ title, description, tooltip, actions, children }: {
  title: string; description?: string; tooltip?: string; actions?: ReactNode; children: ReactNode;
}) {
  const items = (Array.isArray(children) ? children.flat() : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return <SettingsSection title={<span className="inline-flex items-center gap-1">{title}{tooltip && <Tooltip message={tooltip}><span className="inline-flex"><Info className="size-4 text-muted-foreground" /></span></Tooltip>}</span>} description={description} actions={actions}>
    <SettingsGroup>{items.map((child, index) => <div key={childKey(child, index)}>{child}</div>)}</SettingsGroup>
  </SettingsSection>;
}

export interface DropdownOption<T> {
  value: T; label: string; fontFamily?: string; leading?: ReactNode; trailing?: ReactNode;
}

export function SettingsDropdown<T>({ selected, options, onChanged, actions, expandWidth = true, showCheck = true }: {
  selected: T; options: DropdownOption<T>[]; onChanged: (value: T) => void;
  actions?: ReactNode; expandWidth?: boolean; showCheck?: boolean;
}) {
  const index = options.findIndex((option) => option.value === selected);
  const current = options[index];
  return <div className={cn('flex min-w-0 items-center gap-2', expandWidth && 'w-full')}>
    <Select value={index < 0 ? null : String(index)} onValueChange={(value) => { const option = options[Number(value)]; if (value !== null && option) onChanged(option.value); }}>
      <SelectTrigger size="sm" className={cn('min-w-40', expandWidth && 'w-full')}>
        <SelectValue><span className="truncate" style={{ fontFamily: current?.fontFamily }}>{current?.label ?? String(selected)}</span></SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="max-h-64 p-1">
        {options.map((option, i) => <SelectItem key={i} value={String(i)} className={cn(!showCheck && '[&>span:last-child]:hidden')}>
          {option.leading}<span className="min-w-0 flex-1 truncate" style={{ fontFamily: option.fontFamily }}>{option.label}</span>
          {option.trailing && <span className="ml-auto inline-flex" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>{option.trailing}</span>}
        </SelectItem>)}
      </SelectContent>
    </Select>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>;
}

export function SettingsRadioSelect<T>({ items, onChanged }: {
  items: Array<{ value: T; label: string; isSelected: boolean; icon?: ReactNode }>; onChanged: (value: T) => void;
}) {
  const id = useId();
  const selected = items.findIndex((item) => item.isSelected);
  return <RadioGroup className="flex flex-wrap gap-x-6 gap-y-2" value={selected < 0 ? null : String(selected)} onValueChange={(value) => { const item = items[Number(value)]; if (value !== null && item) onChanged(item.value); }}>
    {items.map((item, index) => <label key={index} htmlFor={id + '-' + index} className="flex cursor-pointer items-center gap-2 text-sm">
      <RadioGroupItem id={id + '-' + index} value={String(index)} />{item.icon}{item.label}
    </label>)}
  </RadioGroup>;
}

export function OutlinedRoundedButton({ text, onTap, minWidth }: { text: string; onTap: () => void; minWidth?: number }) {
  return <Button variant="outline" size="sm" onClick={onTap} style={{ minWidth }}>{text}</Button>;
}
