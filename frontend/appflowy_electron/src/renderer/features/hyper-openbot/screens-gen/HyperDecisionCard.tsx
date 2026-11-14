// Adapted from OpenBot components/decisions/decision-card.tsx. Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { HyperBadge, HyperGalleryFrame, type HyperTone } from './frame';
const waitingCards: string[] = [];
export const OTHER = '__other__';
export function HyperDecisionCard({title, caption, children, options, other, answer, onSubmit, submitting = false, error}: {
  title: string; caption?: string; children?: ReactNode;
  options: {value: string; label: string; description?: string}[];
  other?: {placeholder?: string}; answer?: {label: string; choice?: string; note?: string; tone: HyperTone};
  onSubmit: (value: string, text: string) => Promise<void>; submitting?: boolean; error?: string;
}) {
  const id = useId();
  const [picked, setPicked] = useState(options[0]?.value ?? OTHER);
  const [text, setText] = useState('');
  const [failed, setFailed] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (answer || submitting) return;
    waitingCards.push(id);
    return () => {const index = waitingCards.indexOf(id); if (index >= 0) waitingCards.splice(index, 1);};
  }, [id, answer, submitting]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (waitingCards.at(-1) !== id || answer || submitting || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const option = options[Number(event.key) - 1];
      if (/^[1-9]$/.test(event.key) && option) {event.preventDefault(); setPicked(option.value);}
      if (event.key === 'Enter' && (picked !== OTHER || text.trim())) {event.preventDefault(); form.current?.requestSubmit();}
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [id, answer, submitting, options, picked, text]);
  return <HyperGalleryFrame title={title} caption={caption}>{children}{answer ? <div><HyperBadge tone={answer.tone}>{answer.label}</HyperBadge><p>{answer.choice ?? answer.note}</p></div> : <form ref={form} onSubmit={event => {event.preventDefault(); setFailed(false); void onSubmit(picked, text.trim()).catch(() => setFailed(true));}}><fieldset disabled={submitting} className="space-y-2">
    {options.map(option => <label key={option.value} className="block rounded-md border border-border p-2"><input type="radio" name={id} value={option.value} checked={picked === option.value} onChange={() => setPicked(option.value)} /> {option.label}<p className="text-sm text-muted-foreground">{option.description}</p></label>)}
    {other && <label className="block"><input type="radio" name={id} checked={picked === OTHER} onChange={() => setPicked(OTHER)} />Something else<Textarea placeholder={other.placeholder} value={text} onChange={event => {setPicked(OTHER); setText(event.target.value);}} /></label>}
    {(failed || error) && <p role="alert">{error ?? 'Could not send your answer. Try again.'}</p>}
    <Button type="submit" disabled={submitting || (picked === OTHER && !text.trim())}>{options.find(option => option.value === picked)?.label ?? 'Send answer'}</Button>
  </fieldset></form>}</HyperGalleryFrame>;
}
