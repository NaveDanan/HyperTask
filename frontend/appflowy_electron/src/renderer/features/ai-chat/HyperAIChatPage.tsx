import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Copy, FileText, MessageSquareText, Send, Square, X } from 'lucide-react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useTr } from '@/i18n';
import { isEditable, viewIsLocked } from '../view-header/page-access-level-store';
import { usePageAccessLevel, useViewPluginNotifier } from '../view-header/view-scope';
import type { PluginContext } from '../plugins/registry';
import { createHyperChatStore, hyperChatModelKey, type HyperChatStore } from './HyperChatStore';
import { HyperChatMessageContent } from './HyperChatMessageContent';
import { hyperChatStrings } from './HyperChatStrings';
import { hyperDocumentOwnerKey, useHyperDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { createHyperScopedChatBackend } from './HyperChatScopedBackend';

function useHyperChatText() {
  const { tr } = useTr();
  return (name: keyof typeof hyperChatStrings) => {
    const key = `hyperAIChat.${name}`, translated = tr(key);
    return translated === key ? hyperChatStrings[name] : translated;
  };
}

export function HyperAIChatPage({ view, context }: { view: ViewPB; context: PluginContext }) {
  const owner = useHyperDocumentOwner();
  if (!context.userProfile || !owner || String(context.userProfile.id) !== owner.actorId) return null;
  return <HyperAIChatConnected key={`${hyperDocumentOwnerKey(owner)}:${view.id}`} view={view} context={context} owner={owner} />;
}

function HyperAIChatConnected({ view, context, owner }: { view: ViewPB; context: PluginContext; owner: HyperDocumentOwner }) {
  const [store] = useState(() => createHyperChatStore(view.id, createHyperScopedChatBackend(owner)));
  const notifier = useViewPluginNotifier(), access = usePageAccessLevel();
  useEffect(() => store.start(), [store]);
  useEffect(() => {
    const deleted = notifier?.isDeleted;
    if (deleted?.oneOfIndex.case === 'index') context.onDeleted?.(notifier?.view ?? view, deleted.oneOfIndex.value);
  }, [notifier?.isDeleted]);
  const editable = !notifier?.isDeleted && (access ? !access.isLoadingLockStatus && isEditable(access) : !viewIsLocked(view));
  return <HyperAIChatContent store={store} editable={editable} />;
}

export function HyperAIChatContent({ store, editable }: { store: HyperChatStore; editable: boolean }) {
  const t = useHyperChatText(), state = useStore(store);
  const owner = useHyperDocumentOwner();
  const bottom = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const canSend = editable && !state.loading && !state.sending && !state.changingModel && !state.savingSources;
  useEffect(() => {
    if (stickToBottom.current && !state.loadingMore) bottom.current?.scrollIntoView({ block: 'end' });
  }, [state.messages, state.answer, state.question]);
  const submit = () => { if (canSend && state.draft.trim()) { stickToBottom.current = true; void store.send().then(() => input.current?.focus()); } };
  return <div className="mx-auto flex h-full w-full max-w-5xl flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b px-8 py-3">
      <MessageSquareText className="size-4 text-muted-foreground" /><span className="text-sm font-medium">{t('title')}</span>
      <div className="ml-auto flex items-center gap-2">
        {state.models.length > 0 ? <Select value={state.selectedModel ? hyperChatModelKey(state.selectedModel) : null} disabled={!editable || state.sending || state.changingModel} onValueChange={name => { if (name) void store.selectModel(name); }} items={state.models.map(model => ({ value: hyperChatModelKey(model), label: model.name }))}>
          <SelectTrigger size="sm" aria-label={t('model')} className="max-w-64"><SelectValue placeholder={t('defaultModel')} /></SelectTrigger>
          <SelectContent>{state.models.map(model => <SelectItem key={hyperChatModelKey(model)} value={hyperChatModelKey(model)}>{model.name}</SelectItem>)}</SelectContent>
        </Select> : <Badge variant="secondary" size="sm">{state.selectedModel?.name || t('defaultModel')}</Badge>}
        <HyperChatSourcePicker store={store} disabled={!editable || state.sending} />
      </div>
    </div>
    {(state.error || state.modelError || state.sourceError) && <div className="px-8 pt-4"><Alert variant="destructive"><AlertTitle>{t('error')}</AlertTitle><AlertDescription>{state.error || state.modelError || state.sourceError}</AlertDescription>{state.error && !state.sending && <Button variant="outline" size="sm" onClick={() => void store.reload()}>{t('retry')}</Button>}</Alert></div>}
    <div role="log" aria-label={t('title')} aria-live="polite" aria-relevant="additions" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-8 py-6" onScroll={event => {
      const element = event.currentTarget;
      stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
    }}>
      {state.loading && <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />{t('loading')}</div>}
      {state.hasMore && <Button variant="outline" size="sm" disabled={state.loadingMore} onClick={() => { stickToBottom.current = false; void store.loadMore(); }}>{state.loadingMore && <Spinner />}{t('loadOlder')}</Button>}
      {!state.loading && !state.messages.length && !state.question && <Empty><EmptyHeader><EmptyMedia variant="icon"><MessageSquareText /></EmptyMedia><EmptyTitle>{t('empty')}</EmptyTitle><EmptyDescription>{t('emptyHint')}</EmptyDescription></EmptyHeader></Empty>}
      {state.messages.map(message => <article key={message.messageId.toString()} className={message.authorType === 1n ? 'ml-auto max-w-3xl rounded-lg border bg-muted/40 p-4' : 'max-w-3xl space-y-2'}>
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span className="font-medium">{t(message.authorType === 1n ? 'user' : message.authorType === 3n ? 'assistant' : 'system')}</span>
          <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={t('copy')} onClick={() => window.appflowy.clipboard.writeText(message.content)}><Copy /></Button>
        </div><HyperChatMessageContent text={message.content} generatedImages={message.authorType === 3n} owner={owner} />
      </article>)}
      {state.question && <article className="ml-auto max-w-3xl rounded-lg border bg-muted/40 p-4"><div className="mb-2 text-xs font-medium text-muted-foreground">{t('user')}</div><HyperChatMessageContent text={state.question} /></article>}
      {(state.answer || state.sending) && <article className="max-w-3xl space-y-2"><div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">{t('assistant')}{state.sending && <Spinner className="size-3" />}</div>{state.answer ? <HyperChatMessageContent text={state.answer} generatedImages owner={owner} /> : <span className="text-sm text-muted-foreground">{state.progress || t('generating')}</span>}</article>}
      <div ref={bottom} />
    </div>
    <div className="shrink-0 space-y-2 border-t px-8 py-4">
      {!editable && <p className="text-xs text-muted-foreground">{t('readOnly')}</p>}
      <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); submit(); }}>
        <Textarea ref={input} aria-label={t('input')} placeholder={t('placeholder')} rows={2} className="max-h-48 flex-1 resize-none" disabled={!editable || state.loading} value={state.draft} onChange={event => store.setState({ draft: event.target.value })} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
        }} />
        {state.sending ? <Button type="button" variant="outline" disabled={state.stopping} aria-label={t('stop')} onClick={() => void store.stop()}><Square />{state.stopping ? t('stopping') : t('stop')}</Button> : <Button type="submit" size="icon" disabled={!canSend || !state.draft.trim()} aria-label={t('send')}><Send /></Button>}
      </form>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
    </div>
  </div>;
}

function HyperChatSourcePicker({ store, disabled }: { store: HyperChatStore; disabled: boolean }) {
  const t = useHyperChatText(), state = useStore(store), [search, setSearch] = useState('');
  const visible = state.sources.filter(source => source.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).slice(0, 100);
  const unknownIds = state.ragIds.filter(id => !state.sources.some(source => source.id === id));
  return <Popover onOpenChange={open => { if (open) void store.loadSources(); }}>
    <PopoverTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}><FileText />{t('sources')}{state.ragIds.length > 0 && <Badge variant="secondary" size="sm">{state.ragIds.length}</Badge>}</PopoverTrigger>
    <PopoverContent align="end" className="w-80 p-3"><PopoverTitle>{t('sourcePicker')}</PopoverTitle><p className="text-xs text-muted-foreground">{t('selectedSources')}</p>
      <Input aria-label={t('sourceSearch')} placeholder={t('sourceSearch')} value={search} onChange={event => setSearch(event.target.value)} />
      {state.loadingSources ? <Spinner /> : <div className="max-h-64 space-y-1 overflow-y-auto">
        {visible.map(source => <label key={source.id} className="flex min-h-8 items-center gap-2 rounded-md px-1.5 text-sm hover:bg-accent"><Checkbox checked={state.ragIds.includes(source.id)} disabled={disabled || !state.settingsLoaded || state.savingSources} onCheckedChange={checked => void store.setSources(checked ? [...state.ragIds, source.id] : state.ragIds.filter(id => id !== source.id))} /><span className="truncate">{source.name || source.id}</span></label>)}
        {unknownIds.map(id => <div key={id} className="flex items-center gap-2 px-1.5 text-xs text-muted-foreground"><span className="flex-1">{t('unknownSource')}</span><Button variant="ghost" size="icon-xs" disabled={disabled || state.savingSources} aria-label={t('clearSources')} onClick={() => void store.setSources(state.ragIds.filter(value => value !== id))}><X /></Button></div>)}
        {!visible.length && !unknownIds.length && <p className="p-2 text-sm text-muted-foreground">{t('noSources')}</p>}
      </div>}
      {state.sourceError && <p role="alert" className="text-xs text-destructive">{state.sourceError}</p>}
      {state.ragIds.length > 0 && <Button variant="ghost" size="sm" disabled={disabled || state.savingSources} onClick={() => void store.setSources([])}>{t('clearSources')}</Button>}
    </PopoverContent>
  </Popover>;
}
