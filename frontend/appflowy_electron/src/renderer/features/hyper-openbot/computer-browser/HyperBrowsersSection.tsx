// Adapted from OpenBot settings/browsers and lib/recorder queries/mutations.
// Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useState } from 'react';
import { HyperRecorder } from './HyperRecorder';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest } from '../transport';
interface HyperConnection { id: string; label: string; recording: boolean; lastUsedAt: string | null }
export default function HyperBrowsersSection() {
  const [rows, setRows] = useState<HyperConnection[]>(); const [error, setError] = useState('');
  const [target, setTarget] = useState<HyperConnection>(); const [busy, setBusy] = useState(false);
  async function read() { const value = await hyperOpenBotRequest<{ connections: HyperConnection[] }>('/api/recorder/connections'); setRows(value.connections); }
  useEffect(() => { let active = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() { try { const value = await hyperOpenBotRequest<{ connections: HyperConnection[] }>('/api/recorder/connections'); if (active) { setRows(value.connections); setError(''); } } catch { if (active) setError('Could not list connected browsers.'); } finally { if (active) timer = setTimeout(() => void poll(), 10000); } }
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, []);
  async function revoke() { if (!target) return; setBusy(true); try { await hyperOpenBotRequest(`/api/recorder/connections/${encodeURIComponent(target.id)}`, 'DELETE'); await read(); setTarget(undefined); } catch { setError('Could not disconnect the browser. Try again.'); } finally { setBusy(false); } }
  return <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6"><h2 className="text-lg font-semibold">Connected browsers</h2>
    {error && <p role="alert" className="text-destructive">{error}</p>}{!rows && !error && <p role="status">Loading browsers…</p>}
    {rows?.length === 0 && <p>No browsers connected.</p>}
    {rows?.map(row => <div key={row.id} className="flex items-center gap-3 rounded-lg border p-4"><span className="flex-1">{row.label || 'Browser'}<span className="block text-xs text-muted-foreground">{row.recording ? 'Recording now' : row.lastUsedAt ? `Last used ${new Date(row.lastUsedAt).toLocaleString()}` : 'Not used yet'}</span></span><Button variant="outline" onClick={() => setTarget(row)}>Disconnect…</Button></div>)}
    <HyperRecorder />
    {target && <div role="alertdialog" aria-label="Disconnect browser" className="rounded-lg border p-4"><p>Disconnect {target.label || 'this browser'}? Its Recorder will stop sending to OpenBot.</p><Button variant="outline" disabled={busy} onClick={() => setTarget(undefined)}>Cancel</Button><Button disabled={busy} onClick={() => void revoke()}>Disconnect</Button></div>}
  </section>;
}
