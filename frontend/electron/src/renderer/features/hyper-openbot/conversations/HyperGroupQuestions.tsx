// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted from components/approvals/question-notice.tsx and lib/approvals.ts.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperOpenBotRequest as request } from '../transport';
export type HyperWaitingQuestion = {
  id: string; botId: string; conversationBotId?: string; channelId?: string;
  question: string; why?: string;
  parts?: { header: string; question: string; options?: string[] }[];
};
export const hyperReadQuestions = () => request<{ questions: HyperWaitingQuestion[] }>('/api/approvals');
export const hyperGroupQuestion = (questions: HyperWaitingQuestion[], channelId: string) => questions.find(question => question.channelId === channelId);
export const hyperQuestionRecipient = (question: HyperWaitingQuestion, agentId: string | null) => !agentId || agentId === (question.conversationBotId ?? question.botId);
export const hyperAnswerQuestion = (id: string, response: string) => request(`/api/approvals/questions/${encodeURIComponent(id)}/respond`, 'POST', { response });
export const hyperDismissQuestion = (id: string) => request(`/api/approvals/questions/${encodeURIComponent(id)}/dismiss`, 'POST');
export function hyperPartsAnswer(parts: NonNullable<HyperWaitingQuestion['parts']>, form: FormData) {
  return parts.map((part, index) => `${part.header}: ${form.getAll(`part-${index}`).map(String).map(value => value.trim()).filter(Boolean).join(', ')}`).join('\n');
}
export function HyperGroupQuestionNotice({ question, name, disabled, onAnswer, onDismiss }: {
  question: HyperWaitingQuestion; name: string; disabled: boolean;
  onAnswer: (text: string) => Promise<void>; onDismiss: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function act(action: () => Promise<void>) {
    setPending(true); setError(undefined);
    try { await action(); } catch { setError('Your answer could not be saved. Try again.'); } finally { setPending(false); }
  }
  return <section aria-label={`${name} is waiting on your answer`} className="mx-4 space-y-2 rounded-lg border bg-muted p-3">
    <p>{name} is waiting on your answer</p><p className="whitespace-pre-wrap">{question.question}</p>
    {question.why && <p className="whitespace-pre-wrap text-muted-foreground">{question.why}</p>}
    {!!question.parts?.length && <form onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      if (question.parts!.some((_, index) => !form.getAll(`part-${index}`).some(value => String(value).trim()))) { setError('Answer each question before sending.'); return; }
      void act(() => onAnswer(hyperPartsAnswer(question.parts!, form)));
    }}><fieldset disabled={disabled || pending} className="space-y-3">{question.parts.map((part, index) => <fieldset key={index} className="space-y-1"><legend>{part.header}: {part.question}</legend>{part.options?.map(option => <label key={option} className="mr-3 inline-flex gap-1"><input type="checkbox" name={`part-${index}`} value={option} />{option}</label>)}<Input name={`part-${index}`} aria-label={`${part.header}, in your own words`} placeholder="Your answer" /></fieldset>)}<Button type="submit">Send answers</Button></fieldset></form>}
    <Button variant="ghost" disabled={disabled || pending} onClick={() => void act(onDismiss)}>Dismiss question</Button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
