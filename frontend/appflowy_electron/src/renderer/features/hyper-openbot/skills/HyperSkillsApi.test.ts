import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hyperOpenBotRequest } from '../transport';
import { hyperDeleteSkill, hyperLoadSkills, hyperSaveSkill, hyperSetSkillGrant, hyperValidateSkill } from './HyperSkillsApi';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
const request = vi.mocked(hyperOpenBotRequest);
const draft = { slug: 'standup', title: ' Standup ', summary: 'Summary', instructions: ' Do work ', tools: ['server/tool'] };
beforeEach(() => request.mockReset());
describe('Hyper skill persistence', () => {
  it('validates the exact upstream command bounds and required instructions before writing', async () => {
    for (const slug of ['x', '-xx', 'xx-', 'Upper', 'a'.repeat(41)]) expect(hyperValidateSkill({ ...draft, slug })).toBeTruthy();
    expect(hyperValidateSkill({ ...draft, slug: 'a'.repeat(40) })).toBeNull();
    await expect(hyperSaveSkill({ ...draft, instructions: ' ' })).rejects.toThrow('required');
    expect(request).not.toHaveBeenCalled();
  });
  it('upserts with declarations and no implicit deployment-wide publication', async () => {
    request.mockResolvedValue({ skills: [] });
    await hyperSaveSkill(draft);
    expect(request).toHaveBeenCalledWith('/api/plugins/skills', 'POST', { ...draft, title: 'Standup', instructions: 'Do work' });
  });
  it('writes and revokes grants using the original distinct contracts', async () => {
    request.mockResolvedValue(undefined);
    await hyperSetSkillGrant('a/b', 'bot&1', true);
    expect(request).toHaveBeenLastCalledWith('/api/plugins/grants', 'POST', { kind: 'skill', ref: 'a/b', agentId: 'bot&1' });
    await hyperSetSkillGrant('a/b', 'bot&1', false);
    expect(request).toHaveBeenLastCalledWith('/api/plugins/grants?kind=skill&ref=a%2Fb&agentId=bot%261', 'DELETE');
    await hyperDeleteSkill('a/b');
    expect(request).toHaveBeenLastCalledWith('/api/plugins/skills/a%2Fb', 'DELETE');
  });
  it('includes owned hidden Bots and deduplicates the roster', async () => {
    request.mockResolvedValueOnce({ skills: [], servers: [] }).mockResolvedValueOnce({ agents: [{ id: 'a', name: 'A', mine: true }, { id: 'b', mine: false }] }).mockResolvedValueOnce({ agents: [{ id: 'a', name: 'A', mine: true }, { id: 'c', name: 'C', mine: true }] });
    const result = await hyperLoadSkills();
    expect(result.bots.map(bot => bot.id)).toEqual(['a', 'c']);
    expect(result.bots[1].hidden).toBe(true);
  });
  it('does not turn a failed roster read into an empty list', async () => {
    request.mockResolvedValueOnce({ skills: [], servers: [] }).mockRejectedValueOnce(new Error('Forbidden')).mockResolvedValueOnce({ agents: [] });
    const result = await hyperLoadSkills().catch(error => error);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('Forbidden');
  });
});
