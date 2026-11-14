// Adapted from OpenBot lib/app-grants and components/manage/describe-grants.tsx. Copyright (c) 2026 CopilotKit. MIT.
import { HyperBotGrantApi } from './HyperBotWorkflowApi';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { hyperOpenBotRequest as request } from '../transport';
import { useHyperBotResource } from './HyperBotResource';
export interface HyperGrantTool { ref: string; name: string; effect: string; destructive: boolean; description: string; grantedTo: string[] }
export interface HyperGrantPreview { check: { ok: boolean; error?: string }; warning: string | null; changes: { added: { ref: string; name: string; effect: string; destructive: boolean }[]; removed: { ref: string; name: string }[] }; report: { calls: number; runs: number; callsLost: number; callsGained: number; addedUnusedWrites: { name: string }[] } | null }
export function HyperBotAppGrants({ agentId, app, onSaved, shared = false }: { agentId: string; app: string; onSaved: () => void; shared?: boolean }) {
  const state = useHyperBotResource(async () => {
    const [page, me, sharedApps] = await Promise.all([request<{ servers: { id: string; tools: HyperGrantTool[] }[] }>('/api/plugins'), request<{ user: { role: string } }>('/api/me'), shared ? request<{ apps: { serverId: string; approval: unknown; needed: { audience: string; outsideInput: boolean; members: { kind: string; value: string }[] } }[] }>(`/api/approvals/shared-use/bot/${encodeURIComponent(agentId)}`) : Promise.resolve({ apps: [] })]);
    const sharedApp = sharedApps.apps.find(row => row.serverId === app);
    return { sharedDefault: sharedApp && !sharedApp.approval ? sharedApp.needed : undefined, admin: me.user.role === 'admin', tools: page.servers.find(row => row.id === app)?.tools ?? [] };
  }, `${agentId}:${app}`);
  const [pendingGrant, setPendingGrant] = useState<string>();
  const [draft, setDraft] = useState<string[]>(); const [text, setText] = useState(''); const [explanation, setExplanation] = useState(''); const [preview, setPreview] = useState<HyperGrantPreview>(); const [translated, setTranslated] = useState(false);
  const [audience, setAudience] = useState(''); const [outsideInput, setOutside] = useState<boolean>(); const [includeApproval, setIncludeApproval] = useState(false);
  const selectedAudience = audience || state.data?.sharedDefault?.audience || 'owner';
  const selectedOutside = outsideInput ?? state.data?.sharedDefault?.outsideInput ?? false;
  const members = state.data?.sharedDefault?.members ?? [];
  const named = state.data?.sharedDefault?.audience === 'people' || members.length > 0;
  const held = state.data?.tools.filter(tool => tool.grantedTo.includes(agentId)).map(tool => tool.ref) ?? [];
  const grants = draft ?? held;
  const approval = { audience: selectedAudience, outsideInput: selectedOutside, members: selectedAudience === 'people' ? members : [] };
  const toggle = (ref: string, granted: boolean) => {
    setPreview(undefined); setDraft(undefined);
    if (granted && shared && state.data?.sharedDefault) { setPendingGrant(ref); setIncludeApproval(true); return; }
    void state.run(() => granted ? request('/api/plugins/grants', 'POST', { kind: 'mcp', ref, agentId }) : request(`/api/plugins/grants?kind=mcp&ref=${encodeURIComponent(ref)}&agentId=${encodeURIComponent(agentId)}`, 'DELETE'));
  };
  return <section className="grid gap-3 rounded-lg border border-border p-3"><h4>App actions</h4>{state.pending && <p role="status">Loading…</p>}{state.error && <p role="alert" className="text-destructive">{state.error}</p>}
    {state.data && (!state.data.admin ? <p>Only administrators can change app actions.</p> : app === 'routines' ? <><p>Always on for every Bot.</p>{state.data.tools.map(tool => <p key={tool.ref}>{tool.name} · {tool.description}</p>)}</> : <>
      <label>Describe allowed actions<Textarea value={text} onChange={e => { setText(e.target.value); setPreview(undefined); setTranslated(false); }} /></label><Button disabled={state.pending || !text.trim()} onClick={() => void state.run(async () => {
        const result = await HyperBotGrantApi.translate<{ grants: string[]; explanation: string | null; warning: string | null; otherApps: string[]; check: { ok: boolean; error?: string } }>(agentId, app, text);
        setPreview(undefined); setExplanation([result.explanation, result.warning, result.otherApps.length ? `Other apps unchanged: ${result.otherApps.join(', ')}` : '', result.check.error].filter(Boolean).join('\n'));
        if (result.check.ok) { setDraft(result.grants); setTranslated(true); }
      })}>Choose actions</Button><p className="whitespace-pre-wrap">{explanation}</p>
      {state.data.tools.length === 0 && <p>No actions advertised by this app.</p>}
      {state.data.tools.map(tool => <label key={tool.ref} className="grid gap-1"><span><input type="checkbox" disabled={state.pending || Boolean(pendingGrant)} checked={held.includes(tool.ref)} onChange={e => toggle(tool.ref, e.target.checked)} />{tool.name} · {tool.effect}{tool.destructive ? ' · Destructive' : ''}</span><span className="text-sm text-muted-foreground">{tool.description}</span></label>)}
      <Button variant="outline" disabled={state.pending || !draft} onClick={() => void state.run(async () => setPreview(await HyperBotGrantApi.replay<HyperGrantPreview>(agentId, app, grants)))}>Preview against recent activity</Button>
      {preview && <div><p>{preview.warning}</p>{!preview.check.ok && <p role="alert">{preview.check.error || 'These actions cannot be saved.'}</p>}<p>Added: {preview.changes.added.map(row => `${row.name}${row.destructive ? ' (destructive)' : ''}`).join(', ') || 'None'}</p><p>Removed: {preview.changes.removed.map(row => row.name).join(', ') || 'None'}</p>{preview.report && <p>{preview.report.calls} calls across {preview.report.runs} runs. {preview.report.callsLost} calls lost, {preview.report.callsGained} calls gained. Unused writes: {preview.report.addedUnusedWrites.map(row => row.name).join(', ') || 'None'}.</p>}</div>}
      {shared && state.data.sharedDefault && <label><input type="checkbox" checked={includeApproval} onChange={e => { setIncludeApproval(e.target.checked); }} />Approve shared account audience with this change</label>}
      {(includeApproval || pendingGrant) && state.data.sharedDefault && <><label>Audience<select value={selectedAudience} onChange={e => setAudience(e.target.value)}><option value="owner">Owner</option>{named && <option value="people">Named people and groups</option>}<option value="team">Whole team</option></select></label><label><input type="checkbox" checked={selectedOutside} onChange={e => setOutside(e.target.checked)} />Messages from outside can use it</label></>}

      {pendingGrant && <><p>Anyone in the approved audience can use this action as the shared account.</p><Button disabled={state.pending} onClick={() => void state.run(async () => { await request('/api/plugins/grants', 'POST', { kind: 'mcp', ref: pendingGrant, agentId, approval }); setPendingGrant(undefined); onSaved(); })}>Approve audience and grant action</Button><Button variant="outline" disabled={state.pending} onClick={() => setPendingGrant(undefined)}>Cancel action grant</Button></>}
      <Button disabled={state.pending || Boolean(pendingGrant) || !preview?.check.ok || (!preview.changes.added.length && !preview.changes.removed.length)} onClick={() => void state.run(async () => { await HyperBotGrantApi.save(agentId, app, { add: preview!.changes.added.map(row => row.ref), remove: preview!.changes.removed.map(row => row.ref), ...(translated ? { authoring: { source: 'english', text } } : {}), ...(shared && includeApproval && state.data?.sharedDefault ? { approval: { audience: selectedAudience, outsideInput: selectedOutside, members: selectedAudience === 'people' ? members : [] } } : {}) }); setPreview(undefined); setDraft(undefined); onSaved(); })}>Save action changes</Button>
    </>)}
  </section>;
}
