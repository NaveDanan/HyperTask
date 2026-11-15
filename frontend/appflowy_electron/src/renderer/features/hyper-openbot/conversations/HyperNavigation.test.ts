import { expect, it } from 'vitest';
import { hyperConversationDestination } from './HyperNavigation';
it('resolves legacy allocations without dropping nested intents', () => {
  expect(hyperConversationDestination('approvals-inbox', { path: '/settings/notifications?kind=reply' })).toEqual({ sectionId: 'approvals', path: '/settings/notifications?kind=reply' });
  expect(hyperConversationDestination('computer-browser', { path: '/settings/browsers/remote' }).sectionId).toBe('connected-browsers');
  expect(hyperConversationDestination('onboarding', { path: '/settings/setup' }).sectionId).toBe('setup');
  expect(hyperConversationDestination('screens').sectionId).toBe('screens');
});

it('retains legacy settings paths and rejects external navigation intent', () => {
  expect(hyperConversationDestination('/settings/activity?bot=id')).toEqual({ sectionId: 'settings', path: '/settings/activity?bot=id' });
  expect(hyperConversationDestination('computer-browser', { path: '/settings/browser/one?tab=files' })).toEqual({ sectionId: 'browser', path: '/settings/browser/one?tab=files' });
  expect(hyperConversationDestination('settings', { path: 'https://evil/settings' })).toEqual({ sectionId: 'settings', path: '/settings' });
});
