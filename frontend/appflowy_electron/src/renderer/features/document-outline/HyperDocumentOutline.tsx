import { useMemo, useRef, useState } from 'react';
import { ListTree } from 'lucide-react';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { useTr } from '@/i18n';
import { cn } from '@/lib/utils';
import { hyperDocumentOutline, type HyperDocumentHeading } from './HyperDocumentOutlineModel';

export const hyperDocumentOutlineStrings = {
  title: 'Outline', empty: 'Add headings to see the document outline.', untitled: 'Untitled heading',
  unavailable: 'The document outline is unavailable because the document tree is invalid.',
  heading: 'Heading {level}: {title}',
} as const;

export function HyperDocumentOutline({ document, onSelect }: { document: DocumentDataPB | null; onSelect(heading: HyperDocumentHeading): void }) {
  const { tr } = useTr(), [open, setOpen] = useState(false);
  const navigating = useRef(false);
  const outline = useMemo(() => hyperDocumentOutline(document), [document]);
  const t = (name: keyof typeof hyperDocumentOutlineStrings, args: Record<string, string | number> = {}) => {
    const key = `hyperDocumentOutline.${name}`, translated = tr(key, { namedArgs: args });
    return translated === key ? Object.entries(args).reduce<string>((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), hyperDocumentOutlineStrings[name]) : translated;
  };
  return <Popover open={open} onOpenChange={value => { if (value) navigating.current = false; setOpen(value); }}>
    <PopoverTrigger render={<Button variant="ghost" size="sm" />}><ListTree />{t('title')}</PopoverTrigger>
    <PopoverContent align="start" finalFocus={() => !navigating.current}>
      <PopoverTitle>{t('title')}</PopoverTitle>
      {outline.invalid ? <p role="status" className="text-sm text-muted-foreground">{t('unavailable')}</p> : !outline.headings.length ? <p className="text-sm text-muted-foreground">{t('empty')}</p> : <nav aria-label={t('title')} className="max-h-80 overflow-y-auto" onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
        const selected = buttons.indexOf((event.target as HTMLElement).closest('button')!);
        if (selected < 0) return;
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (selected + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
        buttons[index]?.focus();
      }}>
        <ol className="space-y-0.5">{outline.headings.map(heading => {
          const name = heading.title || t('untitled');
          return <li key={heading.id}><Button variant="ghost" size="sm" className={cn('w-full justify-start', { 'ps-6': heading.level === 2, 'ps-10': heading.level === 3, 'ps-14': heading.level === 4, 'ps-18': heading.level === 5, 'ps-22': heading.level === 6 })} title={name} aria-label={t('heading', { level: heading.level, title: name })} onClick={() => {
            navigating.current = true; setOpen(false); onSelect(heading);
          }}><span aria-hidden className="shrink-0 text-xs text-muted-foreground">H{heading.level}</span><span className="truncate">{name}</span></Button></li>;
        })}</ol>
      </nav>}
    </PopoverContent>
  </Popover>;
}
