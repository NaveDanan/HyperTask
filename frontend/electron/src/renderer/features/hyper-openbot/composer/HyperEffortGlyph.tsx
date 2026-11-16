// Ported from t3code (apps/web/src/components/chat/EffortGlyph.tsx), Copyright (c) 2026 T3 Tools Inc., MIT License. See NOTICE.md in features/settings/appearance.

import { HyperEffortLabel } from './hyper-models';

const GLYPH_HEIGHT = 14;
// Bars stop this far above the box's bottom, which puts their flat base on the text baseline.
const BASELINE_INSET = 2;
// Named levels keep their word instead of bars. Off levels leave the first bar empty.
const NAMED_LEVELS = new Set(['ultracode', 'max']);
const OFF_LEVELS = new Set(['off', 'none']);
// More bars than this no longer fit the glyph's height in whole pixels.
const MAX_BARS = 7;

/**
 * Maps a model's effort levels to bars: one per ordinary level, filled up to the current one, with an
 * off level as none filled. Max and workflow levels are named instead of drawn.
 */
export function resolveHyperEffortGlyph(efforts: readonly string[], current: string | null) {
  const levels = efforts.filter((effort) => !NAMED_LEVELS.has(effort));
  if (levels.length < 2 || levels.length > MAX_BARS || current === null) return null;
  const startsAtOff = OFF_LEVELS.has(levels[0]);
  const count = startsAtOff ? levels.length - 1 : levels.length;
  const label = HyperEffortLabel(current);
  if (NAMED_LEVELS.has(current)) return { count, filled: count, special: label, label };
  const index = levels.indexOf(current);
  if (index < 0) return null;
  return { count, filled: startsAtOff ? index : index + 1, special: null, label };
}

/** Bar heights that rise by one whole-pixel step, from about half height up to `maxBar`. */
export function hyperEffortBarHeights(count: number, maxBar: number): number[] {
  // Rounding each bar separately mixes 1px and 2px steps, so round the step once.
  const step = Math.max(1, Math.round(maxBar / 2 / Math.max(count - 1, 1)));
  return Array.from({ length: count }, (_, index) => maxBar - (count - 1 - index) * step);
}

/**
 * Rising bars on whole pixels so they stay sharp on 1x displays. Color follows the text.
 * The bars are hidden from assistive technology; the label carries the level's name instead.
 */
export function HyperEffortGlyph({ count, filled, label }: { count: number; filled: number; label: string }) {
  const step = 4;
  const width = step * count - 2;
  const maxBar = GLYPH_HEIGHT - BASELINE_INSET;
  return (
    <>
      <svg
        aria-hidden="true"
        width={width}
        height={GLYPH_HEIGHT}
        viewBox={`0 0 ${width} ${GLYPH_HEIGHT}`}
        // Inline size, so no stylesheet can resize the bars.
        style={{ width, height: GLYPH_HEIGHT }}
        className="shrink-0 text-current"
        data-hyper-effort-glyph
      >
        {hyperEffortBarHeights(count, maxBar).map((barHeight, index) => {
          const x = index * step;
          return (
            <rect
              key={x}
              x={x}
              y={maxBar - barHeight}
              width={2}
              height={barHeight}
              fill="currentColor"
              opacity={index < filled ? 1 : 0.4}
            />
          );
        })}
      </svg>
      <span className="sr-only">{label}</span>
    </>
  );
}
