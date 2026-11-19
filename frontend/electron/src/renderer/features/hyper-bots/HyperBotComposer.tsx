// Ported from bot-hq (web/src/components/Composer.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useState, useSyncExternalStore, type ClipboardEventHandler, type ReactNode } from 'react';
import { ArrowUp, LoaderCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { HyperBotsOutbox } from './HyperBotsController';
import { HyperBotDictation } from './HyperBotDictation';
import { useHyperBotAttachments } from './HyperBotAttachments';
import { HyperBotMenu } from './HyperBotMenu';
import { HyperBotMiniSelect } from './HyperBotMiniSelect';
export interface HyperBotComposerProps {
  text: string; model: string; models: string[]; sending: boolean; hint: string; name?: string;
  onText: (text: string) => void; onModel: (model: string) => void; onSend: (text: string, model: string | null) => void;
  hasFiles?: boolean; filePicker?: ReactNode; fileList?: ReactNode; onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  onGroup?: () => void; onSettings?: () => void; group?: boolean;
}
function HyperBotComposerActions({ onGroup, onSettings, group }: Pick<HyperBotComposerProps, 'onGroup' | 'onSettings' | 'group'>) {
  const [menu, setMenu] = useState(false);
  return <span className="composer__plus-anchor"><button type="button" className="composer__btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}><Plus size={16} /></button>
    {menu && <HyperBotMenu above onClose={() => setMenu(false)} items={[{ label: 'New group chat', onSelect: () => onGroup?.() }, { label: group ? 'Group settings' : 'Bot settings', onSelect: () => onSettings?.() }]} />}</span>;
}
/** Controlled composer; the outbox owns the draft and the per-message model, including unlisted model IDs. */
export function HyperBotsComposer({ text, model, models, sending, hint, name = 'the bots', onText, onModel, onSend, onGroup, onSettings, group, hasFiles, filePicker, fileList, onPaste }: HyperBotComposerProps) {
  const blocked = sending || (!text.trim() && !hasFiles);
  const submit = () => { if (!blocked) onSend(text, model || null); };
  const options = model && !models.includes(model) ? [model, ...models] : models;
  return <form className="composer-area" onSubmit={event => { event.preventDefault(); submit(); }}>
    {fileList}<div className="composer"><div className="composer__left"><HyperBotComposerActions onGroup={onGroup} onSettings={onSettings} group={group} />{filePicker}
      <Textarea aria-label={'Message ' + name} placeholder={'Message ' + name} value={text} rows={1} className="composer__input [unicode-bidi:plaintext] text-start" maxLength={20000}
        ref={element => { if (element) { element.style.height = '0px'; element.style.height = Math.min(element.scrollHeight || 44, 200) + 'px'; element.style.overflowY = element.scrollHeight > 200 ? 'auto' : 'hidden'; } }}
        onPaste={onPaste} onChange={event => onText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
    </div><div className="composer__right"><HyperBotMiniSelect label="Model for this message" className="composer__model" value={model} onChange={onModel} options={[{ value: '', label: 'Bot default' }, ...options.map(id => ({ value: id, label: id }))]} />
      <Button type="submit" size="icon-sm" className="composer__cta" aria-label="Send" disabled={blocked}>{sending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <ArrowUp />}</Button>
    </div></div>{hint && <p className="composer__hint">{hint}</p>}
  </form>;
}
export function HyperBotsComposerBox({ outbox, roomId, models, sending, hint, onSend, ...props }: {
  outbox: HyperBotsOutbox; roomId: string; models: string[]; sending: boolean; hint: string;
  onSend: (text: string, model: string | null) => Promise<boolean>;
} & Pick<HyperBotComposerProps, 'name' | 'onGroup' | 'onSettings' | 'group'>) {
  const draft = () => outbox.draft(roomId);
  const text = useSyncExternalStore(outbox.subscribe, draft, draft), model = useSyncExternalStore(outbox.subscribe, outbox.getModel, outbox.getModel);
  const [dictating, setDictating] = useState(false);
  const files = useHyperBotAttachments(outbox, roomId, sending);
  return <HyperBotsComposer {...props} hasFiles={files.hasFiles} filePicker={<>{files.picker}<HyperBotDictation outbox={outbox} roomId={roomId} disabled={sending} onBusy={setDictating} /></>} fileList={files.list} onPaste={files.paste} text={text} model={model} models={models} sending={sending || files.busy || dictating} hint={hint} onText={value => outbox.setDraft(roomId, value)} onModel={outbox.setModel} onSend={(sent, selected) => void onSend(sent, selected)} />;
}
