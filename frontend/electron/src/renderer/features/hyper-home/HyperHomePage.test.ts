import { describe, expect, it, vi } from 'vitest';
// HyperHomePage imports DOM-only UI and feature modules; the split math needs none of them, so stub the imports for this Node test.
vi.mock('@/components/ui/button', () => ({}));
vi.mock('@/components/ui/empty', () => ({}));
vi.mock('@/components/ui/skeleton', () => ({}));
vi.mock('@/features/sidebar/stores/space-store', () => ({}));
vi.mock('@/features/tabs/tabs-store', () => ({}));
vi.mock('@/features/hyper-outlook/HyperGeneralCalendar', () => ({}));
vi.mock('@/features/hyper-database/HyperDatabasePage', () => ({}));
vi.mock('@/features/hyper-database/useHyperDatabase', () => ({}));
vi.mock('./HyperGeneralKanban', () => ({}));
import { clampHyperHomeSplit, hyperHomeSplitDefault, hyperHomeTopBasis, readHyperHomeSplit } from './HyperHomePage';

// Each section keeps 120px; the handle centre sits at the split, so the edge is (120 + 4) / height.
describe('clampHyperHomeSplit', () => {
  it('keeps the split inside the minimum-height edges', () => {
    expect(clampHyperHomeSplit(0.01, 800)).toBeCloseTo(124 / 800);
    expect(clampHyperHomeSplit(0.99, 800)).toBeCloseTo(1 - 124 / 800);
  });
  it('passes through splits that already fit', () => {
    expect(clampHyperHomeSplit(0.37, 800)).toBe(0.37);
  });
  it('falls back to 50/50 when the container cannot fit both minimums or the split is not finite', () => {
    expect(clampHyperHomeSplit(0.2, 200)).toBe(hyperHomeSplitDefault);
    expect(clampHyperHomeSplit(0.2, 0)).toBe(hyperHomeSplitDefault);
    expect(clampHyperHomeSplit(NaN, 800)).toBe(hyperHomeSplitDefault);
  });
});

describe('readHyperHomeSplit', () => {
  it('accepts a stored fraction strictly between 0 and 1', () => {
    expect(readHyperHomeSplit('0.3')).toBe(0.3);
  });
  it('defaults to 50/50 for missing, malformed, or out-of-range values', () => {
    for (const raw of [null, '', 'abc', '0', '1', '1.5', '-0.2']) expect(readHyperHomeSplit(raw)).toBe(hyperHomeSplitDefault);
  });
});

describe('hyperHomeTopBasis', () => {
  it('centres the 8px handle on the split and clamps both sections to 120px', () => {
    expect(hyperHomeTopBasis(0.5)).toBe('clamp(120px, calc(50% - 4px), calc(100% - 128px))');
  });
});
