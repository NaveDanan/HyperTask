// Write-back state on a card (M5 E8): pending, accepted while readback runs, unknown (held, with Check in
// <source> and, once E1.7's conditions hold, I checked in <source>), failed, and owner-released. Always named
// with the write's own source, never a hard-coded "Jira".
import { CircleAlert, CircleCheck, CircleX, Hourglass, SquareArrowOutUpRight } from 'lucide-react';
import type { HyperHubWriteView } from '@shared/HyperTaskHub';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { hyperWriteSourceName } from './HyperWriteBackDialog';

export interface HyperWriteBadgeProps {
  write: HyperHubWriteView;
  /** Opens the written record in its source. */
  onCheckInSource?: () => void;
  /** Records the owner's release (E1.7). Offered only while `write.ownerReleaseAvailable`. */
  onRelease?: () => void;
  /** Failure text from the reasons formatter. */
  failureText?: string;
}

/** The card's one-line summary of the latest write. Returns null when there is nothing to say. */
export function HyperWriteBadge({ write, onCheckInSource, onRelease, failureText }: HyperWriteBadgeProps) {
  const source = hyperWriteSourceName[write.source];
  if (write.state === 'pending') {
    return <Badge variant="info-light" size="sm" className="gap-1" data-hyper-write="pending"><Spinner className="size-3" />Updating {source}…</Badge>;
  }
  if (write.state === 'succeeded' && write.readback !== 'verified') {
    return <Badge variant="info-light" size="sm" className="gap-1" data-hyper-write="checking" title={`${source} accepted the update. Task Hub is checking the result.`}>
      <Hourglass className="size-3" />Waiting for {source} to confirm
    </Badge>;
  }
  if (write.state === 'failed') {
    return <Badge variant="destructive-light" size="sm" className="gap-1" data-hyper-write="failed" title={failureText}><CircleX className="size-3" />{source} not updated</Badge>;
  }
  if (write.state === 'unknown') {
    const released = !!write.ownerReleasedAt;
    return <Popover>
      <PopoverTrigger render={<button type="button" className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${source} update unknown. Details`} />}>
        <Badge variant="warning-light" size="sm" className="cursor-pointer gap-1" data-hyper-write="unknown">
          <CircleAlert className="size-3" />{released ? `Released by you · ${source} unconfirmed` : `${source} update unknown`}
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <p className="font-medium">{released ? 'You released this task' : `Task Hub couldn't confirm the ${source} update`}</p>
          <p className="text-xs text-muted-foreground">
            You asked to change <bdi>{write.fromName}</bdi> → <bdi>{write.toName}</bdi>.{' '}
            {write.observedName ? <>{source} now shows <bdi className="text-foreground">{write.observedName}</bdi>. </> : null}
            The earlier update may still apply. Task Hub won't send it again{released ? ', and further changes wait until it settles.' : '.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onCheckInSource && <Button size="sm" variant="outline" onClick={onCheckInSource}><SquareArrowOutUpRight className="size-4" />Check in {source}</Button>}
          {onRelease && write.ownerReleaseAvailable && !released && <Button size="sm" onClick={onRelease}><CircleCheck className="size-4" />I checked in {source}</Button>}
        </div>
        {!released && !write.ownerReleaseAvailable && <p className="text-2xs text-muted-foreground">You can release this task after Task Hub reads {source} again.</p>}
      </PopoverContent>
    </Popover>;
  }
  return null;
}
