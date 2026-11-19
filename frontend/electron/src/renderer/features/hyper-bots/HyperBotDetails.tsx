// Ported from bot-hq (web/src/components/DetailsPanel.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useState } from 'react';
import { Settings, X } from 'lucide-react';
import type { HyperBotConfig, HyperBotsSnapshot } from '@shared/HyperBots';
import type { HyperBotsViewState } from './HyperBotsController';
import type { HyperBotActions } from './HyperBotScreen';
import { cn } from '@/lib/utils';
import { HyperBotAvatarFor, HyperBotMembersAvatar, hyperBotAvatarOf } from './HyperBotAvatar';
import { botVars } from './HyperBotColors';
import { hyperBotType } from './HyperBotSettings';
import { HyperBotConnections } from './HyperBotSidebar';
import { HyperBotEngine } from './HyperBotEngine';
import { HyperBotTools } from './HyperBotTools';
import { HyperBotMemoryPanel } from './HyperBotRoutineMemory';
import { HyperBotMembers } from './HyperBotMembers';
import { HyperBotsDecided } from './HyperBotApproval';
export function HyperBotDetails({ state, actions, bot, name, members, onClose, onSettings }: { state: HyperBotsViewState & { snapshot: HyperBotsSnapshot }; actions: HyperBotActions; bot?: HyperBotConfig; name: string; members: HyperBotConfig[]; onClose: () => void; onSettings: () => void }) {
  const [tab, setTab] = useState<'activity' | 'tools' | 'memory'>('activity'), snapshot = state.snapshot;
  const room = snapshot.settings.rooms.find(row => row.id === snapshot.roomId)!;
  const decided = snapshot.approvals.filter(row => row.status !== 'pending');
  return <aside className="details" style={botVars(bot && hyperBotAvatarOf(bot).color)} aria-label="Conversation details"><div className="details__top"><button type="button" className="icon-btn icon-btn--bordered details__gear" onClick={onSettings} aria-label={bot ? 'Bot settings' : 'Group settings'}><Settings size={16} /></button><button type="button" className="icon-btn icon-btn--bordered" onClick={onClose} aria-label="Close details"><X size={16} /></button></div>
  <div className="details__scroll"><div className="details__hero"><div className="details__who">{bot ? <HyperBotAvatarFor bot={bot} size={36} /> : <HyperBotMembersAvatar bots={members} size={36} />}<div className="details__who-text"><div className="details__who-head"><span className="details__who-name" title={name}>{name}</span>{bot && <span className="details__model" title={bot.model || snapshot.connections.model.defaultModel || 'Endpoint default'}>{bot.model || snapshot.connections.model.defaultModel || 'Default'}</span>}</div><div className="details__who-sub">{bot ? hyperBotType(bot) : members.length + ' members'}</div></div></div></div>
    {bot && <div className="details__tabs"><div className="segmented" role="tablist" aria-label="Conversation details sections"><button type="button" role="tab" aria-selected={tab === 'activity'} className={cn(tab === 'activity' && 'is-active')} onClick={() => setTab('activity')}>Activity</button>{bot && <button type="button" role="tab" aria-selected={tab === 'tools'} className={cn(tab === 'tools' && 'is-active')} onClick={() => setTab('tools')}>Tools</button>}<button type="button" role="tab" aria-selected={tab === 'memory'} className={cn(tab === 'memory' && 'is-active')} onClick={() => setTab('memory')}>Memory</button></div></div>}
    {tab === 'memory' && bot ? <HyperBotMemoryPanel notes={snapshot.memory ?? []} enabled={bot.learn === true} /> : tab === 'tools' && bot ? <HyperBotTools settings={snapshot.settings} bot={bot} saving={state.saving} error={state.settingsError} onSave={actions.saveSettings} /> : <div className="details__sections">{bot ? <><section><h3 className="section-label">Connections</h3><HyperBotConnections connections={snapshot.connections} /></section><section><h3 className="section-label">Engine</h3><HyperBotEngine bot={bot} settings={snapshot.settings} connection={snapshot.connections.model} models={state.models} saving={state.saving} error={state.settingsError} onSave={actions.saveSettings} /></section></> : <section><h3 className="section-label">Members</h3><HyperBotMembers room={room} settings={snapshot.settings} saving={state.saving} error={state.settingsError} onSave={actions.saveSettings} /></section>}
      <section><h3 className="section-label">Recent decisions</h3><div className="panel-card decisions">{decided.length ? <HyperBotsDecided approvals={decided} settings={snapshot.settings} flat /> : <p className="panel-empty">No decisions in this conversation yet.</p>}</div></section>
    </div>}
  </div></aside>;
}
