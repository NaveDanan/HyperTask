// Ported from bot-hq (web/src/components/ChatView.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useState } from 'react';
import { PanelRight, RefreshCw } from 'lucide-react';
import type { HyperBotConfig, HyperBotsSnapshot } from '@shared/HyperBots';
import type { HyperBotsOutbox, HyperBotsViewState } from './HyperBotsController';
import type { HyperBotActions } from './HyperBotScreen';
import { HyperBotAvatarFor, HyperBotMembersAvatar, hyperBotAvatarOf } from './HyperBotAvatar';
import { HyperBotTranscript } from './HyperBotTranscript';
import { HyperBotsComposerBox } from './HyperBotComposer';
import { HyperBotMenu } from './HyperBotMenu';
import { botVars } from './HyperBotColors';
export function hyperBotsMentionHint(snapshot: HyperBotsSnapshot) {
  const room = snapshot.settings.rooms.find(row => row.id === snapshot.roomId);
  const ids = (room?.botIds ?? snapshot.settings.bots.map(bot => bot.id)).map(id => '@' + id);
  if (!ids.length) return '';
  const list = ids.length === 1 ? ids[0] : ids.slice(0, -1).join(', ') + ' or ' + ids[ids.length - 1];
  return 'Mention ' + list + ' to pick a bot; no mention = all bots in the room.';
}
export function HyperBotChat({ state, outbox, actions, bot, name, members, detailsOpen, onDetails, onSettings, onGroup }: { state: HyperBotsViewState & { snapshot: HyperBotsSnapshot }; outbox: HyperBotsOutbox; actions: HyperBotActions; bot?: HyperBotConfig; name: string; members: HyperBotConfig[]; detailsOpen: boolean; onDetails: () => void; onSettings: () => void; onGroup: () => void }) {
  const [menu, setMenu] = useState(false), snapshot = state.snapshot;
  return <main className="chat" style={botVars(bot && hyperBotAvatarOf(bot).color)} aria-busy={state.phase === 'opening'}>
    <HyperBotTranscript snapshot={snapshot} bot={bot} name={name} members={members} deciding={state.deciding} onDecide={actions.decide} />
    <div className="chat__notices">{!snapshot.connections.model.ready && <p className="notice is-warn">Set up the AI endpoint in Settings → AI to chat.</p>}{state.error && <p role="alert" className="notice is-error">{state.error}</p>}{state.syncError && <p role="alert" className="notice is-error">The room could not be reloaded. {state.syncError}</p>}</div>
    <HyperBotsComposerBox key={snapshot.roomId} outbox={outbox} roomId={snapshot.roomId} models={state.models} sending={state.sending || state.phase === 'opening'} name={name} hint={bot ? 'Enter to send · Shift+Enter for a new line' : hyperBotsMentionHint(snapshot)} onSend={actions.send} onGroup={onGroup} onSettings={onSettings} group={!bot} />
    <header className="chat__header"><span className="chat__pill-anchor"><button type="button" className="chat__pill" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}>{bot ? <HyperBotAvatarFor bot={bot} size={24} /> : <HyperBotMembersAvatar bots={members} size={24} />}<span className="chat__pill-name">{name}</span></button>
      {menu && <HyperBotMenu center onClose={() => setMenu(false)} items={[{ label: detailsOpen ? 'Hide details' : 'Show details', onSelect: onDetails }, { label: bot ? 'Bot settings' : 'Group settings', onSelect: onSettings }, { label: 'New group chat', onSelect: onGroup }]} />}
    </span><div className="chat__header-right"><button type="button" className="icon-btn icon-btn--bordered" aria-label="Refresh" title="Refresh room" disabled={state.phase === 'opening'} onClick={actions.reload}><RefreshCw size={15} /></button><button type="button" className="icon-btn icon-btn--bordered" aria-label={detailsOpen ? 'Hide details' : 'Show details'} aria-expanded={detailsOpen} onClick={onDetails}><PanelRight size={16} /></button></div></header>
  </main>;
}
