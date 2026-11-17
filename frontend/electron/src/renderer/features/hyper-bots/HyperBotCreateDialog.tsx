// Ported from bot-hq (web/src/components/modals/CreateBotModal.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useState } from 'react';
import type { HyperBotAvatarShape, HyperBotAvatarColor, HyperBotMode, HyperBotsSettings } from '@shared/HyperBots';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HyperBotAvatar } from './HyperBotAvatar';
import { HyperBotPickers, HyperBotModePicker } from './HyperBotPickers';
import { HyperBotModal, HyperBotModalHeader } from './HyperBotModal';
import { hyperBotCreate } from './HyperBotSettings';
export function HyperBotCreateDialog({ settings, onSave, onSelect, onClose, onGroup, error }: { settings: HyperBotsSettings; onSave: (settings: HyperBotsSettings) => Promise<boolean>; onSelect: (id: string) => void; onClose: () => void; onGroup: () => void; error?: string }) {
  const [name, setName] = useState(''), [shape, setShape] = useState<HyperBotAvatarShape>('heart'), [color, setColor] = useState<HyperBotAvatarColor>('orange');
  const [mode, setMode] = useState<HyperBotMode>('personal'), [busy, setBusy] = useState(false), [localError, setError] = useState('');
  const create = async () => {
    if (!name.trim() || busy || settings.bots.length >= 8) return;
    setBusy(true); setError('');
    try { const next = hyperBotCreate(settings, { name, avatar: { shape, color }, mode });
      if (await onSave(next.settings)) { onSelect(next.settings.rooms.find(room => room.kind === 'direct' && room.botIds[0] === next.bot.id)!.id); onClose(); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <HyperBotModal onClose={onClose} className="create-modal" label="Create New Bot"><form onSubmit={event => { event.preventDefault(); void create(); }}>
    <HyperBotModalHeader label="Create New Bot" onClose={onClose} />
    <div className="create-modal__body"><HyperBotAvatar shape={shape} color={color} size={96} className="create-modal__preview" />
      <Input className="hb-text-input create-modal__name" placeholder="Give your Bot a name" value={name} maxLength={40} onChange={event => setName(event.target.value)} autoFocus aria-label="Bot name" />
      <HyperBotPickers shape={shape} color={color} onShape={setShape} onColor={setColor} /><HyperBotModePicker mode={mode} onChange={setMode} />
      {(localError || error) && <p role="alert" className="card__error">{localError || error}</p>}
    </div><div className="modal__footer"><Button type="button" variant="link" className="link-btn link-btn--small modal__alternative" onClick={onGroup}>New group chat instead</Button><Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" disabled={!name.trim() || busy || settings.bots.length >= 8}>{busy ? 'Creating…' : 'Create'}</Button></div>
  </form></HyperBotModal>;
}
