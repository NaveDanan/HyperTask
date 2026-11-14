import { expect, it } from 'vitest';
import { hyperToolOutcome } from './HyperToolOutcome';
it('distinguishes answered refusals, failures and waiting steps from performed work', () => {
  expect(hyperToolOutcome('{"refused":true}', false)).toBe('refused');
  expect(hyperToolOutcome('{"ok":false}', false)).toBe('failed');
  for (const key of ['waiting', 'starting', 'stopped', 'notPerformed']) expect(hyperToolOutcome(JSON.stringify({ [key]: true }), false)).toBe('not-yet');
  expect(hyperToolOutcome('{"doneByPerson":true}', false)).toBe('by-you');
  expect(hyperToolOutcome('Actual result text', false)).toBe('complete');
  expect(hyperToolOutcome(undefined, true)).toBe('running');
  expect(hyperToolOutcome(undefined, false)).toBe('not-yet');
});
