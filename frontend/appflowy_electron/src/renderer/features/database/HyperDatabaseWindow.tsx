import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTr } from '@/i18n';
import { cn } from '@/lib/utils';
import { hyperDatabaseWindow, type HyperDatabaseWindowData } from './HyperDatabaseWindowModel';

export const hyperDatabaseWindowStrings = {
  rows: 'Rows', properties: 'Properties', additionalProperties: 'Additional properties', groups: 'Groups', cards: 'Cards in {title}',
  events: 'Events on {day}', undated: 'Undated rows', targets: 'Move targets',
  showing: '{start}–{end} of {total}', page: 'Page {page} of {total}', previous: 'Previous', next: 'Next',
  searchGroups: 'Search groups', pending: 'Save or discard cell changes before changing pages.',
} as const;
export function useHyperDatabaseWindowText() {
  const { tr } = useTr();
  return (name: keyof typeof hyperDatabaseWindowStrings, args: Record<string, string | number> = {}) => {
    const key = `hyperDatabaseWindow.${name}`, translated = tr(key, { namedArgs: args });
    return translated === key ? Object.entries(args).reduce<string>((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), hyperDatabaseWindowStrings[name]) : translated;
  };
}

export function useHyperDatabaseWindow<T>(items: readonly T[], scope: string, size: number) {
  const [position, setPosition] = useState({ scope, page: 0 });
  const window = hyperDatabaseWindow(items, position.scope === scope ? position.page : 0, size);
  useEffect(() => {
    setPosition(previous => previous.scope === scope && previous.page === window.page ? previous : { scope, page: window.page });
  }, [scope, window.page]);
  return { ...window, setPage: (page: number) => setPosition({ scope, page: hyperDatabaseWindow(items, page, size).page }) };
}

export function HyperDatabaseWindowNavigation({ window, label, onPage, disabled = false, compact = false, hideSingle = true, className }: {
  window: Omit<HyperDatabaseWindowData<unknown>, 'items'>;
  label: string;
  onPage(page: number): void;
  disabled?: boolean;
  compact?: boolean;
  hideSingle?: boolean;
  className?: string;
}) {
  const text = useHyperDatabaseWindowText();
  if (hideSingle && window.pageCount <= 1) return null;
  return <nav aria-label={label} className={cn('flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground', className)} onKeyDown={event => {
    if (disabled || !(event.target instanceof HTMLButtonElement)) return;
    const page = event.key === 'Home' ? 0 : event.key === 'End' ? window.pageCount - 1 : event.key === 'ArrowLeft' ? window.page - 1 : event.key === 'ArrowRight' ? window.page + 1 : null;
    if (page !== null) { event.preventDefault(); onPage(Math.max(0, Math.min(window.pageCount - 1, page))); }
  }}>
    <span className="mr-auto" aria-live="polite" aria-atomic="true">{!compact && <>{label}: </>}{text('showing', { start: window.start, end: window.end, total: window.total })}</span>
    {!compact && <span>{text('page', { page: window.page + 1, total: window.pageCount })}</span>}
    <Button variant="outline" size={compact ? 'icon-xs' : 'sm'} disabled={disabled || window.page <= 0} aria-label={`${label}: ${text('previous')}`} onClick={() => onPage(window.page - 1)}><ChevronLeft />{!compact && text('previous')}</Button>
    <Button variant="outline" size={compact ? 'icon-xs' : 'sm'} disabled={disabled || window.page + 1 >= window.pageCount} aria-label={`${label}: ${text('next')}`} onClick={() => onPage(window.page + 1)}><ChevronRight />{!compact && text('next')}</Button>
  </nav>;
}

export function HyperDatabaseWindowPending({ visible }: { visible: boolean }) {
  const text = useHyperDatabaseWindowText();
  return visible ? <p role="status" className="text-xs text-muted-foreground">{text('pending')}</p> : null;
}
