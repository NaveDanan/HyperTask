// Meeting brief sheet (spec D8, D9.3): one 440px right sheet, the same occurrence from every entry point.
// Deterministic and cited; every item says why it matched and when. The optional AI summary is a separate,
// explicit action over excerpts the owner selects, labelled "AI summary" (D8.6).
import { useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, Circle, CircleCheck, CircleDot, Eye, ListPlus, Sparkles, SquareArrowOutUpRight, TriangleAlert, Users, Video } from 'lucide-react';
import type { HyperMeetingBrief, HyperMeetingBriefItem, HyperMeetingReadiness } from '@shared/HyperMeetingBrief';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { hyperHubRelative } from '../HyperTaskHubFormat';
import { useHyperHubReasonLocale } from '../HyperWhyPopover';
import { hyperFormatBriefReason } from '../state/HyperTaskHubReasons';

export type HyperMeetingBriefState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; brief: HyperMeetingBrief };

export interface HyperMeetingSummaryState {
  status: 'idle' | 'running' | 'done' | 'failed';
  text?: string;
  citations?: readonly string[];
  error?: string;
}

export interface HyperMeetingBriefSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: HyperMeetingBriefState;
  zone: string;
  nowMs: number;
  /** Opens a cited source through main's typed open path. */
  onOpenEvidence: (evidenceId: string) => void;
  onMarkPrepared?: () => void;
  onAddPrepTask?: () => void;
  onBlockBefore?: () => void;
  /** Present only when the owner consented to AI summaries and an endpoint is configured. */
  onSummarize?: (evidenceIds: string[]) => void;
  summary?: HyperMeetingSummaryState;
}

const hyperReadinessView: Record<HyperMeetingReadiness, { label: string; icon: ReactNode; variant: 'success-light' | 'info-light' | 'secondary' }> = {
  prepared: { label: 'Prepared', icon: <CircleCheck className="size-3" />, variant: 'success-light' },
  planned: { label: 'Prep planned', icon: <CircleDot className="size-3" />, variant: 'info-light' },
  none: { label: 'Not prepared', icon: <Circle className="size-3" />, variant: 'secondary' },
};

export function HyperReadinessBadge({ readiness }: { readiness: HyperMeetingReadiness }) {
  const view = hyperReadinessView[readiness];
  return <Badge variant={view.variant} size="sm" className="gap-1">{view.icon}{view.label}</Badge>;
}

function HyperBriefSection({ title, count, children, empty }: { title: string; count: number; children: ReactNode; empty?: string }) {
  if (!count && !empty) return null;
  return <section className="flex flex-col gap-2">
    <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">{title}{count > 0 && <Badge variant="outline" size="sm" className="rounded-full tabular-nums">{count}</Badge>}</h3>
    {count ? <ul className="flex flex-col divide-y rounded-lg border">{children}</ul> : <p className="text-xs text-muted-foreground">{empty}</p>}
  </section>;
}

function HyperBriefRow({ item, nowMs, onOpen, selecting, selected, onSelect, extra }: {
  item: HyperMeetingBriefItem; nowMs: number; onOpen: (id: string) => void;
  selecting: boolean; selected: boolean; onSelect: (id: string, on: boolean) => void; extra?: ReactNode;
}) {
  const locale = useHyperHubReasonLocale();
  const selectable = selecting && !!item.excerpt;
  return <li className="flex gap-2 px-3 py-2">
    {selecting && <Checkbox className="mt-0.5" disabled={!selectable} checked={selectable && selected} onCheckedChange={value => onSelect(item.id, !!value)} aria-label={`Include "${item.subject}" in the summary`} />}
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-start gap-2">
        <p dir="auto" className="min-w-0 flex-1 text-sm font-medium">{item.subject}</p>
        <Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground" aria-label={`Open ${item.subject}`} onClick={() => onOpen(item.id)}><SquareArrowOutUpRight className="size-3.5" /></Button>
      </div>
      {item.excerpt && <p dir="auto" className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.excerpt}</p>}
      {extra}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {item.manual && <Badge variant="primary-light" size="sm">Linked by you</Badge>}
        {item.reasons.filter(reason => reason.code !== 'accepted-meeting' && reason.code !== 'owner-organized').map((reason, index) =>
          <Badge key={index} variant="outline" size="sm" className="font-normal text-muted-foreground">{hyperFormatBriefReason(reason, locale)}</Badge>)}
        <span className="text-2xs text-muted-foreground">{hyperHubRelative(item.sourceTime.iso, nowMs)}</span>
        {item.stale && <Badge variant="warning-light" size="sm">Not refreshed</Badge>}
      </div>
    </div>
  </li>;
}

type HyperEligibleBrief = Extract<HyperMeetingBrief, { eligible: true }>;

/** The brief's cited sections in D8.3 order. Empty sections are hidden; documents say so explicitly. */
export function HyperMeetingBriefSections({ brief, row }: { brief: HyperEligibleBrief; row: (item: HyperMeetingBriefItem, extra?: ReactNode) => ReactNode }) {
  return <>
    <HyperBriefSection title="My open actions" count={brief.openActions.length}>{brief.openActions.map(item => row(item))}</HyperBriefSection>
    <HyperBriefSection title="Decisions due" count={brief.decisionsDue.length}>{brief.decisionsDue.map(item => row(item))}</HyperBriefSection>
    <HyperBriefSection title="Blockers" count={brief.blockers.length}>{brief.blockers.map(item => row(item))}</HyperBriefSection>
    <HyperBriefSection title="Related issues" count={brief.relatedIssues.length}>{brief.relatedIssues.map(item => row(item))}</HyperBriefSection>
    <HyperBriefSection title="Open with attendees" count={brief.openWithAttendees.length}>{brief.openWithAttendees.map(item => row(item))}</HyperBriefSection>
    <HyperBriefSection title="Recent threads" count={brief.threads.length}>{brief.threads.map(thread => row(thread.messages[0],
      <>{thread.messages.length > 1 && <p className="mt-0.5 text-2xs text-muted-foreground">+{thread.messages.length - 1} more in this thread</p>}
        {thread.messages[0].attachmentNames?.length ? <p className="mt-0.5 truncate text-2xs text-muted-foreground">Attachments: {thread.messages[0].attachmentNames.join(', ')}</p> : null}</>))}</HyperBriefSection>
    <HyperBriefSection title="Last time" count={brief.priorDecisions.length}>{brief.priorDecisions.map(item => row(item))}</HyperBriefSection>
    <HyperBriefSection title="Linked documents" count={brief.linkedDocuments.length} empty="No linked documents.">{brief.linkedDocuments.map(item => row(item))}</HyperBriefSection>
  </>;
}

/** A plain renderer for a brief row, used by the sheet and by tests. */
export function HyperMeetingBriefRow(props: { item: HyperMeetingBriefItem; nowMs: number; extra?: ReactNode }) {
  return <HyperBriefRow item={props.item} nowMs={props.nowMs} onOpen={() => {}} selecting={false} selected={false} onSelect={() => {}} extra={props.extra} />;
}

function HyperBriefLoading() {
  return <div aria-busy="true" className="flex flex-col gap-3 px-4">{[0, 1, 2, 3].map(id => <Skeleton key={id} className="h-16 w-full" />)}</div>;
}

export function HyperMeetingBriefSheet({ open, onOpenChange, state, zone, nowMs, onOpenEvidence, onMarkPrepared, onAddPrepTask, onBlockBefore, onSummarize, summary }: HyperMeetingBriefSheetProps) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const brief = state.status === 'ready' && state.brief.eligible ? state.brief : null;
  const excerptIds = useMemo(() => brief ? [
    ...brief.openActions, ...brief.decisionsDue, ...brief.relatedIssues, ...brief.blockers, ...brief.openWithAttendees,
    ...brief.threads.flatMap(thread => thread.messages), ...brief.priorDecisions, ...brief.linkedDocuments,
  ].filter(item => item.excerpt).map(item => item.id) : [], [brief]);
  const select = (id: string, on: boolean) => setSelected(previous => { const next = new Set(previous); if (on) next.add(id); else next.delete(id); return next; });
  const startSelecting = () => { setSelected(new Set(excerptIds)); setSelecting(true); };
  const row = (item: HyperMeetingBriefItem, extra?: ReactNode) => <HyperBriefRow key={item.id} item={item} nowMs={nowMs} onOpen={onOpenEvidence} selecting={selecting} selected={selected.has(item.id)} onSelect={select} extra={extra} />;

  const timeLabel = brief && (() => {
    const start = Date.parse(brief.meeting.interval.start.iso), end = Date.parse(brief.meeting.interval.end.iso);
    const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone }).format(start);
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: zone });
    return `${day} · ${time.format(start)}–${time.format(end)} · ${hyperHubRelative(brief.meeting.interval.start.iso, nowMs)}`;
  })();

  return <Sheet open={open} onOpenChange={next => { if (!next) setSelecting(false); onOpenChange(next); }}>
    <SheetContent side="right" data-hyper-meeting-brief className="max-w-full data-[side=right]:w-[440px] data-[side=right]:sm:max-w-[440px]">
      <SheetHeader>
        <SheetTitle dir="auto">{brief ? brief.meeting.subject : 'Meeting brief'}</SheetTitle>
        <SheetDescription>{brief ? timeLabel : state.status === 'loading' ? 'Gathering related work…' : 'Meeting brief'}</SheetDescription>
        {brief && <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <HyperReadinessBadge readiness={brief.readiness} />
          {brief.viewed && <Badge variant="outline" size="sm" className="gap-1 font-normal text-muted-foreground"><Eye className="size-3" />Viewed</Badge>}
          {brief.meeting.stale && <Badge variant="warning-light" size="sm">Calendar not refreshed</Badge>}
          {brief.meeting.joinUrl && /^https?:\/\//i.test(brief.meeting.joinUrl) && <Button size="xs" variant="outline" className="ms-auto" onClick={() => window.open(brief.meeting.joinUrl, '_blank', 'noopener,noreferrer')}><Video className="size-3.5" />Join</Button>}
        </div>}
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-2">
        {state.status === 'loading' ? <HyperBriefLoading />
          : state.status === 'error' ? <Alert variant="destructive"><TriangleAlert className="size-4" /><AlertTitle>Brief unavailable</AlertTitle><AlertDescription>{state.error}</AlertDescription></Alert>
          : !brief ? <p className="text-sm text-muted-foreground">No brief for this meeting. Briefs cover meetings you accepted or organize; private, declined and cancelled meetings are left out.</p>
          : <>
            {(brief.meeting.organizer || brief.meeting.attendees.length > 0) && <section className="flex flex-col gap-1.5">
              <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Users className="size-3.5" />People</h3>
              <p className="text-sm">
                {brief.meeting.organizer && <><bdi className="font-medium">{brief.meeting.organizer.name}</bdi> <span className="text-xs text-muted-foreground">(organizer)</span>{brief.meeting.attendees.length ? ', ' : ''}</>}
                {brief.meeting.attendees.map((person, index) => <span key={(person.verifiedIdentityId ?? person.name) + index}><bdi>{person.name}</bdi>{index < brief.meeting.attendees.length - 1 ? ', ' : ''}</span>)}
              </p>
            </section>}
            {summary && summary.status !== 'idle' && <section aria-live="polite" className="rounded-lg border bg-muted/30 p-3">
              <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Sparkles className="size-3.5" />AI summary</h3>
              {summary.status === 'running' ? <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />Summarizing selected excerpts…</p>
                : summary.status === 'failed' ? <p className="mt-2 text-sm text-muted-foreground">{summary.error ?? 'The summary failed. The brief below is unchanged.'}</p>
                : <p dir="auto" className="mt-2 whitespace-pre-wrap text-sm">{summary.text}</p>}
            </section>}
            <HyperMeetingBriefSections brief={brief} row={row} />
          </>}
      </div>
      {brief && <SheetFooter className="flex-col gap-2 border-t sm:flex-col">
        {selecting
          ? <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">{selected.size} excerpt{selected.size === 1 ? '' : 's'} will be sent to your AI endpoint, as data only.</span>
            <Button size="sm" variant="ghost" onClick={() => setSelecting(false)}>Cancel</Button>
            <Button size="sm" disabled={!selected.size} onClick={() => { onSummarize?.([...selected]); setSelecting(false); }}><Sparkles className="size-4" />Summarize</Button>
          </div>
          : <div className="flex flex-wrap items-center gap-2">
            {onMarkPrepared && brief.readiness !== 'prepared' && <Button size="sm" variant="outline" onClick={onMarkPrepared}><CircleCheck className="size-4" />Mark prepared</Button>}
            {onAddPrepTask && <Button size="sm" variant="ghost" onClick={onAddPrepTask}><ListPlus className="size-4" />Add prep task</Button>}
            {onBlockBefore && <Button size="sm" variant="ghost" onClick={onBlockBefore}><CalendarClock className="size-4" />Block 15 min before</Button>}
            {onSummarize && excerptIds.length > 0 && <Button size="sm" variant="ghost" className={cn('ms-auto')} disabled={summary?.status === 'running'} onClick={startSelecting}><Sparkles className="size-4" />Summarize…</Button>}
          </div>}
      </SheetFooter>}
    </SheetContent>
  </Sheet>;
}
