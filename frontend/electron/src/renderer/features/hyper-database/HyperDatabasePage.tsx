import { useEffect, useState } from 'react';
import type { ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { Plus, MoreHorizontal, Copy, PencilLine, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { HyperLayoutIcon } from '@/features/plugins/PlaceholderPage';
import { useViewPluginNotifier } from '@/features/view-header/view-scope';
import { tabsActions } from '@/features/tabs/tabs-store';
import { showAFTextFieldDialog, showConfirmDeletionDialog } from '@/ui/Dialog';
import type { PluginContext } from '@/features/plugins/registry';
import { useHyperDatabase } from './useHyperDatabase';
import { hyperLayout, hyperCoreLayout } from './HyperDatabaseController';
import type { HyperDatabaseViewProps, HyperLayout } from './HyperDatabaseTypes';
import { HyperGridView } from './views/HyperGridView';
import { HyperBoardView } from './views/HyperBoardView';
import { HyperCalendarView } from './views/HyperCalendarView';
import { HyperGanttView } from './views/HyperGanttView';

const layouts: HyperLayout[] = ['grid', 'board', 'calendar', 'gantt'];
const labels = { grid: 'Grid', board: 'Board', calendar: 'Calendar', gantt: 'Gantt' };
/** Each executor owns its file and any files in its own adjacent subfolder. */
export function HyperDatabaseLayout(props: HyperDatabaseViewProps) {
  switch (hyperLayout(props.view)) {
    case 'board': return <HyperBoardView {...props} />;
    case 'calendar': return <HyperCalendarView {...props} />;
    case 'gantt': return <HyperGanttView {...props} />;
    default: return <HyperGridView {...props} />;
  }
}
export function HyperDatabasePage({ view, context }: { view: ViewPB; context: PluginContext }) {
  const { controller, state } = useHyperDatabase(view.id);
  const notifier = useViewPluginNotifier();
  const current = notifier?.view ?? view;
  const deleted = notifier?.isDeleted;
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  useEffect(() => {
    if (deleted?.oneOfIndex.case === 'index') context.onDeleted?.(current, deleted.oneOfIndex.value);
  }, [deleted, context.onDeleted, current]);
  const run = async (work: () => Promise<unknown>) => {
    setPending(true); setActionError(undefined);
    try { await work(); } catch (error) { setActionError(error instanceof Error ? error.message : error && typeof error === 'object' && 'msg' in error ? String(error.msg) : String(error)); }
    finally { setPending(false); }
  };
  if (state.status === 'idle' || state.status === 'loading') return <div aria-label="Loading database" aria-busy="true" className="flex h-full flex-col gap-4 px-6 py-4"><Skeleton className="h-8 w-80" /><Skeleton className="h-8 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (state.status === 'error') return <Empty className="h-full"><EmptyHeader><EmptyMedia variant="icon"><TriangleAlert className="size-5 text-destructive" /></EmptyMedia><EmptyTitle>Could not open database</EmptyTitle><EmptyDescription>{state.error}</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" onClick={() => void controller.open()}>Try again</Button></EmptyContent></Empty>;
  const views = state.views.length ? state.views : [state.view ?? current];
  return <div data-hyper-database={view.id} data-hyper-views-ready={state.views.some(item => item.id === view.id)} data-hyper-layout={hyperLayout(state.view ?? current)} className="flex h-full min-h-0 flex-col">
    <Tabs value={view.id} onValueChange={id => { const next = views.find(v => v.id === id); if (next) tabsActions.openView(next); }} className="min-h-0 flex-1 gap-0">
      <div className="flex shrink-0 items-center gap-2 border-b px-6">
        <TabsList variant="line" aria-label="Database views" className="min-w-0 justify-start overflow-x-auto rounded-none p-0 group-data-horizontal/tabs:h-11">
          {views.map(tab => <div key={tab.id} className="flex shrink-0 items-center gap-0.5">
            <TabsTrigger value={tab.id} className="h-11 shrink-0 px-2 group-data-horizontal/tabs:after:bottom-0"><HyperLayoutIcon layout={tab.layout} hyperLayout={hyperLayout(tab)} /><span className="max-w-40 truncate">{tab.name || 'Untitled'}</span></TabsTrigger>
            <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" disabled={pending} aria-label={`Actions for ${tab.name || 'Untitled'}`} />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent className="w-44">
              <DropdownMenuItem onClick={() => showAFTextFieldDialog({ title: 'Rename view', initialValue: tab.name, onConfirm: name => void run(() => controller.renameView(tab.id, name)) })}><PencilLine className="size-4" />Rename</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void run(async () => { const copy = await controller.duplicateView(tab); tabsActions.openView(copy); })}><Copy className="size-4" />Duplicate</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => showConfirmDeletionDialog({ name: tab.name || 'Untitled', description: 'Move this view and its child pages to Trash?', onConfirm: () => void run(() => controller.deleteView(tab.id)) })}><Trash2 className="size-4" />Delete</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu>
          </div>)}
        </TabsList>
        <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" disabled={pending} aria-label="Add database view" />}><Plus className="size-4" /></DropdownMenuTrigger><DropdownMenuContent className="w-44">
          {layouts.map(layout => <DropdownMenuItem key={layout} onClick={() => void run(async () => { const added = await controller.addView(layout, labels[layout]); tabsActions.openView(added); })}><HyperLayoutIcon layout={hyperCoreLayout(layout)} hyperLayout={layout} />{labels[layout]}</DropdownMenuItem>)}
        </DropdownMenuContent></DropdownMenu>
      </div>
      {(actionError || state.error) && <p role="alert" className="px-6 py-2 text-sm text-destructive">{actionError || state.error}</p>}
      <TabsContent value={view.id} className="min-h-0 flex-1 overflow-auto">
        {/* Each Hyper view owns its empty state (no rows, no date field, no groups). */}
        <HyperDatabaseLayout controller={controller} state={state} view={state.view ?? current} />
      </TabsContent>
    </Tabs>
  </div>;
}
