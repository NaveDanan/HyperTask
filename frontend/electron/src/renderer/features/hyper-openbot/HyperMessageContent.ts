import type { Message } from '@ag-ui/core';
export interface HyperMessageAttachment { id: string; name: string; mimeType?: string; image: boolean }
/** AG-UI compound content is display data. Its transport metadata is never prose. */
export function hyperMessageContent(content: Message['content']): { text: string; attachments: HyperMessageAttachment[] } {
  if (typeof content === 'string') return { text: content, attachments: [] };
  const text: string[] = []; const attachments: HyperMessageAttachment[] = [];
  if (Array.isArray(content)) for (const part of content) {
    if (part.type === 'text') text.push(part.text);
    else if ((part.type === 'document' || part.type === 'image') && part.metadata && typeof part.metadata.attachmentId === 'string') {
      attachments.push({ id: part.metadata.attachmentId, name: typeof part.metadata.filename === 'string' ? part.metadata.filename : part.type === 'image' ? 'Image' : 'Document', image: part.type === 'image', mimeType: part.source.mimeType });
    }
  }
  return { text: text.join('\n'), attachments };
}
