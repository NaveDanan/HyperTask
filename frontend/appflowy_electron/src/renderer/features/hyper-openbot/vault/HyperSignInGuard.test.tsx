import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ values: [] as any[], refs: [] as any[], state: 0, ref: 0, answer: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (initial: any) => { const slot = h.state++, values = h.values; if (!(slot in values)) values[slot] = initial; return [values[slot], (next: any) => { values[slot] = next; }]; }, useRef: (initial: any) => { const slot = h.ref++; return h.refs[slot] ?? (h.refs[slot] = { current: initial }); }, useEffect: () => {} }));
vi.mock('./HyperVaultApi', () => ({ hyperVaultApi: { answerSignIn: h.answer } }));
import { HyperSignInForm } from './HyperSignInForm';
const base = { id: 'sign-in', botId: 'bot', origin: 'https://example.test', status: 'pending', savedLogins: [{ id: 'saved', username: 'Person' }], passwordManager: true };
beforeEach(() => { h.values = [base, '', false]; h.refs = []; h.answer.mockReset().mockResolvedValue({ ...base, status: 'filling' }); vi.stubGlobal('React', React); });
afterEach(() => vi.unstubAllGlobals());
function render(props: any) { h.state = 0; h.ref = 0; return HyperSignInForm({ requestId: 'sign-in', ...props }); }
function find(node: any, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any> | undefined { if (Array.isArray(node)) { for (const child of node) { const match = find(child, predicate); if (match) return match; } } else if (React.isValidElement(node)) { const element = node as React.ReactElement<any>; return predicate(element) ? element : find(element.props.children, predicate); } }
const savedButton = (tree: any) => find(tree, element => element.props.children === 'Confirm and sign in')!;
it('computer ownership loss prevents reading or posting a secret and clears the fields', () => {
  const captured = vi.fn(), reset = vi.fn(); vi.stubGlobal('FormData', class { constructor() { captured(); } get() { return 'synthetic-password'; } });
  const tree = render({ computerGuard: { current: () => false, run: vi.fn() } });
  find(tree, element => element.type === 'form')!.props.onSubmit({ preventDefault() {}, currentTarget: { reset } });
  expect(captured).not.toHaveBeenCalled(); expect(h.answer).not.toHaveBeenCalled(); expect(reset).toHaveBeenCalledOnce();
});
it('saved-login mutation runs through its captured computer guard', async () => {
  const guard = { current: () => true, run: vi.fn(async work => { await work(() => true); return true; }) };
  savedButton(render({ computerGuard: guard })).props.onClick(); for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(guard.run).toHaveBeenCalledOnce(); expect(h.answer).toHaveBeenCalledWith('sign-in', 'use-saved', { loginId: 'saved' });
});
it('a guard that becomes obsolete during its fresh read cannot post the old action', async () => {
  const guard = { current: () => true, run: vi.fn(async work => { await work(() => false); return false; }) };
  savedButton(render({ computerGuard: guard })).props.onClick(); for (let i = 0; i < 10; i++) await Promise.resolve(); expect(h.answer).not.toHaveBeenCalled();
});
it('an obsolete guarded completion cannot apply its response', async () => {
  let finish!: (value: any) => void, current = true;
  h.answer.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const guard = { current: () => true, run: vi.fn(async work => { await work(() => current); return current; }) };
  savedButton(render({ computerGuard: guard })).props.onClick(); for (let i = 0; i < 10; i++) await Promise.resolve();
  current = false; finish({ ...base, status: 'signed_in' }); for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(h.values[0].status).toBe('pending');
});
