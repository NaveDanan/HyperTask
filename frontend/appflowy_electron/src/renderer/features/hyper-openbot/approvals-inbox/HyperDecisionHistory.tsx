// Copyright (c) 2026 CopilotKit. MIT. See ../LICENSE and REUSE.md.
import { Button } from '@/components/ui/button';
import { HyperApproval } from '../activity';
import type { HyperApprovalInboxData, HyperApprovalDecision } from './HyperApprovalsApi';
import { HyperApprovalDetails } from './HyperApprovalPresentation';
const labels: Record<HyperApprovalDecision, string> = {
  allow_once: 'Allowed once', allow_conversation: 'Allowed for this conversation',
  allow_always: 'Always allowed', deny: 'Denied', handled: 'Done by you',
};
/** Decisions are answers, never a claim that the server completed the action. */
export function HyperDecisionHistory({ requests, open }: {
  requests: HyperApprovalInboxData['requests']; open(threadId: string): void;
}) {
  const rows = requests.filter(row => row.status !== 'pending').sort((a, b) => Date.parse(b.decidedAt ?? b.createdAt) - Date.parse(a.decidedAt ?? a.createdAt));
  return <details><summary>Previous decisions</summary>{!rows.length && <p>No decisions yet.</p>}{rows.map(row => <article key={row.id} className="space-y-2 rounded-lg border border-border p-4">
    <HyperApproval request={{ id: row.id, title: `${row.action.toolRef}: ${row.action.effect} · ${row.action.scope}`, reason: row.action.policy?.reason, answer: { label: row.decision ? labels[row.decision] : row.status, tone: row.decision === 'deny' ? 'negative' : 'positive' } }} onDecide={() => {}} />
    <p className="text-xs text-muted-foreground">{new Date(row.decidedAt ?? row.createdAt).toLocaleString()} · {row.status}</p>
    <HyperApprovalDetails args={row.action.args} />
    <Button variant="outline" onClick={() => open(row.action.threadId)}>Open conversation</Button>
  </article>)}</details>;
}
