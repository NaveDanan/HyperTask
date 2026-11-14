// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { HyperListBots, type HyperBotProfile } from '../bots/HyperBotsApi';
import { hyperOpenBotRequest as request } from '../transport';
interface HyperHandoff { enabled: boolean; canGrant: boolean; grantable: boolean; reachable: string[] }
export function HyperBotHandoffTab({ agentId }: { agentId: string }) {
  const [data, setData] = useState<HyperHandoff>();
  const [bots, setBots] = useState<HyperBotProfile[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    let live = true;
    setPending(true);
    void Promise.all([request<{ handoff: HyperHandoff }>(`/api/agents/${encodeURIComponent(agentId)}/handoff`), HyperListBots(false)]).then(([result, rows]) => {
      if (live) { setData(result.handoff); setBots(rows); }
    }).catch(() => { if (live) setError('Could not load which Bots this one may ask.'); }).finally(() => { if (live) setPending(false); });
    return () => { live = false; };
  }, [agentId, revision]);
  async function change(ref: string, granted: boolean) {
    if (lock.current || !data?.canGrant || !data.enabled || !data.grantable) return;
    lock.current = true; setPending(true); setError('');
    try {
      await (granted ? request('/api/plugins/grants', 'POST', { kind: 'bot', ref, agentId }) : request(`/api/plugins/grants?kind=bot&ref=${encodeURIComponent(ref)}&agentId=${encodeURIComponent(agentId)}`, 'DELETE'));
    } catch { setError('The handoff permission could not be changed.'); }
    finally { lock.current = false; setRevision(value => value + 1); }
  }
  return <div className="grid gap-3">
    <h3 className="font-medium">Bots it can ask</h3>
    {pending && <p role="status">Loading…</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
    <Button variant="outline" disabled={pending} onClick={() => setRevision(v => v + 1)}>Refresh</Button>
    {data && (!data.enabled ? <p>Bot handoff is disabled on this deployment.</p> : !data.grantable ? <p>This Bot cannot be given handoff permissions.</p> : <>
      {!data.canGrant && <p>Only administrators can change these permissions.</p>}
      {bots.filter(bot => bot.id !== agentId).map(bot => <label key={bot.id} className="flex items-center gap-2 rounded-lg border border-border p-3"><input type="checkbox" disabled={pending || !data.canGrant} checked={data.reachable.includes(bot.id)} onChange={event => void change(bot.id, event.target.checked)} />{bot.name}</label>)}
      {bots.filter(bot => bot.id !== agentId).length === 0 && <p>No other Bots available.</p>}
    </>)}
  </div>;
}
