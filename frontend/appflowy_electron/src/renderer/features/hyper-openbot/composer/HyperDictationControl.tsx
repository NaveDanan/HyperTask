import { HyperLiveDictation, liveDictationSource } from './HyperLiveDictation';
// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted from app/src/components/channels/composer/composer.tsx.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { HyperDictationSession } from './HyperDictationSession';
import { recordingSupported, startRecording, transcribeRecording } from './HyperDictationRecording';
import { hyperOpenBotRequest } from '../transport';
export function HyperDictationControl({ disabled, onText, onLiveStart, onLiveText, registerStop }: { disabled: boolean; onText: (text: string) => void; onLiveStart?: () => void; onLiveText?: (text: string) => void; registerStop?: (handler: ((cancel?: boolean) => boolean) | undefined) => void }) {
  const callback = useRef(onText); callback.current = onText;
  const liveCallbacks = useRef({ onLiveStart, onLiveText }); liveCallbacks.current = { onLiveStart, onLiveText };
  const [live] = useState(() => new HyperLiveDictation({ source: () => liveDictationSource(), language: () => navigator.language || 'en-US', onStart: () => liveCallbacks.current.onLiveStart?.(), onText: text => liveCallbacks.current.onLiveText?.(text) }));
  const liveState = useSyncExternalStore(live.subscribe, live.getSnapshot);
  const [available, setAvailable] = useState(false);
  const [session] = useState(() => new HyperDictationSession({ record: startRecording, transcribe: transcribeRecording, onTranscript: text => callback.current(text) }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => { let current = true; void hyperOpenBotRequest<{ transcription?: boolean }>('/api/capabilities').then(value => { if (current) setAvailable(!!value.transcription); }).catch(() => undefined); return () => { current = false; session.cancel(); }; }, [session]);
  useEffect(() => { if (disabled) session.cancel(); }, [disabled, session]);
  useEffect(() => { registerStop?.(cancel => { if (live.active) { if (cancel) live.release(); else live.stop(); return true; } if (session.getSnapshot().phase === 'recording') { if (cancel) session.cancel(); else void session.finish(); return true; } return false; }); return () => { registerStop?.(undefined); live.release(); }; }, [live, session, registerStop]);
  useEffect(() => { if (disabled) live.release(); }, [disabled, live]);
  if (!available) return liveDictationSource() ? <div className="flex gap-2"><Button type="button" disabled={disabled} variant="ghost" onClick={() => live.active ? live.stop() : void live.start()}>{live.active ? 'Stop dictation' : 'Dictate'}</Button>{liveState.phase === 'error' && <p role="alert">{liveState.error}</p>}</div> : null;
  if (!recordingSupported()) return null;
  return <div className="flex flex-wrap items-center gap-2" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); session.cancel(); } }}>
    {state.phase === 'recording' ? <><span role="status">Recording · {state.seconds}s</span><Button type="button" variant="outline" onClick={() => void session.finish()}>Use recording</Button></> : state.phase === 'requesting' || state.phase === 'transcribing' ? <span role="status">{state.phase === 'requesting' ? 'Waiting for microphone…' : 'Transcribing…'}</span> : <Button type="button" variant="ghost" disabled={disabled} onClick={() => void session.start()}>Dictate</Button>}
    {state.phase !== 'idle' && <Button type="button" variant="ghost" onClick={session.cancel}>Cancel recording</Button>}
    {state.phase === 'error' && <><p role="alert">{state.error}</p>{state.canRetry && <Button type="button" variant="outline" onClick={() => void session.retry()}>Retry transcription</Button>}</>}
  </div>;
}
