import { useEffect, useRef } from 'react';
import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { HyperMentionInput, HyperMentionTextarea } from '@/features/hyper-people/HyperMentionInput';
import { HyperPeoplePicker } from '@/features/hyper-people/HyperPeoplePicker';
import { hyperIsPeopleField } from '@/features/hyper-people/HyperPeopleProperty';
import { useId, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { showToast } from '@/ui';
import type { HyperDatabaseController } from '../../HyperDatabaseController';
import type { HyperField } from '../../HyperDatabaseTypes';
import { hyperCalendarColor, hyperCalendarDraftDates, hyperCalendarError, hyperCalendarSeconds, type HyperCalendarDraft } from './HyperCalendarData';
import { HyperCalendarDeleteDialog } from './HyperCalendarDeleteDialog';

interface HyperCalendarDialogProps {
  initial: HyperCalendarDraft;
  saveTo?: (draft: HyperCalendarDraft) => ReactNode;
  controller: HyperDatabaseController;
  dateField: HyperField;
  primaryField?: HyperField;
  colorField?: HyperField;
  timeZone: string;
  onClose: () => void;
  onSaved: () => void;
}
export function HyperCalendarEventDialog({ initial, controller, dateField, primaryField, colorField, timeZone, onClose, onSaved, saveTo }: HyperCalendarDialogProps) {
  const [state, setState] = useState(controller.state);
  useEffect(() => controller.store.subscribe(next => setState(next)), [controller]);
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const [peopleValues, setPeopleValues] = useState<Record<string, string>>({});
  const descriptionField = controller.state.fields.find(field => field.type === FieldType.RichText && !field.isPrimary && !hyperIsPeopleField(field.proto) && /description|notes/i.test(field.name));
  const [description, setDescription] = useState(''); const descriptionDirty = useRef(false);
  useEffect(() => { if (!initial.rowId) return; let alive = true; void controller.loadRows([initial.rowId]).then(() => { const cell = descriptionField ? controller.state.cells[initial.rowId!]?.[descriptionField.id] : undefined; if (alive && !descriptionDirty.current) setDescription(cell?.kind === 'text' ? cell.text : ''); }).catch(() => {}); return () => { alive = false; }; }, [controller, initial.rowId, descriptionField?.id]);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const dates = hyperCalendarDraftDates(draft, timeZone);
  const patch = (value: Partial<HyperCalendarDraft>) => setDraft(previous => ({ ...previous, ...value }));
  const save = async () => {
    if (busy || draft.readOnly || dates.error) return;
    setBusy(true);
    let createdId: string | undefined;
    try {
      const rowId = draft.rowId ?? (createdId = (await controller.createRow()).id);
      if (primaryField) await controller.updateCell(rowId, primaryField.id, { kind: 'text', text: draft.title.trim() || 'Untitled' });
      if (descriptionDirty.current) { const field = descriptionField ?? await controller.createField('Description', FieldType.RichText); await controller.updateCell(rowId, field.id, { kind: 'text', text: description }); }
      for (const [fieldId, text] of Object.entries(peopleValues)) await controller.updateCell(rowId, fieldId, { kind: 'text', text });
      await controller.updateCell(rowId, dateField.id, { kind: 'date', timestamp: hyperCalendarSeconds(dates.start), includeTime: !draft.allDay, isRange: draft.isRange,
        ...(dates.end ? { endTimestamp: hyperCalendarSeconds(dates.end) } : {}) });
      if (colorField) {
        const cell = controller.state.cells[rowId]?.[colorField.id];
        const previous = cell?.kind === 'singleSelect' ? cell.selected.map(option => option.id) : [];
        await controller.updateCell(rowId, colorField.id, { kind: 'singleSelect', insertOptionIds: draft.optionId ? [draft.optionId] : [], deleteOptionIds: previous.filter(option => option !== draft.optionId) });
      }
      onSaved(); onClose();
    } catch (error) {
      if (createdId) {
        try { await controller.deleteRows([createdId]); }
        catch { patch({ rowId: createdId }); } // Retrying edits the surviving row instead of creating a duplicate.
      }
      showToast({ type: 'error', message: hyperCalendarError(error) }); onSaved();
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!draft.rowId || busy) return;
    setBusy(true);
    try { await controller.deleteRows([draft.rowId]); onSaved(); onClose(); }
    catch (error) { showToast({ type: 'error', message: hyperCalendarError(error) }); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[calc(100%-2rem)] overflow-y-auto rounded-xl shadow-xl sm:max-w-md" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{draft.rowId ? 'Edit event' : 'New event'}</DialogTitle><DialogDescription className="sr-only">Set the title, dates and colour for this database row.</DialogDescription></DialogHeader>
      <form className="flex flex-col gap-4" onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement) { event.preventDefault(); void save(); } }} onSubmit={event => { event.preventDefault(); void save(); }}>
        {!draft.rowId && saveTo?.(draft)}
        <fieldset disabled={busy || draft.readOnly} className="flex min-w-0 flex-col gap-4">
          <Field><FieldLabel htmlFor={`${id}-title`}>Title</FieldLabel><HyperMentionInput id={`${id}-title`} autoFocus value={draft.title} onChange={event => patch({ title: event.target.value })} placeholder="Untitled" disabled={!primaryField || busy || draft.readOnly} /></Field>
          <Field><FieldLabel htmlFor={id + "-description"}>Description</FieldLabel><HyperMentionTextarea id={id + "-description"} value={description} disabled={busy || draft.readOnly} onChange={event => { descriptionDirty.current = true; setDescription(event.target.value); }} placeholder="Add a description…" /></Field>
          {state.fields.filter(field => hyperIsPeopleField(field.proto)).map(field => <Field key={field.id}><FieldLabel>{field.name}</FieldLabel><HyperPeoplePicker label={field.name} value={peopleValues[field.id] ?? state.cells[draft.rowId ?? ""]?.[field.id]?.display ?? ""} onChange={value => setPeopleValues(previous => ({ ...previous, [field.id]: value }))} disabled={busy || draft.readOnly || Boolean(draft.rowId && (!state.cells[draft.rowId]?.[field.id] || state.cells[draft.rowId]?.[field.id]?.error))} /></Field>)}
          <Field orientation="horizontal"><FieldLabel htmlFor={`${id}-all-day`}>All day</FieldLabel><Switch id={`${id}-all-day`} checked={draft.allDay} onCheckedChange={allDay => patch({ allDay })} /></Field>
          <Field><FieldLabel htmlFor={`${id}-start-date`}>Start</FieldLabel><div className="flex gap-2"><Input id={`${id}-start-date`} type="date" value={draft.startDate} onChange={event => patch({ startDate: event.target.value, ...(!draft.isRange ? { endDate: event.target.value } : {}) })} className="min-w-0 flex-1" />{!draft.allDay && <Input aria-label="Start time" type="time" value={draft.startTime} onChange={event => patch({ startTime: event.target.value })} className="w-32" />}</div></Field>
          <Field orientation="horizontal"><FieldLabel htmlFor={`${id}-range`}>End date</FieldLabel><Switch id={`${id}-range`} checked={draft.isRange} onCheckedChange={isRange => patch({ isRange })} /></Field>
          {draft.isRange && <Field data-invalid={Boolean(dates.error)}><FieldLabel htmlFor={`${id}-end-date`} className="sr-only">End</FieldLabel><div className="flex gap-2"><Input id={`${id}-end-date`} type="date" aria-invalid={Boolean(dates.error)} value={draft.endDate} onChange={event => patch({ endDate: event.target.value })} className="min-w-0 flex-1" />{!draft.allDay && <Input aria-label="End time" type="time" value={draft.endTime} onChange={event => patch({ endTime: event.target.value })} className="w-32" />}</div></Field>}
          {colorField && <Field><FieldLabel htmlFor={`${id}-color`}>Colour</FieldLabel><Select value={draft.optionId} onValueChange={optionId => patch({ optionId: optionId ?? '' })} items={[{ value: '', label: 'None' }, ...colorField.options.map(option => ({ value: option.id, label: option.name }))]}>
            <SelectTrigger id={`${id}-color`} className="w-full"><SelectValue>{draft.optionId && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: hyperCalendarColor(colorField.options.find(option => option.id === draft.optionId)?.color) }} />}{colorField.options.find(option => option.id === draft.optionId)?.name ?? 'None'}</SelectValue></SelectTrigger><SelectContent className={floatingSurfaceClass}><SelectItem value="">None</SelectItem>{colorField.options.map(option => <SelectItem key={option.id} value={option.id}><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: hyperCalendarColor(option.color) }} />{option.name}</SelectItem>)}</SelectContent>
          </Select></Field>}
        </fieldset>
        {dates.error && <FieldError>{dates.error}</FieldError>}
        {draft.readOnly && <p className="text-xs text-muted-foreground">This row has a property error and cannot be edited.</p>}
        <DialogFooter>
          {draft.rowId && <Button type="button" variant="ghost" className="mr-auto text-destructive hover:text-destructive" disabled={busy || draft.readOnly} onClick={() => setDeleteOpen(true)}><Trash2 className="size-4" />Delete</Button>}
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || draft.readOnly || Boolean(dates.error)}>{busy ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </form>
      <HyperCalendarDeleteDialog open={deleteOpen} onOpenChange={setDeleteOpen} onDelete={() => void remove()} busy={busy} />
    </DialogContent>
  </Dialog>;
}
