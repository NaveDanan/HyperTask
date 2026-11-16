import { expect, it } from 'vitest';
import { hyperResolveModelPick, hyperRequestModelPick } from './HyperModelSelection';

it('keeps the default model visible after the original server normalizes a saved choice to null', () => {
  expect(hyperResolveModelPick({ model: null, effort: 'low' }, 'catalogue-default')).toEqual({ model: 'catalogue-default', effort: 'low' });
  expect(hyperResolveModelPick({ model: 'explicit-choice', effort: null }, 'catalogue-default')).toEqual({ model: 'explicit-choice', effort: null });
});
it.each([
  { pick: { model: 'default', effort: null }, expected: { model: null, effort: null } },
  { pick: { model: 'default', effort: 'high' }, expected: { model: null, effort: null } },
  { pick: { model: 'default', effort: 'low' }, expected: { model: null, effort: 'low' } },
  { pick: { model: 'other', effort: 'high' }, expected: { model: 'other', effort: null } },
])('projects model and effort defaults into the pinned request representation', test => {
  const catalogue = { default: 'default', choosable: true, models: [{ id: 'default', label: 'Default', efforts: ['low', 'high'], defaultEffort: 'high' }, { id: 'other', label: 'Other' }] };
  expect(hyperRequestModelPick(test.pick, catalogue)).toEqual(test.expected);
});
