import { useEffect, useState } from 'react';
import { HYPER_OPENBOT_SERVICE_MESSAGES, type HyperOpenBotServiceAction, type HyperOpenBotServiceState } from '@shared/HyperOpenBotService';
import { Button } from '@/components/ui/button';
const INITIAL: HyperOpenBotServiceState = { backend: 'mmems-personal', phase: 'idle', ready: false, problem: 'services_stopped', checks: [], autoStart: true, checkedAt: null };
export function useHyperOpenBotService(ensure = false) {
  const [state, setState] = useState(INITIAL);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let current = true, version = 0;
    const api = window.appflowy.hyperOpenBot.service;
    const release = api.onState(next => { if (current) { version++; setState(next); setError(undefined); } });
    const update = (promise: Promise<HyperOpenBotServiceState>) => {
      const request = version;
      void promise.then(next => { if (current && request === version) { setState(next); setError(undefined); } }).catch(() => { if (current && request === version) setError('AI service status is unavailable. Retry from Chat.'); });
    };
    update(ensure ? api.run('ensure') : api.state());
    const timer = ensure ? setInterval(() => update(api.run('check')), 30000) : undefined;
    return () => { current = false; release(); if (timer) clearInterval(timer); };
  }, [ensure]);
  return { state, error };
}
export function HyperServiceStatus({ state, error }: { state: HyperOpenBotServiceState; error?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState<'stop' | 'restart'>();
  const [failure, setFailure] = useState<string>();
  const [pending, setPending] = useState(false);
  const [preference, setPreference] = useState<boolean>();
  useEffect(() => { if (preference === state.autoStart) setPreference(undefined); }, [preference, state.autoStart]);
  const busy = pending || state.phase !== 'idle';
  async function run(action: HyperOpenBotServiceAction) {
    if (busy) return;
    setPending(true); setFailure(undefined); setConfirm(undefined);
    try { await window.appflowy.hyperOpenBot.service.run(action); }
    catch { setFailure('The AI service operation could not be completed. Check readiness and retry.'); }
    finally { setPending(false); }
  }
  return <section aria-label="AI service status" className="shrink-0 border-b border-border bg-background px-4 py-2 text-sm">
    <div className="flex flex-wrap items-center gap-2"><span role="status" className={state.ready ? 'text-muted-foreground' : 'text-warning'}>{state.phase !== 'idle' ? `AI services: ${state.phase}…` : state.ready ? 'AI ready · MMEMS backend' : state.checkedAt ? 'AI needs attention' : 'Checking AI services…'}</span>
      <Button variant="ghost" size="sm" className="ml-auto" aria-expanded={expanded || !state.ready} onClick={() => setExpanded(value => !value)}>AI services</Button></div>
    {(expanded || !state.ready) && <div className="mt-2 space-y-3">
      <p>{state.checkedAt || state.problem === 'unsupported' ? HYPER_OPENBOT_SERVICE_MESSAGES[state.problem] : 'Checking the configured private backend. HyperTask stays open while AI services connect.'}</p>
      <p className="text-xs text-muted-foreground">OpenBot, Intelligence and model access run on the configured VM. Dependencies, account sign-in and licensing are required. Closing HyperTask leaves this backend running.</p>
      {state.checks.length > 0 && <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{state.checks.map(check => <div key={check.id} className="flex gap-1"><dt className="capitalize">{check.id}</dt><dd>{check.state}</dd></div>)}</dl>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => void run('check')}>Check AI readiness</Button>
        {!state.ready && <Button size="sm" disabled={busy || state.problem === 'unsupported' || state.problem === 'signed_out'} onClick={() => void run('start')}>Start AI services</Button>}
        <Button variant="outline" size="sm" disabled={busy || !state.checks.some(check => check.id === 'deployment' && check.state !== 'missing' && check.state !== 'unknown')} onClick={() => setConfirm('restart')}>Restart AI services</Button>
        <Button variant="outline" size="sm" disabled={busy || !state.checks.some(check => ['server', 'worker', 'computer', 'harness', 'postgres'].includes(check.id) && check.state === 'ready')} onClick={() => setConfirm('stop')}>Stop AI services</Button></div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={preference ?? state.autoStart} disabled={busy} onChange={event => {
        const next = event.target.checked; setPreference(next); setPending(true); setFailure(undefined);
        void window.appflowy.hyperOpenBot.service.configure(next).catch(() => { setPreference(undefined); setFailure('The AI startup preference could not be saved.'); }).finally(() => setPending(false));
      }} />Start the provisioned AI services automatically when opening HyperTask.</label>
      {confirm && <div role="alertdialog" aria-label={confirm === 'stop' ? 'Stop managed AI services' : 'Restart managed AI services'} className="space-y-2 rounded-md border border-border p-3">
        <p>{confirm === 'stop' ? 'Stop' : 'Restart'} only the managed AI services on the configured VM? Active AI work may be interrupted. Saved chats and workspace stores are preserved.</p>
        <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void run(confirm)}>{confirm === 'stop' ? 'Confirm stop' : 'Confirm restart'}</Button><Button variant="ghost" size="sm" onClick={() => setConfirm(undefined)}>Cancel</Button></div>
      </div>}
    </div>}
    {(error || failure) && <p role="alert" className="mt-2 text-sm text-destructive">{error || failure}</p>}
  </section>;
}
