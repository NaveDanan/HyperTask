// Adapted from OpenBot components/plugins/access-requests.tsx and lib/plugins/shared-use.ts.
// MIT Copyright (c) 2026 CopilotKit.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest } from '../transport';
import type { HyperSharedApproval } from './HyperPluginDetailsApi';
interface HyperAccessRequest { id: string; serverId: string; botName: string; reason: string; proposed: HyperSharedApproval; current: HyperSharedApproval | null }
export function HyperSharedAccessRequests({ serverId, busy, run }: { serverId: string; busy: boolean; run(action: () => Promise<void>): Promise<void> }) {
  const [requests, setRequests] = useState<HyperAccessRequest[]>();
  const [failed, setFailed] = useState(false);
  async function load() { try { setRequests((await hyperOpenBotRequest<{ requests: HyperAccessRequest[] }>('/api/approvals/shared-use')).requests.filter(r => r.serverId === serverId)); setFailed(false); } catch { setFailed(true); } }
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 10000); return () => clearInterval(timer); }, [serverId]);
  return <div className="space-y-3"><h2>Shared account access requests</h2>{failed && <p role="alert">Could not load access requests.</p>}{requests?.length === 0 && <p>No pending requests.</p>}{requests?.map(request => <div key={request.id} className="space-y-2 rounded-lg border border-border p-3"><p>{request.botName} · {request.reason}</p><p>Requested audience: {request.proposed.audience} · Outside input: {request.proposed.outsideInput ? 'yes' : 'no'}</p><p>{request.proposed.members.map(m => `${m.kind}: ${m.value}`).join(', ')}</p>{request.current && <p>Current audience: {request.current.audience} · Outside input: {request.current.outsideInput ? 'yes' : 'no'}</p>}{(['approve', 'decline'] as const).map(decision => <Button key={decision} disabled={busy} variant={decision === 'approve' ? 'default' : 'outline'} onClick={() => void run(async () => { try { await hyperOpenBotRequest(`/api/approvals/shared-use/${encodeURIComponent(request.id)}/${decision}`, 'POST'); } finally { await load(); } })}>{decision === 'approve' ? 'Approve requested access' : 'Decline'}</Button>)}</div>)}</div>;
}
