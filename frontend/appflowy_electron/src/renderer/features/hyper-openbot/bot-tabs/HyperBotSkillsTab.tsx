// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest as request } from '../transport';
import { useHyperBotResource } from './HyperBotResource';
interface HyperSkill { slug: string; title: string; summary: string; ownerUserId?: string }
export function HyperBotSkillsTab({ agentId, mine }: { agentId: string; mine: boolean }) {
  const state = useHyperBotResource(async () => {
    const held = await request<{ skills: HyperSkill[] }>(`/api/plugins/for/${encodeURIComponent(agentId)}`);
    if (!mine) return { held: held.skills, own: [] as HyperSkill[] };
    const [page, me] = await Promise.all([request<{ skills: HyperSkill[] }>('/api/plugins'), request<{ user: { id: string } }>('/api/me')]);
    return { held: held.skills, own: page.skills.filter(skill => skill.ownerUserId === me.user.id) };
  }, agentId);
  return <section className="grid gap-3"><h3>Skills</h3><p>Type / in a conversation to run a skill.</p>{state.pending && <p role="status">Loading…</p>}{state.error && <p role="alert" className="text-destructive">{state.error}</p>}<Button disabled={state.pending} variant="outline" onClick={state.refresh}>Refresh</Button>
    {state.data && <>{mine && <><h4>Your skills</h4>{state.data.own.length === 0 && <p>No skills yet. Write one on the Skills page.</p>}{state.data.own.map(skill => <label key={skill.slug} className="flex gap-2 rounded-lg border border-border p-3"><input type="checkbox" disabled={state.pending} checked={state.data!.held.some(row => row.slug === skill.slug)} onChange={event => { const granted = event.target.checked; void state.run(() => granted ? request('/api/plugins/grants', 'POST', { kind: 'skill', ref: skill.slug, agentId }) : request(`/api/plugins/grants?kind=skill&ref=${encodeURIComponent(skill.slug)}&agentId=${encodeURIComponent(agentId)}`, 'DELETE')); }} />{skill.title} · {skill.summary}</label>)}</>}<h4>What it can use</h4>{state.data.held.length === 0 && <p>No skills yet.</p>}{state.data.held.map(skill => <article key={skill.slug}><h5>{skill.title}</h5><p>{skill.summary}</p></article>)}</>}
  </section>;
}
