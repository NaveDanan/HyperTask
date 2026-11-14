import { beforeEach, expect, it, vi } from 'vitest';
import type { ChangeEvent, ReactElement, ReactNode } from 'react';
import { HyperComposer, type HyperComposerProps } from './hyper-composer';
import { HyperConversationDraftCache, hyperUploadDraftFiles } from '../HyperConversationDraft';

// Exercise the real input handler across renders, retaining its hook state and refs.
const hooks = vi.hoisted(() => ({ state: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0 }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  return { ...react,
    useEffect: () => {},
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
beforeEach(() => { hooks.state = []; hooks.refs = []; hooks.stateIndex = 0; hooks.refIndex = 0; });
function find(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const match = find(child, predicate); if (match) return match; }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as ReactElement<Record<string, unknown>>;
    return predicate(element) ? element : find(element.props.children as ReactNode, predicate);
  }
}
function render(props: HyperComposerProps) {
  hooks.stateIndex = 0; hooks.refIndex = 0;
  return HyperComposer(props);
}
function pick(tree: ReactNode, files: File[]) {
  const input = find(tree, element => element.type === 'input' && element.props.type === 'file')!;
  (input.props.onChange as (event: ChangeEvent<HTMLInputElement>) => void)({ target: { files, value: 'selected' } } as unknown as ChangeEvent<HTMLInputElement>);
}
it('counts channel upload placeholders once across renders and rapid picks, while preserving the eight-file limit', async () => {
  const lease = new HyperConversationDraftCache(() => 'group').acquire('channel');
  const completions: (() => void)[] = [];
  const upload = vi.fn((file: File) => new Promise<Awaited<ReturnType<Parameters<typeof hyperUploadDraftFiles>[1]>>>(resolve => {
    completions.push(() => resolve({ id: file.name, name: file.name, mimeType: file.type, status: 'ready' }));
  }));
  const onFiles = vi.fn((files: readonly File[]) => hyperUploadDraftFiles(files, upload, change => {
    lease.update(current => ({ ...current, attachments: change(current.attachments) }));
  }, vi.fn()));
  const submit = vi.fn();
  const props = (): HyperComposerProps & { getAttachmentCount(): number } => ({
    onSubmit: submit, onFiles, value: 'Draft', attachments: lease.get().attachments,
    getAttachmentCount: () => lease.get().attachments.length,
  });
  const file = (index: number) => new File(['x'], `file-${index}.txt`, { type: 'text/plain' });
  pick(render(props()), [0, 1, 2, 3].map(file));
  expect(lease.get().attachments).toHaveLength(4);
  const reopened = render(props());
  pick(reopened, [file(4)]);
  expect(onFiles).toHaveBeenCalledTimes(2);
  // The same render must consult the cache, not its captured attachment array.
  pick(reopened, [5, 6, 7, 8].map(file));
  expect(onFiles).toHaveBeenCalledTimes(3);
  expect(onFiles.mock.calls[2][0]).toHaveLength(3);
  expect(lease.get().attachments).toHaveLength(8);
  const current = render(props());
  expect(find(current, element => element.props['aria-label'] === 'Send message')!.props.disabled).toBe(true);
  pick(current, [file(9)]);
  expect(onFiles).toHaveBeenCalledTimes(3);
  while (completions.length) { completions.shift()!(); await Promise.resolve(); await Promise.resolve(); }
  await Promise.all(onFiles.mock.results.map(result => result.value));
  expect(lease.get().attachments.every(attachment => attachment.status === 'ready')).toBe(true);
  expect(submit).not.toHaveBeenCalled();
});
