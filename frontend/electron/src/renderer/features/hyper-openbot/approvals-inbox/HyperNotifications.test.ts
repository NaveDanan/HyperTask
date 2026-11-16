import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HyperNotificationPermissionState, HyperRequestNotificationPermission, HyperShowNotice } from './HyperNotifications';
import { HyperForgetReplies, HyperNoticeChannelEvent, HyperReplyNotice, HyperReplyTiming, type HyperChannelActivityEvent } from './HyperReplyNotices';
const event: HyperChannelActivityEvent = { channelId: 'channel', lastMessageAgentId: 'bot', lastMessage: 'Preview', firstLine: 'Whole first line' };
let shown: { title: string; options: NotificationOptions }[];
beforeEach(() => {
  vi.useFakeTimers(); shown = [];
  vi.stubGlobal('document', { visibilityState: 'hidden', hasFocus: () => false });
  vi.stubGlobal('Notification', class {
    static permission = 'granted';
    static requestPermission = vi.fn().mockResolvedValue('granted');
    constructor(title: string, options: NotificationOptions) { shown.push({ title, options }); }
  });
});
afterEach(() => { HyperForgetReplies(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const reads = { attention: vi.fn().mockResolvedValue([]), notify: vi.fn().mockResolvedValue('all'), agents: () => [{ id: 'bot', name: 'Helper' }] };
describe('Hyper notification parity', () => {
  it('uses real permission and tolerates absent or refused notification APIs', async () => {
    expect(HyperNotificationPermissionState()).toBe('granted');
    expect(await HyperRequestNotificationPermission()).toBe('granted');
    vi.stubGlobal('Notification', undefined);
    expect(HyperNotificationPermissionState()).toBe('unsupported');
    expect(await HyperRequestNotificationPermission()).toBe('unsupported');
    expect(() => HyperShowNotice({ title: 'test', body: '', path: '', tag: '' })).not.toThrow();
  });
  it('only notifies actual replies from Bots configured for all updates', () => {
    expect(HyperReplyNotice(event, 'all', [], reads.agents())).toMatchObject({ title: 'Helper replied', body: 'Whole first line', tag: 'openbot-channel', path: '/channel/channel' });
    expect(HyperReplyNotice(event, 'none', [], [])).toBeNull();
    expect(HyperReplyNotice(event, 'needs_input', [], [])).toBeNull();
    expect(HyperReplyNotice({ ...event, pinned: true }, 'all', [], [])).toBeNull();
  });
  it('provides a replacement needs-you notice for an approval or question reply', async () => {
    const waiting = { ...reads, notify: async () => 'needs_input' as const, attention: async () => [{ agentId: 'bot', name: 'Helper', waitingIn: 'channel' }] };
    HyperNoticeChannelEvent(event, waiting, vi.fn()); await vi.advanceTimersByTimeAsync(HyperReplyTiming.settleMs);
    expect(shown).toHaveLength(1); expect(shown[0].title).toBe('Helper needs you'); expect(shown[0].options.tag).toBe('openbot-channel');
  });
  it('waits for the turn to finish, settles replies and suppresses duplicates', async () => {
    HyperNoticeChannelEvent({ ...event, busy: true }, reads, vi.fn());
    HyperNoticeChannelEvent(event, reads, vi.fn());
    await vi.advanceTimersByTimeAsync(3000);
    expect(shown).toHaveLength(0);
    HyperNoticeChannelEvent({ ...event, busy: false }, reads, vi.fn());
    await vi.advanceTimersByTimeAsync(HyperReplyTiming.settleMs);
    expect(shown).toHaveLength(1);
    HyperNoticeChannelEvent(event, reads, vi.fn());
    await vi.advanceTimersByTimeAsync(3000);
    expect(shown).toHaveLength(1);
  });
  it('suppresses replies when attention owns the notification or the window is visible', async () => {
    const waiting = { ...reads, attention: async () => [{ agentId: 'bot', name: 'Helper', waitingIn: 'channel' }] };
    HyperNoticeChannelEvent(event, waiting, vi.fn());
    await vi.advanceTimersByTimeAsync(1500);
    expect(shown).toHaveLength(1); expect(shown[0].title).toBe('Helper needs you');
    HyperForgetReplies(); shown = [];
    vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true });
    HyperNoticeChannelEvent(event, reads, vi.fn());
    await vi.advanceTimersByTimeAsync(1500);
    expect(shown).toHaveLength(0);
  });
  it('does not display an old reply when the session ends during its attention read', async () => {
    let finish!: (value: []) => void;
    const delayed = { ...reads, attention: vi.fn(() => new Promise<[]>(resolve => { finish = resolve; })) };
    HyperNoticeChannelEvent(event, delayed, vi.fn());
    await vi.advanceTimersByTimeAsync(HyperReplyTiming.settleMs);
    expect(delayed.attention).toHaveBeenCalledOnce();
    HyperForgetReplies(); finish([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toHaveLength(0);
  });
  it('does not display a superseded reply when a new turn starts during its reads', async () => {
    let finish!: (value: []) => void;
    const delayed = { ...reads, attention: vi.fn(() => new Promise<[]>(resolve => { finish = resolve; })) };
    HyperNoticeChannelEvent(event, delayed, vi.fn());
    await vi.advanceTimersByTimeAsync(HyperReplyTiming.settleMs);
    HyperNoticeChannelEvent({ ...event, busy: true }, reads, vi.fn());
    finish([]); await vi.advanceTimersByTimeAsync(0);
    expect(shown).toHaveLength(0);
  });
  it('keeps repeated replies within the original turn timeout plus settling', async () => {
    HyperNoticeChannelEvent({ ...event, busy: true }, reads, vi.fn());
    HyperNoticeChannelEvent(event, reads, vi.fn());
    await vi.advanceTimersByTimeAsync(HyperReplyTiming.turnMs - 1000);
    HyperNoticeChannelEvent({ ...event, firstLine: 'Newest reply' }, reads, vi.fn());
    await vi.advanceTimersByTimeAsync(1000 + HyperReplyTiming.settleMs);
    expect(shown).toHaveLength(1);
    expect(shown[0].options.body).toBe('Newest reply');
  });
});
