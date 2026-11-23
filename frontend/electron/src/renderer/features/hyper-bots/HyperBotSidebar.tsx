// Ported from bot-hq (web/src/components/Sidebar.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { Plus } from 'lucide-react';
import type { HyperBotsConnections, HyperBotsRoom, HyperBotsSettings } from '@shared/HyperBots';
import { cn } from '@/lib/utils';
import { HyperBotAvatarFor, HyperBotMembersAvatar } from './HyperBotAvatar';
import type { HyperBotsRoomSummary } from './HyperBotsController';
import { hyperBotType } from './HyperBotSettings';
import { HyperBotProviderLogo } from './HyperBotBrandLogos';
export function HyperBotStatusDot({ summary }: { summary?: HyperBotsRoomSummary }) {
  if (!summary || !summary.pendingApprovals && !summary.activeRun && !summary.unread) return null;
  return <span className={cn('status-dot', summary.pendingApprovals ? 'is-attention' : summary.activeRun ? 'is-working' : 'is-unread')} role="img" aria-label={summary.pendingApprovals ? summary.pendingApprovals + ' waiting for you' : summary.activeRun ? 'Working' : 'Unread activity'} />;
}
export function HyperBotConnections({ connections, compact = false }: { connections: HyperBotsConnections; compact?: boolean }) {
  return <div className={compact ? 'connection-pills' : 'panel-card connections'}>{(['model', 'outlook', 'jira'] as const).map(key => {
    const state = connections[key], name = key === 'model' ? 'Model' : key === 'outlook' ? 'Outlook' : 'Jira';
    return <div key={key} className={compact ? 'connection-pill' : 'panel-row'} title={state.ready ? state.detail : state.problem}>
      <i aria-hidden="true" className={cn('connection-dot', state.ready ? 'is-ready' : state.checking ? 'is-checking' : 'is-problem')} /><HyperBotProviderLogo provider={key === 'model' ? null : key} /><span className="panel-row__text"><span className="panel-row__title">{name}</span>{!compact && <span className="connection-detail">{state.ready ? state.detail : state.problem}</span>}</span><span className="sr-only">{state.ready ? 'Ready' : state.checking ? 'Checking' : 'Needs setup'}</span>
    </div>;
  })}</div>;
}
export function HyperBotSidebar({ settings, roomId, summaries, connections, onSelect, onCreate, onGroup, busy }: {
  settings: HyperBotsSettings; roomId: string; summaries?: Record<string, HyperBotsRoomSummary>; connections: HyperBotsConnections;
  onSelect: (id: string) => void; onCreate: () => void; onGroup: () => void; busy?: boolean;
}) {
  const primary = settings.bots[0], others = settings.bots.slice(1), capped = settings.bots.length >= 8;
  const direct = (id: string) => settings.rooms.find(room => room.kind === 'direct' && room.botIds[0] === id);
  const groups = settings.rooms.filter(room => room.kind !== 'direct');
  const pick = (room?: HyperBotsRoom) => { if (room && !busy) onSelect(room.id); };
  return <aside className="sidebar" aria-label="Hyper-Bot sidebar"><div className="sidebar__titlebar"><h1>Hyper-Bot</h1></div><div className="sidebar__scroll">
    {primary && <div className="pinned"><button type="button" className={cn('pinned__tile', direct(primary.id)?.id === roomId && 'is-selected')} aria-current={direct(primary.id)?.id === roomId || undefined} onClick={() => pick(direct(primary.id))} title={primary.name}><span className="pinned__avatar"><HyperBotAvatarFor bot={primary} size={60} /><HyperBotStatusDot summary={summaries?.[direct(primary.id)?.id ?? '']} /></span><span className="pinned__label">{primary.name}</span></button></div>}
    <div className="bot-list">{others.map(bot => { const room = direct(bot.id), summary = summaries?.[room?.id ?? '']; return <button key={bot.id} type="button" className={cn('bot-row', room?.id === roomId && 'is-selected')} aria-current={room?.id === roomId || undefined} title={bot.name} onClick={() => pick(room)}><span className="bot-row__avatar"><HyperBotAvatarFor bot={bot} size={36} /><HyperBotStatusDot summary={summary} /></span><span className="bot-row__text"><span className="bot-row__name">{bot.name}</span><span className="bot-row__preview" dir="auto">{summary?.preview || hyperBotType(bot)}</span></span></button>; })}</div>
    <section className="group-list" aria-label="Group chats"><div className="hb-group-heading"><h2 className="section-label">Group chats</h2><button type="button" className="hb-new-group" aria-label="New group chat" title="New group chat" onClick={onGroup} disabled={busy}><Plus size={14} /></button></div>{groups.map(room => <button key={room.id} type="button" className={cn('bot-row', room.id === roomId && 'is-selected')} aria-current={room.id === roomId || undefined} title={room.name} onClick={() => pick(room)}><span className="bot-row__avatar"><HyperBotMembersAvatar bots={settings.bots.filter(bot => room.botIds.includes(bot.id))} /><HyperBotStatusDot summary={summaries?.[room.id]} /></span><span className="bot-row__text"><span className="bot-row__name">{room.name}</span><span className="bot-row__preview" dir="auto">{summaries?.[room.id]?.preview || room.botIds.length + ' bots'}</span></span></button>)}</section>
    <button type="button" className="bot-list__empty" aria-disabled={capped || busy} onClick={capped || busy ? undefined : onCreate} title={capped ? '8 bot limit reached. Edit or delete a bot to make room.' : undefined}><span className="bot-list__empty-plus"><Plus size={14} /></span><span><span className="bot-row__name">{capped ? '8 bot limit reached' : 'Create a Bot'}</span><span className="bot-row__preview">{capped ? 'Edit or delete a bot to make room' : 'Give it a job, like inbox triage or Jira filing'}</span></span></button>
    </div><div className="sidebar__footer"><HyperBotConnections connections={connections} compact /></div>
  </aside>;
}
