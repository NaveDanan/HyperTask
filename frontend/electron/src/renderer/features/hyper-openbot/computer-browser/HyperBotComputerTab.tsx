// Adapted from OpenBot routes/_authed/bots.$agentId.computer and computer/computer-controls.
// Copyright (c) 2026 CopilotKit. MIT.
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useHyperComputerControl } from './HyperComputerControl';
import { HyperPrivateHandoffs } from './HyperPrivateHandoffs';
import { HyperTerminal } from './HyperTerminal';
import { HyperFiles } from './HyperFiles';
import { HyperHostFolders } from './HyperHostFolders';
import { HyperBrowserView } from './HyperBrowserSection';
export function HyperBotComputerTab({ agentId }: { agentId: string }) {
  const [tab, setTab] = useState<'browser' | 'terminal' | 'files' | 'folders'>('browser');
  const authority = useHyperComputerControl(agentId);
  const { control, busy } = authority;
  const [error, setError] = useState('');
  const current = useRef(agentId); current.current = agentId;
  async function change(action: 'take' | 'release' | 'cancel') {
    if (!authority.permits(action)) return;
    setError('');
    try { await authority.change(action); }
    catch { if (current.current === agentId) setError('Control change failed or was refused. Refresh and try again.'); }
  }
  return <section className="flex flex-col gap-3 p-4">
    {control?.request && <p role="status">Handoff: {control.request.status}</p>}
    {control?.request?.source !== 'manual' && control?.reason && <p>{control.reason}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex gap-2"><Button disabled={!authority.permits('take')} onClick={() => void change('take')}>Take control</Button><Button variant="outline" disabled={!authority.permits('release')} onClick={() => void change('release')}>Hand back</Button>{control?.request && !['completed', 'cancelled', 'expired'].includes(control.request.status) && <Button variant="outline" disabled={!authority.permits('cancel')} onClick={() => void change('cancel')}>Decline handoff</Button>}</div>
    <HyperPrivateHandoffs key={agentId} agentId={agentId} control={control} authority={authority} onOpenBrowser={() => { if (authority.permits('private')) setTab('browser'); }} />
    <nav aria-label="Computer views" className="flex gap-2">{(['browser', 'terminal', 'files', 'folders'] as const).map(item => <Button variant={tab === item ? 'default' : 'outline'} key={item} onClick={() => { if (authority.current()) setTab(item); }}>{item}</Button>)}</nav>
    {tab === 'browser' && <HyperBrowserView key={agentId} agentId={agentId} authority={authority}/>}
    {tab === 'terminal' && <div className="h-96"><HyperTerminal key={agentId} computerId={agentId} driving={!busy && authority.canDrive()} canInput={authority.canDrive}/></div>}
    {tab === 'files' && <HyperFiles key={agentId} agentId={agentId}/>}
    {tab === 'folders' && <HyperHostFolders key={agentId} agentId={agentId}/>}
  </section>;
}
