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
import { FlowyButton, FlowySvg, FlowyText, Tooltip } from '@/ui';
import { useHomeStore } from '../home/home-store';
import { useSwitchToSpace } from '../home/notifiers';
import { layoutIcon } from '../tabs/plugin';
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
  return (
    <div style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : undefined }}>
      <FlowyButton
        height={30}
        margin={`0 6px 0 ${6 + level * 16}px`}
        onTap={onSelected}
        leftIcon={
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div
              style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', visibility: expandable ? 'visible' : 'hidden' }}
              onClick={(event) => {
                event.stopPropagation();
                onToggle?.();
              }}
            >
              <FlowySvg svg={expanded ? 'view_item_expand_s' : 'view_item_unexpand_s'} size={16} />
            </div>
          </div>
        }
        text={
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {icon ? <RawEmojiIcon icon={icon} size={16} /> : <FlowySvg svg={layoutIcon(view.layout)} size={16} />}
            <div style={{ width: 6, flexShrink: 0 }} />
            <FlowyText.regular ellipsis>{nameOrDefault(view)}</FlowyText.regular>
          </div>
        }
      />
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
    <div style={{ display: 'flex', flexDirection: 'column', height: 321, minHeight: 0 }}>
      <div
        style={{
          height: 30,
          display: 'flex',
          alignItems: 'center',
          border: '1px solid var(--cs-outline)',
          borderRadius: 8,
          padding: '0 8px',
          flexShrink: 0,
        }}
      >
        <FlowySvg svg="search_s" size={16} color="var(--th-hint)" />
        <input
          autoFocus
          value={query}
          placeholder={tr('search.label')}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, marginLeft: 6, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-color)', fontSize: 14 }}
        />
      </div>
      <div style={{ height: 10, flexShrink: 0 }} />
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {results ? (
          results.map((v) => <ViewRow key={v.id} view={v} level={0} onSelected={() => select(v, space)} />)
        ) : (
          <>
            {spaces.map((s) => (
              <Tooltip key={s.id} message={s.id === space?.id ? '' : tr('space.switchSpace')}>
                <div onMouseDown={() => s.id !== space?.id && setSpace(s)}>
                  <FlowyButton
                    height={30}
                    isSelected={s.id === space?.id}
                    onTap={() => s.id === space?.id && select(s, s)}
                    text={<FlowyText.medium ellipsis>{s.name}</FlowyText.medium>}
                  />
                </div>
              </Tooltip>
            ))}
            {space && <PageTree key={space.id} parentId={space.id} level={0} sourceId={sourceView.id} onSelected={(v) => select(v, space)} />}
          </>
        )}
      </div>
    </div>
  );
}
