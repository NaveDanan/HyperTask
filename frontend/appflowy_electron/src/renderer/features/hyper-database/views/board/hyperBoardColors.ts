import { SelectOptionColorPB } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import type { HyperGroup } from '../../HyperDatabaseTypes';

/** User-authored select colours, shared by dots and card badges. Keep full class literals. */
const hyperBoardColors: Record<SelectOptionColorPB, { dot: string; badge: string }> = {
  [SelectOptionColorPB.Purple]: { dot: 'bg-purple-500', badge: 'bg-purple-500/12 text-purple-700 dark:bg-purple-400/15 dark:text-purple-300 border-transparent' },
  [SelectOptionColorPB.Pink]: { dot: 'bg-pink-500', badge: 'bg-pink-500/12 text-pink-700 dark:bg-pink-400/15 dark:text-pink-300 border-transparent' },
  [SelectOptionColorPB.LightPink]: { dot: 'bg-rose-500', badge: 'bg-rose-500/12 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300 border-transparent' },
  [SelectOptionColorPB.Orange]: { dot: 'bg-orange-500', badge: 'bg-orange-500/12 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300 border-transparent' },
  [SelectOptionColorPB.Yellow]: { dot: 'bg-amber-500', badge: 'bg-amber-500/12 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300 border-transparent' },
  [SelectOptionColorPB.Lime]: { dot: 'bg-lime-500', badge: 'bg-lime-500/12 text-lime-700 dark:bg-lime-400/15 dark:text-lime-300 border-transparent' },
  [SelectOptionColorPB.Green]: { dot: 'bg-green-500', badge: 'bg-green-500/12 text-green-700 dark:bg-green-400/15 dark:text-green-300 border-transparent' },
  [SelectOptionColorPB.Aqua]: { dot: 'bg-cyan-500', badge: 'bg-cyan-500/12 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300 border-transparent' },
  [SelectOptionColorPB.Blue]: { dot: 'bg-blue-500', badge: 'bg-blue-500/12 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300 border-transparent' },
};
export function hyperBoardOptionColor(color: SelectOptionColorPB) {
  return hyperBoardColors[color] ?? { dot: 'bg-muted-foreground', badge: 'bg-secondary text-secondary-foreground border-transparent' };
}
export function hyperBoardGroupDot(group: HyperGroup, checkbox = false) {
  if (checkbox) return group.groupId === 'Yes' ? 'bg-success' : 'bg-muted-foreground/40';
  if (group.isDefault) return 'border border-dashed border-muted-foreground/60 bg-transparent';
  return group.option ? hyperBoardOptionColor(group.option.color).dot : 'bg-muted-foreground/40';
}
