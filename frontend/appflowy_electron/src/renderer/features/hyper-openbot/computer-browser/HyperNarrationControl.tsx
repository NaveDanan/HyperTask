// Adapted from OpenBot lib/browser/narration.ts and mutations.ts. Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperOpenBotRequest } from '../transport';
import { hyperBrowserPath } from './HyperComputerApi';
import { browserNarrationDeps, startNarration, type Narration, type NarrationStatus } from './HyperNarration';
import { installOnDeviceSpeech } from './HyperOnDeviceSpeech';
export function HyperNarrationControl({ agentId, recording, enabled, stopRef }: { agentId?: string; recording: boolean; enabled: boolean; stopRef: MutableRefObject<(() => Promise<void>) | null> }) {
  const [language, setLanguage] = useState(navigator.language || 'en-US'); const [status, setStatus] = useState<NarrationStatus>({ state: 'muted' }); const [error, setError] = useState(''); const [opening, setOpening] = useState(false);
  const narration = useRef<Narration | null>(null); const queue = useRef(Promise.resolve()); const epoch = useRef(0);
  const permitted = useRef(recording && enabled); permitted.current = recording && enabled;
  async function stop() { epoch.current++; const current = narration.current; narration.current = null; await current?.stop(); await queue.current; }
  stopRef.current = stop;
  useEffect(() => { if (!recording || !enabled) { void stop(); setStatus({ state: 'muted' }); } }, [recording, enabled]);
  useEffect(() => () => { void stop(); stopRef.current = null; }, [agentId, stopRef]);
  function post(body: object) { queue.current = queue.current.then(async () => { await hyperOpenBotRequest(`${hyperBrowserPath(agentId)}/narration`, 'POST', { ...body, sentAt: Date.now() }); }).catch(() => setError('Narration did not reach the Recorder. The recording continues.')); }
  async function listen() {
    setError(''); setOpening(true); const generation = ++epoch.current; const deps = browserNarrationDeps();
    await installOnDeviceSpeech(deps.Recognition, language);
    if (generation !== epoch.current || !permitted.current) { setOpening(false); return; }
    narration.current = startNarration({ language, muted: false, phrase: phrase => post(phrase), speaking: since => post(since === null ? { speaking: false } : { speaking: true, since }), status: setStatus }, deps); setOpening(false);
  }
  return <div className="space-y-2"><div className="flex gap-2"><Input aria-label="Narration language" maxLength={35} value={language} disabled={!!narration.current || opening} onChange={e => setLanguage(e.target.value)} /><Button variant="outline" disabled={!recording || !enabled || !language.trim() || opening} onClick={() => { if (narration.current) narration.current.mute(status.state === 'listening'); else void listen(); }}>{status.state === 'listening' ? 'Mute narration' : 'Narrate on this device'}</Button></div><p role="status">Narration: {status.state === 'failed' ? status.problem : opening ? 'starting' : status.state}</p>{error && <p role="alert">{error}</p>}</div>;
}
