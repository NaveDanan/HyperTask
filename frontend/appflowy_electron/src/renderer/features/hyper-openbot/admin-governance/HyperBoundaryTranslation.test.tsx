import * as React from 'react';
import { beforeEach, expect, it, vi, type Mock } from 'vitest';
const h = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, pending: undefined as Promise<unknown> | undefined, error: undefined as unknown }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useEffect: () => {}, useState: (initial: unknown) => { const slot = h.cursor++; if (!(slot in h.values)) h.values[slot] = initial; return [h.values[slot], (value: unknown) => { h.values[slot] = value; }]; } }));
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
vi.mock('./HyperGovernanceUi', async original => ({ ...await original<typeof import('./HyperGovernanceUi')>(), useHyperAction: () => ({ busy: false, run: (action: () => Promise<unknown>) => { h.pending = action().catch(error => { h.error = error; }); return h.pending; } }) }));
import { HyperBoundaryEditor } from './HyperGovernanceFlows';
import { hyperOpenBotRequest } from '../transport';
const request = hyperOpenBotRequest as Mock;
beforeEach(() => { vi.stubGlobal('React', React); h.values = []; h.cursor = 0; h.pending = undefined; h.error = undefined; request.mockReset(); });
function find(node: unknown, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any> | undefined {
  if (Array.isArray(node)) { for (const item of node) { const match = find(item, predicate); if (match) return match; } return; }
  if (!React.isValidElement(node)) return;
  const element = node as React.ReactElement<any>; return predicate(element) ? element : find(element.props.children, predicate);
}
function render() { h.cursor = 0; return HyperBoundaryEditor({ policy: { mode: 'enforce', deny: [], allow: ['true'] }, reload: vi.fn() }); }
function field(tree: unknown, label: string) { return find(tree, element => element.type === 'label' && React.Children.toArray(element.props.children)[0] === label)!; }
it('an allow translation cannot become a saved deny boundary', async () => {
  request.mockResolvedValue({ rule: 'true', effect: 'allow', compile: { ok: true }, summary: null, explanation: null, warning: null });
  let tree = render(); find(field(tree, 'Describe what to stop'), element => element.type === 'textarea')!.props.onChange({ target: { value: 'Allow this action' } }); tree = render();
  find(tree, element => element.props.children === 'Write boundary')!.props.onClick(); await h.pending; tree = render();
  expect(find(field(tree, 'CEL expression'), element => element.type === 'textarea')!.props.value).toBe('');
  expect(h.error).toBeInstanceOf(Error); expect(request.mock.calls.some(call => call[1] === 'PUT')).toBe(false);
});
it('a validated deny translation still populates the boundary editor', async () => {
  request.mockResolvedValue({ rule: 'true', effect: 'deny', compile: { ok: true }, summary: null, explanation: null, warning: null });
  let tree = render(); find(field(tree, 'Describe what to stop'), element => element.type === 'textarea')!.props.onChange({ target: { value: 'Stop this action' } }); tree = render();
  find(tree, element => element.props.children === 'Write boundary')!.props.onClick(); await h.pending;
  expect(find(field(render(), 'CEL expression'), element => element.type === 'textarea')!.props.value).toBe('true'); expect(h.error).toBeUndefined();
});
