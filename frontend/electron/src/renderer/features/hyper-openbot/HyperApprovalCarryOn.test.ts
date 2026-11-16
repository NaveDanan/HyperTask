import { expect, it } from 'vitest';
import { hyperCarryingOnAfterApproval, type HyperInbox } from './HyperConversationActions';
const now = Date.parse('2026-11-15T01:00:00Z');
function inbox(status: string, changes: Partial<HyperInbox['requests'][number]> = {}): HyperInbox {
  return { requests: [{ id: 'approval', status, createdAt: new Date(now - 1000).toISOString(), action: { threadId: 'thread', toolRef: 'app/read', effect: 'read', scope: '' }, ...changes }], questions: [] };
}
it.each(['approved', 'denied', 'consumed'])('blocks the bounded server continuation in status %s', status => {
  expect(hyperCarryingOnAfterApproval(inbox(status), 'thread', now)).toBe(true);
});
it.each(['pending', 'completed'])('does not treat %s as a decided server continuation', status => {
  expect(hyperCarryingOnAfterApproval(inbox(status), 'thread', now)).toBe(false);
});
it('uses decision time, falls back to creation and expires at the pinned ten-minute boundary', () => {
  expect(hyperCarryingOnAfterApproval(inbox('approved', { createdAt: new Date(now - 86400000).toISOString(), decidedAt: new Date(now - 1000).toISOString() }), 'thread', now)).toBe(true);
  expect(hyperCarryingOnAfterApproval(inbox('approved', { createdAt: new Date(now - 600000).toISOString(), decidedAt: null }), 'thread', now)).toBe(false);
  expect(hyperCarryingOnAfterApproval(inbox('approved', { createdAt: new Date(now - 599999).toISOString(), decidedAt: null }), 'thread', now)).toBe(true);
});
it('never borrows another thread or a malformed instant as continuation proof', () => {
  expect(hyperCarryingOnAfterApproval(inbox('approved'), 'another-thread', now)).toBe(false);
  expect(hyperCarryingOnAfterApproval(inbox('approved', { createdAt: 'invalid' }), 'thread', now)).toBe(false);
  expect(hyperCarryingOnAfterApproval(undefined, 'thread', now)).toBe(false);
});
