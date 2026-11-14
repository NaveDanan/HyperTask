// Copyright (c) 2026 CopilotKit. MIT. See LICENSE and REUSE.md.
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/reui/badge';

export interface HyperDecisionOption { value: string; label: string; description?: string }
export interface HyperDecisionAnswer { label: string; choice?: string; note?: string; tone?: 'positive' | 'negative' | 'neutral' }
export interface HyperDecisionCardProps {
  title: string; caption?: ReactNode; children?: ReactNode;
  options: readonly HyperDecisionOption[]; other?: { placeholder: string };
  initialValue?: string; initialText?: string;
  answer?: HyperDecisionAnswer; submitting?: boolean; error?: string | null;
  onSubmit: (value: string, text: string) => void;
}
export const HYPER_OTHER = '__other__';

/** Selection stays local; the caller supplies the saved answer only after persistence succeeds. */
export function HyperDecisionCard({ title, caption, children, options, other, initialValue, initialText, answer, submitting = false, error, onSubmit }: HyperDecisionCardProps) {
  const id = useId();
  const [picked, setPicked] = useState(initialValue ?? options[0]?.value ?? HYPER_OTHER);
  const [text, setText] = useState(initialText ?? '');
  const selected = options.find(option => option.value === picked);
  const valid = !!selected || (picked === HYPER_OTHER && !!other && !!text.trim());
  return <section aria-labelledby={`${id}-title`} data-slot="decision-card" className="my-2 max-w-2xl overflow-hidden rounded-xl border border-border bg-card text-foreground">
    <header className="flex items-start justify-between gap-3 p-4">
      <div><h3 id={`${id}-title`} className="text-sm font-medium">{title}</h3>{caption && <div className="mt-1 text-xs text-muted-foreground">{caption}</div>}</div>
      <Badge size="sm" variant={!answer ? 'warning-light' : answer.tone === 'negative' ? 'destructive-light' : answer.tone === 'positive' ? 'success-light' : 'secondary'}>{answer?.label ?? 'Waiting on you'}</Badge>
    </header>
    {answer ? <div role="status" className="px-4 pb-4 text-sm">{answer.choice}{answer.note && <p className="whitespace-pre-wrap text-muted-foreground">{answer.note}</p>}</div> : <form onSubmit={event => { event.preventDefault(); if (valid && !submitting) onSubmit(picked, picked === HYPER_OTHER ? text.trim() : ''); }}>
      {children && <div className="px-4 pb-3">{children}</div>}
      <fieldset disabled={submitting} aria-label={title} className="min-w-0 border-t border-border">
        {options.map(option => <label key={option.value} className="flex cursor-pointer items-start gap-3 border-b border-border p-3 transition-colors hover:bg-muted">
          <input type="radio" name={id} value={option.value} checked={picked === option.value} onChange={() => setPicked(option.value)} className="mt-1 accent-primary" />
          <span className="min-w-0 text-sm"><span className="font-medium">{option.label}</span>{option.description && <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>}</span>
        </label>)}
        {other && <label className="flex items-center gap-3 p-3"><input type="radio" name={id} checked={picked === HYPER_OTHER} onChange={() => setPicked(HYPER_OTHER)} aria-label="Something else" /><Input aria-label={other.placeholder} placeholder={other.placeholder} value={text} onFocus={() => setPicked(HYPER_OTHER)} onChange={event => setText(event.target.value)} /></label>}
      </fieldset>
      {error && <p role="alert" className="px-4 pt-3 text-xs text-destructive">{error}</p>}
      <footer className="flex justify-end p-3"><Button type="submit" disabled={!valid || submitting}>{submitting ? 'Sending…' : selected?.label ?? 'Send answer'}</Button></footer>
    </form>}
  </section>;
}
