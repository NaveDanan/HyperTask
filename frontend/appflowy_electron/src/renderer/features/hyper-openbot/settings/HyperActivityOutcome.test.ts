import { expect, it } from 'vitest';
import { outcomeOf as personalOutcome } from './HyperActivityOutcome';
import { outcomeOf as adminOutcome } from '../admin-governance/HyperAuditOutcome';

it.each([
  ['app_access.refused', 'refused'],
  ['delivery.failed', 'did-not-happen'],
  ['computer.sign_in_failed', 'did-not-happen'],
])('classifies %s consistently in personal and admin activity', (eventType, expected) => {
  expect(personalOutcome(eventType)).toBe(expected);
  expect(adminOutcome(eventType)).toBe(expected);
});
