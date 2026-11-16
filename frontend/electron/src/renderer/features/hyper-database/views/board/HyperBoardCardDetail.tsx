import { HyperMentionInput } from '@/features/hyper-people/HyperMentionInput';
import { HyperMentionText } from '@/features/hyper-people/HyperMentionText';
import { HyperPeopleTextProperty } from '@/features/hyper-people/HyperPeopleTextProperty';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckSquare, Clock, Copy, Hash, Link, Link2, ListChecks, Paperclip, Tags, Trash2, Type } from 'lucide-react';
import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/reui/badge';
import { hyperBoardOptionColor } from './hyperBoardColors';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import type { HyperDatabaseController } from '../../HyperDatabaseController';
import type { HyperDatabaseState } from '../../HyperDatabaseTypes';
import { hyperBoardTitle } from './hyperBoardModel';

function hyperBoardFieldIcon(type: FieldType) {
  switch (type) {
    case FieldType.SingleSelect: case FieldType.MultiSelect: return Tags;
    case FieldType.DateTime: case FieldType.CreatedTime: case FieldType.LastEditedTime: return CalendarDays;
    case FieldType.Checkbox: return CheckSquare;
    case FieldType.Checklist: return ListChecks;
    case FieldType.Number: return Hash;
    case FieldType.URL: return Link2;
    case FieldType.Relation: return Link;
    case FieldType.Media: return Paperclip;
    case FieldType.Time: return Clock;
    default: return Type;
  }
}
export function HyperBoardCardDetail({ controller, state, rowId, returnFocus, onClose }: { controller: HyperDatabaseController; state: HyperDatabaseState; rowId: string | null; returnFocus: HTMLElement | null; onClose: () => void }) {
  const primary = state.fields.find(field => field.isPrimary);
  const titleCell = rowId && primary ? state.cells[rowId]?.[primary.id] : undefined;
  const titleReady = Boolean(titleCell && !titleCell.error);
  const title = rowId ? hyperBoardTitle(state, rowId) : '';
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const draftRow = useRef(rowId);
  useEffect(() => {
    if (draftRow.current !== rowId) { draftRow.current = rowId; dirty.current = false; }
    if (!dirty.current) setDraft(title);
  }, [rowId, title]);
  useEffect(() => { if (rowId) void controller.loadRows([rowId]).catch(() => toast.error('Could not load card properties')); }, [controller, rowId, state.fields]);
  useEffect(() => { if (rowId && state.status === 'ready' && !state.rows[rowId]) onClose(); }, [rowId, state.rows, state.status, onClose]);
  const saveTitle = async () => {
    if (!dirty.current || !rowId || !primary || !titleReady || busy) return;
    setBusy(true);
    try { await controller.updateCell(rowId, primary.id, { kind: 'text', text: draft }); if (draftRow.current === rowId) dirty.current = false; }
    catch { toast.error('Could not save card title'); }
    finally { setBusy(false); }
  };
  return <Sheet open={Boolean(rowId)} onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent side="right" className="w-[480px] max-w-full sm:max-w-[480px] data-[side=right]:w-[480px] data-[side=right]:sm:max-w-[480px]" finalFocus={() => returnFocus}>
      <SheetHeader className="pr-12"><SheetTitle className="sr-only">Card details</SheetTitle><SheetDescription className="sr-only">Card title and database properties</SheetDescription><HyperMentionInput aria-label="Card title" className="h-10 border-0 px-0 text-xl font-semibold shadow-none focus-visible:ring-0 md:text-xl dark:bg-transparent" placeholder="Untitled" disabled={busy || !titleReady} value={draft} onChange={event => { setDraft(event.target.value); dirty.current = true; }} onBlur={() => void saveTitle()} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); } }} /></SheetHeader>
      <div className="grid grid-cols-[140px_1fr] items-start gap-x-3 gap-y-1 overflow-y-auto px-4 text-sm">
        {state.fields.filter(field => !field.isPrimary).map(field => { const Icon = hyperBoardFieldIcon(field.type); const cell = rowId ? state.cells[rowId]?.[field.id] : undefined; return <div key={field.id} className="contents"><div className="flex min-h-8 items-center gap-2 text-muted-foreground"><Icon className="size-4 shrink-0" /><span className="truncate">{field.name}</span></div><div className="flex min-h-8 flex-wrap items-center gap-1 break-words py-1" title={cell?.error}>{cell ? cell.error ? <span className="text-destructive">{cell.error}</span> : cell.kind === 'text' && rowId ? <HyperPeopleTextProperty controller={controller} rowId={rowId} field={field} value={cell.text} /> : (cell.kind === 'singleSelect' || cell.kind === 'multiSelect') && cell.selected.length ? cell.selected.map(option => <Badge key={option.id} size="sm" className={hyperBoardOptionColor(option.color).badge}>{option.name}</Badge>) : cell.display ? <HyperMentionText value={cell.display} /> : <span className="text-muted-foreground">Empty</span> : <Skeleton className="h-4 w-3/4" />}</div></div>; })}
      </div>
      <SheetFooter className="flex-row border-t border-border"><Button variant="outline" size="sm" disabled={busy} onClick={async () => { if (!rowId) return; setBusy(true); try { await controller.duplicateRow(rowId); toast.success('Card duplicated'); } catch { toast.error('Could not duplicate card'); } finally { setBusy(false); } }}><Copy className="size-4" />Duplicate</Button><Button variant="destructive" size="sm" disabled={busy} onClick={async () => { if (!rowId) return; setBusy(true); try { await controller.deleteRows([rowId]); onClose(); } catch { toast.error('Could not delete card'); } finally { setBusy(false); } }}><Trash2 className="size-4" />Delete</Button></SheetFooter>
    </SheetContent>
  </Sheet>;
}
