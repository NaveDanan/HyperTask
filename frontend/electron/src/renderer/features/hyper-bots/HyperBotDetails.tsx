// Ported from bot-hq (web/src/components/DetailsPanel.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Settings, X } from 'lucide-react';
import type { HyperBotConfig, HyperBotsSnapshot } from '@shared/HyperBots';
import type { HyperBotsViewState } from './HyperBotsController';
import type { HyperBotActions } from './HyperBotScreen';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HyperBotAvatarFor, HyperBotMembersAvatar, hyperBotAvatarOf } from './HyperBotAvatar';
import { botVars } from './HyperBotColors';
import { hyperBotType } from './HyperBotSettings';
import { HyperBotConnections } from './HyperBotSidebar';
import { HyperBotEngine } from './HyperBotEngine';
import { HyperBotTools } from './HyperBotTools';
import { HyperBotMembers } from './HyperBotMembers';
import { HyperBotsDecided } from './HyperBotApproval';
import { HyperBotDedicatedAssets } from './HyperBotSkills';

function HyperBotActivitySection({ title, children, lazy = false }: { title: string; children: ReactNode; lazy?: boolean }) {
  const [opened, setOpened] = useState(false);
  return <details className="details__fold" onToggle={lazy && !opened ? event => {
    if (event.currentTarget.open) setOpened(true);
  } : undefined}>
    <summary className="details__summary">
      {title}<ChevronDown size={14} aria-hidden="true" className="details__chevron" />
    </summary>
    {(!lazy || opened) && <div className="details__fold-body">{children}</div>}
  </details>;
}

export function HyperBotDetails({ state, actions, bot, name, members, onClose, onSettings, onPersonalization }: {
  state: HyperBotsViewState & { snapshot: HyperBotsSnapshot };
  actions: HyperBotActions;
  bot?: HyperBotConfig;
  name: string;
  members: HyperBotConfig[];
  onClose: () => void;
  onSettings: () => void;
  onPersonalization: () => void;
}) {
  const [tab, setTab] = useState<'activity' | 'tools'>('activity'), snapshot = state.snapshot;
  const room = snapshot.settings.rooms.find(row => row.id === snapshot.roomId)!;
  const decided = snapshot.approvals.filter(row => row.status !== 'pending').slice(-20);
  return <aside className="details" style={botVars(bot && hyperBotAvatarOf(bot).color)} aria-label="Conversation details"><div className="details__top"><button type="button" className="icon-btn icon-btn--bordered details__gear" onClick={onSettings} aria-label={bot ? 'Bot settings' : 'Group settings'}><Settings size={16} /></button><button type="button" className="icon-btn icon-btn--bordered" onClick={onClose} aria-label="Close details"><X size={16} /></button></div>
  <div className="details__scroll"><div className="details__hero"><div className="details__who">{bot ? <HyperBotAvatarFor bot={bot} size={36} /> : <HyperBotMembersAvatar bots={members} size={36} />}<div className="details__who-text"><div className="details__who-head"><span className="details__who-name" title={name}>{name}</span>{bot && <span className="details__model" title={bot.model || snapshot.connections.model.defaultModel || 'Endpoint default'}>{bot.model || snapshot.connections.model.defaultModel || 'Default'}</span>}</div><div className="details__who-sub">{bot ? hyperBotType(bot) : members.length + ' members'}</div></div></div></div>
    {bot && <div className="details__tabs"><div className="segmented" role="tablist" aria-label="Conversation details sections"><button type="button" role="tab" aria-selected={tab === 'activity'} className={cn(tab === 'activity' && 'is-active')} onClick={() => setTab('activity')}>Activity</button>{bot && <button type="button" role="tab" aria-selected={tab === 'tools'} className={cn(tab === 'tools' && 'is-active')} onClick={() => setTab('tools')}>Tools</button>}</div></div>}
    {tab === 'tools' && bot
      ? <HyperBotTools settings={snapshot.settings} bot={bot} saving={state.saving} error={state.settingsError} onSave={actions.saveSettings} />
      : <div className="details__sections details__activity">
        {bot ? <>
          <HyperBotActivitySection title="Connections">
            <HyperBotConnections connections={snapshot.connections} connectedOnly />
          </HyperBotActivitySection>
          <HyperBotActivitySection title="Engine">
            <HyperBotEngine bot={bot} settings={snapshot.settings} connection={snapshot.connections.model} models={state.models} saving={state.saving} error={state.settingsError} onSave={actions.saveSettings} />
          </HyperBotActivitySection>
          <HyperBotActivitySection title="Dedicated skills & tools" lazy>
            <HyperBotDedicatedAssets botId={bot.id} />
          </HyperBotActivitySection>
          <HyperBotActivitySection title="Memory & Soul">
            <Button type="button" variant="ghost" className="panel-row panel-row--action" onClick={onPersonalization}>
              Open Memory &amp; Soul<ChevronRight className="ms-auto rtl:rotate-180" aria-hidden="true" />
            </Button>
          </HyperBotActivitySection>
        </> : <HyperBotActivitySection title="Members">
          <HyperBotMembers room={room} settings={snapshot.settings} saving={state.saving} error={state.settingsError} onSave={actions.saveSettings} />
        </HyperBotActivitySection>}
        <HyperBotActivitySection title="Recent decisions">
          <div className="panel-card decisions">
            {decided.length ? <HyperBotsDecided approvals={decided} settings={snapshot.settings} flat /> : <p className="panel-empty">No decisions in this conversation yet.</p>}
          </div>
        </HyperBotActivitySection>
      </div>}
  </div></aside>;
}
