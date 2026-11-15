// Adapted from OpenBot lib/app-grants and components/manage/describe-grants.tsx. Copyright (c) 2026 CopilotKit. MIT.
import { HyperBotGrantApi } from './HyperBotWorkflowApi';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { hyperOpenBotRequest as request } from '../transport';
import { useHyperAppResource } from '../connections/HyperAppResource';
import { HyperSharedApprovalFields } from '../connections/HyperPluginGrants';
import type { HyperSharedApproval } from '../connections/HyperPluginDetailsApi';
export interface HyperGrantTool { ref: string; name: string; effect: string; destructive: boolean; description: string; grantedTo: string[] }
export interface HyperGrantPreview { check: { ok: boolean; error?: string }; warning: string | null; changes: { added: { ref: string; name: string; effect: string; destructive: boolean }[]; removed: { ref: string; name: string }[] }; report: { calls: number; runs: number; callsLost: number; callsGained: number; addedUnusedWrites: { name: string }[] } | null }
export function HyperBotAppGrants({ agentId, app, onSaved, shared = false }: { agentId: string; app: string; onSaved: () => void; shared?: boolean }) {
  const state = useHyperAppResource(JSON.stringify([agentId, app, shared]), async () => {
    const [page, me, capabilities] = await Promise.all([
      request<{ servers: { id: string; accountMode?: string | null; tools: HyperGrantTool[] }[] }>('/api/plugins'),
      request<{ user: { id: string; role: string } }>('/api/me'), request<{ edition: string }>('/api/capabilities'),
    ]);
    if (!me.user?.id || !['personal', 'team'].includes(capabilities.edition)) throw new Error('Current actor and edition are required.');
    const server = page.servers.find(row => row.id === app);
    const sharedMode = server?.accountMode === 'shared';
    const sharedApps = sharedMode ? await request<{ apps: { serverId: string; approval: HyperSharedApproval | null; needed: HyperSharedApproval }[] }>(`/api/approvals/shared-use/bot/${encodeURIComponent(agentId)}`) : { apps: [] };
    const sharedApp = sharedApps.apps.find(row => row.serverId === app);
    const proposal = sharedApp ? sharedApp.approval ?? sharedApp.needed : undefined;
    if (proposal && (!['owner', 'people', 'team'].includes(proposal.audience) || typeof proposal.outsideInput !== 'boolean' || !Array.isArray(proposal.members) || proposal.members.some(member => !['user', 'group'].includes(member.kind) || !member.value))) throw new Error('Server-proposed exposure is unreadable.');
    return { userId: me.user.id, personal: capabilities.edition === 'personal', sharedMode, sharedDefault: proposal, admin: me.user.role === 'admin', tools: server?.tools ?? [] };
  });
  const [pendingGrant, setPendingGrant] = useState<string>();
  const [draft, setDraft] = useState<string[]>(); const [text, setText] = useState(''); const [explanation, setExplanation] = useState(''); const [preview, setPreview] = useState<HyperGrantPreview>(); const [translated, setTranslated] = useState(false);
  const [approval, setApproval] = useState<HyperSharedApproval>();
  const [confirmed, setConfirmed] = useState(false);
  const editEpoch = useRef(0);
  const epoch = editEpoch.current;
  useEffect(() => { editEpoch.current++; setPendingGrant(undefined); setDraft(undefined); setText(''); setExplanation(''); setPreview(undefined); setTranslated(false); setApproval(state.data?.sharedDefault); setConfirmed(false); readLock.current = undefined; setReading(false); }, [state.scope, state.data]);
  const held = state.data?.tools.filter(tool => tool.grantedTo.includes(agentId)).map(tool => tool.ref) ?? [];
  const grants = draft ?? held;
  const needsConfirmation = state.data?.sharedMode && (!!pendingGrant || !!preview && (translated || !!preview.changes.added.length));
  const proofCurrent = () => state.isCurrent() && state.data?.admin === true && !state.data.personal && editEpoch.current === epoch;
  const canSave = () => proofCurrent() && (!needsConfirmation || confirmed) && (!approval || approval.audience !== 'people' || approval.members.length > 0);
  const [reading, setReading] = useState(false);
  const readLock = useRef<object | undefined>(undefined);
  async function read(action: (valid: () => boolean) => Promise<void>) {
    if (!proofCurrent() || readLock.current) return;
    const token = {}; readLock.current = token; const readEpoch = ++editEpoch.current; setReading(true); setPreview(undefined); setConfirmed(false);
    const valid = () => state.isCurrent() && editEpoch.current === readEpoch && readLock.current === token;
    try { await action(valid); }
    catch { if (valid()) setExplanation('Could not check these actions. Try again.'); }
    finally { if (readLock.current === token) { readLock.current = undefined; setReading(false); } }
  }
  async function authorize(valid: () => boolean) {
    if (!valid()) return false;
    const [me, capabilities] = await Promise.all([request<{ user: { id: string; role: string } }>('/api/me'), request<{ edition: string }>('/api/capabilities')]);
    return valid() && me.user?.id === state.data?.userId && me.user.role === 'admin' && capabilities.edition === 'team';
  }
  const toggle = (ref: string, granted: boolean) => {
    if (!proofCurrent() || state.data?.personal || !state.data?.admin) return;
    editEpoch.current++; setPreview(undefined); setDraft(undefined); setConfirmed(false);
    if (granted && state.data.sharedMode) { setPendingGrant(ref); return; }
    void state.run(async valid => {
      if (!await authorize(valid)) return;
      if (granted) await request('/api/plugins/grants', 'POST', { kind: 'mcp', ref, agentId });
      else await request(`/api/plugins/grants?kind=mcp&ref=${encodeURIComponent(ref)}&agentId=${encodeURIComponent(agentId)}`, 'DELETE');
      if (valid()) onSaved();
    });
  };
  return <section className="grid gap-3 rounded-lg border border-border p-3"><h4>App actions</h4>{state.pending && <p role="status">Loading…</p>}{state.error && <p role="alert" className="text-destructive">{state.error}</p>}
    {state.data && (state.data.personal ? <p>Every Bot can use every app you connect. Disconnect or turn off the app in Connections to take it from all Bots.</p> : !state.data.admin ? <p>Only administrators can change app actions.</p> : app === 'routines' ? <><p>Always on for every Bot.</p>{state.data.tools.map(tool => <p key={tool.ref}>{tool.name} · {tool.description}</p>)}</> : <>
      <label>Describe allowed actions<Textarea value={text} onChange={e => { editEpoch.current++; setConfirmed(false); setText(e.target.value); setDraft(undefined); setPreview(undefined); setTranslated(false); }} /></label><Button disabled={reading || state.pending || !text.trim()} onClick={() => { if (!proofCurrent()) return; void read(async valid => {
        const result = await HyperBotGrantApi.translate<{ grants: string[]; explanation: string | null; warning: string | null; otherApps: string[]; check: { ok: boolean; error?: string } }>(agentId, app, text);
        if (!valid()) return;
        setPreview(undefined); setExplanation([result.explanation, result.warning, result.otherApps.length ? `Other apps unchanged: ${result.otherApps.join(', ')}` : '', result.check.error].filter(Boolean).join('\n'));
        if (result.check.ok) { setDraft(result.grants); setTranslated(true); }
      }); }}>Choose actions</Button><p className="whitespace-pre-wrap">{explanation}</p>
      {state.data.tools.length === 0 && <p>No actions advertised by this app.</p>}
      {state.data.tools.map(tool => <label key={tool.ref} className="grid gap-1"><span><input type="checkbox" disabled={reading || state.pending || Boolean(pendingGrant)} checked={held.includes(tool.ref)} onChange={e => toggle(tool.ref, e.target.checked)} />{tool.name} · {tool.effect}{tool.destructive ? ' · Destructive' : ''}</span><span className="text-sm text-muted-foreground">{tool.description}</span></label>)}
      <Button variant="outline" disabled={reading || state.pending || !draft} onClick={() => { if (!proofCurrent()) return; void read(async valid => { const result = await HyperBotGrantApi.replay<HyperGrantPreview>(agentId, app, grants); if (valid()) { setPreview(result); setConfirmed(false); } }); }}>Preview against recent activity</Button>
      {preview && <div><p>{preview.warning}</p>{!preview.check.ok && <p role="alert">{preview.check.error || 'These actions cannot be saved.'}</p>}<p>Added: {preview.changes.added.map(row => `${row.name}${row.destructive ? ' (destructive)' : ''}`).join(', ') || 'None'}</p><p>Removed: {preview.changes.removed.map(row => row.name).join(', ') || 'None'}</p>{preview.report && <p>{preview.report.calls} calls across {preview.report.runs} runs. {preview.report.callsLost} calls lost, {preview.report.callsGained} calls gained. Unused writes: {preview.report.addedUnusedWrites.map(row => row.name).join(', ') || 'None'}.</p>}</div>}
      {needsConfirmation && <div role="group" aria-label="Shared account exposure" className="space-y-2">
        <p>This Bot will act as the team account. Confirm who can use it and whether messages from outside can reach it before granting actions.</p>
        {state.data.sharedDefault && approval ? <HyperSharedApprovalFields value={approval} disabled={reading || state.pending} onChange={value => { editEpoch.current++; setApproval(value); setConfirmed(false); }} /> : <p>This Bot has not held this shared app, or already has an administrator approval. The server preserves that approval or resolves this Bot's current audience and outside input on the first grant. No client membership is supplied.</p>}
        <label><input type="checkbox" checked={confirmed} onChange={e => { if (proofCurrent()) { editEpoch.current++; setConfirmed(e.target.checked); } }} />Confirm shared account exposure for this change</label>
      </div>}

      {pendingGrant && <><Button disabled={reading || state.pending || !confirmed} onClick={() => {
        if (!canSave()) return;
        void state.run(async valid => { if (!await authorize(valid) || editEpoch.current !== epoch) return; await request('/api/plugins/grants', 'POST', { kind: 'mcp', ref: pendingGrant, agentId, ...(state.data?.sharedDefault && approval ? { approval } : {}) }); if (valid()) { setPendingGrant(undefined); onSaved(); } });
      }}>Approve audience and grant action</Button><Button variant="outline" disabled={reading || state.pending} onClick={() => { editEpoch.current++; setPendingGrant(undefined); setConfirmed(false); }}>Cancel action grant</Button></>}
      <Button disabled={reading || state.pending || Boolean(pendingGrant) || !preview?.check.ok || (!preview.changes.added.length && !preview.changes.removed.length) || needsConfirmation && !confirmed} onClick={() => {
        if (!canSave() || !preview?.check.ok || pendingGrant) return;
        void state.run(async valid => { if (!await authorize(valid) || editEpoch.current !== epoch) return; await HyperBotGrantApi.save(agentId, app, { add: preview.changes.added.map(row => row.ref), remove: preview.changes.removed.map(row => row.ref), ...(translated ? { authoring: { source: 'english', text } } : {}), ...(needsConfirmation && state.data?.sharedDefault && approval ? { approval } : {}) }); if (valid()) { setPreview(undefined); setDraft(undefined); onSaved(); } });
      }}>Save action changes</Button>
    </>)}
  </section>;
}
