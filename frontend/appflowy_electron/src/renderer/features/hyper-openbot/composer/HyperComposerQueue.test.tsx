import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { HyperComposer, type HyperComposerProps } from './hyper-composer';
import { hyperDeferred } from '../conversations/HyperVoiceDeferred';
// Exercise the real input handler across renders, retaining its hook state and refs.
const hooks = vi.hoisted(() => ({ state: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0, effects: [] as (() => void)[] }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  return { ...react,
    useEffect: (effect: () => void) => { hooks.effects.push(effect); },
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.state)) hooks.state[index] = initial;
      return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }];
    },
    useRef: (initial: unknown) => {
      const index = hooks.refIndex++;
      return hooks.refs[index] ?? (hooks.refs[index] = { current: initial });
    },
  };
});
beforeEach(() => { hooks.state = []; hooks.refs = []; hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effects = []; });
function find(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const match = find(child, predicate); if (match) return match; }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as ReactElement<Record<string, unknown>>;
    return predicate(element) ? element : find(element.props.children as ReactNode, predicate);
  }
}
function render(props: HyperComposerProps) {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effects = [];
  const tree = HyperComposer(props); for (const effect of hooks.effects) effect(); return tree;
}

function submit(tree: ReactNode) { const form = find(tree, element => element.type === 'form')!; (form.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault() {} }); }
it('parks during a turn, restores a refused drain without spinning, and joins the next explicit send', async () => {
  const first = hyperDeferred<void>(); const sent = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined); const consume = vi.fn();
  submit(render({ value: 'correction', pending: true, onSubmit: sent, onConsumeAttachments: consume, attachments: [{ id: 'file', name: 'file', status: 'ready' }] }));
  expect(sent).not.toHaveBeenCalled(); expect(consume).toHaveBeenCalledWith(['file']);
  render({ value: '', pending: false, onSubmit: sent }); expect(sent).toHaveBeenCalledTimes(1);
  render({ value: '', pending: true, onSubmit: sent });
  first.reject(new Error('refused')); await vi.waitFor(() => expect(hooks.state.some(value => value === 'refused')).toBe(true));
  render({ value: '', pending: true, onSubmit: sent });
  render({ value: '', pending: false, onSubmit: sent }); expect(sent).toHaveBeenCalledTimes(1);
  submit(render({ value: 'then this', pending: false, onSubmit: sent }));
  expect(sent).toHaveBeenCalledTimes(2); expect(sent.mock.calls[1][0].text).toContain('correction'); expect(sent.mock.calls[1][0].text).toContain('then this');
  expect(sent.mock.calls[1][0].attachments.map((file: { id: string }) => file.id)).toEqual(['file']);
});
it('does not park attachments already owned by the active send', async () => {
  const first = hyperDeferred<void>(); const sent = vi.fn(() => first.promise); const consume = vi.fn();
  const attachments = [{ id: 'file', name: 'file', status: 'ready' as const }];
  submit(render({ value: 'first', onSubmit: sent, attachments }));
  submit(render({ value: 'correction', pending: true, onSubmit: sent, attachments, onConsumeAttachments: consume }));
  expect(consume).toHaveBeenCalledWith([]); expect(sent).toHaveBeenCalledTimes(1);
  first.resolve();
});
it('counts parked files against the attachment limit even with a live owner-count callback', () => {
  const attachments = Array.from({ length: 8 }, (_, index) => ({ id: `file-${index}`, name: 'file', status: 'ready' as const }));
  submit(render({ value: 'queued', pending: true, onSubmit: vi.fn(), attachments }));
  const onFiles = vi.fn(); const tree = render({ value: 'another', pending: true, onSubmit: vi.fn(), attachments: [], getAttachmentCount: () => 0, onFiles });
  const picker = find(tree, element => element.type === 'input' && element.props.type === 'file')!;
  (picker.props.onChange as (event: { target: { files: File[]; value: string } }) => void)({ target: { files: [new File(['one'], 'one.txt', { type: 'text/plain' })], value: '' } });
  expect(onFiles).not.toHaveBeenCalled();
});
