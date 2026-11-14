import { describe, expect, it } from 'vitest';
import { hyperRuntimeBotOf, hyperRuntimeFailure, hyperRuntimeToolAllowed } from './HyperRuntimePolicy';
import { hyperInStepOrder } from './HyperStepOrder';
import { hyperFrontendApprovalSnapshot, hyperWithoutWaitingPlaceholders, hyperObserveApprovalAgent, hyperWhileObserved } from './HyperApprovalContext';
import { HYPER_COMPUTER_TOOLS } from './HyperToolDefinitions';

describe('Hyper runtime policy compatibility', () => {
  it('routes a channel by runtime bot and never accepts its local id or placeholder', () => {
    expect(hyperRuntimeBotOf({ runtimeAgentId: 'bot-b', agentId: 'channel:a' })).toBe('bot-b');
    expect(hyperRuntimeBotOf({ agentId: 'channel:a' })).toBeUndefined();
    expect(hyperRuntimeBotOf({ agentId: 'default' })).toBeUndefined();
  });
  it('refuses unknown owners and team teammates, and splits capability gates by intent', () => {
    expect(hyperRuntimeToolAllowed('computer_read', {})).toBe(false);
    expect(hyperRuntimeToolAllowed('computer_read', { profile: { visibility: 'team', canManage: false } })).toBe(false);
    const facts = { profile: { visibility: 'private', canManage: true }, capabilities: { cloudNetwork: false, cloudBrowser: true, cloudComputer: false } };
    expect(hyperRuntimeToolAllowed('computer_read', facts)).toBe(true);
    expect(hyperRuntimeToolAllowed('computer_navigate', facts)).toBe(false);
    expect(hyperRuntimeToolAllowed('computer_run_command', facts)).toBe(false);
  });
  it('preserves server distinctions instead of inventing successful actions', () => {
    expect(hyperRuntimeFailure(403, { error: 'Blocked', rule: 'team' })).toMatchObject({ refused: true, rule: 'team', ok: false });
    expect(hyperRuntimeFailure(409, { humanHasControl: true, requestId: 'r' })).toMatchObject({ humanHasControl: true, requestId: 'r' });
    expect(hyperRuntimeFailure(409, { snapshotRequired: true })).toMatchObject({ staleRefs: true, snapshotRequired: true });
    expect(hyperRuntimeFailure(503, { starting: true })).toMatchObject({ starting: true, notPerformed: true });
  });
  it('requires captured run context before an action can enter the gate', () => {
    expect(() => hyperFrontendApprovalSnapshot({} as Parameters<typeof hyperFrontendApprovalSnapshot>[0])).toThrow('active conversation');
    expect(hyperWithoutWaitingPlaceholders([{ role: 'tool', content: '{"waiting":true}' }, { role: 'tool', content: '{"ok":false}' }])).toEqual([{ role: 'tool', content: '{"ok":false}' }]);
  });
  it('captures original forwardedProps and keeps observation until a departed turn finishes', async () => {
    type Agent = Parameters<typeof hyperObserveApprovalAgent>[0];
    let subscriber: { onRunInitialized: (event: unknown) => unknown; onRunStartedEvent: (event: unknown) => unknown };
    let unsubscribed = false;
    const agent = { threadId: 'thread-1', messages: [], state: { saved: true }, subscribe: (value: typeof subscriber) => { subscriber = value; return { unsubscribe: () => { unsubscribed = true; } }; } } as unknown as Agent;
    const release = hyperObserveApprovalAgent(agent);
    const input = { runId: 'run-1', threadId: 'thread-1', context: [], forwardedProps: { openbotTimeZone: 'Asia/Jerusalem', channelId: 'channel-1' } };
    subscriber!.onRunInitialized({ input, messages: [] });
    const snapshot = hyperFrontendApprovalSnapshot({ agent, toolCall: { id: 'call-1', type: 'function', function: { name: 'computer_click', arguments: '{"ref":"button","snapshotId":1}' } } });
    expect(snapshot.forwardedProps).toEqual(input.forwardedProps);
    expect(snapshot.args).toEqual({ ref: 'button', snapshotId: 1 });
    await hyperWhileObserved(agent, async () => { release(); expect(unsubscribed).toBe(false); });
    expect(unsubscribed).toBe(true);
  });
  it('stops later computer actions after a failed step', async () => {
    const messages = [{ id: 'step-test', role: 'assistant', toolCalls: [{ id: 'a', function: { name: 'computer_click' } }, { id: 'b', function: { name: 'computer_type' } }] }];
    let performed = false;
    await hyperInStepOrder({ computerId: 'bot-test', messages, toolCallId: 'a' }, async () => ({ ok: false, refused: true }));
    const answer = await hyperInStepOrder({ computerId: 'bot-test', messages, toolCallId: 'b' }, async () => { performed = true; return { ok: true }; });
    expect(performed).toBe(false);
    expect(answer).toContain('earlier browser action');
  });
  it('keeps snapshot refs required and excludes credential entry and unavailable takeover tools', () => {
    const click = HYPER_COMPUTER_TOOLS.find(tool => tool.name === 'computer_click')!;
    expect(click.parameters.safeParse({ ref: 'x' }).success).toBe(false);
    expect(click.parameters.safeParse({ ref: 'x', snapshotId: 1 }).success).toBe(true);
    expect(HYPER_COMPUTER_TOOLS.map(tool => tool.name)).not.toContain('computer_request_secret');
    expect(HYPER_COMPUTER_TOOLS.map(tool => tool.name)).not.toContain('computer_request_help');
  });
});
