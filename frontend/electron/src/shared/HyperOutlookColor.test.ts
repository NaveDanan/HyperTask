import { expect, it } from 'vitest';
import { HyperOutlookColors, hyperOutlookCategoriesWith, hyperOutlookCategoryName, hyperOutlookColorOf, hyperOutlookColorWire } from './HyperOutlookColor';

it('maps every colour to a HyperTask-owned category and its Outlook OlCategoryColor value', () => {
  expect(HyperOutlookColors.map(({ id, outlook }) => [id, hyperOutlookCategoryName(id), outlook])).toEqual([
    ['red', 'HyperTask Red', 1], ['orange', 'HyperTask Orange', 2], ['yellow', 'HyperTask Yellow', 4], ['green', 'HyperTask Green', 5],
    ['teal', 'HyperTask Teal', 6], ['blue', 'HyperTask Blue', 8], ['purple', 'HyperTask Purple', 9], ['gray', 'HyperTask Gray', 13],
  ]);
  expect(new Set(HyperOutlookColors.map(color => color.outlook)).size).toBe(HyperOutlookColors.length);
});

it('reads the colour from the first HyperTask colour category, ignoring the user own categories and letter case', () => {
  expect(hyperOutlookColorOf(['Work', 'hypertask blue'])).toBe('blue');
  expect(hyperOutlookColorOf(['HyperTask Green', 'HyperTask Red'])).toBe('green');
  expect(hyperOutlookColorOf(['Work', 'Customer'])).toBeNull();
  expect(hyperOutlookColorOf([])).toBeNull();
});

it('puts the chosen colour first, replaces other HyperTask colours and keeps the user own categories', () => {
  expect(hyperOutlookCategoriesWith(['Work', 'HyperTask Red', 'Travel'], 'blue')).toEqual(['HyperTask Blue', 'Work', 'Travel']);
  expect(hyperOutlookCategoriesWith(['HyperTask Red', 'Work'], null)).toEqual(['Work']);
  expect(hyperOutlookColorOf(hyperOutlookCategoriesWith(['Work', 'HyperTask Red'], 'teal'))).toBe('teal');
});

it('sends the host the category to ensure, its Outlook colour and every owned colour to strip', () => {
  const owned = ['HyperTask Red', 'HyperTask Orange', 'HyperTask Yellow', 'HyperTask Green', 'HyperTask Teal', 'HyperTask Blue', 'HyperTask Purple', 'HyperTask Gray'];
  expect(hyperOutlookColorWire('blue')).toEqual({ name: 'HyperTask Blue', outlook: 8, owned });
  expect(hyperOutlookColorWire(null)).toEqual({ name: null, outlook: 0, owned });
});
