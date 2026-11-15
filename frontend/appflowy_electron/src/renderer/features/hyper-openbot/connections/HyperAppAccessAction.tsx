// Adapted from OpenBot components/plugins/app-access-action.tsx, MIT Copyright (c) 2026 CopilotKit.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import * as api from './HyperAppAccessApi';
import { useHyperAccessRequestList } from './HyperAccessRequestList';
export interface HyperAppAccessActionProps { agentId: string; app: string; refusal?: 'connect' | 'reconnect' | 'shared'; admin?: boolean; onOpenConnection?(key: string): void }
export function HyperAppAccessAction({ agentId, app, refusal, admin = false, onOpenConnection }: HyperAppAccessActionProps) {
  const current = useRef({ agentId, app, admin, active: false, sequence: 0, busy: false, error: '', access: undefined as api.HyperAppAccess | undefined });
  if (current.current.agentId !== agentId || current.current.app !== app || current.current.admin !== admin) {
    current.current = { agentId, app, admin, active: false, sequence: 0, busy: false, error: '', access: undefined };
  }
  const scope = current.current;
  const [result, setResult] = useState<{ scope: typeof scope; access?: api.HyperAppAccess; busy: boolean; error: string }>();
  const access = result?.scope === scope ? result.access : undefined;
  const busy = result?.scope === scope && result.busy;
  const error = result?.scope === scope ? result.error : '';
  const isCurrent = () => current.current === scope && scope.active;
  const canAct = () => isCurrent() && !scope.busy && !!access && scope.access === access;
  function publish(error = '') {
    if (isCurrent()) { scope.error = error; setResult({ scope, access: scope.access, busy: scope.busy, error }); }
  }
  async function load(actionError = '') {
    if (!isCurrent()) return;
    const sequence = ++scope.sequence;
    try {
      const response = await api.hyperLoadAppAccess(agentId, app);
      if (!isCurrent() || sequence !== scope.sequence) return;
      scope.access = response.app;
      publish(actionError);
    } catch {
      if (isCurrent() && sequence === scope.sequence) publish(actionError || 'Could not load this app’s access state.');
    }
  }
  useEffect(() => {
    scope.active = true;
    scope.access = undefined;
    setResult(undefined);
    void load();
    return () => { scope.active = false; scope.sequence++; scope.access = undefined; };
  }, [agentId, app, admin]);
  async function run(action: () => Promise<unknown>) {
    if (!canAct()) return;
    scope.busy = true; publish();
    let failure = '';
    try { await action(); }
    catch { failure = 'Access could not be changed. Check the refreshed state and retry.'; }
    finally { await load(failure); scope.busy = false; publish(scope.error); }
  }
  const sentences = access ? { ready: access.accountHolder === 'owner' ? 'Ready using the Bot owner’s account.' : access.asksFirst ? 'Ready using your account. You will be asked before first use.' : 'Ready to use.', not_connected: 'Connect your own account.', reconnect: access.accountHolder === 'owner' ? 'The Bot owner must reconnect their account.' : 'Your account needs reconnecting.', shared_not_connected: 'An admin must connect the team account.', shared_not_approved: 'An admin must approve this Bot’s audience for the team account.', disabled: access.unavailable === 'absent' ? 'This app has not been enabled.' : 'This app needs setup before it can be used.', not_granted: 'An admin must give this app to the Bot.', owner_grantable: access.needsConnect ? 'Connect your own account before giving it to your Bot.' : 'Let your Bot use this app?' } : undefined;
  return <div className="space-y-2 rounded-lg border border-border p-3">{error && <p role="alert" className="text-destructive">{error}</p>}{!access ? <p role="status">Loading app access…</p> : <><p>{access.displayName} · {access.state === 'ready' && refusal ? 'This call was refused. Refresh the connection and retry the task.' : sentences?.[access.state]}</p>{access.request ? <><p>Requested</p><Button disabled={busy} variant="outline" onClick={() => void run(() => api.hyperCancelAppAccess(access.request!.id))}>Withdraw request</Button></> : access.requestKind && !admin ? <Button disabled={busy} onClick={() => void run(() => api.hyperRequestAppAccess(agentId, app))}>Request access</Button> : null}
    {access.state === 'owner_grantable' && !access.needsConnect && <Button disabled={busy} onClick={() => void run(() => api.hyperGiveApp(agentId, app))}>Let it use your app</Button>}{access.givenByOwner && <Button disabled={busy} variant="outline" onClick={() => void run(() => api.hyperGiveApp(agentId, app, false))}>Take back what you gave</Button>}
    {admin && ['disabled', 'not_granted'].includes(access.state) && <Button disabled={busy} onClick={() => void run(() => api.hyperApproveBotApp(agentId, app))}>Enable and grant read-only access</Button>}{onOpenConnection && access.state !== 'ready' && access.accountHolder !== 'owner' && <Button variant="outline" disabled={busy} onClick={() => { if (canAct()) onOpenConnection(access.key); }}>Open app setup and connection</Button>}<Button variant="ghost" disabled={busy} onClick={() => { if (canAct()) void load(); }}>Refresh access</Button></>}
  </div>;
}
export function HyperAppAccessRequests({ app, busy, run }: { app: string; busy: boolean; run(action: () => Promise<void>): Promise<void> }) {
  const { requests, failed, decide } = useHyperAccessRequestList(app, busy, async () => (await api.hyperLoadAppRequests(app)).requests.filter(request => request.appKey === app));
  return <div className="space-y-3"><h2>App access requests</h2>{failed && <p role="alert">Could not load app access requests.</p>}{!requests && !failed && <p role="status">Loading app access requests…</p>}{requests?.length === 0 && <p>No app access requests.</p>}{requests?.map(request => <div key={request.id} className="space-y-2 rounded-lg border border-border p-3"><p>{request.requesterName ?? request.requesterEmail ?? 'Person'} · {request.botName ?? 'Bot'} · {request.kind}</p><p>Approval enables the app and grants read-only actions. Setup requirements can refuse the request after a partial change.</p>{(['approve', 'dismiss'] as const).map(decision => <Button key={decision} disabled={busy} variant={decision === 'approve' ? 'default' : 'outline'} onClick={() => void decide(request, () => api.hyperDecideAppRequest(request.id, decision), run)}>{decision === 'approve' ? 'Approve read-only access' : 'Dismiss request'}</Button>)}</div>)}</div>;
}
