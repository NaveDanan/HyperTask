import { beforeEach, expect, it } from 'vitest';
import { hyperChromePanelActions as actions, useHyperChromePanelStore as store } from './HyperChromePanel';
beforeEach(() => store.setState({ claim: null }));
it('releases the width when its page gives up the chrome slot', () => {
  actions.claim(1, 330);
  expect(store.getState().claim).toEqual({ owner: 1, width: 330 });
  actions.release(1);
  expect(store.getState().claim).toBeNull();
});
it('does not let an old page cleanup clear the new active page claim', () => {
  actions.claim(1, 330); actions.claim(2, 280); actions.release(1);
  expect(store.getState().claim).toEqual({ owner: 2, width: 280 });
  actions.release(2);
  expect(store.getState().claim).toBeNull();
});
it('ignores invalid panel widths', () => {
  for (const width of [0, -1, NaN, Infinity]) actions.claim(1, width);
  expect(store.getState().claim).toBeNull();
});
