import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAppStore } from '@/startup/app-store';
import { AuthenticatorType } from '@/startup/cloud-env';
import { hyperEntraConfig, hyperEntraFlow, hyperEntraSignedOut, useHyperEntraStore } from './HyperEntraStore';
export function HyperEntraSignIn() {
  const env = useAppStore(state => state.env), route = useAppStore(state => state.route.name);
  const state = useHyperEntraStore();
  const config = hyperEntraConfig();
  const enabled = env?.authenticatorType === AuthenticatorType.HypertaskCloudSelfHost && Boolean(config);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => { if (mounted && enabled && route === 'signIn') void hyperEntraFlow.start(config, env!.hypertaskCloudConfig.base_url, true, hyperEntraSignedOut()); });
    return () => { mounted = false; if (['broker', 'exchange'].includes(hyperEntraFlow.state.phase)) hyperEntraFlow.cancel(); };
  }, [enabled, route]);
  if (!enabled) return null;
  const busy = ['broker', 'exchange', 'handoff'].includes(state.phase);
  return <div className="flex flex-col gap-2" data-hyper-entra-sign-in>
    {busy ? <div className="flex items-center gap-2 rounded-md border p-3"><Spinner className="size-4 shrink-0" /><p role="status" dir="auto" className="min-w-0 flex-1 text-sm">{state.name ? 'Signing in as ' + state.name + '…' : 'Signing in with your Windows account…'}</p><Button variant="ghost" size="sm" disabled={state.phase === 'handoff'} onClick={() => hyperEntraFlow.cancel()}>Cancel</Button></div> : <Button variant="outline" className="h-10 w-full" onClick={() => void hyperEntraFlow.start(config, env!.hypertaskCloudConfig.base_url)}>Sign in with Rafael account</Button>}
    {state.reason && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{state.reason}</p>}
  </div>;
}
