import { useEffect, useRef, useState } from 'react';
import { A2uiSurface, type ReactCatalogComponent } from '@a2ui/react';
import { MessageProcessor, type ActionPayload } from '@a2ui/web_core/v1_0';
import { HyperBotA2uiActionSchema, type HyperBotA2uiMessage } from '@shared/HyperBotA2ui';
import type { HyperBotsApi } from '@shared/HyperBots';
import { hyperBotA2uiReactCatalog } from './HyperBotA2uiCatalog';

type Props = {
  roomId: string;
  messageId: string;
  messages: HyperBotA2uiMessage[];
  onAction?: HyperBotsApi['act'];
};

export function HyperBotA2ui({ roomId, messageId, messages, onAction }: Props) {
  const [processor, setProcessor] = useState<MessageProcessor<ReactCatalogComponent> | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const retry = useRef<{ key: string; clientMessageId: string } | null>(null);
  const active = useRef(false);
  const onActionRef = useRef(onAction);
  useEffect(() => { onActionRef.current = onAction; }, [onAction]);

  // Snapshot refreshes copy saved messages. Keep the rendered data model and input edits when the wire data is identical.
  const wire = JSON.stringify(messages);
  useEffect(() => {
    let mounted = true;
    const dispatch = async ({ name, surfaceId, sourceComponentId, context }: ActionPayload) => {
      const submit = onActionRef.current;
      if (!submit || active.current) return;
      const parsed = HyperBotA2uiActionSchema.safeParse({ name, surfaceId, sourceComponentId, context });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'This selection could not be sent.');
        return;
      }
      const action = parsed.data;
      const key = JSON.stringify(action);
      const clientMessageId = retry.current?.key === key ? retry.current.clientMessageId : crypto.randomUUID();
      retry.current = { key, clientMessageId };
      active.current = true;
      setSending(true);
      setError(undefined);
      try {
        const result = await submit({ roomId, messageId, clientMessageId, action });
        if (result.ok) retry.current = null;
        else if (mounted) setError(result.message);
      } catch {
        if (mounted) setError('The selection could not be sent. Try again.');
      } finally {
        active.current = false;
        if (mounted) setSending(false);
      }
    };

    const next = new MessageProcessor<ReactCatalogComponent>([hyperBotA2uiReactCatalog], dispatch);
    try {
      next.processMessages(JSON.parse(wire));
      setProcessor(next);
    } catch {
      setProcessor(null);
      setError('This interactive reply could not be displayed.');
    }
    return () => { mounted = false; next.dispose(); };
  }, [wire, roomId, messageId]);

  if (!processor && !error) return null;
  return <div className="hyper-bot-a2ui" aria-busy={sending}>
    <div className="hyper-bot-a2ui__surfaces" inert={!onAction}>
      {Array.from(processor?.getSurfaces().values() ?? [], surface => <A2uiSurface key={surface.id} surface={surface} />)}
    </div>
    {sending && <p className="hyper-bot-a2ui__status" role="status">Sending selection…</p>}
    {error && <p className="hyper-bot-a2ui__status is-error" role="alert">{error}</p>}
  </div>;
}
