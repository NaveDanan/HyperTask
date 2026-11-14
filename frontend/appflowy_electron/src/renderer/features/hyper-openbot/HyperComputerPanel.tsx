// Adapted from OpenBot computer screen polling. Copyright (c) 2026 CopilotKit, MIT.
import { useEffect, useState } from 'react';
import { HyperComputerDetail, type HyperToolStep } from './activity';
import { readScreenshot } from './HyperComputerScreen';
import { hyperOpenBotRequest } from './transport';
export function HyperComputerPanel({ botId, steps }: { botId: string; steps: readonly HyperToolStep[] }) {
  const [screen, setScreen] = useState<string>();
  const [status, setStatus] = useState('Loading computer…');
  const [error, setError] = useState<string>();
  useEffect(() => {
    let current = true; let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const status = await hyperOpenBotRequest<{ state: string }>(`/api/computers/${encodeURIComponent(botId)}/status`);
        if (!current) return;
        setStatus(status.state === 'absent' ? 'Computer is asleep. It starts when the Bot uses it.' : status.state === 'starting' ? 'Computer is starting…' : status.state === 'ready' ? 'Computer screen' : 'Computer is unavailable.');
        if (status.state === 'ready') {
          const read = await readScreenshot(encodeURIComponent(botId)); if (!current) return;
          setScreen(read.frame ? `data:image/png;base64,${read.frame.base64}` : undefined); setError(read.error);
        } else setScreen(undefined);
      } catch (error) { if (current) setError(String(error)); }
      finally { if (current) timer = setTimeout(() => void refresh(), 2500); }
    }
    void refresh(); return () => { current = false; clearTimeout(timer); };
  }, [botId]);
  return <div className="max-h-96 overflow-y-auto p-4"><HyperComputerDetail title={status} steps={steps} screenshotUrl={screen} error={error} /></div>;
}
