import { useState } from 'react';
import { hyperBotDownload } from './HyperBotDownload';
import { Paperclip } from 'lucide-react';
import type { HyperBotAttachment } from '@shared/HyperBots';

export function HyperBotAttachmentLink({ messageId, file }: { messageId: string; file: HyperBotAttachment }) {
  const [error, setError] = useState(false);
  async function download() {
    setError(false);
    try {
      const result = await window.hypertask.hyperBots.attachment?.({ messageId, attachmentId: file.id });
      if (!result?.ok) throw new Error();
      hyperBotDownload(file.name, new Blob([new Uint8Array(result.value)], { type: file.type }));
    } catch {
      setError(true);
    }
  }
  return <li>
    <button type="button" className="inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-xs hover:underline" onClick={() => void download()}>
      <Paperclip size={13} className="shrink-0" /><span className="truncate">{file.name}</span>
    </button>
    {error && <span role="alert" className="text-xs">Could not download this attachment.</span>}
  </li>;
}
