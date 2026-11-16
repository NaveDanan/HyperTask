// Adapted from OpenBot app/src/lib/markdown.tsx. Copyright (c) 2026 CopilotKit. MIT, see LICENSE.
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { cn } from '@/lib/utils';
import { useAppearancePref } from '@/features/settings/appearance/font-families';
import { HyperCitation } from './citations';
export interface HyperMarkdownProps { content: string; preserveLineBreaks?: boolean; className?: string; onOpenLink?: (href: string) => void }
export function HyperMarkdown({ content, preserveLineBreaks = false, className, onOpenLink }: HyperMarkdownProps) {
  // Word wrap and the code size of the Appearance settings (styles/appearance-typography.css) apply here.
  const wordWrap = useAppearancePref((prefs) => prefs.wordWrap);
  return <Streamdown
    plugins={{ code }}
    skipHtml
    // Model and tool text cannot initiate passive resource requests or image preloads.
    urlTransform={(url, key, node) => node.tagName === 'img' || ['src', 'srcSet', 'srcset', 'poster'].includes(key) ? undefined : url}
    className={cn('hyper-markdown min-w-0 break-words text-sm [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2', wordWrap ? '[&_pre]:whitespace-pre-wrap [&_pre]:break-words' : '[&_pre]:whitespace-pre', preserveLineBreaks && 'whitespace-pre-line', className)}
    components={{
      img: ({ alt }) => <span className="text-muted-foreground" data-hyper-markdown-image="blocked">{alt || 'Image not displayed'}</span>,
      a: ({ href, children }) => <HyperCitation href={href ?? ''} onOpenLink={onOpenLink}>{children}</HyperCitation>,
    }}
  >{content}</Streamdown>;
}
