import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
import { hyperOpenBotRequest } from '../transport';
import { HyperAnswer, HyperDecide, HyperDismiss, HyperPreferences, HyperSaveRule, HyperRemoveRule, HyperRevokeGrant } from './HyperApprovalsApi';
import { HyperLoadRouting, HyperRouteUpdates, HyperRemoveDevice } from './HyperNotificationsApi';
import HyperApprovalsSection from './HyperApprovalsSection';
beforeEach(() => vi.resetAllMocks());
describe('Hyper approvals inbox', () => {
  it('sends upstream decisions and answers without claiming in-conversation continuation', async () => {
    await HyperDecide('one', 'allow_conversation');
    expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/approvals/one/decision', 'POST', { decision: 'allow_conversation' });
    await HyperAnswer('question', 'My answer');
    expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/approvals/questions/question/respond', 'POST', { response: 'My answer' });
    await HyperDismiss('question');
    expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/approvals/questions/question/dismiss', 'POST');
  });
  it('preserves rule and preference contracts', async () => {
    const rule = { botId: '*', toolRef: 'composio-gmail/*', effect: '*', scope: '*', behaviour: 'ask' as const };
    await HyperSaveRule(rule);
    expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/approvals/rules', 'POST', rule);
    await HyperSaveRule(rule, 'one');
    expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/approvals/rules/one', 'PATCH', rule);
    await HyperRemoveRule('one');
    expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/approvals/rules/one', 'DELETE');
    await HyperRevokeGrant('grant');
    expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/approvals/conversation-grants/grant', 'DELETE');
    await HyperPreferences({ autoReview: true });
    expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/approvals/preferences', 'PATCH', { autoReview: true });
  });
  it('reads routing envelope and writes exact notification payloads', async () => {
    vi.mocked(hyperOpenBotRequest).mockResolvedValue({ routing: { decision: 'all' } });
    expect(await HyperLoadRouting()).toEqual({ decision: 'all' });
    await HyperRouteUpdates('question', ['push', 'teams']);
    expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/bots/routing/question', 'PUT', { transports: ['push', 'teams'] });
    await HyperRemoveDevice('phone');
    expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/delivery/devices/phone', 'DELETE');
  });
  it('renders a loading state and native subnavigation', () => {
    const html = renderToStaticMarkup(<HyperApprovalsSection context={{ openConversation: vi.fn(), startConversation: vi.fn() }} />);
    expect(html).toContain('Loading approvals');
    expect(html).toContain('Standing rules');
    expect(html).toContain('Notifications');
  });
});
