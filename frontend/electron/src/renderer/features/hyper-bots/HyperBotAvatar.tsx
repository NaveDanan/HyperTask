// Ported from bot-hq (web/src/avatar/BotAvatar.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { HYPER_BOTS_DEFAULT_SETTINGS, HYPER_BOT_AVATAR_COLORS, HYPER_BOT_AVATAR_SHAPES, type HyperBotConfig, type HyperBotAvatarShape, type HyperBotAvatarColor } from '@shared/HyperBots';
import { palette, HYPER_BOT_EYES } from './HyperBotColors';
import { SHAPES } from './HyperBotShapes';
import { cn } from '@/lib/utils';
const OVERDRAW = 55.2 / 36;
export function HyperBotAvatar({ shape = 'blob', color = 'black', size, ring, className, title }: {
  shape?: HyperBotAvatarShape; color?: HyperBotAvatarColor; size: number; ring?: boolean; className?: string; title?: string;
}) {
  const def = SHAPES[shape] ?? SHAPES.blob;
  const draw = size * OVERDRAW, off = (draw - size) / 2;
  const px = Number(def.viewBox.split(/\s+/)[2]) / draw;
  return <span className={cn('bot-avatar', className)} style={{ width: size, height: size }} title={title} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
    <svg width={draw} height={draw} viewBox={def.viewBox} style={{ position: 'absolute', left: -off, top: -off, overflow: 'visible' }} aria-hidden="true">
      {ring && <path d={def.outline} fill="var(--hb-text-primary)" stroke="var(--hb-text-primary)" strokeWidth={px * 2 * 3.4} strokeLinejoin="round" />}
      {ring && <path d={def.outline} fill="var(--hb-bg-elevated)" stroke="var(--hb-bg-elevated)" strokeWidth={px * 2 * 2.4} strokeLinejoin="round" />}
      <path d={def.outline} fill={HYPER_BOT_EYES} />
      <path d={def.d} fill={palette(color).fill} fillRule="evenodd" />
    </svg>
  </span>;
}
export function HyperBotAvatarFor({ bot, size, className }: { bot: HyperBotConfig; size: number; className?: string }) {
  const avatar = hyperBotAvatarOf(bot);
  return <HyperBotAvatar shape={avatar.shape} color={avatar.color} size={size} title={bot.name} className={className} />;
}
/** Bots saved before avatars existed: the default bot's look for that id, else a shape and color picked from the id. */
export function hyperBotAvatarOf(bot: Pick<HyperBotConfig, 'id' | 'avatar'>): { shape: HyperBotAvatarShape; color: HyperBotAvatarColor } {
  const avatar = bot.avatar ?? HYPER_BOTS_DEFAULT_SETTINGS.bots.find(row => row.id === bot.id)?.avatar;
  if (avatar) return avatar;
  let hash = 0;
  for (const char of bot.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  // Colors 1..n-2 skip black and gray, which read as "no color".
  return { shape: HYPER_BOT_AVATAR_SHAPES[hash % HYPER_BOT_AVATAR_SHAPES.length]!, color: HYPER_BOT_AVATAR_COLORS[1 + hash % (HYPER_BOT_AVATAR_COLORS.length - 2)]! };
}
export function HyperBotMembersAvatar({ bots, size = 36 }: { bots: HyperBotConfig[]; size?: number }) {
  return <span className="members-avatar" style={{ width: size, height: size }} aria-label={bots.map(bot => bot.name).join(', ')} role="img">
    {bots.slice(0, 3).map((bot, i) => { const avatar = hyperBotAvatarOf(bot); return <span key={bot.id} style={{ left: i * size * .22, top: i % 2 * size * .2 }}><HyperBotAvatar shape={avatar.shape} color={avatar.color} size={size * .68} /></span>; })}
  </span>;
}
