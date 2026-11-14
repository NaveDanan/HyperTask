import { useEffect, useState } from 'react';
import { FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { HyperMessageAttachment } from './HyperMessageContent';
import { hyperOpenBotFetch, HYPER_OPENBOT_ORIGIN } from './transport';
function HyperMessageAttachmentItem({ file }: { file: HyperMessageAttachment }) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController(); let objectUrl: string | undefined;
    if (file.image) void hyperOpenBotFetch(`${HYPER_OPENBOT_ORIGIN}/api/attachments/${encodeURIComponent(file.id)}`, { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error('Image unavailable'); const blob = await response.blob(); controller.signal.throwIfAborted(); objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(error => { if (!controller.signal.aborted) setError(String(error)); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id, file.image]);
  async function download() {
    try { const response = await hyperOpenBotFetch(`${HYPER_OPENBOT_ORIGIN}/api/attachments/${encodeURIComponent(file.id)}`); if (!response.ok) throw new Error('Attachment unavailable'); const objectUrl = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = objectUrl; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }
    catch (error) { setError(String(error)); }
  }
  return <li className="rounded-lg border border-border bg-muted p-2 text-sm">{url && <img src={url} alt={file.name} className="mb-2 max-h-64 max-w-full rounded-md object-contain" />}<div className="flex items-center gap-2"><FileText className="size-4" /><span className="truncate">{file.name}</span><Button variant="ghost" size="icon-xs" aria-label={`Download ${file.name}`} onClick={() => void download()}><Download /></Button></div>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</li>;
}
export function HyperMessageAttachments({ attachments }: { attachments: readonly HyperMessageAttachment[] }) { return <ul aria-label="Message attachments" className="flex flex-wrap gap-2">{attachments.map(file => <HyperMessageAttachmentItem key={file.id} file={file} />)}</ul>; }
