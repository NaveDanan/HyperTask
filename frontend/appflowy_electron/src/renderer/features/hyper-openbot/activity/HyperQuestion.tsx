// Copyright (c) 2026 CopilotKit. MIT. See LICENSE and REUSE.md.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HyperDecisionCard, HYPER_OTHER, type HyperDecisionAnswer } from './HyperDecisionCard';
export interface HyperQuestionPart { header: string; question: string; options?: readonly string[] }
export interface HyperQuestionProps { id: string; parts: readonly HyperQuestionPart[]; answer?: HyperDecisionAnswer; submitting?: boolean; error?: string | null; onAnswer: (id: string, response: string) => void; onDismiss?: (id: string) => void }
export function hyperPartsAnswer(parts: readonly HyperQuestionPart[], answers: readonly string[]): string { return parts.map((part, index) => `${part.header}: ${answers[index] ?? ''}`).join('\n'); }
export function HyperQuestion(props: HyperQuestionProps) { return <HyperQuestionForm key={props.id} {...props} />; }
function HyperQuestionForm({ id, parts, answer, submitting, error, onAnswer, onDismiss }: HyperQuestionProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const part = parts[Math.min(step, parts.length - 1)];
  if (!part) return null;
  return <div>
    {parts.length > 1 && !answer && <p className="text-xs text-muted-foreground">Question {step + 1} of {parts.length}</p>}
    <HyperDecisionCard key={step} title={part.question} caption={part.header} initialValue={answers[step] === undefined ? undefined : part.options?.includes(answers[step]) ? answers[step] : HYPER_OTHER} initialText={answers[step]} answer={answer} submitting={submitting} error={error} options={(part.options ?? []).map(value => ({ value, label: value }))} other={{ placeholder: 'Answer in your own words' }} onSubmit={(value, text) => {
      const next = [...answers]; next[step] = value === HYPER_OTHER ? text : value; setAnswers(next);
      if (step < parts.length - 1) setStep(step + 1); else onAnswer(id, parts.length === 1 ? next[0] ?? '' : hyperPartsAnswer(parts, next));
    }} />
    {!answer && <div className="flex gap-2">{step > 0 && <Button variant="ghost" disabled={submitting} onClick={() => setStep(step - 1)}>Previous</Button>}{onDismiss && <Button variant="ghost" disabled={submitting} onClick={() => onDismiss(id)}>Dismiss</Button>}</div>}
  </div>;
}
