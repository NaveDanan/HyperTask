import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowUp, Bot, LoaderCircle, RefreshCw, Square } from 'lucide-react';
import { HYPER_NOD_MESSAGES, HYPER_NOD_TEXT_LIMIT, type HyperNodMessage } from '@shared/HyperNod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { HyperTranscript } from '../hyper-openbot/transcript';
import { HyperNodController, hyperNodApprovalLabels, hyperNodDraftAfterSend, type HyperNodViewState } from './HyperNodController';
import { hyperNodFailure, hyperNodPending, hyperNodTranscript, hyperNodWork } from './HyperNodStore';
// The unsent draft survives leaving and reopening the Nod tab.
let savedDraft = '';
const openLink = (url: string) => void window.hypertask.shell.openExternal(url);
export interface HyperNodActions {
  retry(): void;
  reload(): void;
  loadOlder(): void;
  send(text: string): Promise<boolean>;
  stop(): void;
  answerChoices(message: HyperNodMessage, choiceIds: readonly string[]): Promise<boolean>;
  answerWritten(message: HyperNodMessage, text: string): Promise<boolean>;
  answerApproval(message: HyperNodMessage, approved: boolean): Promise<boolean>;
}
export function HyperNodPage() {
  const [controller] = useState(() => new HyperNodController(window.hypertask.hyperNod));
  useEffect(() => { void controller.start(); return () => controller.dispose(); }, [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  return <HyperNodView state={state} actions={{
    retry: () => void controller.retry(), reload: () => void controller.reload(), loadOlder: () => void controller.loadOlder(), send: text => controller.send(text), stop: () => void controller.stop(),
    answerChoices: (message, ids) => controller.answerChoices(message, ids), answerWritten: (message, text) => controller.answerWritten(message, text), answerApproval: (message, approved) => controller.answerApproval(message, approved),
  }} />;
}
export function HyperNodView({ state, actions }: { state: HyperNodViewState; actions: HyperNodActions }) {
  const snapshot = state.snapshot;
  const hasOlder = state.olderHasMore ?? snapshot?.hasEarlierMessages ?? false;
  const work = snapshot ? hyperNodWork(snapshot) : 'idle';
  const pending = snapshot ? hyperNodPending(snapshot, state.older, state.retired) : [];
  const step = state.activity.find(item => item.step || item.title);
  const connection = state.phase !== 'ready' ? null : state.connection === 'live' ? 'Live' : state.connection === 'connecting' ? 'Connecting…' : 'Reconnecting…';
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
      <Bot aria-hidden="true" className="size-4 text-muted-foreground" />
      <h1 className="font-medium">Nod assistant</h1>
      {state.status?.model && <span className="truncate text-muted-foreground">{state.status.model}</span>}
      {connection && <span role="status" title={state.connectionError} className={cn('ml-auto shrink-0 text-xs', state.connection === 'live' ? 'text-muted-foreground' : 'text-warning')}>{connection}</span>}
    </header>
    {state.phase !== 'ready' ? <HyperNodUnavailable state={state} onRetry={actions.retry} /> : <>
      <HyperTranscript
        messages={snapshot ? hyperNodTranscript(snapshot, state.older, state.streams) : []}
        restoring={!snapshot && !state.syncError}
        busy={work === 'running'}
        working={<><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />{step?.step || step?.title || 'Working'}</>}
        stopped={snapshot ? hyperNodFailure(snapshot) : undefined}
        onOpenLink={openLink}
        intro={hasOlder && <Button variant="ghost" size="sm" className="self-center" disabled={state.loadingOlder} onClick={actions.loadOlder}>{state.loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}</Button>}
      />
      <div className="mx-auto w-full max-w-[var(--chat-content-max-width,46rem)] space-y-3 px-4 pb-4">
        {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
        {state.syncError && <div role="alert" className="flex items-center gap-2 text-sm text-destructive"><p className="min-w-0 flex-1">The conversation could not be reloaded. {state.syncError} Retrying automatically.</p><Button variant="outline" size="sm" onClick={actions.reload}><RefreshCw />Reload</Button></div>}
        {pending.map(message => <HyperNodRequest key={message.id} message={message} disabled={state.sending} actions={actions} />)}
        {work === 'waiting' && !pending.length && <p role="status" className="text-sm text-muted-foreground">Nod is waiting for your reply.</p>}
        <HyperNodComposer disabled={!snapshot} sending={state.sending} running={work !== 'idle'} stopping={state.stopping} onSend={actions.send} onStop={actions.stop} />
      </div>
    </>}
  </div>;
}
function HyperNodUnavailable({ state, onRetry }: { state: HyperNodViewState; onRetry: () => void }) {
  const status = state.status;
  return <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
    {state.phase === 'checking' ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />Connecting to Nod…</p> : <>
      <p role="alert" className="text-sm">{status ? HYPER_NOD_MESSAGES[status.problem] : HYPER_NOD_MESSAGES.operation_failed}</p>
      {status?.detail && <p className="text-xs break-words text-muted-foreground">{status.detail}</p>}
      {state.retrying && <p role="status" className="text-xs text-muted-foreground">Retrying automatically.</p>}
      <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw />Retry now</Button>
    </>}
  </div>;
}
function HyperNodRequest({ message, disabled, actions }: { message: HyperNodMessage; disabled: boolean; actions: HyperNodActions }) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [written, setWritten] = useState('');
  const frame = (label: string, body: ReactNode) => <section aria-label={label} className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm">{body}</section>;
  if (message.approval) {
    const approval = message.approval;
    const labels = hyperNodApprovalLabels(approval.title);
    return frame('Nod needs your approval', <>
      <p className="font-medium">{approval.app ? `${approval.app}: ${approval.title}` : approval.title}</p>
      {!!approval.fields.length && <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">{approval.fields.map((field, index) => <div key={index} className="contents"><dt className="text-muted-foreground">{field.label}</dt><dd className="min-w-0 break-words whitespace-pre-wrap">{field.value}</dd></div>)}</dl>}
      {approval.body && <div className="max-h-60 overflow-y-auto rounded-md bg-muted p-2 whitespace-pre-wrap break-words">{approval.body}</div>}
      {approval.bodyCut && <p className="text-xs text-muted-foreground">Only the start is shown. The rest is included too.</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void actions.answerApproval(message, false)}>{labels.decline}</Button>
        <Button variant={/^(delete|remove|trash)\b/i.test(labels.approve) ? 'destructive' : 'default'} size="sm" disabled={disabled} onClick={() => void actions.answerApproval(message, true)}>{labels.approve}</Button>
      </div>
    </>);
  }
  const choices = message.choices!;
  const sendWritten = () => { const text = written; if (text.trim()) void actions.answerWritten(message, text).then(sent => { if (sent) setWritten(current => current === text ? '' : current); }); };
  return frame('Nod is asking', <>
    <p className="text-muted-foreground">{choices.multiple ? 'Choose any that apply, or answer in your own words.' : 'Choose one, or answer in your own words.'}</p>
    <div className="flex flex-wrap gap-2">
      {choices.options.map(option => <Button key={option.id} variant={selected.includes(option.id) ? 'secondary' : 'outline'} size="sm" disabled={disabled} aria-pressed={choices.multiple ? selected.includes(option.id) : undefined} title={option.description}
        onClick={() => choices.multiple ? setSelected(current => current.includes(option.id) ? current.filter(id => id !== option.id) : [...current, option.id]) : void actions.answerChoices(message, [option.id])}>{option.label}</Button>)}
    </div>
    {choices.multiple && <div className="flex justify-end"><Button size="sm" disabled={disabled || !selected.length} onClick={() => void actions.answerChoices(message, selected).then(sent => { if (sent) setSelected([]); })}>Send choices</Button></div>}
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (!disabled) sendWritten(); }}>
      <Input aria-label="Your own answer" placeholder="Your own answer" value={written} maxLength={HYPER_NOD_TEXT_LIMIT} onChange={event => setWritten(event.target.value)} />
      <Button type="submit" variant="outline" size="sm" disabled={disabled || !written.trim()}>Answer</Button>
    </form>
  </>);
}
function HyperNodComposer({ disabled, sending, running, stopping, onSend, onStop }: { disabled: boolean; sending: boolean; running: boolean; stopping: boolean; onSend: (text: string) => Promise<boolean>; onStop: () => void }) {
  const [text, setText] = useState(savedDraft);
  const latest = useRef(text);
  const update = (value: string) => { savedDraft = value; latest.current = value; setText(value); };
  const submit = async () => { const sent = text; if (await onSend(sent)) update(hyperNodDraftAfterSend(latest.current, sent)); };
  const blocked = disabled || sending || !text.trim();
  return <form className="rounded-xl border border-border bg-background p-2" onSubmit={event => { event.preventDefault(); if (!blocked) void submit(); }}>
    <Textarea aria-label="Message Nod" placeholder="Ask Nod" value={text} maxLength={HYPER_NOD_TEXT_LIMIT} disabled={disabled} rows={2}
      className="max-h-48 min-h-12 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      onChange={event => update(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!blocked) void submit(); } }} />
    <div className="flex justify-end gap-2">
      {running && <Button type="button" variant="outline" size="icon-sm" aria-label="Stop Nod's work" title="Stops every task Nod is running" disabled={stopping} onClick={onStop}><Square /></Button>}
      <Button type="submit" size="icon-sm" aria-label="Send" disabled={blocked}>{sending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <ArrowUp />}</Button>
    </div>
  </form>;
}
