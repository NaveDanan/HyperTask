import { expect, it } from 'vitest';
import type { HyperAssistantPersonSlot } from './HyperAssistant';
import { hyperApplyConfirmedPeople, hyperRemoveAssistantPerson } from './HyperAssistantPeople';

function recipient(text: string, name: string, token = name): HyperAssistantPersonSlot {
  const start = text.indexOf(token);
  return {
    id: name,
    rawName: name,
    query: name,
    status: 'unresolved',
    selected: null,
    candidates: [],
    sourceSpan: { start, end: start + token.length, text: token },
  };
}

it.each(['Alice', '@[Alice](mailto:alice@corp.example)'])('removes %s and keeps the remaining recipient span valid', (alice) => {
  const text = 'Email ' + alice + ' and Bob tomorrow';
  const result = hyperRemoveAssistantPerson(text, [recipient(text, 'Alice', alice), recipient(text, 'Bob')], 'Alice');
  expect(result.text).toBe('Email Bob tomorrow');
  expect(result.people).toHaveLength(1);
  expect(hyperApplyConfirmedPeople(result.text, [{
    name: 'Bob Jones',
    email: 'bob@corp.example',
    sourceSpan: result.people[0]?.sourceSpan,
  }])).toBe('Email @[Bob Jones](mailto:bob@corp.example) tomorrow');
});

it('removes a later recipient without changing text outside its part of the list', () => {
  const text = 'Email Alice, Bob and Chen about the report';
  const slots = ['Alice', 'Bob', 'Chen'].map((name) => recipient(text, name));
  const { text: remaining, people } = hyperRemoveAssistantPerson(text, slots, 'Bob');
  expect(remaining).toBe('Email Alice and Chen about the report');
  expect(people.map(({ sourceSpan }) => remaining.slice(sourceSpan?.start, sourceSpan?.end))).toEqual(['Alice', 'Chen']);
});

it('removes an added directory contact without editing the command', () => {
  const text = 'Email a status update';
  const contact = { ...recipient(text, 'Alice'), sourceSpan: undefined };
  expect(hyperRemoveAssistantPerson(text, [contact], 'Alice')).toEqual({ text, people: [] });
});

it.each([false, true])('matches each person to an unused occurrence when the first span is supplied: %s', (positioned) => {
  const text = 'Send Dana the report from Dana';
  expect(hyperApplyConfirmedPeople(text, [
    { rawName: 'Dana', name: 'Dana A', email: 'dana.a@corp.example', sourceSpan: positioned ? recipient(text, 'Dana').sourceSpan : undefined },
    { rawName: 'Dana', name: 'Dana B', email: 'dana.b@corp.example' },
  ])).toBe('Send @[Dana A](mailto:dana.a@corp.example) the report from @[Dana B](mailto:dana.b@corp.example)');
});

it('keeps the address in an unclaimed serialized mention when another Dana is added', () => {
  const text = 'Send @[Dana](mailto:dana.a@corp.example) the report';
  expect(hyperApplyConfirmedPeople(text, [
    { name: 'Dana', email: 'dana.b@corp.example' },
  ])).toBe(text + ' (@[Dana](mailto:dana.b@corp.example))');
});
