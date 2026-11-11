import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { useTr } from '@/i18n';
import { cn } from '@/lib/utils';
import { hyperFilterDocumentSlashCommands, type HyperDocumentSlashCommand, type HyperDocumentSlashTarget } from './HyperDocumentSlashModel';

export const hyperDocumentSlashStrings = { title: 'Insert block', search: 'Search commands', empty: 'No commands found.' };
export interface HyperDocumentSlashProps {
  target: HyperDocumentSlashTarget;
  commands: HyperDocumentSlashCommand[];
  anchor: { left: number; top: number };
  onQuery(query: string): void;
  onSelect(command: HyperDocumentSlashCommand): void;
  onDismiss(restoreFocus: boolean): void;
}
export function HyperDocumentSlash({ target, commands, anchor, onQuery, onSelect, onDismiss }: HyperDocumentSlashProps) {
  const { tr } = useTr();
  const text = (key: keyof typeof hyperDocumentSlashStrings) => { const id = `hyperDocumentSlash.${key}`, value = tr(id); return value === id ? hyperDocumentSlashStrings[key] : value; };
  const input = useRef<HTMLInputElement>(null), menu = useRef<HTMLDivElement>(null), composing = useRef(false);
  const [query, setQuery] = useState(target.query), [selected, setSelected] = useState(0);
  useEffect(() => { if (!composing.current) setQuery(target.query); }, [target.query]);
  const filtered = hyperFilterDocumentSlashCommands(commands, query);
  useEffect(() => setSelected(0), [query]);
  const focus = (index: number) => {
    if (!filtered.length) return;
    const next = (index + filtered.length) % filtered.length;
    setSelected(next); menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[next]?.focus();
  };
  return <Popover open modal={false} onOpenChange={(open, details) => { if (!open) onDismiss(details.reason === 'escape-key'); }}>
    <PopoverTrigger render={<span aria-hidden className="pointer-events-none fixed size-px" style={{ left: anchor.left, top: anchor.top }} />} />
    <PopoverContent align="start" className="w-72 gap-1 p-1" initialFocus={input} finalFocus={false}>
      <PopoverTitle className="sr-only">{text('title')}</PopoverTitle>
      <label className="flex items-center gap-2 px-2 py-1"><Search className="size-4 shrink-0 text-muted-foreground" /><Input ref={input} value={query} maxLength={256} aria-label={text('search')} placeholder={text('search')}
        onChange={event => { setQuery(event.target.value); if (!composing.current) onQuery(event.target.value); }}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => { composing.current = false; onQuery(event.currentTarget.value); }}
        onKeyDown={event => {
          if (composing.current || event.nativeEvent.isComposing) { event.stopPropagation(); return; }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); focus(event.key === 'ArrowDown' ? 0 : filtered.length - 1); }
          else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (filtered[selected]) onSelect(filtered[selected]); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDismiss(true); }
        }} /></label>
      <div ref={menu} role="menu" aria-label={text('title')} className="max-h-64 overflow-y-auto" onKeyDown={event => {
        if (event.nativeEvent.isComposing) { event.stopPropagation(); return; }
        const index = Array.from(menu.current!.querySelectorAll('[role="menuitem"]')).indexOf(event.target as HTMLElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); focus(event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1)); }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDismiss(true); }
        else if (event.key === 'Enter' && filtered[index]) { event.preventDefault(); event.stopPropagation(); onSelect(filtered[index]); }
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') { event.preventDefault(); const next = query + event.key; setQuery(next); onQuery(next); input.current?.focus(); }
      }}>
        {filtered.map((command, index) => <Button key={command.id} role="menuitem" tabIndex={-1} variant="ghost" size="sm" className={cn('w-full justify-start rounded-md', selected === index && 'bg-accent text-accent-foreground')} onFocus={() => setSelected(index)} onClick={() => onSelect(command)}>{command.label}</Button>)}
        {!filtered.length && <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">{text('empty')}</p>}
      </div>
    </PopoverContent>
  </Popover>;
}
