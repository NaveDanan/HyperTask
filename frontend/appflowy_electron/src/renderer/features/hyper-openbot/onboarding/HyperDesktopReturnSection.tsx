// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { hyperOpenBotRequest } from '../transport';
import { HyperNativeDestination } from './HyperSetupSection';
export function HyperConfirmDesktopConnection(app: string) {
  return hyperOpenBotRequest(`/api/plugins/servers/${encodeURIComponent(app)}/connection/confirm`, 'POST');
}
/** Native return target. The main-owned callback supplies app without exposing OAuth credentials. */
export default function HyperDesktopReturnSection({ context, app }: { context: HyperOpenBotSectionContext; app?: string }) {
  const [state, setState] = useState<'checking' | 'done' | 'error'>(app ? 'checking' : 'done');
  const generation = useRef(0);
  const confirm = async () => {
    const current = ++generation.current;
    if (!app) { setState('done'); return; }
    setState('checking');
    try { await HyperConfirmDesktopConnection(app); if (current === generation.current) setState('done'); }
    catch { if (current === generation.current) setState('error'); }
  };
  useEffect(() => { void confirm(); return () => { generation.current++; }; }, [app]);
  return <section className="mx-auto flex max-w-3xl flex-col gap-4 p-6"><h1 className="text-lg font-semibold">Back to HyperTask</h1>
    {state === 'checking' ? <p role="status">Confirming your connection…</p> : state === 'error' ? <><p role="alert">Couldn't confirm that connection. Try again or open Connections to check its status.</p><Button onClick={() => void confirm()}>Try again</Button></> : <p role="status">Open Connections to continue.</p>}
    <HyperNativeDestination context={context} path={app ? `/connections/${encodeURIComponent(app)}` : '/connections'} />
  </section>;
}
