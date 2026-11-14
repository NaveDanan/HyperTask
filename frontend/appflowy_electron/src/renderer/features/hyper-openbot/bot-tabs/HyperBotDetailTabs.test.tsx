import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { HyperBotDetailTabs } from './HyperBotDetailTabs';
import { HyperBotHandoffTab } from './HyperBotHandoffTab';
import { HyperBotApprovalsTab, hyperRuleCoversBot } from './HyperBotApprovalsTab';
import { HyperBotSkillsTab } from './HyperBotSkillsTab';
import { HyperReachability } from './HyperReachability';
import { HyperExternalAgents } from './HyperExternalAgents';
import type { HyperBotProfile } from '../bots/HyperBotsApi';
it('bot-tabs waits for server flags before offering writes', () => {
  const html = renderToStaticMarkup(<HyperBotDetailTabs bot={{ id: 'desk', canManage: false } as HyperBotProfile} />);
  expect(html).toContain('Loading');
  for (const label of ['Apps', 'Sharing', 'Setup', 'Approvals', 'Skills', 'Activity', 'Reaching you']) expect(html).toContain(label);
  expect(html).not.toContain('Give app'); expect(html).not.toContain('Publish to specific');
});
it('bot-tabs displays loading without granting handoff, skill or approval permissions', () => {
  for (const element of [<HyperBotHandoffTab agentId="desk" />, <HyperBotApprovalsTab agentId="desk" />, <HyperBotSkillsTab agentId="desk" mine={false} />]) {
    const html = renderToStaticMarkup(element); expect(html).toContain('Loading'); expect(html).not.toContain('type="checkbox"'); expect(html).not.toContain('Add rule');
  }
});
it('bot-tabs reachability waits for deployment availability', () => {
  const html = renderToStaticMarkup(<HyperReachability agentId="desk" />);
  expect(html).toContain('Loading'); expect(html).not.toContain('Send verification code');
});
it('bot-tabs external agents offer creation and loading states', () => {
  const html = renderToStaticMarkup(<HyperExternalAgents onChat={() => {}} />);
  expect(html).toContain('Connect agent'); expect(html).toContain('Loading');
});
it('bot-tabs approval bot patterns match literals and wildcard spans', () => {
  expect(hyperRuleCoversBot('desk.*', 'desk.one')).toBe(true);
  expect(hyperRuleCoversBot('desk.*', 'deskXone')).toBe(false);
  expect(hyperRuleCoversBot('a[1]', 'a[1]')).toBe(true);
  expect(hyperRuleCoversBot('a[1]', 'a1')).toBe(false);
});
