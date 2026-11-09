import { Children, isValidElement, type ChangeEvent, type ComponentProps, type KeyboardEvent, type ReactElement, type ReactNode, type Ref } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '@/components/ui/input';
import { AFTextField, type AFTextFieldHandle, type AFTextFieldProps } from './Inputs';

// A hook seam lets us exercise the existing imperative API without adding a DOM package.
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  input: { value: 'DOM value', focus: vi.fn(), select: vi.fn() },
}));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    useRef: () => ({ current: hooks.input }),
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      if (index >= hooks.states.length) hooks.states[index] = initial;
      return [hooks.states[index], (value: unknown) => { hooks.states[index] = value; }];
    },
    useImperativeHandle: (ref: { current: unknown }, create: () => unknown) => { ref.current = create(); },
    useEffect: (effect: () => void) => effect(),
  };
});

function findInput(node: ReactNode): ReactElement<ComponentProps<typeof Input>> {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === Input) return child as ReactElement<ComponentProps<typeof Input>>;
    if (child.props.children) {
      try { return findInput(child.props.children); } catch { /* Search the next sibling. */ }
    }
  }
  throw new Error('Input was not rendered');
}
function field(props: AFTextFieldProps = {}) {
  const ref = { current: null as AFTextFieldHandle | null };
  const render = (AFTextField as unknown as { render: (props: AFTextFieldProps, ref: Ref<AFTextFieldHandle>) => ReactNode }).render;
  const rerender = () => {
    hooks.cursor = 0;
    return findInput(render(props, ref));
  };
  return { input: rerender(), ref, rerender };
}
beforeEach(() => {
  hooks.states = [];
  hooks.cursor = 0;
  hooks.input.value = 'DOM value';
  vi.clearAllMocks();
});

describe('AFTextField compatibility', () => {
  it('keeps focus, selection, DOM value, obscuring and error synchronization handles', () => {
    const { ref, rerender } = field();
    ref.current?.focus();
    ref.current?.select();
    expect(hooks.input.focus).toHaveBeenCalledTimes(1);
    expect(hooks.input.select).toHaveBeenCalledTimes(1);
    expect(ref.current?.value()).toBe('DOM value');
    ref.current?.syncObscured(true);
    expect(rerender().props.type).toBe('password');
    ref.current?.syncError('Invalid');
    expect(rerender().props['aria-invalid']).toBe(true);
    ref.current?.clearError();
    expect(rerender().props['aria-invalid']).toBeUndefined();
  });

  it('preserves changed/submitted/Escape callbacks and validation', () => {
    const onChanged = vi.fn();
    const onSubmitted = vi.fn();
    const onEscape = vi.fn();
    const { input, rerender } = field({ onChanged, onSubmitted, onEscape, validator: (value) => [value === '', 'Required'] });
    input.props.onChange?.({ target: { value: '' } } as ChangeEvent<HTMLInputElement>);
    expect(onChanged).toHaveBeenCalledWith('');
    expect(rerender().props['aria-invalid']).toBe(true);
    input.props.onChange?.({ target: { value: 'Valid' } } as ChangeEvent<HTMLInputElement>);
    expect(rerender().props['aria-invalid']).toBeUndefined();
    input.props.onKeyDown?.({ key: 'Enter', currentTarget: { value: 'Submitted' } } as KeyboardEvent<HTMLInputElement>);
    input.props.onKeyDown?.({ key: 'Escape' } as KeyboardEvent<HTMLInputElement>);
    expect(onSubmitted).toHaveBeenCalledWith('Submitted');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('keeps controlled/uncontrolled values, numeric input mode, readonly, and autofocus', () => {
    const uncontrolled = field({ initialText: 'Initial', type: 'number', readOnly: true, maxLength: 8, autoFocus: true });
    expect(uncontrolled.input.props).toMatchObject({ defaultValue: 'Initial', type: 'text', inputMode: 'numeric', readOnly: true, maxLength: 8 });
    expect(hooks.input.focus).toHaveBeenCalledTimes(1);
    const controlled = field({ value: 'Controlled', initialText: 'Ignored' });
    expect(controlled.input.props.value).toBe('Controlled');
    expect(controlled.input.props.defaultValue).toBeUndefined();
  });
});
