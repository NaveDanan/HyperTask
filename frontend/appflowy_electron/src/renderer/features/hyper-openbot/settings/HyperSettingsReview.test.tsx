import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ values: [] as any[], refs: [] as any[], state: 0, ref: 0, effects: [] as (() => unknown)[], deps: [] as (readonly unknown[] | undefined)[], cleanups: [] as (() => void)[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (initial: any) => { const slot = h.state++, values = h.values; if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial; return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }]; }, useRef: (initial: any) => { const slot = h.ref++; return h.refs[slot] ?? (h.refs[slot] = { current: initial }); }, useEffect: (effect: () => unknown, deps: readonly unknown[] | undefined) => { h.effects.push(effect); h.deps.push(deps); } }));
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
import { hyperOpenBotRequest } from '../transport';
import { hyperSettingsApi } from './HyperSettingsApi';
import HyperSettingsSection from './HyperSettingsSection';
import { HyperSettingsAutomation } from './HyperSettingsAutomation';
import HyperApprovalsSection, { hyperApprovalTabFromPath } from '../approvals-inbox/HyperApprovalsSection';
beforeEach(() => { h.values = []; h.refs = []; h.effects = []; h.cleanups = []; vi.stubGlobal('React', React); vi.useFakeTimers(); vi.mocked(hyperOpenBotRequest).mockReset(); });
afterEach(() => { for (const cleanup of h.cleanups.reverse()) cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function render(component: (props: any) => React.ReactNode, props: any) { h.state = 0; h.ref = 0; h.effects = []; h.deps = []; return component(props); }
function mount() { for (const effect of h.effects) { const cleanup = effect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); } }
function text(node: any): string { if (Array.isArray(node)) return node.map(text).join(''); if (React.isValidElement(node)) return text((node as React.ReactElement<any>).props.children); return typeof node === 'string' ? node : ''; }
function find(node: any, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any> | undefined { if (Array.isArray(node)) { for (const child of node) { const match = find(child, predicate); if (match) return match; } } else if (React.isValidElement(node)) { const element = node as React.ReactElement<any>; return predicate(element) ? element : find(element.props.children, predicate); } }
const drain = () => vi.advanceTimersByTimeAsync(0);
it.each([['Notifications', '/settings/notifications'], ['Approvals', '/settings/approvals']])('More settings forwards the %s control path', (label, path) => {
  const navigate = vi.fn(), tree = render(HyperSettingsSection, { context: { navigate, openConversation() {}, startConversation() {} } });
  find(tree, element => text(element.props.children) === label && typeof element.props.onClick === 'function')!.props.onClick();
  expect(navigate).toHaveBeenCalledWith('approvals', { path });
});
it.each([['/settings/notifications', 'Notifications'], ['/settings/approvals', 'Standing rules']])('the approvals destination selects the controls requested by %s', async (path, selected) => {
  vi.mocked(hyperOpenBotRequest).mockImplementation(async endpoint => endpoint === '/api/capabilities' ? { edition: 'personal' } : endpoint === '/api/approvals' ? { requests: [], questions: [], rules: [], teamRules: [], enabled: true } : endpoint === '/api/notifications/routing' ? {} : { available: {}, devices: [], deliveries: [] });
  const props = { context: { navigationIntent: { path }, openConversation() {}, startConversation() {} } };
  render(HyperApprovalsSection, props); mount(); await drain(); const tree = render(HyperApprovalsSection, props);
  const tab = find(tree, element => text(element.props.children) === selected && typeof element.props.onClick === 'function')!;
  expect(tab.props.variant).toBe('secondary');
});
it('an earlier repository poll cannot restore a successfully disconnected binding', async () => {
  const binding = { id: 'binding', repository: 'owner/repo', createdAt: '2026-11-15T00:00:00Z' }; let finish!: (value: any) => void;
  vi.spyOn(hyperSettingsApi, 'checkInsAllowed').mockResolvedValue(true);
  vi.spyOn(hyperSettingsApi, 'repositories').mockResolvedValueOnce([binding]).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([]);
  vi.spyOn(hyperSettingsApi, 'disconnectRepository').mockResolvedValue(undefined);
  const props = { preferences: { proactive: 'on', skin: 'openbot', messageListEmphasis: 'thread' }, onPreferences: vi.fn() };
  render(HyperSettingsAutomation, props); mount(); await drain(); await vi.advanceTimersByTimeAsync(30000);
  const tree = render(HyperSettingsAutomation, props);
  await find(tree, element => text(element.props.children) === 'Disconnect' && typeof element.props.onClick === 'function')!.props.onClick();
  await drain(); expect(text(render(HyperSettingsAutomation, props))).toContain('No repositories yet.');
  finish([binding]); await drain(); expect(text(render(HyperSettingsAutomation, props))).toContain('No repositories yet.');
});
it('a cached repository action cannot write after its settings mount ends', async () => {
  const binding = { id: 'binding', repository: 'owner/repo', createdAt: '2026-11-15T00:00:00Z' };
  vi.spyOn(hyperSettingsApi, 'checkInsAllowed').mockResolvedValue(true); vi.spyOn(hyperSettingsApi, 'repositories').mockResolvedValue([binding]);
  const disconnect = vi.spyOn(hyperSettingsApi, 'disconnectRepository').mockResolvedValue(undefined);
  const props = { preferences: { proactive: 'on', skin: 'openbot', messageListEmphasis: 'thread' }, onPreferences: vi.fn() };
  render(HyperSettingsAutomation, props); mount(); await drain();
  const action = find(render(HyperSettingsAutomation, props), element => text(element.props.children) === 'Disconnect' && typeof element.props.onClick === 'function')!;
  for (const cleanup of h.cleanups.splice(0)) cleanup(); await action.props.onClick(); expect(disconnect).not.toHaveBeenCalled();
});
it('accepted repository removal stays removed when the follow-up read fails', async () => {
  const binding = { id: 'binding', repository: 'owner/repo', createdAt: '2026-11-15T00:00:00Z' };
  vi.spyOn(hyperSettingsApi, 'checkInsAllowed').mockResolvedValue(true); vi.spyOn(hyperSettingsApi, 'repositories').mockResolvedValueOnce([binding]).mockRejectedValueOnce(new Error('No readback'));
  vi.spyOn(hyperSettingsApi, 'disconnectRepository').mockResolvedValue(undefined);
  const props = { preferences: { proactive: 'on', skin: 'openbot', messageListEmphasis: 'thread' }, onPreferences: vi.fn() };
  render(HyperSettingsAutomation, props); mount(); await drain();
  await find(render(HyperSettingsAutomation, props), element => text(element.props.children) === 'Disconnect' && typeof element.props.onClick === 'function')!.props.onClick();
  const shown = text(render(HyperSettingsAutomation, props)); expect(shown).toContain('No repositories yet.'); expect(shown).toContain('refresh repositories');
});
it('a refused repository removal preserves the binding for retry', async () => {
  const binding = { id: 'binding', repository: 'owner/repo', createdAt: '2026-11-15T00:00:00Z' };
  vi.spyOn(hyperSettingsApi, 'checkInsAllowed').mockResolvedValue(true); vi.spyOn(hyperSettingsApi, 'repositories').mockResolvedValue([binding]);
  vi.spyOn(hyperSettingsApi, 'disconnectRepository').mockRejectedValue(new Error('Refused'));
  const props = { preferences: { proactive: 'on', skin: 'openbot', messageListEmphasis: 'thread' }, onPreferences: vi.fn() };
  render(HyperSettingsAutomation, props); mount(); await drain();
  await find(render(HyperSettingsAutomation, props), element => text(element.props.children) === 'Disconnect' && typeof element.props.onClick === 'function')!.props.onClick();
  expect(text(render(HyperSettingsAutomation, props))).toContain('owner/repo');
});
it('invalid and foreign settings paths cannot select notification or standing-rule controls', () => {
  for (const path of ['http://%', 'https://outside.invalid/settings/notifications', '/settings/notifications-elsewhere']) expect(hyperApprovalTabFromPath(path)).toBe('Inbox');
  expect(hyperApprovalTabFromPath('/settings/notifications/?ignored=true')).toBe('Notifications');
});
it('same-path navigation starts a new current notification read rather than keeping an expired callback', async () => {
  vi.mocked(hyperOpenBotRequest).mockImplementation(async endpoint => endpoint === '/api/capabilities' ? { edition: 'personal' } : endpoint === '/api/approvals' ? { requests: [], questions: [], rules: [], teamRules: [] } : { available: {}, devices: [], deliveries: [], routing: {} });
  let first = true;
  const props = { context: { navigationIntent: { path: '/settings/notifications' }, isCurrentNavigation: () => first, openConversation() {}, startConversation() {} } };
  render(HyperApprovalsSection, props); mount(); await drain();
  const oldEpoch = h.deps.find(deps => deps?.[0] === '/settings/notifications')?.[1];
  const before = vi.mocked(hyperOpenBotRequest).mock.calls.length; first = false;
  render(HyperApprovalsSection, { context: { ...props.context, isCurrentNavigation: () => true } });
  const effect = h.deps.findIndex(deps => deps?.[0] === '/settings/notifications'); expect(h.deps[effect]?.[1]).not.toBe(oldEpoch); h.effects[effect](); await drain();
  expect(vi.mocked(hyperOpenBotRequest).mock.calls.length).toBeGreaterThan(before);
});
