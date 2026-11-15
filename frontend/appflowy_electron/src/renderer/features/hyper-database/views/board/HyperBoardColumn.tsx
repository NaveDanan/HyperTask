import { useRef, useState } from 'react';
import { EyeOff, GripVertical, MoreHorizontal, PencilLine, Plus, Trash2 } from 'lucide-react';
import { KanbanColumn, KanbanColumnContent, KanbanColumnHandle } from '@/components/reui/kanban';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { HyperDatabaseController } from '../../HyperDatabaseController';
import type { HyperDatabaseState, HyperField, HyperGroup } from '../../HyperDatabaseTypes';
import { HyperBoardCard } from './HyperBoardCard';
import { hyperBoardCreateOptions, hyperBoardGroupName } from './hyperBoardModel';
import { hyperBoardGroupDot } from './hyperBoardColors';

interface HyperBoardColumnProps {
  controller: HyperDatabaseController; state: HyperDatabaseState; group: HyperGroup; rowIds: string[];
  fields: HyperField[]; groupField: HyperField; search: boolean; over?: boolean; overlay?: boolean; busy?: boolean; draggedRowId?: string | null;
  addPosition?: 'top' | 'bottom'; onAdd: (position?: 'top' | 'bottom') => void;
  onOpen: (rowId: string, element: HTMLElement) => void;
}
function HyperBoardInlineCard({ controller, groupId, top, onCancel }: { controller: HyperDatabaseController; groupId: string; top: boolean; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try { await controller.createRow(hyperBoardCreateOptions(controller.state, groupId, title.trim(), top)); setTitle(''); }
    catch { toast.error('Could not add card'); }
    finally { setSaving(false); requestAnimationFrame(() => input.current?.focus()); }
  };
  return <div className="shrink-0 rounded-lg border border-border bg-card p-2 shadow-xs" data-hyper-board-inline-add="true"><Input ref={input} autoFocus aria-label="New card title" placeholder="Enter a title…" value={title} disabled={saving} onChange={event => setTitle(event.target.value)} onBlur={() => { if (!title.trim() && !saving) onCancel(); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }} /><p className="px-1 pt-2 text-2xs text-muted-foreground">Enter to add · Esc to cancel</p></div>;
}
export function HyperBoardColumn({ controller, state, group, rowIds, fields, groupField, search, over, overlay = false, busy, draggedRowId, addPosition, onAdd, onOpen }: HyperBoardColumnProps) {
  const checkbox = groupField.type === FieldType.Checkbox;
  const name = hyperBoardGroupName(group, checkbox);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [deleting, setDeleting] = useState(false);
  const [mutating, setMutating] = useState(false);
  const cancelledRename = useRef(false);
  const canRename = !checkbox && !group.isDefault;
  const allowed = new Set(state.rowIds);
  const total = group.rows.filter(row => allowed.has(row.id)).length;
  const rename = () => { setDraft(name); cancelledRename.current = false; setRenaming(true); };
  const saveName = async () => {
    setRenaming(false);
    if (cancelledRename.current || !draft.trim() || draft.trim() === name) return;
    try { await controller.renameGroup(group.groupId, draft.trim()); }
    catch { toast.error('Could not rename group'); }
  };
  const header = <><span className={cn('size-2 shrink-0 rounded-full', hyperBoardGroupDot(group, checkbox))} />
    {renaming ? <Input autoFocus aria-label="Group name" className="h-7 min-w-0 flex-1" value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => void saveName()} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur(); if (event.key === 'Escape') { cancelledRename.current = true; setRenaming(false); } }} /> : <span className="min-w-0 truncate text-sm font-semibold" onDoubleClick={canRename && !overlay ? rename : undefined}>{name}</span>}
    <Badge variant="outline" size="sm" className="shrink-0 rounded-full tabular-nums">{search ? `${rowIds.length}/${total}` : total}</Badge></>;
  if (overlay) return <div className="w-72 rounded-lg bg-muted p-2 shadow-lg ring-1 ring-foreground/10"><div className="mb-2 flex h-8 items-center gap-2">{header}</div><div className="flex flex-col gap-2">{rowIds.slice(0, 3).map(rowId => <HyperBoardCard key={rowId} controller={controller} state={state} rowId={rowId} fields={fields} groupFieldId={groupField.id} overlay columnOverlay />)}</div></div>;
  return <>
    <KanbanColumn value={group.groupId} className={cn('h-full w-72 shrink-0 max-h-full min-h-0 rounded-lg bg-muted/50 dark:bg-muted/30', over && 'ring-1 ring-ring/40 bg-muted dark:bg-muted')} aria-label={`${name} group`}>
      <div className="flex h-10 shrink-0 items-center gap-2 px-2">{header}
        <div className="ml-auto flex shrink-0 items-center opacity-0 [[data-slot=kanban-column]:hover_&]:opacity-100 has-focus-visible:opacity-100">
          <KanbanColumnHandle className={group.isDefault || busy ? 'opacity-50!' : 'opacity-100!'} render={<Button variant="ghost" size="icon-xs" disabled={group.isDefault || busy} aria-label={`Move ${name} group`} />}><GripVertical className="size-3.5" /></KanbanColumnHandle>
          <Button variant="ghost" size="icon-xs" aria-label={`Add card to ${name}`} disabled={busy} onClick={() => onAdd('top')}><Plus className="size-3.5" /></Button>
          <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`${name} group actions`} />}><MoreHorizontal className="size-3.5" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56"><DropdownMenuItem disabled={!canRename} onClick={rename}><PencilLine className="size-4" />Rename</DropdownMenuItem><DropdownMenuItem onClick={() => { void controller.hideGroup(group.groupId).catch(() => toast.error('Could not hide group')); }}><EyeOff className="size-4" />Hide</DropdownMenuItem>{!checkbox && !group.isDefault ? <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}><Trash2 className="size-4" />Delete group</DropdownMenuItem></> : null}</DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <KanbanColumnContent value={group.groupId} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 pt-0.5">
        {addPosition === 'top' ? <HyperBoardInlineCard controller={controller} groupId={group.groupId} top onCancel={() => onAdd()} /> : null}
        {rowIds.map(rowId => <HyperBoardCard key={rowId} controller={controller} state={state} rowId={rowId} fields={fields} groupFieldId={groupField.id} onOpen={onOpen} disabled={busy} dragging={draggedRowId === rowId} />)}
        {!rowIds.length ? <div className={cn('grid h-16 shrink-0 place-items-center rounded-md border border-dashed border-border text-xs text-muted-foreground', over && 'border-ring/40')} data-hyper-board-empty-group="true">No cards</div> : null}
        {addPosition === 'bottom' ? <HyperBoardInlineCard controller={controller} groupId={group.groupId} top={false} onCancel={() => onAdd()} /> : null}
      </KanbanColumnContent>
      <Button variant="ghost" size="sm" className="mx-2 mb-2 shrink-0 justify-start text-muted-foreground" onClick={() => onAdd('bottom')} disabled={busy}><Plus className="size-4" />New</Button>
    </KanbanColumn>
    <AlertDialog open={deleting} onOpenChange={setDeleting}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete “{name}” group?</AlertDialogTitle><AlertDialogDescription>Cards are kept in the database. Their status will be cleared when this option is deleted.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={mutating}>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" disabled={mutating} onClick={async () => { setMutating(true); try { await controller.deleteGroup(group.groupId); setDeleting(false); } catch { toast.error('Could not delete group'); } finally { setMutating(false); } }}>Delete group</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
