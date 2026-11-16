import { hyperReduceQueue, type HyperQueuedMessage, type HyperQueueDraft } from './HyperQueue';
import { HyperDictationControl } from './HyperDictationControl';
// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted for HyperTask, developed by NaveDanan. See REUSE.md.
import { useEffect, useRef, useState, type Ref, type Dispatch, type SetStateAction } from 'react';
import { ArrowUp, Paperclip, Square, X, FileText, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { usePromptFontStyle } from '@/features/settings/appearance/font-families';
import { cn } from '@/lib/utils';
import { HyperModelPicker, type HyperModelPickerProps } from './hyper-model-picker';
import { HyperScreenPickedFiles, HyperMAX_ATTACHMENTS_PER_MESSAGE, type HyperRejectedFile } from './hyper-files';

export interface HyperComposerAttachment {
  id: string;
  name: string;
  status: 'uploading' | 'ready' | 'error';
  previewUrl?: string;
  error?: string;
}
export interface HyperComposerDraft { agentId?: string | null; commandIds?: string[]; text: string; attachments: readonly HyperComposerAttachment[] }
export interface HyperAttachmentStripProps {
  attachments: readonly HyperComposerAttachment[];
  onRemove?: (id: string) => void;
  disabled?: boolean;
}
export function HyperAttachmentStrip({ attachments, onRemove, disabled }: HyperAttachmentStripProps) {
  return <ul aria-label="Attachments" className="flex flex-wrap gap-2">
    {attachments.map((file) => <li key={file.id} className="flex max-w-64 items-center gap-2 rounded-lg border border-border bg-muted p-2 text-sm">
      {file.previewUrl ? <img src={file.previewUrl} alt="" className="size-8 rounded-md object-cover" /> : <FileText aria-hidden="true" className="size-4 shrink-0" />}
      <span className="min-w-0"><span className="block truncate">{file.name}</span>
        {file.status === 'error' && <span className="block text-xs text-destructive">{file.error ?? 'Upload failed. Remove and try again.'}</span>}
        {file.status === 'uploading' && <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-3 animate-spin" />Uploading</span>}
      </span>
      {onRemove && <Button type="button" variant="ghost" size="icon-xs" disabled={disabled} aria-label={`Remove ${file.name}`} onClick={() => onRemove(file.id)}><X /></Button>}
    </li>)}
  </ul>;
}
export interface HyperComposerProps {
  onSubmit: (draft: HyperComposerDraft) => void | Promise<void>;
  /** The integration owns uploads, server IDs, previews and their cleanup. Resolve after staging. */
  onFiles?: (files: readonly File[]) => void | Promise<void>;
  attachments?: readonly HyperComposerAttachment[];
  /** Owner-held IDs survive remounts while another send is still using its files. */
  activeAttachmentIds?: readonly string[];
  /** Current channel count when onFiles reserves placeholders synchronously in the owner draft. */
  getAttachmentCount?: () => number;
  onRemoveAttachment?: (id: string) => void;
  /** Called after success with exactly the attachments consumed by this send. */
  onConsumeAttachments?: (ids: readonly string[]) => void;
  onDiscardAttachment?: (id: string) => void;
  /** Synchronously restore unsent queued intent to the channel's owner-held draft on navigation. */
  onRestoreQueued?: (messages: readonly HyperQueuedMessage[], mode?: 'failed-send') => void;
  commandIds?: readonly string[];
  onCommandIdsChange?: (ids: readonly string[]) => void;
  commands?: readonly { id: string; label: string }[];
  agents?: readonly { id: string; name: string }[];
  onStop?: () => void | Promise<void>;
  pending?: boolean;
  allowQueue?: boolean;
  stoppable?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Change this token to focus the current textarea after a recipient choice. Deferred while disabled. */
  focusRequest?: string | number;
  /** Allow drafting while the integration waits for a valid recipient. */
  submitDisabled?: boolean;
  initialValue?: string;
  /** Optional owner-managed draft for native navigation. Uncontrolled usage remains supported. */
  value?: string;
  onTextChange?: Dispatch<SetStateAction<string>>;
  /** Clear the reported send error after external recovery, retaining the draft and attachments. */
  recoveryVersion?: number;
  placeholder?: string;
  queuedAttachmentCount?: number;
  modelPicker?: HyperModelPickerProps;
  textareaRef?: Ref<HTMLTextAreaElement>;
  className?: string;
}
const EMPTY_ATTACHMENTS: readonly HyperComposerAttachment[] = [];
export function HyperComposer({ onSubmit, onFiles, attachments = EMPTY_ATTACHMENTS, activeAttachmentIds = [], getAttachmentCount, onRemoveAttachment,
  onConsumeAttachments, onDiscardAttachment, onRestoreQueued, commands = [], agents = [], commandIds, onCommandIdsChange, onStop, pending = false, allowQueue = true, stoppable = pending, disabled = false, autoFocus = false, submitDisabled = false,
  initialValue = '', value, onTextChange, recoveryVersion = 0, placeholder = 'Ask anything', queuedAttachmentCount = 0, modelPicker, textareaRef, focusRequest, className }: HyperComposerProps) {
  const [localCommands, setLocalCommands] = useState<readonly string[]>([]);
  const selectedCommands = commandIds ?? localCommands;
  const commandsRef = useRef(selectedCommands); commandsRef.current = selectedCommands;
  const setSelectedCommands = (change: string[] | ((current: readonly string[]) => string[])) => { const next = typeof change === 'function' ? change(commandsRef.current) : change; commandsRef.current = next; if (onCommandIdsChange) onCommandIdsChange(next); else setLocalCommands(next); };
  const [localText, setLocalText] = useState(initialValue);
  const text = value ?? localText;
  const setText = value !== undefined && onTextChange ? onTextChange : setLocalText;
  const [submitting, setSubmitting] = useState(false);
  // The prompt box's font and size follow the Appearance settings (Typography).
  const promptFont = usePromptFontStyle();
  const [stopping, setStopping] = useState(false);
  const [staging, setStaging] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => { setError(undefined); }, [recoveryVersion]);
  const [rejected, setRejected] = useState<HyperRejectedFile[]>([]);
  const liveBase = useRef('');
  const dictationGeneration = useRef(0);
  const previousText = useRef(text);
  const dictationText = useRef<string | undefined>(undefined);
  if (previousText.current !== text) {
    if (dictationText.current !== text) dictationGeneration.current++;
    previousText.current = text; dictationText.current = undefined;
  }
  const wasDisabled = useRef(disabled);
  if (wasDisabled.current !== disabled) { dictationGeneration.current++; wasDisabled.current = disabled; }
  const dictationOwner = dictationGeneration.current;
  const [dictationBusy, setDictationBusy] = useState(false);
  const dictationBusyRef = useRef(false);
  const registerDictationBusy = useRef((busy: boolean) => { dictationBusyRef.current = busy; if (mounted.current) setDictationBusy(busy); }).current;
  const dictationStop = useRef<((cancel?: boolean) => boolean) | undefined>(undefined);
  const registerDictationStop = useRef((handler: ((cancel?: boolean) => boolean) | undefined) => { dictationStop.current = handler; }).current;
  const input = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const claimedFocus = useRef(false);
  const focusedRequest = useRef<string | number | undefined>(undefined);
  const inFlight = useRef(false);
  const renderOwner = {};
  const submittedRender = useRef<object | undefined>(undefined);
  const activeAttachments = useRef<readonly string[]>([]);
  const reservations = useRef(0);
  const stoppingRef = useRef(false);
  // DOM callbacks cached by an earlier render must consult current readiness and content.
  const actions = useRef({ submit: async () => {}, stage: async (_files: readonly File[]) => {}, remove: (_id: string) => {} });
  useEffect(() => {
    if (autoFocus && !disabled && !claimedFocus.current) {
      claimedFocus.current = true;
      input.current?.focus();
    }
  }, [autoFocus, disabled]);
  useEffect(() => {
    if (!disabled && focusRequest !== undefined && focusRequest !== focusedRequest.current && input.current) {
      focusedRequest.current = focusRequest; input.current.focus();
    }
  }, [focusRequest, disabled]);
  const protectedIds = () => new Set([...activeAttachmentIds, ...activeAttachments.current]);
  const stage = async (files: readonly File[]) => {
    if (!mounted.current || disabled || !files.length) return;
    if (!onFiles) { setError('Attachments are unavailable in this conversation.'); return; }
    // Channel placeholders already include in-flight files. Read the live owner count
    // so even another pick before React rerenders cannot count them twice or overflow.
    const activeCount = attachments.filter(file => protectedIds().has(file.id)).length;
    const stagedCount = Math.max(0, (getAttachmentCount ? getAttachmentCount() : attachments.length + reservations.current) - activeCount);
    const screened = HyperScreenPickedFiles(files, { alreadyStaged: stagedCount + queuedAttachmentCount + queue.current.reduce((count, message) => count + message.attachments.length, 0) });
    setRejected((current) => [...current, ...screened.rejected]);
    if (!screened.accepted.length) return;
    reservations.current += screened.accepted.length;
    setStaging(reservations.current);
    try { await onFiles(screened.accepted); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not attach files. Try again.'); }
    finally { reservations.current -= screened.accepted.length; setStaging(reservations.current); }
  };
  const protectedAttachments = protectedIds();
  const availableAttachments = attachments.filter(file => !protectedAttachments.has(file.id));
  const sendable = !submitDisabled && !!(text.trim() || availableAttachments.length || selectedCommands.length) && !staging &&
    availableAttachments.every((file) => file.status === 'ready') &&
    availableAttachments.length + queuedAttachmentCount <= HyperMAX_ATTACHMENTS_PER_MESSAGE;
  const [queued, setQueued] = useState<readonly HyperQueuedMessage[]>([]);
  const queue = useRef<readonly HyperQueuedMessage[]>([]);
  const queueHeldAfterFailure = useRef(false);
  const previousPending = useRef(pending);
  const activeSnapshot = useRef<string | undefined>(undefined);
  const latest = useRef({ onSubmit, onDiscardAttachment, onRestoreQueued }); latest.current = { onSubmit, onDiscardAttachment, onRestoreQueued };
  const [selectedAgent, setSelectedAgent] = useState('');
  const mounted = useRef(true);
  function transition(action: Parameters<typeof hyperReduceQueue>[1]) {
    const next = hyperReduceQueue(queue.current, action); queue.current = next.queue; setQueued(next.queue);
    if (next.droppedAttachments.length) { setError('Only eight files can be sent together. Extra queued files were released.'); onConsumeAttachments?.(next.droppedAttachments.map(file => file.id)); }
    next.droppedAttachments.forEach(file => latest.current.onDiscardAttachment?.(file.id)); return next;
  }
  async function runQueued(next: ReturnType<typeof hyperReduceQueue>) {
    if (!next.run) return;
    inFlight.current = true; setSubmitting(true); setError(undefined); activeSnapshot.current = next.run.text; activeAttachments.current = next.run.attachments.map(file => file.id);
    try { await latest.current.onSubmit(next.run); }
    catch (cause) {
      queueHeldAfterFailure.current = true;
      if (!mounted.current && latest.current.onRestoreQueued) {
        // The local queue was drained before this request. Restore its whole submitted snapshot,
        // including any live draft joined to it, through the still-current owner lease.
        latest.current.onRestoreQueued([{ id: crypto.randomUUID(), text: next.run.text, commandIds: [...next.run.commandIds], attachments: [...next.run.attachments] }], 'failed-send');
      } else transition({ type: 'restore', messages: next.restoreIfRunFails });
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Message could not be sent. Try again.');
      throw cause;
    }
    finally { inFlight.current = false; activeSnapshot.current = undefined; activeAttachments.current = []; if (mounted.current) setSubmitting(false); }
  }
  useEffect(() => {
    if (pending && !previousPending.current) queueHeldAfterFailure.current = false;
    previousPending.current = pending;
    if (!mounted.current || pending || disabled || submitDisabled || !allowQueue || dictationBusyRef.current) return;
    if (inFlight.current || queueHeldAfterFailure.current || !queue.current.length) return;
    void runQueued(transition({ type: 'settle' })).catch(() => {});
  }, [pending, submitting, disabled, submitDisabled, allowQueue, dictationBusy]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      dictationGeneration.current++; dictationStop.current?.(true);
      if (queue.current.length && latest.current.onRestoreQueued) latest.current.onRestoreQueued(queue.current);
      else for (const message of queue.current) for (const file of message.attachments) latest.current.onDiscardAttachment?.(file.id);
      queue.current = [];
    };
  }, []);
  const submit = async () => {
    if (!mounted.current || disabled || submitDisabled || submittedRender.current === renderOwner) return;
    // All form, button and Enter paths share the synchronous session guard. It also
    // covers permission/transcription transitions before React can render their state.
    if (dictationStop.current?.() || dictationBusyRef.current) return;
    if (!sendable || reservations.current || (!allowQueue && (pending || inFlight.current))) return;
    const prefix = selectedCommands.filter(id => !text.trimStart().split(/\s+/).includes(`/${id}`)).map(id => `/${id}`).join(' ');
    const snapshot: HyperQueueDraft = { text: [prefix, text].filter(Boolean).join(' ').trim(), attachments: attachments.filter(file => !protectedIds().has(file.id)), agentId: selectedAgent || null, commandIds: [...selectedCommands], isEmpty: !text.trim() && !prefix };
    if ((!snapshot.text.trim() && !snapshot.attachments.length) || (inFlight.current && activeSnapshot.current === snapshot.text && !snapshot.attachments.length)) return;
    submittedRender.current = renderOwner; dictationGeneration.current++; dictationStop.current?.(true);
    const busy = pending || inFlight.current;
    const next = transition({ type: 'submit', id: crypto.randomUUID(), draft: snapshot, busy });
    if (busy) { setText(''); setSelectedCommands([]); onConsumeAttachments?.(snapshot.attachments.map(file => file.id)); return; }
    const originalText = text;
    setText(''); setSelectedCommands([]);
    try {
      queueHeldAfterFailure.current = false; await runQueued(next);
      onConsumeAttachments?.(snapshot.attachments.map(file => file.id)); input.current?.focus();
    } catch {
      if (mounted.current || !latest.current.onRestoreQueued) {
        // Match upstream: failed words come before newer words; neither user's intent is dropped.
        setText(current => !originalText.trim() ? current : !current.trim() ? originalText : `${originalText} ${current}`);
        setSelectedCommands(current => [...new Set([...snapshot.commandIds, ...current])]);
      }
      /* Stable retry identity remains available. */
    }
  };
  const stop = async () => {
    if (!onStop || stoppingRef.current) return;
    stoppingRef.current = true; setStopping(true); setError(undefined);
    try { await onStop(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not stop. Try again.'); }
    finally { stoppingRef.current = false; setStopping(false); }
  };
  actions.current = { submit, stage, remove: id => { if (mounted.current && !disabled && !protectedIds().has(id)) onRemoveAttachment?.(id); } };
  const acceptsDictation = () => mounted.current && !wasDisabled.current && dictationGeneration.current === dictationOwner;
  return <form data-slot="composer" aria-label="Message composer" className={cn('rounded-xl border border-border bg-background p-3 text-foreground', className)}
    onSubmit={(event) => { event.preventDefault(); void actions.current.submit(); }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = disabled || !onFiles ? 'none' : 'copy'; } }}
    onDrop={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); void actions.current.stage(Array.from(event.dataTransfer.files)); } }}>
    {!!queued.length && <div aria-label="Queued messages" className="space-y-2">{queued.map(message => <div key={message.id} className="flex gap-2"><span>{message.text || `${message.attachments.length} files`} · Queued</span><Button type="button" variant="ghost" onClick={() => transition({ type: 'remove', id: message.id })}>Remove queued message</Button></div>)}</div>}
    {/(?:^|\s)[@/][^\s]*$/.test(text) && <div aria-label="Completions" className="flex flex-wrap gap-1">{(text.match(/(?:^|\s)([@/])([^\s]*)$/)?.[1] === '@' ? agents.filter(bot => bot.name.toLowerCase().startsWith((text.match(/@([^\s]*)$/)?.[1] ?? '').toLowerCase())).map(bot => <Button key={bot.id} type="button" variant="ghost" onClick={() => { setSelectedAgent(bot.id); setText(current => current.replace(/(?:^|\s)@[^\s]*$/, ' ')); input.current?.focus(); }}>@{bot.name}</Button>) : commands.filter(command => command.id.startsWith(text.match(/\/([^\s]*)$/)?.[1] ?? '')).map(command => <Button key={command.id} type="button" variant="ghost" onClick={() => { setSelectedCommands(current => [...new Set([...current, command.id])]); setText(current => current.replace(/(?:^|\s)\/[^\s]*$/, ' ')); input.current?.focus(); }}>/{command.id} · {command.label}</Button>))}</div>}
    {!!selectedCommands.length && <div aria-label="Selected skills">{selectedCommands.map(id => <Button key={id} type="button" variant="outline" onClick={() => setSelectedCommands(current => current.filter(value => value !== id))}>/{id} ×</Button>)}</div>}
    {!!availableAttachments.length && <HyperAttachmentStrip attachments={availableAttachments} onRemove={onRemoveAttachment ? id => actions.current.remove(id) : undefined} disabled={disabled || submitting} />}
    <Textarea data-slot="composer-input" aria-label="Message" placeholder={placeholder} disabled={disabled} value={text}
      ref={(element) => { input.current = element; if (typeof textareaRef === 'function') textareaRef(element); else if (textareaRef) textareaRef.current = element; }}
      style={promptFont}
      className="max-h-64 min-h-24 resize-none border-0 bg-transparent shadow-none"
      onChange={(event) => { dictationGeneration.current++; dictationStop.current?.(true); setText(event.target.value); }}
      onPaste={(event) => {
        if (event.clipboardData.getData('text/plain')) return;
        const files = Array.from(event.clipboardData.files);
        if (files.length) { event.preventDefault(); void actions.current.stage(files); }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
          event.preventDefault(); void actions.current.submit();
        }
      }} />
    {error && <p role="alert" className="py-2 text-sm text-destructive">{error}</p>}
    {!!rejected.length && <ul aria-label="Files not added" className="space-y-1 py-2">{rejected.map((file) => <li key={file.id} className="flex items-center gap-2 text-sm text-destructive"><span role="alert">{file.reason}</span><Button type="button" size="icon-xs" variant="ghost" aria-label={`Dismiss rejection for ${file.name}`} onClick={() => setRejected((current) => current.filter((item) => item.id !== file.id))}><X /></Button></li>)}</ul>}
    <div className="flex flex-wrap items-center gap-2">
      {onFiles && <><input ref={picker} type="file" multiple className="hidden" tabIndex={-1} aria-label="Choose attachments" accept="image/png,image/jpeg,image/gif,image/webp,text/plain,text/markdown,text/csv,application/json" onChange={(event) => { void actions.current.stage(Array.from(event.target.files ?? [])); event.target.value = ''; }} /><Button type="button" variant="ghost" size="icon-sm" aria-label="Attach files" disabled={disabled} onClick={() => picker.current?.click()}><Paperclip /></Button></>}
      <HyperDictationControl draftRevision={dictationOwner} registerStop={registerDictationStop} onBusyChange={registerDictationBusy} onLiveStart={() => { if (acceptsDictation()) liveBase.current = text; }} onLiveText={words => { if (acceptsDictation()) { const next = [liveBase.current.trimEnd(), words].filter(Boolean).join(' '); dictationText.current = next; setText(next); } }} disabled={disabled} onText={words => { if (acceptsDictation()) setText(current => { const next = [current.trimEnd(), words].filter(Boolean).join(' '); dictationText.current = next; return next; }); }} />
      {!!agents.length && <label>To <select aria-label="Mention a Bot" value={selectedAgent} onChange={event => setSelectedAgent(event.target.value)}><option value="">Default recipient</option>{agents.map(bot => <option key={bot.id} value={bot.id}>@{bot.name}</option>)}</select></label>}
      {!!commands.length && <label>Skill <select aria-label="Add skill command" value="" onChange={event => { const id = event.target.value; if (id) setSelectedCommands(current => [...new Set([...current, id])]); }}><option value="">Choose a skill</option>{commands.map(command => <option key={command.id} value={command.id}>/{command.id} · {command.label}</option>)}</select></label>}
      {modelPicker && <HyperModelPicker {...modelPicker} disabled={disabled || modelPicker.disabled} onPicked={() => { modelPicker.onPicked?.(); input.current?.focus(); }} />}
      <div className="ml-auto flex gap-2">{stoppable && onStop && <Button type="button" size="icon-sm" aria-label="Stop generating" disabled={stopping} onClick={() => void stop()}><Square /></Button>}<Button type="submit" size="icon-sm" aria-label={pending || submitting ? 'Queue message' : 'Send message'} disabled={disabled || dictationBusy || !sendable || (!allowQueue && (pending || submitting))}><ArrowUp /></Button></div>
    </div>
  </form>;
}
