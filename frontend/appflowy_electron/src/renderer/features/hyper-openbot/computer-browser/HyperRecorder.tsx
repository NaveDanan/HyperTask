// Adapted from OpenBot lib/recorder queries/mutations and settings/browsers. Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperOpenBotRequest } from '../transport';
import { findRecorderHere, sendConnectCode, sendRecorderPage, askConnectWait, connectRefusalSentence, CONFIRM_WINDOW_MS, type RecorderHere } from './HyperRecorderBridge';
export type HyperRecordingsPage = { recordings: { id: string; title: string | null; recordedAt: string; ended: string; reason: string | null }[]; nextCursor: string | null; unavailable?: string };
export const hyperReadRecordings = (cursor = '') => hyperOpenBotRequest<HyperRecordingsPage>(`/api/recorder/recordings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
class HyperRecorderConnectRefusal extends Error {}
export async function hyperConnectRecorder(id: string) {
  const { code } = await hyperOpenBotRequest<{ code: string }>('/api/recorder/connect-codes', 'POST', { via: 'web' });
  const answer = await sendConnectCode(id, code);
  if (!answer.ok) throw new HyperRecorderConnectRefusal(connectRefusalSentence(answer.error, answer.retryAfterMs));
  return answer;
}
export function HyperRecorder() {
  const [here, setHere] = useState<RecorderHere>(); const [title, setTitle] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState<HyperRecordingsPage[]>([]); const pagesRef = useRef(pages); pagesRef.current = pages;
  const revision = useRef(0);
  const waiting = useRef<{ id: string; since: number } | null>(null);
  async function refreshHere() { const data = await hyperOpenBotRequest<{ extensionIds: string[] }>('/api/recorder/connections'); setHere(await findRecorderHere(data.extensionIds)); }
  useEffect(() => { let live = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() { try {
      const data = await hyperOpenBotRequest<{ extensionIds: string[] }>('/api/recorder/connections'); const next = await findRecorderHere(data.extensionIds); if (!live) return; setHere(next);
      if (waiting.current) { const pending = waiting.current; const status = await askConnectWait(pending.id); if (!live) return; if (next.kind === 'connected') { waiting.current = null; setNotice('Browser connected.'); } else if (['cancelled', 'closed', 'none'].includes(status) || Date.now() - pending.since >= CONFIRM_WINDOW_MS) { waiting.current = null; setNotice('Connection was cancelled, closed or expired. Try connecting again.'); } }
    } catch { if (live) setError('Recorder status could not be loaded.'); } finally { if (live) timer = setTimeout(() => void poll(), 2000); } }
    void poll(); return () => { live = false; clearTimeout(timer); };
  }, []);
  useEffect(() => { let live = true; let timer: ReturnType<typeof setTimeout>; async function poll() { const version = revision.current; try { const loaded: HyperRecordingsPage[] = []; let cursor = ''; for (let index = 0; index < Math.max(1, pagesRef.current.length); index++) { const page = await hyperReadRecordings(cursor); loaded.push(page.unavailable ? { ...page, recordings: pagesRef.current[index]?.recordings || [] } : page); if (!page.nextCursor || page.unavailable) break; cursor = page.nextCursor; } if (live && version === revision.current) setPages(loaded); } catch { if (live) setError('Recordings could not be loaded. Retry.'); } finally { if (live) timer = setTimeout(() => void poll(), 10000); } } void poll(); return () => { live = false; clearTimeout(timer); }; }, []);
  async function act(action: () => Promise<unknown>) { if (busy) return; setBusy(true); setError(''); try { await action(); await refreshHere(); } catch (error) { setError(error instanceof HyperRecorderConnectRefusal ? error.message : 'Recorder request failed or was refused. Please retry.'); } finally { setBusy(false); } }
  const connected = here?.kind === 'connected' ? here : undefined; const recording = connected?.state.phase === 'recording'; const last = pages.at(-1);
  return <section className="space-y-3 rounded-lg border p-4"><h3 className="font-semibold">Recorder</h3>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{!here && <p>Finding Recorder…</p>}
    {here?.kind === 'unreachable' && <p>This desktop window cannot reach browser extensions. Open OpenBot in your browser to connect its Recorder. No Recorder store page is published for this environment.</p>}
    {here?.kind === 'absent' && <Button variant="outline" onClick={() => void window.appflowy.shell.openExternal(here.page)}>Add Recorder in browser</Button>}
    {here?.kind === 'older' && <p>Update the Recorder in your browser to control it here.</p>}
    {here?.kind === 'unconnected' && <Button disabled={busy} onClick={() => void act(async () => { const since = Date.now(); const answer = await hyperConnectRecorder(here.id); if (answer.awaitingConfirmation) { waiting.current = { id: here.id, since }; setNotice('Confirm the connection in the Recorder tab.'); } })}>Connect this browser</Button>}
    {connected && <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void act(async () => { const answer = await sendRecorderPage(connected.id, recording ? { type: 'openbot.stop' } : { type: 'openbot.record', title: title.trim(), narrate: false }); if (!answer) throw new Error('The Recorder did not answer. Try again.'); if (!answer.ok) throw new Error(answer.error); }); }}><Input aria-label="Recorder task title" maxLength={200} disabled={recording || busy} value={title} onChange={e => setTitle(e.target.value)} /><Button disabled={busy || (!recording && !title.trim()) || ['starting', 'stopping'].includes(connected.state.phase)}>{recording ? 'Stop recording' : 'Record this browser'}</Button><span>{connected.state.phase} · {connected.state.actions} actions</span></form>}
    <h4>Your recordings</h4>{pages.length === 0 && <p>Loading recordings…</p>}{pages.length > 0 && pages.every(page => !page.recordings.length) && !last?.unavailable && <p>No recordings yet.</p>}{pages.flatMap(page => page.recordings).filter((row, index, all) => all.findIndex(other => other.id === row.id) === index).map(row => <article key={row.id} className="border-b py-2"><p>{row.title || 'Untitled recording'}</p><p>{new Date(row.recordedAt).toLocaleString()} · {row.ended}</p>{row.reason && <p>{row.reason}</p>}</article>)}{last?.unavailable && <p role="alert">Recording history is unavailable. Loaded recordings are preserved.</p>}
    <Button variant="outline" disabled={busy} onClick={() => void act(async () => { revision.current++; const result = await hyperReadRecordings(last?.unavailable ? pages.at(-2)?.nextCursor || '' : last?.nextCursor || ''); setPages(previous => last?.unavailable ? [...previous.slice(0, -1), result] : last?.nextCursor ? [...previous, result] : [result]); })}>{last?.nextCursor && !last.unavailable ? 'Show more recordings' : 'Refresh recordings'}</Button>
  </section>;
}
