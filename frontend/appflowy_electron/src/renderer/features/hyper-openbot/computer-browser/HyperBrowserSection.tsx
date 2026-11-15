// Adapted from OpenBot components/browser/browser-page and computer/bot-browser.
// Copyright (c) 2026 CopilotKit. MIT.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HyperNarrationControl } from './HyperNarrationControl';
import { hyperAddressFrom } from './HyperBrowserAddress';
import { HyperLiveScreen } from './HyperLiveScreen';
import { hyperBrowserAction, hyperReadBrowser, type HyperBrowserState } from './HyperComputerApi';
export function HyperBrowserView({ agentId }: { agentId?: string }) {
  const stopNarration = useRef<(() => Promise<void>) | null>(null);
  const [state, setState] = useState<HyperBrowserState>();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState(''); const [title, setTitle] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [streamRetry, setStreamRetry] = useState(0);
  const screenProblem = useCallback((problem: string | null) => setScreenError(problem), []);
  const [fresh, setFresh] = useState(false);
  const refresh = useCallback(() => hyperReadBrowser(agentId).then(setState), [agentId]);
  useEffect(() => { let active = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() { try { const next = await hyperReadBrowser(agentId); if (active) { setState(next); setFresh(true); setError(''); } } catch { if (active) { setFresh(false); setError('Could not read the browser.'); } } finally { if (active) timer = setTimeout(() => void poll(), 1000); } }
    setState(undefined); void poll(); return () => { active = false; clearTimeout(timer); };
  }, [agentId]);
  async function act(action: Parameters<typeof hyperBrowserAction>[1], body?: unknown) {
    setBusy(true); setError(''); try { if (action === 'recording' && (body as { action?: string })?.action === 'stop') await stopNarration.current?.(); await hyperBrowserAction(agentId, action, body); } catch { setError('The browser could not complete that action. Refresh and try again.'); } finally { try { await refresh(); setFresh(true); } catch { setFresh(false); } setBusy(false); }
  }
  if (!state) return <p role="status">{error || 'Loading browser…'}</p>;
  if (state.available === false) return <p>{state.note || 'The browser is unavailable on this deployment.'}</p>;
  const permitted = fresh && (!agentId || state.mine === true);
  const recording = state.recorder?.phase === 'recording';
  const stopped = state.recorder?.lastStopped;
  return <div className="flex flex-col gap-3">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {state.problem && <p role="alert">{state.problem}</p>}
    {!state.open && !agentId && <Button disabled={busy} onClick={() => void act('open')}>Open browser</Button>}
    <div className="flex flex-wrap gap-2">{state.tabs.map(tab => <div key={tab.id} className="flex gap-1"><Button variant={tab.active ? 'default' : 'outline'} disabled={busy || !permitted} onClick={() => void act('tabs', { action: 'activate', tabId: tab.id })}>{tab.title || tab.url || 'Blank tab'}</Button><Button aria-label="Close tab" variant="ghost" disabled={busy || !permitted} onClick={() => void act('tabs', { action: 'close', tabId: tab.id })}>×</Button></div>)}{state.open && <Button disabled={busy || !permitted} onClick={() => void act('tabs', { action: 'new' })}>New tab</Button>}</div>
    {state.open && <><form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (address.trim()) void act('navigate', { url: hyperAddressFrom(address)! }); }}>
      {(['back', 'forward', 'reload'] as const).map(action => <Button key={action} type="button" variant="outline" disabled={busy || !permitted} onClick={() => void act('navigate', { action })}>{action}</Button>)}
      <Input aria-label="Browser address" placeholder={state.tabs.find(t => t.active)?.url || 'Address'} value={address} onChange={e => setAddress(e.target.value)} maxLength={2000} disabled={!permitted}/><Button type="submit" disabled={busy || !permitted || !address.trim()}>Go</Button></form>
      {screenError && <p role="alert">{screenError}<Button variant="outline" onClick={() => { setScreenError(null); setStreamRetry(value => value + 1); }}>Retry screen</Button></p>}
      {(agentId || state.computerId) && state.shows !== 'native' && <HyperLiveScreen retryKey={streamRetry} computerId={agentId || state.computerId!} driving={permitted} onProblem={screenProblem} />}
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void act('recording', recording ? { action: 'stop' } : { action: 'start', title: title.trim(), ...(!agentId ? { narrate: false } : {}) }); }}><Input aria-label="Recording title" placeholder="What are you teaching?" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} disabled={recording}/><Button type="submit" disabled={busy || state.recorder?.phase === 'starting' || state.recorder?.phase === 'stopping' || !permitted || (!recording && !!state.recordRefused) || (recording ? !!agentId && !state.recordingIsMine : !title.trim())}>{recording ? 'Stop recording' : 'Record'}</Button></form>
      {(agentId || state.narration === 'external') && <HyperNarrationControl stopRef={stopNarration} agentId={agentId} recording={recording} enabled={permitted && (!agentId || !!state.recordingIsMine)} />}
      {state.recordRefused && <p>{state.recordRefused}</p>}{state.recorder && <p className="text-xs text-muted-foreground">{state.recorder.phase} · {state.recorder.actions} actions</p>}
      {stopped && <p role="status">{stopped.discarded ? 'Recording discarded.' : stopped.kept ? 'Recording kept in the browser. It has not been saved yet.' : stopped.retrying || (stopped.sending ? 'Recording is still sending.' : stopped.actions + stopped.phrases === 0 ? 'Nothing was recorded.' : 'Recording sent to your Learning space.')}</p>}
      <div className="flex gap-2"><Button variant="outline" disabled={busy || !permitted} onClick={() => setConfirm(true)}>Clear browser data…</Button>{!agentId && <Button variant="outline" disabled={busy} onClick={() => void act('close')}>Close browser</Button>}</div>
      {confirm && <div role="alertdialog" aria-label="Clear browser data" className="rounded-lg border p-4"><p>This signs the browser out of every site and deletes its cookies, history and saved passwords.</p><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button disabled={busy} onClick={() => { setConfirm(false); void act('clear'); }}>Clear browser</Button></div>}
    </>}
  </div>;
}
export default function HyperBrowserSection({path}: {path?: string}) {
  const match = path ? /^\/bots\/([^/?#]+)\/browser(?:[/?#]|$)/.exec(path) : null;
  let agentId: string | undefined; try { agentId = match ? decodeURIComponent(match[1]) : undefined; } catch { return <p role="alert">Invalid Bot browser destination.</p>; }
 return <section className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6"><h2 className="text-lg font-semibold">Browser</h2><HyperBrowserView key={agentId} agentId={agentId} /></section>; }
