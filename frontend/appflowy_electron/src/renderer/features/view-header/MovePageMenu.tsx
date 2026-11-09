import { useEffect, useMemo, useState } from 'react';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import {
  FolderEventGetAllViews,
  FolderEventGetView,
  FolderEventGetViewAncestors,
  FolderEventMoveNestedView,
  FolderEventReadPrivateViews,
  FolderEventReadWorkspaceViews,
  FolderEventUnpublishViews,
} from '@/backend/events';
import { useTr } from '@/i18n';
import { Search, CalendarDays, FileText, MessageSquareText, SquareKanban, Table2 } from 'lucide-react';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { TreeDisclosure, treeIndent, treeRowClass } from '@/components/app/nav';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useHomeStore } from '../home/home-store';
import { useSwitchToSpace } from '../home/notifiers';
import { isSpace, nameOrDefault } from '../view/view-ext';
import { RawEmojiIcon, viewIcon } from './ViewIcon';
import { containPublishedPage } from './view-service';

const isDatabaseLayout = (layout: ViewLayoutPB) =>
  layout === ViewLayoutPB.Grid || layout === ViewLayoutPB.Board || layout === ViewLayoutPB.Calendar;

/** moveViewCrossSpace (menu/view/view_item.dart): unpublish + switch space when it changes, then move. */
export async function moveViewCrossSpace(view: ViewPB, currentSpace: ViewPB | null, toSpace: ViewPB, toId: string) {
  const parent = await FolderEventGetView({ value: view.parentViewId });
  // isReferencedDatabaseView: a database view under a database is a linked view.
  if (parent.ok && isDatabaseLayout(view.layout) && isDatabaseLayout(parent.value.layout)) return;
  if (view.id === toId) return;
  if (currentSpace && currentSpace.id !== toSpace.id) {
    void containPublishedPage(view).then(([, pages]) =>
      Promise.all(pages.map((p) => FolderEventUnpublishViews({ viewIds: [p.id] }))),
    );
    useSwitchToSpace.setState({ space: toSpace });
  }
  await FolderEventMoveNestedView({ viewId: view.id, newParentId: toId });
}

function ViewRow({
  view,
  level,
  disabled,
  expandable,
  expanded,
  onToggle,
  onSelected,
}: {
  view: ViewPB;
  level: number;
  disabled?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onSelected: () => void;
}) {
  const icon = viewIcon(view);
  const Icon = view.layout === ViewLayoutPB.Board ? SquareKanban : view.layout === ViewLayoutPB.Calendar ? CalendarDays : view.layout === ViewLayoutPB.Chat ? MessageSquareText : view.layout === ViewLayoutPB.Document ? FileText : Table2;
  return (
    <div className={cn(treeRowClass, disabled && 'pointer-events-none opacity-50')} style={{ paddingLeft: treeIndent(level) }}>
      <TreeDisclosure expanded={!!expanded} hasChildren={!!expandable} onToggle={() => onToggle?.()} />
      <button type="button" disabled={disabled} onClick={onSelected} className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex size-5 shrink-0 items-center justify-center text-base">
          {icon ? <RawEmojiIcon icon={icon} size={16} /> : <Icon className="size-4 text-muted-foreground" />}
        </span>
        <span className="min-w-0 flex-1 truncate">{nameOrDefault(view)}</span>
      </button>
    </div>
  );
}

function PageTree({ parentId, level, sourceId, onSelected }: { parentId: string; level: number; sourceId: string; onSelected: (v: ViewPB) => void }) {
  const [children, setChildren] = useState<ViewPB[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    void FolderEventGetView({ value: parentId }).then((r) => setChildren(r.ok ? r.value.childViews : []));
  }, [parentId]);
  return (
    <>
      {(children ?? [])
        .filter((v) => v.id !== sourceId)
        .map((v) => (
          <div key={v.id}>
            <ViewRow
              view={v}
              level={level}
              disabled={v.layout !== ViewLayoutPB.Document}
              expandable={v.layout === ViewLayoutPB.Document}
              expanded={expanded[v.id]}
              onToggle={() => setExpanded((e) => ({ ...e, [v.id]: !e[v.id] }))}
              onSelected={() => onSelected(v)}
            />
            {expanded[v.id] && <PageTree parentId={v.id} level={level + 1} sourceId={sourceId} onSelected={onSelected} />}
          </div>
        ))}
    </>
  );
}

/**
 * MovePageMenu (menu/sidebar/move_to/move_page_menu.dart), server workspaces only: a search field,
 * the spaces, and the current space's page tree. Selecting a page or a space moves the view there.
 */
export function MovePageMenu({ sourceView, onSelected }: { sourceView: ViewPB; onSelected: () => void }) {
  const { tr } = useTr();
  const workspaceId = useHomeStore((s) => s.workspaceSetting?.workspaceId ?? '');
  const [spaces, setSpaces] = useState<ViewPB[]>([]);
  const [pageSpace, setPageSpace] = useState<ViewPB | null>(null);
  const [space, setSpace] = useState<ViewPB | null>(null);
  const [query, setQuery] = useState('');
  const [allViews, setAllViews] = useState<ViewPB[]>([]);

  useEffect(() => {
    void Promise.all([FolderEventReadWorkspaceViews({ value: workspaceId }), FolderEventReadPrivateViews({ value: workspaceId })]).then(
      ([pub, priv]) => setSpaces([...(pub.ok ? pub.value.items : []), ...(priv.ok ? priv.value.items : [])].filter((v) => isSpace(v))),
    );
    void FolderEventGetViewAncestors({ value: sourceView.id }).then((r) => {
      const found = r.ok ? (r.value.items.find((v) => isSpace(v)) ?? null) : null;
      setPageSpace(found);
      setSpace(found);
    });
    void FolderEventGetAllViews().then((r) => setAllViews(r.ok ? r.value.items : []));
  }, [workspaceId, sourceView.id]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return allViews.filter((v) => v.id !== sourceView.id && !isSpace(v) && v.name.toLowerCase().includes(q));
  }, [query, allViews, sourceView.id]);

  const select = (target: ViewPB, targetSpace: ViewPB | null) => {
    onSelected();
    if (targetSpace) void moveViewCrossSpace(sourceView, pageSpace, targetSpace, target.id);
  };

  return (
    <div className={`${floatingSurfaceClass} flex w-72 min-h-0 flex-col p-0`}>
      <InputGroup className="h-9 shrink-0 rounded-none border-0 border-b bg-transparent dark:bg-transparent">
        <InputGroupAddon><Search className="size-4" /></InputGroupAddon>
        <InputGroupInput autoFocus value={query} placeholder={tr('search.label')} onChange={(e) => setQuery(e.target.value)} className="h-9" />
      </InputGroup>
      <div className="max-h-80 min-h-0 overflow-y-auto p-1">
        {results ? (
          results.map((v) => <ViewRow key={v.id} view={v} level={0} onSelected={() => select(v, space)} />)
        ) : (
          <>
            {spaces.map((s) => (
              <Tooltip key={s.id}>
                <TooltipTrigger render={<div />}>
                  <div onMouseDown={() => s.id !== space?.id && setSpace(s)}>
                    <button type="button" data-selected={s.id === space?.id ? 'true' : undefined}
                      className={cn(treeRowClass, 'px-1.5 font-medium')}
                      onClick={() => s.id === space?.id && select(s, s)}>
                      <span className="truncate">{s.name}</span>
                    </button>
                  </div>
                </TooltipTrigger>
                <TooltipContent>{s.id === space?.id ? '' : tr('space.switchSpace')}</TooltipContent>
              </Tooltip>
            ))}
            {space && <PageTree key={space.id} parentId={space.id} level={0} sourceId={sourceView.id} onSelected={(v) => select(v, space)} />}
          </>
        )}
      </div>
    </div>
  );
}
