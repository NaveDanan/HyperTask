// Adapted from OpenBot lib/browser/narration.ts and mutations.ts. Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperOpenBotRequest } from '../transport';
import { hyperBrowserPath } from './HyperComputerApi';
import { browserNarrationDeps, startNarration, type Narration, type NarrationStatus } from './HyperNarration';
import { installOnDeviceSpeech } from './HyperOnDeviceSpeech';
export function HyperNarrationControl({ agentId, recording, enabled }: { agentId?: string; recording: boolean; enabled: boolean }) {
  const [language, setLanguage] = useState(navigator.language || 'en-US'); const [status, setStatus] = useState<NarrationStatus>({ state: 'muted' }); const [error, setError] = useState('');
  const narration = useRef<Narration | null>(null); const queue = useRef(Promise.resolve());
  useEffect(() => { if (!recording || !enabled) { void narration.current?.stop(); narration.current = null; } }, [recording, enabled]);
  useEffect(() => () => { void narration.current?.stop(); narration.current = null; }, [agentId]);
  function post(body: unknown) { queue.current = queue.current.then(async () => { await hyperOpenBotRequest(`${hyperBrowserPath(agentId)}/narration`, 'POST', { ...(body as object), sentAt: Date.now() }); }).catch(() => setError('Narration did not reach the Recorder. The recording continues.')); }
  async function listen() {
    setError(''); const deps = browserNarrationDeps();
    await installOnDeviceSpeech(deps.Recognition, language);
    narration.current = startNarration({ language, muted: false, phrase: phrase => post(phrase), speaking: since => post(since === null ? { speaking: false } : { speaking: true, since }), status: setStatus }, deps);
  }
  return <div className="space-y-2"><div className="flex gap-2"><Input aria-label="Narration language" maxLength={35} value={language} disabled={!!narration.current} onChange={e => setLanguage(e.target.value)} /><Button variant="outline" disabled={!recording || !enabled || !language.trim()} onClick={() => { if (narration.current) { narration.current.mute(status.state === 'listening'); if (status.state !== 'listening') narration.current.mute(false); } else void listen(); }}>{status.state === 'listening' ? 'Mute narration' : 'Narrate on this device'}</Button></div><p role="status">Narration: {status.state === 'failed' ? status.problem : status.state}</p>{error && <p role="alert">{error}</p>}</div>;
}
