// Adapted from OpenBot components/manage/computers-page.tsx and lib/computers/mutations.ts.
// Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useRef, useState } from 'react';
import { HyperServiceStatus, useHyperOpenBotService } from '../HyperServiceStatus';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest } from '../transport';
import HyperBrowsersSection from './HyperBrowsersSection';
import { HyperHostFolders } from './HyperHostFolders';
import { hyperBrowserAction } from './HyperComputerApi';
type HyperComputerProfile = { computer: string; kind: 'person' | 'bot'; botId?: string; person?: { name: string | null; email: string }; running: boolean; startedAt: string | null; egress?: string | null; updateAvailable?: boolean };
const isOwnBrowser = (row: HyperComputerProfile) => /^person-[0-9a-f]{32}$/.test(row.botId ?? '');
export default function HyperComputerSettings() {
  const service = useHyperOpenBotService();
  const [fleet, setFleet] = useState<{ computers: HyperComputerProfile[]; isolation?: string }>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [edition, setEdition] = useState<string>();
  const [target, setTarget] = useState<{ row: HyperComputerProfile; action: 'stop' | 'reset' | 'update' | 'clear' }>();
  const session = useRef({ live: true, writing: false, target, read: 0 });
  function choose(next: typeof target) { session.current.target = next; setTarget(next); }
  useEffect(() => { const current = session.current; current.live = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() { const sequence = ++current.read; try {
      const [data, capabilities] = await Promise.all([hyperOpenBotRequest<{ computers: HyperComputerProfile[]; isolation?: string }>('/api/computers/fleet'), hyperOpenBotRequest<{ edition: string }>('/api/capabilities')]);
      if (current.live && sequence === current.read && !current.writing) { setFleet(data); setEdition(capabilities.edition); setError(''); }
    } catch { if (current.live && sequence === current.read && !current.writing) { setEdition(undefined); setError('Computers could not be listed. Administrator access may be required.'); } }
    finally { if (current.live) timer = setTimeout(() => void poll(), 10000); } }
    void poll(); return () => { current.live = false; current.read++; current.target = undefined; clearTimeout(timer); };
  }, []);
  async function apply() {
    const current = session.current;
    const valid = () => current.live && current.target === target;
    if (!target || current.writing || !valid()) return;
    current.writing = true; current.read++; setBusy(true); setError('');
    try {
      const capabilities = await hyperOpenBotRequest<{ edition: string }>('/api/capabilities');
      if (!valid()) return;
      // Never reinterpret a stale Reset confirmation as permission to clear the person's Recorder.
      if (isOwnBrowser(target.row) && (capabilities.edition !== edition || !['personal', 'team'].includes(capabilities.edition))) return;
      if (target.action === 'clear') await hyperBrowserAction(undefined, 'clear');
      else await hyperOpenBotRequest('/api/computers/fleet', 'POST', { action: target.action, computer: target.row.computer, ...(target.row.botId ? { botId: target.row.botId } : {}) });
      const data = await hyperOpenBotRequest<{ computers: HyperComputerProfile[]; isolation?: string }>('/api/computers/fleet');
      if (valid()) { setFleet(data); choose(undefined); }
    } catch { if (valid()) setError('The computer action failed or was refused. Refresh and try again.'); }
    finally { current.writing = false; if (current.live) setBusy(false); }
  }
  return <section className="mx-auto max-w-5xl space-y-5 p-6"><h2 className="text-lg font-semibold">Computer</h2>{error && <p role="alert">{error}</p>}{!fleet && !error && <p role="status">Loading computers…</p>}{fleet && <><p>Isolation: {fleet.isolation || 'Not reported'}</p>{fleet.computers.length === 0 && <p>No computers.</p>}{fleet.computers.map(row => <div key={`${row.computer}:${row.botId || ''}`} className="space-y-2 rounded-lg border p-4"><h3>{row.person?.name || row.person?.email || row.botId || row.computer}</h3><p>{row.running ? 'Running' : 'Asleep. Starts on the next computer action.'}{row.startedAt ? ` · Started ${new Date(row.startedAt).toLocaleString()}` : ''}</p>{row.egress !== undefined && <p>Network exit: {row.egress || 'None'}</p>}<div className="flex gap-2">{(['stop', 'reset', 'update'] as const).map(action => <Button key={action} variant="outline" disabled={busy || (isOwnBrowser(row) && !edition) || (action === 'stop' && !row.running) || (action === 'update' && !row.updateAvailable)} onClick={() => { if (session.current.live && !session.current.writing && (!isOwnBrowser(row) || edition)) choose({ row, action: action === 'reset' && edition === 'personal' && isOwnBrowser(row) ? 'clear' : action }); }}>{action === 'reset' && edition === 'personal' && isOwnBrowser(row) ? 'Clear browser data…' : `${action}…`}</Button>)}</div></div>)}</>}
    {target && <div role="alertdialog" aria-label="Confirm computer action" className="rounded-xl border p-4"><p>{target.action} {target.row.botId || target.row.computer}?</p><p>{target.action === 'clear' ? 'This signs the browser out of every site and deletes its cookies, history and saved passwords. A recording ends first and its Recorder connection ends with the profile. An open browser opens again, fresh.' : target.action === 'reset' ? 'Deletes browser profiles and files on this computer.' : target.action === 'stop' ? 'Stops running work. Browser profiles are kept; the next action starts it again.' : 'Moves to the current image and keeps browser profiles.'}</p><Button disabled={busy} variant="outline" onClick={() => choose(undefined)}>Cancel</Button><Button disabled={busy} onClick={() => void apply()}>{target.action === 'clear' ? 'Clear browser' : `Confirm ${target.action}`}</Button></div>}
    <HyperHostFolders /><HyperBrowsersSection />
    <section className="rounded-lg border p-4"><h3>Configured AI services</h3><HyperServiceStatus state={service.state} error={service.error} /><p>Local desktop updates, container memory and native speech belong to the OpenBot Desktop host and are unavailable through this remote backend.</p></section>
  </section>;
}
