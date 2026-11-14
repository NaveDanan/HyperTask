// Adapted from OpenBot lib/approvals.ts and components/approvals. Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useState } from 'react';
import { HyperApproval, HyperQuestion, type HyperQuestionPart } from './activity';
import { hyperOpenBotRequest as request } from './transport';
type HyperInbox = {
  requests: { id: string; status: string; action: { threadId: string; toolRef: string; effect: string; scope: string; policy?: { behaviour: string; reason: string; closed?: boolean } } }[];
  questions: { id: string; threadId: string; channelId?: string; question: string; parts?: HyperQuestionPart[] }[];
};
export function HyperConversationActions({ threadId }: { threadId: string }) {
  const [inbox, setInbox] = useState<HyperInbox>();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  async function refresh() { try { setInbox(await request<HyperInbox>('/api/approvals')); } catch (error) { setError(String(error)); } }
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 4000); return () => clearInterval(timer); }, [threadId]);
  async function save(id: string, path: string, body?: unknown) {
    setPending(id); setError(undefined);
    try { await request(path, 'POST', body); await refresh(); }
    catch (error) { setError(String(error)); }
    finally { setPending(undefined); }
  }
  return <div className="max-h-96 space-y-3 overflow-y-auto px-4">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {inbox?.requests.filter(row => row.action.threadId === threadId && row.status === 'pending').map(row => <HyperApproval key={row.id} request={{ id: row.id, title: `${row.action.effect}: ${row.action.scope || row.action.toolRef}`, reason: row.action.policy?.reason, handOff: row.action.policy?.behaviour === 'hand_off', offersStandingRule: row.action.policy?.closed === false }} submitting={pending === row.id} onDecide={(id, decision) => void save(id, `/api/approvals/${encodeURIComponent(id)}/decision`, { decision })} />)}
    {inbox?.questions.filter(row => row.threadId === threadId).map(row => <HyperQuestion key={row.id} id={row.id} parts={row.parts?.length ? row.parts : [{ header: '', question: row.question }]} submitting={pending === row.id} onAnswer={(id, response) => void save(id, `/api/approvals/questions/${encodeURIComponent(id)}/respond`, { response })} onDismiss={id => void save(id, `/api/approvals/questions/${encodeURIComponent(id)}/dismiss`)} />)}
  </div>;
}
