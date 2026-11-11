import { useMemo, type ReactNode } from 'react';
import { markdownToEditorJson, type EditorBlock } from '../sidebar/import/markdown';
import { HyperGeneratedImage } from '../generated-images/HyperGeneratedImage';
import type { HyperDocumentOwner } from '../document/HyperDocumentOwner';

function safeLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol) ? value : null; } catch { return null; }
}
function inline(delta: unknown): ReactNode {
  if (!Array.isArray(delta)) return null;
  return delta.map((run, index) => {
    if (typeof run?.insert !== 'string') return null;
    const a = run.attributes ?? {};
    let content: ReactNode = run.insert;
    if (a.code) content = <code className="rounded-md bg-muted px-1 font-mono text-xs">{content}</code>;
    if (a.bold) content = <strong className="font-semibold">{content}</strong>;
    if (a.italic) content = <em>{content}</em>;
    if (a.strikethrough) content = <s>{content}</s>;
    const url = safeLink(a.href);
    if (url) content = <a href={url} className="text-primary underline underline-offset-2" onClick={event => { event.preventDefault(); void window.appflowy.shell.openExternal(url).catch(() => {}); }}>{content}</a>;
    return <span key={index}>{content}</span>;
  });
}
interface HyperChatRenderOptions { generatedImages: boolean; owner: HyperDocumentOwner | null; remaining: number }
function block(node: EditorBlock, key: number, options: HyperChatRenderOptions): ReactNode {
  const text = inline(node.data.delta), children = node.children.map((child, index) => block(child, index, options));
  const body = <>{text}{children.length > 0 && <div className="ml-4 space-y-2">{children}</div>}</>;
  switch (node.type) {
    case 'heading': return <p key={key} role="heading" aria-level={Number(node.data.level) || 1} className="text-base font-semibold">{body}</p>;
    case 'code': return <pre key={key} className="overflow-x-auto whitespace-pre rounded-lg bg-muted p-3 font-mono text-xs"><code>{text}</code></pre>;
    case 'bulleted_list': return <div key={key} className="flex gap-2"><span aria-hidden>•</span><div>{body}</div></div>;
    case 'numbered_list': return <div key={key} className="flex gap-2"><span aria-hidden>1.</span><div>{body}</div></div>;
    case 'todo_list': return <div key={key} className="flex gap-2"><span aria-label={node.data.checked ? 'Completed' : 'Not completed'}>{node.data.checked ? '☑' : '☐'}</span><div>{body}</div></div>;
    case 'quote': return <blockquote key={key} className="border-l-2 border-border pl-3 text-muted-foreground">{body}</blockquote>;
    case 'divider': return <hr key={key} className="border-border" />;
    case 'image': {
      if (options.generatedImages && typeof node.data.url === 'string' && node.data.url.startsWith('file:') && options.remaining-- > 0) {
        return <HyperGeneratedImage key={key} source={node.data.url} owner={options.owner} />;
      }
      const url = safeLink(node.data.url);
      // Opening an image is deliberate; a model response never triggers a remote request.
      return url ? <a key={key} href={url} className="break-all text-primary underline" onClick={event => { event.preventDefault(); void window.appflowy.shell.openExternal(url).catch(() => {}); }}>{url}</a> : null;
    }
    default: return <p key={key}>{body}</p>;
  }
}
export function HyperChatMessageContent({ text, generatedImages = false, owner = null }: { text: string; generatedImages?: boolean; owner?: HyperDocumentOwner | null }) {
  const root = useMemo(() => markdownToEditorJson(text), [text]);
  const options = { generatedImages, owner, remaining: 8 };
  return <div className="space-y-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{root.children.map((node, index) => block(node, index, options))}</div>;
}
