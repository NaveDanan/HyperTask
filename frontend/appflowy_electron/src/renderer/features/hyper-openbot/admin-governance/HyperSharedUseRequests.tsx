// Adapted from OpenBot components/approvals/shared-use-requests and lib/plugins/shared-use.
// Copyright (c) 2026 CopilotKit. MIT licensed.
import { useEffect } from 'react';
import { Button } from '../../../components/ui/button';
import { hyperGovernanceRequest as request } from './HyperGovernanceApi';
import { HyperError, HyperStatus, useHyperAction, useHyperResource } from './HyperGovernanceUi';
type HyperAudience = { audience: string; outsideInput: boolean; members: { kind: string; value: string }[] };
function describe(a: HyperAudience | null) { if (!a) return 'Not approved'; return `${a.audience === 'owner' ? 'Only its owner' : a.audience === 'team' ? 'Everyone' : a.members.map(m => `${m.kind}: ${m.value}`).join(', ') || 'Nobody named'}${a.outsideInput ? ', and outside input' : ''}`; }
export function HyperSharedUseRequests() {
  const r = useHyperResource<{ requests: { id: string; botName: string; title: string; reason: string; current: HyperAudience | null; proposed: HyperAudience }[] }>('/api/approvals/shared-use');
  const a = useHyperAction(r.reload);
  useEffect(() => { const timer = setInterval(r.reload, 10000); return () => clearInterval(timer); }, []);
  return <section className="grid gap-3"><h3>Shared account requests</h3><HyperStatus resource={r}>{!r.data?.requests.length && <p>No requests waiting.</p>}{r.data?.requests.map(row => <article className="rounded border p-3" key={row.id}><strong>{row.botName} wants the shared {row.title} account</strong><p>{row.reason}</p><p>Now: {describe(row.current)}</p><p>Asked: {describe(row.proposed)}</p>{(['approve', 'decline'] as const).map(decision => <Button disabled={a.busy} key={decision} onClick={() => void a.run(() => request(`/api/approvals/shared-use/${encodeURIComponent(row.id)}/${decision}`, 'POST'))}>{decision === 'approve' ? 'Approve' : 'Decline'}</Button>)}</article>)}</HyperStatus><HyperError message={a.error} /></section>;
}
