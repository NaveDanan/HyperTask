import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], cleanups: [] as (() => void)[], form: { current: undefined as any } }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useId: () => 'keyboard-card', useState: (initial: unknown) => [initial, vi.fn()], useRef: () => h.form, useEffect: (effect: () => void | (() => void)) => h.effects.push(effect) }));
import { HyperDecisionCard } from './HyperDecisionCard';
let documentFixture: { body: object; activeElement: object; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
beforeEach(() => {
  h.effects = []; h.cleanups = []; h.form.current = { requestSubmit: vi.fn(), contains: (element: unknown) => element === h.form.current };
  const body = { closest: () => null };
  documentFixture = { body, activeElement: body, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('document', documentFixture); vi.stubGlobal('React', React);
});
afterEach(() => { for (const cleanup of h.cleanups.reverse()) cleanup(); vi.unstubAllGlobals(); });
function mount() {
  HyperDecisionCard({ title: 'Approve', options: [{ value: 'allow', label: 'Allow' }], onSubmit: vi.fn() });
  for (const effect of h.effects) { const cleanup = effect(); if (cleanup) h.cleanups.push(cleanup); }
  return documentFixture.addEventListener.mock.calls.find(call => call[0] === 'keydown')![1] as (event: KeyboardEvent) => void;
}
function enter(target: object, extra: object = {}) { return { key: 'Enter', target, preventDefault: vi.fn(), defaultPrevented: false, repeat: false, isComposing: false, ...extra } as unknown as KeyboardEvent; }
it.each(['button', 'link'])('Enter on an unrelated focused %s cannot answer an approval', () => {
  const key = mount(), target = { closest: () => null }; documentFixture.activeElement = target;
  const event = enter(target); key(event);
  expect(h.form.current.requestSubmit).not.toHaveBeenCalled(); expect(event.preventDefault).not.toHaveBeenCalled();
});
it('Enter with body focus still answers the newest valid card', () => {
  const key = mount(), event = enter(documentFixture.body); key(event);
  expect(h.form.current.requestSubmit).toHaveBeenCalledOnce(); expect(event.preventDefault).toHaveBeenCalledOnce();
});
it.each([{ defaultPrevented: true }, { repeat: true }, { isComposing: true }])('does not answer a consumed, repeated or composing key %j', extra => {
  const key = mount(); key(enter(documentFixture.body, extra)); expect(h.form.current.requestSubmit).not.toHaveBeenCalled();
});
