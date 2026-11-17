// Ported from bot-hq (web/src/components/EngineSettings.tsx, the `mini-select--native` control), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
/** The value and a chevron drawn as a pill, over a transparent native select that keeps the OS list and keyboard use. */
export function HyperBotMiniSelect({ label, value, options, onChange, className }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; className?: string;
}) {
  const current = options.find(option => option.value === value)?.label ?? value;
  return <span className={cn('mini-select mini-select--native', className)} title={current}>
    <span className="mini-select__value">{current}</span><ChevronDown size={12} aria-hidden="true" className="mini-select__chevron" />
    <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </span>;
}
