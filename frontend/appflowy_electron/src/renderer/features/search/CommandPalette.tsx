import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ResultIconTypePB, type ResultIconPB, type SearchSummaryPB } from '@shared/protobuf/flowy-search/result_pb';
import { ViewIconTypePB } from '@shared/protobuf/flowy-folder/icon_pb';
import { FolderEventGetView } from '@/backend/events';
import { tr, useTr } from '@/i18n';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { useAppearanceStore, useBrightness } from '@/theme/appearance-store';
import { FlowySvg, Spinner, Tooltip, showDialog, showToast } from '@/ui';
import { useHomeStore } from '../home/home-store';
import { toggleCommandPalette } from '../home/notifiers';
import { layoutIcon } from '../tabs/plugin';
import { tabsActions } from '../tabs/tabs-store';
import { nameOrDefault } from '../view/view-ext';
import { useCurrentWorkspace } from '../view-header/current-workspace';
import { formatDate } from '../view-header/date-format';
import { RawEmojiIcon, viewIcon } from '../view-header/ViewIcon';
import { openTrash } from '../view-header/ViewTitleBar';
import {
  clearSearch,
  refreshCachedViews,
  searchChanged,
  useCommandPaletteStore,
  workspaceChanged,
  type SearchResultItem,
} from './command-palette-store';
import { recentViews, resetRecentViews, useRecentViewsStore } from './recent-views-store';
import { onelinePath, useViewAncestors } from './view-ancestor-cache';
import './command-palette.css';

// AppFlowyTheme text styles (definition/text_style/base/default_text_style.dart).
const text = (size: number, lineHeight: number, weight: number, color: string, extra?: CSSProperties): CSSProperties => ({
  fontSize: `calc(${size}px * var(--text-scale, 1))`,
  lineHeight: `${lineHeight}px`,
  fontWeight: weight,
  color,
  ...extra,
});
const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };

/** NavigationBlocExtension.navigateTo → ActionNavigationBloc → TabsBloc.openPlugin(view). */
async function navigateTo(viewId: string) {
  const result = await FolderEventGetView({ value: viewId });
  if (!result.ok) {
    showToast({ message: tr('search.pageNotExist'), type: 'error' });
    return;
  }
  tabsActions.openView(result.value);
}

/** SearchIconExtension.buildIcon on ViewPB. */
function ViewSearchIcon({ view }: { view: ViewPB }) {
  const icon = viewIcon(view);
  if (icon) {
    return (
      <span style={{ width: 16, display: 'flex', justifyContent: 'center' }}>
        <RawEmojiIcon icon={icon} size={16} lineHeight={20 / 16} />
      </span>
    );
  }
  return <FlowySvg svg={layoutIcon(view.layout)} size={18} color="var(--af-icon-secondary)" />;
}

const RESULT_LAYOUT_ICONS: Record<string, FlowySvgName> = {
  '0': 'icon_document_s',
  '1': 'icon_grid_s',
  '2': 'icon_board_s',
  '3': 'icon_calendar_s',
  '4': 'chat_ai_page_s',
};

/** SearchIconItemExtension.buildIcon on ResultIconPB (search_result_ext.dart). */
function ResultIcon({ icon }: { icon?: ResultIconPB }) {
  if (!icon) return null;
  if (icon.ty === ResultIconTypePB.Emoji) {
    if (!icon.value) return null;
    return (
      <span style={{ width: 16, display: 'flex', justifyContent: 'center' }}>
        <RawEmojiIcon icon={{ ty: ViewIconTypePB.Emoji, value: icon.value }} size={16} lineHeight={20 / 16} />
      </span>
    );
  }
  const layout = RESULT_LAYOUT_ICONS[icon.value];
  if (layout) return <FlowySvg svg={layout} size={18} color="var(--af-icon-secondary)" />;
  return (
    <RawEmojiIcon
      icon={{ ty: icon.ty === ResultIconTypePB.Icon ? ViewIconTypePB.Icon : ViewIconTypePB.Url, value: icon.value }}
      size={18}
    />
  );
}

/** buildHighLightSpan: case-insensitive matches of the query get the theme-select background. */
function Highlighted({ content, query, highlightColor }: { content: string; query?: string | null; highlightColor?: string }) {
  const q = (query ?? '').trim();
  if (!q) return <>{content}</>;
  const parts: ReactNode[] = [];
  const lower = content.toLowerCase();
  const needle = q.toLowerCase();
  let index = 0;
  let key = 0;
  while (index < content.length) {
    const found = lower.indexOf(needle, index);
    if (found < 0) {
      parts.push(content.slice(index));
      break;
    }
    if (found > index) parts.push(content.slice(index, found));
    parts.push(
      <span key={key++} style={{ background: 'var(--af-fill-theme-select)', color: highlightColor }}>
        {content.slice(found, found + q.length)}
      </span>,
    );
    index = found + q.length;
  }
  return <>{parts}</>;
}

/** buildOnelinePath with its "-" separator. */
function OnelinePath({ viewId }: { viewId: string }) {
  const { ancestors } = useViewAncestors(viewId);
  if (ancestors.length === 0) return null;
  const caption = text(12, 18, 400, 'var(--af-text-tertiary)', { letterSpacing: 0.1 });
  return (
    <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flexShrink: 1 }}>
      <div style={{ width: 8, flexShrink: 0 }} />
      <span style={{ ...caption, color: 'var(--af-border-primary-hover)' }}>-</span>
      <div style={{ width: 8, flexShrink: 0 }} />
      <span style={{ ...caption, ...ellipsis }}>{onelinePath(ancestors)}</span>
    </div>
  );
}

/** Arrow keys move between cells (Flutter's directional focus traversal); Enter opens. */
function cellKeyDown(event: KeyboardEvent<HTMLDivElement>, onEnter: () => void) {
  if (event.key === 'Enter') {
    event.preventDefault();
    onEnter();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const cells = [...(event.currentTarget.closest('.command-palette')?.querySelectorAll<HTMLElement>('[data-search-cell]') ?? [])];
    const index = cells.indexOf(event.currentTarget);
    const next = cells[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus();
    else if (event.key === 'ArrowUp') event.currentTarget.closest('.command-palette')?.querySelector<HTMLInputElement>('input')?.focus();
  }
}

function SearchCell({
  selected,
  onHover,
  onSelect,
  children,
}: {
  selected: boolean;
  onHover: () => void;
  onSelect: () => void;
  children: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      data-search-cell
      tabIndex={0}
      onFocus={onHover}
      onMouseEnter={() => {
        setHover(true);
        onHover();
      }}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
      onKeyDown={(event) => cellKeyDown(event, onSelect)}
      style={{
        borderRadius: 8,
        padding: 12,
        cursor: 'pointer',
        outline: 'none',
        background: hover || selected ? 'var(--af-fill-content-hover)' : 'transparent',
        ['--text-color' as string]: 'var(--afx-text)',
      }}
    >
      {children}
    </div>
  );
}

// ---- SearchField (widgets/search_field.dart) ------------------------------------------------

function SearchField({ query }: { query: string | null }) {
  const { tr } = useTr();
  const workspace = useCurrentWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(query ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const hasText = value.trim() !== '';
  return (
    <div style={{ height: 44, marginBottom: 8, flexShrink: 0 }}>
      <div
        style={{
          height: 44,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          borderRadius: 12,
          border: `1px solid ${focused ? 'var(--af-border-theme-thick)' : 'var(--af-border-primary)'}`,
        }}
      >
        <div style={{ padding: '0 8px 0 12px', display: 'flex' }}>
          <FlowySvg svg="search_icon_m" size={20} color="var(--af-icon-secondary)" />
        </div>
        <input
          ref={inputRef}
          value={value}
          placeholder={tr('search.searchFieldHint', { args: [workspace?.name ?? ''] })}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setValue(event.target.value);
            searchChanged(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              event.currentTarget.closest('.command-palette')?.querySelector<HTMLElement>('[data-search-cell]')?.focus();
            }
          }}
          className="command-palette-input"
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            padding: '11px 0',
            ...text(16, 22, 400, 'var(--af-text-primary)'),
          }}
        />
        {hasText && (
          <div style={{ padding: '0 12px 0 8px', display: 'flex' }}>
            <Tooltip message={tr('commandPalette.clearSearchTooltip')}>
              <div
                style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                onClick={() => {
                  setValue('');
                  clearSearch();
                  inputRef.current?.focus();
                }}
              >
                <FlowySvg svg="search_clear_m" size={20} color="var(--af-icon-tertiary)" />
              </div>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- PagePreview (widgets/page_preview.dart) --------------------------------------------------

function PreviewTime({ title, time }: { title: string; time: bigint }) {
  const dateTime = useAppearanceStore((s) => s.dateTime);
  return (
    <>
      <div style={{ height: 12 }} />
      <div style={text(12, 18, 400, 'var(--af-text-primary)')}>{title}</div>
      <div style={text(12, 18, 400, 'var(--af-text-secondary)')}>
        {formatDate(new Date(Number(time) * 1000), dateTime.dateFormat, true, dateTime.timeFormat)}
      </div>
    </>
  );
}

function PreviewPath({ viewId }: { viewId: string }) {
  const { tr } = useTr();
  const { ancestors, isLoading } = useViewAncestors(viewId);
  if (!isLoading && ancestors.length === 0) return null;
  return (
    <>
      <div style={{ height: 20 }} />
      <div style={text(12, 18, 400, 'var(--af-text-primary)')}>{tr('commandPalette.location')}</div>
      <div style={{ ...text(12, 18, 400, 'var(--af-text-secondary)'), minHeight: 18, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {isLoading ? '' : ancestors.map((a) => a.name).join(' / ')}
      </div>
    </>
  );
}

/** PagePreview: the hovered page's title, location and dates (covers come with the document milestone). */
function PagePreview({ view, onViewOpened }: { view: ViewPB; onViewOpened: () => void }) {
  const { tr } = useTr();
  const light = useBrightness() === 'light';
  const [hover, setHover] = useState(false);
  const icon = viewIcon(view);
  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        alignSelf: 'stretch',
        margin: '4px 0 16px',
        borderRadius: 12,
        background: light ? '#F8FAFF' : 'var(--af-surface-layer02)',
        position: 'relative',
        overflowY: 'auto',
      }}
    >
      <div style={{ height: 80 }} />
      <div style={{ height: 24 }} />
      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column' }}>
        <div
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={onViewOpened}
          style={{ cursor: 'pointer', ...text(16, 22, 500, 'var(--af-text-primary)'), textDecoration: hover ? 'underline' : 'none' }}
        >
          <span style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>
            {nameOrDefault(view)}
            <Tooltip message={tr('settings.files.open')}>
              <span style={{ display: 'inline-flex', verticalAlign: 'middle', paddingLeft: 4 }}>
                <FlowySvg svg="search_open_tab_m" size={20} color="var(--af-icon-secondary)" />
              </span>
            </Tooltip>
          </span>
        </div>
        <PreviewPath viewId={view.id} />
        <PreviewTime title={tr('commandPalette.created')} time={view.createTime} />
        {view.lastEdited !== view.createTime && <PreviewTime title={tr('commandPalette.edited')} time={view.lastEdited} />}
      </div>
      <div style={{ position: 'absolute', top: 70, left: 20, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icon ? <RawEmojiIcon icon={icon} size={16} lineHeight={20 / 16} /> : <FlowySvg svg={layoutIcon(view.layout)} size={20} color="var(--af-icon-secondary)" />}
      </div>
    </div>
  );
}

function SomethingWentWrong() {
  const { tr } = useTr();
  return (
    <div style={{ width: 300, flexShrink: 0, display: 'flex', alignSelf: 'stretch' }}>
      <div style={{ width: 1, background: 'var(--af-border-primary)' }} />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 100 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <FlowySvg svg="something_wrong_warning_m" size={24} color="var(--af-icon-secondary)" />
          <div style={{ height: 8 }} />
          <div style={{ ...text(14, 20, 500, 'var(--af-text-secondary)'), ...ellipsis }}>{tr('search.somethingWentWrong')}</div>
          <div style={{ height: 4 }} />
          <div style={{ ...text(12, 18, 400, 'var(--af-text-secondary)'), ...ellipsis }}>{tr('search.tryAgainOrLater')}</div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '6px 8px', ...text(14, 19.25, 500, 'var(--af-text-secondary)', { letterSpacing: 0.2 }) }}>{children}</div>
  );
}

// ---- RecentViewsList (widgets/recent_views_list.dart) ---------------------------------------

function RecentViewsList({ hidePreview, onSelected }: { hidePreview: boolean; onSelected: () => void }) {
  const { tr } = useTr();
  const views = useRecentViewsStore((s) => s.views);
  const [hovered, setHovered] = useState<ViewPB | null>(null);
  useEffect(() => {
    void recentViews();
  }, []);
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return views.flatMap((v) => (v.item && !seen.has(v.item.id) && seen.add(v.item.id) ? [v.item] : []));
  }, [views]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingRight: hidePreview ? 0 : 12 }}>
        <SectionTitle>{tr('sideBar.recent')}</SectionTitle>
        {recent.map((view) => (
          <SearchCell
            key={view.id}
            selected={hovered?.id === view.id}
            onHover={() => setHovered(view)}
            onSelect={() => {
              onSelected();
              void navigateTo(view.id);
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <ViewSearchIcon view={view} />
              </div>
              <div style={{ width: 8, flexShrink: 0 }} />
              <div style={{ maxWidth: !hidePreview && hovered ? 480 : 680, ...text(14, 22, 500, 'var(--af-text-primary)'), ...ellipsis }}>
                {nameOrDefault(view)}
              </div>
              <OnelinePath viewId={view.id} />
            </div>
          </SearchCell>
        ))}
        <div style={{ height: 16 }} />
      </div>
      {!hidePreview && hovered && (
        <PagePreview
          key={hovered.id}
          view={hovered}
          onViewOpened={() => {
            void navigateTo(hovered.id);
            onSelected();
          }}
        />
      )}
    </div>
  );
}

// ---- SearchResultList (widgets/search_results_list.dart, search_result_cell.dart) -----------

function SearchResultList({
  cachedViews,
  resultItems,
  query,
  hidePreview,
  onSelected,
}: {
  cachedViews: Map<string, ViewPB>;
  resultItems: SearchResultItem[];
  resultSummaries: SearchSummaryPB[];
  query: string | null;
  hidePreview: boolean;
  onSelected: () => void;
}) {
  const { tr } = useTr();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Results whose view is not in the cached views are dropped (stale index entries).
  const items = cachedViews.size > 0 ? resultItems.filter((item) => cachedViews.has(item.id)) : resultItems;
  const open = (id: string) => {
    onSelected();
    void navigateTo(id);
  };
  const hoveredView = hoveredId ? cachedViews.get(hoveredId) : undefined;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', overflowY: 'auto', paddingRight: hidePreview ? 0 : 12 }}>
        {resultItems.length > 0 && (
          <>
            <SectionTitle>{tr('commandPalette.bestMatches')}</SectionTitle>
            {items.map((item) => {
              const view = cachedViews.get(item.id);
              const title = item.displayName || tr('menuAppHeader.defaultNewPageName');
              return (
                <SearchCell key={item.id} selected={hoveredId === item.id} onHover={() => setHoveredId(item.id)} onSelect={() => open(item.id)}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {view ? <ViewSearchIcon view={view} /> : <ResultIcon icon={item.icon} />}
                      </div>
                      <div style={{ width: 8, flexShrink: 0 }} />
                      <div style={{ maxWidth: !hidePreview && hoveredId ? 480 : 680, ...text(14, 22, 500, 'var(--af-text-primary)'), ...ellipsis }}>
                        <Highlighted content={title} query={query} />
                      </div>
                      <OnelinePath viewId={item.id} />
                    </div>
                    {item.content !== '' && (
                      <>
                        <div style={{ height: 4 }} />
                        <div
                          style={{
                            paddingLeft: 28,
                            ...text(12, 18, 400, 'var(--af-text-secondary)', { letterSpacing: 0.1 }),
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          <Highlighted content={item.content} query={query} highlightColor="var(--af-text-primary)" />
                        </div>
                      </>
                    )}
                  </div>
                </SearchCell>
              );
            })}
            <div style={{ height: 16 }} />
          </>
        )}
      </div>
      {!hidePreview && hoveredId && (hoveredView ? <PagePreview key={hoveredView.id} view={hoveredView} onViewOpened={() => open(hoveredView.id)} /> : <SomethingWentWrong />)}
    </div>
  );
}

/** NoSearchResultsHint: with a link to the Trash. */
function NoSearchResultsHint({ onClose }: { onClose: () => void }) {
  const { tr } = useTr();
  const caption = text(12, 18, 400, 'var(--af-text-secondary)');
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <FlowySvg svg="m_home_search_icon_m" size={24} color="var(--af-icon-secondary)" />
        <div style={{ height: 8 }} />
        <div style={{ ...text(14, 20, 500, 'var(--af-text-secondary)'), ...ellipsis }}>{tr('search.noResultForSearching')}</div>
        <div style={{ height: 4 }} />
        <div style={{ ...caption, textAlign: 'center', whiteSpace: 'pre-wrap' }}>
          {tr('search.noResultForSearchingHintWithoutTrash')}
          <span
            style={{ textDecoration: 'underline', cursor: 'pointer' }}
            onClick={() => {
              onClose();
              openTrash();
            }}
          >
            {tr('trash.text')}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---- CommandPaletteModal (command_palette.dart) ----------------------------------------------

function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

function CommandPaletteModal({ close }: { close: () => void }) {
  const state = useStore(useCommandPaletteStore);
  const { width: windowWidth } = useWindowSize();
  // FlowyDialog: 70% of the window, constrained to 572..960 × 640, top-aligned 100px down.
  const width = Math.min(960, Math.max(572, windowWidth * 0.7));
  const hidePreview = width - 32 < 884;
  const noQuery = !state.query;
  const hasResult = state.combinedResponseItems.size > 0;
  const searching = state.searching;

  return (
    <div
      className="command-palette"
      style={{
        alignSelf: 'flex-start',
        marginTop: 100,
        width,
        maxWidth: 'calc(100vw - 80px)',
        height: 640,
        maxHeight: 'calc(100vh - 124px)',
        borderRadius: 16,
        background: 'var(--af-surface-layer01)',
        boxShadow: '0 11px 15px -7px #00000033, 0 24px 38px 3px #00000024, 0 9px 46px 8px #0000001F',
        overflow: 'hidden',
        padding: '16px 16px 0',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <SearchField query={state.query} />
      {noQuery && <RecentViewsList hidePreview={hidePreview} onSelected={close} />}
      {hasResult && !noQuery ? (
        <SearchResultList
          cachedViews={state.cachedViews}
          resultItems={[...state.combinedResponseItems.values()]}
          resultSummaries={state.resultSummaries}
          query={state.query}
          hidePreview={hidePreview}
          onSelected={close}
        />
      ) : (
        !noQuery && !searching && <NoSearchResultsHint onClose={close} />
      )}
      {!noQuery && searching && !hasResult && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner />
        </div>
      )}
    </div>
  );
}

/** CommandPalette (workspace/presentation/command_palette/command_palette.dart): Mod+P toggles it. */
export function CommandPaletteHost() {
  const closeRef = useRef<(() => void) | null>(null);
  const workspaceId = useHomeStore((s) => s.workspaceSetting?.workspaceId);

  useEffect(
    () =>
      toggleCommandPalette.on(() => {
        if (closeRef.current) {
          closeRef.current();
          return;
        }
        void refreshCachedViews();
        closeRef.current = showDialog((close) => <CommandPaletteModal close={close} />, {
          onClosed: () => {
            closeRef.current = null;
          },
        });
      }),
    [],
  );

  // CommandPaletteEvent.workspaceChanged and CachedRecentService.reset() on a workspace switch.
  const previousWorkspace = useRef(workspaceId);
  useEffect(() => {
    if (previousWorkspace.current && workspaceId && previousWorkspace.current !== workspaceId) {
      workspaceChanged();
      resetRecentViews();
    }
    previousWorkspace.current = workspaceId;
  }, [workspaceId]);

  useEffect(() => () => closeRef.current?.(), []);
  return null;
}
