// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted from app/src/components/channels/composer/composer.tsx.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { HyperLiveDictation, liveDictationSource } from './HyperLiveDictation';
import { HyperDictationSession } from './HyperDictationSession';
import { recordingSupported, startRecording, transcribeRecording } from './HyperDictationRecording';
import { hyperOpenBotRequest } from '../transport';

export interface HyperDictationControlProps {
  disabled: boolean;
  /** Changes when the owner submits, clears or replaces the draft. */
  draftRevision?: number;
  onText: (text: string) => void;
  onLiveStart?: () => void;
  onLiveText?: (text: string) => void;
  registerStop?: (handler: ((cancel?: boolean) => boolean) | undefined) => void;
  /** Includes microphone permission, recording, transcription and live stop grace. */
  onBusyChange?: (busy: boolean) => void;
}
export function HyperDictationControl({ disabled, draftRevision, onText, onLiveStart, onLiveText, registerStop, onBusyChange }: HyperDictationControlProps) {
  const owner = useRef({ mounted: true, disabled, draftRevision }); owner.current.disabled = disabled; owner.current.draftRevision = draftRevision;
  const sessionRevision = useRef(draftRevision);
  const current = () => owner.current.mounted && !owner.current.disabled;
  const acceptsText = () => current() && sessionRevision.current === owner.current.draftRevision;
  const callback = useRef(onText); callback.current = onText;
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const liveCallbacks = useRef({ onLiveStart, onLiveText }); liveCallbacks.current = { onLiveStart, onLiveText };
  const [live] = useState(() => new HyperLiveDictation({
    source: () => liveDictationSource(), language: () => navigator.language || 'en-US',
    onStart: () => { if (acceptsText()) liveCallbacks.current.onLiveStart?.(); },
    onText: text => { if (acceptsText()) liveCallbacks.current.onLiveText?.(text); },
  }));
  const [session] = useState(() => new HyperDictationSession({ record: startRecording, transcribe: transcribeRecording, onTranscript: text => { if (acceptsText()) callback.current(text); } }));
  const liveState = useSyncExternalStore(live.subscribe, live.getSnapshot);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [available, setAvailable] = useState<boolean>();
  const [capabilityError, setCapabilityError] = useState(false);
  const [capabilityRevision, setCapabilityRevision] = useState(0);
  useEffect(() => {
    owner.current.mounted = true;
    return () => { owner.current.mounted = false; session.cancel(); live.release(); };
  }, [session, live]);
  useEffect(() => {
    if (disabled) return;
    let active = true;
    setCapabilityError(false);
    void hyperOpenBotRequest<{ transcription?: boolean }>('/api/capabilities').then(value => {
      if (active && current()) { setAvailable(value.transcription === true); setCapabilityError(false); }
    }).catch(() => { if (active && current()) { setAvailable(false); setCapabilityError(true); } });
    return () => { active = false; };
  }, [disabled, capabilityRevision]);
  useEffect(() => { if (disabled) { session.cancel(); live.release(); } }, [disabled, session, live]);
  useEffect(() => { if (sessionRevision.current !== draftRevision) { session.cancel(); live.release(); } }, [draftRevision, session, live]);
  useEffect(() => { if (available) live.release(); }, [available, live]);
  useEffect(() => {
    registerStop?.(cancel => {
      const busy = live.active || session.getSnapshot().phase !== 'idle';
      if (cancel) { live.release(); session.cancel(); return busy; }
      if (live.active) { live.stop(); return true; }
      if (session.getSnapshot().phase === 'recording') void session.finish();
      return busy;
    });
    return () => { registerStop?.(undefined); };
  }, [live, session, registerStop]);
  useEffect(() => {
    // Subscribe directly so even a Send cached before microphone permission was requested
    // observes the current state. The parent also draws the disabled button from this value.
    const publish = () => busyCallback.current?.(live.active || session.getSnapshot().phase !== 'idle');
    const unlive = live.subscribe(publish), unsession = session.subscribe(publish); publish();
    return () => { unlive(); unsession(); busyCallback.current?.(false); };
  }, [live, session]);
  const act = (handler: () => unknown) => { if (current() && owner.current.draftRevision === draftRevision) void handler(); };
  const start = (handler: () => unknown) => act(() => { sessionRevision.current = owner.current.draftRevision; return handler(); });
  if (available === undefined) return null;
  const retryAvailability = capabilityError && <>
    <p role="alert" className="text-sm text-destructive">Could not check dictation availability.</p>
    <Button type="button" variant="outline" disabled={disabled} onClick={() => act(() => setCapabilityRevision(value => value + 1))}>Retry dictation availability</Button>
  </>;
  if (!available) return <div className="flex flex-wrap items-center gap-2">
    {liveDictationSource() && <Button type="button" disabled={disabled} variant="ghost" onClick={() => live.active ? act(live.stop) : start(live.start)}>{live.active ? 'Stop dictation' : 'Dictate'}</Button>}
    {liveState.phase === 'error' && <p role="alert" className="text-sm text-destructive">{liveState.error}</p>}
    {retryAvailability}
  </div>;
  if (!recordingSupported()) return null;
  return <div className="flex flex-wrap items-center gap-2" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); session.cancel(); } }}>
    {state.phase === 'recording' ? <><span role="status">Recording · {state.seconds}s</span><Button type="button" variant="outline" disabled={disabled} onClick={() => act(session.finish)}>Use recording</Button></> : state.phase === 'requesting' || state.phase === 'transcribing' ? <span role="status">{state.phase === 'requesting' ? 'Waiting for microphone…' : 'Transcribing…'}</span> : <Button type="button" variant="ghost" disabled={disabled} onClick={() => start(session.start)}>Dictate</Button>}
    {state.phase !== 'idle' && <Button type="button" variant="ghost" onClick={session.cancel}>Cancel recording</Button>}
    {state.phase === 'error' && <><p role="alert" className="text-sm text-destructive">{state.error}</p>{state.canRetry && <Button type="button" variant="outline" disabled={disabled} onClick={() => act(session.retry)}>Retry transcription</Button>}</>}
  </div>;
}
