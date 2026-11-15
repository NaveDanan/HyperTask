import { Plus } from 'lucide-react';
import { GanttNavToday, GanttNavPrev, GanttNavNext, GanttTitle } from '@/components/reui/gantt/gantt-nav';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { HyperField } from '../../HyperDatabaseTypes';
import { HyperGanttScales, type HyperGanttConfig } from './HyperGanttMapping';
import { HyperGanttSettings } from './HyperGanttSettings';

export function HyperGanttToolbar({ config, fields, save, settingsOpen, setSettingsOpen, createTask, creating, hasDateField }: {
  config: HyperGanttConfig; fields: HyperField[]; save: (patch: Partial<HyperGanttConfig>) => Promise<void>;
  settingsOpen: boolean; setSettingsOpen: (open: boolean) => void; createTask: () => void; creating: boolean; hasDateField: boolean;
}) {
  const items = HyperGanttScales.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }));
  return <div className="flex h-10 shrink-0 items-center gap-1" data-hyper-gantt-toolbar>
    {hasDateField && <>
    <GanttNavToday tooltip={null}>Today</GanttNavToday>
    <Select
      value={config.scale}
      items={items}
      onValueChange={scale => { if (scale) void save({ scale }).catch(() => {}); }}
    >
      <SelectTrigger
        size="sm"
        className="w-28"
        aria-label="Timeline scale"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>

    </Select>
    <GanttNavPrev />
    <GanttNavNext />
    <GanttTitle className="ml-1" />
    </>}
    <div className="ml-auto flex shrink-0 items-center gap-2">
      <HyperGanttSettings
        fields={fields}
        config={config}
        save={save}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
      {hasDateField && <Button
        data-hyper-gantt-create-task
        variant="default"
        size="sm"
        className="bg-primary text-primary-foreground transition-colors"
        disabled={creating}
        onClick={createTask}
      >
        <Plus className="size-4" />{creating ? 'Creating…' : 'New task'}
      </Button>}

    </div>

  </div>;
}
