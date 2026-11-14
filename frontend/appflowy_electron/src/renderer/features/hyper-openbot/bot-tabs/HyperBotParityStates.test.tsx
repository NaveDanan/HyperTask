import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
const mock = vi.hoisted(() => ({ data: undefined as unknown, pending: false, error: '', clicks: new Map<string, () => unknown>() }));
vi.mock('./HyperBotResource', () => ({ useHyperBotResource: () => ({ data: mock.data, pending: mock.pending, error: mock.error, refresh: vi.fn(), run: (action: () => Promise<unknown>) => action() }) }));
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => unknown; disabled?: boolean }) => { if (typeof children === 'string' && onClick && !disabled) mock.clicks.set(children, onClick); return <button disabled={disabled}>{children}</button>; } }));
import { hyperOpenBotRequest } from '../transport';
import { HyperBotSkillsTab } from './HyperBotSkillsTab';
import { HyperBotApprovalsTab } from './HyperBotApprovalsTab';
import { HyperSharedAppNotice } from './HyperSharedAppNotice';
import { HyperBotAppGrants } from './HyperBotAppGrants';
import { HyperBotActivityTab } from './HyperBotActivityTab';
beforeEach(() => { mock.data = undefined; mock.pending = false; mock.error = ''; mock.clicks.clear(); vi.resetAllMocks(); });
it('refuses administrator action editing without permission', () => {
  mock.data = { admin: false, tools: [] };
  const html = renderToStaticMarkup(<HyperBotAppGrants agentId="desk" app="mail" onSaved={() => {}} />);
  expect(html).toContain('Only administrators'); expect(html).not.toContain('Save action changes');
});
it('locks team and disabled personal approval rules', () => {
  mock.data = { teamRules: [{ id: 'team', botId: '*', toolRef: 'mail/send', effect: 'write', scope: '*', behaviour: 'ask' }], rules: [{ id: 'mine', botId: 'desk', toolRef: 'mail/read', effect: 'read', scope: '*', behaviour: 'allow' }], team: { customRulesEnabled: false }, preferences: {} };
  const html = renderToStaticMarkup(<HyperBotApprovalsTab agentId="desk" />);
  expect(html).toContain('Locked'); expect(html).not.toContain('Revoke'); expect(html).not.toContain('Add rule');
});
it('keeps another owners skills read only', () => {
  mock.data = { own: [{ slug: 'own', title: 'Private skill', summary: '' }], held: [{ slug: 'shared', title: 'Held skill', summary: 'Summary' }] };
  const html = renderToStaticMarkup(<HyperBotSkillsTab agentId="shared" mine={false} />);
  expect(html).toContain('Held skill'); expect(html).not.toContain('Private skill'); expect(html).not.toContain('type="checkbox"');
});
it('explains shared exposure before administrators publish', () => {
  mock.data = { admin: true, apps: [{ serverId: 'mail', title: 'Mail', covered: false }], pending: [] };
  expect(renderToStaticMarkup(<HyperSharedAppNotice agentId="desk" />)).toContain('Saving also lets everyone');
});
it('files exact shared exposure approval requests and respects pending requests', async () => {
  mock.data = { admin: false, apps: [{ serverId: 'mail', title: 'Mail', covered: false }], pending: [] };
  renderToStaticMarkup(<HyperSharedAppNotice agentId="desk" />);
  await mock.clicks.get('Request approval')!();
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/approvals/shared-use', 'POST', { botId: 'desk', serverId: 'mail', reason: 'publish' });
  mock.data = { admin: false, apps: [{ serverId: 'mail', title: 'Mail', covered: false }], pending: [{ serverId: 'mail' }] };
  expect(renderToStaticMarkup(<HyperSharedAppNotice agentId="desk" />)).toContain('Waiting for an admin');
});
it('uses authoritative stop and cancel flags and exact activity payloads', async () => {
  const item = { id: 'handoff', kind: 'handoff', title: 'Delegated work', detail: '', status: 'running', at: '2026-01-01', channelId: null, needsYou: false, stoppable: true, cancellable: false };
  mock.data = { inProgress: [item], scheduled: [], completed: [] };
  renderToStaticMarkup(<HyperBotActivityTab agentId="desk" />); await mock.clicks.get('Stop')!();
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/bots/desk/activity/handoffs/stop', 'POST', { id: 'handoff' });
  mock.data = { inProgress: [], scheduled: [{ ...item, id: 'follow', kind: 'follow_up', stoppable: false, cancellable: true }], completed: [] };
  renderToStaticMarkup(<HyperBotActivityTab agentId="desk" />); await mock.clicks.get('Cancel follow-up')!();
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/bots/desk/follow-ups/cancel', 'POST', { id: 'follow' });
});
it('renders read errors distinctly from an empty skills list', () => {
  mock.error = 'Access refused';
  const html = renderToStaticMarkup(<HyperBotSkillsTab agentId="desk" mine />);
  expect(html).toContain('role="alert"'); expect(html).not.toContain('No skills yet');
});
it('keeps the upstream routines app always on without an action editor', () => {
  mock.data = { admin: true, tools: [{ ref: 'routines/create', name: 'Create routine', description: 'Create', grantedTo: [] }] };
  const html = renderToStaticMarkup(<HyperBotAppGrants agentId="desk" app="routines" onSaved={() => {}} />);
  expect(html).toContain('Always on'); expect(html).not.toContain('Save action changes'); expect(html).not.toContain('type="checkbox"');
});
