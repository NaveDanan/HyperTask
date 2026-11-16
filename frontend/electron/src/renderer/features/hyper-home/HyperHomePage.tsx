import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowUpRight, CalendarDays, SquareKanban, TriangleAlert } from 'lucide-react';
import type { ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { sidebarSpace } from '@/features/sidebar/stores/space-store';
import { tabsActions } from '@/features/tabs/tabs-store';
import { ensureHyperGeneralCalendar } from '@/features/hyper-outlook/HyperGeneralCalendar';
import { HyperDatabaseLayout } from '@/features/hyper-database/HyperDatabasePage';
import { useHyperDatabase } from '@/features/hyper-database/useHyperDatabase';
import { cn } from '@/lib/utils';
import { KeyValueStorage } from '@/startup/kv';
import { ensureHyperGeneralKanban } from './HyperGeneralKanban';

type HyperHomeSource = { status: 'loading' } | { status: 'ready'; view: ViewPB } | { status: 'error'; error: string };
const hyperHomeError = (error: unknown) => error instanceof Error ? error.message : String(error);

const hyperHomeSplitKey = 'hyperHomeSplit';
const hyperHomeMinPx = 120, hyperHomeHitPx = 8; // each section keeps at least 120px; the handle is an 8px hit area around a 1px line
const hyperHomeStep = 0.02;
export const hyperHomeSplitDefault = 0.5;

/** Clamps the Hyper-Kanban share of the height so both sections keep their minimum. A container too short for both falls back to 50/50. */
export function clampHyperHomeSplit(split: number, height: number): number {
  const edge = (hyperHomeMinPx + hyperHomeHitPx / 2) / height;
  if (!(edge <= 0.5)) return hyperHomeSplitDefault;
  return Number.isFinite(split) ? Math.min(1 - edge, Math.max(edge, split)) : hyperHomeSplitDefault;
}

/** Accepts only a stored fraction strictly between 0 and 1; anything else reads as 50/50. */
export function readHyperHomeSplit(raw: string | null): number {
  const value = Number(raw);
  return value > 0 && value < 1 ? value : hyperHomeSplitDefault;
}

/** Hyper-Kanban's flex-basis: the handle centre sits at `split` of the height, and the CSS clamp keeps the minimums even before a drag. */
export const hyperHomeTopBasis = (split: number) => `clamp(${hyperHomeMinPx}px, calc(${split * 100}% - ${hyperHomeHitPx / 2}px), calc(100% - ${hyperHomeMinPx + hyperHomeHitPx}px))`;

/** Resolves the workspace's view once the sidebar space is ready, and again after a workspace switch. */
function useHyperHomeSource(ensure: (workspaceId: string) => Promise<ViewPB>, attempt: number): HyperHomeSource {
  const [source, setSource] = useState<HyperHomeSource>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false, started: string | undefined;
    const run = () => {
      const space = sidebarSpace.store.getState(), workspaceId = sidebarSpace.actions.workspaceId;
      if (!space.isInitialized || !workspaceId || started === workspaceId) return;
      started = workspaceId; setSource({ status: 'loading' });
      ensure(workspaceId).then(view => { if (!cancelled) setSource({ status: 'ready', view }); }, error => { if (!cancelled) setSource({ status: 'error', error: hyperHomeError(error) }); });
    };
    const stop = sidebarSpace.store.subscribe(run); run();
    return () => { cancelled = true; stop(); };
  }, [ensure, attempt]);
  return source;
}

function HyperHomeLoading() {
  return <div aria-busy="true" className="flex h-full flex-col gap-3 p-4"><Skeleton className="h-8 w-64" /><Skeleton className="min-h-0 w-full flex-1" /></div>;
}

function HyperHomeFailed({ title, error, onRetry }: { title: string; error: string; onRetry: () => void }) {
  return <Empty className="h-full"><EmptyHeader><EmptyMedia variant="icon"><TriangleAlert className="size-5 text-destructive" /></EmptyMedia><EmptyTitle>{title} could not be loaded</EmptyTitle><EmptyDescription>{error}</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" onClick={onRetry}>Try again</Button></EmptyContent></Empty>;
}

function HyperHomeDatabase({ title, view }: { title: string; view: ViewPB }) {
  const { controller, state } = useHyperDatabase(view.id);
  if (state.status === 'idle' || state.status === 'loading') return <HyperHomeLoading />;
  if (state.status === 'error') return <HyperHomeFailed title={title} error={state.error ?? 'The database did not open.'} onRetry={() => void controller.open()} />;
  return <HyperDatabaseLayout controller={controller} state={state} view={state.view ?? view} />;
}

function HyperHomeSection({ title, icon, ensure, style }: { title: string; icon: ReactNode; ensure: (workspaceId: string) => Promise<ViewPB>; style?: CSSProperties }) {
  const [attempt, setAttempt] = useState(0);
  const source = useHyperHomeSource(ensure, attempt);
  const retry = () => setAttempt(value => value + 1);
  return <section aria-label={title} style={style} className="flex min-h-0 flex-1 basis-0 flex-col">
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
      <span className="text-muted-foreground [&>svg]:size-4">{icon}</span>
      <h2 className="truncate text-sm font-medium">{title}</h2>
      {source.status === 'ready' && <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" aria-label={`Open ${title} in a new tab`} onClick={() => tabsActions.openViewInNewTab(source.view)}>Open<ArrowUpRight className="size-3.5" /></Button>}
    </header>
    <div className="min-h-0 flex-1">
      {source.status === 'loading' ? <HyperHomeLoading /> : source.status === 'error' ? <HyperHomeFailed title={title} error={source.error} onRetry={retry} /> : <HyperHomeDatabase key={source.view.id} title={title} view={source.view} />}
    </div>
  </section>;
}

/** HyperHome: the startup page. The workspace Hyper-Kanban fills the top, Hyper-Event the bottom; a row-resize handle between them sets the split. */
export function HyperHomePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(() => readHyperHomeSplit(KeyValueStorage.get(hyperHomeSplitKey)));
  const [dragging, setDragging] = useState(false);
  const latest = useRef(split);
  const box = () => containerRef.current?.getBoundingClientRect() ?? new DOMRect();
  const apply = (fraction: number, height = box().height) => { latest.current = clampHyperHomeSplit(fraction, height); setSplit(latest.current); };
  // A failed write only loses this preference; the split still applies for the session.
  const persist = () => { void KeyValueStorage.set(hyperHomeSplitKey, String(latest.current)).catch(() => {}); };
  const grab = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); document.body.style.userSelect = 'none';
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const { top, height } = box(); apply((event.clientY - top) / height, height);
  };
  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); document.body.style.userSelect = ''; persist();
  };

  return <div ref={containerRef} data-hyper-home className="flex h-full min-h-0 flex-col bg-background">
    <HyperHomeSection title="Hyper-Kanban" icon={<SquareKanban />} ensure={ensureHyperGeneralKanban} style={{ flex: `0 0 ${hyperHomeTopBasis(split)}` }} />
    <div
      role="separator" aria-orientation="horizontal" aria-label="Resize Hyper-Kanban and Hyper-Event" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split * 100)} tabIndex={0}
      onPointerDown={grab} onPointerMove={move} onPointerUp={release} onPointerCancel={release}
      onDoubleClick={() => { apply(hyperHomeSplitDefault); persist(); }}
      onKeyDown={event => {
        const delta = event.key === 'ArrowUp' ? -hyperHomeStep : event.key === 'ArrowDown' ? hyperHomeStep : 0;
        if (!delta) return;
        event.preventDefault(); apply(latest.current + delta); persist();
      }}
      className="group flex h-2 shrink-0 cursor-row-resize touch-none items-center outline-none"
    >
      <div className={cn('h-px w-full bg-border transition-colors', dragging ? 'bg-ring' : 'group-hover:bg-ring/60 group-focus-visible:bg-ring')} />
    </div>
    <HyperHomeSection title="Hyper-Event" icon={<CalendarDays />} ensure={ensureHyperGeneralCalendar} />
  </div>;
}
