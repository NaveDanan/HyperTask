// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted for HyperTask, developed by NaveDanan. See REUSE.md.
import { useEffect, useRef, useState, type Ref } from 'react';
import { ArrowUp, Paperclip, Square, X, FileText, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
export interface HyperComposerDraft { text: string; attachments: readonly HyperComposerAttachment[] }
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
  onRemoveAttachment?: (id: string) => void;
  /** Called after success with exactly the attachments consumed by this send. */
  onConsumeAttachments?: (ids: readonly string[]) => void;
  onStop?: () => void | Promise<void>;
  pending?: boolean;
  stoppable?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  initialValue?: string;
  /** Clear the reported send error after external recovery, retaining the draft and attachments. */
  recoveryVersion?: number;
  placeholder?: string;
  queuedAttachmentCount?: number;
  modelPicker?: HyperModelPickerProps;
  textareaRef?: Ref<HTMLTextAreaElement>;
  className?: string;
}
const EMPTY_ATTACHMENTS: readonly HyperComposerAttachment[] = [];
export function HyperComposer({ onSubmit, onFiles, attachments = EMPTY_ATTACHMENTS, onRemoveAttachment,
  onConsumeAttachments, onStop, pending = false, stoppable = pending, disabled = false, autoFocus = false,
  initialValue = '', recoveryVersion = 0, placeholder = 'Ask anything', queuedAttachmentCount = 0, modelPicker, textareaRef, className }: HyperComposerProps) {
  const [text, setText] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [staging, setStaging] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => { setError(undefined); }, [recoveryVersion]);
  const [rejected, setRejected] = useState<HyperRejectedFile[]>([]);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const claimedFocus = useRef(false);
  const inFlight = useRef(false);
  const reservations = useRef(0);
  const stoppingRef = useRef(false);
  useEffect(() => {
    if (autoFocus && !disabled && !claimedFocus.current) {
      claimedFocus.current = true;
      input.current?.focus();
    }
  }, [autoFocus, disabled]);
  const stage = async (files: readonly File[]) => {
    if (disabled || !files.length) return;
    if (!onFiles) { setError('Attachments are unavailable in this conversation.'); return; }
    const screened = HyperScreenPickedFiles(files, { alreadyStaged: attachments.length + queuedAttachmentCount + reservations.current });
    setRejected((current) => [...current, ...screened.rejected]);
    if (!screened.accepted.length) return;
    reservations.current += screened.accepted.length;
    setStaging(reservations.current);
    try { await onFiles(screened.accepted); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not attach files. Try again.'); }
    finally { reservations.current -= screened.accepted.length; setStaging(reservations.current); }
  };
  const sendable = !!(text.trim() || attachments.length) && !staging &&
    attachments.every((file) => file.status === 'ready') &&
    attachments.length + queuedAttachmentCount <= HyperMAX_ATTACHMENTS_PER_MESSAGE;
  const submit = async () => {
    if (disabled || pending || inFlight.current || !sendable) return;
    inFlight.current = true; setSubmitting(true); setError(undefined);
    const snapshot = { text, attachments: [...attachments] };
    try {
      await onSubmit(snapshot);
      setText((current) => current === snapshot.text ? '' : current);
      onConsumeAttachments?.(snapshot.attachments.map((file) => file.id));
      input.current?.focus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Message could not be sent. Try again.'); }
    finally { inFlight.current = false; setSubmitting(false); }
  };
  const stop = async () => {
    if (!onStop || stoppingRef.current) return;
    stoppingRef.current = true; setStopping(true); setError(undefined);
    try { await onStop(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not stop. Try again.'); }
    finally { stoppingRef.current = false; setStopping(false); }
  };
  return <form data-slot="composer" aria-label="Message composer" className={cn('rounded-xl border border-border bg-background p-3 text-foreground', className)}
    onSubmit={(event) => { event.preventDefault(); void submit(); }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = disabled || !onFiles ? 'none' : 'copy'; } }}
    onDrop={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); void stage(Array.from(event.dataTransfer.files)); } }}>
    {!!attachments.length && <HyperAttachmentStrip attachments={attachments} onRemove={onRemoveAttachment} disabled={disabled || submitting} />}
    <Textarea data-slot="composer-input" aria-label="Message" placeholder={placeholder} disabled={disabled} value={text}
      ref={(element) => { input.current = element; if (typeof textareaRef === 'function') textareaRef(element); else if (textareaRef) textareaRef.current = element; }}
      className="max-h-64 min-h-24 resize-none border-0 bg-transparent shadow-none"
      onChange={(event) => setText(event.target.value)}
      onPaste={(event) => {
        if (event.clipboardData.getData('text/plain')) return;
        const files = Array.from(event.clipboardData.files);
        if (files.length) { event.preventDefault(); void stage(files); }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
          event.preventDefault(); void submit();
        }
      }} />
    {error && <p role="alert" className="py-2 text-sm text-destructive">{error}</p>}
    {!!rejected.length && <ul aria-label="Files not added" className="space-y-1 py-2">{rejected.map((file) => <li key={file.id} className="flex items-center gap-2 text-sm text-destructive"><span role="alert">{file.reason}</span><Button type="button" size="icon-xs" variant="ghost" aria-label={`Dismiss rejection for ${file.name}`} onClick={() => setRejected((current) => current.filter((item) => item.id !== file.id))}><X /></Button></li>)}</ul>}
    <div className="flex flex-wrap items-center gap-2">
      {onFiles && <><input ref={picker} type="file" multiple className="hidden" tabIndex={-1} aria-label="Choose attachments" accept="image/png,image/jpeg,image/gif,image/webp,text/plain,text/markdown,text/csv,application/json" onChange={(event) => { void stage(Array.from(event.target.files ?? [])); event.target.value = ''; }} /><Button type="button" variant="ghost" size="icon-sm" aria-label="Attach files" disabled={disabled} onClick={() => picker.current?.click()}><Paperclip /></Button></>}
      {modelPicker && <HyperModelPicker {...modelPicker} disabled={disabled || modelPicker.disabled} onPicked={() => { modelPicker.onPicked?.(); input.current?.focus(); }} />}
      <div className="ml-auto">{stoppable && onStop ? <Button type="button" size="icon-sm" aria-label="Stop generating" disabled={stopping} onClick={() => void stop()}><Square /></Button> : <Button type="submit" size="icon-sm" aria-label="Send message" disabled={disabled || pending || submitting || !sendable}>{submitting ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}</Button>}</div>
    </div>
  </form>;
}
