import { useState } from 'react';
import { Clock3, Trash2 } from 'lucide-react';
import type { HyperBotMemory, HyperBotRoutine } from '@shared/HyperBots';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

function localTime(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function HyperBotRoutineEditor({ routines, onChange }: { routines: HyperBotRoutine[]; onChange: (routines: HyperBotRoutine[]) => void }) {
  const update = (id: string, patch: Partial<HyperBotRoutine>) => onChange(routines.map(routine => routine.id === id ? { ...routine, ...patch } : routine));
  return <section className="grid w-full gap-2 text-sm" aria-label="Routines">
    <div className="flex items-center justify-between gap-2"><h3 className="font-medium">Routines</h3>
      <Button type="button" size="sm" variant="outline" disabled={routines.length >= 12} onClick={() => onChange([...routines, {
        id: crypto.randomUUID(), prompt: '', everyMinutes: 1440, startAt: new Date(Math.ceil((Date.now() + 60_000) / 60_000) * 60_000).toISOString(),
      }])}><Clock3 />Add routine</Button>
    </div>
    {routines.map((routine, index) => <fieldset className="grid gap-2 rounded-md border border-border p-3" key={routine.id}>
      <legend className="px-1 text-xs">Routine {index + 1}</legend>
      <label className="grid gap-1">Prompt<Textarea required value={routine.prompt} rows={2} maxLength={4000} onChange={event => update(routine.id, { prompt: event.target.value })} /></label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1">Starts (local time)<Input type="datetime-local" required value={localTime(routine.startAt)} onChange={event => {
          const date = new Date(event.target.value);
          update(routine.id, { startAt: Number.isFinite(date.getTime()) ? date.toISOString() : '' });
        }} /></label>
        <label className="grid gap-1">Repeat every (minutes)<Input type="number" required min={15} max={10080} value={routine.everyMinutes || ''} onChange={event => update(routine.id, { everyMinutes: Number(event.target.value) })} /></label>
      </div>
      <Button type="button" size="sm" variant="ghost" className="justify-self-end" onClick={() => onChange(routines.filter(row => row.id !== routine.id))}><Trash2 />Remove routine</Button>
    </fieldset>)}
  </section>;
}

export function HyperBotMemoryPanel({ notes, enabled }: { notes: HyperBotMemory[]; enabled: boolean }) {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState('');
  async function forget(note: HyperBotMemory) {
    setPending(note.id);
    setError('');
    try {
      const result = await window.hypertask.hyperBots.forget?.({ roomId: note.roomId, id: note.id });
      if (!result?.ok) throw new Error(result?.message ?? 'Could not forget this note.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not forget this note.');
    } finally {
      setPending(undefined);
    }
  }
  return <section className="details__sections" aria-label="Memory">
    <p className="panel-empty">{enabled ? 'This bot learns lasting work preferences from this direct chat.' : 'Turn on automatic learning in Bot settings.'}</p>
    {notes.length ? <ul className="grid gap-2">{notes.map(note => <li key={note.id} className="panel-card flex items-start justify-between gap-2 p-2 text-sm">
      <span className="break-words">{note.text}</span>
      <Button type="button" variant="ghost" size="xs" disabled={pending !== undefined} onClick={() => void forget(note)}>Forget</Button>
    </li>)}</ul> : <p className="panel-empty">No saved preferences.</p>}
    {error && <p role="alert" className="notice is-error">{error}</p>}
  </section>;
}
