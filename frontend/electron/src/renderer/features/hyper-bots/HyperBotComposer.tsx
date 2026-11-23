// Ported from bot-hq (web/src/components/Composer.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { ArrowUp, LoaderCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useHyperPeople } from '@/features/hyper-people/useHyperPeople';
import { HyperComposerDictationControls, HyperComposerDictationPreview, useHyperComposerDictation, type HyperComposerDictation } from '@/features/hyper-voice/chat/HyperComposerDictation';
import { localToolPlugin } from '@/features/tabs/plugin';
import { tabsActions } from '@/features/tabs/tabs-store';
import type { HyperBotsOutbox } from './HyperBotsController';
import {
  buildHyperBotMentionOptions,
  hyperBotComposerMentionQuery,
  HyperBotMentionPopover,
  insertHyperBotMention,
  type HyperBotMentionBot,
  type HyperBotMentionOption,
  type HyperBotMentionQueryRange,
} from './HyperBotMentionPopover';
import { HyperBotMenu } from './HyperBotMenu';
import { HyperBotMiniSelect } from './HyperBotMiniSelect';
export interface HyperBotComposerMention {
  readonly listId: string;
  readonly open: boolean;
  readonly query: HyperBotMentionQueryRange | null;
  readonly options: readonly HyperBotMentionOption[];
  readonly peopleLoading: boolean;
  readonly peopleError: string | null;
  readonly activeIndex: number;
  readonly onActiveChange: (index: number) => void;
  readonly onSelect: (option: HyperBotMentionOption) => void;
  readonly onUpdateFromElement: (element: HTMLTextAreaElement, nextValue: string) => void;
  readonly onDismiss: () => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
}
export interface HyperBotComposerProps {
  text: string; model: string; models: string[]; sending: boolean; hint: string; name?: string;
  onText: (text: string) => void; onModel: (model: string) => void; onSend: (text: string, model: string | null) => void;
  onGroup?: () => void; onSettings?: () => void; group?: boolean;
  /** Unified `@` bot + employee autocomplete controller; HyperBotsComposerBox wires it (keeps HyperBotsComposer hook-free). */
  mention?: HyperBotComposerMention;
  /** Dictation (t3code's voice input) bound to this composer's draft; HyperBotsComposerBox provides it. */
  dictation?: HyperBotsDictation;
}
type HyperBotsDictation = HyperComposerDictation & { textareaRef: RefObject<HTMLTextAreaElement | null>; formRef: RefObject<HTMLFormElement | null> };
function HyperBotComposerActions({ onGroup, onSettings, group }: Pick<HyperBotComposerProps, 'onGroup' | 'onSettings' | 'group'>) {
  const [menu, setMenu] = useState(false);
  return <span className="composer__plus-anchor"><button type="button" className="composer__btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}><Plus size={16} /></button>
    {menu && <HyperBotMenu above onClose={() => setMenu(false)} items={[{ label: 'New group chat', onSelect: () => onGroup?.() }, { label: group ? 'Group settings' : 'Bot settings', onSelect: () => onSettings?.() }]} />}</span>;
}
/** Controlled hook-free composer; the outbox owns the draft and the per-message model, including unlisted model IDs. */
export function HyperBotsComposer({ text, model, models, sending, hint, name = 'the bots', onText, onModel, onSend, onGroup, onSettings, group, mention, dictation }: HyperBotComposerProps) {
  // Send while recording finishes dictation, then sends the transcript (t3code's submitAfterDictation).
  const dictating = dictation?.speech.blocksSubmission ?? false;
  const blocked = sending || (dictation?.speech.preparing ?? false) || (!text.trim() && !dictating);
  const submit = () => { if (blocked) return; if (dictation) dictation.submit(text); else onSend(text, model || null); };
  const options = model && !models.includes(model) ? [model, ...models] : models;
  const mentionOpen = Boolean(mention?.open && mention.query && !dictation?.speech.freezesEditor);

  return <form ref={dictation?.formRef} className="composer-area" onSubmit={event => { event.preventDefault(); submit(); }}>
    {dictation && <HyperComposerDictationPreview dictation={dictation} className="mx-auto mb-2 flex max-h-32 max-w-[800px] flex-col-reverse overflow-y-auto rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap" />}
    <div className="composer__shell">
      {mentionOpen && mention?.query && (
        <HyperBotMentionPopover
          id={mention.listId}
          query={mention.query.query}
          options={mention.options}
          peopleLoading={mention.peopleLoading}
          peopleError={mention.peopleError}
          activeIndex={mention.activeIndex}
          onActiveChange={mention.onActiveChange}
          onSelect={mention.onSelect}
        />
      )}
      <div className="composer"><div className="composer__left"><HyperBotComposerActions onGroup={onGroup} onSettings={onSettings} group={group} />
        <Textarea ref={element => { if (dictation) dictation.textareaRef.current = element; if (element) { element.style.height = '0px'; element.style.height = Math.min(element.scrollHeight || 44, 200) + 'px'; element.style.overflowY = element.scrollHeight > 200 ? 'auto' : 'hidden'; } }}
          data-testid="composer-editor" aria-label={'Message ' + name} placeholder={'Message ' + name} value={text} rows={1} className="composer__input [unicode-bidi:plaintext] text-start" maxLength={20000}
          aria-autocomplete={mention ? 'list' : undefined} aria-expanded={mention ? mentionOpen : undefined} aria-controls={mentionOpen && mention ? mention.listId : undefined}
          aria-activedescendant={mentionOpen && mention && mention.options[mention.activeIndex] ? `${mention.listId}-${mention.activeIndex}` : undefined}
          disabled={dictation?.speech.freezesEditor}
          onChange={event => { const next = event.target.value; onText(next); mention?.onUpdateFromElement(event.target, next); }}
          onClick={event => mention?.onUpdateFromElement(event.currentTarget, event.currentTarget.value)}
          onBlur={() => mention?.onDismiss()}
          onKeyUp={event => {
            if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) return;
            mention?.onUpdateFromElement(event.currentTarget, event.currentTarget.value);
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (mentionOpen && mention?.onKeyDown(event)) return;
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
          }} />
      </div><div className="composer__right"><HyperBotMiniSelect label="Model for this message" className="composer__model" value={model} onChange={onModel} options={[{ value: '', label: 'Bot default' }, ...options.map(id => ({ value: id, label: id }))]} />
        {dictation && <HyperComposerDictationControls dictation={dictation} />}
        <Button type="submit" size="icon-sm" className="composer__cta" aria-label="Send" disabled={blocked}>{sending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <ArrowUp />}</Button>
      </div></div>
    </div>{hint && <p className="composer__hint">{hint}</p>}
  </form>;
}
export function HyperBotsComposerBox({ outbox, roomId, models, sending, hint, onSend, bots, ...props }: {
  outbox: HyperBotsOutbox; roomId: string; models: string[]; sending: boolean; hint: string;
  onSend: (text: string, model: string | null) => Promise<boolean>;
  bots?: readonly HyperBotMentionBot[];
} & Pick<HyperBotComposerProps, 'name' | 'onGroup' | 'onSettings' | 'group'>) {
  const draft = () => outbox.draft(roomId);
  const text = useSyncExternalStore(outbox.subscribe, draft, draft), model = useSyncExternalStore(outbox.subscribe, outbox.getModel, outbox.getModel);
  const textareaRef = useRef<HTMLTextAreaElement>(null), formRef = useRef<HTMLFormElement>(null);
  const [loadedBots, setLoadedBots] = useState<HyperBotMentionBot[]>([]);
  const mentionListId = useId();
  const [mentionQuery, setMentionQuery] = useState<HyperBotMentionQueryRange | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  useEffect(() => {
    if (bots || typeof window === 'undefined') return;
    let alive = true;
    const load = () => {
      void window.hypertask?.assistant?.listBots?.().then(list => {
        if (alive && Array.isArray(list)) setLoadedBots(list);
      }).catch(() => undefined);
    };
    load();
    const off = window.hypertask?.hyperBots?.onEvent?.(event => {
      if (event.type === 'settings') load();
    });
    return () => { alive = false; off?.(); };
  }, [bots]);

  const effectiveBots = bots ?? loadedBots;
  const peopleResults = useHyperPeople(mentionQuery?.query ?? '');
  const mentionOptions = useMemo(
    () => (mentionQuery ? buildHyperBotMentionOptions(mentionQuery.query, effectiveBots, peopleResults.people) : []),
    [mentionQuery, effectiveBots, peopleResults.people],
  );

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionQuery?.query, mentionOptions.length]);

  const selectMention = (option: HyperBotMentionOption) => {
    if (!mentionQuery) return;
    const { nextValue, nextCaret } = insertHyperBotMention(text, mentionQuery, option);
    outbox.setDraft(roomId, nextValue);
    setMentionQuery(null);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        el.setSelectionRange(nextCaret, nextCaret);
      });
    }
  };

  const mention: HyperBotComposerMention = {
    listId: mentionListId,
    open: Boolean(mentionQuery),
    query: mentionQuery,
    options: mentionOptions,
    peopleLoading: peopleResults.loading,
    peopleError: peopleResults.error,
    activeIndex: activeMentionIndex,
    onActiveChange: setActiveMentionIndex,
    onSelect: selectMention,
    onUpdateFromElement: (element, nextValue) => {
      const caret = element.selectionStart ?? nextValue.length;
      setMentionQuery(hyperBotComposerMentionQuery(nextValue, caret));
    },
    onDismiss: () => setMentionQuery(null),
    onKeyDown: (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) return false;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMentionQuery(null); return true; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation();
        if (mentionOptions.length > 0) {
          setActiveMentionIndex(idx => (idx + (event.key === 'ArrowDown' ? 1 : -1) + mentionOptions.length) % mentionOptions.length);
        }
        return true;
      }
      const chosen = mentionOptions[activeMentionIndex];
      if (chosen && (event.key === 'Enter' || event.key === 'Tab')) {
        event.preventDefault(); event.stopPropagation();
        selectMention(chosen);
        return true;
      }
      return false;
    },
  };

  // Dictation records into this room's stored draft, so a recording outlives the composer (t3code's persistent draft).
  const dictation = useHyperComposerDictation({
    ownerKey: 'bot:' + roomId, label: props.name ?? 'Hyper-Bot', text, textareaRef, formRef,
    onTextChange: value => outbox.setDraft(roomId, value),
    onSubmit: value => { if (value.trim()) void onSend(value, outbox.getModel() || null); },
    persistentDraft: { readStoredText: draft, commitStoredText: value => outbox.setDraft(roomId, value), open: () => tabsActions.openPlugin(localToolPlugin('bots')) },
  });
  return <HyperBotsComposer {...props} mention={mention} text={text} model={model} models={models} sending={sending} hint={hint} onText={value => outbox.setDraft(roomId, value)} onModel={outbox.setModel} onSend={(sent, selected) => void onSend(sent, selected)}
    dictation={{ ...dictation, textareaRef, formRef }} />;
}
