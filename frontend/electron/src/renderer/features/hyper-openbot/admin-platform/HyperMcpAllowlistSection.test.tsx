import * as React from 'react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { HyperMcpAllowlistSection } from './HyperMcpAllowlistSection';
import HyperPluginsSection from './HyperPluginsSection';
import { hyperOpenBotRequest } from '../transport';
import type { HyperMcpAllowlist, HyperMcpAllowlistOverview } from './HyperPlatformApi';
import { Switch } from '@/components/ui/switch';

// Actual component handlers and adapters, with retained hooks and effect cleanup, no DOM/services.
const h = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], si: 0, ri: 0, ei: 0,
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[], pending: [] as (() => void)[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState(initial: unknown) { const i = h.si++; if (!(i in h.states)) h.states[i] = typeof initial === 'function' ? initial() : initial; return [h.states[i], (next: unknown) => { h.states[i] = typeof next === 'function' ? next(h.states[i]) : next; }]; },
  useRef(initial: unknown) { const i = h.ri++; return h.refs[i] ?? (h.refs[i] = { current: initial }); },
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
    const i = h.ei++, old = h.effects[i];
    if (!old || !deps || !old.deps || deps.some((dep, n) => !Object.is(dep, old.deps![n]))) h.pending.push(() => {
      old?.cleanup?.(); const cleanup = effect(); h.effects[i] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
    });
  },
}));
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
vi.mock('../connections/HyperNativeConnections', () => ({ default: () => null }));
vi.stubGlobal('React', React);
const base = (): HyperMcpAllowlistOverview => ({ settings: { mcpAllowlist: { enabled: true, servers: ['opaque:a', 'https://USER:synthetic-password@Example.test/mcp/?token=synthetic-query#fragment', 'opaque:b', 'opaque:gone'] } }, mcpServers: [
  { id: 'opaque:a', title: 'Alpha', url: 'https://example.test/mcp?key=synthetic-server-key' },
  { id: 'opaque:b', title: 'Beta', url: 'composio://beta' }, { id: 'opaque:c', title: 'Gamma', url: 'https://gamma.test/mcp' },
] });
let stored: HyperMcpAllowlistOverview, role: string, identity: string, edition: string, nav: boolean, fail: string, failAfterWrite: boolean, writes: HyperMcpAllowlist[];
const context = { openConversation: vi.fn(), startConversation: vi.fn(), isCurrentNavigation: () => nav };
let activeContext = context;
const request = vi.mocked(hyperOpenBotRequest);
const clone = <T,>(value: T): T => structuredClone(value);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function find(node: ReactNode, match: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, match); if (result) return result; } }
  else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as ReactElement<Record<string, unknown>>; if (match(element)) return element;
    for (const key of ['children', 'control', 'label', 'description']) { const result = find(element.props[key] as ReactNode, match); if (result) return result; }
  }
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  const props = (node as ReactElement<Record<string, unknown>>).props;
  return ['children', 'control', 'label', 'description', 'aria-label'].map(key => text(props[key] as ReactNode)).join(' ');
}
function render() { h.si = h.ri = h.ei = 0; h.pending = []; const tree = HyperMcpAllowlistSection({ context: activeContext }); for (const effect of h.pending) effect(); return tree; }
function unmount() { for (const effect of h.effects) effect.cleanup?.(); }
function button(tree: ReactNode, label: string) {
  const result = find(tree, e => e.props['aria-label'] === label || text(e.props.children as ReactNode).trim() === label && typeof e.props.onClick === 'function');
  expect(result, label).toBeDefined(); return result!;
}
function click(tree: ReactNode, label: string) { const node = button(tree, label); expect(node.props.disabled).not.toBe(true); (node.props.onClick as () => void)(); }
function toggle(tree: ReactNode, enabled: boolean) { const node = find(tree, e => e.type === Switch)!; expect(node).toBeDefined(); (node.props.onCheckedChange as (value: boolean) => void)(enabled); }
async function ready() { render(); await vi.waitFor(() => expect(text(render())).toContain('Only approved servers')); return render(); }
async function saved() { await vi.waitFor(() => expect(text(render())).toContain('MCP settings saved.')); return render(); }
function puts() { return request.mock.calls.filter(call => call[1] === 'PUT'); }
function address(value: string) { const node = find(render(), e => e.props['aria-label'] === 'MCP server address')!; (node.props.onChange as (event: unknown) => void)({ target: { value } }); }
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  h.states = []; h.refs = []; h.effects = []; h.pending = []; h.si = h.ri = h.ei = 0;
  stored = base(); role = 'admin'; identity = 'person-a'; edition = 'team'; nav = true; fail = ''; failAfterWrite = false; writes = [];
  activeContext = context;
  request.mockReset(); request.mockImplementation(async (path, method, body) => {
    if (path === fail) throw new Error('https://user:synthetic-error-secret@server.test/path?header=synthetic-header');
    if (path === '/api/me') return { user: { id: identity, role } };
    if (path === '/api/capabilities') return { edition };
    if (path === '/api/admin/enterprise') { if (failAfterWrite && writes.length) throw new Error('synthetic-readback-secret'); return clone(stored); }
    if (path === '/api/admin/enterprise/settings/mcpAllowlist' && method === 'PUT') {
      const value = clone((body as { value: HyperMcpAllowlist }).value); writes.push(value); stored.settings.mcpAllowlist = value; return { key: 'mcpAllowlist', value };
    }
    throw new Error(`Unexpected synthetic request: ${path}`);
  });
});
it('withholds the list-only policy on nested connection paths while retaining the connections host', () => {
  for (const path of ['/admin/plugins/new', '/admin/plugins/opaque%3Aa', '/admin/plugins/opaque%3Aa/tools/tool']) {
    const tree = HyperPluginsSection({ context, path }); expect(find(tree, e => e.type === HyperMcpAllowlistSection)).toBeUndefined(); expect(find(tree, e => typeof e.type === 'function' && e.props.admin === true)).toBeDefined();
  }
});
it('lists ID, address and absent-server approvals without secret URL values', async () => {
  const tree = await ready(); for (const name of ['Alpha', 'Beta', 'Gamma', 'Approved server is no longer in the registered list.']) expect(text(tree)).toContain(name);
  expect(text(tree)).not.toMatch(/synthetic-|opaque:|USER:|token=|key=/); expect(puts()).toHaveLength(0);
  expect(request.mock.calls.slice(0, 3).map(call => call[0])).toEqual(['/api/me', '/api/capabilities', '/api/admin/enterprise']);
});
it('confirms policy disable and enable without erasing approvals and reloads the server policy', async () => {
  const tree = await ready(), approvals = [...stored.settings.mcpAllowlist.servers]; toggle(tree, false); expect(puts()).toHaveLength(0);
  click(render(), 'Confirm MCP change'); await saved(); expect(writes[0]).toEqual({ enabled: false, servers: approvals });
  toggle(render(), true); click(render(), 'Confirm MCP change'); await saved(); expect(writes[1]).toEqual({ enabled: true, servers: approvals });
});
it('withdraws ID and normalized address approvals for the selected server, preserving unrelated IDs', async () => {
  click(await ready(), 'Withdraw approval for Alpha'); expect(puts()).toHaveLength(0); click(render(), 'Confirm MCP change'); await saved();
  expect(writes).toEqual([{ enabled: true, servers: ['opaque:b', 'opaque:gone'] }]);
});
it('withdraws a non-HTTP server by opaque ID without matching every other opaque approval', async () => {
  click(await ready(), 'Withdraw approval for Beta'); click(render(), 'Confirm MCP change'); await saved(); expect(writes[0].servers).toEqual(base().settings.mcpAllowlist.servers.filter(id => id !== 'opaque:b'));
});
it('approves only the actual selected server ID and creates no access grants', async () => {
  click(await ready(), 'Approve Gamma'); click(render(), 'Confirm MCP change'); await saved(); expect(writes[0].servers).toEqual([...base().settings.mcpAllowlist.servers, 'opaque:c']);
  expect(puts()).toHaveLength(1); expect(puts()[0][0]).toBe('/api/admin/enterprise/settings/mcpAllowlist');
});
it('normalizes and confirms an address by host only, then withdraws its unregistered approval', async () => {
  await ready(); address('HTTPS://user:synthetic-new-password@NEW.test:8443/mcp///?token=synthetic-new-query#fragment'); click(render(), 'Review address approval');
  expect(text(render())).not.toMatch(/synthetic-new|user:|token=/); expect(text(render())).toContain('new.test:8443'); click(render(), 'Confirm MCP change'); await saved();
  expect(writes[0].servers.at(-1)).toBe('https://new.test:8443/mcp'); click(render(), 'Withdraw saved approval 2'); click(render(), 'Confirm MCP change'); await saved(); expect(writes[1].servers).toEqual(base().settings.mcpAllowlist.servers);
});
it('removes an absent server approval by its exact opaque entry', async () => {
  click(await ready(), 'Withdraw saved approval 1'); click(render(), 'Confirm MCP change'); await saved(); expect(writes[0].servers).toEqual(base().settings.mcpAllowlist.servers.filter(entry => entry !== 'opaque:gone'));
});
it('does not duplicate an existing normalized address approval', async () => {
  await ready(); address('https://EXAMPLE.test/mcp/'); click(render(), 'Review address approval'); click(render(), 'Confirm MCP change'); await saved(); expect(writes[0].servers).toEqual(base().settings.mcpAllowlist.servers);
});
it.each(['ftp://bad.test/mcp', 'opaque:unknown', '', 'https://example.test/' + 'x'.repeat(201)])('blocks invalid new addresses: %s', async value => {
  await ready(); address(value); expect(button(render(), 'Review address approval').props.disabled).toBe(true); expect(puts()).toHaveLength(0);
});
it('shows the empty state and enforces the 500-entry maximum', async () => {
  stored = { settings: { mcpAllowlist: { enabled: false, servers: [] } }, mcpServers: [] }; expect(text(await ready())).toContain('No MCP servers or approvals saved.');
  stored.settings.mcpAllowlist.servers = Array.from({ length: 500 }, (_, i) => `server:${i}`); click(render(), 'Refresh MCP settings'); await vi.waitFor(() => expect(text(render())).toContain('Approval 500'));
  address('https://new.test/mcp'); expect(button(render(), 'Review address approval').props.disabled).toBe(true);
});
it.each(['user', '', 'owner'])('refuses enterprise reads and writes for non-admin role %s', async value => {
  role = value; render(); await vi.waitFor(() => expect(text(render())).toContain('Administrator access is required.')); expect(request).not.toHaveBeenCalledWith('/api/admin/enterprise'); expect(puts()).toHaveLength(0);
});
it('explains the personal edition without requesting its absent enterprise API', async () => {
  edition = 'personal'; render(); await vi.waitFor(() => expect(text(render())).toContain('This applies when HyperTask runs for a team.')); expect(request).not.toHaveBeenCalledWith('/api/admin/enterprise'); expect(puts()).toHaveLength(0);
});
it.each(['identity', 'edition'])('fails closed for unknown %s', async kind => {
  if (kind === 'identity') identity = ''; else edition = ''; render(); await vi.waitFor(() => expect(text(render())).toContain('Could not load MCP settings.')); expect(request).not.toHaveBeenCalledWith('/api/admin/enterprise');
});
it.each(['/api/me', '/api/capabilities', '/api/admin/enterprise'])('reports a read failure safely and retries explicitly: %s', async path => {
  fail = path; render(); await vi.waitFor(() => expect(text(render())).toContain('Could not load MCP settings.')); expect(text(render())).not.toContain('synthetic-'); fail = ''; click(render(), 'Refresh MCP settings'); await ready();
});
it('requires refresh and never claims success after a refused policy write', async () => {
  click(await ready(), 'Withdraw approval for Alpha'); fail = '/api/admin/enterprise/settings/mcpAllowlist'; click(render(), 'Confirm MCP change'); await vi.waitFor(() => expect(text(render())).toContain('Could not confirm the MCP change.'));
  expect(text(render())).not.toContain('synthetic-'); expect(text(render())).not.toContain('MCP settings saved.'); fail = ''; click(render(), 'Refresh MCP settings'); await ready(); expect(writes).toHaveLength(0);
});
it('distinguishes saved policy with failed readback and requires refresh', async () => {
  click(await ready(), 'Withdraw approval for Alpha'); failAfterWrite = true; click(render(), 'Confirm MCP change'); await vi.waitFor(() => expect(text(render())).toContain('The change was saved, but MCP settings could not be reloaded.')); expect(writes).toHaveLength(1); expect(text(render())).not.toContain('Confirm MCP change');
});
it.each(['role', 'edition', 'identity'])('rechecks %s before mutation and clears the confirmation', async kind => {
  click(await ready(), 'Withdraw approval for Alpha'); if (kind === 'role') role = 'user'; else if (kind === 'edition') edition = 'personal'; else identity = 'different-admin';
  click(render(), 'Confirm MCP change'); await vi.waitFor(() => expect(text(render())).toContain('Administrator access changed.')); expect(puts()).toHaveLength(0); expect(text(render())).not.toContain('Confirm MCP change');
});
it('refuses stale whole-list and selected-server snapshots after another admin changes them', async () => {
  click(await ready(), 'Withdraw approval for Alpha'); stored.mcpServers[0].url = 'https://changed.test/mcp'; stored.settings.mcpAllowlist.servers.push('opaque:new'); click(render(), 'Confirm MCP change');
  await vi.waitFor(() => expect(text(render())).toContain('MCP settings changed.')); expect(puts()).toHaveLength(0); expect(text(render())).not.toContain('Confirm MCP change');
});
it('rejects cancelled confirmations after a different selection and consumes each confirmation once', async () => {
  click(await ready(), 'Withdraw approval for Alpha'); const cached = button(render(), 'Confirm MCP change').props.onClick as () => void; click(render(), 'Cancel'); click(render(), 'Withdraw approval for Beta'); cached(); expect(puts()).toHaveLength(0);
  const confirm = button(render(), 'Confirm MCP change').props.onClick as () => void; confirm(); confirm(); await saved(); expect(writes).toHaveLength(1); expect(writes[0].servers).toContain('opaque:a'); expect(writes[0].servers).not.toContain('opaque:b');
});
it('rejects cached selection handlers after refresh invalidates the policy snapshot', async () => {
  const cached = button(await ready(), 'Withdraw approval for Alpha').props.onClick as () => void; click(render(), 'Refresh MCP settings'); cached(); await ready(); expect(text(render())).not.toContain('Withdraw server approval?'); expect(puts()).toHaveLength(0);
});
it('clears a pending confirmation even when a cached refresh handler starts the new read', async () => {
  const cachedRefresh = button(await ready(), 'Refresh MCP settings').props.onClick as () => void;
  click(render(), 'Withdraw approval for Alpha');
  const cachedConfirm = button(render(), 'Confirm MCP change').props.onClick as () => void;
  stored.settings.mcpAllowlist.servers.push('opaque:other-admin'); cachedRefresh();
  await ready(); expect(text(render())).not.toContain('Confirm MCP change'); cachedConfirm(); expect(puts()).toHaveLength(0);
});
it('rejects a cached address review handler after the draft changes', async () => {
  await ready(); address('https://one.test/mcp'); const cached = button(render(), 'Review address approval').props.onClick as () => void; address('https://two.test/mcp'); cached(); expect(text(render())).not.toContain('Approve this address?'); expect(puts()).toHaveLength(0);
});
it.each(['navigation', 'unmount'])('rejects cached confirmations after %s', async kind => {
  click(await ready(), 'Withdraw approval for Alpha'); const cached = button(render(), 'Confirm MCP change').props.onClick as () => void; if (kind === 'navigation') nav = false; else unmount(); cached(); await tick(); expect(puts()).toHaveLength(0);
});
it('starts a fresh lifetime on same-path navigation instead of transferring an old confirmation', async () => {
  click(await ready(), 'Withdraw approval for Alpha'); const cached = button(render(), 'Confirm MCP change').props.onClick as () => void;
  nav = false; activeContext = { ...context, isCurrentNavigation: () => true };
  expect(text(render())).not.toContain('Confirm MCP change'); cached(); await ready(); expect(puts()).toHaveLength(0);
  expect(text(render())).not.toContain('Confirm MCP change');
});
it('keeps the current confirmation on an ordinary rerender with a fresh current navigation closure', async () => {
  click(await ready(), 'Withdraw approval for Alpha'); activeContext = { ...context, isCurrentNavigation: () => true };
  expect(text(render())).toContain('Withdraw server approval?'); click(render(), 'Confirm MCP change'); await saved(); expect(writes).toHaveLength(1);
});
it('rejects deferred old-navigation work even after a new same-path arrival is current', async () => {
  click(await ready(), 'Withdraw approval for Alpha'); const pending = deferred<unknown>(); request.mockImplementationOnce(() => pending.promise);
  click(render(), 'Confirm MCP change'); nav = false; activeContext = { ...context, isCurrentNavigation: () => true }; render(); await ready();
  pending.resolve({ user: { id: identity, role } }); await tick(); expect(puts()).toHaveLength(0); expect(text(render())).not.toContain('Confirm MCP change');
});
it.each(['navigation', 'unmount'])('rejects a deferred access continuation after %s', async kind => {
  click(await ready(), 'Withdraw approval for Alpha'); const pending = deferred<unknown>(); request.mockImplementationOnce(() => pending.promise); click(render(), 'Confirm MCP change'); if (kind === 'navigation') nav = false; else unmount();
  pending.resolve({ user: { id: identity, role } }); await tick(); expect(puts()).toHaveLength(0);
});
it('rejects a deferred policy continuation after navigation before PUT', async () => {
  click(await ready(), 'Withdraw approval for Alpha'); const pending = deferred<unknown>(), original = request.getMockImplementation()!; request.mockImplementation((path, method, body) => path === '/api/admin/enterprise' ? pending.promise : original(path, method, body));
  click(render(), 'Confirm MCP change'); await vi.waitFor(() => expect(request.mock.calls.filter(call => call[0] === '/api/admin/enterprise')).toHaveLength(2)); nav = false; pending.resolve(base()); await tick(); expect(puts()).toHaveLength(0);
});
it('does not settle a deferred write into an unmounted view or start a readback there', async () => {
  click(await ready(), 'Withdraw approval for Alpha'); const pending = deferred<unknown>(), original = request.getMockImplementation()!; request.mockImplementation((path, method, body) => method === 'PUT' ? pending.promise : original(path, method, body));
  click(render(), 'Confirm MCP change'); await vi.waitFor(() => expect(puts()).toHaveLength(1)); const calls = request.mock.calls.length; unmount(); pending.resolve({ key: 'mcpAllowlist', value: { enabled: true, servers: ['opaque:b', 'opaque:gone'] } }); await tick(); expect(request.mock.calls).toHaveLength(calls);
});
it('ignores an initial access read that resolves after unmount', async () => {
  const pending = deferred<unknown>(); request.mockImplementationOnce(() => pending.promise); render(); unmount(); pending.resolve({ user: { id: identity, role } }); await tick(); expect(request.mock.calls.map(call => call[0])).toEqual(['/api/me', '/api/capabilities']);
});
