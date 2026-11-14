// Copyright (c) 2026 CopilotKit. MIT license, see LICENSE.
import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { HyperCitation } from './citations';

export interface HyperMarkdownProps {
  content: string;
  /** Chat replies preserve single newlines; tool documents use Markdown paragraph wrapping. */
  preserveLineBreaks?: boolean;
  className?: string;
  onOpenLink?: (href: string) => void;
}

/** HTML is always text. An unfinished streaming delimiter stays visible until complete. */
function inline(text: string, onOpenLink?: (href: string) => void, depth = 0): ReactNode {
  if (depth > 8) return text;
  const pattern = /(`+)([^`]+?)\1|\[([^\]]+)\]\(([^\s)]+)\)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*([^*\n]+)\*/g;
  const nodes: ReactNode[] = [];
  let from = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index!;
    nodes.push(text.slice(from, at));
    const child = (value: string) => inline(value, onOpenLink, depth + 1);
    nodes.push(<Fragment key={at}>{match[1]
      ? <code className="rounded-md bg-muted px-1 font-mono text-xs">{match[2]}</code>
      : match[3] ? <HyperCitation href={match[4]} onOpenLink={onOpenLink}>{child(match[3])}</HyperCitation>
      : match[5] || match[6] ? <strong className="font-semibold">{child(match[5] || match[6])}</strong>
      : match[7] ? <del>{child(match[7])}</del> : <em>{child(match[8])}</em>}</Fragment>);
    from = at + match[0].length;
  }
  nodes.push(text.slice(from));
  return nodes;
}

export function HyperMarkdown({ content, preserveLineBreaks = false, className, onOpenLink }: HyperMarkdownProps) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  const render = (value: string) => inline(value, onOpenLink);
  let i = 0;
  while (i < lines.length) {
    const key = i;
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(<div key={key} className="overflow-hidden rounded-lg border border-border bg-muted/40">
        {fence[2].trim() && <div className="border-b border-border px-3 py-1 text-xs text-muted-foreground">{fence[2].trim()}</div>}
        <pre className="overflow-x-auto p-3 font-mono text-xs"><code>{code.join('\n')}</code></pre>
      </div>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(<div role="heading" aria-level={heading[1].length} key={key} className={cn('font-semibold', heading[1].length === 1 ? 'text-xl' : heading[1].length === 2 ? 'text-lg' : 'text-base')}>{render(heading[2])}</div>);
      i++; continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { blocks.push(<hr key={key} className="border-border" />); i++; continue; }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key} className="border-l-2 border-border pl-3 text-muted-foreground"><HyperMarkdown content={quote.join('\n')} onOpenLink={onOpenLink} preserveLineBreaks={preserveLineBreaks} /></blockquote>);
      continue;
    }
    const list = /^\s*(?:([-+*])|\d+[.)])\s+(.+)$/.exec(line);
    if (list) {
      const ordered = !list[1];
      const items: ReactNode[] = [];
      const start = ordered ? parseInt(line.trim(), 10) : undefined;
      while (i < lines.length) {
        const item = /^\s*(?:([-+*])|\d+[.)])\s+(.+)$/.exec(lines[i]);
        if (!item || !item[1] !== ordered) break;
        const task = /^\[([ xX])\]\s+(.*)$/.exec(item[2]);
        items.push(<li key={i++}>{task ? <><input type="checkbox" checked={task[1] !== ' '} readOnly aria-label={task[2]} className="mr-2 accent-primary" />{render(task[2])}</> : render(item[2])}</li>);
      }
      blocks.push(ordered ? <ol key={key} start={start} className="list-decimal space-y-1 pl-6">{items}</ol> : <ul key={key} className="list-disc space-y-1 pl-6">{items}</ul>);
      continue;
    }
    if (i + 1 < lines.length && line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
      const headers = cells(line); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(<div key={key} className="overflow-x-auto rounded-lg border border-border"><table className="w-full border-collapse text-sm"><thead className="bg-muted"><tr>{headers.map((h, n) => <th key={n} className="border-b border-border px-3 py-2 text-left font-medium">{render(h)}</th>)}</tr></thead><tbody>{rows.map((row, r) => <tr key={r}>{headers.map((_, c) => <td key={c} className="border-b border-border px-3 py-2">{render(row[c] ?? '')}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(?:#{1,6}\s|>|`{3,}|~{3,}|[-+*]\s|\d+[.)]\s)/.test(lines[i])) paragraph.push(lines[i++]);
    blocks.push(<p key={key} className={preserveLineBreaks ? 'whitespace-pre-wrap' : undefined}>{render(paragraph.join(preserveLineBreaks ? '\n' : ' '))}</p>);
  }
  return <div className={cn('min-w-0 space-y-3 break-words text-sm leading-relaxed text-foreground', className)}>{blocks}</div>;
}
