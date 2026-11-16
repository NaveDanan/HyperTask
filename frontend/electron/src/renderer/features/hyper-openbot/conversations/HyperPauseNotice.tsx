// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest as request } from '../transport';
export function HyperPauseNotice({ botId, enabled }: { botId: string; enabled: boolean }) {
  const [paused, setPaused] = useState(false); const [pending, setPending] = useState(false); const [error, setError] = useState(false);
  useEffect(() => { if (!enabled) return; let current = true; const read = () => { void request<{ lifecycle: { paused: boolean } }>(`/api/bots/${encodeURIComponent(botId)}/lifecycle`).then(value => { if (current) setPaused(value.lifecycle.paused); }).catch(() => {}); }; read(); const timer = setInterval(read, 10_000); return () => { current = false; clearInterval(timer); }; }, [botId, enabled]);
  if (!paused) return null;
  return <div className="border-b p-3"><p>This Bot is paused. Resume it to continue its work.</p><Button disabled={!enabled || pending} onClick={() => { setPending(true); setError(false); void request<{ lifecycle: { paused: boolean } }>(`/api/bots/${encodeURIComponent(botId)}/resume`, 'POST').then(value => setPaused(value.lifecycle.paused)).catch(() => setError(true)).finally(() => setPending(false)); }}>Resume Bot</Button>{error && <p role="alert">Could not resume this Bot. Try again.</p>}</div>;
}
