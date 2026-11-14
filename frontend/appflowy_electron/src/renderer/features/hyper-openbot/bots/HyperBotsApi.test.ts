import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
import { hyperOpenBotRequest } from '../transport';
import { HyperAgentPath, HyperBotValues, HyperLifecyclePath, HyperListBots, HyperSaveBot, type HyperBotProfile } from './HyperBotsApi';
const input = { name: ' Desk ', title: '', roleDescription: ' Help with work ', visibility: 'private' as const };
beforeEach(() => vi.resetAllMocks());
describe('Hyper Bot mutations', () => {
  it('creates native bots without leaking extra fields', async () => {
    vi.mocked(hyperOpenBotRequest).mockResolvedValue({ agent: { id: 'desk' } });
    await HyperSaveBot({ ...input, auth: { value: 'never-send' }, endpoint: 'ignored' } as typeof input);
    expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/agents', 'POST', { name: 'Desk', title: '', roleDescription: 'Help with work', visibility: 'private' });
  });
  it('refuses edits before sending when management is denied', async () => {
    await expect(HyperSaveBot(input, { id: 'shared', canManage: false } as HyperBotProfile)).rejects.toThrow('cannot edit');
    expect(hyperOpenBotRequest).not.toHaveBeenCalled();
  });
  it('encodes package ids and preserves starter instructions on edit', async () => {
    vi.mocked(hyperOpenBotRequest).mockResolvedValue({ agent: { id: 'a/b' } });
    await HyperSaveBot({ ...input, instructions: ' Be useful ' }, { id: 'a/b', canManage: true } as HyperBotProfile);
    expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/agents/a%2Fb', 'PATCH', expect.objectContaining({ instructions: 'Be useful' }));
    expect(HyperLifecyclePath('a/b')).toBe('/api/bots/a%2Fb');
    expect(HyperAgentPath('a/b')).toBe('/api/agents/a%2Fb');
  });
  it('rejects whitespace roles and oversized names', () => {
    expect(() => HyperBotValues({ ...input, roleDescription: '  ' })).toThrow('role');
    expect(() => HyperBotValues({ ...input, name: 'a'.repeat(81) })).toThrow('name');
  });
  it('uses the dedicated hidden roster', async () => {
    vi.mocked(hyperOpenBotRequest).mockResolvedValue({ agents: [{ id: 'hidden' }] });
    expect(await HyperListBots(true)).toEqual([{ id: 'hidden' }]);
    expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/agents?hidden=true');
  });
});
