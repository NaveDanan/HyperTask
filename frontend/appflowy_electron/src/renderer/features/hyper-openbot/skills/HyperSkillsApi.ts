// Adapted from OpenBot, copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { hyperOpenBotRequest } from '../transport';

export type HyperSkill = { slug: string; title: string; summary: string; instructions: string; tools?: string[]; grantedTo: string[]; ownerUserId: string | null };
export type HyperSkillDraft = Pick<HyperSkill, 'slug' | 'title' | 'summary' | 'instructions'> & { tools: string[] };
export type HyperSkillBot = { id: string; name: string; mine: boolean; hidden?: boolean };
export type HyperSkillCatalogue = { skills: HyperSkill[]; servers: { id: string; title: string; tools: { ref: string; name: string; description: string; effect: string }[] }[] };
export async function hyperLoadSkills() {
  const [catalogue, visible, hidden] = await Promise.all([
    hyperOpenBotRequest<HyperSkillCatalogue>('/api/plugins'),
    hyperOpenBotRequest<{ agents: HyperSkillBot[] }>('/api/agents'),
    hyperOpenBotRequest<{ agents: HyperSkillBot[] }>('/api/agents?hidden=true'),
  ]);
  const bots = [...new Map([...visible.agents, ...hidden.agents.map(bot => ({ ...bot, hidden: true }))].filter(bot => bot.mine).map(bot => [bot.id, bot])).values()];
  return { catalogue, bots };
}
export function hyperValidateSkill(draft: HyperSkillDraft) {
  if (!/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(draft.slug)) return 'Command must be 2–40 lowercase letters, numbers or hyphens, starting and ending with a letter or number.';
  if (!draft.title.trim() || !draft.instructions.trim()) return 'Title and instructions are required.';
  return null;
}
export async function hyperSaveSkill(draft: HyperSkillDraft) {
  const error = hyperValidateSkill(draft);
  if (error) throw new Error(error);
  return hyperOpenBotRequest<{ skills: HyperSkill[] }>('/api/plugins/skills', 'POST', { ...draft, title: draft.title.trim(), instructions: draft.instructions.trim() });
}
export function hyperDeleteSkill(slug: string) { return hyperOpenBotRequest(`/api/plugins/skills/${encodeURIComponent(slug)}`, 'DELETE'); }
export function hyperSetSkillGrant(slug: string, agentId: string, granted: boolean) {
  const body = { kind: 'skill', ref: slug, agentId };
  return granted ? hyperOpenBotRequest('/api/plugins/grants', 'POST', body) : hyperOpenBotRequest(`/api/plugins/grants?${new URLSearchParams(body)}`, 'DELETE');
}
