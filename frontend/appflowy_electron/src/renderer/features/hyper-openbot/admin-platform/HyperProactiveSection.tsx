// Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { HyperCheckInsPanel } from './HyperCheckInsPanel';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperLoadEdition, hyperLoadCheckInMetrics, hyperLoadCheckInOverview, hyperSetCheckIns, hyperSetCheckInLimit, type HyperCheckInMetrics, type HyperCheckInOverview } from './HyperProactiveApi';
const reasons = { off_admin: 'Turned off by an admin', off_person: 'Turned off by the person', paused: 'Bot paused', capped: 'Over the daily limit', no_sources: 'Nothing it could read', unreachable: 'Conversation gone', busy: 'Another one still running' };
export default function HyperProactiveSection({ context }: { context?: HyperOpenBotSectionContext }) {
  const [days, setDays] = useState<7 | 30>(7);
  const [metrics, setMetrics] = useState<HyperCheckInMetrics>();
  const [overview, setOverview] = useState<HyperCheckInOverview>();
  const [personal, setPersonal] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState<string>();
  const sequence = useRef(0);
  async function load() {
    const request = ++sequence.current;
    setLoading(true); setError('');
    try {
      const edition = await hyperLoadEdition().catch(() => ({ edition: 'team' }));
      const isPersonal = edition.edition === 'personal';
      const [next, controls] = await Promise.all([hyperLoadCheckInMetrics(days), isPersonal ? Promise.resolve(undefined) : hyperLoadCheckInOverview()]);
      if (request === sequence.current) { setPersonal(isPersonal); setMetrics(next); setOverview(controls); }
    } catch { if (request === sequence.current) setError('Could not load check-ins. Check your permissions and retry.'); }
    finally { if (request === sequence.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [days]);
  async function save(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); setLimit(undefined); await load(); }
    catch { setError('Could not save check-in settings. Check your permissions and retry.'); }
    finally { setBusy(false); }
  }
  const capability = overview?.capabilities.find(c => c.capability === 'proactive');
  const enabled = capability ? capability.organization ?? capability.default : true;
  return <section className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 overflow-y-auto px-8 py-6 text-sm">
    <h1 className="text-lg font-semibold">Routines</h1><p className="text-muted-foreground">People set their own Bots' routines and goals. Check-ins apply to everybody. Bots check connected apps and ask before acting.</p>
    <Button className="self-start" variant="outline" disabled={loading || busy} onClick={() => void load()}>Refresh</Button>
    {error && <p role="alert" className="text-destructive">{error}</p>}{loading && <p role="status">Loading check-ins…</p>}
    <HyperCheckInsPanel context={context} />
    <h2 className="font-medium">Check-ins</h2>
    {personal ? <p>Team controls are available in the team edition. Personal check-ins are on, with a limit of 24 a day.</p> : overview && <div className="space-y-4 rounded-lg border border-border p-4"><label className="flex gap-3"><input type="checkbox" checked={enabled} disabled={busy || loading} onChange={e => void save(() => hyperSetCheckIns(e.target.checked))} />Check-ins for everybody</label><p>{capability ? Object.keys(capability.roles).length + Object.keys(capability.groups).length : 0} role or group overrides change this for some people.</p><p>Up to {overview.settings.proactiveDailyRuns} check-ins a day per Bot for each person. Skipped check-ins do not count.</p><Button disabled={busy || loading} variant="outline" onClick={() => setLimit(String(overview.settings.proactiveDailyRuns))}>Change daily limit</Button>
      {limit !== undefined && <form className="flex flex-wrap items-center gap-3" onSubmit={e => { e.preventDefault(); void save(() => hyperSetCheckInLimit(Number(limit))); }}><label>Daily limit<Input type="number" min={1} max={1440} step={1} required value={limit} disabled={busy} onChange={e => setLimit(e.target.value)} /></label><Button disabled={busy || !limit.trim() || !Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 1440}>Save</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setLimit(undefined)}>Cancel</Button></form>}</div>}
    <h2 className="font-medium">How check-ins went</h2><label>Period <select className="rounded border border-border bg-background p-2" value={days} onChange={e => setDays(Number(e.target.value) as 7 | 30)}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label>
    {metrics && <><p>{metrics.pings.sent.toLocaleString()} pings sent{metrics.pings.itemsPerPing === null ? '' : ` · ${metrics.pings.itemsPerPing.toFixed(1)} items per ping`}</p>{!metrics.bots.length && <p>No check-ins yet. A Bot starts checking in once somebody talks to it.</p>}{metrics.bots.map(bot => <details key={bot.agentId} className="rounded-lg border border-border p-4"><summary className="cursor-pointer">{bot.name} · {bot.peopleOn} people · {bot.items.raised} items · {bot.acceptance === null ? 'No answers yet' : `${Math.round(bot.acceptance * 100)}% started`}</summary><p className="mt-3 text-muted-foreground">Acceptance is started out of started and hidden items.</p><dl className="grid grid-cols-2 gap-2">{Object.entries({ 'Found nothing': bot.runs.quiet, 'Raised something': bot.runs.raised, 'Could not finish': bot.runs.failed, ...Object.fromEntries(Object.entries(bot.runs.skipped).map(([key, count]) => [reasons[key as keyof typeof reasons], count])), 'Items raised': bot.items.raised, Started: bot.items.started, Hidden: bot.items.hidden, 'Cleared by the Bot': bot.items.cleared, 'Still open': bot.items.open, 'Sent in a ping': bot.pinged }).map(([label, count]) => <div key={label} className="contents"><dt>{label}</dt><dd>{count.toLocaleString()}</dd></div>)}</dl></details>)}</>}
  </section>;
}
