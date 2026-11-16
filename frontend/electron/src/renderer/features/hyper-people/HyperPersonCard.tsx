import { useEffect, useState, type ReactNode } from 'react';
import { Mail, MessageSquare, Phone, MapPin } from 'lucide-react';
import type { HyperPerson } from '@shared/api';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { cn } from '@/lib/utils';
import { hyperPersonStub, type HyperMention } from './hyperMentions';
export function HyperPersonAvatar({ person, className }: { person: HyperMention & { photo?: string }; className?: string }) {
  return <span aria-hidden className={cn('inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--color-primary)_12%,var(--color-background))] text-xs font-medium text-primary', className)}>{person.photo ? <img src={person.photo} alt="" className="size-full object-cover" /> : person.name.trim().split(/\s+/u).slice(0, 2).map(word => Array.from(word)[0]).join('')}</span>;
}
export function HyperPersonCard({ person, children }: { person: HyperMention; children: ReactNode }) {
  const [open, setOpen] = useState(false), [details, setDetails] = useState<HyperPerson>(() => hyperPersonStub(person));
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!open) return;
    let alive = true; setStatus('Loading details…');
    void window.hypertask.outlook.people.lookup({ email: person.email }).then(result => {
      if (!alive) return;
      if (result.ok && result.value) { setDetails(result.value); setStatus(''); }
      else setStatus(result.ok ? 'No additional directory details.' : result.message);
    }).catch(() => { if (alive) setStatus('Directory details are unavailable.'); });
    return () => { alive = false; };
  }, [open, person.email]);
  return <HoverCard open={open} onOpenChange={setOpen}><HoverCardTrigger render={<span tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} />}>{children}</HoverCardTrigger><HoverCardContent className={cn(floatingSurfaceClass, 'w-80 max-w-[calc(100vw-2rem)] space-y-3 p-4')} onClick={event => event.stopPropagation()}>
    <div className="flex items-start gap-3"><HyperPersonAvatar person={details} className="size-10 text-sm" /><div className="min-w-0"><p dir="auto" className="break-words text-left font-medium">{details.name}</p>{details.title && <p dir="auto" className="text-left text-xs text-muted-foreground">{details.title}</p>}{details.department && <p dir="auto" className="text-left text-xs text-muted-foreground">{details.department}</p>}</div></div>
    <div className="space-y-1.5 text-xs text-muted-foreground"><p dir="auto" className="break-all">{details.email}</p>{details.phone && <p dir="auto" className="flex items-center gap-2"><Phone className="size-3" />{details.phone}</p>}{details.office && <p dir="auto" className="flex items-center gap-2"><MapPin className="size-3" />{details.office}</p>}{details.company && <p dir="auto">{details.company}</p>}{status && <p role="status">{status}</p>}</div>
    <div className="flex gap-2 border-t pt-3"><Button size="sm" variant="outline" onClick={() => void window.hypertask.shell.openExternal('mailto:' + encodeURIComponent(details.email))}><Mail className="size-3.5" />Email</Button><Button size="sm" variant="outline" onClick={() => void window.hypertask.shell.openExternal('https://teams.microsoft.com/l/chat/0/0?users=' + encodeURIComponent(details.email))}><MessageSquare className="size-3.5" />Teams chat</Button></div>
  </HoverCardContent></HoverCard>;
}
