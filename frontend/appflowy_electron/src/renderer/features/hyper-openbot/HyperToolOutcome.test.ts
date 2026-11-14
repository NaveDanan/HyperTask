import { expect, it } from 'vitest';
import { ALREADY_WAITING, DECLINED_BY_PERSON, HANDLED_BY_PERSON, NOT_RUN_AFTER_FAILURE, OUTCOME_UNKNOWN } from './HyperApprovalOutcomes';
import { hyperToolOutcome, hyperToolResultForPerson } from './HyperToolOutcome';
it('distinguishes answered refusals, failures and waiting steps from performed work', () => {
  expect(hyperToolOutcome('{"refused":true}', false)).toBe('refused');
  expect(hyperToolOutcome('{"ok":false}', false)).toBe('failed');
  for (const key of ['waiting', 'starting', 'stopped', 'notPerformed']) expect(hyperToolOutcome(JSON.stringify({ [key]: true }), false)).toBe('not-yet');
  expect(hyperToolOutcome('{"doneByPerson":true}', false)).toBe('by-you');
  expect(hyperToolOutcome('Actual result text', false)).toBe('complete');
  expect(hyperToolOutcome(undefined, true)).toBe('running');
  expect(hyperToolOutcome(undefined, false)).toBe('not-yet');
});

it('recognizes the original durable approval protocol without labelling a denied write complete', () => {
  for (const result of [DECLINED_BY_PERSON, JSON.stringify(DECLINED_BY_PERSON)]) {
    expect(hyperToolOutcome(result, false)).toBe('refused');
    expect(hyperToolResultForPerson(result)).toBe('You declined it.');
  }
  expect(hyperToolOutcome(HANDLED_BY_PERSON, false)).toBe('by-you');
  for (const result of [NOT_RUN_AFTER_FAILURE, OUTCOME_UNKNOWN, 'Not done: the rule changed. Ask the person again if it is still needed.'])
    expect(hyperToolOutcome(result, false)).toBe('not-yet');
  expect(hyperToolOutcome('Refused. This connection is not permitted.', false)).toBe('refused');
  expect(hyperToolOutcome('Error: File not found.', false)).toBe('failed');
  expect(hyperToolOutcome('A report about someone who declined an action.', false)).toBe('complete');
});

it('keeps an already-waiting approval incomplete in both original wire forms', () => {
  for (const result of [ALREADY_WAITING, JSON.stringify(ALREADY_WAITING)])
    expect(hyperToolOutcome(result, false)).toBe('not-yet');
});
