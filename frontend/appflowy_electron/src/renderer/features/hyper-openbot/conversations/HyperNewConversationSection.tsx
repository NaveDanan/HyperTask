// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted from routes/_authed/_app/channel/new.tsx. See REUSE.md.
import { useEffect, useRef, useState } from 'react';
import { HyperComposer, type HyperComposerAttachment, type HyperModelOption, type HyperModelPick } from '../composer';
import { hyperOpenBotRequest } from '../transport';
import { Button } from '@/components/ui/button';
import { HyperListBots, type HyperBotProfile } from '../bots/HyperBotsApi';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { hyperRequestModelPick, type HyperModelCatalogue } from '../HyperModelSelection';
export default function HyperNewConversationSection({ context }: { context: HyperOpenBotSectionContext }) {
  const [commands, setCommands] = useState<{ id: string; label: string }[]>([]);
  const [files, setFiles] = useState<{ file: File; attachment: HyperComposerAttachment }[]>([]);
  const [models, setModels] = useState<HyperModelOption[]>([]);
  const [pick, setPick] = useState<HyperModelPick>({ model: '', effort: null });
  const [bots, setBots] = useState<HyperBotProfile[]>();
  const [selected, setSelected] = useState<string[]>(() => [...(context.initialAgentIds ?? [])]);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const selection = JSON.stringify(selected);
  const pickable = selected.length === 1 && bots?.find(bot => bot.id === selected[0])?.runsOnOpenBotModel === true;
  const key = JSON.stringify([selection, pickable]);
  const current = useRef({ key, active: true, sequence: 0, ready: false, catalogue: undefined as HyperModelCatalogue | undefined, pick: { model: '', effort: null } as HyperModelPick });
  if (current.current.key !== key) current.current = { key, active: true, sequence: 0, ready: false, catalogue: undefined, pick: { model: '', effort: null } };
  const owner = current.current;
  const valid = () => mounted.current && current.current === owner && owner.active && context.isCurrentNavigation?.() !== false;
  useEffect(() => {
    owner.active = true; owner.ready = false; owner.catalogue = undefined;
    const sequence = ++owner.sequence;
    setModels([]); setPick({ model: '', effort: null });
    if (pickable) void hyperOpenBotRequest<HyperModelCatalogue>('/api/models').then(catalogue => {
      if (!valid() || owner.sequence !== sequence || catalogue.choosable !== true) return;
      owner.catalogue = catalogue; owner.ready = true; owner.pick = { model: catalogue.default, effort: null };
      setModels(catalogue.models); setPick(owner.pick);
    }).catch(() => {});
    return () => { owner.active = false; owner.sequence++; };
  }, [key]);
  useEffect(() => { let live = true; setCommands([]); if (selected.length === 1) void hyperOpenBotRequest<{ skills: { slug: string; title: string }[] }>(`/api/plugins/for/${encodeURIComponent(selected[0])}`).then(value => { if (live && valid()) setCommands(value.skills.map(skill => ({ id: skill.slug, label: skill.title || skill.slug }))); }).catch(() => {}); return () => { live = false; }; }, [selection, key]);
  useEffect(() => { let current = true; setError(undefined); void HyperListBots(false).then(value => { if (current) setBots(value); }).catch(error => { if (current) setError(String(error)); }); return () => { current = false; }; }, [revision]);
  return <div className="space-y-4 overflow-y-auto p-6"><h2 className="text-lg font-semibold">New conversation</h2><p className="text-sm text-muted-foreground">Choose Bots in the order they should answer.</p>{error && <div role="alert">{error}<Button onClick={() => setRevision(value => value + 1)}>Retry</Button></div>}{!bots && !error && <p role="status">Loading Bots…</p>}{bots?.length === 0 && <p>No Bots available. Create one in Bots.</p>}
    <div className="space-y-2">{bots?.map(bot => <label key={bot.id} className="flex items-center gap-3 rounded-lg border p-3"><input type="checkbox" disabled={files.length > 0 && selected.length > 0 && !selected.includes(bot.id)} checked={selected.includes(bot.id)} onChange={event => setSelected(value => event.target.checked ? [...value, bot.id] : value.filter(id => id !== bot.id))} /><span>{bot.name} <span className="text-muted-foreground">{bot.title}</span></span>{selected.includes(bot.id) && <span>{selected.indexOf(bot.id) + 1}</span>}</label>)}</div>
    <HyperComposer allowQueue={false} commands={commands} disabled={!selected.length || context.isCurrentNavigation?.() === false} placeholder="Write the first message" attachments={files.map(item => item.attachment)}
      onFiles={selected.length === 1 ? async added => { if (valid()) setFiles(files => [...files, ...added.map(file => ({ file, attachment: { id: crypto.randomUUID(), name: file.name, status: 'ready' as const } }))]); } : undefined}
      onRemoveAttachment={id => { if (valid()) setFiles(files => files.filter(item => item.attachment.id !== id)); }}
      onConsumeAttachments={ids => { if (valid()) setFiles(files => files.filter(item => !ids.includes(item.attachment.id))); }}
      modelPicker={valid() && pickable && owner.ready && models.length ? { models, value: pick, onChange: next => { if (valid() && owner.ready) { owner.pick = next; setPick(next); } } } : undefined}
      onSubmit={async draft => {
        if (!valid()) throw new Error('This conversation setup changed. Choose Bots again.');
        const requested = pickable && owner.ready && owner.catalogue ? hyperRequestModelPick(owner.pick, owner.catalogue) : undefined;
        const modelPick = requested && (requested.model !== null || requested.effort !== null) ? requested : undefined;
        if (selected.length === 1) void hyperOpenBotRequest('/api/route', 'POST', { text: draft.text, agentId: selected[0], skillSlugs: draft.commandIds ?? [] }).catch(() => {});
        await context.startConversation(selected, { text: draft.text, files: files.filter(item => draft.attachments.some(attachment => attachment.id === item.attachment.id)).map(item => item.file), commandIds: draft.commandIds ?? [], submit: true, ...(modelPick ? { modelPick } : {}) });
      }} />
    <Button variant="outline" onClick={() => context.navigate?.('bots')}>Create a Bot</Button></div>;
}
