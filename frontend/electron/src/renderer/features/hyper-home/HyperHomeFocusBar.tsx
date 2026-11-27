// HyperHomeFocusBar (spec D9.4): a collapsible bar above HyperHome's Kanban/Event split with the next
// action and a link to Task Hub. Links appear only once their destination works: the next action and Focus
// in M2, Triage in M3, the next meeting with prep readiness in M4.
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronUp, Circle, CircleCheck, CircleDot, Crosshair, Inbox, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { localToolPlugin } from '@/features/tabs/plugin';
import { tabsActions } from '@/features/tabs/tabs-store';
import { useHyperHubBriefRequest } from '@/features/hyper-task-hub/brief/useHyperHubBriefRequest';
import { hyperHubRelative } from '@/features/hyper-task-hub/HyperTaskHubFormat';
import { hyperOpenTaskHub } from '@/features/hyper-task-hub/HyperTaskHubNavigation';
import { hyperSelectMeetings, hyperSelectToday } from '@/features/hyper-task-hub/state/HyperTaskHubSelectors';
import { useHyperTaskHub } from '@/features/hyper-task-hub/state/useHyperTaskHub';
import { cn } from '@/lib/utils';
import { KeyValueStorage } from '@/startup/kv';

const hyperHomeFocusBarKey = 'hyperHomeFocusBar';
const openTaskHub = () => tabsActions.openPlugin(localToolPlugin('taskhub'));

export function HyperHomeFocusBar() {
  const snapshot = useHyperTaskHub(s => s.snapshot);
  const [collapsed, setCollapsed] = useState(() => KeyValueStorage.get(hyperHomeFocusBarKey) === 'collapsed');
  useEffect(() => { if (!useHyperTaskHub.getState().snapshot) void useHyperTaskHub.getState().load(); }, []);
  const today = useMemo(() => snapshot ? hyperSelectToday(snapshot) : null, [snapshot]);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    void KeyValueStorage.set(hyperHomeFocusBarKey, next ? 'collapsed' : 'open').catch(() => {});
  };
  const recommendation = today?.recommendation;
  const zone = snapshot?.settings.zone;
  const start = recommendation && zone ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(Date.parse(recommendation.start.iso)) : null;
  const ready = !!snapshot?.settings.setupComplete;
  const triageCount = snapshot?.tasks.filter(task => task.state === 'review').length ?? 0;
  // The next verified meeting that has not started yet (spec D9.4, M4).
  const nextMeeting = useMemo(() => {
    if (!snapshot) return null;
    const now = Date.now();
    return hyperSelectMeetings(snapshot, { now: { kind: 'instant', iso: new Date(now).toISOString() } })
      .find(item => Date.parse(item.agendaItem.interval.start.iso) > now) ?? null;
  }, [snapshot]);
  const openBrief = (meetingId: string) => { useHyperHubBriefRequest.getState().open(meetingId); openTaskHub(); };
  const startTask = async () => {
    if (!snapshot || !recommendation) return;
    const result = await useHyperTaskHub.getState().sendFeedback({ type: 'set-state', state: 'doing', targetId: recommendation.task.id, scopeGeneration: snapshot.scopeGeneration, expectedRevision: snapshot.revision });
    if (result.ok) toast('Started'); else toast.error('Could not start the task. Open Task Hub and try again.');
  };

  return <div data-hyper-home-focus-bar className={cn('flex shrink-0 items-center gap-2 border-b px-4 text-sm', collapsed ? 'h-8' : 'h-11')}>
    <Crosshair aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    {collapsed ? <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={openTaskHub}>Task Hub</button>
      : !ready ? <span className="min-w-0 truncate text-muted-foreground">Set up <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={openTaskHub}>Task Hub</button> to see what to do first.</span>
      : recommendation ? <>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">Do first</span>
        <button type="button" dir="auto" className="min-w-0 truncate font-medium hover:underline underline-offset-2" onClick={() => hyperOpenTaskHub('focus')} title={recommendation.task.title}>{recommendation.task.title}</button>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{recommendation.kind === 'start-now' ? 'now' : `from ${start}`}</span>
        {recommendation.task.state !== 'doing' && <Button size="xs" variant="outline" onClick={() => void startTask()}><Play className="size-3.5" />Start</Button>}
      </>
      : <span className="min-w-0 truncate text-muted-foreground">{today?.recommendationReason === 'no-coverage' ? 'Add a free window in Task Hub to plan your day.' : today?.recommendationReason === 'nothing-fits' ? 'Nothing fits in the time left today.' : 'Nothing is ready to start right now.'}</span>}
    <div className="ms-auto flex shrink-0 items-center gap-1">
      {!collapsed && nextMeeting && <Button variant="ghost" size="sm" className="max-w-72 text-muted-foreground" onClick={() => openBrief(nextMeeting.agendaItem.id)}
        title={`Prep for ${nextMeeting.agendaItem.title ?? 'the meeting'}`}>
        {nextMeeting.readiness === 'prepared' ? <CircleCheck className="size-3.5 text-success" /> : nextMeeting.readiness === 'planned' ? <CircleDot className="size-3.5 text-info" /> : <Circle className="size-3.5" />}
        <bdi dir="auto" className="min-w-0 truncate">{nextMeeting.agendaItem.title ?? 'Meeting'}</bdi>
        <span className="shrink-0 tabular-nums">{hyperHubRelative(nextMeeting.agendaItem.interval.start.iso, Date.now())}</span>
      </Button>}
      {!collapsed && triageCount > 0 && <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => hyperOpenTaskHub('board')}><Inbox className="size-3.5" />{triageCount} to triage</Button>}
      {!collapsed && <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={openTaskHub}>Task Hub<ArrowUpRight className="size-3.5" /></Button>}
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={collapsed ? 'Expand the focus bar' : 'Collapse the focus bar'} aria-expanded={!collapsed} onClick={toggle} />}>
          {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </TooltipTrigger>
        <TooltipContent>{collapsed ? 'Expand' : 'Collapse'}</TooltipContent>
      </Tooltip>
    </div>
  </div>;
}
