// Ported from bot-hq (web/src/components/modals/CreateGroupModal.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useState } from 'react';
import { Check } from 'lucide-react';
import type { HyperBotsSettings } from '@shared/HyperBots';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { HyperBotAvatarFor } from './HyperBotAvatar';
import { HyperBotModal, HyperBotModalHeader } from './HyperBotModal';
import { hyperBotCreateGroup } from './HyperBotSettings';
export function HyperBotGroupDialog({ settings, onSave, onSelect, onClose, error }: { settings: HyperBotsSettings; onSave: (settings: HyperBotsSettings) => Promise<boolean>; onSelect: (id: string) => void; onClose: () => void; error?: string }) {
  const [name, setName] = useState(''), [picked, setPicked] = useState<string[]>([]), [busy, setBusy] = useState(false), [localError, setError] = useState('');
  const create = async () => { if (!name.trim() || picked.length < 2 || busy) return; setBusy(true); setError('');
    try { const next = hyperBotCreateGroup(settings, name, picked); if (await onSave(next.settings)) { onSelect(next.room.id); onClose(); } }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <HyperBotModal onClose={onClose} className="create-modal" label="New group chat"><form onSubmit={event => { event.preventDefault(); void create(); }}><HyperBotModalHeader label="New group chat" onClose={onClose} />
    <div className="create-modal__body group-modal__body"><Input className="hb-text-input create-modal__name" placeholder="Name your group" aria-label="Group name" autoFocus maxLength={40} value={name} onChange={event => setName(event.target.value)} />
    <p className="section-label">Choose at least 2 bots</p><div className="group-pick">{settings.bots.map(bot => <button key={bot.id} type="button" role="checkbox" aria-checked={picked.includes(bot.id)} className={cn('group-pick__opt', picked.includes(bot.id) && 'is-active')} onClick={() => setPicked(current => current.includes(bot.id) ? current.filter(id => id !== bot.id) : [...current, bot.id])}><HyperBotAvatarFor bot={bot} size={24} /><span className="group-pick__name">{bot.name}</span>{picked.includes(bot.id) && <Check size={14} />}</button>)}</div>
    {(localError || error) && <p role="alert" className="card__error">{localError || error}</p>}</div>
    <div className="modal__footer"><Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" disabled={!name.trim() || picked.length < 2 || busy}>{busy ? 'Creating…' : 'Create group'}</Button></div>
  </form></HyperBotModal>;
}
