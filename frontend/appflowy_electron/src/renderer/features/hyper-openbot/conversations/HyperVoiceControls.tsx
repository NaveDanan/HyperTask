import { connectWebSocket } from './HyperVoiceWebsocket';
// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted from app/src/lib/voice/use-voice-call.ts and components/channels voice controls.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest as request } from '../transport';
import { HyperVoiceSession } from './HyperVoiceSession';
import { connectWebRtc } from './HyperVoiceWebrtc';
import type { SaveHyperVoiceSessionInput, HyperVoiceSessionPage } from './HyperVoiceContracts';
export function HyperVoiceControls({ channelId, disabled, context, askAgent, anchorMessageId }: {
  channelId: string; disabled: boolean; context: () => string;
  askAgent: (text: string, signal: AbortSignal) => Promise<string>; anchorMessageId: () => string | null;
}) {
  const callbacks = useRef({ context, askAgent, anchorMessageId }); callbacks.current = { context, askAgent, anchorMessageId };
  const [available, setAvailable] = useState(false);
  const [unsaved, setUnsaved] = useState<SaveHyperVoiceSessionInput[]>([]);
  const [history, setHistory] = useState<HyperVoiceSessionPage['sessions']>([]);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  async function save(call: SaveHyperVoiceSessionInput) {
    try { await request('/api/voice/sessions', 'POST', call); setUnsaved(value => value.filter(item => item.id !== call.id)); setRevision(value => value + 1); }
    catch { setUnsaved(value => [...value.filter(item => item.id !== call.id), call]); }
  }
  const [session] = useState(() => new HyperVoiceSession({ channelId,
    connect: async options => { const config = await request<{ transport: string }>('/api/voice/config'); if (config.transport === 'webrtc') return connectWebRtc(options); if (config.transport === 'websocket') return connectWebSocket(options); throw new Error('Unsupported voice transport.'); },
    context: () => callbacks.current.context(), askAgent: (text, signal) => callbacks.current.askAgent(text, signal), anchorMessageId: () => callbacks.current.anchorMessageId(), onEnd: call => { void save(call); },
  }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => { let current = true; void request<{ voice?: boolean }>('/api/capabilities').then(value => { if (current) setAvailable(!!value.voice); }).catch(() => undefined); return () => { current = false; session.end(); }; }, [session]);
  useEffect(() => { if (disabled) session.end(); }, [disabled, session]);
  useEffect(() => { if (!available) return; let current = true; void (async () => { try { const result: HyperVoiceSessionPage['sessions'] = []; let cursor: string | null = null; do { const params = new URLSearchParams({ channelId }); if (cursor) params.set('cursor', cursor); const page = await request<HyperVoiceSessionPage>(`/api/voice/sessions?${params}`); result.push(...page.sessions); cursor = page.nextCursor; } while (cursor && current); if (current) { setHistory(result); setError(undefined); } } catch { if (current) setError('Voice history could not be loaded.'); } })(); return () => { current = false; }; }, [available, channelId, revision]);
  if (!available || !navigator.mediaDevices?.getUserMedia) return null;
  const active = state.phase === 'connecting' || state.phase === 'connected';
  return <details className="border-b p-3"><summary>Voice</summary><div className="space-y-2 py-2">
    {active ? <><p role="status">{state.phase} · {state.seconds}s {state.working ? '· Bot working' : ''}</p><Button disabled={state.phase !== 'connected'} variant="outline" onClick={session.mute}>{state.muted ? 'Unmute' : 'Mute'}</Button><Button variant="outline" onClick={session.end}>End call</Button><p className="whitespace-pre-wrap">{state.transcript}</p><p className="whitespace-pre-wrap">{state.reply}</p></> : <Button disabled={disabled} onClick={() => void session.start()}>Start voice call</Button>}
    {state.error && <p role="alert">{state.error}</p>}
    {unsaved.map(call => <div key={call.id}><p role="alert">Voice transcript has not been saved.</p><Button onClick={() => void save(call)}>Retry saving</Button></div>)}
    {error && <p role="alert">{error}<Button variant="ghost" onClick={() => setRevision(value => value + 1)}>Retry</Button></p>}
    {history.map(call => <details key={call.id}><summary>{call.startedAt} · {call.durationSeconds}s</summary>{call.summary && <p>{call.summary}</p>}{call.transcript.map(line => <p key={line.id} className="whitespace-pre-wrap">{line.role}: {line.text}</p>)}</details>)}
  </div></details>;
}
