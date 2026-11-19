// Ported from bot-hq (web/src/components/Composer.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { ArrowUp, LoaderCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { HyperComposerDictationControls, HyperComposerDictationPreview, useHyperComposerDictation, type HyperComposerDictation } from '@/features/hyper-voice/chat/HyperComposerDictation';
import { localToolPlugin } from '@/features/tabs/plugin';
import { tabsActions } from '@/features/tabs/tabs-store';
import type { HyperBotsOutbox } from './HyperBotsController';
import { HyperBotMenu } from './HyperBotMenu';
import { HyperBotMiniSelect } from './HyperBotMiniSelect';
export interface HyperBotComposerProps {
  text: string; model: string; models: string[]; sending: boolean; hint: string; name?: string;
  onText: (text: string) => void; onModel: (model: string) => void; onSend: (text: string, model: string | null) => void;
  onGroup?: () => void; onSettings?: () => void; group?: boolean;
  /** Dictation (t3code's voice input) bound to this composer's draft; HyperBotsComposerBox provides it. */
  dictation?: HyperBotsDictation;
}
type HyperBotsDictation = HyperComposerDictation & { textareaRef: RefObject<HTMLTextAreaElement | null>; formRef: RefObject<HTMLFormElement | null> };
function HyperBotComposerActions({ onGroup, onSettings, group }: Pick<HyperBotComposerProps, 'onGroup' | 'onSettings' | 'group'>) {
  const [menu, setMenu] = useState(false);
  return <span className="composer__plus-anchor"><button type="button" className="composer__btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}><Plus size={16} /></button>
    {menu && <HyperBotMenu above onClose={() => setMenu(false)} items={[{ label: 'New group chat', onSelect: () => onGroup?.() }, { label: group ? 'Group settings' : 'Bot settings', onSelect: () => onSettings?.() }]} />}</span>;
}
/** Controlled composer; the outbox owns the draft and the per-message model, including unlisted model IDs. */
export function HyperBotsComposer({ text, model, models, sending, hint, name = 'the bots', onText, onModel, onSend, onGroup, onSettings, group, dictation }: HyperBotComposerProps) {
  // Send while recording finishes dictation, then sends the transcript (t3code's submitAfterDictation).
  const dictating = dictation?.speech.blocksSubmission ?? false;
  const blocked = sending || (dictation?.speech.preparing ?? false) || (!text.trim() && !dictating);
  const submit = () => { if (blocked) return; if (dictation) dictation.submit(text); else onSend(text, model || null); };
  const options = model && !models.includes(model) ? [model, ...models] : models;
  return <form ref={dictation?.formRef} className="composer-area" onSubmit={event => { event.preventDefault(); submit(); }}>
    {dictation && <HyperComposerDictationPreview dictation={dictation} className="mx-auto mb-2 flex max-h-32 max-w-[800px] flex-col-reverse overflow-y-auto rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap" />}
    <div className="composer"><div className="composer__left"><HyperBotComposerActions onGroup={onGroup} onSettings={onSettings} group={group} />
      <Textarea ref={element => { if (dictation) dictation.textareaRef.current = element; if (element) { element.style.height = '0px'; element.style.height = Math.min(element.scrollHeight || 44, 200) + 'px'; element.style.overflowY = element.scrollHeight > 200 ? 'auto' : 'hidden'; } }}
        data-testid="composer-editor" aria-label={'Message ' + name} placeholder={'Message ' + name} value={text} rows={1} className="composer__input [unicode-bidi:plaintext] text-start" maxLength={20000}
        disabled={dictation?.speech.freezesEditor}
        onChange={event => onText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
    </div><div className="composer__right"><HyperBotMiniSelect label="Model for this message" className="composer__model" value={model} onChange={onModel} options={[{ value: '', label: 'Bot default' }, ...options.map(id => ({ value: id, label: id }))]} />
      {dictation && <HyperComposerDictationControls dictation={dictation} />}
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
  const textareaRef = useRef<HTMLTextAreaElement>(null), formRef = useRef<HTMLFormElement>(null);
  // Dictation records into this room's stored draft, so a recording outlives the composer (t3code's persistent draft).
  const dictation = useHyperComposerDictation({
    ownerKey: 'bot:' + roomId, label: props.name ?? 'Hyper-Bot', text, textareaRef, formRef,
    onTextChange: value => outbox.setDraft(roomId, value),
    onSubmit: value => { if (value.trim()) void onSend(value, outbox.getModel() || null); },
    persistentDraft: { readStoredText: draft, commitStoredText: value => outbox.setDraft(roomId, value), open: () => tabsActions.openPlugin(localToolPlugin('bots')) },
  });
  return <HyperBotsComposer {...props} text={text} model={model} models={models} sending={sending} hint={hint} onText={value => outbox.setDraft(roomId, value)} onModel={outbox.setModel} onSend={(sent, selected) => void onSend(sent, selected)}
    dictation={{ ...dictation, textareaRef, formRef }} />;
}
