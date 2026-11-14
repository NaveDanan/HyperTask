// Adapted from OpenBot lib/app-grants and components/manage/describe-grants.tsx. Copyright (c) 2026 CopilotKit. MIT.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { hyperOpenBotRequest as request } from '../transport';
import { useHyperBotResource } from './HyperBotResource';
export interface HyperGrantTool { ref: string; name: string; effect: string; destructive: boolean; description: string; grantedTo: string[] }
export interface HyperGrantPreview { check: { ok: boolean; error?: string }; warning: string | null; changes: { added: { ref: string; name: string; effect: string; destructive: boolean }[]; removed: { ref: string; name: string }[] }; report: { calls: number; runs: number; callsLost: number; callsGained: number; addedUnusedWrites: { name: string }[] } | null }
export function HyperBotAppGrants({ agentId, app, onSaved, shared = false }: { agentId: string; app: string; onSaved: () => void; shared?: boolean }) {
  const base = `/api/plugins/for/${encodeURIComponent(agentId)}/apps/${encodeURIComponent(app)}/grants`;
  const state = useHyperBotResource(async () => {
    const [page, me] = await Promise.all([request<{ servers: { id: string; tools: HyperGrantTool[] }[] }>('/api/plugins'), request<{ user: { role: string } }>('/api/me')]);
    return { admin: me.user.role === 'admin', tools: page.servers.find(row => row.id === app)?.tools ?? [] };
  }, `${agentId}:${app}`);
  const [draft, setDraft] = useState<string[]>(); const [text, setText] = useState(''); const [explanation, setExplanation] = useState(''); const [preview, setPreview] = useState<HyperGrantPreview>(); const [translated, setTranslated] = useState(false);
  const [audience, setAudience] = useState('owner'); const [members, setMembers] = useState(''); const [outsideInput, setOutside] = useState(false); const [includeApproval, setIncludeApproval] = useState(false);
  const held = state.data?.tools.filter(tool => tool.grantedTo.includes(agentId)).map(tool => tool.ref) ?? [];
  const grants = draft ?? held;
  const edit = (next: string[]) => { setDraft(next); setPreview(undefined); setTranslated(false); setExplanation(''); };
  return <section className="grid gap-3 rounded-lg border border-border p-3"><h4>App actions</h4>{state.pending && <p role="status">Loading…</p>}{state.error && <p role="alert" className="text-destructive">{state.error}</p>}
    {state.data && (!state.data.admin ? <p>Only administrators can change app actions.</p> : <>
      <label>Describe allowed actions<Textarea value={text} onChange={e => { setText(e.target.value); setPreview(undefined); setTranslated(false); }} /></label><Button disabled={state.pending || !text.trim()} onClick={() => void state.run(async () => {
        const result = await request<{ grants: string[]; explanation: string | null; warning: string | null; otherApps: string[]; check: { ok: boolean; error?: string } }>(`${base}/translate`, 'POST', { text });
        setPreview(undefined); setExplanation([result.explanation, result.warning, result.otherApps.length ? `Other apps unchanged: ${result.otherApps.join(', ')}` : '', result.check.error].filter(Boolean).join('\n'));
        if (result.check.ok) { setDraft(result.grants); setTranslated(true); }
      })}>Choose actions</Button><p className="whitespace-pre-wrap">{explanation}</p>
      {state.data.tools.map(tool => <label key={tool.ref} className="grid gap-1"><span><input type="checkbox" disabled={state.pending} checked={grants.includes(tool.ref)} onChange={e => edit(e.target.checked ? [...grants, tool.ref] : grants.filter(ref => ref !== tool.ref))} />{tool.name} · {tool.effect}{tool.destructive ? ' · Destructive' : ''}</span><span className="text-sm text-muted-foreground">{tool.description}</span></label>)}
      <Button variant="outline" disabled={state.pending || !draft} onClick={() => void state.run(async () => setPreview(await request<HyperGrantPreview>(`${base}/replay`, 'POST', { grants })))}>Preview against recent activity</Button>
      {preview && <div><p>{preview.warning}</p>{!preview.check.ok && <p role="alert">{preview.check.error || 'These actions cannot be saved.'}</p>}<p>Added: {preview.changes.added.map(row => `${row.name}${row.destructive ? ' (destructive)' : ''}`).join(', ') || 'None'}</p><p>Removed: {preview.changes.removed.map(row => row.name).join(', ') || 'None'}</p>{preview.report && <p>{preview.report.calls} calls across {preview.report.runs} runs. {preview.report.callsLost} calls lost, {preview.report.callsGained} calls gained. Unused writes: {preview.report.addedUnusedWrites.map(row => row.name).join(', ') || 'None'}.</p>}</div>}
      {shared && <label><input type="checkbox" checked={includeApproval} onChange={e => { setIncludeApproval(e.target.checked); }} />Approve shared account audience with this change</label>}
      {includeApproval && <><label>Audience<select value={audience} onChange={e => setAudience(e.target.value)}><option value="owner">Owner</option><option value="people">People and groups</option><option value="team">Whole team</option></select></label>{audience === 'people' && <label>Members, one user:email or group:name per line<Textarea value={members} onChange={e => setMembers(e.target.value)} /></label>}<label><input type="checkbox" checked={outsideInput} onChange={e => setOutside(e.target.checked)} />Allow outside input</label></>}
      <Button disabled={state.pending || !preview?.check.ok || (!preview.changes.added.length && !preview.changes.removed.length)} onClick={() => void state.run(async () => { await request(base, 'POST', { add: preview!.changes.added.map(row => row.ref), remove: preview!.changes.removed.map(row => row.ref), ...(translated ? { authoring: { source: 'english', text } } : {}), ...(shared && includeApproval ? { approval: { audience, outsideInput, members: audience === 'people' ? members.split('\n').filter(Boolean).map(line => { const at = line.indexOf(':'); return { kind: line.slice(0, at), value: line.slice(at + 1).trim() }; }) : [] } } : {}) }); setPreview(undefined); setDraft(undefined); onSaved(); })}>Save action changes</Button>
    </>)}
  </section>;
}
