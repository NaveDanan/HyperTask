import { expect, it } from 'vitest';
import { hyperResolveModelPick } from './HyperModelSelection';

it('keeps the default model visible after the original server normalizes a saved choice to null', () => {
  expect(hyperResolveModelPick({ model: null, effort: 'low' }, 'catalogue-default')).toEqual({ model: 'catalogue-default', effort: 'low' });
  expect(hyperResolveModelPick({ model: 'explicit-choice', effort: null }, 'catalogue-default')).toEqual({ model: 'explicit-choice', effort: null });
});
