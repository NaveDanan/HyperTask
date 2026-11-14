import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { hyperOpenBotRequest } from '../transport';
import { hyperSettingsApi } from './HyperSettingsApi';
import HyperSettingsSection, { HyperSettingsGeneral } from './HyperSettingsSection';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
const request = vi.mocked(hyperOpenBotRequest);
beforeEach(() => request.mockReset());
describe('Hyper settings', () => {
  it('reads named response fields and saves server-authoritative instructions including clearing', async () => {
    request.mockResolvedValueOnce({ instructions: 'stored' }).mockResolvedValueOnce({ instructions: '' });
    expect(await hyperSettingsApi.saveInstructions(' stored ')).toBe('stored');
    expect(request).toHaveBeenLastCalledWith('/api/settings/instructions', 'PUT', { instructions: ' stored ' });
    expect(await hyperSettingsApi.saveInstructions('')).toBe('');
  });
  it('validates before sending and refreshes the identity after a name save', async () => {
    await expect(hyperSettingsApi.saveInstructions('x'.repeat(4001))).rejects.toThrow('4000');
    await expect(hyperSettingsApi.saveName(' ')).rejects.toThrow('name');
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce({ profile: {} }).mockResolvedValueOnce({ user: { id: 'u', name: 'Server name' } });
    expect((await hyperSettingsApi.saveName(' Name ')).name).toBe('Server name');
    expect(request).toHaveBeenNthCalledWith(1, '/api/me/profile', 'PATCH', { name: 'Name' });
    expect(request).toHaveBeenLastCalledWith('/api/me');
  });
  it('patches only the preference chosen and propagates refusals', async () => {
    request.mockResolvedValueOnce({ preferences: { messageListEmphasis: 'agent' } });
    expect(await hyperSettingsApi.savePreferences({ messageListEmphasis: 'agent' })).toEqual({ messageListEmphasis: 'agent' });
    expect(request).toHaveBeenLastCalledWith('/api/settings/preferences', 'PATCH', { messageListEmphasis: 'agent' });
    request.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(hyperSettingsApi.instructions()).rejects.toThrow('Forbidden');
  });
  it('fails closed on edition and renders loading and empty settings', async () => {
    request.mockRejectedValueOnce(new Error('Unavailable'));
    expect(await hyperSettingsApi.edition()).toBe('team');
    const context = { openConversation() {}, startConversation() {} };
    expect(renderToStaticMarkup(<HyperSettingsSection context={context} />)).toContain('Loading settings');
    const html = renderToStaticMarkup(<HyperSettingsGeneral user={{ id: 'u', role: 'user', needsName: true }} instructions="" preferences={{ messageListEmphasis: 'thread', skin: 'openbot', proactive: 'on' }} onUser={() => {}} onInstructions={() => {}} onPreferences={() => {}} />);
    expect(html).toContain('Not set yet.'); expect(html).toContain('None yet.'); expect(html).toContain('Message list preview');
  });
});
