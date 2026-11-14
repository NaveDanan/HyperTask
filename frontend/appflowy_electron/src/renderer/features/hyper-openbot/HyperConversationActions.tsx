// Adapted from OpenBot lib/approvals.ts and components/approvals. Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useRef, useState } from 'react';
import { HyperApproval, HyperQuestion, type HyperQuestionPart } from './activity';
import { hyperOpenBotRequest as request } from './transport';
type HyperInbox = {
  requests: { id: string; status: string; action: { threadId: string; toolRef: string; effect: string; scope: string; policy?: { behaviour: string; reason: string; closed?: boolean } } }[];
  questions: { id: string; threadId: string; channelId?: string; question: string; parts?: HyperQuestionPart[] }[];
};
export function HyperConversationActions({ threadId, onResolved }: { threadId: string; onResolved?: () => void }) {
  const hadWaiting = useRef(false);
  const resolved = useRef(onResolved); resolved.current = onResolved;
  const [inbox, setInbox] = useState<HyperInbox>();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [pollError, setPollError] = useState<string>();
  async function refresh() { try { const next = await request<HyperInbox>('/api/approvals'); setPollError(undefined); const waiting = next.requests.some(row => row.action.threadId === threadId && ['pending', 'approved', 'denied', 'consumed'].includes(row.status)) || next.questions.some(row => row.threadId === threadId); if (hadWaiting.current && !waiting) resolved.current?.(); hadWaiting.current = waiting; setInbox(next); } catch (error) { setPollError(String(error)); } }
  useEffect(() => { let current = true; let timer: ReturnType<typeof setTimeout>; const poll = async () => { await refresh(); if (current) timer = setTimeout(() => void poll(), 4000); }; void poll(); return () => { current = false; clearTimeout(timer); }; }, [threadId]);
  async function save(id: string, path: string, body?: unknown) {
    setPending(id); setError(undefined);
    try { await request(path, 'POST', body); await refresh(); }
    catch (error) { setError(String(error)); }
    finally { setPending(undefined); }
  }
  return <div className="max-h-96 space-y-3 overflow-y-auto px-4">
    {(error || pollError) && <p role="alert" className="text-sm text-destructive">{error || pollError}</p>}
    {inbox?.requests.filter(row => row.action.threadId === threadId && row.status === 'pending').map(row => <HyperApproval key={row.id} request={{ id: row.id, title: `${row.action.effect}: ${row.action.scope || row.action.toolRef}`, reason: row.action.policy?.reason, handOff: row.action.policy?.behaviour === 'hand_off', offersStandingRule: row.action.policy?.closed === false }} submitting={pending === row.id} onDecide={(id, decision) => void save(id, `/api/approvals/${encodeURIComponent(id)}/decision`, { decision })} />)}
    {inbox?.questions.filter(row => row.threadId === threadId).map(row => <HyperQuestion key={row.id} id={row.id} parts={row.parts?.length ? row.parts : [{ header: '', question: row.question }]} submitting={pending === row.id} onAnswer={(id, response) => void save(id, `/api/approvals/questions/${encodeURIComponent(id)}/respond`, { response })} onDismiss={id => void save(id, `/api/approvals/questions/${encodeURIComponent(id)}/dismiss`)} />)}
  </div>;
}
