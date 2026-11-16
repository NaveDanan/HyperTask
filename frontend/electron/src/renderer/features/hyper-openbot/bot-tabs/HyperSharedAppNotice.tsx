// Adapted from OpenBot components/plugins/shared-app-notice.tsx. Copyright (c) 2026 CopilotKit. MIT.
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest as request } from '../transport';
import { useHyperBotResource } from './HyperBotResource';
export function HyperSharedAppNotice({ agentId }: { agentId: string }) {
  const state = useHyperBotResource(async () => {
    const [shared, me] = await Promise.all([request<{ apps: { serverId: string; title: string; covered: boolean }[]; pending: { serverId: string }[] }>(`/api/approvals/shared-use/bot/${encodeURIComponent(agentId)}`), request<{ user: { role: string } }>('/api/me')]);
    return { ...shared, admin: me.user.role === 'admin' };
  }, agentId);
  return <div className="grid gap-2 text-sm">{state.error && <p role="alert" className="text-destructive">{state.error}</p>}{state.pending && <p role="status">Checking shared accounts…</p>}{state.data?.apps.map(app => state.data!.admin ? <p key={app.serverId}>Saving also lets everyone who can use this Bot use the shared {app.title} account.</p> : state.data!.pending.some(row => row.serverId === app.serverId) ? <p key={app.serverId}>Waiting for an admin to approve the shared {app.title} account.</p> : app.covered ? null : <div key={app.serverId}><p>This Bot cannot use the shared {app.title} account until an administrator approves who can use the Bot.</p><Button type="button" variant="outline" disabled={state.pending} onClick={() => void state.run(() => request('/api/approvals/shared-use', 'POST', { botId: agentId, serverId: app.serverId, reason: 'publish' }))}>Request approval</Button></div>)}</div>;
}
