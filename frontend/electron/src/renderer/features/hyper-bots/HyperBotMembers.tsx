// Ported from bot-hq (web/src/components/MembersCard.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { HyperBotsRoom, HyperBotsSettings } from '@shared/HyperBots';
import { HyperBotAvatarFor } from './HyperBotAvatar';
export function HyperBotMembers({ room, settings, saving, error, onSave }: { room: HyperBotsRoom; settings: HyperBotsSettings; saving: boolean; error?: string; onSave: (settings: HyperBotsSettings) => Promise<boolean> }) {
  const [adding, setAdding] = useState(false);
  const save = (botIds: string[]) => { if (!saving && botIds.length) void onSave({ ...settings, rooms: settings.rooms.map(row => row.id === room.id ? { ...row, botIds } : row) }); };
  const candidates = settings.bots.filter(bot => !room.botIds.includes(bot.id));
  return <div className="panel-card members">{room.botIds.map(id => { const bot = settings.bots.find(row => row.id === id); if (!bot) return null;
    return <div key={id} className="panel-row members__row"><HyperBotAvatarFor bot={bot} size={24} /><span className="members__text"><span className="members__name">{bot.name}</span></span><button type="button" className="icon-btn members__remove" aria-label={'Remove ' + bot.name} title={room.botIds.length <= 1 ? 'Keep at least one member.' : 'Remove ' + bot.name} disabled={saving || room.botIds.length <= 1} onClick={() => save(room.botIds.filter(value => value !== id))}><X size={12} /></button></div>;
  })}{adding ? <div className="members__add">{candidates.length ? candidates.map(bot => <button key={bot.id} type="button" className="panel-row panel-row--link" disabled={saving} onClick={() => { setAdding(false); save([...room.botIds, bot.id]); }}><HyperBotAvatarFor bot={bot} size={20} /><span className="panel-row__title">{bot.name}</span></button>) : <div className="panel-empty">Every Bot is already here.</div>}<button type="button" className="panel-row panel-row--action" onClick={() => setAdding(false)}>Done</button></div> : <button type="button" className="panel-row panel-row--action" disabled={saving} onClick={() => setAdding(true)}><Plus size={12} />Add a Bot</button>}
  {error && <p role="alert" className="card__error">{error}</p>}<p className="members__hint">@mention a Bot to ask just them; otherwise the group answers.</p></div>;
}
