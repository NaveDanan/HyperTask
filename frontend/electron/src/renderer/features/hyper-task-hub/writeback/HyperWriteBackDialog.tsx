// Write-back review dialog (M5 E1.10). Renders main's preview of one status change: target, account,
// version, the allowed choices and their side effects. Its primary button only *requests* approval; main
// then shows its own native confirmation, which is the only thing that authorizes the send (E1.4).
// Presentational: useHyperWriteBackFlow owns the calls and the result handling.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChartGantt, CircleAlert, Info, SquareArrowOutUpRight, SquareCheckBig } from 'lucide-react';
import type { HyperHubStatusCandidate, HyperHubStatusCategory, HyperHubStatusEffect, HyperHubStatusPreview, HyperHubStatusUnavailable, HyperHubWriteSource } from '@shared/HyperTaskHub';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { hyperHubStatusName, hyperHubVersionText } from '../HyperTaskHubFormat';

export const hyperWriteSourceName: Record<HyperHubWriteSource, string> = { jira: 'Jira', newsletter: 'Newsletter' };

const hyperCategoryBadge: Record<HyperHubStatusCategory, { variant: 'secondary' | 'info-light' | 'success-light' | 'outline'; label: string }> = {
  new: { variant: 'secondary', label: 'To do' },
  indeterminate: { variant: 'info-light', label: 'In progress' },
  done: { variant: 'success-light', label: 'Done' },
  unknown: { variant: 'outline', label: 'Unknown' },
};

export function HyperStatusLozenge({ name, category, source, className }: { name: string; category: HyperHubStatusCategory; source?: HyperHubWriteSource; className?: string }) {
  return <Badge variant={hyperCategoryBadge[category].variant} size="sm" className={cn('max-w-48', className)} title={hyperCategoryBadge[category].label}>
    <bdi className="truncate leading-normal">{source ? hyperHubStatusName(source, name) : name}</bdi>
  </Badge>;
}

/** Plain sentences for each side effect (E1.4); the native confirmation repeats them. */
export function hyperWriteEffectText(effect: HyperHubStatusEffect): string {
  switch (effect.code) {
    case 'progress-set': return `Completion sets progress to 100%${effect.from === null ? '' : ` (now ${effect.from}%)`}. Undo restores the status and leaves progress at 100%.`;
    case 'progress-kept': return `Progress stays at ${effect.value}%.`;
    case 'parent-rollup': return 'Parent tasks in this chart can recompute their status and progress.';
    case 'chart-normalized': return 'Newsletter also normalizes and reschedules the chart.';
    case 'resolution-set': return `Resolution: ${effect.valueName}.`;
    case 'any-status-transition': return 'Jira can apply this from any status, even if the issue changes before it arrives.';
    case 'workflow-effects': return 'Jira workflow rules can change other fields as part of this step.';
  }
}

function hyperUnavailableText(row: HyperHubStatusUnavailable, source: string): string {
  if (row.reason === 'self') return 'Keeps the current status.';
  if (row.reason === 'metadata') return `${source} did not describe this step fully. Finish it in ${source}.`;
  return `Needs ${row.fields?.length ? row.fields.join(', ') : 'fields'} that Task Hub can't fill. Finish it in ${source}.`;
}

export type HyperWriteBackDialogState =
  | { status: 'loading' }
  | { status: 'rejected'; message: string }
  | { status: 'ready'; preview: HyperHubStatusPreview };

export interface HyperWriteBackNotice { tone: 'warning' | 'destructive' | 'info'; title: string; description?: string }

export interface HyperWriteBackDialogProps {
  open: boolean;
  source: HyperHubWriteSource;
  /** Shown before the preview arrives, from the card. */
  fallbackTitle: string;
  state: HyperWriteBackDialogState;
  /** True while main's native confirmation is open or the send is running. */
  confirming: boolean;
  /** The preview's 60-second lifetime passed; the primary action re-checks. */
  expired: boolean;
  notice?: HyperWriteBackNotice | null;
  onOpenChange: (open: boolean) => void;
  onApprove: (candidateId: string, resolutionId?: string) => void;
  onCheckAgain: () => void;
  onOpenSource?: () => void;
}

function HyperWriteFact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex min-w-0 items-center gap-3 px-3 py-2">
    <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
    <dd className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">{children}</dd>
  </div>;
}

function HyperCandidateRow({ candidate, selected, source }: { candidate: HyperHubStatusCandidate; selected: boolean; source: HyperHubWriteSource }) {
  const id = `hyper-write-${candidate.candidateId}`;
  return <Label htmlFor={id} className={cn('flex cursor-pointer items-center gap-3 px-3 py-2.5 font-normal hover:bg-muted/50', selected && 'bg-muted/40')}>
    <RadioGroupItem id={id} value={candidate.candidateId} />
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground" aria-hidden="true">→</span>
        <HyperStatusLozenge name={candidate.to.name} category={candidate.to.category} source={source} />
      </span>
      {candidate.actionLabel && candidate.actionLabel !== candidate.to.name && source === 'jira' && <bdi dir="auto" className="truncate text-xs text-muted-foreground">{candidate.actionLabel}</bdi>}
    </span>
    {candidate.resolution && <span className="shrink-0 text-2xs text-muted-foreground">Needs a resolution</span>}
  </Label>;
}

/** The dialog body: facts, notice, choices, effects and unavailable steps. Exported for tests. */
export function HyperWriteBackBody({ state, source, notice, confirming, candidateId, onCandidate, resolutionId, onResolution }: {
  state: HyperWriteBackDialogState; source: HyperHubWriteSource; notice?: HyperWriteBackNotice | null; confirming: boolean;
  candidateId: string | null; onCandidate: (id: string) => void; resolutionId: string | null; onResolution: (id: string | null) => void;
}) {
  const preview = state.status === 'ready' ? state.preview : null;
  const sourceName = hyperWriteSourceName[source];
  const candidate = preview?.candidates.find(item => item.candidateId === candidateId) ?? null;
  const needsResolution = !!candidate?.resolution && !resolutionId;
  const effects = candidate ? candidate.effects.filter(effect => effect.code !== 'resolution-set') : [];
  const resolutionName = candidate?.resolution?.values.find(value => value.id === resolutionId)?.name;
  return <>
        {state.status === 'loading' && <div aria-busy="true" className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />Checking what you can do in {sourceName}…</p>
          <Skeleton className="h-24 w-full" /><Skeleton className="h-16 w-full" />
        </div>}

        {state.status === 'rejected' && <Alert variant="warning">
          <CircleAlert className="size-4" />
          <AlertTitle>{state.message}</AlertTitle>
        </Alert>}

        {preview && <>
          <dl className="flex flex-col divide-y rounded-lg border">
            <HyperWriteFact label="Now">
              <HyperStatusLozenge name={preview.current.name} category={preview.current.category} source={source} />
              {typeof preview.current.progress === 'number' && <span className="text-xs tabular-nums text-muted-foreground">{preview.current.progress}% done</span>}
            </HyperWriteFact>
            <HyperWriteFact label="Account"><span className="flex min-w-0 flex-col"><bdi className="truncate">{preview.accountLabel}</bdi><span className="truncate text-xs text-muted-foreground" dir="ltr">{preview.site}</span></span></HyperWriteFact>
            <HyperWriteFact label="Version"><span className="truncate text-xs text-muted-foreground" title={preview.versionLabel}>{hyperHubVersionText(preview.versionLabel, Date.now())}</span></HyperWriteFact>
          </dl>

          {notice && <Alert variant={notice.tone === 'destructive' ? 'destructive' : notice.tone === 'info' ? 'info' : 'warning'}>
            <CircleAlert className="size-4" />
            <AlertTitle>{notice.title}</AlertTitle>
            {notice.description && <AlertDescription>{notice.description}</AlertDescription>}
          </Alert>}

          {preview.candidates.length > 0 ? <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Change to</h3>
            <RadioGroup value={candidateId ?? ''} onValueChange={value => onCandidate(String(value))} disabled={confirming} aria-label={`New ${sourceName} status`}
              className="flex flex-col gap-0 divide-y overflow-hidden rounded-lg border">
              {preview.candidates.map(item => <HyperCandidateRow key={item.candidateId} candidate={item} selected={item.candidateId === candidateId} source={source} />)}
            </RadioGroup>
            {candidate?.resolution && <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
              <Label htmlFor="hyper-write-resolution" className="text-xs text-muted-foreground">Resolution</Label>
              <Select value={resolutionId ?? ''} onValueChange={value => onResolution(value ? String(value) : null)} disabled={confirming}>
                <SelectTrigger id="hyper-write-resolution" size="sm" className="ms-auto w-48" aria-invalid={needsResolution}><SelectValue placeholder="Choose a resolution" /></SelectTrigger>
                <SelectContent>{candidate.resolution.values.map(value => <SelectItem key={value.id} value={value.id}><bdi>{value.name}</bdi></SelectItem>)}</SelectContent>
              </Select>
            </div>}
          </section> : <p className="text-sm text-muted-foreground">Your {sourceName} account has no status change available here.</p>}

          {(effects.length > 0 || resolutionName || preview.permissionCheckedOnConfirm) && <ul className="flex flex-col gap-1.5 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground" aria-label="What else happens">
            {resolutionName && <li className="flex gap-2"><Info className="mt-0.5 size-3.5 shrink-0" /><span>Resolution: <bdi className="text-foreground">{resolutionName}</bdi>.</span></li>}
            {effects.map((effect, index) => <li key={index} className="flex gap-2"><Info className="mt-0.5 size-3.5 shrink-0" /><span>{hyperWriteEffectText(effect)}</span></li>)}
            {preview.permissionCheckedOnConfirm && <li className="flex gap-2"><Info className="mt-0.5 size-3.5 shrink-0" /><span>{sourceName} checks your permission when you confirm.</span></li>}
          </ul>}

          {preview.unavailable.length > 0 && <details className="group text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Not available here ({preview.unavailable.length})</summary>
            <ul className="mt-2 flex flex-col divide-y rounded-lg border">
              {preview.unavailable.map((row, index) => <li key={index} className="flex flex-col gap-0.5 px-3 py-2">
                <span className="flex items-center gap-1.5"><bdi dir="auto" className="font-medium">{row.actionLabel}</bdi><span aria-hidden="true">→</span><bdi dir="auto">{row.toName}</bdi></span>
                <span className="text-muted-foreground">{hyperUnavailableText(row, sourceName)}</span>
              </li>)}
            </ul>
          </details>}
        </>}
  </>;
}

export function HyperWriteBackDialog({ open, source, fallbackTitle, state, confirming, expired, notice, onOpenChange, onApprove, onCheckAgain, onOpenSource }: HyperWriteBackDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const preview = state.status === 'ready' ? state.preview : null;
  const sourceName = hyperWriteSourceName[source];
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [resolutionId, setResolutionId] = useState<string | null>(null);

  // A fresh preview (first load, conflict, check again) resets the choice to main's preselection.
  useEffect(() => {
    setCandidateId(preview?.candidates.find(candidate => candidate.preselected)?.candidateId ?? null);
    setResolutionId(null);
  }, [preview]);

  const candidate = useMemo(() => preview?.candidates.find(item => item.candidateId === candidateId) ?? null, [preview, candidateId]);
  const needsResolution = !!candidate?.resolution && !resolutionId;
  const canApprove = !!candidate && !needsResolution && !confirming;
  const Icon = source === 'jira' ? SquareCheckBig : ChartGantt;

  return <Dialog open={open} onOpenChange={next => { if (!confirming) onOpenChange(next); }}>
    <DialogContent data-hyper-write-back className="flex max-h-[min(40rem,90vh)] flex-col gap-0 p-0 sm:max-w-lg" initialFocus={cancelRef} showCloseButton={!confirming}>
      <DialogHeader className="border-b p-4">
        <DialogTitle className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" />Change status in {sourceName}</DialogTitle>
        <DialogDescription className="flex min-w-0 flex-wrap items-center gap-x-1.5">
          {source === 'newsletter' && preview?.target.container && <><bdi dir="auto" className="max-w-48 truncate">{preview.target.container}</bdi><span aria-hidden="true">·</span></>}
          {source === 'jira' && preview?.target.key && <><bdi className="font-mono text-xs">{preview.target.key}</bdi><span aria-hidden="true">·</span></>}
          <bdi dir="auto" className="min-w-0 truncate">{preview?.target.title ?? fallbackTitle}</bdi>
          {source === 'newsletter' && preview?.target.key && <bdi className="max-w-40 truncate font-mono text-2xs text-muted-foreground" title={`Task ${preview.target.key}`}>task {preview.target.key}</bdi>}
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <HyperWriteBackBody state={state} source={source} notice={notice} confirming={confirming} candidateId={candidateId} onCandidate={id => { setCandidateId(id); setResolutionId(null); }} resolutionId={resolutionId} onResolution={setResolutionId} />
      </div>

      <DialogFooter className="mx-0 mb-0 flex-row items-center gap-2 border-t p-3 sm:justify-between">
        {onOpenSource ? <Button variant="ghost" size="sm" onClick={onOpenSource} disabled={confirming}><SquareArrowOutUpRight className="size-4" />Open in {sourceName}</Button> : <span />}
        <div className="flex items-center gap-2">
          <Button ref={cancelRef} variant="outline" size="sm" disabled={confirming} onClick={() => onOpenChange(false)}>Cancel</Button>
          {expired && preview
            ? <Button size="sm" onClick={onCheckAgain}>Check again</Button>
            : <Button size="sm" disabled={!canApprove} onClick={() => candidate && onApprove(candidate.candidateId, resolutionId ?? undefined)}>
              {confirming ? <><Spinner className="size-3.5" />Confirm in the dialog…</> : 'Change status…'}
            </Button>}
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
