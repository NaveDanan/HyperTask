// Adapted from OpenBot components/browser/use-narration.ts and lib/browser/mutations.ts. Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperOpenBotRequest } from '../transport';
import { hyperBrowserPath } from './HyperComputerApi';
import { browserNarrationDeps, startNarration, type Narration, type NarrationStatus } from './HyperNarration';
import { installOnDeviceSpeech } from './HyperOnDeviceSpeech';
const PHRASE_MAX = 4000;
const allowPost = () => true;
type HyperNarrationScope = { id?: string; live: boolean; allowed: boolean; version: number; canPost: () => boolean };
export function HyperNarrationControl({ agentId, recording, enabled, stopRef, canPost = allowPost, canToggle = allowPost }: { agentId?: string; recording: boolean; enabled: boolean; stopRef: MutableRefObject<(() => Promise<void>) | null>; canPost?: () => boolean; canToggle?: () => boolean }) {
  const [language, setLanguage] = useState(navigator.language || 'en-US');
  const [status, setStatus] = useState<NarrationStatus>({ state: 'muted' }); const [error, setError] = useState(''); const [opening, setOpening] = useState(false);
  // Whether the person asked to listen is independent of starting, listening and network backoff.
  const [wanted, setWanted] = useState(false); const wantedNow = useRef(false);
  const narration = useRef<Narration | null>(null); const queue = useRef(Promise.resolve()); const epoch = useRef(0);
  const scopeRef = useRef<HyperNarrationScope>({ id: agentId, live: true, allowed: recording && enabled, version: 0, canPost });
  if (scopeRef.current.id !== agentId) {
    scopeRef.current.live = false;
    scopeRef.current = { id: agentId, live: true, allowed: recording && enabled, version: 0, canPost };
  }
  const scope = scopeRef.current;
  if (scope.allowed !== (recording && enabled)) scope.version++;
  scope.allowed = recording && enabled; scope.canPost = canPost;
  const version = scope.version;
  const sessionOwner = useRef<HyperNarrationScope | null>(null);
  const valid = (version: number) => scopeRef.current === scope && scope.live && scope.allowed && scope.version === version && scope.canPost();
  async function stop() {
    if (scopeRef.current !== scope) return;
    epoch.current++; wantedNow.current = false; setWanted(false); setOpening(false);
    const current = narration.current; narration.current = null; sessionOwner.current = null;
    // Stop flushes the phrase and its queued posts before Browser sends recording:stop.
    await current?.stop(); await queue.current;
  }
  stopRef.current = stop;
  useEffect(() => { if (!recording || !enabled) { void stop(); setStatus({ state: 'muted' }); } }, [recording, enabled]);
  useEffect(() => {
    scope.live = true; stopRef.current = stop;
    return () => {
      scope.live = false; scope.version++;
      if (sessionOwner.current === scope) { const current = narration.current; narration.current = null; sessionOwner.current = null; void current?.stop(); }
      if (scopeRef.current === scope) { epoch.current++; wantedNow.current = false; stopRef.current = null; }
    };
  }, [agentId, stopRef]);
  function post(body: object, version: number) {
    queue.current = queue.current.then(async () => {
      if (!valid(version)) return;
      await hyperOpenBotRequest(`${hyperBrowserPath(agentId)}/narration`, 'POST', { ...body, sentAt: Date.now() });
    }).catch(() => { if (valid(version)) setError('Narration did not reach the Recorder. The recording continues.'); });
  }
  async function listen() {
    if (!valid(version) || !canToggle()) return;
    wantedNow.current = true; setWanted(true); setError(''); setOpening(true);
    const generation = ++epoch.current; const deps = browserNarrationDeps();
    try {
      await installOnDeviceSpeech(deps.Recognition, language);
      if (generation !== epoch.current || !wantedNow.current || !valid(version)) return;
      sessionOwner.current = scope;
      narration.current = startNarration({ language, muted: false,
        phrase: phrase => post({ ...phrase, text: phrase.text.slice(0, PHRASE_MAX) }, version),
        speaking: since => post(since === null ? { speaking: false } : { speaking: true, since }, version),
        status: next => {
          if (!valid(version)) return;
          setStatus(next);
          if (next.state === 'failed' && next.problem !== 'network') { wantedNow.current = false; setWanted(false); }
        },
      }, deps);
    } catch { if (valid(version)) { wantedNow.current = false; setWanted(false); setError('Narration could not start on this device.'); } }
    finally { if (generation === epoch.current && valid(version)) setOpening(false); }
  }
  function toggle() {
    if (!valid(version) || !canToggle()) return;
    if (wantedNow.current) {
      wantedNow.current = false; setWanted(false); epoch.current++; setOpening(false);
      narration.current?.mute(true); setStatus({ state: 'muted' });
    } else if (narration.current) {
      wantedNow.current = true; setWanted(true); narration.current.mute(false);
    } else void listen();
  }
  return <div className="space-y-2"><div className="flex gap-2"><Input aria-label="Narration language" maxLength={35} value={language} disabled={!!narration.current || opening} onChange={e => setLanguage(e.target.value)} /><Button variant="outline" disabled={!recording || !enabled || !language.trim() || !canToggle()} onClick={toggle}>{wanted ? 'Mute narration' : 'Narrate on this device'}</Button></div><p role="status">Narration: {status.state === 'failed' ? status.problem : opening ? 'starting' : status.state}</p>{error && <p role="alert">{error}</p>}</div>;
}
