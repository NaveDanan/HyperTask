// Adapted from OpenBot components/browser/browser-page and computer/bot-browser.
// Copyright (c) 2026 CopilotKit. MIT.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HyperNarrationControl } from './HyperNarrationControl';
import { hyperAddressFrom } from './HyperBrowserAddress';
import { HyperLiveScreen } from './HyperLiveScreen';
import { hyperBrowserAction, hyperReadBrowser, type HyperBrowserState } from './HyperComputerApi';
import { hyperComputerPermits, hyperReadComputerActor, useHyperComputerControl, type HyperComputerAuthority } from './HyperComputerControl';

type HyperBrowserScope = { id?: string; live: boolean; state?: HyperBrowserState; fresh: boolean; version: number; reads: number; busy: boolean };
const browserScopeKey = (state?: HyperBrowserState) => JSON.stringify([state?.open, state?.tabs.find(t => t.active)?.id, state?.mine, state?.recordingIsMine, state?.recorder?.phase]);
export function HyperBrowserView({ agentId, authority: supplied }: { agentId?: string; authority?: HyperComputerAuthority }) {
  const authority = useHyperComputerControl(agentId, supplied);
  const stopNarration = useRef<(() => Promise<void>) | null>(null);
  const [state, setState] = useState<HyperBrowserState>();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState(''); const [title, setTitle] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [streamRetry, setStreamRetry] = useState(0);
  const screenProblem = useCallback((problem: string | null) => setScreenError(problem), []);
  const scopeRef = useRef<HyperBrowserScope>({ id: agentId, live: true, fresh: false, version: 0, reads: 0, busy: false });
  if (scopeRef.current.id !== agentId) {
    scopeRef.current.live = false;
    scopeRef.current = { id: agentId, live: true, fresh: false, version: 0, reads: 0, busy: false };
  }
  const scope = scopeRef.current;
  const live = () => scopeRef.current === scope && scope.live;
  function accept(next?: HyperBrowserState) {
    if (!live()) return;
    if (browserScopeKey(next) !== browserScopeKey(scope.state) || !scope.fresh) {
      scope.version++; setAddress(''); setConfirm(false);
    }
    scope.state = next; scope.fresh = !!next; setState(next);
  }
  useEffect(() => {
    scope.live = true; setState(undefined); setAddress(''); setTitle(''); setConfirm(false); setBusy(false);
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const sequence = ++scope.reads;
      try { const next = await hyperReadBrowser(agentId); if (live() && sequence === scope.reads && !scope.busy) { accept(next); setError(''); } }
      catch { if (live() && sequence === scope.reads && !scope.busy) { accept(); setError('Could not read the browser.'); } }
      finally { if (live()) timer = setTimeout(() => void poll(), 1000); }
    }
    void poll(); return () => { scope.live = false; scope.version++; clearTimeout(timer); };
  }, [agentId]);
  useEffect(() => { setAddress(''); setConfirm(false); }, [authority.key]);
  const version = scope.version;
  const current = () => live() && scope.version === version && authority.current();
  const permittedNow = () => current() && scope.fresh && !!authority.actor && (!agentId || (scope.state?.mine === true && hyperComputerPermits(authority.control, authority.actor, 'drive')));
  const canInput = () => permittedNow() && !scope.busy && (!agentId || authority.canDrive());
  async function act(action: Parameters<typeof hyperBrowserAction>[1], body?: unknown) {
    if (!canInput()) return;
    const recordingAction = action === 'recording' ? (body as { action?: string })?.action : undefined;
    if (recordingAction === 'stop' && agentId && !scope.state?.recordingIsMine) return;
    if (recordingAction === 'start' && (scope.state?.recordRefused || ['starting', 'recording', 'stopping'].includes(scope.state?.recorder?.phase ?? '') || !(body as { title?: string })?.title?.trim())) return;
    scope.busy = true; scope.reads++; setBusy(true); setError('');
    const valid = () => current() && scope.fresh;
    let changed = false;
    const write = async () => {
      if (recordingAction === 'stop') await stopNarration.current?.();
      if (!valid()) return;
      // The active tab and recording owner must still be the ones the person acted on.
      const next = await hyperReadBrowser(agentId);
      if (!valid()) return;
      if (browserScopeKey(next) !== browserScopeKey(scope.state)) { accept(next); return; }
      await hyperBrowserAction(agentId, action, body); changed = true;
      if (current() && action === 'navigate' && (body as { url?: string })?.url) setAddress('');
    };
    try {
      if (agentId) await authority.run('drive', write, valid);
      else {
        // The own-browser API is authenticated per person and does not use a Bot handoff.
        const actor = await hyperReadComputerActor();
        if (valid() && actor === authority.actor) await write();
      }
    } catch { if (current()) setError('The browser could not complete that action. Refresh and try again.'); }
    finally {
      if (current()) {
        try { const next = await hyperReadBrowser(agentId); if (current()) accept(next); }
        catch { if (current()) accept(); }
      }
      if (live()) { scope.busy = false; setBusy(false); }
    }
    return changed;
  }
  if (!state || scope.state !== state) return <p role="status">{error || 'Loading browser…'}</p>;
  if (state.available === false) return <p>{state.note || 'The browser is unavailable on this deployment.'}</p>;
  const permitted = canInput();
  const recording = state.recorder?.phase === 'recording';
  const stopped = state.recorder?.lastStopped;
  return <div className="flex flex-col gap-3">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {state.problem && <p role="alert">{state.problem}</p>}
    {!state.open && !agentId && <Button disabled={busy || !permitted} onClick={() => void act('open')}>Open browser</Button>}
    <div className="flex flex-wrap gap-2">{state.tabs.map(tab => <div key={tab.id} className="flex gap-1"><Button variant={tab.active ? 'default' : 'outline'} disabled={busy || !permitted} onClick={() => void act('tabs', { action: 'activate', tabId: tab.id })}>{tab.title || tab.url || 'Blank tab'}</Button><Button aria-label="Close tab" variant="ghost" disabled={busy || !permitted} onClick={() => void act('tabs', { action: 'close', tabId: tab.id })}>×</Button></div>)}{state.open && <Button disabled={busy || !permitted} onClick={() => void act('tabs', { action: 'new' })}>New tab</Button>}</div>
    {state.open && <><form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (address.trim()) void act('navigate', { url: hyperAddressFrom(address)! }); }}>
      {(['back', 'forward', 'reload'] as const).map(action => <Button key={action} type="button" variant="outline" disabled={busy || !permitted} onClick={() => void act('navigate', { action })}>{action}</Button>)}
      <Input aria-label="Browser address" placeholder={state.tabs.find(t => t.active)?.url || 'Address'} value={address} onChange={e => { if (canInput()) setAddress(e.target.value); }} maxLength={2000} disabled={!permitted}/><Button type="submit" disabled={busy || !permitted || !address.trim()}>Go</Button></form>
      {screenError && <p role="alert">{screenError}<Button variant="outline" onClick={() => { if (current()) { setScreenError(null); setStreamRetry(value => value + 1); } }}>Retry screen</Button></p>}
      {(agentId || state.computerId) && state.shows !== 'native' && <HyperLiveScreen retryKey={streamRetry} computerId={agentId || state.computerId!} driving={permitted} canInput={canInput} onProblem={screenProblem} />}
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void act('recording', recording ? { action: 'stop' } : { action: 'start', title: title.trim(), ...(!agentId ? { narrate: false } : {}) }); }}><Input aria-label="Recording title" placeholder="What are you teaching?" value={title} onChange={e => { if (canInput()) setTitle(e.target.value); }} maxLength={200} disabled={recording}/><Button type="submit" disabled={busy || state.recorder?.phase === 'starting' || state.recorder?.phase === 'stopping' || !permitted || (!recording && !!state.recordRefused) || (recording ? !!agentId && !state.recordingIsMine : !title.trim())}>{recording ? 'Stop recording' : 'Record'}</Button></form>
      {(agentId || state.narration === 'external') && <HyperNarrationControl key={authority.key} stopRef={stopNarration} agentId={agentId} recording={recording} enabled={permittedNow() && (!agentId || !!state.recordingIsMine)} canToggle={canInput} canPost={() => permittedNow() && (!agentId || !!scope.state?.recordingIsMine)} />}
      {state.recordRefused && <p>{state.recordRefused}</p>}{state.recorder && <p className="text-xs text-muted-foreground">{state.recorder.phase} · {state.recorder.actions} actions</p>}
      {stopped && <p role="status">{stopped.discarded ? 'Recording discarded.' : stopped.kept ? 'Recording kept in the browser. It has not been saved yet.' : stopped.retrying || (stopped.sending ? 'Recording is still sending.' : stopped.actions + stopped.phrases === 0 ? 'Nothing was recorded.' : 'Recording sent to your Learning space.')}</p>}
      <div className="flex gap-2"><Button variant="outline" disabled={busy || !permitted} onClick={() => { if (canInput()) setConfirm(true); }}>Clear browser data…</Button>{!agentId && <Button variant="outline" disabled={busy || !permitted} onClick={() => void act('close')}>Close browser</Button>}</div>
      {confirm && <div role="alertdialog" aria-label="Clear browser data" className="rounded-xl border p-4"><p>This signs the browser out of every site and deletes its cookies, history and saved passwords.</p><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button disabled={busy || !permitted} onClick={() => { setConfirm(false); void act('clear'); }}>Clear browser</Button></div>}
    </>}
  </div>;
}
export default function HyperBrowserSection({path}: {path?: string}) {
  const match = path ? /^\/bots\/([^/?#]+)\/browser(?:[/?#]|$)/.exec(path) : null;
  let agentId: string | undefined; try { agentId = match ? decodeURIComponent(match[1]) : undefined; } catch { return <p role="alert">Invalid Bot browser destination.</p>; }
  return <section className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6"><h2 className="text-lg font-semibold">Browser</h2><HyperBrowserView key={agentId} agentId={agentId} /></section>;
}
