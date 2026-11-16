/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Exercise the private stack drain without a DOM dependency or a test-only public API.
// Closing schedules React effect cleanup; it does not synchronously remove the entry.
interface Entry {
  id: number;
  asBarrier: boolean;
  close: () => void;
  canClose?: () => Promise<boolean> | boolean;
}
const source = readFileSync(new URL('./Popover.tsx', import.meta.url), 'utf8');
const drainSource = source.slice(source.indexOf('async function popEntries('), source.indexOf('/** PopoverMutex'));
function createDrain(stack: Entry[]) {
  const notifyStack = vi.fn();
  const drain = new Function('stack', 'notifyStack', drainSource.replace('useCanClose: boolean', 'useCanClose') + '; return popEntries;')(stack, notifyStack) as (check: boolean) => Promise<void>;
  return { drain, notifyStack };
}
function entry(id: number, asBarrier = false): Entry {
  const close = vi.fn(() => {
    if (close.mock.calls.length > 1) throw new Error('Repeated close before React cleanup: page would hang');
  });
  return { id, asBarrier, close };
}

describe('popover stack closing', () => {
  it('Escape drains each entry once before deferred effect cleanup', async () => {
    const bottom = entry(1);
    const top = entry(2);
    const stack = [bottom, top];
    await createDrain(stack).drain(false);
    expect(top.close).toHaveBeenCalledTimes(1);
    expect(bottom.close).toHaveBeenCalledTimes(1);
    expect(stack).toHaveLength(0);
  });

  it('outside-click closing stops after the nearest barrier', async () => {
    const bottom = entry(1);
    const barrier = entry(2, true);
    const top = entry(3);
    const stack = [bottom, barrier, top];
    await createDrain(stack).drain(true);
    expect(top.close).toHaveBeenCalledTimes(1);
    expect(barrier.close).toHaveBeenCalledTimes(1);
    expect(bottom.close).not.toHaveBeenCalled();
    expect(stack).toEqual([bottom]);
  });

  it('outside clicks respect an asynchronous close veto; Escape bypasses it', async () => {
    const top = entry(1);
    top.canClose = vi.fn(async () => false);
    const stack = [top];
    const { drain } = createDrain(stack);
    await drain(true);
    expect(top.close).not.toHaveBeenCalled();
    expect(stack).toEqual([top]);
    await drain(false);
    expect(top.close).toHaveBeenCalledTimes(1);
    expect(top.canClose).toHaveBeenCalledTimes(1);
  });

  it('does not close a replacement stack while awaiting canClose', async () => {
    let allow!: (value: boolean) => void;
    const original = entry(1);
    original.canClose = () => new Promise<boolean>((resolve) => { allow = resolve; });
    const replacement = entry(2);
    const stack = [original];
    const pending = createDrain(stack).drain(true);
    stack.splice(0, 1, replacement);
    allow(true);
    await pending;
    expect(replacement.close).not.toHaveBeenCalled();
  });
});
