// Source identity: lucide icon plus label, never a new colour (spec D9.8).
import { CalendarDays, ChartGantt, FileText, Mail, Newspaper, SquareCheckBig } from 'lucide-react';
import type { HyperHubSourceKind, HyperHubSourceRef } from '@shared/HyperTaskHub';
import { Badge } from '@/components/reui/badge';
import { cn } from '@/lib/utils';

const hyperHubSourceIcons = {
  jira: SquareCheckBig,
  hypertask: FileText,
  'newsletter-task': ChartGantt,
  'newsletter-article': Newspaper,
  'outlook-mail': Mail,
  'outlook-calendar': CalendarDays,
} satisfies Record<HyperHubSourceKind, unknown>;

export const hyperHubSourceNames: Record<HyperHubSourceKind, string> = {
  jira: 'Jira',
  hypertask: 'HyperTask',
  'newsletter-task': 'Newsletter Gantt',
  'newsletter-article': 'Newsletter',
  'outlook-mail': 'Mail',
  'outlook-calendar': 'Meeting',
};

/** The Settings → Connections page for a source kind; HyperTask sources are chosen in the Hub setup. */
export function hyperHubSettingsPage(kind: HyperHubSourceKind): string | null {
  if (kind === 'jira') return 'connections/jira';
  if (kind === 'outlook-mail' || kind === 'outlook-calendar') return 'connections/outlook';
  if (kind === 'newsletter-task' || kind === 'newsletter-article') return 'connections/newsletter';
  return null;
}

export function HyperHubSourceIcon({ kind, className }: { kind: HyperHubSourceKind; className?: string }) {
  const Icon = hyperHubSourceIcons[kind];
  return <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', className)} />;
}

/** A compact source badge; a stale or errored source keeps its cached label with a warning dot. */
export function HyperHubSourceBadge({ source, className }: { source: HyperHubSourceRef; className?: string }) {
  return <Badge variant="outline" size="sm" className={cn('max-w-40 gap-1 font-normal text-muted-foreground', className)}
    title={`${hyperHubSourceNames[source.kind]} · ${source.label}${source.stale ? ' (not refreshed)' : ''}`}>
    <HyperHubSourceIcon kind={source.kind} className="size-3" />
    <bdi className="truncate">{source.label}</bdi>
    {source.stale && <span aria-label="not refreshed" className="size-1.5 shrink-0 rounded-full bg-warning" />}
  </Badge>;
}
