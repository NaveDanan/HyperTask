import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { cn } from '@/lib/utils';
import { hyperMentionPeople, hyperSerializeMention } from './hyperMentions';
import { HyperPersonAvatar, HyperPersonCard } from './HyperPersonCard';
import { HyperPeopleResults } from './HyperPeopleResults';
import { useHyperPeople } from './useHyperPeople';
export function HyperPeopleDisplay({ value }: { value: string }) {
  const people = hyperMentionPeople(value);
  return <span className="flex min-w-0 items-center gap-1 overflow-hidden"><span className="flex shrink-0 gap-0.5">{people.slice(0, 3).map(person => <HyperPersonCard key={person.email} person={person}><HyperPersonAvatar person={person} className="size-5 text-2xs" /></HyperPersonCard>)}</span><span dir="auto" className="truncate text-left">{people.map(person => person.name).join(', ')}</span></span>;
}
export function HyperPeoplePicker({ value, onChange, disabled, label = 'People', initiallyOpen = false, single = false, onOpenChange, onClose }: { value: string; onChange: (value: string) => void | Promise<void>; disabled?: boolean; label?: string; initiallyOpen?: boolean; single?: boolean; onOpenChange?: (open: boolean) => void; onClose?: () => void }) {
  const [open, setOpen] = useState(initiallyOpen), [query, setQuery] = useState(''), [active, setActive] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(''); const id = useId();
  const results = useHyperPeople(query.replace(/^@/, '')); const people = hyperMentionPeople(value);
  const update = async (next: typeof people) => { if (busy) return; setBusy(true); setError(''); try { await onChange(next.map(hyperSerializeMention).join(' ')); } catch { setError('Could not save people. Try again.'); } finally { setBusy(false); } };
  useEffect(() => { if (initiallyOpen) setOpen(true); }, [initiallyOpen]);
  const available = results.people.filter(person => !people.some(selected => selected.email === person.email));
  return <Popover open={open} onOpenChange={next => { setOpen(next); onOpenChange?.(next); if (!next) onClose?.(); }}><PopoverTrigger render={<Button variant="ghost" disabled={disabled} className="h-8 w-full min-w-0 justify-start px-2 font-normal" aria-label={'Edit ' + label} />}><HyperPeopleDisplay value={value} />{!people.length && <span className="text-muted-foreground">Add people…</span>}</PopoverTrigger><PopoverContent align="start" className={cn(floatingSurfaceClass, 'w-80 max-w-[calc(100vw-2rem)] gap-2 p-2')} onKeyDown={event => event.stopPropagation()}>
    {people.length > 0 && <div className="flex flex-wrap gap-1">{people.map(person => <span key={person.email} className="flex max-w-full items-center gap-1 rounded bg-primary/10 pl-1 text-xs text-primary"><HyperPersonAvatar person={person} className="size-5 text-2xs" /><span dir="auto" className="truncate text-left">{person.name}</span><Button variant="ghost" size="icon-xs" aria-label={'Remove ' + person.name} disabled={busy} onClick={() => void update(people.filter(item => item.email !== person.email))}><X className="size-3" /></Button></span>)}</div>}
    <Input aria-label="Search employees" role="combobox" aria-expanded aria-controls={id} aria-activedescendant={available[active] ? id + '-' + active : undefined} placeholder="Search employees…" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} disabled={busy} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, available.length)) % Math.max(1, available.length)); } if ((event.key === 'Enter' || event.key === 'Tab') && available[active]) { event.preventDefault(); void update(single ? [available[active]] : [...people, available[active]]); setQuery(''); setActive(0); } }} />
    {query.replace(/^@/, '').trim().length >= 2 ? <HyperPeopleResults {...results} people={available} active={active} id={id} onActive={setActive} onSelect={person => { void update(single ? [person] : [...people, person]); setQuery(''); }} /> : <p className="px-2 py-2 text-xs text-muted-foreground">Type at least two characters to find an employee.</p>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </PopoverContent></Popover>;
}
