// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted for HyperTask, developed by NaveDanan. See REUSE.md.
export type HyperModelOption = { id: string; label: string; efforts?: readonly string[]; defaultEffort?: string; disabled?: boolean };

export type HyperModelPick = { model: string; effort: string | null };

const EFFORT_LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export function HyperEffortLabel(effort: string): string {
  return (
    EFFORT_LABELS[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)
  );
}

export function HyperThinks(model: HyperModelOption | undefined): boolean {
  return (model?.efforts?.length ?? 0) > 0;
}

export function HyperAccepts(
  model: HyperModelOption | undefined,
  effort: string | null,
): effort is string {
  return effort !== null && (model?.efforts?.includes(effort) ?? false);
}

export function HyperShownEffort(
  model: HyperModelOption | undefined,
  effort: string | null,
): string | undefined {
  if (!HyperThinks(model)) return undefined;
  if (HyperAccepts(model, effort)) return effort;
  return model?.defaultEffort;
}

export function HyperSwitchModel(pick: HyperModelPick, next: HyperModelOption): HyperModelPick {
  return {
    model: next.id,
    effort: HyperAccepts(next, pick.effort) ? pick.effort : null,
  };
}
