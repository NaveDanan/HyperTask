// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted for HyperTask, developed by NaveDanan. See REUSE.md.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HyperEffortLabel, HyperSwitchModel, type HyperModelOption, type HyperModelPick } from './hyper-models';

export interface HyperModelPickerProps {
  models: readonly HyperModelOption[];
  value: HyperModelPick;
  onChange: (value: HyperModelPick) => void;
  disabled?: boolean;
  onPicked?: () => void;
}

export function HyperModelPicker({ models, value, onChange, disabled, onPicked }: HyperModelPickerProps) {
  const selected = models.find((model) => model.id === value.model);
  return <div className="flex flex-wrap items-center gap-2">
    <Select value={value.model} disabled={disabled || !models.length} onValueChange={(id) => {
      const next = models.find((model) => model.id === id);
      if (next) { onChange(HyperSwitchModel(value, next)); onPicked?.(); }
    }}>
      <SelectTrigger size="sm" aria-label="Model"><SelectValue>{selected?.label ?? value.model}</SelectValue></SelectTrigger>
      <SelectContent>{models.map((model) => <SelectItem key={model.id} value={model.id} disabled={model.disabled}>{model.label}</SelectItem>)}</SelectContent>
    </Select>
    {!!selected?.efforts?.length && <Select value={value.effort ?? ''} disabled={disabled} onValueChange={(effort) => {
      onChange({ model: value.model, effort: effort || null }); onPicked?.();
    }}>
      <SelectTrigger size="sm" aria-label="Thinking effort"><SelectValue>{value.effort ? HyperEffortLabel(value.effort) : 'Default thinking'}</SelectValue></SelectTrigger>
      <SelectContent><SelectItem value="">Default thinking</SelectItem>{selected.efforts.map((effort) => <SelectItem key={effort} value={effort}>{HyperEffortLabel(effort)}</SelectItem>)}</SelectContent>
    </Select>}
  </div>;
}
