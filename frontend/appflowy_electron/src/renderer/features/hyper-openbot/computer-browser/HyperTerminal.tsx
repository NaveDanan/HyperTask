// Adapted from OpenBot components/computer/live-terminal.tsx. Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { HyperOpenBotSocket } from '../socket';
import { connectScreen, type ScreenSocket } from './HyperScreenConnection';
import { hyperComputerPath } from './HyperComputerApi';

/** Inert terminal fallback while xterm is absent from HyperTask's locked dependencies. */
export function HyperTerminal({ computerId, driving }: { computerId: string; driving: boolean }) {
  const [output, setOutput] = useState(''); const [problem, setProblem] = useState<string | null>(null); const [retry, setRetry] = useState(0);
  const socket = useRef<HyperOpenBotSocket | undefined>(undefined); const allowed = useRef(driving); allowed.current = driving;
  const host = useRef<HTMLPreElement>(null);
  useEffect(() => {
    setOutput(''); const decoder = new TextDecoder(); let live = false;
    const send = (value: unknown) => { if (socket.current?.readyState === 1) socket.current.send(JSON.stringify(value)); };
    const resize = () => { const box = host.current; if (live && box) send({ type: 'resize', cols: Math.max(2, Math.floor(box.clientWidth / 8)), rows: Math.max(2, Math.floor(box.clientHeight / 18)) }); };
    const observer = new ResizeObserver(resize); if (host.current) observer.observe(host.current);
    const connection = connectScreen({ open: () => { const opened = new HyperOpenBotSocket(`wss://hyper-openbot.invalid${hyperComputerPath(computerId)}/terminal`); opened.binaryType = 'arraybuffer'; socket.current = opened; return { set onopen(callback: ScreenSocket["onopen"]) { opened.onopen = callback ? () => { void callback(); } : null; }, set onclose(callback: ScreenSocket["onclose"]) { opened.onclose = callback; }, set onerror(callback: ScreenSocket["onerror"]) { opened.onerror = callback; }, set onmessage(callback: ScreenSocket["onmessage"]) { opened.onmessage = callback; }, close: () => opened.close() }; }, verifyOwnership: async () => true, onReady: () => {}, onProblem: setProblem, onDisconnect: () => { live = false; }, disconnected: 'The terminal is disconnected. Retry to reconnect.', onMessage: event => {
      if (event.data instanceof ArrayBuffer) { const bytes = new Uint8Array(event.data); const text = decoder.decode(bytes, { stream: true }); setOutput(previous => (previous + text).slice(-500000)); send({ type: 'ack', bytes: bytes.byteLength }); return; }
      try { const message = JSON.parse(String(event.data)); if (message?.type === 'snapshot') setOutput(''); if (message?.type === 'ready') { live = true; resize(); } } catch { /* Ignore malformed control messages. */ }
    } });
    return () => { connection.stop(); observer.disconnect(); socket.current = undefined; };
  }, [computerId, retry]);
  function send(data: string) { if (allowed.current && socket.current?.readyState === 1) socket.current.send(JSON.stringify({ type: 'input', data })); }
  return <div className="space-y-2">{problem && <p role="alert">{problem}<Button onClick={() => setRetry(n => n + 1)}>Retry</Button></p>}
    <p className="text-sm text-muted-foreground">Plain terminal output. Full terminal emulation requires the upstream xterm dependency.</p>
    <pre ref={host} tabIndex={0} aria-label="Computer terminal" className="h-80 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted p-3 font-mono text-xs" onPaste={event => { if (!driving) return; event.preventDefault(); send(event.clipboardData.getData('text')); }} onKeyDown={event => {
      if (!driving || event.key === 'Escape' || event.key === 'Tab') return;
      const keys: Record<string, string> = { Enter: '\r', Backspace: '\x7f', ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D', Delete: '\x1b[3~', Home: '\x1b[H', End: '\x1b[F' };
      const data = (event.ctrlKey || event.metaKey) && /^[a-z]$/i.test(event.key) ? String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64) : keys[event.key] ?? (event.key.length === 1 ? event.key : ''); if (data) { event.preventDefault(); send(data); }
    }}>{output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')}</pre>
  </div>;
}
