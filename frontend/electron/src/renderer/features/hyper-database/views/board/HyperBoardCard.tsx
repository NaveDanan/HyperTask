import { HyperMentionText } from '@/features/hyper-people/HyperMentionText';
import { HyperPeopleDisplay } from '@/features/hyper-people/HyperPeoplePicker';
import { hyperIsPeopleField } from '@/features/hyper-people/HyperPeopleProperty';
import { hyperMentionText } from '@/features/hyper-people/hyperMentions';
import { useEffect, useRef } from 'react';
import type { HyperDatabaseController } from '../../HyperDatabaseController';
import { CalendarDays, Link, Link2, ListChecks, Paperclip } from 'lucide-react';
import { KanbanItem, KanbanItemHandle } from '@/components/reui/kanban';
import { Badge } from '@/components/reui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { HyperCell, HyperDatabaseState, HyperField } from '../../HyperDatabaseTypes';
import { hyperBoardOptionColor } from './hyperBoardColors';

interface HyperBoardCardProps {
  controller?: HyperDatabaseController;
  state: HyperDatabaseState;
  rowId: string;
  fields: HyperField[];
  groupFieldId?: string;
  overlay?: boolean;
  columnOverlay?: boolean;
  dragging?: boolean;
  disabled?: boolean;
  onOpen?: (rowId: string, element: HTMLElement) => void;
}
function hyperBoardUrl(url: string) {
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed : null; }
  catch { return null; }
}
function HyperBoardMeta({ cell }: { cell: HyperCell }) {
  if (!cell.display && cell.kind !== 'checklist' && cell.kind !== 'media' && cell.kind !== 'relation') return null;
  const iconClass = 'size-3.5 shrink-0';
  if (cell.kind === 'date' || cell.kind === 'createdTime' || cell.kind === 'lastEditedTime') {
    const overdue = cell.kind === 'date' && cell.timestamp !== null && Number(cell.endTimestamp ?? cell.timestamp) * 1000 < new Date().setHours(0, 0, 0, 0);
    return <span className={cn('flex min-w-0 items-center gap-1 tabular-nums', overdue && 'text-destructive')}><CalendarDays className={iconClass} /><span className="truncate">{cell.display}</span></span>;
  }
  if (cell.kind === 'checklist') return cell.items.length ? <span className="flex items-center gap-1 tabular-nums"><ListChecks className={iconClass} />{cell.items.filter(item => item.completed).length}/{cell.items.length}</span> : null;
  if (cell.kind === 'url') {
    const url = hyperBoardUrl(cell.url);
    return url ? <a href={url.href} tabIndex={-1} className="flex max-w-32 items-center gap-1 hover:text-foreground" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onClick={event => { event.preventDefault(); event.stopPropagation(); window.open(url.href, '_blank', 'noopener,noreferrer'); }}><Link2 className={iconClass} /><span className="truncate">{url.hostname}</span></a> : <span className="truncate">{cell.display}</span>;
  }
  if (cell.kind === 'media') return cell.files.length ? <span className="flex items-center gap-1"><Paperclip className={iconClass} />{cell.files.length}</span> : null;
  if (cell.kind === 'relation') return cell.rowIds.length ? <span className="flex items-center gap-1"><Link className={iconClass} />{cell.rowIds.length}</span> : null;
  return <HyperMentionText className="max-w-32 truncate" value={cell.display} />;
}
export function HyperBoardCard({ controller, state, rowId, fields, groupFieldId, overlay = false, columnOverlay = false, dragging = false, disabled, onOpen }: HyperBoardCardProps) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!controller || overlay || !node.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        void controller.loadRows([rowId], fields.map(field => field.id));
        observer.disconnect();
      }
    }, { rootMargin: '100px' });
    observer.observe(node.current);
    return () => observer.disconnect();
  }, [controller, rowId, fields, overlay]);
  const primary = state.fields.find(field => field.isPrimary);
  const title = primary ? state.cells[rowId]?.[primary.id] : undefined;
  const cells = fields.filter(field => !field.isPrimary && field.id !== groupFieldId).flatMap(field => {
    const cell = state.cells[rowId]?.[field.id];
    return cell ? [{ field, cell }] : [];
  });
  const badges = cells.flatMap(({ field, cell }) => cell.kind === 'singleSelect' || cell.kind === 'multiSelect' ? cell.selected.map(option => ({ key: `${field.id}:${option.id}`, option })) : []);
  const metadata = cells.filter(({ cell }) => cell.kind !== 'singleSelect' && cell.kind !== 'multiSelect' && (cell.display || cell.kind === 'media' && cell.files.length || cell.kind === 'relation' && cell.rowIds.length || cell.kind === 'checklist' && cell.items.length));
  const checklist = cells.find(({ cell }) => cell.kind === 'checklist' && cell.items.length)?.cell;
  const className = cn(
    'rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    dragging ? 'border-dashed border-muted-foreground/40 bg-transparent shadow-none hover:bg-transparent' : 'border-border bg-card shadow-xs hover:bg-accent/50',
    overlay && !columnOverlay && 'w-68 rotate-2 cursor-grabbing shadow-lg ring-1 ring-foreground/10',
  );
  const content = <div className={cn("flex flex-col gap-2", dragging && "opacity-40")}>
    <div className={cn('text-sm font-medium line-clamp-2', title && !title.display && 'text-muted-foreground')}>
      {state.rows[rowId]?.icon ? <span className="mr-1 text-sm">{state.rows[rowId].icon}</span> : null}
      {title ? <HyperMentionText value={title.display || 'Untitled'} /> : <Skeleton className="h-4 w-3/4" />}
    </div>
    {badges.length ? <div className="flex flex-wrap gap-1">{badges.slice(0, 3).map(({ key, option }) => <Badge key={key} size="sm" className={hyperBoardOptionColor(option.color).badge}>{option.name}</Badge>)}{badges.length > 3 ? <Badge variant="secondary" size="sm">+{badges.length - 3}</Badge> : null}</div> : null}
    {metadata.length ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">{metadata.map(({ field, cell }) => <span key={field.id} className="min-w-0 max-w-48">{hyperIsPeopleField(field.proto) && cell.kind === 'text' ? <HyperPeopleDisplay value={cell.text} /> : <HyperBoardMeta cell={cell} />}</span>)}</div> : null}
    {checklist?.kind === 'checklist' ? <Progress aria-label="Checklist progress" className="h-1.5 [&_[data-slot=progress-track]]:h-1.5" value={Math.min(100, Math.max(0, checklist.progress * 100))} /> : null}
  </div>;
  if (overlay) return <div className={className}>{content}</div>;
  return <KanbanItem value={rowId} disabled={disabled} role="presentation" tabIndex={-1} className={cn('shrink-0', dragging && 'opacity-100!')}>
    <KanbanItemHandle ref={node} role="button" tabIndex={0} aria-label={hyperMentionText(title?.display || 'Untitled card')} aria-roledescription="draggable card" className={className}
      onClick={event => onOpen?.(rowId, event.currentTarget)}
      onKeyDownCapture={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onOpen?.(rowId, event.currentTarget); } }}>
      {content}
    </KanbanItemHandle>
  </KanbanItem>;
}
