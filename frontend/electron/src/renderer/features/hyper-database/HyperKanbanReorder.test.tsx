import { beforeEach, expect, it, vi } from 'vitest';
import type { DragEndEvent } from '@dnd-kit/core';
import { Kanban, type KanbanCommitMeta } from '@/components/reui/kanban';

const hooks = vi.hoisted(() => ({ index: 0, values: [] as unknown[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.values)) hooks.values[i] = initial; return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }]; },
  useRef: (initial: unknown) => { const i = hooks.index++; return hooks.values[i] ??= { current: initial }; },
  useMemo: (factory: () => unknown) => factory(), useCallback: (fn: unknown) => fn,
  useLayoutEffect: (fn: () => void) => fn(),
}));
vi.mock('@dnd-kit/core', async original => ({ ...await original<typeof import('@dnd-kit/core')>(), useSensor: () => ({}), useSensors: () => [] }));
vi.mock('@base-ui/react/use-render', () => ({ useRender: () => null }));
beforeEach(() => { hooks.index = 0; hooks.values = []; });

it('commits the previewed same-column reorder once instead of moving the card back', () => {
  let value = { todo: ['a', 'b', 'c'] };
  const commit = vi.fn<(value: Record<string, string[]>, meta: KanbanCommitMeta<string>) => void>();
  const render = () => {
    hooks.index = 0;
    const tree = Kanban({ value, onValueChange: next => { value = next as typeof value; }, getItemValue: id => id, onValueCommit: commit, children: null });
    return tree.props.children.props;
  };
  const event: DragEndEvent = { active: { id: 'a', data: { current: {} }, rect: { current: { initial: null, translated: null } } }, over: { id: 'b', data: { current: {} }, disabled: false, rect: { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 } }, activatorEvent: new Event('pointerdown'), collisions: null, delta: { x: 0, y: 0 } };
  render().onDragStart(event);
  render().onDragOver(event);
  expect(value.todo).toEqual(['b', 'a', 'c']);
  render().onDragEnd(event);
  expect(value.todo).toEqual(['b', 'a', 'c']);
  expect(commit).toHaveBeenCalledOnce();
  expect(commit.mock.calls[0][0]).toEqual(value);
  expect(commit.mock.calls[0][1]).toMatchObject({ activeIndex: 0, overIndex: 1, previousValue: { todo: ['a', 'b', 'c'] } });
});
