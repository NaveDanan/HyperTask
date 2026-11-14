import { expect, it } from 'vitest';
import { hyperConversationDestination } from './HyperNavigation';
it('resolves legacy allocations without dropping nested intents', () => {
  expect(hyperConversationDestination('approvals-inbox', { path: '/settings/notifications?kind=reply' })).toEqual({ sectionId: 'approvals', path: '/settings/notifications?kind=reply' });
  expect(hyperConversationDestination('computer-browser', { path: '/settings/browsers/remote' }).sectionId).toBe('connected-browsers');
  expect(hyperConversationDestination('onboarding', { path: '/settings/setup' }).sectionId).toBe('setup');
  expect(hyperConversationDestination('screens').sectionId).toBe('home');
});
