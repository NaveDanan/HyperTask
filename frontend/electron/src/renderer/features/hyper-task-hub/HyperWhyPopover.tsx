// "Why?" popover (spec D9.5): signed contributions, unknown signals, a display-only rounding adjustment,
// overrides and the placement reason. Text comes from Sol's reason templates (codes + facts).
import { Info } from 'lucide-react';
import type { HyperHubPlacementReason, HyperHubRanked } from '@shared/HyperTaskHub';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useI18nStore } from '@/i18n';
import { cn } from '@/lib/utils';
import { hyperBuildWhyRows, hyperFormatBlocker, type HyperHubReasonLocale } from './state/HyperTaskHubReasons';

export function useHyperHubReasonLocale(): HyperHubReasonLocale {
  const locale = useI18nStore(s => s.locale);
  return locale.toLowerCase().startsWith('he') ? 'he' : 'en';
}

export function HyperWhyPopover({ ranked, title, zone, placement, movedByOwner }: {
  ranked: HyperHubRanked;
  title: string;
  zone: string;
  placement?: readonly HyperHubPlacementReason[];
  movedByOwner?: boolean;
}) {
  const locale = useHyperHubReasonLocale();
  const rows = hyperBuildWhyRows(ranked, locale, { zone, placement, movedByOwner });
  const score = (ranked.scoreCents / 100).toFixed(2);
  const blocked = !ranked.feasibility.ready ? hyperFormatBlocker(ranked.feasibility.code, ranked.feasibility.facts, locale, zone) : null;
  return <Popover>
    <PopoverTrigger render={<button type="button" aria-label={`Why is ${title} ranked here? Score ${score}`}
      onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
      className="inline-flex h-5 items-center gap-1 rounded-md px-1 text-2xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
      <Info aria-hidden="true" className="size-3" />{score}
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 p-0">
      <div className="border-b px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">Why this rank</p>
        <p dir="auto" className="truncate text-sm font-medium">{title}</p>
      </div>
      <ul dir={locale === 'he' ? 'rtl' : 'ltr'} className="flex flex-col gap-1 px-3 py-2 text-xs">
        {rows.map((row, index) => <li key={index} className={cn('flex items-start gap-2', (row.kind === 'unknown' || row.kind === 'rounding') && 'text-muted-foreground')}>
          <span className="min-w-0 flex-1">{row.text}</span>
          {'signedPoints' in row && <bdi dir="ltr" className={cn('shrink-0 tabular-nums', row.kind === 'contribution' && row.pointsCents > 0 && 'text-foreground')}>{row.signedPoints}</bdi>}
        </li>)}
        {blocked && <li className="text-warning-foreground dark:text-warning">{blocked}</li>}
      </ul>
      <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
        <span className="text-muted-foreground">{ranked.pinned ? 'Pinned · score' : 'Score'}</span>
        <bdi dir="ltr" className="font-medium tabular-nums">{score}</bdi>
      </div>
    </PopoverContent>
  </Popover>;
}
