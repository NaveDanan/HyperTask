// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted from app/src/components/channels/composer/composer.tsx.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { HyperDictationSession } from './HyperDictationSession';
import { recordingSupported, startRecording, transcribeRecording } from './HyperDictationRecording';
import { hyperOpenBotRequest } from '../transport';
export function HyperDictationControl({ disabled, onText }: { disabled: boolean; onText: (text: string) => void }) {
  const callback = useRef(onText); callback.current = onText;
  const [available, setAvailable] = useState(false);
  const [session] = useState(() => new HyperDictationSession({ record: startRecording, transcribe: transcribeRecording, onTranscript: text => callback.current(text) }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => { let current = true; void hyperOpenBotRequest<{ transcription?: boolean }>('/api/capabilities').then(value => { if (current) setAvailable(!!value.transcription); }).catch(() => undefined); return () => { current = false; session.cancel(); }; }, [session]);
  useEffect(() => { if (disabled) session.cancel(); }, [disabled, session]);
  if (!available || !recordingSupported()) return null;
  return <div className="flex flex-wrap items-center gap-2" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); session.cancel(); } }}>
    {state.phase === 'recording' ? <><span role="status">Recording · {state.seconds}s</span><Button type="button" variant="outline" onClick={() => void session.finish()}>Use recording</Button></> : state.phase === 'requesting' || state.phase === 'transcribing' ? <span role="status">{state.phase === 'requesting' ? 'Waiting for microphone…' : 'Transcribing…'}</span> : <Button type="button" variant="ghost" disabled={disabled} onClick={() => void session.start()}>Dictate</Button>}
    {state.phase !== 'idle' && <Button type="button" variant="ghost" onClick={session.cancel}>Cancel recording</Button>}
    {state.phase === 'error' && <><p role="alert">{state.error}</p>{state.canRetry && <Button type="button" variant="outline" onClick={() => void session.retry()}>Retry transcription</Button>}</>}
  </div>;
}
