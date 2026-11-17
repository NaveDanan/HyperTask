// Ported from bot-hq (web/src/components/modals/CreateBotModal.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { HYPER_BOT_AVATAR_SHAPES, HYPER_BOT_AVATAR_COLORS, type HyperBotAvatarShape, type HyperBotAvatarColor, type HyperBotMode } from '@shared/HyperBots';
import { HyperBotAvatar } from './HyperBotAvatar';
import { palette } from './HyperBotColors';
import { cn } from '@/lib/utils';
const ROWS = [HYPER_BOT_AVATAR_SHAPES.slice(0, 5), HYPER_BOT_AVATAR_SHAPES.slice(5, 10), HYPER_BOT_AVATAR_SHAPES.slice(10)];
const COLOR_ROWS = [HYPER_BOT_AVATAR_COLORS.slice(0, 6), HYPER_BOT_AVATAR_COLORS.slice(6)];
function navigate(event: React.KeyboardEvent, index: number, length: number, pick: (index: number) => void) {
  const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
  if (!delta && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? length - 1 : (index + delta + length) % length;
  pick(next);
  event.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
}
export function HyperBotPickers({ shape, color, onShape, onColor }: { shape: HyperBotAvatarShape; color: HyperBotAvatarColor; onShape: (value: HyperBotAvatarShape) => void; onColor: (value: HyperBotAvatarColor) => void }) {
  return <><div className="shape-grid" role="radiogroup" aria-label="Character shape">{ROWS.map((row, i) => <div key={i} className="shape-grid__row">{row.map(s => <button key={s} type="button" role="radio" tabIndex={shape === s ? 0 : -1} aria-checked={shape === s} aria-label={s} className="shape-cell" onClick={() => onShape(s)} onKeyDown={event => navigate(event, HYPER_BOT_AVATAR_SHAPES.indexOf(s), 13, index => onShape(HYPER_BOT_AVATAR_SHAPES[index]!))}><HyperBotAvatar shape={s} color={color} size={36} ring={shape === s} /></button>)}</div>)}</div>
    <div className="swatches" role="radiogroup" aria-label="Character color">{COLOR_ROWS.map((row, i) => <div key={i} className="swatches__row">{row.map(c => <button key={c} type="button" role="radio" tabIndex={color === c ? 0 : -1} aria-checked={color === c} aria-label={c} className="swatch-cell" onClick={() => onColor(c)} onKeyDown={event => navigate(event, HYPER_BOT_AVATAR_COLORS.indexOf(c), 11, index => onColor(HYPER_BOT_AVATAR_COLORS[index]!))}><span className={cn('swatch', color === c && 'is-selected')} style={{ background: palette(c).fill }} /></button>)}</div>)}</div></>;
}
export function HyperBotModePicker({ mode, onChange }: { mode: HyperBotMode; onChange: (mode: HyperBotMode) => void }) {
  return <div className="mode-pick" role="radiogroup" aria-label="Bot type">{(['personal', 'teammate'] as const).map((value, i) => <button key={value} type="button" role="radio" tabIndex={mode === value ? 0 : -1} aria-checked={mode === value} className={cn('mode-pick__opt', mode === value && 'is-active')} onClick={() => onChange(value)} onKeyDown={event => navigate(event, i, 2, index => onChange(index === 0 ? 'personal' : 'teammate'))}>
    <span className="mode-pick__title">{value === 'personal' ? 'Personal assistant' : 'Teammate'}</span><span className="mode-pick__sub">{value === 'personal' ? 'Works for you, with your apps' : 'Works with your whole team'}</span>
  </button>)}</div>;
}
