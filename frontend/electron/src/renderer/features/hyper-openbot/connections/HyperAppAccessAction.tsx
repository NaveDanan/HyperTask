// Adapted from OpenBot components/plugins/app-access-action.tsx, MIT Copyright (c) 2026 CopilotKit.
import { useEffect, useRef, useState } from 'react';
import type { HyperAppSetupIntent } from '../HyperOpenBotSections';
import { Button } from '@/components/ui/button';
import { useHyperRoutineNavigation } from '../routines/HyperRoutineNavigation';
import { hyperConnectionSelectionPath } from './HyperNativeConnections';
import { hyperAuthorizationUrl, hyperStartConnection } from './HyperConnectionsApi';
import { hyperConfirmConnection } from './HyperPluginDetailsApi';
import { hyperOpenBotRequest } from '../transport';
import { hyperInvalidateAppAccess, hyperSubscribeAppAccess, hyperWatchPendingConnection } from './HyperAccessRefresh';
import * as api from './HyperAppAccessApi';
import { useHyperAccessRequestList } from './HyperAccessRequestList';
export interface HyperAppCarryOn {
  key: string;
  blockedWhenAsked: boolean;
  latest(): boolean;
  /** Resume the actual channel core without manufacturing a user message. False means gated. */
  resume(): Promise<boolean>;
}
export interface HyperAppAccessActionProps { agentId: string; app: string; refusal?: 'connect' | 'reconnect' | 'shared'; refusalAt?: string; admin?: boolean; deriveAdmin?: boolean; onOpenConnection?(key: string, intent?: HyperAppSetupIntent): void; onSettled?(): void; carryOn?: HyperAppCarryOn }
const carried = new Set<string>();
export function HyperAppAccessAction({ agentId, app, refusal, refusalAt, admin: adminOverride, deriveAdmin = false, onOpenConnection, onSettled, carryOn }: HyperAppAccessActionProps) {
  const navigation = useHyperRoutineNavigation();
  const [actorAdmin, setActorAdmin] = useState(false);
  const admin = adminOverride ?? actorAdmin;
  const current = useRef({ agentId, app, admin, active: false, sequence: 0, busy: false, error: '', access: undefined as api.HyperAppAccess | undefined, pendingGive: false, pendingActor: '', waiting: false, sawBlocked: false, carried: false });
  if (current.current.agentId !== agentId || current.current.app !== app || current.current.admin !== admin) {
    current.current = { agentId, app, admin, active: false, sequence: 0, busy: false, error: '', access: undefined, pendingGive: false, pendingActor: '', waiting: false, sawBlocked: false, carried: false };
  }
  const scope = current.current;
  const [result, setResult] = useState<{ scope: typeof scope; access?: api.HyperAppAccess; busy: boolean; error: string }>();
  const liveAccess = result?.scope === scope ? result.access : undefined;
  const access = liveAccess ? api.hyperAppAccessAsRefused(liveAccess, refusal, refusalAt) : undefined;
  const resultBusy = result?.scope === scope && result.busy;
  const error = result?.scope === scope ? result.error : '';
  const isCurrent = () => current.current === scope && scope.active && navigation?.isCurrentNavigation?.() !== false;
  const canRead = () => isCurrent() && !scope.busy;
  const canAct = () => isCurrent() && !scope.busy && !!liveAccess && scope.access === liveAccess;
  function publish(error = '') {
    if (isCurrent()) { scope.error = error; setResult({ scope, access: scope.access, busy: scope.busy, error }); }
  }
  async function load(actionError = '') {
    if (!isCurrent()) return;
    const sequence = ++scope.sequence;
    publish(actionError);
    try {
      const response = await api.hyperLoadAppAccess(agentId, app);
      if (!isCurrent() || sequence !== scope.sequence) return;
      scope.access = response.app;
      if (scope.pendingGive && (response.app.state !== 'owner_grantable' || response.app.account !== 'personal' || response.app.accountHolder !== 'you')) { scope.pendingGive = false; scope.waiting = false; }
      if (scope.pendingGive && contextRef.current && response.app.state === 'owner_grantable' && response.app.account === 'personal' && response.app.accountHolder === 'you' && !response.app.needsConnect) {
        scope.pendingGive = false; scope.waiting = false;
        const authority = contextRef.current;
        if (authority.userId !== scope.pendingActor || !await verifyAuthority(authority) || !isCurrent() || sequence !== scope.sequence) return;
        try { await api.hyperGiveApp(agentId, response.app.key); }
        finally { hyperInvalidateAppAccess(); if (isCurrent()) onSettled?.(); }
        if (!isCurrent()) return;
        const after = ++scope.sequence;
        const refreshed = await api.hyperLoadAppAccess(agentId, app);
        if (isCurrent() && after === scope.sequence) { scope.access = refreshed.app; publish(actionError); }
        return;
      }
      if (!isCurrent() || sequence !== scope.sequence) return;
      if (scope.access?.state === 'ready') scope.waiting = false;
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
    return () => { scope.active = false; scope.sequence++; scope.access = undefined; scope.pendingGive = false; scope.waiting = false; };
  }, [scope]);
  useEffect(() => { if (!deriveAdmin || adminOverride !== undefined) return; let active = true; setActorAdmin(false); void api.hyperReadAppAccessActor().then(actor => { if (active) setActorAdmin(actor.user.role === 'admin'); }).catch(() => { if (active) setActorAdmin(false); }); return () => { active = false; }; }, [deriveAdmin, adminOverride, agentId, app]);
  // Older protocol responses can still be drawn, but connecting requires the current deployment
  // and actor facts. Neither the selected Bot nor an admin prop supplies account ownership.
  const [authority, setAuthority] = useState<{ scope: typeof scope; userId: string; role: string; edition: 'personal' | 'team'; broker: boolean }>();
  const context = authority?.scope === scope ? authority : undefined;
  const busy = resultBusy || Boolean(liveAccess?.account && !context);
  const allowedAdmin = context ? context.role === 'admin' : admin;
  const contextRef = useRef(context); contextRef.current = context;
  useEffect(() => {
    if (!liveAccess?.account) return;
    let active = true; let read = 0;
    const refresh = async () => {
      const ticket = ++read;
      try {
        const [me, capabilities, directory] = await Promise.all([
          hyperOpenBotRequest<{ user: { id: string; role: string } }>('/api/me'),
          hyperOpenBotRequest<{ edition: 'personal' | 'team' }>('/api/capabilities'),
          hyperOpenBotRequest<{ composioConfigured?: boolean }>('/api/plugins'),
        ]);
        if (!active || !isCurrent() || ticket !== read) return;
        if (!me.user?.id || !['personal', 'team'].includes(capabilities.edition)) throw new Error('Identity unavailable');
        const previous = contextRef.current;
        if (previous && (previous.userId !== me.user.id || previous.edition !== capabilities.edition || previous.role !== me.user.role)) {
          scope.pendingGive = false; scope.waiting = false; scope.active = false;
          contextRef.current = undefined; setAuthority(undefined); return;
        }
        if (deriveAdmin && adminOverride === undefined) setActorAdmin(me.user.role === 'admin');
        if (!previous || previous.broker !== (directory.composioConfigured === true)) setAuthority({ scope, userId: me.user.id, role: me.user.role, edition: capabilities.edition, broker: directory.composioConfigured === true });
      } catch { if (active && ticket === read) { scope.pendingGive = false; scope.waiting = false; contextRef.current = undefined; setAuthority(undefined); } }
    };
    void refresh(); window.addEventListener('focus', refresh);
    return () => { active = false; read++; window.removeEventListener('focus', refresh); };
  }, [scope, Boolean(liveAccess?.account)]);
  useEffect(() => {
    const refresh = () => { if (canRead()) void load(); };
    const unsubscribe = hyperSubscribeAppAccess(change => { if (change?.requestOnly && (change.agentId !== agentId || change.app !== app)) return; scope.sequence++; refresh(); });
    window.addEventListener('focus', refresh);
    // Main's state signal invalidates deferred renderer callbacks at the auth/service boundary.
    const off = window.hypertask?.hyperOpenBot?.service?.onState?.(state => {
      if (!state.ready) { scope.active = false; scope.pendingGive = false; scope.waiting = false; scope.sequence++; }
      else if (current.current === scope && !scope.active) { current.current = { ...scope, active: false, busy: false, sequence: 0, access: undefined, pendingGive: false, waiting: false, sawBlocked: false, carried: false }; setResult(undefined); }
    });
    return () => { unsubscribe(); off?.(); window.removeEventListener('focus', refresh); };
  }, [scope]);
  useEffect(() => {
    if (!scope.waiting || !context) return;
    const timer = setInterval(() => { void checkConnection(); }, 2000);
    const offReturn = hyperWatchPendingConnection(() => { if (!isCurrent() || !scope.waiting) return false; void checkConnection(); return true; });
    return () => { clearInterval(timer); offReturn(); };
  }, [scope, scope.waiting, context]);
  function openSetup(value: api.HyperAppAccess, duringTransaction = false) {
    if (!(duringTransaction ? isCurrent() : canAct())) return;
    const adminSetup = allowedAdmin && (value.account === 'shared' || value.state === 'disabled' && value.unavailable !== null && value.unavailable !== 'absent');
    const provider = value.unavailable === 'composio_unconfigured' && (value.provider === 'arcade' || value.provider === 'composio') ? value.provider : undefined;
    const selection = provider ? { page: 'browse' as const, provider } : { page: 'app' as const, key: value.key };
    const intent = { admin: adminSetup, ...(provider ? { provider } : {}) };
    if (navigation?.openAppConnection) { navigation.openAppConnection(value.key, intent); }
    else if (adminSetup && navigation?.navigate) {
      navigation.navigate('admin-plugins', { path: hyperConnectionSelectionPath(selection, true) });
    } else if (onOpenConnection) {
      if (adminSetup || provider) onOpenConnection(value.key, intent); else onOpenConnection(value.key);
    } else navigation?.navigate?.('connections', { path: hyperConnectionSelectionPath(selection) });
  }
  async function verifyAuthority(expected: NonNullable<typeof context>) {
    if (!isCurrent() || contextRef.current !== expected) return false;
    try {
    const [me, capabilities] = await Promise.all([
      hyperOpenBotRequest<{ user: { id: string; role: string } }>('/api/me'),
      hyperOpenBotRequest<{ edition: string }>('/api/capabilities'),
    ]);
    if (!isCurrent() || contextRef.current !== expected) return false;
    if (me.user?.id !== expected.userId || me.user.role !== expected.role || capabilities.edition !== expected.edition) {
      scope.pendingGive = false; scope.waiting = false; scope.active = false; contextRef.current = undefined; setAuthority(undefined); return false;
    }
    return true;
    } catch { if (isCurrent()) { scope.pendingGive = false; scope.waiting = false; contextRef.current = undefined; setAuthority(undefined); publish('Could not verify the current account. Reopen this app to retry.'); } return false; }
  }
  async function checkConnection() {
    if (!canRead() || !scope.waiting || !context || contextRef.current !== context) return;
    scope.busy = true; publish();
    let error = '';
    try {
      if (!await verifyAuthority(context)) return;
      // Only a configured broker has this confirmation protocol. OAuth callbacks remain main-owned.
      if (context.broker && ['composio', 'arcade'].includes(scope.access?.provider ?? '')) {
        if (!isCurrent()) return;
        await hyperConfirmConnection(scope.access!.key);
      }
      if (isCurrent()) await load();
    } catch { error = 'Could not confirm the connection. Refresh to retry.'; }
    finally { scope.busy = false; publish(error); }
  }
  async function connect(personal = false, give = false) {
    if (!canAct() || !context || contextRef.current !== context || access?.accountHolder === 'owner') return;
    scope.pendingGive = give; scope.pendingActor = context.userId;
    await run(async () => {
      if (!await verifyAuthority(context)) return;
      let now = liveAccess!;
      if (personal) {
        await api.hyperApproveBotApp(agentId, now.key);
        if (!isCurrent() || contextRef.current !== context) return;
        now = (await api.hyperLoadAppAccess(agentId, app)).app;
        if (!isCurrent()) return;
      }
      if (!personal) { now = (await api.hyperLoadAppAccess(agentId, app)).app; if (!isCurrent()) return; }
      if (now.state === 'ready') return;
      if (now.account !== 'personal' || now.accountHolder !== 'you' || !['not_connected', 'reconnect', 'owner_grantable'].includes(now.state)) { scope.pendingGive = false; return; }
      if (now.connect !== 'oauth' && now.connect !== 'consent') { scope.pendingGive = false; openSetup(now, true); return; }
      if (!await verifyAuthority(context)) return;
      const started = await hyperStartConnection(now.key);
      if (!isCurrent() || contextRef.current !== context) return;
      if (started.authorizationUrl) {
        await window.hypertask.shell.openExternal(hyperAuthorizationUrl(started.authorizationUrl));
        if (isCurrent()) scope.waiting = true;
      } else if (started.connected === true) scope.waiting = true;
      else if (started.fields) { scope.pendingGive = false; openSetup(now, true); }
      else throw new Error('Connection unavailable');
    });
  }
  const [sharedGrant, setSharedGrant] = useState<{ scope: typeof scope; access: api.HyperAppAccess; action: 'give' | 'approve'; exposure?: import('./HyperPluginDetailsApi').HyperSharedApproval }>();
  const sharedGrantRef = useRef(sharedGrant); sharedGrantRef.current = sharedGrant;
  async function beginGrant(action: 'give' | 'approve') {
    if (!canAct() || !access) return;
    if (access.account !== 'shared') { await run(() => action === 'give' ? api.hyperGiveApp(agentId, app) : api.hyperApproveBotApp(agentId, app)); return; }
    if (!context || action === 'approve' && !allowedAdmin) return;
    const snapshot = liveAccess;
    scope.busy = true; publish();
    const ticket = ++scope.sequence;
    try {
      if (!await verifyAuthority(context)) return;
      const page = await hyperOpenBotRequest<{ apps: { serverId: string; approval: import('./HyperPluginDetailsApi').HyperSharedApproval | null; needed: import('./HyperPluginDetailsApi').HyperSharedApproval }[] }>(`/api/approvals/shared-use/bot/${encodeURIComponent(agentId)}`);
      if (!isCurrent() || ticket !== scope.sequence || scope.access !== snapshot) return;
      const row = page.apps.find(value => value.serverId === access.key);
      const proposal = { scope, access: snapshot!, action, exposure: row?.approval ?? row?.needed };
      sharedGrantRef.current = proposal; setSharedGrant(proposal);
    } catch { publish('Could not load this Bot’s shared account exposure. Retry the grant.'); }
    finally { scope.busy = false; publish(scope.error); }
  }
  async function confirmSharedGrant() {
    if (!canAct() || !sharedGrant || sharedGrant.scope !== scope || sharedGrant.access !== scope.access || sharedGrantRef.current !== sharedGrant) return;
    sharedGrantRef.current = undefined; setSharedGrant(undefined);
    await run(() => sharedGrant.action === 'give' ? api.hyperGiveApp(agentId, app) : api.hyperApproveBotApp(agentId, app));
  }
  const carryRef = useRef(carryOn); carryRef.current = carryOn;
  async function resume() {
    const intent = carryRef.current;
    const key = intent && `${context?.userId ?? ''}:${intent.key}`;
    if (!context || !isCurrent() || scope.busy || scope.carried || scope.access !== liveAccess || access?.state !== 'ready' || !intent || intent !== carryOn || !intent.latest() || !key || carried.has(key)) return;
    if (!await verifyAuthority(context) || !isCurrent() || carryRef.current !== intent || scope.access !== liveAccess || !intent.latest() || carried.has(key)) return;
    carried.add(key); scope.carried = true; publish();
    try { if (!await intent.resume()) { carried.delete(key); scope.carried = false; publish(); } }
    catch { publish('The task could not continue. Reopen the conversation to retry.'); }
  }
  useEffect(() => {
    if (!isCurrent() || !carryOn) return;
    if (access && access.state !== 'ready') scope.sawBlocked = true;
    else if (access?.state === 'ready' && scope.sawBlocked && carryOn.latest()) void resume();
  }, [scope, access, carryOn, busy, context]);
  async function run(action: () => Promise<unknown>, requestOnly = false) {
    if (!canAct() || liveAccess?.account && !context || context && contextRef.current !== context) return;
    scope.busy = true; publish();
    let failure = '';
    try { if (!context || await verifyAuthority(context)) { if (isCurrent()) await action(); } }
    catch { scope.pendingGive = false; scope.waiting = false; failure = 'Access could not be changed. Check the refreshed state and retry.'; }
    finally { hyperInvalidateAppAccess(requestOnly ? { requestOnly: true, agentId, app } : undefined); if (isCurrent()) onSettled?.(); await load(failure); scope.busy = false; publish(scope.error); }
  }
  const personal = context?.edition === 'personal';
  const personalConnect = personal && (access?.state === 'not_granted' || access?.state === 'disabled' && (access.unavailable === null || access.unavailable === 'absent'));
  const sentences = access ? { ready: access.accountHolder === 'owner' ? 'Ready using the Bot owner’s account.' : access.asksFirst ? 'Ready using your account. You will be asked before first use.' : 'Ready to use.', not_connected: 'Connect your own account.', reconnect: access.accountHolder === 'owner' ? 'The Bot owner must reconnect their account.' : 'Your account needs reconnecting.', shared_not_connected: refusal === 'shared' && !access.requestKind ? 'An admin must reconnect the team account.' : 'An admin must connect the team account.', shared_not_approved: 'An admin must approve this Bot’s audience for the team account.', disabled: access.unavailable === 'absent' ? 'This app has not been enabled.' : 'This app needs setup before it can be used.', not_granted: 'An admin must give this app to the Bot.', owner_grantable: access.needsConnect ? 'Connect your own account before giving it to your Bot.' : 'Let your Bot use this app?' } : undefined;
  return <div className="space-y-2 rounded-lg border border-border p-3">{error && <p role="alert" className="text-destructive">{error}</p>}{!access ? error ? <Button disabled={busy} variant="outline" onClick={() => { if (canRead()) void load(); }}>Retry access</Button> : <p role="status">Loading app access…</p> : <><p>{access.displayName} · {sentences?.[access.state]}</p>{access.request ? <><p>Requested</p><Button disabled={busy} variant="outline" onClick={() => void run(() => api.hyperCancelAppAccess(access.request!.id), true)}>Withdraw request</Button></> : access.requestKind && !allowedAdmin ? <Button disabled={busy} onClick={() => void run(() => api.hyperRequestAppAccess(agentId, app), true)}>Request access</Button> : null}
    {personalConnect && <Button disabled={busy} onClick={() => void connect(true)}>Connect app</Button>}{context && !personalConnect && (access.state === 'not_connected' || access.state === 'reconnect') && access.accountHolder === 'you' && (access.connect === 'oauth' || access.connect === 'consent') && <Button disabled={busy} onClick={() => void connect()}>Connect account</Button>}{context && access.state === 'owner_grantable' && access.needsConnect && <Button disabled={busy || scope.waiting} onClick={() => void connect(false, true)}>Connect and allow</Button>}{scope.waiting && <><p role="status">Finish signing in in your browser. Waiting for the server to confirm the account.</p><Button disabled={busy} variant="outline" onClick={() => void checkConnection()}>Check connection</Button><Button disabled={busy} variant="outline" onClick={() => { if (isCurrent()) { scope.waiting = false; scope.pendingGive = false; publish(); } }}>Cancel connection wait</Button></>}{carryOn && access.state === 'ready' && !scope.carried && !carried.has(`${context?.userId ?? ''}:${carryOn.key}`) && carryOn.blockedWhenAsked && carryOn.latest() && <Button disabled={busy} onClick={() => void resume()}>Continue</Button>}{access.state === 'owner_grantable' && !access.needsConnect && <Button disabled={busy} onClick={() => void beginGrant('give')}>Let it use your app</Button>}{access.givenByOwner && !personal && <Button disabled={busy} variant="outline" onClick={() => void run(() => api.hyperGiveApp(agentId, app, false))}>Take back what you gave</Button>}
    {allowedAdmin && !personalConnect && (access.state === 'not_granted' || access.state === 'disabled' && (access.unavailable === null || access.unavailable === 'absent')) && <Button disabled={busy} onClick={() => void beginGrant('approve')}>Enable and grant read-only access</Button>}{(onOpenConnection || navigation?.navigate || navigation?.openAppConnection) && access.state !== 'ready' && access.accountHolder !== 'owner' && <Button variant="outline" disabled={busy} onClick={() => { openSetup(access); }}>Open app setup and connection</Button>}{sharedGrant?.scope === scope && sharedGrant.access === liveAccess && <div role="alertdialog" aria-label="Confirm shared account grant" className="space-y-2 rounded-lg border border-border p-3"><p>This Bot will use the team account. Confirm that its server-resolved audience and outside input may use that account. Existing administrator decisions are preserved.</p>{sharedGrant.exposure ? <p>Server exposure: {sharedGrant.exposure.audience} · Outside input: {sharedGrant.exposure.outsideInput ? 'yes' : 'no'} · {sharedGrant.exposure.members.map(member => `${member.kind}: ${member.value}`).join(', ')}</p> : <p>This Bot has not held the app. The server resolves its current audience and outside input on the first grant.</p>}<Button disabled={busy} onClick={() => void confirmSharedGrant()}>Confirm shared account grant</Button><Button disabled={busy} variant="outline" onClick={() => { if (isCurrent()) { sharedGrantRef.current = undefined; setSharedGrant(undefined); } }}>Cancel shared grant</Button></div>}<Button variant="ghost" disabled={busy} onClick={() => { if (canRead()) void load(); }}>Refresh access</Button></>}
  </div>;
}
export function HyperAppAccessRequests({ app, busy, run }: { app: string; busy: boolean; run(action: () => Promise<void>): Promise<void> }) {
  const { requests, failed, decide } = useHyperAccessRequestList(app, busy, async () => (await api.hyperLoadAppRequests(app)).requests.filter(request => request.appKey === app));
  return <div className="space-y-3"><h2>App access requests</h2>{failed && <p role="alert">Could not load app access requests.</p>}{!requests && !failed && <p role="status">Loading app access requests…</p>}{requests?.length === 0 && <p>No app access requests.</p>}{requests?.map(request => <div key={request.id} className="space-y-2 rounded-lg border border-border p-3"><p>{request.requesterName ?? request.requesterEmail ?? 'Person'} · {request.botName ?? 'Bot'} · {request.kind}</p><p>Approval enables the app and grants read-only actions. For a shared account, this confirms that the Bot’s server-resolved audience and outside input may use it, preserving existing administrator decisions. Setup requirements can refuse the request after a partial change.</p>{(['approve', 'dismiss'] as const).map(decision => <Button key={decision} disabled={busy} variant={decision === 'approve' ? 'default' : 'outline'} onClick={() => void decide(request, () => api.hyperDecideAppRequest(request.id, decision), run)}>{decision === 'approve' ? 'Approve read-only access' : 'Dismiss request'}</Button>)}</div>)}</div>;
}
