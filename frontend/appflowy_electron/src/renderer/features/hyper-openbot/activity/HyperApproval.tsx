// Copyright (c) 2026 CopilotKit. MIT. See LICENSE and REUSE.md.
import { HyperDecisionCard, type HyperDecisionAnswer } from './HyperDecisionCard';
export type HyperApprovalDecision = 'allow_once' | 'allow_conversation' | 'allow_always' | 'deny' | 'handled';
export interface HyperApprovalRequest { id: string; title: string; reason?: string; handOff?: boolean; offersStandingRule?: boolean; answer?: HyperDecisionAnswer }
export interface HyperApprovalProps { request: HyperApprovalRequest; submitting?: boolean; error?: string | null; onDecide: (requestId: string, decision: HyperApprovalDecision) => void }
const choices: Record<HyperApprovalDecision, { label: string; description: string }> = {
  allow_once: { label: 'Allow once', description: "The Bot does it this time. You're asked again next time." },
  allow_conversation: { label: 'Allow for this conversation', description: 'The Bot does it now, and again in this conversation without asking.' },
  allow_always: { label: 'Always allow here', description: 'The Bot does it now, and here without asking from now on.' },
  deny: { label: 'Deny', description: "The Bot doesn't do it, and is told you said no." },
  handled: { label: 'I did it myself', description: "You've done it, so the Bot carries on from there." },
};
export function HyperApproval({ request, submitting, error, onDecide }: HyperApprovalProps) {
  const values: HyperApprovalDecision[] = request.handOff ? ['handled', 'deny'] : ['allow_once', ...(request.offersStandingRule ? ['allow_conversation', 'allow_always'] as const : []), 'deny'];
  return <HyperDecisionCard key={request.id} title={request.title} caption={request.reason ?? (request.handOff ? 'This one is yours to do.' : undefined)} answer={request.answer} submitting={submitting} error={error} options={values.map(value => ({ value, ...choices[value], ...(request.handOff && value === 'deny' ? { label: "Don't do it" } : {}) }))} onSubmit={value => onDecide(request.id, value as HyperApprovalDecision)} />;
}
