// Adapted from OpenBot components/computer/live-screen and lib/computers/screen-connection.
// Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { HyperOpenBotSocket } from '../socket';
import { hyperOpenBotRequest } from '../transport';
import { hyperComputerPath, hyperReadControl } from './HyperComputerApi';
import { connectScreen } from './HyperScreenConnection';
export function HyperLiveScreen({ computerId, driving }: { computerId: string; driving: boolean }) {
  const [frame, setFrame] = useState<{ data: string; width: number; height: number }>();
  const [error, setError] = useState<string | null>(null); const [retry, setRetry] = useState(0);
  const queue = useRef(Promise.resolve());
  const allowed = useRef(driving); allowed.current = driving;
  const generation = useRef(0);
  useEffect(() => {
    generation.current++; setError(null); setFrame(undefined); let socket: HyperOpenBotSocket; let confirm = false;
    const connection = connectScreen({
      open: () => { socket = new HyperOpenBotSocket(`wss://hyper-openbot.invalid${hyperComputerPath(computerId)}/stream`); return socket; },
      verifyOwnership: async () => { const control = await hyperReadControl(computerId); return control.holder === 'human' && !control.transitioning; }, onReady: () => {}, onDisconnect: () => setFrame(undefined), onProblem: setError,
      onMessage: event => { try {
        const message = JSON.parse(String(event.data));
        if (!message || typeof message !== 'object') return;
        if (message.type === 'hello') confirm = message.confirmFrames === true;
        if (message.type === 'error' || message.type === 'input-error') setError(typeof message.error === 'string' ? message.error : 'Screen unavailable.');
        if (message.type !== 'frame') return;
        if (confirm && socket.readyState === 1) socket.send('{"type":"frame-received"}');
        if (typeof message.data !== 'string' || message.data.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(message.data)) return;
        const width = message.width ?? 1280, height = message.height ?? 720;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384) return;
        setFrame({ data: message.data, width, height });
      } catch { /* Ignore malformed frames. */ } },
    });
    return () => { generation.current++; connection.stop(); };
  }, [computerId, retry]);
  function input(kind: string, body: unknown) {
    if (!allowed.current) return;
    const epoch = generation.current;
    queue.current = queue.current.then(async () => { if (!allowed.current || epoch !== generation.current) return; await hyperOpenBotRequest(`${hyperComputerPath(computerId)}/human/${kind}`, 'POST', body); }).catch(() => { setError('Input did not reach the computer.'); });
  }
  return <div className="flex flex-col gap-2">
    {error && <p role="alert">{error} <Button variant="outline" onClick={() => setRetry(n => n + 1)}>Retry</Button></p>}
    {!frame && !error && <p role="status">Connecting to live screen…</p>}
    {frame && <img src={`data:image/jpeg;base64,${frame.data}`} alt="Live computer screen" className="w-full rounded-lg border" tabIndex={driving ? 0 : -1}
      onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); input('click', { x: (event.clientX - rect.left) * frame.width / rect.width, y: (event.clientY - rect.top) * frame.height / rect.height }); event.currentTarget.focus(); }}
      onKeyDown={event => { if (!driving || event.key === 'Tab') return; event.preventDefault(); input(event.key.length === 1 && !event.ctrlKey && !event.metaKey ? 'type' : 'key', event.key.length === 1 && !event.ctrlKey && !event.metaKey ? { text: event.key } : { key: event.key }); }} />}
  </div>;
}
