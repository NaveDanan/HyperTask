import { useEffect, useRef, useState } from 'react';
import { addDays, format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { CalendarDays, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import type { HyperDatabaseController } from '../../HyperDatabaseController';
import type { HyperCellMutation, HyperDatabaseState } from '../../HyperDatabaseTypes';
import { HyperGanttNone, hyperGanttDateCell, type HyperGanttConfig, type HyperGanttTask } from './HyperGanttMapping';
import { hyperGanttSetChecklistProgress } from './HyperGanttMutations';
import { HyperGanttAvatars } from './HyperGanttAvatars';

export function HyperGanttRowDetail({ rowId, state, controller, config, task, fraction, close, setDates, remove }: {
  rowId: string; state: HyperDatabaseState; controller: HyperDatabaseController; config: HyperGanttConfig; task: HyperGanttTask;
  fraction: boolean; close: () => void; setDates: (rowId: string, start: Date, end: Date) => Promise<void>; remove: () => void;
}) {
  const primary = state.fields.find(f => f.isPrimary);
  const statusField = state.fields.find(f => f.id === config.color_field_id) ?? state.fields.find(f => f.type === FieldType.SingleSelect && /status/i.test(f.name));
  const assigneeField = state.fields.find(f => f.id === config.assignee_field_id);
  const progressField = state.fields.find(f => f.id === config.progress_field_id);
  const cells = state.cells[rowId] ?? {};
  const statusCell = statusField ? cells[statusField.id] : undefined;
  const assigneeCell = assigneeField ? cells[assigneeField.id] : undefined;
  const [title, setTitle] = useState(primary ? cells[primary.id]?.display ?? '' : '');
  const [titleDirty, setTitleDirty] = useState(false);
  const [assignee, setAssignee] = useState(assigneeCell?.display ?? '');
  const [assigneeDirty, setAssigneeDirty] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(task.event ? { from: task.event.start, to: task.due ?? task.event.start } : undefined);
  const [dateOpen, setDateOpen] = useState(false);
  const [progress, setProgress] = useState(task.progress ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const run = (work: () => Promise<unknown>) => {
    if (inFlight.current) return inFlight.current;
    setBusy(true); setError(null);
    const pending = Promise.resolve().then(work).then(() => true, e => {
      setError(e instanceof Error ? e.message : (e as { msg?: string }).msg ?? 'Could not save task');
      return false;
    }).finally(() => { inFlight.current = null; setBusy(false); });
    inFlight.current = pending;
    return pending;
  };
  const update = (fieldId: string, mutation: HyperCellMutation) => { void run(() => controller.updateCell(rowId, fieldId, mutation)); };
  const assigneeDisplay = assigneeCell?.display ?? '';
  const assigneeReady = Boolean(assigneeCell && !assigneeCell.error);
  useEffect(() => { if (!assigneeDirty) setAssignee(assigneeDisplay); }, [assigneeDisplay, assigneeDirty]);
  const saveAssignee = async () => {
    if (!assigneeField || !assigneeReady || !assigneeDirty) return;
    if (assignee !== assigneeDisplay) await controller.updateCell(rowId, assigneeField.id, { kind: 'text', text: assignee });
    setAssigneeDirty(false);
  };
  const primaryDisplay = primary ? cells[primary.id]?.display ?? '' : '';
  useEffect(() => { if (!titleDirty) setTitle(primaryDisplay); }, [primaryDisplay, titleDirty]);
  const saveTitle = async () => {
    if (primary && titleDirty) { await controller.updateCell(rowId, primary.id, { kind: 'text', text: title }); setTitleDirty(false); }
  };
  const closeDetail = () => { if (titleDirty || inFlight.current) void run(saveTitle).then(saved => { if (saved) close(); }); else close(); };
  const statusItems = [{ value: HyperGanttNone, label: 'No status' }, ...(statusField?.options.map(o => ({ value: o.id, label: o.name })) ?? [])];
  const selectedAssignees = assigneeCell?.kind === 'singleSelect' || assigneeCell?.kind === 'multiSelect' ? assigneeCell.selected.map(o => o.id) : [];
  return <Sheet open onOpenChange={open => { if (!open) closeDetail(); }}>
    <SheetContent side="right" data-hyper-gantt-detail className="max-w-full data-[side=right]:w-[440px] data-[side=right]:sm:max-w-[440px]">
      <SheetHeader>
        <SheetTitle>Task details</SheetTitle>
        <SheetDescription>Edit this task’s schedule and properties.</SheetDescription>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4" aria-busy={busy}>
        {error && <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>}
        <Field>
          <FieldLabel htmlFor="hyper-gantt-task-title">Name</FieldLabel>
          <Input
            id="hyper-gantt-task-title"
            autoFocus
            disabled={!primary || busy}
            value={title}
            placeholder="Untitled"
            onChange={e => { setTitle(e.target.value); setTitleDirty(true); }}
            onBlur={() => { if (titleDirty) void run(saveTitle); }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </Field>
        <Field>
          <FieldLabel>Dates</FieldLabel>
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger render={<Button
                variant="outline"
                className="justify-start"
                disabled={!config.start_field_id || busy}
              />}>
              <CalendarDays className="size-4" />{task.event ? `${format(task.event.start, 'MMM d, yyyy')} – ${format(task.due ?? task.event.start, 'MMM d, yyyy')}` : 'Choose dates'}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
              <Calendar
                mode="range"
                selected={range}
                defaultMonth={range?.from}
                onSelect={setRange}
              />
              <div className="flex justify-end p-2">
                <Button
                  size="sm"
                  disabled={!range?.from || busy}
                  onClick={() => { if (!range?.from) return; const from = range.from; const to = range.to ?? from; const includeTime = hyperGanttDateCell(cells[config.start_field_id ?? ''])?.includeTime; void run(async () => { await setDates(rowId, from, from.getTime() === to.getTime() || includeTime ? to : addDays(to, 1)); setDateOpen(false); }); }}
                >Save dates</Button>
              </div>

            </PopoverContent>

          </Popover>

        </Field>
        {statusField && <Field>
          <FieldLabel htmlFor="hyper-gantt-task-status">Status</FieldLabel>
          <Select
            disabled={busy}
            value={statusCell?.kind === 'singleSelect' ? statusCell.selected[0]?.id ?? HyperGanttNone : HyperGanttNone}
            items={statusItems}
            onValueChange={value => update(statusField.id, { kind: 'singleSelect', deleteOptionIds: statusCell?.kind === 'singleSelect' ? statusCell.selected.map(o => o.id) : [], insertOptionIds: value && value !== HyperGanttNone ? [value] : [] })}
          >
            <SelectTrigger id="hyper-gantt-task-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{statusItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>}
        {assigneeField && <Field>
          <FieldLabel htmlFor="hyper-gantt-task-assignee">Assignee</FieldLabel>
          {assigneeField.type === FieldType.RichText ? <Input
            id="hyper-gantt-task-assignee"
            disabled={busy || !assigneeReady}
            value={assignee}
            onChange={e => { setAssignee(e.target.value); setAssigneeDirty(true); }}
            onBlur={() => { if (assigneeDirty) void run(saveAssignee); }}
          /> : <Popover>
            <PopoverTrigger render={<Button
                id="hyper-gantt-task-assignee"
                variant="outline"
                className="justify-start"
                disabled={busy}
              />}>
              <HyperGanttAvatars names={task.assignees} />
              <span>{task.assignees.join(', ') || 'Unassigned'}</span>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">{assigneeField.options.map(option => <label key={option.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
                <Checkbox
                  disabled={busy}
                  checked={selectedAssignees.includes(option.id)}
                  onCheckedChange={checked => update(assigneeField.id, { kind: assigneeField.type === FieldType.SingleSelect ? 'singleSelect' : 'multiSelect', insertOptionIds: checked ? [option.id] : [], deleteOptionIds: checked && assigneeField.type === FieldType.SingleSelect ? selectedAssignees : !checked ? [option.id] : [] })}
                />{option.name}
              </label>)}</PopoverContent>

          </Popover>}

        </Field>}
        {progressField && <Field>
          <FieldLabel htmlFor="hyper-gantt-task-progress">Progress <span className="ml-auto tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
          </FieldLabel>
          <Slider
            id="hyper-gantt-task-progress"
            aria-label="Task progress"
            disabled={busy}
            value={[progress]}
            min={0}
            max={100}
            step={1}
            onValueChange={value => setProgress(Array.isArray(value) ? value[0] : value)}
            onValueCommitted={value => {
          const percentage = Array.isArray(value) ? value[0] : value;
          void run(async () => {
            if (progressField.type === FieldType.Checklist) {
              setProgress(await hyperGanttSetChecklistProgress(controller, rowId, progressField.id, percentage));
            } else await controller.updateCell(rowId, progressField.id, { kind: 'number', value: fraction ? percentage / 100 : percentage });
          });
        }}
          />
        </Field>}

      </div>
      <SheetFooter>
        <Button
          variant="destructive"
          disabled={busy}
          onClick={remove}
        >
          <Trash2 className="size-4" />Delete task
        </Button>
      </SheetFooter>

    </SheetContent>

  </Sheet>;
}
