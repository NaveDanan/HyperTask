// Adapted from OpenBot routes/_authed/bots.$agentId.computer and computer/computer-controls.
// Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { hyperReadControl, hyperTakeControl, hyperReleaseControl, type HyperControl } from './HyperComputerApi';
import { HyperBrowserView } from './HyperBrowserSection';
export function HyperBotComputerTab({ agentId }: { agentId: string }) {
  const [control, setControl] = useState<HyperControl>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() { try { const next = await hyperReadControl(agentId); if (active) setControl(next); } catch { if (active) setControl(undefined); } finally { if (active) timer = setTimeout(() => void poll(), 1000); } }
    setControl(undefined); void poll(); return () => { active = false; clearTimeout(timer); };
  }, [agentId]);
  async function change(release: boolean) { setBusy(true); setError(''); try {
    setControl(release && control?.request ? await hyperReleaseControl(agentId, control.request.id) : await hyperTakeControl(agentId, control?.request?.id));
  } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  return <section className="flex flex-col gap-3 p-4">
    {control?.request?.source !== 'manual' && control?.reason && <p>{control.reason}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex gap-2"><Button disabled={!control || busy || control.transitioning} onClick={() => void change(false)}>Take control</Button><Button variant="outline" disabled={!control?.request || busy || control.holder !== 'human'} onClick={() => void change(true)}>Hand back</Button></div>
    <HyperBrowserView key={agentId} agentId={agentId}/>
  </section>;
}
