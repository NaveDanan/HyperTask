import { expect, it, vi } from 'vitest';
vi.mock('./connections/HyperConnectionsPanel', () => ({ HyperConnectionsPanel: () => null }));
vi.mock('./skills/HyperSkillsPanel', () => ({ HyperSkillsPanel: () => null }));
import HyperNativeConnections, { hyperReceiveConnectionReturn } from './connections/HyperNativeConnections';
import HyperNativeSkills from './skills/HyperNativeSkills';
import { HyperHomeDraftStore } from './onboarding/HyperHomeDraft';
import { hyperConversationDestination } from './conversations/HyperNavigation';
import { hyperLearningSelectionFromPath } from './memory/HyperLearningNavigation';
const context = () => ({ navigate: vi.fn(), openConversation: vi.fn(), startConversation: vi.fn() });
it('passes app, tool, Bot and broker selections to the real host and handles Back', () => {
  for (const [path, selection] of [
    ['/admin/plugins/mail/tools/send', { page: 'tool', key: 'mail', tool: 'send' }],
    ['/connections/mail/bots/bot-1', { page: 'bot', key: 'mail', agentId: 'bot-1' }],
    ['/connections/mail', { page: 'app', key: 'mail' }],
    ['/connections/composio', { page: 'browse', provider: 'composio' }],
    ['/connections/new', { page: 'new' }],
  ] as const) {
    const ctx = context(); const node = HyperNativeConnections({ context: ctx, path, admin: path.startsWith('/admin') });
    expect(node.props.selection).toEqual(selection);
    node.props.onSelectionChange({ page: 'list' });
    expect(ctx.navigate).toHaveBeenLastCalledWith(path.startsWith('/admin') ? 'admin-plugins' : 'connections', { path: path.startsWith('/admin') ? '/admin/plugins' : '/connections' });
  }
});
it('opens fixed skill detail and new without publishing personal skills', () => {
  const ctx = context(); const node = HyperNativeSkills({ context: ctx, path: '/skills?edit=standup&source=home' });
  expect(node.props.selection).toEqual({ page: 'skill', slug: 'standup' });
  expect(node.props.admin).toBe(false);
  node.props.onSelectionChange({ page: 'new' });
  expect(ctx.navigate).toHaveBeenCalledWith('skills', { path: '/skills/new' });
});
it('routes only native-confirmed callbacks to the list and refreshes authoritative state', () => {
  const navigate = vi.fn(), refresh = vi.fn();
  expect(hyperReceiveConnectionReturn({kind:'connections', confirmation:'native-confirmed'}, navigate, refresh)).toBe(true);
  expect(navigate).toHaveBeenCalledWith('connections', {path:'/connections'});
  expect(refresh).toHaveBeenCalledOnce();
  // Extra callback-shaped data never becomes a renderer URL or storage value.
  const destination = {kind:'connections' as const, confirmation:'native-confirmed' as const, code:'synthetic', serverId:'untrusted'};
  hyperReceiveConnectionReturn(destination, navigate, refresh);
  expect(navigate).toHaveBeenLastCalledWith('connections', {path:'/connections'});
});
it('does not consume newer drafts, other identities or cancelled leases', () => {
  const store = new HyperHomeDraftStore(); const draft = { text: 'same text', files: [], commandIds: [], submit: true };
  const old = store.write('a', draft); const newer = store.write('a', { ...draft, commandIds: ['new-command'] });
  expect(store.consume('a', old)).toBe(false); expect(store.read('a')?.commandIds).toEqual(['new-command']);
  store.clear(); expect(store.consume('a', newer)).toBe(false);
  const other = store.write('b', draft); expect(store.consume('a', other)).toBe(false);
  expect(store.read('c')).toBeUndefined();
});
it('resolves native detail allocations and preserves source query intent', () => {
  expect(hyperConversationDestination('/bots/bot-1/memory').sectionId).toBe('bot');
  expect(hyperConversationDestination('/admin/plugins/mail').sectionId).toBe('admin-plugins');
  expect(hyperConversationDestination('/settings/skills?edit=standup')).toEqual({sectionId:'skills',path:'/settings/skills?edit=standup'});
  expect(hyperLearningSelectionFromPath('/settings/learning/proposals/p1?container=c1&code=secret')).toEqual({tab:'proposals',proposalId:'p1',container:'c1',agentId:undefined});
});
