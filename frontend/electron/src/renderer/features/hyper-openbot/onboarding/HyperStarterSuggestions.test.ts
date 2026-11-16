import { expect, it } from 'vitest';
import { HyperIsStarterTourAgent, HyperShowStarterTour, HYPER_STARTER_SUGGESTIONS } from './HyperStarterSuggestions';
it('offers an unclaimed tour only before creation and a claimed tour only in its conversation', () => {
  expect(HyperShowStarterTour({})).toBe(true);
  expect(HyperShowStarterTour({}, 'other')).toBe(false);
  expect(HyperShowStarterTour({ starterTourChannelId: 'saved' })).toBe(false);
  expect(HyperShowStarterTour({ starterTourChannelId: 'saved' }, 'saved')).toBe(true);
  expect(HyperShowStarterTour({ starterTourChannelId: 'saved' }, 'other')).toBe(false);
});
it('limits starter tasks to the upstream internal Bot IDs', () => {
  expect(HyperIsStarterTourAgent('picked-harness')).toBe(true);
  expect(HyperIsStarterTourAgent('personal-assistant')).toBe(true);
  expect(HyperIsStarterTourAgent('custom')).toBe(false);
  expect(HYPER_STARTER_SUGGESTIONS).toHaveLength(4);
});
