import { vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

// Run production handlers with persistent hooks and dependency-aware effect cleanup.
// Media, HTTP and recognizer boundaries remain controlled by each test.
const context = vi.hoisted(() => ({ current: undefined as HyperHandlerHarness | undefined }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  return { ...react,
    useState: (initial: unknown) => {
      const h = context.current!, index = h.stateIndex++;
      if (!(index in h.states)) h.states[index] = typeof initial === 'function' ? initial() : initial;
      return [h.states[index], (next: unknown) => { h.states[index] = typeof next === 'function' ? next(h.states[index]) : next; }];
    },
    useRef: (initial: unknown) => { const h = context.current!, index = h.refIndex++; return h.refs[index] ?? (h.refs[index] = { current: initial }); },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const h = context.current!, index = h.effectIndex++, previous = h.effects[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        h.pending.push(() => { previous?.cleanup?.(); h.effects[index] = { deps, cleanup: effect() || undefined }; });
      }
    },
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  };
});
export class HyperHandlerHarness {
  states: unknown[] = [];
  refs: { current: unknown }[] = [];
  effects: { deps?: readonly unknown[]; cleanup?: () => void }[] = [];
  pending: (() => void)[] = [];
  stateIndex = 0;
  refIndex = 0;
  effectIndex = 0;
  render<P>(component: (props: P) => ReactNode, props: P) {
    this.stateIndex = this.refIndex = this.effectIndex = 0; this.pending = []; context.current = this;
    try { return component(props); } finally { context.current = undefined; }
  }
  flush() { const effects = this.pending; this.pending = []; effects.forEach(effect => effect()); }
  unmount() { this.effects.forEach(effect => effect.cleanup?.()); this.effects = []; }
}
export function hyperFind(node: ReactNode, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const found = hyperFind(child, predicate); if (found) return found; } }
  else if (node && typeof node === 'object' && 'props' in node) { const element = node as ReactElement<any>; return predicate(element) ? element : hyperFind(element.props.children, predicate); }
}
export const hyperFormSubmit = (tree: ReactNode) => hyperFind(tree, element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
export const hyperPickFiles = (tree: ReactNode, files: File[]) => hyperFind(tree, element => element.type === 'input' && element.props.type === 'file')!.props.onChange({ target: { files, value: '' } });
export const hyperButton = (tree: ReactNode, label: string) => hyperFind(tree, element => element.props.children === label && typeof element.props.onClick === 'function');
