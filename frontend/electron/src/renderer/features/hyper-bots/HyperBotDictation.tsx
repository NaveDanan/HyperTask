import { useEffect, useState, useSyncExternalStore } from 'react';
import { Mic, Square, X } from 'lucide-react';
import { HyperDictationSession } from './HyperDictationSession';
import { recordingSupported, startRecording } from './HyperDictationRecording';
import type { HyperBotsOutbox } from './HyperBotsController';

export function HyperBotDictation({ outbox, roomId, disabled, onBusy }: { outbox: HyperBotsOutbox; roomId: string; disabled: boolean; onBusy: (busy: boolean) => void }) {
  const [session] = useState(() => new HyperDictationSession({
    record: startRecording,
    transcribe: async (audio, signal) => {
      const data = new Uint8Array(await audio.arrayBuffer());
      signal.throwIfAborted();
      const type = audio.type === 'audio/mp4' ? 'audio/mp4' : 'audio/webm';
      const result = await window.hypertask.hyperBots.transcribe?.({ type, data });
      if (!result?.ok) throw new Error(result?.message ?? 'Dictation is unavailable.');
      return result.value;
    },
    onTranscript: text => {
      const draft = outbox.draft(roomId);
      outbox.setDraft(roomId, (draft + (draft ? ' ' : '') + text).slice(0, 20_000));
    },
  }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => session.cancel, [session]);
  useEffect(() => session.subscribe(() => {
    const phase = session.getSnapshot().phase;
    onBusy(phase === 'requesting' || phase === 'recording' || phase === 'transcribing');
  }), [session, onBusy]);
  if (typeof window === 'undefined' || !recordingSupported() || !window.hypertask?.hyperBots.transcribe) return null;
  const recording = state.phase === 'recording';
  const pending = state.phase === 'requesting' || state.phase === 'transcribing';
  return <span className="flex items-center gap-1">
    <button type="button" className="composer__btn" disabled={disabled || pending} aria-label={recording ? 'Finish dictation' : 'Dictate message'} title={recording ? 'Finish dictation' : 'Dictate via the configured AI endpoint'} onClick={() => recording ? void session.finish() : void session.start()}>{recording ? <Square size={15} /> : <Mic size={16} />}</button>
    {(recording || pending) && <button type="button" className="composer__btn" aria-label="Cancel dictation" onClick={session.cancel}><X size={15} /></button>}
    {pending && <span role="status" className="sr-only">{state.phase === 'requesting' ? 'Waiting for microphone' : 'Transcribing recording'}</span>}
    {state.canRetry && <button type="button" className="text-xs underline" disabled={disabled} onClick={() => void session.retry()}>Retry</button>}
    {state.error && <span role="alert" className="text-xs text-destructive">{state.error}</span>}
  </span>;
}
