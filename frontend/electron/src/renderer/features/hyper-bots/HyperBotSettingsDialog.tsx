// Ported from bot-hq (web/src/components/config/BotSettingsModal.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useState } from 'react';
import { hyperBotsPermissions, hyperBotSetPermissionLevel, type HyperBotConfig, type HyperBotsConnections, type HyperBotsRoom, type HyperBotsSettings } from '@shared/HyperBots';
import { ArrowLeft, BookOpen, ChevronRight, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { HyperBotAvatar, hyperBotAvatarOf } from './HyperBotAvatar';
import { HyperBotPickers, HyperBotModePicker } from './HyperBotPickers';
import { HyperBotModal, HyperBotModalHeader } from './HyperBotModal';
import { hyperBotDelete, hyperBotUpdate } from './HyperBotSettings';
import { HyperBotConnectionPicker } from './HyperBotConnectionPicker';
import { HyperBotPermissions } from './HyperBotPermissions';
import { HyperBotSkills } from './HyperBotSkills';
import { HyperBotPersonalization } from './HyperBotPersonalization';
export function HyperBotInstructions({ bot, onChange }: { bot: HyperBotConfig; onChange: (bot: HyperBotConfig) => void }) {
  return <label className="settings-instructions">Instructions<Textarea aria-label={'Instructions of @' + bot.id} value={bot.instructions} rows={4} maxLength={4000} onChange={event => onChange({ ...bot, instructions: event.target.value })} /></label>;
}
type HyperBotSettingsSection = 'settings' | 'skills' | 'personalization';

export function HyperBotSettingsDialog({ settings, bot, room, connections, onSave, onClose, error, initialSection = 'settings' }: {
  settings: HyperBotsSettings; bot?: HyperBotConfig; room: HyperBotsRoom; connections?: HyperBotsConnections;
  onSave: (settings: HyperBotsSettings) => Promise<boolean>; onClose: () => void; error?: string;
  initialSection?: HyperBotSettingsSection;
}) {
  const [draft, setDraft] = useState<HyperBotConfig | undefined>(bot && { ...bot, avatar: hyperBotAvatarOf(bot) }), [name, setName] = useState(bot?.name ?? room.name), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  const [section, setSection] = useState(initialSection);
  const [editedPermissions, setEditedPermissions] = useState(false);
  const [editedConnections, setEditedConnections] = useState(false);
  const label = bot ? 'Bot settings' : 'Group settings';
  const currentDraft = bot && draft ? {
    ...draft,
    tools: editedConnections ? draft.tools : bot.tools,
    permissionLevel: editedPermissions ? draft.permissionLevel : bot.permissionLevel,
    toolPolicies: editedPermissions ? undefined : bot.toolPolicies,
  } : draft;
  const save = async (deleting = false) => {
    if (busy || !deleting && !name.trim()) return;
    setBusy(true);
    const next = deleting ? bot ? hyperBotDelete(settings, bot.id) : { ...settings, rooms: settings.rooms.filter(row => row.id !== room.id) }
      : currentDraft ? hyperBotUpdate(settings, { ...currentDraft, name: name.trim() }) : { ...settings, rooms: settings.rooms.map(row => row.id === room.id ? { ...row, name: name.trim() } : row) };
    try { if (await onSave(next)) onClose(); } finally { setBusy(false); }
  };
  if (section === 'skills' && bot) {
    return <HyperBotModal onClose={onClose} className="create-modal settings-modal" label={`Skills for ${bot.name}`}>
      <HyperBotModalHeader label={`Skills for ${bot.name}`} onClose={onClose} />
      <div className="create-modal__body !items-stretch">
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setSection('settings')} autoFocus>
          <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />Bot settings
        </Button>
        <HyperBotSkills botId={bot.id} />
      </div>
    </HyperBotModal>;
  }
  if (section === 'personalization' && bot) {
    const title = `Memory & Soul for ${bot.name}`;
    return <HyperBotModal onClose={onClose} className="create-modal settings-modal" label={title}>
      <HyperBotModalHeader label={title} onClose={onClose} />
      <div className="create-modal__body !items-stretch">
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setSection('settings')} autoFocus>
          <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />Bot settings
        </Button>
        <HyperBotPersonalization key={bot.id} botId={bot.id} />
      </div>
    </HyperBotModal>;
  }
  return <HyperBotModal onClose={onClose} className="create-modal settings-modal" label={label}><form onSubmit={event => { event.preventDefault(); void save(); }}><HyperBotModalHeader label={label} onClose={onClose} />
    <div className="create-modal__body">{draft && <HyperBotAvatar shape={draft.avatar?.shape} color={draft.avatar?.color} size={64} />}
      <Input aria-label={bot ? 'Bot name' : 'Group name'} className="hb-text-input create-modal__name" value={name} maxLength={40} onChange={event => setName(event.target.value)} />
      {draft && <><HyperBotPickers shape={draft.avatar?.shape ?? 'blob'} color={draft.avatar?.color ?? 'black'} onShape={shape => setDraft({ ...draft, avatar: { shape, color: draft.avatar?.color ?? 'black' } })} onColor={color => setDraft({ ...draft, avatar: { shape: draft.avatar?.shape ?? 'blob', color } })} /><HyperBotModePicker mode={draft.mode ?? 'personal'} onChange={mode => setDraft({ ...draft, mode })} />
      <HyperBotInstructions bot={draft} onChange={setDraft} /></>}
      {currentDraft && <div className="grid w-full gap-3">
        <HyperBotPermissions disabled={busy} selection={{ permissions: hyperBotsPermissions(settings, currentDraft), onChange: level => {
          setEditedPermissions(true);
          setDraft(hyperBotSetPermissionLevel(currentDraft, level));
        } }} />
        <HyperBotConnectionPicker connections={connections} tools={currentDraft.tools} disabled={busy} onChange={tools => {
          setEditedConnections(true);
          setDraft({ ...currentDraft, tools });
        }} />
        <Button type="button" variant="outline" className="justify-start" disabled={busy} onClick={() => setSection('personalization')}>
          <Heart aria-hidden="true" />Memory &amp; Soul<ChevronRight className="ms-auto rtl:rotate-180" aria-hidden="true" />
        </Button>
        <Button type="button" variant="outline" className="justify-start" disabled={busy} onClick={() => setSection('skills')}>
          <BookOpen aria-hidden="true" />Skills<ChevronRight className="ms-auto rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>}
      <div className="delete-bot">{confirm ? <><p>Delete {bot?.name ?? room.name}? {bot ? 'Its direct room is removed and it leaves every group.' : 'This group is removed from the sidebar.'}</p><div><Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Keep {bot ? 'bot' : 'group'}</Button><Button variant="destructive" size="sm" disabled={busy} onClick={() => void save(true)}>Confirm delete</Button></div></>
        : <Button type="button" variant="destructive" size="sm" disabled={!!bot && settings.bots.length <= 1} title={bot && settings.bots.length <= 1 ? 'Keep at least one bot.' : undefined} onClick={() => setConfirm(true)}>Delete {bot ? 'bot' : 'group'}</Button>}{bot && settings.bots.length <= 1 && <p>Keep at least one bot.</p>}</div>
      {error && <p role="alert" className="card__error">{error}</p>}
    </div><div className="modal__footer"><Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" disabled={!name.trim() || busy}>{busy ? 'Saving…' : 'Save'}</Button></div>
  </form></HyperBotModal>;
}
