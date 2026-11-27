// Ported from bot-hq (web/src/components/Composer.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type RefObject } from 'react';
import { ArrowUp, Bot, Cpu, LoaderCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HYPER_BOT_PROMPT_LIMIT, hyperBotSkillInvocation } from '@shared/HyperBotPromptContext';
import { hyperBotUsesAsset, type HyperBotAsset } from '@shared/HyperBotSkills';
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
  type HyperBotPromptOption,
  type HyperBotMentionQueryRange,
} from './HyperBotMentionPopover';
import { HyperBotMenu } from './HyperBotMenu';
import { HyperBotPermissions } from './HyperBotPermissions';
import { HyperPromptEditor, type HyperPromptEditorHandle, type HyperPromptSelection } from './prompt/HyperPromptEditor';
import { detectComposerTrigger, replaceTextRange, type ComposerTriggerKind } from './prompt/HyperPromptTrigger';
import { HYPER_PROMPT_COMMANDS } from './prompt/HyperPromptTokens';
import { hyperPromptFileSource, readHyperPromptFile } from './prompt/HyperPromptFiles';

type PromptKey = Parameters<NonNullable<ComponentProps<typeof HyperPromptEditor>['onKeyDown']>>[0];
type PromptQuery = HyperBotMentionQueryRange & { kind: ComposerTriggerKind };
export interface HyperBotComposerMention {
  readonly listId: string;
  readonly open: boolean;
  readonly query: PromptQuery | null;
  readonly options: readonly HyperBotPromptOption[];
  readonly peopleLoading: boolean;
  readonly peopleError: string | null;
  readonly activeIndex: number;
  readonly onActiveChange: (index: number) => void;
  readonly onSelect: (option: HyperBotPromptOption) => void;
  readonly onUpdate: (nextValue: string, selection: HyperPromptSelection) => void;
  readonly onDismiss: () => void;
  readonly onKeyDown: (event: PromptKey) => boolean;
}
export interface HyperBotComposerProps {
  text: string; model: string; models: string[]; sending: boolean; hint: string; name?: string;
  onText: (text: string) => void; onModel: (model: string) => void; onSend: (text: string, model: string | null) => void;
  onGroup?: () => void; onSettings?: () => void; group?: boolean; permissionsDisabled?: boolean; permissionBotId?: string;
  /** HyperBotsComposerBox supplies the room's prompt completions. */
  mention?: HyperBotComposerMention;
  /** Dictation (t3code's voice input) bound to this composer's draft; HyperBotsComposerBox provides it. */
  dictation?: HyperBotsDictation;
  editorRef?: RefObject<HyperPromptEditorHandle | null>;
  pickerRef?: RefObject<HTMLInputElement | null>;
  modelRef?: RefObject<HTMLButtonElement | null>;
  skills?: ComponentProps<typeof HyperPromptEditor>['skills'];
  onFiles?: (files: File[]) => void;
  fileNotice?: string;
}
type HyperBotsDictation = HyperComposerDictation & { formRef: RefObject<HTMLFormElement | null> };
function HyperBotComposerActions({ onGroup, onSettings, group, pickerRef }: Pick<HyperBotComposerProps, 'onGroup' | 'onSettings' | 'group' | 'pickerRef'>) {
  const [menu, setMenu] = useState(false);
  const items = [
    ...(pickerRef ? [{ label: 'Add files…', onSelect: () => pickerRef.current?.click() }] : []),
    ...(onGroup ? [{ label: 'New group chat', onSelect: onGroup }] : []),
    ...(onSettings ? [{ label: group ? 'Group settings' : 'Bot settings', onSelect: onSettings }] : []),
  ];
  return <span className="composer__plus-anchor"><button type="button" className="composer__btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}><Plus size={16} /></button>
    {menu && <HyperBotMenu above onClose={() => setMenu(false)} items={items} />}</span>;
}

function HyperBotComposerModelSelect({ model, models, onModel, modelRef }: Pick<HyperBotComposerProps, 'model' | 'models' | 'onModel' | 'modelRef'>) {
  const defaultLabel = 'Bot default';
  const options = model && !models.includes(model) ? [model, ...models] : models;
  const items = [{ value: '', label: defaultLabel }, ...options.map(id => ({ value: id, label: id }))];

  return (
    <Select value={model} items={items} onValueChange={value => onModel(value ?? '')} modal={false}>
      <SelectTrigger ref={modelRef} type="button" size="sm" className="composer__model" aria-label="Model for this message" title={model || defaultLabel}>
        <Cpu aria-hidden="true" className="composer__model-icon size-3.5" />
        <SelectValue dir="auto" />
      </SelectTrigger>
      <SelectContent side="top" align="end" sideOffset={14} alignItemWithTrigger={false} className="hyper-bot-model-options motion-reduce:transition-none">
        <SelectGroup>
          <SelectItem value="" label={defaultLabel}>
            <Bot aria-hidden="true" className="size-3.5" />
            <span>{defaultLabel}</span>
          </SelectItem>
          {options.length > 0 && <SelectSeparator className="mx-1" />}
          {options.map(id => (
            <SelectItem key={id} value={id} label={id}>
              <Cpu aria-hidden="true" className="size-3.5" />
              <span dir="auto" className="font-mono">{id}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** Controlled hook-free composer; the outbox owns the draft and the per-message model, including unlisted model IDs. */
export function HyperBotsComposer({ text, model, models, sending, hint, name = 'the bots', onText, onModel, onSend, onGroup, onSettings, group, mention, dictation, permissionsDisabled, permissionBotId, editorRef, pickerRef, modelRef, skills, onFiles, fileNotice }: HyperBotComposerProps) {
  // Send while recording finishes dictation, then sends the transcript (t3code's submitAfterDictation).
  const dictating = dictation?.speech.blocksSubmission ?? false;
  const blocked = sending || (dictation?.speech.preparing ?? false) || (!text.trim() && !dictating);
  const submit = () => { if (blocked) return; if (dictation) dictation.submit(text); else onSend(text, model || null); };
  const mentionOpen = Boolean(mention?.open && mention.query && !dictation?.speech.freezesEditor);

  return <form ref={dictation?.formRef} className="composer-area" onSubmit={event => { event.preventDefault(); submit(); }}>
    {pickerRef && <input ref={pickerRef} type="file" multiple hidden onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = '';
      if (files.length) onFiles?.(files);
    }} />}
    {fileNotice && <p className="notice is-warn composer__error" role="status">{fileNotice}</p>}
    {dictation && <HyperComposerDictationPreview dictation={dictation} className="mx-auto mb-2 flex max-h-32 max-w-[800px] flex-col-reverse overflow-y-auto rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap" />}
    <div className="composer__shell">
      {mentionOpen && mention?.query && (
        <HyperBotMentionPopover
          id={mention.listId}
          kind={mention.query.kind}
          query={mention.query.query}
          options={mention.options}
          peopleLoading={mention.peopleLoading}
          peopleError={mention.peopleError}
          activeIndex={mention.activeIndex}
          onActiveChange={mention.onActiveChange}
          onSelect={mention.onSelect}
        />
      )}
      <div className="composer"><div className="composer__left"><HyperBotComposerActions onGroup={onGroup} onSettings={onSettings} group={group} pickerRef={pickerRef} />
        <HyperPromptEditor editorRef={editorRef} skills={skills}
          aria-label={'Message ' + name} placeholder={'Message ' + name} value={text} className="composer__prompt" maxLength={HYPER_BOT_PROMPT_LIMIT}
          suggestionId={mentionOpen ? mention?.listId : undefined}
          activeSuggestionId={mentionOpen && mention?.options[mention.activeIndex] ? mention.listId + '-' + mention.activeIndex : undefined}
          disabled={dictation?.speech.freezesEditor}
          onChange={(next, selection) => { if (next !== text) onText(next); mention?.onUpdate(next, selection); }}
          onBlur={() => mention?.onDismiss()}
          onFiles={onFiles}
          onKeyDown={(event, inList) => {
            if (event.nativeEvent.isComposing) return;
            if (mentionOpen && mention?.onKeyDown(event)) return;
            if (event.key === 'Enter' && !event.shiftKey && !inList) { event.preventDefault(); submit(); }
          }} />
      </div><div className="composer__right"><HyperBotComposerModelSelect model={model} models={models} onModel={onModel} modelRef={modelRef} />
        {dictation && <HyperComposerDictationControls dictation={dictation} />}
        <Button type="submit" size="icon-sm" className="composer__cta" aria-label="Send" disabled={blocked}>{sending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <ArrowUp />}</Button>
      </div></div>
    </div>
    <div className="composer__footer">
      {hint && <p className="composer__hint">{hint}</p>}
      <HyperBotPermissions compact disabled={permissionsDisabled} botId={permissionBotId} />
    </div>
  </form>;
}
export function HyperBotsComposerBox({ outbox, roomId, models, sending, hint, onSend, bots, ...props }: {
  outbox: HyperBotsOutbox; roomId: string; models: string[]; sending: boolean; hint: string;
  onSend: (text: string, model: string | null) => Promise<boolean>;
  bots?: readonly HyperBotMentionBot[];
} & Pick<HyperBotComposerProps, 'name' | 'onGroup' | 'onSettings' | 'group' | 'permissionsDisabled' | 'permissionBotId'>) {
  const draft = () => outbox.draft(roomId);
  const text = useSyncExternalStore(outbox.subscribe, draft, draft);
  const model = useSyncExternalStore(outbox.subscribe, outbox.getModel, outbox.getModel);
  const editorRef = useRef<HyperPromptEditorHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLButtonElement>(null);
  const [loadedBots, setLoadedBots] = useState<HyperBotMentionBot[]>([]);
  const [assets, setAssets] = useState<HyperBotAsset[]>([]);
  const [fileNotice, setFileNotice] = useState('');
  const mentionListId = useId();
  const [mentionQuery, setMentionQuery] = useState<PromptQuery | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let alive = true;
    const loadBots = () => {
      if (bots) return;
      void window.hypertask?.assistant?.listBots?.().then(list => {
        if (alive && Array.isArray(list)) setLoadedBots(list);
      }).catch(() => undefined);
    };
    const loadSkills = () => {
      void window.hypertask?.hyperBots?.skills?.().then(result => {
        if (alive && result.ok) setAssets(result.value.assets);
      }).catch(() => undefined);
    };
    loadBots();
    loadSkills();
    const off = window.hypertask?.hyperBots?.onEvent?.(event => {
      if (event.type === 'settings') loadBots();
      if (event.type === 'skills' || event.type === 'settings') loadSkills();
    });
    return () => { alive = false; off?.(); };
  }, [bots]);

  const effectiveBots = bots ?? loadedBots;
  const skills = useMemo(() => new Map(assets
    .filter(asset => asset.kind === 'skill' && (asset.scope.kind === 'global' || effectiveBots.some(bot => hyperBotUsesAsset(asset, bot.id))))
    .map(asset => [hyperBotSkillInvocation(asset), { label: asset.name, description: asset.description }])),
  [assets, effectiveBots]);
  const peopleResults = useHyperPeople(mentionQuery?.kind === 'path' ? mentionQuery.query : '');
  const mentionOptions = useMemo<HyperBotPromptOption[]>(() => {
    if (!mentionQuery) return [];
    const query = mentionQuery.query.toLowerCase();
    if (mentionQuery.kind === 'path') return buildHyperBotMentionOptions(mentionQuery.query, effectiveBots, peopleResults.people);
    if (mentionQuery.kind === 'skill') {
      return Array.from(skills).filter(([name, skill]) =>
        [name, skill.label, skill.description].some(value => value.toLowerCase().includes(query)),
      ).map(([name, skill]) => ({ kind: 'skill', token: '$' + name, ...skill }));
    }
    return HYPER_PROMPT_COMMANDS.filter(command => command.name.includes(query)).map(command => ({
      kind: 'command', token: '/' + command.name, label: '/' + command.name, description: command.description,
    }));
  }, [mentionQuery, effectiveBots, peopleResults.people, skills]);

  const activeIndex = Math.min(activeMentionIndex, mentionOptions.length - 1);
  const applyDraft = (text: string, caret: number) => {
    if (text.length > HYPER_BOT_PROMPT_LIMIT) {
      setFileNotice('This message exceeds the 20,000-character limit.');
      return;
    }
    if (editorRef.current) editorRef.current.replaceDraft(text, caret);
    else outbox.setDraft(roomId, text);
    setMentionQuery(null);
  };
  const selectMention = (option: HyperBotPromptOption) => {
    if (!mentionQuery) return;
    if (option.kind === 'bot' || option.kind === 'person') {
      const { nextValue, nextCaret } = insertHyperBotMention(draft(), mentionQuery, option);
      applyDraft(nextValue, nextCaret);
      return;
    }
    const switchModel = option.token === '/model';
    const next = replaceTextRange(draft(), mentionQuery.start, mentionQuery.end, switchModel ? '' : option.token + ' ');
    applyDraft(next.text, next.cursor);
    if (switchModel) modelRef.current?.click();
  };

  const mention: HyperBotComposerMention = {
    listId: mentionListId,
    open: Boolean(mentionQuery),
    query: mentionQuery,
    options: mentionOptions,
    peopleLoading: peopleResults.loading,
    peopleError: peopleResults.error,
    activeIndex,
    onActiveChange: setActiveMentionIndex,
    onSelect: selectMention,
    onUpdate: (value, selection) => {
      const { start, end, inCode } = selection;
      let next: PromptQuery | null = null;
      if (!inCode && start === end) {
        const token = detectComposerTrigger(value, start);
        if (token && token.kind !== 'path') {
          const before = value.slice(0, token.rangeStart);
          const allowed = token.kind === 'skill' || !before.trim() || /^@[\p{L}\p{N}_-]+\s+$/u.test(before);
          if (allowed) next = { kind: token.kind, query: token.query, start: token.rangeStart, end: token.rangeEnd };
        } else {
          const botMention = hyperBotComposerMentionQuery(value, start);
          if (botMention) next = { ...botMention, kind: 'path' };
        }
      }
      if (next?.kind === mentionQuery?.kind && next?.query === mentionQuery?.query &&
          next?.start === mentionQuery?.start && next?.end === mentionQuery?.end) return;
      setActiveMentionIndex(0);
      setMentionQuery(next);
    },
    onDismiss: () => setMentionQuery(null),
    onKeyDown: event => {
      if (event.shiftKey && event.key === 'Enter') return false;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMentionQuery(null);
        return true;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!mentionOptions.length) return false;
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActiveMentionIndex((activeIndex + step + mentionOptions.length) % mentionOptions.length);
        return true;
      }
      const chosen = mentionOptions[activeIndex];
      if (chosen && (event.key === 'Enter' || event.key === 'Tab')) {
        event.preventDefault();
        event.stopPropagation();
        selectMention(chosen);
        return true;
      }
      return false;
    },
  };

  const addFiles = async (files: File[]) => {
    const owner = formRef.current;
    const results = await Promise.allSettled(files.slice(0, 20).map(readHyperPromptFile));
    if (owner !== formRef.current || !owner?.isConnected) return;
    const original = draft();
    let next = original;
    let skipped = files.length - results.length;
    for (const result of results) {
      if (result.status === 'rejected') { skipped += 1; continue; }
      const source = hyperPromptFileSource(result.value);
      if (next.includes(source)) continue;
      const withFile = (next.trim() ? next + '\n\n' : '') + source;
      if (withFile.length <= HYPER_BOT_PROMPT_LIMIT) next = withFile;
      else skipped += 1;
    }
    if (next !== original) {
      // Leave a paragraph after the last fence so further typing stays in the prompt.
      applyDraft(next + (next.length < HYPER_BOT_PROMPT_LIMIT ? '\n' : ''), next.length + 1);
    }
    setFileNotice(skipped ? 'Some files could not be added. Choose UTF-8 text files that fit within the 20,000-character message limit.' : '');
  };

  const dictation = useHyperComposerDictation({
    ownerKey: 'bot:' + roomId, label: props.name ?? 'Hyper-Bot', text, editorRef, formRef,
    onTextChange: value => outbox.setDraft(roomId, value),
    onSubmit: value => { if (value.trim()) void onSend(value, outbox.getModel() || null); },
    persistentDraft: { readStoredText: draft, commitStoredText: value => outbox.setDraft(roomId, value), open: () => tabsActions.openPlugin(localToolPlugin('bots')) },
  });
  return <HyperBotsComposer {...props} mention={mention} text={text} model={model} models={models} sending={sending} hint={hint}
    onText={value => outbox.setDraft(roomId, value)} onModel={outbox.setModel} onSend={(sent, selected) => void onSend(sent, selected)}
    dictation={{ ...dictation, formRef }} editorRef={editorRef} pickerRef={pickerRef} modelRef={modelRef}
    skills={skills} onFiles={files => void addFiles(files)} fileNotice={fileNotice} />;
}
