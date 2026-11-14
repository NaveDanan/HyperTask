import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { hyperOpenBotFetch, hyperOpenBotRequest } from '../transport';
import { hyperActivityApi, hyperActivitySearch, HYPER_ACTIVITY_VIEWS } from './HyperActivityApi';
import { hyperSettingsDestination, HYPER_SETTINGS_DESTINATION_IDS } from './HyperSettingsNavigation';
import { oneRowPerAction, outcomeOf } from './HyperActivityOutcome';
import { HyperPersonalActivity } from './HyperPersonalActivity';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn(), hyperOpenBotFetch: vi.fn(), HYPER_OPENBOT_ORIGIN: 'https://hyper-openbot.invalid' }));
const request = vi.mocked(hyperOpenBotRequest);
beforeEach(() => { request.mockReset(); vi.mocked(hyperOpenBotFetch).mockReset(); });
describe('Hyper personal activity', () => {
  it('sends saved views, personal exclusions, bot and cursor to the server', async () => {
    const search = hyperActivitySearch(HYPER_ACTIVITY_VIEWS[2][1], 'bot /');
    expect(search.get('eventType')).toContain('computer.action_refused');
    expect(search.get('excludeEventType')).toContain('channel.routed');
    expect(search.get('excludeCalls')).toContain('routines/create_routine');
    request.mockResolvedValueOnce({ events: [], nextCursor: 'next' });
    expect(await hyperActivityApi.events(search, 'old /')).toEqual({ events: [], nextCursor: 'next' });
    const params = new URLSearchParams(request.mock.calls[0][0].split('?')[1]);
    expect(params.get('cursor')).toBe('old /'); expect(params.get('bot')).toBe('bot /'); expect(search.has('cursor')).toBe(false);
    expect(hyperActivitySearch('unattended').get('initiatorKind')).toBe('routine,handoff,responsibility,memory');
  });
  it('propagates page refusals for retry', async () => {
    request.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(hyperActivityApi.events(hyperActivitySearch(''))).rejects.toThrow('Forbidden');
  });
  it('exports the saved view without paging and reports server truncation', async () => {
    const search = hyperActivitySearch('', 'b'); search.set('cursor', 'old'); search.set('limit', '50');
    vi.mocked(hyperOpenBotFetch).mockResolvedValueOnce(new Response('csv', { headers: { 'x-audit-export-truncated': '10000' } }));
    const result = await hyperActivityApi.export(search);
    expect(result.capped).toBe(10000); expect(await result.blob.text()).toBe('csv');
    const url = new URL(String(vi.mocked(hyperOpenBotFetch).mock.calls[0][0]));
    expect(url.searchParams.get('format')).toBe('csv'); expect(url.searchParams.has('cursor')).toBe(false); expect(url.searchParams.has('limit')).toBe(false); expect(url.searchParams.get('bot')).toBe('b');
    vi.mocked(hyperOpenBotFetch).mockResolvedValueOnce(new Response('refused', { status: 403 }));
    await expect(hyperActivityApi.export(search)).rejects.toThrow('Could not export');
  });
  it('loads shown and hidden bot pages, stops repeated cursors and resolves skill titles', async () => {
    request.mockImplementation(async path => {
      if (path === '/api/plugins') return { skills: [{ slug: 'skill', title: 'A skill' }] };
      if (path.includes('hidden=true')) throw new Error('Unavailable');
      if (path.includes('cursor=next')) return { bots: [{ id: 'b', name: 'Second' }], nextCursor: 'next' };
      return { bots: [{ id: 'a', name: 'First' }], nextCursor: 'next' };
    });
    expect(await hyperActivityApi.names()).toEqual({ bots: { a: 'First', b: 'Second' }, skills: { skill: 'A skill' } });
    expect(request.mock.calls.filter(([path]) => path.includes('cursor=next'))).toHaveLength(1);
  });
  it('draws a failed action once and classifies approval denials correctly', () => {
    const events = [{ eventType: 'computer.action_allowed', payload: { attempt: 'a' } }, { eventType: 'computer.action_failed', payload: { attempt: 'a' } }];
    expect(oneRowPerAction(events)).toEqual([events[1]]);
    expect(outcomeOf(events[1])).toBe('did-not-happen'); expect(outcomeOf({ eventType: 'approval.person_decided', payload: { decision: 'deny' } })).toBe('refused');
    const html = renderToStaticMarkup(<HyperPersonalActivity bot="b" />);
    for (const label of ['Activity', 'Computer actions', 'Blocked', 'Search events', 'Export CSV', 'Show every Bot']) expect(html).toContain(label);
    expect(html).not.toContain('Ask the trail');
  });
});
describe('Hyper settings destinations', () => {
  it('preserves legacy new, slug, app and broker-directory destinations', () => {
    expect(hyperSettingsDestination('/settings/skills', 'team')).toEqual({ sectionId: 'skills', path: '/skills' });
    for (const suffix of ['new', 'my-skill']) expect(hyperSettingsDestination(`/settings/skills/${suffix}`, 'personal')).toEqual({ sectionId: 'skills', path: `/skills/${suffix}` });
    expect(hyperSettingsDestination('/settings/plugins/composio', 'personal')).toEqual({ sectionId: 'connections', path: '/connections/browse/composio' });
    expect(hyperSettingsDestination('/settings/plugins/gmail/tools/send', 'personal')).toEqual({ sectionId: 'connections', path: '/connections/gmail/tools/send' });
  });
  it('guards personal routes and preserves cross-area subpaths and Activity bot scope', () => {
    for (const path of ['/settings/skills/new', '/settings/plugins/gmail', '/settings/activity?bot=b']) expect(hyperSettingsDestination(path, 'team')).toEqual({ sectionId: 'settings', path: '/settings' });
    expect(hyperSettingsDestination('/settings/activity?bot=b', 'personal').path).toBe('/settings/activity?bot=b');
    expect(hyperSettingsDestination('/settings/connected-accounts/gmail', 'team')).toEqual({ sectionId: 'vault', path: '/settings/connected-accounts/gmail' });
    expect(HYPER_SETTINGS_DESTINATION_IDS.skills).toBe('skills');
    expect(hyperSettingsDestination('https://outside.invalid/settings/skills', 'personal')).toEqual({ sectionId: 'settings', path: '/settings' });
    expect(hyperSettingsDestination('/settings-other/skills', 'personal')).toEqual({ sectionId: 'settings', path: '/settings' });
  });
});
