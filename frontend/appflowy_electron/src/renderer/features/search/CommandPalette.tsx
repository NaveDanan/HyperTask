import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useStore } from 'zustand';
import {
  CalendarDays,
  FileText,
  MessageSquareText,
  Search,
  SearchX,
  SquareArrowOutUpRight,
  SquareKanban,
  Table2,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ResultIconTypePB, type ResultIconPB, type SearchSummaryPB } from '@shared/protobuf/flowy-search/result_pb';
import { ViewIconTypePB } from '@shared/protobuf/flowy-folder/icon_pb';
import { FolderEventGetView } from '@/backend/events';
import { tr, useTr } from '@/i18n';
import { useAppearanceStore } from '@/theme/appearance-store';
import { showDialog, showToast } from '@/ui';
import { ShortcutKeys } from '@/components/app/shortcut';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useHomeStore } from '../home/home-store';
import { toggleCommandPalette } from '../home/notifiers';
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

/** NavigationBlocExtension.navigateTo → ActionNavigationBloc → TabsBloc.openPlugin(view). */
async function navigateTo(viewId: string) {
  const result = await FolderEventGetView({ value: viewId });
  if (!result.ok) {
    showToast({ message: tr('search.pageNotExist'), type: 'error' });
    return;
  }
  tabsActions.openView(result.value);
}

const RESULT_LAYOUT_ICONS: Record<string, LucideIcon> = {
  [ViewLayoutPB.Document]: FileText,
  [ViewLayoutPB.Grid]: Table2,
  [ViewLayoutPB.Board]: SquareKanban,
  [ViewLayoutPB.Calendar]: CalendarDays,
  [ViewLayoutPB.Chat]: MessageSquareText,
};

/** SearchIconExtension.buildIcon on ViewPB. */
function ViewSearchIcon({ view }: { view: ViewPB }) {
  const icon = viewIcon(view);
  if (icon) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center">
        <RawEmojiIcon icon={icon} size={16} lineHeight={20 / 16} />
      </span>
    );
  }
  const Icon = RESULT_LAYOUT_ICONS[String(view.layout)] ?? FileText;
  return <Icon className="size-4 text-muted-foreground" />;
}

/** SearchIconItemExtension.buildIcon on ResultIconPB (search_result_ext.dart). */
function ResultIcon({ icon }: { icon?: ResultIconPB }) {
  if (!icon) return null;
  if (icon.ty === ResultIconTypePB.Emoji) {
    if (!icon.value) return null;
    return (
      <span className="flex size-4 shrink-0 items-center justify-center">
        <RawEmojiIcon icon={{ ty: ViewIconTypePB.Emoji, value: icon.value }} size={16} lineHeight={20 / 16} />
      </span>
    );
  }
  const Icon = RESULT_LAYOUT_ICONS[icon.value];
  if (Icon) return <Icon className="size-4 text-muted-foreground" />;
  return (
    <RawEmojiIcon
      icon={{ ty: icon.ty === ResultIconTypePB.Icon ? ViewIconTypePB.Icon : ViewIconTypePB.Url, value: icon.value }}
      size={18}
    />
  );
}

/** buildHighLightSpan: case-insensitive matches of the query. */
function Highlighted({ content, query }: { content: string; query?: string | null }) {
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
      <mark key={key++} className="rounded-sm bg-transparent font-semibold text-foreground underline decoration-primary/40 underline-offset-2">
        {content.slice(found, found + q.length)}
      </mark>,
    );
    index = found + q.length;
  }
  return <>{parts}</>;
}

/** buildOnelinePath with its "-" separator. */
function OnelinePath({ viewId }: { viewId: string }) {
  const { ancestors } = useViewAncestors(viewId);
  if (ancestors.length === 0) return null;
  return (
    <span className="ml-auto max-w-[45%] min-w-0 truncate text-xs text-muted-foreground">
      <span className="mr-2">-</span>
      {onelinePath(ancestors)}
    </span>
  );
}

/** Arrow keys move between cells (Flutter's directional focus traversal); Enter opens. */
function cellKeyDown(event: KeyboardEvent<HTMLButtonElement>, onEnter: () => void) {
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
  const { tr } = useTr();
  return (
    <div
      className={cn(
        'group/result relative rounded-md transition-colors hover:bg-accent hover:text-accent-foreground',
        (hover || selected) && 'bg-accent text-accent-foreground',
      )}
      onMouseEnter={() => {
        setHover(true);
        onHover();
      }}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        data-search-cell
        tabIndex={0}
        onFocus={onHover}
        onClick={onSelect}
        onKeyDown={(event) => cellKeyDown(event, onSelect)}
        className="flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md py-0 pr-9 pl-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </button>
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon-xs" />}
          tabIndex={-1}
          aria-label={tr('settings.files.open')}
          onClick={onSelect}
          className={cn(
            'absolute top-1.5 right-1 text-muted-foreground opacity-0 group-hover/result:opacity-100 group-focus-within/result:opacity-100',
            selected && 'opacity-100',
          )}
        >
          <SquareArrowOutUpRight className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{tr('settings.files.open')}</TooltipContent>
      </Tooltip>
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
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b px-4" data-focused={focused || undefined}>
      <Search className="size-4 shrink-0 text-muted-foreground" />
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
        className="h-full min-w-0 flex-1 select-text border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {hasText && (
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-xs" />}
            aria-label={tr('commandPalette.clearSearchTooltip')}
            onClick={() => {
              setValue('');
              clearSearch();
              inputRef.current?.focus();
            }}
          >
            <X className="size-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>{tr('commandPalette.clearSearchTooltip')}</TooltipContent>
        </Tooltip>
      )}
      <Kbd>Esc</Kbd>
    </div>
  );
}

// ---- PagePreview (widgets/page_preview.dart) --------------------------------------------------

function PreviewTime({ title, time }: { title: string; time: bigint }) {
  const dateTime = useAppearanceStore((s) => s.dateTime);
  return (
    <dl className="flex flex-col gap-1 text-xs">
      <dt>{title}</dt>
      <dd className="text-muted-foreground">
        {formatDate(new Date(Number(time) * 1000), dateTime.dateFormat, true, dateTime.timeFormat)}
      </dd>
    </dl>
  );
}

function PreviewPath({ viewId }: { viewId: string }) {
  const { tr } = useTr();
  const { ancestors, isLoading } = useViewAncestors(viewId);
  if (!isLoading && ancestors.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div>{tr('commandPalette.location')}</div>
      <div className="min-h-4 line-clamp-2 text-muted-foreground">
        {isLoading ? '' : ancestors.map((a) => a.name).join(' / ')}
      </div>
    </div>
  );
}

/** PagePreview: the hovered page's title, location and dates (covers come with the document milestone). */
function PagePreview({ view, onViewOpened }: { view: ViewPB; onViewOpened: () => void }) {
  const { tr } = useTr();
  const [hover, setHover] = useState(false);
  const icon = viewIcon(view);
  const Icon = RESULT_LAYOUT_ICONS[String(view.layout)] ?? FileText;
  return (
    <div data-search-preview className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l bg-muted/30 p-4 md:flex">
      <div className="flex size-8 items-center justify-center text-3xl text-muted-foreground">
        {icon ? <RawEmojiIcon icon={icon} size={16} lineHeight={20 / 16} /> : <Icon className="size-4" />}
      </div>
      <button
        type="button"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={onViewOpened}
        className={cn('text-left text-base font-semibold outline-none underline-offset-2 focus-visible:underline', hover && 'underline')}
      >
        <span className="line-clamp-3 wrap-anywhere">
          {nameOrDefault(view)}
          <Tooltip>
            <TooltipTrigger render={<span />} tabIndex={-1} className="inline-flex pl-1 align-middle">
              <SquareArrowOutUpRight className="size-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>{tr('settings.files.open')}</TooltipContent>
          </Tooltip>
        </span>
      </button>
      <PreviewPath viewId={view.id} />
      <PreviewTime title={tr('commandPalette.created')} time={view.createTime} />
      {view.lastEdited !== view.createTime && <PreviewTime title={tr('commandPalette.edited')} time={view.lastEdited} />}
    </div>
  );
}

function SomethingWentWrong() {
  const { tr } = useTr();
  return (
    <div data-search-preview className="hidden w-72 shrink-0 overflow-y-auto border-l bg-muted/30 p-4 md:flex">
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert className="size-5 text-muted-foreground" />
          </EmptyMedia>
          <EmptyTitle>{tr('search.somethingWentWrong')}</EmptyTitle>
          <EmptyDescription className="text-xs">{tr('search.tryAgainOrLater')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{children}</div>;
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
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto p-2">
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
            <span className="flex size-4 shrink-0 items-center justify-center">
              <ViewSearchIcon view={view} />
            </span>
            <span className="min-w-0 truncate font-medium">{nameOrDefault(view)}</span>
            <OnelinePath viewId={view.id} />
          </SearchCell>
        ))}
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
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto p-2">
        {resultItems.length > 0 && (
          <>
            <SectionTitle>{tr('commandPalette.bestMatches')}</SectionTitle>
            {items.map((item) => {
              const view = cachedViews.get(item.id);
              const title = item.displayName || tr('menuAppHeader.defaultNewPageName');
              return (
                <SearchCell key={item.id} selected={hoveredId === item.id} onHover={() => setHoveredId(item.id)} onSelect={() => open(item.id)}>
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {view ? <ViewSearchIcon view={view} /> : <ResultIcon icon={item.icon} />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col justify-center">
                    <span className="truncate font-medium leading-tight">
                      <Highlighted content={title} query={query} />
                    </span>
                    {item.content !== '' && (
                      <span className="truncate text-xs leading-tight text-muted-foreground">
                        <Highlighted content={item.content} query={query} />
                      </span>
                    )}
                  </span>
                  <OnelinePath viewId={item.id} />
                </SearchCell>
              );
            })}
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
  return (
    <Empty className="min-h-40 py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX className="size-5 text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>{tr('search.noResultForSearching')}</EmptyTitle>
        <EmptyDescription className="whitespace-pre-wrap text-xs">
          {tr('search.noResultForSearchingHintWithoutTrash')}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground focus-visible:outline-ring"
            onClick={() => {
              onClose();
              openTrash();
            }}
          >
            {tr('trash.text')}
          </button>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
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
  // Preserve the existing viewport threshold for enabling hover previews.
  const width = Math.min(960, Math.max(572, windowWidth * 0.7));
  const hidePreview = width - 32 < 884;
  const noQuery = !state.query;
  const hasResult = state.combinedResponseItems.size > 0;
  const searching = state.searching;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px] animate-in fade-in-0"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="command-palette fixed top-[12vh] left-1/2 z-50 flex max-h-[min(36rem,76vh)] w-[min(40rem,calc(100vw-3rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95 duration-100 md:has-data-[search-preview]:w-[min(56rem,calc(100vw-3rem))]"
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
          <div className="flex min-h-40 flex-1 items-center justify-center py-10">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        )}
        <footer className="flex h-9 shrink-0 items-center gap-4 border-t bg-muted/30 px-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><ShortcutKeys keys="↑" /><ShortcutKeys keys="↓" /><span className="ml-1">Navigate</span></span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd>Open</span>
          <span className="flex items-center gap-1"><Kbd>Esc</Kbd>Close</span>
        </footer>
      </div>
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
          barrierColor: 'transparent',
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
