// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted from app/src/lib/voice/use-voice-call.ts and components/channels voice controls.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest as request } from '../transport';
import { hyperLoadVoiceHistory, hyperSaveVoiceTranscript, hyperVoiceHistoryContext } from './HyperVoiceArchive';
import { forgetVoiceCall, hyperObserveVoiceIdentity, hyperSubscribeVoiceRecovery, hyperVoiceIdentityEpoch, recoverVoiceCalls, rememberVoiceCall } from './HyperVoiceOutbox';
import { HyperVoiceSession } from './HyperVoiceSession';
import { connectWebRtc } from './HyperVoiceWebrtc';
import { connectWebSocket } from './HyperVoiceWebsocket';
import { closingOf } from './HyperVoiceCut';
import type { SaveHyperVoiceSessionInput, HyperVoiceSessionPage } from './HyperVoiceContracts';

type HyperVoiceScope = { channelId: string; epoch: number; mounted: boolean; generation: number; read: number; owner?: string; callOwner?: string; rejected: boolean };
const newScope = (channelId: string): HyperVoiceScope => ({ channelId, epoch: hyperVoiceIdentityEpoch(), mounted: false, generation: 0, read: 0, rejected: false });

export function HyperVoiceControls({ channelId, disabled, canContinue = !disabled, context, askAgent, anchorMessageId, onHistory }: {
  onHistory?: (history: string) => void;
  channelId: string; disabled: boolean; canContinue?: boolean; context: () => string;
  askAgent: (text: string, signal: AbortSignal) => Promise<string>; anchorMessageId: () => string | null;
}) {
  const callbacks = useRef({ context, askAgent, anchorMessageId, onHistory, disabled, canContinue });
  callbacks.current = { context, askAgent, anchorMessageId, onHistory, disabled, canContinue };
  const scopeRef = useRef(newScope(channelId));
  if (scopeRef.current.channelId !== channelId) scopeRef.current = newScope(channelId);
  const scope = scopeRef.current;
  const [available, setAvailable] = useState(false);
  const [unsaved, setUnsaved] = useState<SaveHyperVoiceSessionInput[]>([]);
  const [history, setHistory] = useState<HyperVoiceSessionPage['sessions']>([]);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const valid = () => scopeRef.current === scope && scope.mounted && !scope.rejected && scope.epoch === hyperVoiceIdentityEpoch();
  const assertCurrent = (generation = scope.generation) => {
    if (!valid() || generation !== scope.generation) throw new Error('This voice conversation is no longer current.');
  };
  async function readOwner(generation = scope.generation) {
    assertCurrent(generation);
    const value = await request<{ user: { id: string } }>('/api/me');
    assertCurrent(generation);
    if (!value?.user?.id || typeof value.user.id !== 'string') throw new Error('The signed-in voice owner could not be loaded.');
    if (scope.owner && scope.owner !== value.user.id) {
      scope.rejected = true;
      setUnsaved([]); setHistory([]); callbacks.current.onHistory?.('');
      throw new Error('The voice transcript belongs to another signed-in account.');
    }
    scope.owner = value.user.id;
    setUnsaved(recoverVoiceCalls(channelId, scope.owner, scope.epoch));
    return scope.owner;
  }
  function publishHistory(result: HyperVoiceSessionPage['sessions'], read: number) {
    if (!valid() || read !== scope.read) return;
    setHistory(result);
    callbacks.current.onHistory?.(hyperVoiceHistoryContext(result));
    for (const call of result) forgetVoiceCall(call, scope.owner, scope.epoch);
    setError(undefined);
  }
  async function loadHistory() {
    const generation = scope.generation, read = ++scope.read;
    try {
      await readOwner(generation);
      const result = await hyperLoadVoiceHistory(channelId, () => assertCurrent(generation));
      publishHistory(result, read);
    } catch {
      if (valid() && read === scope.read) setError('Voice history could not be loaded.');
    }
  }
  async function save(call: SaveHyperVoiceSessionInput, userId = scope.callOwner ?? scope.owner) {
    if (!valid() || call.channelId !== channelId) return;
    const generation = scope.generation;
    try {
      // Retry always obtains the current owner. A failed initial actor read cannot freeze recovery.
      userId ??= await readOwner(generation);
      assertCurrent(generation);
      await hyperSaveVoiceTranscript(call, userId, scope.epoch);
      if (valid() && generation === scope.generation) setRevision(value => value + 1);
    } catch {
      if (valid() && generation === scope.generation) setUnsaved(recoverVoiceCalls(channelId, userId, scope.epoch));
    }
  }
  function createSession() {
    return new HyperVoiceSession({ channelId,
      connect: async options => {
        assertCurrent();
        if (callbacks.current.disabled || !callbacks.current.canContinue) throw new Error('Voice calls are unavailable while this conversation is busy.');
        const generation = scope.generation;
        const config = await request<{ transport: string }>('/api/voice/config');
        assertCurrent(generation);
        options.signal.throwIfAborted();
        if (!callbacks.current.canContinue) throw new Error('This voice conversation is no longer current.');
        if (config.transport === 'webrtc') return connectWebRtc(options);
        if (config.transport === 'websocket') return connectWebSocket(options);
        throw new Error('Unsupported voice transport.');
      },
      context: async () => {
        const generation = scope.generation, read = ++scope.read;
        scope.callOwner = await readOwner(generation);
        const result = await hyperLoadVoiceHistory(channelId, () => assertCurrent(generation));
        assertCurrent(generation);
        publishHistory(result, read);
        return [closingOf(hyperVoiceHistoryContext(result), 6000), closingOf(callbacks.current.context(), 6000)].filter(Boolean).join('\n\n');
      },
      askAgent: (text, signal) => { assertCurrent(); return callbacks.current.askAgent(text, signal); },
      anchorMessageId: () => { assertCurrent(); return callbacks.current.anchorMessageId(); },
      onEnd: call => {
        // Capture synchronously before navigation releases the view. Never retry automatically on remount.
        if (!rememberVoiceCall(call, scope.callOwner, scope.epoch)) return;
        if (valid()) void save(call, scope.callOwner);
      },
    });
  }
  const [initialSession] = useState(createSession);
  const sessionRef = useRef({ scope, session: initialSession });
  if (sessionRef.current.scope !== scope) sessionRef.current = { scope, session: createSession() };
  const session = sessionRef.current.session;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    scope.mounted = true; scope.generation++;
    // Like the Home draft observer, this subscription intentionally lasts until renderer exit.
    hyperObserveVoiceIdentity(listener => window.appflowy.hyperOpenBot.service.onState(listener));
    setUnsaved([]); setHistory([]); callbacks.current.onHistory?.('');
    const release = hyperSubscribeVoiceRecovery(() => {
      if (scopeRef.current !== scope || !scope.mounted) return;
      if (scope.epoch !== hyperVoiceIdentityEpoch()) {
        scope.rejected = true; session.end(); setHistory([]); setUnsaved([]); callbacks.current.onHistory?.('');
      } else setUnsaved(recoverVoiceCalls(channelId, scope.owner, scope.epoch));
    });
    return () => { scope.mounted = false; scope.generation++; session.end(); release(); };
  }, [scope, session]);
  useEffect(() => {
    const generation = scope.generation; setAvailable(false);
    void request<{ voice?: boolean }>('/api/capabilities').then(value => { if (valid() && generation === scope.generation) setAvailable(value.voice === true); }).catch(() => undefined);
  }, [scope]);
  useEffect(() => { window.addEventListener('pagehide', session.end); return () => window.removeEventListener('pagehide', session.end); }, [session]);
  useEffect(() => { if (!canContinue) session.end(); }, [canContinue, session]);
  useEffect(() => { void loadHistory(); }, [scope, revision]);
  const active = state.phase === 'connecting' || state.phase === 'connected';
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const currentHistory = scope.owner && !scope.rejected ? history : [];
  const currentUnsaved = scope.owner && !scope.rejected ? unsaved : [];
  return <details className="border-b p-3"><summary>Voice</summary><div className="space-y-2 py-2">
    {active ? <><p role="status">{state.phase} · {state.seconds}s {state.working ? '· Bot working' : ''}</p><Button disabled={state.phase !== 'connected'} variant="outline" onClick={session.mute}>{state.muted ? 'Unmute' : 'Mute'}</Button><Button variant="outline" onClick={session.end}>End call</Button><p className="whitespace-pre-wrap">{state.transcript}</p><p className="whitespace-pre-wrap">{state.reply}</p></> : available && supported && <Button disabled={disabled || !canContinue || scope.rejected} onClick={() => { if (!valid() || callbacks.current.disabled || !callbacks.current.canContinue) return; void session.start(); }}>Start voice call</Button>}
    {state.error && <p role="alert">{state.error}</p>}
    {currentUnsaved.map(call => <div key={call.id}><p role="alert">Voice transcript has not been saved.</p><p className="text-xs text-muted-foreground">Kept for this signed-in renderer session. Retry before closing HyperTask.</p>{call.transcript.map(line => <p key={line.id} className="whitespace-pre-wrap">{line.role}: {line.text}</p>)}<Button onClick={() => void save(call, scope.owner)}>Retry saving</Button></div>)}
    {error && <p role="alert">{error}<Button variant="ghost" onClick={() => { if (valid()) setRevision(value => value + 1); }}>Retry</Button></p>}
    {currentHistory.map(call => <details key={call.id}><summary>{call.startedAt} · {call.durationSeconds}s</summary>{call.summary && <p>{call.summary}</p>}{call.summaryStatus === 'failed' && <div><p>Transcript saved. Its summary is not ready.</p><Button variant="outline" onClick={() => void save({ id: call.id, channelId: call.channelId, anchorMessageId: call.anchorMessageId, startedAt: call.startedAt, endedAt: call.endedAt, transcript: call.transcript }, scope.owner)}>Retry summary</Button></div>}{call.transcript.map(line => <p key={line.id} className="whitespace-pre-wrap">{line.role}: {line.text}</p>)}</details>)}
  </div></details>;
}
