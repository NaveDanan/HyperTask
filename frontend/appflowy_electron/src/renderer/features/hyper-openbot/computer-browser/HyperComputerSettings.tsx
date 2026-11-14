// Adapted from OpenBot components/manage/computers-page.tsx and lib/computers/mutations.ts.
// Copyright (c) 2026 CopilotKit. MIT.
import { useCallback, useEffect, useState } from 'react';
import { HyperServiceStatus, useHyperOpenBotService } from '../HyperServiceStatus';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest } from '../transport';
import HyperBrowsersSection from './HyperBrowsersSection';
import { HyperHostFolders } from './HyperHostFolders';
type HyperComputerProfile = { computer: string; kind: 'person' | 'bot'; botId?: string; person?: { name: string | null; email: string }; running: boolean; startedAt: string | null; egress?: string | null; updateAvailable?: boolean };
export default function HyperComputerSettings() {
  const service = useHyperOpenBotService();
  const [fleet, setFleet] = useState<{ computers: HyperComputerProfile[]; isolation?: string }>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{ row: HyperComputerProfile; action: 'stop' | 'reset' | 'update' }>();
  const read = useCallback(async () => setFleet(await hyperOpenBotRequest('/api/computers/fleet')), []);
  useEffect(() => { let active = true; let timer: ReturnType<typeof setTimeout>; async function poll() { try { const data = await hyperOpenBotRequest<{ computers: HyperComputerProfile[]; isolation?: string }>('/api/computers/fleet'); if (active) { setFleet(data); setError(''); } } catch { if (active) setError('Computers could not be listed. Administrator access may be required.'); } finally { if (active) timer = setTimeout(() => void poll(), 10000); } } void poll(); return () => { active = false; clearTimeout(timer); }; }, []);
  async function apply() { if (!target) return; setBusy(true); setError(''); try { await hyperOpenBotRequest('/api/computers/fleet', 'POST', { action: target.action, computer: target.row.computer, ...(target.row.botId ? { botId: target.row.botId } : {}) }); await read(); setTarget(undefined); } catch { setError('The computer action failed or was refused. Refresh and try again.'); } finally { setBusy(false); } }
  return <section className="mx-auto max-w-5xl space-y-5 p-6"><h2 className="text-lg font-semibold">Computer</h2>{error && <p role="alert">{error}</p>}{!fleet && !error && <p role="status">Loading computers…</p>}{fleet && <><p>Isolation: {fleet.isolation || 'Not reported'}</p>{fleet.computers.length === 0 && <p>No computers.</p>}{fleet.computers.map(row => <div key={`${row.computer}:${row.botId || ''}`} className="space-y-2 rounded-lg border p-4"><h3>{row.person?.name || row.person?.email || row.botId || row.computer}</h3><p>{row.running ? 'Running' : 'Asleep. Starts on the next computer action.'}{row.startedAt ? ` · Started ${new Date(row.startedAt).toLocaleString()}` : ''}</p>{row.egress !== undefined && <p>Network exit: {row.egress || 'None'}</p>}<div className="flex gap-2">{(['stop', 'reset', 'update'] as const).map(action => <Button key={action} variant="outline" disabled={busy || (action === 'stop' && !row.running) || (action === 'update' && !row.updateAvailable)} onClick={() => setTarget({ row, action })}>{action}…</Button>)}</div></div>)}</>}
    {target && <div role="alertdialog" aria-label="Confirm computer action" className="rounded-lg border p-4"><p>{target.action} {target.row.botId || target.row.computer}?</p><p>{target.action === 'reset' ? 'Deletes browser profiles and files on this computer.' : target.action === 'stop' ? 'Stops running work. Browser profiles are kept; the next action starts it again.' : 'Moves to the current image and keeps browser profiles.'}</p><Button disabled={busy} variant="outline" onClick={() => setTarget(undefined)}>Cancel</Button><Button disabled={busy} onClick={() => void apply()}>Confirm {target.action}</Button></div>}
    <HyperHostFolders /><HyperBrowsersSection />
    <section className="rounded-lg border p-4"><h3>Configured AI services</h3><HyperServiceStatus state={service.state} error={service.error} /><p>Local desktop updates, container memory and native speech belong to the OpenBot Desktop host and are unavailable through this remote backend.</p></section>
  </section>;
}
