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

import { HyperOffersStandingRule, HyperApprovalDetails } from './HyperApprovalPresentation';
import { HyperClearSharedBotConsents, HyperLoadInbox } from './HyperApprovalsApi';
describe('Hyper approvals policy and failure contracts', () => {
  it('never offers standing allowances for task, closed or handoff actions', () => {
    for (const policy of [{ source: 'task' }, { source: 'default', closed: true }, { source: 'default', behaviour: 'hand_off' }]) {
      expect(HyperOffersStandingRule({ policy })).toBe(false);
    }
    expect(HyperOffersStandingRule({})).toBe(true);
    expect(HyperOffersStandingRule({ policy: { source: 'default' } })).toBe(true);
  });
  it('shows complete inert action arguments and omits internal handles', () => {
    const html = renderToStaticMarkup(<HyperApprovalDetails args={{ ref: 'internal-handle', text: '<script>unsafe()</script>', to: ['one', 'two'], enabled: false }} />);
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).toContain('one, two');
    expect(html).toContain('No');
    expect(html).not.toContain('internal-handle');
    expect(renderToStaticMarkup(<HyperApprovalDetails args={null} />)).toBe('');
  });
  it('passes through refused mutations and read failures', async () => {
    vi.mocked(hyperOpenBotRequest).mockRejectedValue(new Error('refused'));
    await expect(HyperDecide('one', 'deny')).rejects.toThrow('refused');
    await expect(HyperLoadInbox()).rejects.toThrow('refused');
    await expect(HyperSaveRule({ botId: '*', toolRef: '*', effect: '*', scope: '*', behaviour: 'ask' })).rejects.toThrow('refused');
  });
  it('resets shared Bot consents using the original endpoint', async () => {
    await HyperClearSharedBotConsents();
    expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/team-bots/consents', 'DELETE');
  });
});

import { HyperRunMutation } from './HyperMutation';
import { HyperFindConversation, HyperChangeRule } from './HyperApprovalsApi';
import { HyperDecisionHistory } from './HyperDecisionHistory';
describe('Hyper authoritative inbox results', () => {
  it('distinguishes refused writes from accepted writes with failed readback', async () => {
    const read = vi.fn().mockResolvedValue({});
    expect(await HyperRunMutation(async () => { throw Error('refused'); }, read)).toBe('refused');
    expect(read).not.toHaveBeenCalled();
    const write = vi.fn().mockResolvedValue({});
    expect(await HyperRunMutation(write, async () => { throw Error('offline'); })).toBe('unconfirmed');
    expect(write).toHaveBeenCalledTimes(1);
    expect(await HyperRunMutation(write, read)).toBe('confirmed');
  });
  it('resolves conversations across channel pages', async () => {
    vi.mocked(hyperOpenBotRequest).mockResolvedValueOnce({ channels: [], nextCursor: 'older page' })
      .mockResolvedValueOnce({ channels: [{ id: 'channel', threadId: 'thread' }], nextCursor: null });
    expect(await HyperFindConversation('thread')).toBe('channel');
    expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/channels?cursor=older%20page');
  });
  it('does not invent a conversation when missing and rejects pagination loops', async () => {
    vi.mocked(hyperOpenBotRequest).mockResolvedValue({ channels: [], nextCursor: null });
    expect(await HyperFindConversation('gone')).toBeUndefined();
    vi.mocked(hyperOpenBotRequest).mockResolvedValue({ channels: [], nextCursor: 'same' });
    await expect(HyperFindConversation('gone')).rejects.toThrow('pagination');
  });
  it('changes only rule behaviour, preserving account-specific server data', async () => {
    await HyperChangeRule('rule', 'ask');
    expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/approvals/rules/rule', 'PATCH', { behaviour: 'ask' });
  });
  it('shows authoritative decision history without claiming execution', () => {
    const request = { id: 'r', status: 'approved', decision: 'allow_once' as const, createdAt: '2026-01-01', action: { botId: 'b', threadId: 't', toolRef: 'send', effect: 'write', scope: 'mail', args: {}, target: {} } };
    const html = renderToStaticMarkup(<HyperDecisionHistory requests={[request]} open={vi.fn()} />);
    expect(html).toContain('Allowed once');
    expect(html).toContain('approved');
    expect(html).not.toContain('completed');
    expect(html).not.toContain('type="radio"');
    expect(renderToStaticMarkup(<HyperDecisionHistory requests={[]} open={vi.fn()} />)).toContain('No decisions yet.');
  });
});
it('does not read back a shared-consent reset as an inbox write', async () => {
  const action = () => HyperClearSharedBotConsents();
  expect(await HyperRunMutation(action, async () => {})).toBe('confirmed');
  expect(hyperOpenBotRequest).toHaveBeenCalledTimes(1);
});
