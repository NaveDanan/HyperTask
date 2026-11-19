import { useRef, useState, useSyncExternalStore, type ClipboardEvent } from 'react';
import { Paperclip, X } from 'lucide-react';
import { HYPER_BOT_ATTACHMENT_BYTES, HYPER_BOT_ATTACHMENT_COUNT, HYPER_BOT_ATTACHMENT_TYPES, type HyperBotUpload } from '@shared/HyperBots';
import type { HyperBotsOutbox } from './HyperBotsController';

const accept = HYPER_BOT_ATTACHMENT_TYPES.join(',') + ',.txt,.md,.csv,.json,.log';

function fileType(file: File): HyperBotUpload['type'] | undefined {
  if (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp') return file.type;
  if (file.type === 'text/plain' || /\.(txt|md|csv|json|log)$/i.test(file.name)) return 'text/plain';
  return undefined;
}

export function useHyperBotAttachments(outbox: HyperBotsOutbox, roomId: string, disabled: boolean) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attachments = useSyncExternalStore(outbox.subscribe, () => outbox.attachments(roomId), () => undefined);
  async function add(files: File[]) {
    if (disabled || !files.length || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const existing = outbox.attachments(roomId) ?? [];
      if (existing.length + files.length > HYPER_BOT_ATTACHMENT_COUNT) throw new Error('Attach up to four files per message.');
      const added = await Promise.all(files.map(async file => {
        const type = fileType(file);
        if (!type) throw new Error('Choose a PNG, JPEG, WebP, or plain-text file.');
        if (!file.size || file.size > HYPER_BOT_ATTACHMENT_BYTES) throw new Error('Each file must be between 1 byte and 2 MiB.');
        return { name: file.name, type, data: new Uint8Array(await file.arrayBuffer()) };
      }));
      outbox.setAttachments(roomId, [...existing, ...added]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read the attachment.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled || !event.clipboardData.files.length) return;
    if (!event.clipboardData.getData('text/plain')) event.preventDefault();
    void add(Array.from(event.clipboardData.files));
  };
  return {
    hasFiles: Boolean(attachments?.length),
    busy,
    paste,
    picker: <>
      <input type="file" ref={input} hidden accept={accept} multiple onChange={event => {
        void add(Array.from(event.target.files ?? []));
        event.target.value = '';
      }} />
      <button type="button" className="composer__btn" aria-label="Attach files" title="Attach files" disabled={disabled || busy} onClick={() => input.current?.click()}><Paperclip size={16} /></button>
    </>,
    list: <>
      {attachments?.length ? <ul aria-label="Attachments" className="flex flex-wrap gap-2 px-2 pb-2 text-xs">{attachments.map((file, index) => <li key={index} className="flex max-w-full items-center gap-1 rounded-md border border-border px-2 py-1">
        <span className="truncate">{file.name}</span><button type="button" aria-label={'Remove ' + file.name} disabled={disabled || busy} onClick={() => outbox.setAttachments(roomId, attachments.filter((_, row) => row !== index))}><X size={14} /></button>
      </li>)}</ul> : null}
      {error && <p role="alert" className="notice is-error">{error}</p>}
    </>,
  };
}
