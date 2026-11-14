// Copyright (c) 2026 CopilotKit. MIT license, see LICENSE.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, LoaderCircle, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { HyperMarkdown } from './HyperMarkdown';
import { useHyperPacedReveal } from './paced-reveal';

export interface HyperToolMessageProps {
  id: string;
  label: string;
  attempted?: string;
  detail?: string;
  status: 'running' | 'complete' | 'failed' | 'refused' | 'not-yet' | 'by-you';
  arguments?: string;
  result?: string;
  children?: ReactNode;
  onOpenLink?: (href: string) => void;
}
export function HyperToolMessage({ id, label, attempted, detail, status, arguments: args, result, children, onOpenLink }: HyperToolMessageProps) {
  const text = status === 'refused' ? `Blocked: ${attempted ?? label}` : status === 'failed' ? `${label}, didn't work` : status === 'not-yet' ? `${label}, not done yet` : status === 'by-you' ? `${label}, done by you` : label;
  const summary = <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-sm', status === 'refused' ? 'text-destructive' : status === 'failed' ? 'text-warning' : 'text-muted-foreground')}>
    {status === 'running' ? <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" /> : <Wrench aria-hidden="true" className="size-3.5 shrink-0" />}
    <span>{text}</span>{status === 'running' && <span className="sr-only">Running</span>}
    {detail && <span className="min-w-0 truncate">{detail}</span>}
  </span>;
  if (args === undefined && result === undefined && children == null) return <div data-tool-call-id={id} data-status={status}>{summary}</div>;
  return <details data-tool-call-id={id} data-status={status} className="min-w-0 rounded-md">
    <summary className="cursor-pointer rounded-md py-1 focus-visible:outline focus-visible:outline-ring">{summary}</summary>
    <div className="mt-2 max-h-80 space-y-3 overflow-auto border-l border-border pl-3">
      {args !== undefined && <div><p className="mb-1 text-xs font-medium text-muted-foreground">Arguments</p><pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-xs">{args}</pre></div>}
      {result !== undefined && <HyperMarkdown content={result} onOpenLink={onOpenLink} />}{children}
    </div>
  </details>;
}
export interface HyperTranscriptMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  live?: boolean;
  streaming?: boolean;
  author?: string;
  tools?: readonly HyperToolMessageProps[];
}
export interface HyperTranscriptProps {
  messages: readonly HyperTranscriptMessage[];
  busy?: boolean;
  restoring?: boolean;
  stopped?: string;
  working?: ReactNode;
  intro?: ReactNode;
  className?: string;
  onOpenLink?: (href: string) => void;
  renderTool?: (tool: HyperToolMessageProps) => ReactNode;
}
function HyperTranscriptRow({ message, onOpenLink, renderTool }: { message: HyperTranscriptMessage } & Pick<HyperTranscriptProps, 'onOpenLink' | 'renderTool'>) {
  const content = useHyperPacedReveal(message.content, { live: message.live ?? false, streaming: message.streaming ?? false });
  return <article data-message-id={message.id} aria-label={message.author ?? (message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Assistant' : 'System')} className={cn('min-w-0 space-y-2', message.role === 'user' && 'ml-auto max-w-[85%] rounded-xl bg-muted px-4 py-3')}>
    {message.author && <p className="text-xs font-medium text-muted-foreground">{message.author}</p>}
    {message.role === 'user' ? <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p> : <HyperMarkdown content={content} preserveLineBreaks onOpenLink={onOpenLink} />}
    {message.tools?.map(tool => <div key={tool.id}>{renderTool ? renderTool(tool) : <HyperToolMessage {...tool} onOpenLink={tool.onOpenLink ?? onOpenLink} />}</div>)}
  </article>;
}
export function HyperTranscript({ messages, busy = false, restoring = false, stopped, working, intro, className, onOpenLink, renderTool }: HyperTranscriptProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [atEnd, setAtEnd] = useState(true);
  const follow = () => { const el = viewport.current; if (el) el.scrollTop = el.scrollHeight; };
  useLayoutEffect(() => {
    if (!body.current) return;
    const observer = new ResizeObserver(() => { if (following.current && !window.getSelection()?.toString()) follow(); });
    observer.observe(body.current);
    if (following.current) follow();
    return () => observer.disconnect();
  }, [messages]);
  return <div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
    <div ref={viewport} className="min-h-0 flex-1 overflow-y-auto" tabIndex={0} aria-label="Conversation" onWheel={event => { if (event.deltaY < 0) following.current = false; }} onKeyDown={event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) following.current = false; }} onScroll={event => {
      const el = event.currentTarget;
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      following.current = near; setAtEnd(near);
    }}>
      <div ref={body} className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4" aria-busy={busy}>
        {intro}
        {restoring && !messages.length ? <div role="status" aria-label="Loading this conversation" className="space-y-3">{[0, 1, 2].map(n => <Skeleton aria-hidden="true" key={n} className="h-4 w-full motion-reduce:animate-none" />)}</div> : messages.map(message => <HyperTranscriptRow key={message.id} message={message} onOpenLink={onOpenLink} renderTool={renderTool} />)}
        {busy && <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">{working ?? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />{messages.some(message => message.streaming) ? 'Responding' : 'Thinking'}</>}</div>}
        {!busy && stopped && <p role="alert" data-testid="transcript-stopped" className="text-sm text-destructive">{stopped}</p>}
      </div>
    </div>
    {!atEnd && <Button variant="outline" size="sm" className="absolute bottom-3 left-1/2 -translate-x-1/2" onClick={() => { following.current = true; follow(); setAtEnd(true); }}><ArrowDown className="size-4" />Jump to latest</Button>}
  </div>;
}
