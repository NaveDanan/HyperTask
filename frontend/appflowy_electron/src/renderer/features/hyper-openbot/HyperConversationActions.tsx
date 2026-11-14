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
  const pendingIds = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const refreshVersion = useRef(0);
  const currentThread = useRef(threadId); currentThread.current = threadId;
  const alive = useRef(false);
  const [error, setError] = useState<string>();
  const [pollError, setPollError] = useState<string>();
  async function refresh() {
    if (!alive.current) return;
    const version = ++refreshVersion.current;
    const current = () => alive.current && version === refreshVersion.current && currentThread.current === threadId;
    try { const next = await request<HyperInbox>('/api/approvals'); if (!current()) return; setPollError(undefined); const waiting = next.requests.some(row => row.action.threadId === threadId && ['pending', 'approved', 'denied', 'consumed'].includes(row.status)) || next.questions.some(row => row.threadId === threadId); if (hadWaiting.current && !waiting) resolved.current?.(); hadWaiting.current = waiting; setInbox(next); }
    catch (error) { if (current()) setPollError(String(error)); }
  }
  useEffect(() => { alive.current = true; hadWaiting.current = false; setInbox(undefined); setError(undefined); setPollError(undefined); let current = true; let timer: ReturnType<typeof setTimeout>; const poll = async () => { await refresh(); if (current) timer = setTimeout(() => void poll(), 4000); }; void poll(); return () => { alive.current = false; refreshVersion.current++; current = false; clearTimeout(timer); }; }, [threadId]);
  async function save(id: string, path: string, body?: unknown) {
    if (pendingIds.current.has(id)) return;
    pendingIds.current.add(id); setPending(new Set(pendingIds.current)); setError(undefined);
    try { await request(path, 'POST', body); if (alive.current && currentThread.current === threadId) await refresh(); }
    catch (error) { if (alive.current && currentThread.current === threadId) setError(String(error)); }
    finally { pendingIds.current.delete(id); if (alive.current) setPending(new Set(pendingIds.current)); }
  }
  return <div className="max-h-96 space-y-3 overflow-y-auto px-4">
    {(error || pollError) && <p role="alert" className="text-sm text-destructive">{error || pollError}</p>}
    {inbox?.requests.filter(row => row.action.threadId === threadId && row.status === 'pending').map(row => <HyperApproval key={row.id} request={{ id: row.id, title: `${row.action.effect}: ${row.action.scope || row.action.toolRef}`, reason: row.action.policy?.reason, handOff: row.action.policy?.behaviour === 'hand_off', offersStandingRule: row.action.policy?.closed === false }} submitting={pending.has(row.id)} onDecide={(id, decision) => void save(id, `/api/approvals/${encodeURIComponent(id)}/decision`, { decision })} />)}
    {inbox?.questions.filter(row => row.threadId === threadId).map(row => <HyperQuestion key={row.id} id={row.id} parts={row.parts?.length ? row.parts : [{ header: '', question: row.question }]} submitting={pending.has(row.id)} onAnswer={(id, response) => void save(id, `/api/approvals/questions/${encodeURIComponent(id)}/respond`, { response })} onDismiss={id => void save(id, `/api/approvals/questions/${encodeURIComponent(id)}/dismiss`)} />)}
  </div>;
}
