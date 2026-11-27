// One chip per connection: fresh, syncing, partial or stale with its time, error or unconfigured with a
// settings link (spec D9.7). Per-source problems live here and never block the views.
import { Settings } from 'lucide-react';
import type { HyperHubConnectionStatus } from '@shared/HyperTaskHub';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { openSettings } from '@/features/home/notifiers';
import { cn } from '@/lib/utils';
import { hyperHubRelative } from './HyperTaskHubFormat';
import { HyperHubSourceIcon, hyperHubSettingsPage } from './HyperHubSource';

const hyperHubStatusDot: Record<HyperHubConnectionStatus['status'], string> = {
  fresh: 'bg-success',
  syncing: '',
  partial: 'bg-warning',
  stale: 'bg-warning',
  error: 'bg-destructive',
  unconfigured: 'bg-muted-foreground/50',
};

export function hyperHubStatusText(source: HyperHubConnectionStatus, nowMs: number): string {
  const when = hyperHubRelative(source.lastSuccess?.iso, nowMs);
  switch (source.status) {
    case 'fresh': return when;
    case 'syncing': return 'syncing…';
    case 'partial': return `partial · ${when}`;
    case 'stale': return `stale · ${when}`;
    case 'error': return source.lastSuccess ? `failed · cached ${when}` : 'failed';
    case 'unconfigured': return 'not set up';
  }
}

function hyperHubStatusDetail(source: HyperHubConnectionStatus): string {
  switch (source.status) {
    case 'fresh': return 'Up to date.';
    case 'syncing': return 'Refreshing now.';
    case 'partial': return 'The last read did not cover everything. Missing items are not treated as removed.';
    case 'stale': return 'Showing cached items. The source has not refreshed recently.';
    case 'error': return 'The last refresh failed. Cached items stay visible.';
    case 'unconfigured': return 'This connection is not set up.';
  }
}

export function HyperSourceStatusBar({ sources, nowMs, onSetup }: { sources: HyperHubConnectionStatus[]; nowMs: number; onSetup?: () => void }) {
  if (!sources.length) return null;
  return <div role="list" aria-label="Sources" className="flex min-w-0 flex-wrap items-center gap-1">
    {sources.map(source => {
      const settingsPage = hyperHubSettingsPage(source.kind);
      const actionable = source.status === 'error' || source.status === 'unconfigured';
      const open = actionable ? () => settingsPage ? openSettings.emit(settingsPage) : onSetup?.() : undefined;
      const label = `${source.label}: ${hyperHubStatusText(source, nowMs)}`;
      return <div role="listitem" key={source.connectionId}>
        <Tooltip>
          <TooltipTrigger render={<Button type="button" variant="ghost" size="sm" aria-label={label} onClick={open}
            className={cn('h-7 max-w-96 gap-1.5 bg-muted/60 px-2 text-xs font-normal text-muted-foreground', !open && 'cursor-default hover:bg-muted/60')} />}>
            {source.status === 'syncing' ? <Spinner className="size-3" /> : <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', hyperHubStatusDot[source.status])} />}
            <HyperHubSourceIcon kind={source.kind} />
            <bdi className="truncate">{source.label}</bdi>
            <span className="shrink-0 tabular-nums text-muted-foreground/80">{hyperHubStatusText(source, nowMs)}</span>
            {actionable && <Settings aria-hidden="true" className="size-3 shrink-0" />}
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{hyperHubStatusDetail(source)}{actionable ? ' Click to open settings.' : ''}</TooltipContent>
        </Tooltip>
      </div>;
    })}
  </div>;
}
